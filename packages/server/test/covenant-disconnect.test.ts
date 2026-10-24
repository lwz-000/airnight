/**
 * ============================================================
 *  ★★ 0.3.2：盟约选秀阶段有人掉线 —— 不暂停、也不让他卡住全房间
 * ============================================================
 *
 * 【用户报的现象】
 * "在盟约界面有人断线也触发暂停弹窗，倒计时也会同时停掉"。
 *
 * 【规则（这次钉死的口径）】
 *   1. 选秀阶段**永远不暂停**（选秀自带 30 秒超时兜底，再叠一层"等掉线的人"只会像卡死）；
 *   2. 掉线的人如果正好轮到他 —— **立刻替他随机选一个**，别让全房间干等 30 秒；
 *   3. 掉线的人排在后面 —— 轮到他时同样自动跳过（`afterCovenantPick` 里那条）。
 *   4. 选秀结束后如果还有人没回来，改在**布阵阶段**停一次（第一回合别让他空手挨打）。
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

class Player {
  socket: WebSocket;
  playerId = '';
  inbox: ServerMessage[] = [];

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

  lastRoom(): Extract<ServerMessage, { t: 'room' }> | undefined {
    for (let i = this.inbox.length - 1; i >= 0; i -= 1) {
      const m = this.inbox[i]!;
      if (m.t === 'room') return m;
    }
    return undefined;
  }

  close(): void {
    this.socket.close();
  }
}

let handle: { wss: WebSocketServer; close: () => void };
let port = 0;

beforeAll(async () => {
  handle = startServer(0, '127.0.0.1');
  if (!handle.wss.address()) {
    await new Promise<void>((resolve) => handle.wss.once('listening', () => resolve()));
  }
  const address = handle.wss.address();
  port = typeof address === 'object' && address ? address.port : 0;
  expect(port).toBeGreaterThan(0);
});

afterAll(() => {
  handle?.close();
});

describe('★ 选秀阶段掉线：不暂停、不卡住', () => {
  it('★★ 轮到某人时他掉线：立刻替他选、房间仍是 covenant 且不暂停', async () => {
    /*
      ★ 用 3 个人：2 个人的话选秀一秒就结束了，观察不到"还在选秀但有人掉线"。
      流程：谁先选 -> 点掉 -> 断掉**下一个轮到的人** -> 断言三件事。
    */
    const a = new Player(port);
    const b = new Player(port);
    const c = new Player(port);
    await Promise.all([a.ready(), b.ready(), c.ready()]);
    a.send({ t: 'createRoom', playerName: '房主甲' });
    await sleep(250);
    const code = a.lastRoom()!.room.code;
    b.send({ t: 'joinRoom', roomCode: code, playerName: '朋友乙' });
    c.send({ t: 'joinRoom', roomCode: code, playerName: '朋友丙' });
    await sleep(300);
    a.send({ t: 'setReady', ready: true });
    b.send({ t: 'setReady', ready: true });
    c.send({ t: 'setReady', ready: true });
    await sleep(300);
    a.send({ t: 'startGame' });
    await sleep(500);

    const started = a.lastRoom()!;
    expect(started.room.phase, '开局先进选秀').toBe('covenant');
    const byId = (id: string): Player => (id === a.playerId ? a : id === b.playerId ? b : c);

    // 1) 当前这位正常选掉
    const first = started.room.covenant!.currentPlayerId;
    byId(first).send({ t: 'pickCovenant', covenantId: 'cv_warfarin' });
    await sleep(300);

    // 2) 看清"下一个轮到谁"，然后把他断开
    const survivorView = byId(first).lastRoom()!;
    expect(survivorView.room.phase, '还有两个人没选，应该还在选秀').toBe('covenant');
    const nextId = survivorView.room.covenant!.currentPlayerId;
    expect(nextId, '不该还是刚才那位').not.toBe(first);
    byId(nextId).close();

    await sleep(1200);
    const after = byId(first).lastRoom()!;
    expect(after.room.paused, '★★ 掉线不能让选秀阶段进入暂停').toBeFalsy();
    expect(after.room.phase, '★★ 掉线也不能把选秀中断/跳过').toBe('covenant');
    const dropped = after.room.players.find((player) => player.id === nextId)!;
    expect(dropped.covenantId, '★ 掉线那位要被**立刻**代选（不能干等 30 秒）').toBeTruthy();
    // 剩下那位（第三个人）还在等他选，倒计时照走
    expect(after.room.covenant!.secondsLeft, '倒计时还在走').toBeGreaterThan(0);

    a.close();
    b.close();
    c.close();
  }, 25000);
});
