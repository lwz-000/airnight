/**
 * 联机服务的端到端测试。
 *
 * 这个测试会真的启动一个服务器、真的开 WebSocket 连接，
 * 完整走一遍：建房 -> 加入 -> 开始 -> 提交阵容 -> 收到战斗种子 -> 客户端本地重放 -> 比对校验和。
 *
 * 【为什么这个测试最有价值？】
 * 它验证了自走棋联机的整个核心假设：
 *   服务器只发一个种子，客户端本地算出的战斗结果和服务器完全一致。
 * 这条链路一旦通了，剩下全是内容工作。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket, type WebSocketServer } from 'ws';
import {
  SERVER_VERSION,
  TEAM_0_MAX_COL,
  TEAM_1_MIN_COL,
  UNIT_DEFS,
  decodeMessage,
  simulate,
  type ClientMessage,
  type ServerMessage,
  type UnitPlacement,
} from '../../shared/src/index.js';

// 阻止 main.ts 在被 import 时自动启动服务器（我们要自己控制端口）
process.env.AIRNIGHT_NO_AUTOSTART = '1';
/*
  ★ 从第 3 回合开局。
  0.0.3 起第 1、2 回合是野怪回合（对手是野怪波次，不是真人），
  而这几份测试要验的是**真人配对 / 轮空 / 影子 / 回执**这条链路 ——
  从第 1 回合开局的话它们全都会落到野怪分支上去。
  野怪回合本身由 packages/server/test/monster-round.test.ts 单独测。
*/
process.env.AIRNIGHT_START_ROUND = '3';
/*
  ★ 布阵改成 60 秒定时制之后，端到端测试必须把这个时间调短。
  否则每个"提交阵容 -> 等 battleStart"的用例都要真等一分钟。
  （客户端的倒计时是服务器推过来的，所以只有服务端需要这个变量。）

  取 4 秒而不是 1 秒：还有一条用例要断言"倒计时大于 0"，
  1 秒的话还没轮到断言就已经归零了。
*/
const TEST_PREP_SECONDS = 4;
process.env.AIRNIGHT_PREP_SECONDS = String(TEST_PREP_SECONDS);
const { startServer, battlePlaybackWaitMs, playbackFallbackMs } = await import('../src/main.js');

/** 一个极简的测试用客户端：发消息、等消息 */
class TestClient {
  socket: WebSocket;
  playerId = '';
  private inbox: ServerMessage[] = [];
  private waiters: Array<{ predicate: (m: ServerMessage) => boolean; resolve: (m: ServerMessage) => void }> = [];

  constructor(port: number) {
    this.socket = new WebSocket(`ws://127.0.0.1:${port}`);
    this.socket.on('message', (data) => {
      const message = decodeMessage<ServerMessage>(data.toString());
      if (!message) return;
      if (message.t === 'welcome') this.playerId = message.playerId;
      this.inbox.push(message);
      // 唤醒等待这条消息的人
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
    this.socket.send(JSON.stringify(message));
  }

  /** 等一条符合条件的消息，超时就报错（避免测试永远挂着） */
  waitFor<T extends ServerMessage['t']>(
    type: T,
    timeoutMs = 5000,
    extra?: (m: Extract<ServerMessage, { t: T }>) => boolean,
  ): Promise<Extract<ServerMessage, { t: T }>> {
    // 先看收件箱里有没有已经收到的
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

  clear(): void {
    this.inbox = [];
  }

  /** 收到过的所有消息（用来断言"某条消息**没有**来过"） */
  inboxAll(): ServerMessage[] {
    return this.inbox;
  }

  close(): void {
    this.socket.close();
  }
}

/**
 * 造一个合法的测试阵容。
 *
 * 【注意：不写死干员名字】
 * 干员名单会换（占位 50 个 -> 正式设计），写死名字会让测试一换名单就崩。
 * 所以从当前表里按费用取，坐标也由常量推导。
 */
function testTeam(): UnitPlacement[] {
  const ids = Object.keys(UNIT_DEFS).sort();
  if (ids.length < 3) throw new Error('干员表里至少要有 3 个干员');
  return [
    { defId: ids[0]!, star: 2, cell: { col: TEAM_0_MAX_COL, row: 1 } },
    { defId: ids[1]!, star: 1, cell: { col: 0, row: 3 } },
    { defId: ids[2]!, star: 1, cell: { col: 2, row: 0 } },
  ];
}

/**
 * 把「建房 → 朋友加入 → 双方准备 → 房主开局」这一整套前置流程走完。
 *
 * 【为什么要抽成辅助函数？】
 * 因为服务器有一条规则：房主必须在其他人都点了「准备好了」之后才能开局。
 * 每条测试都手写一遍准备流程，既啰嗦、又容易漏（漏了就会超时失败，
 * 而且失败信息是「等待 gameStarted 超时」，完全看不出真正原因是「没点准备」）。
 * 收进一个函数，改规则时只需要改一处。
 *
 * @returns 房间码
 */
async function setupStartedRoom(host: TestClient, guest: TestClient): Promise<string> {
  host.send({ t: 'createRoom', playerName: '房主', version: SERVER_VERSION });
  const room = await host.waitFor('room');
  guest.send({ t: 'joinRoom', roomCode: room.room.code, playerName: '朋友', version: SERVER_VERSION });
  await host.waitFor('room', 5000, (m) => m.room.players.length === 2);

  // 朋友（非房主）先准备好
  guest.send({ t: 'setReady', ready: true });
  await host.waitFor('room', 5000, (m) => m.room.players.some((p) => p.ready));

  // 非房主先点「准备好了」——服务器要求全员准备后房主才能开局
    guest.send({ t: 'setReady', ready: true });
    await host.waitFor('room', 5000, (m) => m.room.players.some((p) => p.ready));
    host.send({ t: 'updateSettings', settings: { covenants: false } });
    host.send({ t: 'startGame' });
  await host.waitFor('gameStarted', 8000);
  return room.room.code;
}

/**
 * ★ 0.0.3：结算（扣血 / battleEnd / 淘汰）被推迟到"这一回合所有人都看完"之后了，
 * 所以测试想拿到 battleEnd，必须**先替参战的人举手**（发 playbackDone）。
 * 服务端的道理见 main.ts 里 settlers 的说明。
 */
async function ackPlayback(clients: TestClient[]): Promise<void> {
  for (const client of clients) {
    const battle = await client.waitFor('battleStart', 10000);
    client.send({ t: 'playbackDone', battleId: battle.battleId });
  }
}

describe('联机房间服务（端到端）', () => {
  let handle: { wss: WebSocketServer; close: () => void };
  let port = 0;

  beforeAll(async () => {
    // 端口传 0：让操作系统随便分配一个空闲端口，避免和别的程序撞端口
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

  it('建房间 -> 朋友加入 -> 拿到房间状态', async () => {
    const host = new TestClient(port);
    const guest = new TestClient(port);
    await host.ready();
    await guest.ready();

    host.send({ t: 'createRoom', playerName: '房主', version: SERVER_VERSION });
    const roomMessage = await host.waitFor('room');
    expect(roomMessage.room.players).toHaveLength(1);
    expect(roomMessage.room.code).toHaveLength(6);
    expect(roomMessage.room.hostId).toBe(host.playerId);

    const code = roomMessage.room.code;
    guest.send({ t: 'joinRoom', roomCode: code, playerName: '朋友', version: SERVER_VERSION });

    // 房主应该收到「房间变成 2 个人」的广播
    const updated = await host.waitFor('room', 5000, (m) => m.room.players.length === 2);
    // 注意：这里按 playerId 比对，不要按名字排序。
    // JS 的 Array.prototype.sort() 默认按 UTF-16 码元排序，
    // 中文字符的码元顺序没有任何直觉意义（'房' 排在 '朋' 前面）。
    // 用 id 比对才能稳定复现。
    expect(updated.room.players.map((p) => p.id).sort()).toEqual([host.playerId, guest.playerId].sort());
    expect(updated.room.players.map((p) => p.name)).toContain('房主');
    expect(updated.room.players.map((p) => p.name)).toContain('朋友');

    host.close();
    guest.close();
  });

  it('房间码不对时给出明确错误', async () => {
    const client = new TestClient(port);
    await client.ready();
    client.send({ t: 'joinRoom', roomCode: 'ZZZZZZ', playerName: '路人', version: SERVER_VERSION });
    const error = await client.waitFor('error');
    expect(error.code).toBe('JOIN_FAILED');
    expect(error.message).toContain('房间不存在');
    client.close();
  });

  it('房间码格式不对时被拒绝', async () => {
    const client = new TestClient(port);
    await client.ready();
    client.send({ t: 'joinRoom', roomCode: 'abc', playerName: '路人', version: SERVER_VERSION });
    const error = await client.waitFor('error');
    expect(error.code).toBe('BAD_CODE');
    client.close();
  });

  /*
    ★★ 0.1.3：版本号校验 —— 不同版本**不允许联机**。
    两边版本不同的后果不是"少个功能"，而是**同一个局面算出不同结果**
    （协议字段、战斗内核算法都可能变了）—— 联机里表现为"莫名其妙打输/打赢"。
    所以服务端必须拦死，并且把两边各是什么版本说清楚。
  */
  it('★★ 0.1.3 版本不一致：joinRoom 直接被拒，错误码里说清两边版本', async () => {
    // 老客户端根本不发 version —— 一律当成不兼容
    const oldClient = new TestClient(port);
    await oldClient.ready();
    oldClient.send({ t: 'joinRoom', roomCode: 'ZZZZZZ', playerName: '老版本' });
    const oldError = await oldClient.waitFor('error');
    expect(oldError.code, '不发 version 也算版本不一致').toBe('VERSION_MISMATCH');
    expect(oldError.message).toContain('未知版本');
    oldClient.close();

    // 新客户端但版本号对不上
    const wrongClient = new TestClient(port);
    await wrongClient.ready();
    wrongClient.send({ t: 'joinRoom', roomCode: 'ZZZZZZ', playerName: '错误版本', version: '0.0.1' });
    const wrongError = await wrongClient.waitFor('error');
    expect(wrongError.code).toBe('VERSION_MISMATCH');
    expect(wrongError.message, '要把两边的版本号都说出来').toContain('0.0.1');
    expect(wrongError.message).toContain(SERVER_VERSION);
    wrongClient.close();
  });

  it('★★ 0.1.3 版本一致：joinRoom 正常进房（不会被误伤）', async () => {
    const host = new TestClient(port);
    await host.ready();
    host.send({ t: 'createRoom', playerName: '房主', version: SERVER_VERSION });
    const room = await host.waitFor('room');
    host.close();

    const guest = new TestClient(port);
    await guest.ready();
    guest.send({
      t: 'joinRoom',
      roomCode: room.room.code,
      playerName: '朋友',
      version: SERVER_VERSION,
    });
    // 版本一致就不该收到任何 error —— 能等到 room 广播就算通过
    const joined = await guest.waitFor('room');
    expect(joined.room.players.length).toBe(2);
    guest.close();
  });

  it('非房主不能开始游戏', async () => {
    const host = new TestClient(port);
    const guest = new TestClient(port);
    await host.ready();
    await guest.ready();
    host.send({ t: 'createRoom', playerName: '房主', version: SERVER_VERSION });
    const room = await host.waitFor('room');
    guest.send({ t: 'joinRoom', roomCode: room.room.code, playerName: '朋友', version: SERVER_VERSION });
    await guest.waitFor('room');

    guest.send({ t: 'updateSettings', settings: { covenants: false } });
    guest.send({ t: 'startGame' });
    const error = await guest.waitFor('error');
    expect(error.code).toBe('NOT_HOST');

    host.close();
    guest.close();
  });

  it('★ 核心链路：服务端广播种子，客户端本地重放得到同一个校验和', async () => {
    const host = new TestClient(port);
    const guest = new TestClient(port);
    await host.ready();
    await guest.ready();

    // 1) 建房 + 加入
    host.send({ t: 'createRoom', playerName: '房主', version: SERVER_VERSION });
    const room = await host.waitFor('room');
    guest.send({ t: 'joinRoom', roomCode: room.room.code, playerName: '朋友', version: SERVER_VERSION });
    await host.waitFor('room', 5000, (m) => m.room.players.length === 2);

    // 2) 房主开始游戏
    // 非房主先点「准备好了」——服务器要求全员准备后房主才能开局
    guest.send({ t: 'setReady', ready: true });
    await host.waitFor('room', 5000, (m) => m.room.players.some((p) => p.ready));
    host.send({ t: 'updateSettings', settings: { covenants: false } });
    host.send({ t: 'startGame' });
    await host.waitFor('gameStarted');
    await guest.waitFor('gameStarted');

    // 3) 双方提交阵容
    host.send({ t: 'submitTeam', units: testTeam() });
    guest.send({ t: 'submitTeam', units: testTeam() });

    // 4) 等待战斗开始广播
    const battle = await host.waitFor('battleStart', 10000);
    expect(battle.seed).toBeGreaterThan(0);
    expect(battle.team0.units.length).toBeGreaterThan(0);
    expect(battle.team1.units.length).toBeGreaterThan(0);

    // 5) 关键一步：客户端拿同一个种子重放战斗
    const replay = simulate(UNIT_DEFS, [battle.team0, battle.team1], battle.seed);

    // 校验和必须和服务器算出来的一致 —— 这就是「联机不同步」的防线
    expect(replay.checksum).toBe(battle.expectedChecksum);

    // 再多跑几遍，确保不是巧合
    for (let i = 0; i < 5; i++) {
      const again = simulate(UNIT_DEFS, [battle.team0, battle.team1], battle.seed);
      expect(again.checksum).toBe(battle.expectedChecksum);
    }

    // ★ 0.0.3：结算推迟到"所有人都看完"之后了 —— 先替两边举手
    await ackPlayback([host, guest]);

    // 战斗结束广播应该到达
    const end = await host.waitFor('battleEnd', 10000);
    expect(end.battleId).toBe(battle.battleId);
    expect([0, 1, null]).toContain(end.winner);

    host.close();
    guest.close();
  });

  /**
   * ★ 0.0.3 需求：**开战的瞬间不能泄漏结果**。
   *
   * 【以前是什么样】simulate 一算完就 `applyBattleResult` 扣血、紧接着广播
   * battleEnd，于是战斗动画还没开始播，玩家列表里的血条就已经变了 ——
   * 结果提前泄底（而且"谁被淘汰"也当场知道）。
   * 现在只广播 battleStart，扣血要等**这一回合所有人都看完**。
   */
  it('★ 开战瞬间不扣血：要等所有人都看完才结算（旧代码在这里会红）', async () => {
    const host = new TestClient(port);
    const guest = new TestClient(port);
    await host.ready();
    await guest.ready();
    host.send({ t: 'createRoom', playerName: '房主', version: SERVER_VERSION });
    const room = await host.waitFor('room');
    guest.send({ t: 'joinRoom', roomCode: room.room.code, playerName: '朋友', version: SERVER_VERSION });
    await host.waitFor('room', 5000, (m) => m.room.players.length === 2);
    guest.send({ t: 'setReady', ready: true });
    await host.waitFor('room', 5000, (m) => m.room.players.some((p) => p.ready));
    host.send({ t: 'updateSettings', settings: { covenants: false } });
    host.send({ t: 'startGame' });
    await host.waitFor('gameStarted');

    // 故意做成一强一弱，避免打成平局（平局不扣血，后面的断言就没有意义）
    const ids = Object.keys(UNIT_DEFS).sort();
    host.send({ t: 'submitTeam', units: testTeam() });
    guest.send({ t: 'submitTeam', units: [{ defId: ids[1]!, star: 1, cell: { col: 0, row: 0 } }] });

    const battle = await host.waitFor('battleStart', 10000);

    /*
      留出足够的时间：如果服务器还是"开战即结算"，这段时间里早就该收到
      battleEnd / 血量变化了。
    */
    await new Promise((resolve) => setTimeout(resolve, 800));

    expect(
      host.inboxAll().filter((m) => m.t === 'battleEnd'),
      '战斗还没看完就发了 battleEnd（结果泄漏）',
    ).toHaveLength(0);
    expect(host.inboxAll().filter((m) => m.t === 'playerEliminated')).toHaveLength(0);
    // 房间广播（玩家列表就是读它）里的血量也必须还是战前的
    for (const message of host.inboxAll()) {
      if (message.t !== 'room') continue;
      for (const player of message.room.players) {
        expect(player.hp, '开战瞬间房间广播里的血量就变了').toBe(100);
      }
    }

    // 两个人都举手"我看完了" —— 这时候才该结算
    await ackPlayback([host, guest]);
    const end = await host.waitFor('battleEnd', 10000);
    expect(end.battleId).toBe(battle.battleId);

    if (end.winner !== null) {
      const settled = await host.waitFor('room', 10000, (m) =>
        m.room.players.some((p) => p.hp < 100),
      );
      expect(settled.room.players.some((p) => p.hp < 100), '看完之后该扣血了').toBe(true);
    }

    host.close();
    guest.close();
  });

  it('服务器拒绝非法阵容（越界站位 / 重复占格 / 未知棋子 / 星级越界）', async () => {
    const host = new TestClient(port);
    const guest = new TestClient(port);
    await host.ready();
    await guest.ready();
    host.send({ t: 'createRoom', playerName: '房主', version: SERVER_VERSION });
    const room = await host.waitFor('room');
    guest.send({ t: 'joinRoom', roomCode: room.room.code, playerName: '朋友', version: SERVER_VERSION });
    await host.waitFor('room', 5000, (m) => m.room.players.length === 2);
    // 非房主先点「准备好了」——服务器要求全员准备后房主才能开局
    guest.send({ t: 'setReady', ready: true });
    await host.waitFor('room', 5000, (m) => m.room.players.some((p) => p.ready));
    host.send({ t: 'updateSettings', settings: { covenants: false } });
    host.send({ t: 'startGame' });
    await host.waitFor('gameStarted');

    // 越界：摆到对方半场（col 7）
    host.clear();
    host.send({ t: 'submitTeam', units: [{ defId: 'knight', star: 1, cell: { col: 7, row: 0 } }] });
    expect((await host.waitFor('error')).code).toBe('BAD_TEAM');

    // 重复占格
    host.clear();
    host.send({
      t: 'submitTeam',
      units: [
        { defId: 'knight', star: 1, cell: { col: 1, row: 1 } },
        { defId: 'archer', star: 1, cell: { col: 1, row: 1 } },
      ],
    });
    expect((await host.waitFor('error')).code).toBe('BAD_TEAM');

    // 未知棋子
    host.clear();
    host.send({ t: 'submitTeam', units: [{ defId: '不存在的棋子', star: 1, cell: { col: 1, row: 1 } }] });
    expect((await host.waitFor('error')).code).toBe('BAD_TEAM');

    // 星级越界（有人改请求想摆 9 星）
    host.clear();
    host.send({ t: 'submitTeam', units: [{ defId: 'knight', star: 9, cell: { col: 1, row: 1 } }] });
    expect((await host.waitFor('error')).code).toBe('BAD_TEAM');

    // 人口超限（想摆 21 个）
    host.clear();
    const many: UnitPlacement[] = [];
    for (let row = 0; row < 6 && many.length < 21; row++) {
      for (let col = 0; col <= 3 && many.length < 21; col++) {
        many.push({ defId: 'knight', star: 1, cell: { col, row } });
      }
    }
    host.send({ t: 'submitTeam', units: many });
    expect((await host.waitFor('error')).code).toBe('BAD_TEAM');

    host.close();
    guest.close();
  });

  it('掉线的人离开后，房间状态会广播给剩下的人', async () => {
    const host = new TestClient(port);
    const guest = new TestClient(port);
    await host.ready();
    await guest.ready();
    host.send({ t: 'createRoom', playerName: '房主', version: SERVER_VERSION });
    const room = await host.waitFor('room');
    guest.send({ t: 'joinRoom', roomCode: room.room.code, playerName: '朋友', version: SERVER_VERSION });
    await host.waitFor('room', 5000, (m) => m.room.players.length === 2);

    guest.close();
    const shrunk = await host.waitFor('room', 5000, (m) => m.room.players.length === 1);
    expect(shrunk.room.players).toHaveLength(1);

    host.close();
  });

  it('心跳：ping 得到 pong', async () => {
    const client = new TestClient(port);
    await client.ready();
    client.send({ t: 'ping' });
    const pong = await client.waitFor('pong');
    expect(pong.serverTime).toBeGreaterThan(0);
    client.close();
  });

  /**
   * ★ 商店"预定"（你报的第 11 条）：
   *   摆在我商店里、还没买的牌，别人刷新时不该再抽到。
   *   只有我刷新商店（或者买走）之后，牌才会放回池子。
   *
   * 【为什么必须在服务端测？】
   * 因为"谁占着哪几张"这件事只有服务器知道 ——
   * 8 个人各刷各的商店，客户端之间互相看不见。
   */
  it('★ 我商店里的牌会被"预定"，别人那边看到的是被扣掉之后的牌库', async () => {
    const host = new TestClient(port);
    const guest = new TestClient(port);
    await host.ready();
    await guest.ready();
    // 买牌要等到开局之后才被允许，所以这里把前置流程走完
    await setupStartedRoom(host, guest);

    const ids = Object.keys(UNIT_DEFS).sort();
    const first = ids[0]!;
    const second = ids[1]!;
    const third = ids[2]!;

    // 房主上报"我商店里摆着这两张"
    guest.clear();
    host.send({ t: 'shopUpdate', defIds: [first, second] });
    const pool = await guest.waitFor('pool', 5000, (m) => (m.held?.[first] ?? []).length > 0);
    expect(pool.held?.[first], '第一张应该记在房主名下').toEqual([host.playerId]);
    expect(pool.held?.[second], '第二张也记在房主名下').toEqual([host.playerId]);
    // 牌库本身没有变少：那两张只是"被占着"，还没被买走
    expect(pool.remaining[first]).toBeGreaterThan(0);
    const stockBeforeBuy = pool.remaining[third]!;

    // 房主刷新商店 -> 换了另一批牌 -> 预定释放，朋友应该能重新刷到那两张
    guest.clear();
    host.send({ t: 'shopUpdate', defIds: [third] });
    const released = await guest.waitFor('pool', 5000, (m) => !(m.held?.[first] ?? []).length);
    expect(released.held?.[first], '刷新之后原来的预定应该没了').toBeUndefined();
    expect(released.held?.[third], '新的那一张应该被记上').toEqual([host.playerId]);

    // 买走之后牌从"预定"变成"真的被扣掉"：预定消失 + 剩余张数 -1
    host.send({ t: 'buyCard', defId: third });
    const bought = await host.waitFor('buyResult', 5000, (m) => m.ok && m.defId === third);
    expect(bought.ok).toBe(true);

    guest.clear();
    // 客户端买完之后会重报一次商店（那张牌已经被拿走，不再占位）
    host.send({ t: 'shopUpdate', defIds: [] });
    const afterBuy = await guest.waitFor('pool', 5000, (m) => m.remaining[third] === stockBeforeBuy - 1);
    expect(afterBuy.remaining[third], '买走之后牌库真的要少一张').toBe(stockBeforeBuy - 1);
    expect(afterBuy.held?.[third], '买走了就不该再算"被占着"').toBeUndefined();

    host.close();
    guest.close();
  });

  it('★ 新回合开始时预定会被清空（离线玩家不会重报，否则牌会永远卡住）', async () => {
    const host = new TestClient(port);
    const guest = new TestClient(port);
    await host.ready();
    await guest.ready();

    host.send({ t: 'createRoom', playerName: '房主', version: SERVER_VERSION });
    const room = await host.waitFor('room');
    guest.send({ t: 'joinRoom', roomCode: room.room.code, playerName: '朋友', version: SERVER_VERSION });
    await host.waitFor('room', 5000, (m) => m.room.players.length === 2);

    const ids = Object.keys(UNIT_DEFS).sort();
    host.send({ t: 'shopUpdate', defIds: [ids[0]!] });
    await host.waitFor('pool', 5000, (m) => (m.held?.[ids[0]!] ?? []).length > 0);

    guest.send({ t: 'setReady', ready: true });
    await host.waitFor('room', 5000, (m) => m.room.players.some((p) => p.ready));
    host.clear();
    host.send({ t: 'updateSettings', settings: { covenants: false } });
    host.send({ t: 'startGame' });

    // 进入新回合时所有人的商店都会重发，服务器先把旧的预定清掉
    const fresh = await host.waitFor('pool', 8000, (m) => m.held !== undefined);
    expect(Object.keys(fresh.held ?? {}), '新回合的预定表应该是空的（客户端会重新上报）').toHaveLength(0);

    host.close();
    guest.close();
  });

  it('★ 战斗广播带上了双方玩家 id，客户端才能判断「这场有没有我」和「我在哪边」', async () => {
    const host = new TestClient(port);
    const guest = new TestClient(port);
    await host.ready();
    await guest.ready();

    host.send({ t: 'createRoom', playerName: '房主', version: SERVER_VERSION });
    const room = await host.waitFor('room');
    guest.send({ t: 'joinRoom', roomCode: room.room.code, playerName: '朋友', version: SERVER_VERSION });
    await host.waitFor('room', 5000, (m) => m.room.players.length === 2);
    // 非房主先点「准备好了」——服务器要求全员准备后房主才能开局
    guest.send({ t: 'setReady', ready: true });
    await host.waitFor('room', 5000, (m) => m.room.players.some((p) => p.ready));
    host.send({ t: 'updateSettings', settings: { covenants: false } });
    host.send({ t: 'startGame' });
    await host.waitFor('gameStarted');

    host.send({ t: 'submitTeam', units: testTeam() });
    guest.send({ t: 'submitTeam', units: testTeam() });

    const battle = await host.waitFor('battleStart', 10000);

    // 这两个字段必须都在，而且互不相同，合起来正好是房间里的两个人
    expect(battle.team0PlayerId).toBeTruthy();
    expect(battle.team1PlayerId).toBeTruthy();
    expect(battle.team0PlayerId).not.toBe(battle.team1PlayerId);
    expect([host.playerId, guest.playerId].sort()).toEqual(
      [battle.team0PlayerId, battle.team1PlayerId].sort(),
    );

    // 客户端据此算「我是不是参战方」和「要不要翻转视角」
    const meIsTeam0 = battle.team0PlayerId === host.playerId;
    const meIsTeam1 = battle.team1PlayerId === host.playerId;
    expect(meIsTeam0 || meIsTeam1).toBe(true);
    // 两个人里有且只有一个是队伍 0
    expect(meIsTeam0 && meIsTeam1).toBe(false);

    // 队伍 0 的干员在左半边、队伍 1 在右半边 —— 这是镜像逻辑的关键验证。
    // 边界必须从常量取，不能写死数字（写死的话改棋盘尺寸就会静默失效）
    for (const unit of battle.team0.units) {
      expect(unit.cell.col).toBeLessThanOrEqual(TEAM_0_MAX_COL);
    }
    for (const unit of battle.team1.units) {
      expect(unit.cell.col).toBeGreaterThanOrEqual(TEAM_1_MIN_COL);
    }

    // 而且校验和依然一致（镜像没有破坏确定性）
    const replay = simulate(UNIT_DEFS, [battle.team0, battle.team1], battle.seed);
    expect(replay.checksum).toBe(battle.expectedChecksum);

    host.close();
    guest.close();
  });

  it('准备阶段会广播剩余秒数', async () => {
    const host = new TestClient(port);
    const guest = new TestClient(port);
    await host.ready();
    await guest.ready();
    host.send({ t: 'createRoom', playerName: '房主', version: SERVER_VERSION });
    const room = await host.waitFor('room');
    guest.send({ t: 'joinRoom', roomCode: room.room.code, playerName: '朋友', version: SERVER_VERSION });
    await host.waitFor('room', 5000, (m) => m.room.players.length === 2);
    // 非房主先点「准备好了」——服务器要求全员准备后房主才能开局
    guest.send({ t: 'setReady', ready: true });
    await host.waitFor('room', 5000, (m) => m.room.players.some((p) => p.ready));
    host.send({ t: 'updateSettings', settings: { covenants: false } });
    host.send({ t: 'startGame' });

    const tick = await host.waitFor('prepTick', 8000);
    expect(tick.secondsLeft).toBeGreaterThan(0);
    // 上限用"配置的布阵时长"，不写死 30 —— 测试里把它调成了 4 秒
    expect(tick.secondsLeft).toBeLessThanOrEqual(TEST_PREP_SECONDS);

    host.close();
    guest.close();
  });

  it('房间状态里带准备阶段剩余秒数（客户端一进来就能显示倒计时）', async () => {
    const host = new TestClient(port);
    const guest = new TestClient(port);
    await host.ready();
    await guest.ready();
    host.send({ t: 'createRoom', playerName: '房主', version: SERVER_VERSION });
    const room = await host.waitFor('room');
    // 大厅阶段倒计时是 0
    expect(room.room.prepSecondsLeft).toBe(0);

    guest.send({ t: 'joinRoom', roomCode: room.room.code, playerName: '朋友', version: SERVER_VERSION });
    await host.waitFor('room', 5000, (m) => m.room.players.length === 2);
    // 非房主先点「准备好了」——服务器要求全员准备后房主才能开局
    guest.send({ t: 'setReady', ready: true });
    await host.waitFor('room', 5000, (m) => m.room.players.some((p) => p.ready));
    host.send({ t: 'updateSettings', settings: { covenants: false } });
    host.send({ t: 'startGame' });
    await host.waitFor('gameStarted');

    // 开局后房间广播里应该带上剩余秒数
    const inPrep = await host.waitFor('room', 8000, (m) => m.room.phase === 'prep');
    expect(inPrep.room.prepSecondsLeft).toBeGreaterThan(0);

    host.close();
    guest.close();
  });

  it('房主在有人没准备好时不能开始游戏', async () => {
    const host = new TestClient(port);
    const guest = new TestClient(port);
    await host.ready();
    await guest.ready();
    host.send({ t: 'createRoom', playerName: '房主', version: SERVER_VERSION });
    const room = await host.waitFor('room');
    guest.send({ t: 'joinRoom', roomCode: room.room.code, playerName: '朋友', version: SERVER_VERSION });
    await host.waitFor('room', 5000, (m) => m.room.players.length === 2);

    // 朋友还没点「准备好了」。按产品规则，房主现在不能开局 ——
    // 否则房主可能在别人还没连好、还没摆好阵容的时候就开打。
    host.send({ t: 'updateSettings', settings: { covenants: false } });
    host.send({ t: 'startGame' });
    const error = await host.waitFor('error');
    expect(error.code).toBe('PLAYERS_NOT_READY');
    expect(error.message).toContain('没准备好');

    // 朋友准备好之后就能开了
    guest.send({ t: 'setReady', ready: true });
    await host.waitFor('room', 5000, (m) => m.room.players.some((p) => p.ready));
    host.send({ t: 'updateSettings', settings: { covenants: false } });
    host.send({ t: 'startGame' });
    await host.waitFor('gameStarted', 8000);

    host.close();
    guest.close();
  });

  /**
   * ★ 这条测试原来叫「提交空阵容会被拒绝」，断言服务器回 EMPTY_TEAM 错误。
   *
   * 【为什么现在改成"接受"了？】
   * 因为布阵改成了 60 秒定时制、而且**删掉了提交按钮**：
   * 客户端现在是"每改一次阵容就静默同步一次"。
   * 玩家把场上棋子全收回备战席时会短暂出现空阵容 —— 那是完全正常的操作，
   * 服务器要是回一个错误，玩家会莫名其妙看到红字提示。
   *
   * 所以现在的规则是：空阵容**允许同步**（它只是一个中间状态），
   * 时间到了如果还是空的，那一场就当空阵打，输了也是自己的选择。
   */
  it('★ 空阵容现在会被接受（定时制 + 自动同步，空阵是正常的中间状态）', async () => {
    const host = new TestClient(port);
    const guest = new TestClient(port);
    await host.ready();
    await guest.ready();
    host.send({ t: 'createRoom', playerName: '房主', version: SERVER_VERSION });
    const room = await host.waitFor('room');
    guest.send({ t: 'joinRoom', roomCode: room.room.code, playerName: '朋友', version: SERVER_VERSION });
    await host.waitFor('room', 5000, (m) => m.room.players.length === 2);
    guest.send({ t: 'setReady', ready: true });
    await host.waitFor('room', 5000, (m) => m.room.players.some((p) => p.ready));
    host.send({ t: 'updateSettings', settings: { covenants: false } });
    host.send({ t: 'startGame' });
    await host.waitFor('gameStarted');

    host.clear();
    host.send({ t: 'submitTeam', units: [] });
    // 不应该收到任何错误
    await new Promise((resolve) => setTimeout(resolve, 400));
    const errors = host.inboxAll().filter((m) => m.t === 'error');
    expect(errors, `空阵容不该被当成错误：${JSON.stringify(errors)}`).toHaveLength(0);

    host.close();
    guest.close();
  });

  it('★ 站位非法的阵容仍然会被拒绝（空阵容放行，不等于什么都放行）', async () => {
    const host = new TestClient(port);
    const guest = new TestClient(port);
    await host.ready();
    await guest.ready();
    host.send({ t: 'createRoom', playerName: '房主', version: SERVER_VERSION });
    const room = await host.waitFor('room');
    guest.send({ t: 'joinRoom', roomCode: room.room.code, playerName: '朋友', version: SERVER_VERSION });
    await host.waitFor('room', 5000, (m) => m.room.players.length === 2);
    guest.send({ t: 'setReady', ready: true });
    await host.waitFor('room', 5000, (m) => m.room.players.some((p) => p.ready));
    host.send({ t: 'updateSettings', settings: { covenants: false } });
    host.send({ t: 'startGame' });
    await host.waitFor('gameStarted');

    // 放到对方半场（col 8）：服务端必须拦住
    host.send({
      t: 'submitTeam',
      units: [{ defId: Object.keys(UNIT_DEFS).sort()[0]!, star: 1, cell: { col: 8, row: 0 } }],
    });
    const error = await host.waitFor('error');
    expect(error.code).toBe('BAD_TEAM');

    host.close();
    guest.close();
  });

  it('★ 0.1.1：备战席会随阵容一起广播给房间（观战 / 淘汰回库都靠它）', async () => {
    const host = new TestClient(port);
    const guest = new TestClient(port);
    await host.ready();
    await guest.ready();
    await setupStartedRoom(host, guest);
    host.clear();
    guest.clear();

    /*
      ★ 这条测试值钱在"它抓过一个真 bug"：
      `submitTeam` 的处理器原来只挑了 units / sharedItems / playerContext 三个字段，
      新加的 bench 被**无声地丢在那一层** —— 观战看不到对方备战席、
      淘汰时手上的牌还不回牌库，两个功能都不生效而且不报任何错。
      （和当初 items 漏在同一层的 bug 一模一样。）
    */
    host.send({
      t: 'submitTeam',
      units: [{ defId: 'op03', star: 2, cell: { col: 0, row: 1 } }],
      bench: [
        { defId: 'op09', star: 2, copies: 3 },
        { defId: 'op13', star: 1, copies: 1 },
      ],
      playerContext: { gold: 12, hp: 100 },
    });

    const seen = await guest.waitFor(
      'prepTeams',
      5000,
      (m) => (m.teams[host.playerId]?.bench ?? []).length === 2,
    );
    expect(seen.teams[host.playerId]!.bench).toEqual([
      { defId: 'op09', star: 2, copies: 3 },
      { defId: 'op13', star: 1, copies: 1 },
    ]);
    expect(seen.teams[host.playerId]!.units).toHaveLength(1);

    // 乱填的星级 / 张数要被夹住 —— copies 最终喂给"还牌"，不夹就能把牌库刷爆
    host.send({
      t: 'submitTeam',
      units: [{ defId: 'op03', star: 2, cell: { col: 0, row: 1 } }],
      bench: [
        { defId: 'op09', star: 9, copies: 9999 },
        { defId: '这不是一个干员', star: 1, copies: 1 },
      ],
      playerContext: { gold: 12, hp: 100 },
    });
    const clamped = await guest.waitFor(
      'prepTeams',
      5000,
      (m) => (m.teams[host.playerId]?.bench ?? []).length === 1,
    );
    expect(clamped.teams[host.playerId]!.bench).toEqual([{ defId: 'op09', star: 3, copies: 9 }]);

    host.close();
    guest.close();
  });

  it('玩家战绩会被记录并广播', async () => {
    const host = new TestClient(port);
    const guest = new TestClient(port);
    await host.ready();
    await guest.ready();
    host.send({ t: 'createRoom', playerName: '房主', version: SERVER_VERSION });
    const room = await host.waitFor('room');
    guest.send({ t: 'joinRoom', roomCode: room.room.code, playerName: '朋友', version: SERVER_VERSION });
    await host.waitFor('room', 5000, (m) => m.room.players.length === 2);
    // 非房主先点「准备好了」——服务器要求全员准备后房主才能开局
    guest.send({ t: 'setReady', ready: true });
    await host.waitFor('room', 5000, (m) => m.room.players.some((p) => p.ready));
    host.send({ t: 'updateSettings', settings: { covenants: false } });
    host.send({ t: 'startGame' });
    await host.waitFor('gameStarted');

    // 一开始战绩是 0:0
    const initial = await host.waitFor('room', 5000, (m) => m.room.phase === 'prep');
    for (const player of initial.room.players) {
      expect(player.wins).toBe(0);
      expect(player.losses).toBe(0);
    }

    host.send({ t: 'submitTeam', units: testTeam() });
    guest.send({ t: 'submitTeam', units: testTeam() });

    const battle = await host.waitFor('battleStart', 10000);
    // ★ 0.0.3：先举手，服务器才会结算并广播 battleEnd
    await ackPlayback([host, guest]);
    const end = await host.waitFor('battleEnd', 10000);
    expect(end.battleId).toBe(battle.battleId);

    // 战斗结束后，房间状态里应该有人多了一场胜或负
    const afterBattle = await host.waitFor('room', 10000, (m) =>
      m.room.players.some((p) => p.wins > 0 || p.losses > 0),
    );
    const totalGames = afterBattle.room.players.reduce((sum, p) => sum + p.wins + p.losses, 0);
    // 一场战斗要么一人胜、要么平局（双方都不记）；平局时不做断言
    if (end.winner !== null) {
      expect(totalGames).toBeGreaterThanOrEqual(1);
    }

    host.close();
    guest.close();
  });

  it('★ 0.1.1 真打到对局结束：gameOver 带着完整结算数据（排名 / 阵容 / 羁绊 / 最高伤害）', async () => {
    /*
      ★ 怎么做到"一回合就分出胜负"？
      `damageForRound(r) = 3 * ceil(r / 5)`，而起始回合可以用环境变量顶上去。
      把房间直接开到第 166 回合 -> 每回合伤害 102 > 100 血 ⇒ 输一场即淘汰，
      于是**一场战斗就打完整局**（不然要真打二十多回合，端到端测试根本没法跑）。
      ★ `startingRound()` 是**建 Room 那一刻**读的，所以在这里临时改环境变量有效。
    */
    const prev = process.env.AIRNIGHT_START_ROUND;
    process.env.AIRNIGHT_START_ROUND = '166';
    try {
      const host = new TestClient(port);
      const guest = new TestClient(port);
      await host.ready();
      await guest.ready();
      await setupStartedRoom(host, guest);

      // 房主 5 个 3 星 vs 客人 1 个 1 星 —— 胜负没有悬念
      const strong: UnitPlacement[] = ['op01', 'op03', 'op09', 'op16', 'op27'].map((defId, index) => ({
        defId,
        star: 3,
        cell: { col: index % 5, row: index % 10 },
      }));
      const weak: UnitPlacement[] = [{ defId: 'op02', star: 1, cell: { col: 0, row: 0 } }];
      host.send({ t: 'submitTeam', units: strong, playerContext: { gold: 10, hp: 100 } });
      guest.send({ t: 'submitTeam', units: weak, playerContext: { gold: 10, hp: 100 } });
      await new Promise((r) => setTimeout(r, 300));

      // 两个人都"看完"才结算（0.0.3 起结算推迟到全员回执之后）
      await ackPlayback([host, guest]);

      const over = await host.waitFor('gameOver', 25000);
      expect(over.standings, 'gameOver 必须带上结算数据').toHaveLength(2);

      const winner = over.standings.find((s) => s.playerId === over.winnerId)!;
      const loser = over.standings.find((s) => s.playerId !== over.winnerId)!;
      expect(winner.rank).toBe(1);
      expect(winner.eliminatedRound, '冠军没被淘汰过').toBeNull();
      expect(loser.rank).toBe(2);
      expect(loser.hp).toBe(0);
      expect(loser.eliminatedRound, '第 166 回合被打出局').toBe(166);

      // 死亡时的阵容 == 他最后提交的那一份（深拷：还牌会把 player.team 清掉）
      expect(loser.lineup.map((u) => u.defId)).toEqual(weak.map((u) => u.defId));
      expect(winner.lineup.map((u) => u.defId).sort()).toEqual(strong.map((u) => u.defId).sort());
      // 阵容必须按费用从低到高排好（结算页的展示规则在服务器定死）
      const costs = winner.lineup.map((u) => UNIT_DEFS[u.defId]!.cost);
      expect(costs).toEqual([...costs].sort((a, b) => a - b));
      // 冠军队的每个干员星级都还在
      expect(winner.lineup.every((u) => u.star === 3)).toBe(true);

      // 5 个 3 星打 1 个 1 星：赢家必然打出过伤害
      expect(winner.totalDamage, '赢家应该打出过伤害').toBeGreaterThan(0);
      expect(winner.topUnit, '有伤害就该挑得出最高的一位').not.toBeNull();
      expect(strong.map((u) => u.defId)).toContain(winner.topUnit!.defId);

      host.close();
      guest.close();
    } finally {
      if (prev === undefined) delete process.env.AIRNIGHT_START_ROUND;
      else process.env.AIRNIGHT_START_ROUND = prev;
    }
  }, 40000);

  /**
   * ★ 0.1.1：房主的两个"管人"操作（踢人 / 改昵称）。
   *
   * 【为什么权限必须端到端测？】
   * 因为客户端的"只有房主看得到按钮"**不是权限** —— 任何人手写一条消息就能发。
   * 真正拦住越权的是服务端那两行判断，所以这里用"普通玩家直接发消息"来验。
   */
  it('★ 0.1.1 房主踢人：被踢的人收到 kicked 并被移出房间', async () => {
    const host = new TestClient(port);
    const guest = new TestClient(port);
    await host.ready();
    await guest.ready();
    host.send({ t: 'createRoom', playerName: '房主', version: SERVER_VERSION });
    const room = await host.waitFor('room');
    guest.send({ t: 'joinRoom', roomCode: room.room.code, playerName: '朋友', version: SERVER_VERSION });
    await host.waitFor('room', 5000, (m) => m.room.players.length === 2);

    host.send({ t: 'kickPlayer', playerId: guest.playerId });

    // 被踢的人要收到通知（客户端收到它才会退出房间回主界面）
    const kicked = await guest.waitFor('kicked');
    expect(kicked.reason).toContain('房主');
    // 房主这边：房间里只剩他自己
    const after = await host.waitFor('room', 5000, (m) => m.room.players.length === 1);
    expect(after.room.players[0]!.id).toBe(host.playerId);

    host.close();
    guest.close();
  });

  it('★ 0.1.1 普通玩家不能踢人、也不能改别人昵称（服务端自己验权限）', async () => {
    const host = new TestClient(port);
    const guest = new TestClient(port);
    await host.ready();
    await guest.ready();
    host.send({ t: 'createRoom', playerName: '房主', version: SERVER_VERSION });
    const room = await host.waitFor('room');
    guest.send({ t: 'joinRoom', roomCode: room.room.code, playerName: '朋友', version: SERVER_VERSION });
    await host.waitFor('room', 5000, (m) => m.room.players.length === 2);

    guest.send({ t: 'kickPlayer', playerId: host.playerId });
    const kickError = await guest.waitFor('error', 5000, (m) => m.code === 'NOT_HOST');
    expect(kickError.message).toContain('房主');

    guest.send({ t: 'renamePlayer', playerId: host.playerId, name: '我说了算' });
    const renameError = await guest.waitFor('error', 5000, (m) => m.code === 'NOT_HOST');
    expect(renameError.message).toContain('房主');

    // 房间状态没有被改（房主还在、名字也没变）
    const still = await host.waitFor('room', 5000, (m) => m.room.players.length === 2);
    // ★ 别用 sort 比中文名：JS 的默认排序按 UTF-16 码元，顺序没有直觉意义
    expect(new Set(still.room.players.map((p) => p.name))).toEqual(new Set(['朋友', '房主']));

    host.close();
    guest.close();
  });

  it('★ 0.3 房主改昵称：广播给全房间，并且和建房走**同一套**校验', async () => {
    const host = new TestClient(port);
    const guest = new TestClient(port);
    await host.ready();
    await guest.ready();
    host.send({ t: 'createRoom', playerName: '房主', version: SERVER_VERSION });
    const room = await host.waitFor('room');
    guest.send({ t: 'joinRoom', roomCode: room.room.code, playerName: '朋友', version: SERVER_VERSION });
    await host.waitFor('room', 5000, (m) => m.room.players.length === 2);

    host.send({ t: 'renamePlayer', playerId: guest.playerId, name: '  小红  ' });
    const renamed = await host.waitFor('room', 5000, (m) =>
      m.room.players.some((p) => p.name === '小红'),
    );
    expect(renamed.room.players.find((p) => p.id === guest.playerId)!.name, '两边要去掉空白').toBe('小红');
    // 被改的人自己也要收到（不然他那边还显示旧名字）
    const seen = await guest.waitFor('room', 5000, (m) => m.room.players.some((p) => p.name === '小红'));
    expect(seen.room.players.find((p) => p.id === guest.playerId)!.name).toBe('小红');

    /*
      ★ 0.3：白名单之外的字符被洗掉（尖括号最容易伪造出「[系统]」那种假标签），
      而 `?` 属于"常用符号"，保留。改名不是绕过校验的后门 —— 它和建房走的是同一个函数。
    */
    host.send({ t: 'renamePlayer', playerId: guest.playerId, name: '<script>??' });
    const cleaned = await host.waitFor('room', 5000, (m) =>
      m.room.players.some((p) => p.name === 'script??'),
    );
    expect(cleaned.room.players.find((p) => p.id === guest.playerId)!.name).toBe('script??');

    /*
      ★ 0.3 行为变化：空名字**不再**被静默兜底成「无名玩家」。
      以前是"洗成空就换个名字"，玩家会莫名其妙被改名、还不知道为什么；
      现在明确拒绝（BAD_NAME），名字保持原样。
    */
    host.send({ t: 'renamePlayer', playerId: guest.playerId, name: '   ' });
    const rejected = await host.waitFor('error', 5000, (m) => m.code === 'BAD_NAME');
    expect(rejected.message).toContain('昵称不能是空的');
    // 名字没被改掉
    /*
      ★ 先清空收件箱再收：`waitFor` 会**从最旧的开始**找，
      不清的话这里会拿到"刚进房时"那份房间（那时名字还是「朋友」），断言就成了假的。
    */
    host.clear();
    host.send({ t: 'playerStats', level: 1, streak: 0 });
    const still = await host.waitFor('room', 5000, (m) =>
      m.room.players.some((p) => p.id === guest.playerId),
    );
    expect(still.room.players.find((p) => p.id === guest.playerId)!.name, '被拒之后名字要原样留着').toBe(
      'script??',
    );

    host.close();
    guest.close();
  });

  /*
    ★★ 0.3 房间里不允许重名。
    这里要同时守住三件事：
      1. 同名进房被拒（NAME_TAKEN），而且**那个人没进房**；
      2. 归一化之后同名也算撞（大小写 / 全角半角）；
      3. 房主改名**不能改成已有的名字**，但改成自己的名字不算撞（要排除自己）。
  */
  it('★ 0.3 重名拦截：同名 / 大小写 / 全角 都算撞，改名撞名也被拒', async () => {
    const host = new TestClient(port);
    await host.ready();
    host.send({ t: 'createRoom', playerName: 'Alice99', version: SERVER_VERSION });
    const room = await host.waitFor('room');
    const code = room.room.code;

    /*
      ★ 进房的 socket **不能在 tryJoin 里关掉**：大厅里一断开座位就没了
      （后面的"房间里现在有几个人"会当场少一个）。所以这里把成功的那个客户端留着，最后一起关。
    */
    const alive: TestClient[] = [];

    /** 用某个名字进房，返回收到的 error（没报错就返回 null，并把连接留在大厅里） */
    const tryJoin = async (name: string): Promise<{ code: string; message: string } | null> => {
      const client = new TestClient(port);
      alive.push(client);
      await client.ready();
      client.send({ t: 'joinRoom', roomCode: code, playerName: name, version: SERVER_VERSION });
      return Promise.race([
        client.waitFor('error', 3000).then((m) => ({ code: m.code, message: m.message })),
        client.waitFor('room', 3000, (m) => m.room.players.length >= 2).then(() => null),
      ]);
    };

    // 1) 完全同名
    const exact = await tryJoin('Alice99');
    expect(exact?.code, '同名必须被拒').toBe('NAME_TAKEN');

    // 2) 大小写不同 —— 玩家眼里这就是同一个人
    const lower = await tryJoin('alice99');
    expect(lower?.code, '大小写不同也算撞').toBe('NAME_TAKEN');

    // 3) 全角字母 —— NFKC 归一之后和半角一样
    const wide = await tryJoin('Ａlice99');
    expect(wide?.code, '全角字母也算撞').toBe('NAME_TAKEN');

    // 4) 对照组：真的不同的名字要能进（证明上面不是因为"什么都拒"）
    const ok = await tryJoin('Bob77');
    expect(ok, '不同名字应该能正常进房').toBeNull();

    // 5) 被拒的人不能占座位：房间里现在只有 host + Bob77
    host.send({ t: 'playerStats', level: 1, streak: 0 });
    // 必须带上谓词：缓冲里还有创建房间时那份 1 人房间，裸取会拿到它
    const after = await host.waitFor('room', 5000, (m) =>
      m.room.players.some((p) => p.name === 'Bob77'),
    );
    expect(after.room.players.length, '被拒的人不能占座位').toBe(2);

    // 6) 房主改名撞名 -> NAME_TAKEN
    const bob = after.room.players.find((p) => p.name === 'Bob77')!;
    host.send({ t: 'renamePlayer', playerId: bob.id, name: 'Alice99' });
    const renameTaken = await host.waitFor('error', 5000);
    expect(renameTaken.code).toBe('NAME_TAKEN');

    // 7) 改成自己原来的名字不算撞（重名比对必须排除自己）
    host.send({ t: 'renamePlayer', playerId: bob.id, name: 'Bob77' });
    const self = await host.waitFor('room', 5000, (m) =>
      m.room.players.some((p) => p.id === bob.id && p.name === 'Bob77'),
    );
    expect(self.room.players.find((p) => p.id === bob.id)!.name).toBe('Bob77');

    host.close();
    for (const client of alive) client.close();
  });

  /*
    ★★ 0.3 房间设置：房主能改、别人不能改、服务端会夹范围。

    这一条要守住的是**权限和裁决都在服务端** ——
    客户端藏按钮只是"不给别人看到"，抓包发一条 updateSettings 照样能到这儿。
  */
  /*
    ★★ 0.3 盟约选秀（端到端）。

    守四件事：
      1. 房主点开始 -> **不再直接进布阵**，而是先进 covenant 阶段；
      2. 只有"现在轮到的那个人"能选，别人选会被拒（还没轮到你）；
      3. 已经被选走的不能再选（先点的人赢）；
      4. 全员选完之后，才真正进第一回合。
  */
  it('★ 0.3 盟约选秀：先进选秀页，轮流选，选完才开局', async () => {
    const host = new TestClient(port);
    const guest = new TestClient(port);
    await host.ready();
    await guest.ready();

    host.send({ t: 'createRoom', playerName: '房主甲', version: SERVER_VERSION });
    const created = await host.waitFor('room');
    guest.send({ t: 'joinRoom', roomCode: created.room.code, playerName: '朋友乙', version: SERVER_VERSION });
    await host.waitFor('room', 5000, (m) => m.room.players.length === 2);
    guest.send({ t: 'setReady', ready: true });
    await host.waitFor('room', 5000, (m) => m.room.players.some((p) => p.id === guest.playerId && p.ready));

    host.clear();
    // ★ 这条测的就是盟约流程本身 —— 把开关显式打开（正则批量加那行时把它也关上了）
    host.send({ t: 'updateSettings', settings: { covenants: true } });
    host.send({ t: 'startGame' });
    const drafting = await host.waitFor('room', 5000, (m) => m.room.phase === 'covenant');
    expect(drafting.room.covenant, '选秀阶段必须带 covenant 进度').toBeDefined();
    expect(drafting.room.covenant!.total, '两个人各选一次').toBe(2);
    expect(drafting.room.covenant!.remaining).toBe(2);
    // ★ 顺序不公开：广播里只有"现在轮到谁"，没有完整序列
    expect(Object.keys(drafting.room.covenant!).sort()).toEqual(
      ['currentPlayerId', 'remaining', 'secondsLeft', 'total'].sort(),
    );

    /** pid -> 客户端 */
    const clients: Record<string, TestClient> = {
      [host.playerId]: host,
      [guest.playerId]: guest,
    };
    const picked: string[] = [];

    for (let step = 0; step < 2; step++) {
      host.clear();
      host.send({ t: 'playerStats', level: 1, streak: 0 });
      const snapshot = await host.waitFor('room', 5000, (m) => m.room.phase === 'covenant');
      const currentId = snapshot.room.covenant!.currentPlayerId;
      expect(clients[currentId], '轮到的人必须是房间里的玩家').toBeDefined();

      // ★ 不是自己轮到时选 -> 被拒
      const other = Object.keys(clients).find((id) => id !== currentId)!;
      const otherClient = clients[other]!;
      otherClient.clear();
      otherClient.send({ t: 'pickCovenant', covenantId: 'cv_golia' });
      const rejected = await otherClient.waitFor('error', 5000);
      expect(rejected.code).toBe('COVENANT_REJECTED');
      expect(rejected.message).toContain('还没轮到');

      // 轮到的这个人选一个"还没人要的"
      const pick = step === 0 ? 'cv_golia' : 'cv_laoli';
      expect(picked).not.toContain(pick);
      picked.push(pick);
      const picker = clients[currentId]!;
      picker.clear();
      picker.send({ t: 'pickCovenant', covenantId: pick });
      const after = await picker.waitFor('room', 5000, (m) =>
        m.room.players.some((p) => p.id === currentId && p.covenantId === pick),
      );
      // 已经选走的那张，别人身上不能出现同一张
      const ids = after.room.players.map((p) => p.covenantId).filter(Boolean);
      expect(new Set(ids).size, '同一张盟约不能被两个人拿到').toBe(ids.length);
    }

    // ★ 全员选完 -> 退出选秀，进第一回合
    const started = await host.waitFor('room', 5000, (m) => m.room.phase !== 'covenant');
    expect(['prep', 'shop']).toContain(started.room.phase);
    expect(started.room.covenant, '开局之后不再带选秀进度').toBeUndefined();
    // 两个人都拿到了盟约
    const assigned = started.room.players.filter((p) => p.covenantId).map((p) => p.covenantId);
    expect(assigned.sort()).toEqual(picked.sort());

    host.close();
    guest.close();
  });

  it('★ 0.3 房间设置：房主能改、别人被拒、越界被夹', async () => {
    const host = new TestClient(port);
    const guest = new TestClient(port);
    await host.ready();
    await guest.ready();

    host.send({ t: 'createRoom', playerName: '房主甲', version: SERVER_VERSION });
    const created = await host.waitFor('room');
    expect(created.room.settings, '新房间必须是默认设置').toBeDefined();
    expect(created.room.settings.startHp).toBe(100);
    expect(created.room.settings.shopRound).toBe(true);

    guest.send({ t: 'joinRoom', roomCode: created.room.code, playerName: '朋友乙', version: SERVER_VERSION });
    await host.waitFor('room', 5000, (m) => m.room.players.length === 2);

    // 1) 房主改 -> 全房间都要收到新值（不是只回给房主一个人）
    host.send({
      t: 'updateSettings',
      settings: { startHp: 5000, startGold: 40, incomeBase: 25, prepSeconds: 200, shopRound: false },
    });
    const applied = await guest.waitFor('room', 5000, (m) => m.room.settings.startHp === 5000);
    expect(applied.room.settings.startGold).toBe(40);
    expect(applied.room.settings.incomeBase).toBe(25);
    expect(applied.room.settings.prepSeconds).toBe(200);
    expect(applied.room.settings.shopRound).toBe(false);

    // 2) 越界：服务端自己夹（客户端 UI 上的 min/max 不是防线）
    host.clear();
    host.send({ t: 'updateSettings', settings: { startHp: 1e9, prepSeconds: -5, incomeBase: 999 } });
    const clamped = await host.waitFor(
      'room',
      5000,
      (m) => m.room.settings.startHp === 100000,
    );
    expect(clamped.room.settings.prepSeconds, '布阵时间下限 10 秒').toBe(10);
    expect(clamped.room.settings.incomeBase, '每回合收入上限 100').toBe(100);

    // 3) 非房主改 -> NOT_HOST，而且设置一点都没动
    host.clear();
    guest.send({ t: 'updateSettings', settings: { startHp: 42 } });
    const denied = await guest.waitFor('error', 5000);
    expect(denied.code).toBe('NOT_HOST');
    // 同样要先清收件箱：不清会拿到"刚进房时"那份（那时 startHp 还是 100）
    guest.clear();
    guest.send({ t: 'playerStats', level: 1, streak: 0 });
    const unchanged = await guest.waitFor('room', 5000, (m) => m.room.players.length === 2);
    expect(unchanged.room.settings.startHp, '被拒之后设置不能变').toBe(100000);

    host.close();
    guest.close();
  });

  it('★ 0.3 昵称长度：1 个字被拒，9 个字被截到 8 个', async () => {
    const client = new TestClient(port);
    await client.ready();

    client.send({ t: 'createRoom', playerName: '甲', version: SERVER_VERSION });
    const tooShort = await client.waitFor('error', 5000);
    expect(tooShort.code).toBe('BAD_NAME');
    expect(tooShort.message).toContain('至少');

    // 超长的走"截断"而不是报错：客户端输入框有 maxlength=8，
    // 能发 9 个字上来的只有构造出来的包 —— 截断即可，不必为他写一条错误文案。
    client.send({ t: 'createRoom', playerName: '一二三四五六七八九', version: SERVER_VERSION });
    const ok = await client.waitFor('room', 5000);
    expect(ok.room.players[0]!.name).toBe('一二三四五六七八');

    client.close();
  });

  it('★ 0.1.1 对局已经开始就不能踢人 / 改名（按钮只在大厅里，服务端也照着挡）', async () => {
    const host = new TestClient(port);
    const guest = new TestClient(port);
    await host.ready();
    await guest.ready();
    await setupStartedRoom(host, guest);

    host.send({ t: 'kickPlayer', playerId: guest.playerId });
    const kickError = await host.waitFor('error', 5000, (m) => m.code === 'WRONG_PHASE');
    expect(kickError.message).toContain('已经开始');

    host.send({ t: 'renamePlayer', playerId: guest.playerId, name: '赛后改名' });
    await host.waitFor('error', 5000, (m) => m.code === 'WRONG_PHASE');

    host.close();
    guest.close();
  });
});

/**
 * 「下一回合等多久」这条规则的测试。
 *
 * 【为什么要单独抽出来测？】
 * 因为它修的是一个**很严重但很隐蔽**的 bug：原来这里写死 3 秒，
 * 而一场战斗实际要打 10~75 秒。结果客户端收到下一回合的通知时，
 * 正在播的战斗被直接清掉、拉回布阵 —— **玩家永远看不到自己的战斗结果**。
 * 连接、房间、校验和全都是好的，就是"对局没法正常进行"。
 *
 * 这类 bug 用端到端测试去抓要真等十几秒、还依赖定时器，很脆。
 * 抽成纯函数之后，毫秒级的断言就能把**不变量**钉死。
 */
describe('战斗播完之后等多久才进下一回合', () => {
  it('★ 等待时间必须 ≥ 战斗时长（否则战斗会被截断）', () => {
    // 各种长度的战斗都试一遍
    for (const ticks of [0, 20, 100, 234, 800, 1500]) {
      const waitMs = battlePlaybackWaitMs(ticks);
      const battleMs = (ticks / 20) * 1000;
      expect(waitMs, `战斗 ${ticks} tick 时等待时间不够`).toBeGreaterThanOrEqual(battleMs);
    }
  });

  it('★ 一场 11.7 秒的战斗要等约 13.7 秒（不是固定 3 秒）', () => {
    // 234 tick = 11.7 秒，正好是复现脚本里那场 9v9 战斗的时长
    expect(battlePlaybackWaitMs(234)).toBe(13700);
  });

  it('还留了缓冲时间，让玩家看清结算画面', () => {
    // 0 tick（极端情况）也得等一会儿，不能瞬间跳走
    expect(battlePlaybackWaitMs(0)).toBe(2000);
  });

  it('上限 80 秒：打满 75 秒的僵持局也不会让所有人一直干等', () => {
    // 75 秒 = 1500 tick，按公式是 77000；再长也不会超过 80000
    expect(battlePlaybackWaitMs(1500)).toBe(77000);
    expect(battlePlaybackWaitMs(99999)).toBe(80000);
  });

  it('负数不会算出负的等待时间（防御性）', () => {
    expect(battlePlaybackWaitMs(-100)).toBe(2000);
  });
});

/**
 * 兜底超时：不能让一个挂机/切走标签页的人把整个房间永远卡住。
 *
 * 【为什么"等回执"还需要一个兜底？】
 * 两种客户端永远不会发 `playbackDone`：
 *   · 切到别的标签页/最小化了 —— 浏览器的 requestAnimationFrame 会被降频甚至暂停，
 *     战斗回放等于停住了，永远播不完；
 *   · 客户端版本太老，不认识这条消息。
 * 没有兜底的话，一个人在窗口外发呆，全房间就永远停在结算画面。
 *
 * 具体"没人举手时服务器会不会傻等"那条不变量，用真实连接测在
 * `playback-ack.test.ts` 里；这里只测时间常数本身。
 */
describe('等回执的兜底超时', () => {
  it('一定比"按战斗时长算出来的等待"更长（先给回执机会）', () => {
    for (const ticks of [0, 20, 100, 234, 800, 1500]) {
      expect(playbackFallbackMs(ticks)).toBeGreaterThan(battlePlaybackWaitMs(ticks));
    }
  });

  it('足够宽，让"机器慢一倍"的人也赶得上', () => {
    // 234 tick = 11.7 秒，慢一倍 = 23.4 秒，兜底必须大于它
    expect(playbackFallbackMs(234)).toBeGreaterThan(23400);
  });

  it('但也有上限，不会让人等几分钟', () => {
    expect(playbackFallbackMs(999999)).toBeLessThanOrEqual(180000);
  });
});
