/**
 * ============================================================
 *  ★★ 宽限期到点：座位必须真的被清掉
 * ============================================================
 *
 * 【为什么单独一个文件？】
 * 因为这一条要**等宽限期真的过去**。正常配置下大厅是 3 分钟、对局是 5 分钟，
 * 跑一条用例要等几分钟 —— 所以这里用 `AIRNIGHT_RESUME_GRACE_MS` 把两者一起压到几百毫秒。
 * 环境变量必须在 `import main.js` **之前**设好（模块加载时就读了），
 * 而且 vitest 默认每个测试文件一个独立环境，所以不会污染别的用例。
 *
 * 【它钉的是什么？】
 * "座位保留"不能变成"座位永久占着"：一个掉线再也不回来的人，
 * 如果一直占着牌库/血量/房主，别人还得陪他打完一整局。
 * 到点必须走一条**和"主动离开房间"等价**的清理路径：
 *   退房 -> 令牌作废 -> 从"等回执"名单里摘掉 -> 房主迁移（必要时）-> 广播房间。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket, type WebSocketServer } from 'ws';
import { SERVER_VERSION, decodeMessage, type ClientMessage, type ServerMessage } from '../../shared/src/index.js';

process.env.AIRNIGHT_NO_AUTOSTART = '1';
process.env.AIRNIGHT_START_ROUND = '3';
process.env.AIRNIGHT_PREP_SECONDS = '1';
/** ★ 关键：把宽限期压到 300 毫秒，这条用例才跑得快 */
process.env.AIRNIGHT_RESUME_GRACE_MS = '300';
const { startServer } = await import('../src/main.js');

class TestClient {
  socket: WebSocket;
  playerId = '';
  resumeToken = '';
  private inbox: ServerMessage[] = [];
  private waiters: Array<{ predicate: (m: ServerMessage) => boolean; resolve: (m: ServerMessage) => void }> = [];

  constructor(port: number) {
    this.socket = new WebSocket(`ws://127.0.0.1:${port}`);
    this.socket.on('message', (data) => {
      const message = decodeMessage<ServerMessage>(data.toString());
      if (!message) return;
      if (message.t === 'welcome') {
        this.playerId = message.playerId;
        this.resumeToken = message.resumeToken ?? '';
      }
      this.inbox.push(message);
      this.waiters = this.waiters.filter((waiter) => {
        if (waiter.predicate(message)) {
          waiter.resolve(message);
          return false;
        }
        return true;
      });
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
    /*
      ★ 0.1.3：服务端会校验客户端版本（见 ensureSameVersion）——
      createRoom / joinRoom 不带 version 会被**直接拒绝**，而且表现是
      "等待消息 room 超时"，完全看不出是版本问题。这里统一补上，
      免得每个用例都要记着写一次、漏一个就红一片。
    */
    const outgoing =
      message.t === 'createRoom' || message.t === 'joinRoom'
        ? { ...message, version: SERVER_VERSION }
        : message;
    this.socket.send(JSON.stringify(outgoing));
  }

  waitFor<T extends ServerMessage['t']>(
    type: T,
    timeoutMs = 5000,
    extra?: (m: Extract<ServerMessage, { t: T }>) => boolean,
  ): Promise<Extract<ServerMessage, { t: T }>> {
    const existing = this.inbox.find(
      (m) => m.t === type && (!extra || extra(m as Extract<ServerMessage, { t: T }>)),
    );
    if (existing) return Promise.resolve(existing as Extract<ServerMessage, { t: T }>);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`等待消息 ${type} 超时（${timeoutMs}ms）`)), timeoutMs);
      this.waiters.push({
        predicate: (m) => m.t === type && (!extra || extra(m as Extract<ServerMessage, { t: T }>)),
        resolve: (m) => {
          clearTimeout(timer);
          resolve(m as Extract<ServerMessage, { t: T }>);
        },
      });
    });
  }

  close(): void {
    this.socket.close();
  }

  /**
   * 清空收件箱。
   * ★ 这一步在本用例里是**必须的**：`waitFor` 会先翻历史消息，
   * 而"房间刚建好、只有房主一个人"那条 room 消息的 `players.length` 也是 1 ——
   * 不清掉的话"座位被清掉了"这个断言会**立刻**匹配到那条历史消息，永远为真。
   */
  clear(): void {
    this.inbox = [];
  }
}

describe('★ 断线宽限期到点 -> 座位被真正清掉', () => {
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

  it('★ 到点没回来：座位消失、令牌作废，房主交给还在线的人', async () => {
    const host = new TestClient(port);
    const guest = new TestClient(port);
    await host.ready();
    await guest.ready();

    host.send({ t: 'createRoom', playerName: '房主' });
    const room = await host.waitFor('room');
    guest.send({ t: 'joinRoom', roomCode: room.room.code, playerName: '朋友' });
    await host.waitFor('room', 5000, (m) => m.room.players.length === 2);

    const guestId = guest.playerId;
    const token = guest.resumeToken;
    // 先清历史消息（见 clear() 的说明）
    host.clear();
    guest.close();

    // 先确认"掉线但座位还在"
    const offline = await host.waitFor(
      'room',
      5000,
      (m) => m.room.players.find((p) => p.id === guestId)?.connected === false,
    );
    expect(offline.room.players.length).toBe(2);

    // 宽限期（300ms）过去 -> 座位真的要没了
    const gone = await host.waitFor(
      'room',
      5000,
      (m) => m.room.players.length === 1 && !m.room.players.some((p) => p.id === guestId),
    );
    expect(
      gone.room.players.some((p) => p.id === guestId),
      '宽限期一过，座位必须真的消失（不然"保留"就变成了"永久占位"）',
    ).toBe(false);

    // 令牌同时作废：拿它重连只会得到 resumeFailed
    const tooLate = new TestClient(port);
    await tooLate.ready();
    tooLate.send({ t: 'resume', token });
    const failed = await tooLate.waitFor('resumeFailed', 5000);
    expect(failed.code.length).toBeGreaterThan(0);

    tooLate.close();
    host.close();
  }, 15000);
});
