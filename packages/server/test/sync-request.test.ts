/**
 * ============================================================
 *  ★★ 0.3.2：`requestSync` —— 漏收广播之后怎么补回来
 * ============================================================
 *
 * 【为什么要这条通道？】
 * 房间状态是一条条**增量**推下来的（`room` / `pool` / `prepTeams` / `gameStarted`…）。
 * 网络抖一下、标签页被浏览器冻住，客户端就可能漏掉几条 ——
 * 于是"我还停在第 6 回合，别人已经在第 8 回合开打"（用户说的"平行世界"）。
 *
 * 补同步的约定（这条测试就是钉住它）：
 *   1. `RoomView.rev` 每广播一次 +1 —— 客户端靠**跳号**发现"我漏了"；
 *   2. 客户端发 `requestSync`，服务器回**四条幂等消息**：
 *      `phaseState` + `room` + `pool` + `prepTeams`；
 *   3. ★ **不回 `gameStarted`** —— 那条在客户端会触发回合结算（发钱/发经验），
 *      拿它补同步等于每抖一次就白送一次收入。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket, type WebSocketServer } from 'ws';
import {
  SERVER_VERSION,
  decodeMessage,
  type ClientMessage,
  type ServerMessage,
} from '../../shared/src/index.js';

process.env.AIRNIGHT_NO_AUTOSTART = '1';
const { startServer } = await import('../src/main.js');

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** 够用的最小客户端（和别的服务端测试同一种写法） */
class TestClient {
  socket: WebSocket;
  playerId = '';
  private inbox: ServerMessage[] = [];

  constructor(port: number) {
    this.socket = new WebSocket(`ws://127.0.0.1:${port}`);
    this.socket.on('message', (data) => {
      const message = decodeMessage<ServerMessage>(data.toString());
      if (!message) return;
      if (message.t === 'welcome') this.playerId = message.playerId;
      this.inbox.push(message);
    });
  }

  async ready(): Promise<void> {
    if (this.socket.readyState === WebSocket.OPEN) return;
    await new Promise<void>((resolve, reject) => {
      this.socket.once('open', () => resolve());
      this.socket.once('error', reject);
    });
  }

  send(message: ClientMessage): void {
    const outgoing =
      message.t === 'createRoom' || message.t === 'joinRoom'
        ? { ...message, version: SERVER_VERSION }
        : message;
    this.socket.send(JSON.stringify(outgoing));
  }

  all(): ServerMessage[] {
    return this.inbox;
  }

  clear(): void {
    this.inbox = [];
  }

  /** ★ 只在这个客户端自己的 inbox 里找（不跨客户端） */
  async waitFor<T extends ServerMessage['t']>(
    type: T,
    timeoutMs = 5000,
  ): Promise<Extract<ServerMessage, { t: T }>> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const found = this.inbox.find((m) => m.t === type);
      if (found) return found as Extract<ServerMessage, { t: T }>;
      await sleep(20);
    }
    throw new Error(`等 ${type} 超时（收到：${this.inbox.map((m) => m.t).join(',')}）`);
  }

  close(): void {
    this.socket.close();
  }
}

let handle: { wss: WebSocketServer; close: () => void };
let port = 0;

beforeAll(async () => {
  handle = startServer(0, '127.0.0.1');
  // ★ 端口传 0 时 address() 在 listening 之前是 null，必须等一下（别人踩过）
  if (!handle.wss.address()) {
    await new Promise<void>((resolve) => handle.wss.once('listening', () => resolve()));
  }
  const address = handle.wss.address();
  port = typeof address === 'object' && address ? address.port : 0;
  expect(port).toBeGreaterThan(0);
});

afterAll(() => {
  handle.close();
});

describe('★ requestSync：漏收广播之后补一份权威快照', () => {
  it('★★ 回四条幂等消息，且**不含 gameStarted**（不触发回合结算）', async () => {
    const client = new TestClient(port);
    await client.ready();
    client.send({ t: 'createRoom', playerName: '玩家甲' });
    await client.waitFor('room');
    client.clear();

    client.send({ t: 'requestSync' });

    const phase = await client.waitFor('phaseState');
    const room = await client.waitFor('room');
    await client.waitFor('pool');
    await client.waitFor('prepTeams');

    expect(phase.round, '和房间视图里的回合号是同一个数（补同步不能各说各的）').toBe(
      room.room.round,
    );
    expect(phase.phase).toBe('lobby');
    expect(room.room.code, '快照里带着房间号').toBeTruthy();
    expect(
      client.all().some((m) => m.t === 'gameStarted'),
      '★ 绝不能回 gameStarted —— 客户端会拿它做回合结算',
    ).toBe(false);
    client.close();
  });

  it('★★ 每次房间广播 rev +1：客户端靠跳号发现漏收', async () => {
    const client = new TestClient(port);
    await client.ready();
    client.send({ t: 'createRoom', playerName: '玩家乙' });
    const first = await client.waitFor('room');
    const rev0 = first.room.rev ?? -1;
    expect(rev0, 'rev 必须是数字').toBeGreaterThanOrEqual(0);

    // 两次「准备」都会触发一次房间广播
    client.send({ t: 'setReady', ready: true });
    await sleep(60);
    client.send({ t: 'setReady', ready: false });
    await sleep(120);

    const rooms = client.all().filter((m) => m.t === 'room') as Array<
      Extract<ServerMessage, { t: 'room' }>
    >;
    const revs = rooms.map((m) => m.room.rev ?? -1);
    expect(revs.length, '至少收到三次房间广播').toBeGreaterThanOrEqual(3);
    // 严格递增、且每次只 +1（客户端就是按"差 1"来判断有没有断档的）
    for (let i = 1; i < revs.length; i++) {
      expect(revs[i]! - revs[i - 1]!, `第 ${i} 份广播的 rev 必须正好 +1`).toBe(1);
    }
    client.close();
  });
});
