/**
 * ============================================================
 *  ★★ 0.3.3 人机 —— 端到端：真的下一个房间、真的打几回合
 * ============================================================
 *
 * 【这份测试要证明的三件事】
 *   ① 房主加的人机**真的在玩**：它会买牌、摆位、提交阵容，
 *      而且提交上来的东西走的是和真人**同一条** `submitTeam`（能被观战看到）；
 *   ② 对局**不会被卡住**：人机会回 `playbackDone`，所以每回合按正常节奏推进，
 *      而不是等满兜底超时（那会让人以为"游戏卡死了"）；
 *   ③ 三档难度**真的不一样**：困难档会买经验，等级 / 上场人数明显盖过简单档。
 *
 * 【为什么用真服务器，而不是直接 new BotBrain()？】
 * 因为最容易坏的地方恰恰在"接线"：人机没进 `connections` -> 收不到广播；
 * 忘了发 `playbackDone` -> 整回合卡住；`submitTeam` 少带字段 -> 开打时是空阵。
 * 这些只有跑一整局才看得见。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket, type WebSocketServer } from 'ws';
import {
  SERVER_VERSION,
  decodeMessage,
  type ClientMessage,
  type RoomView,
  type ServerMessage,
} from '../../shared/src/index.js';

process.env.AIRNIGHT_NO_AUTOSTART = '1';
// 从第 3 回合开局：跳过前两回合的野怪，专心验"人机 vs 真人对打"这条链路
process.env.AIRNIGHT_START_ROUND = '3';
// 布阵 1 秒（否则每个回合要等一分钟）
process.env.AIRNIGHT_PREP_SECONDS = '1';
// ★ 人机的思考节奏压到 2%（否则一回合要等十几秒）
process.env.AIRNIGHT_BOT_SPEED = '0.02';

const { startServer } = await import('../src/main.js');

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
    const outgoing =
      message.t === 'createRoom' || message.t === 'joinRoom' ? { ...message, version: SERVER_VERSION } : message;
    this.socket.send(JSON.stringify(outgoing));
  }

  waitFor<T extends ServerMessage['t']>(
    type: T,
    timeoutMs = 15000,
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
   * 把收件箱清空。
   *
   * ★ 为什么必须要有它？`waitFor` 会**先翻收件箱**（这是为了让"消息先到、断言后到"
   *   也能通过）。但在一个循环里连着跑好几个回合时，那会导致第二次
   *   `waitFor('gameStarted')` 立刻拿到**第一回合**那条旧消息 ——
   *   循环看起来跑得飞快，其实一回合都没推进（我第一次写这测试就是这么翻车的）。
   */
  drain(): void {
    this.inbox = [];
  }
}

describe('★★ 人机对局（房主 + 人机，跑几个回合）', () => {
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

  /** 建房 + 加人机 + 关盟约 + 开局，返回房主客户端 */
  async function openRoomWithBots(difficulties: Array<'easy' | 'normal' | 'hard'>): Promise<{
    host: TestClient;
    room: RoomView;
  }> {
    const host = new TestClient(port);
    await host.ready();
    host.send({ t: 'createRoom', playerName: '房主' });
    const created = await host.waitFor('room');
    const code = created.room.code;

    for (const difficulty of difficulties) {
      host.send({ t: 'addBot', difficulty });
    }
    const withBots = await host.waitFor(
      'room',
      8000,
      (m) => m.room.players.filter((p) => p.isBot).length === difficulties.length,
    );
    expect(withBots.room.players, '★ 人机必须真的进了房间').toHaveLength(1 + difficulties.length);

    // 这条测试不验盟约选秀：关掉之后 startGame 会直接进布阵
    host.send({ t: 'updateSettings', settings: { covenants: false } });
    host.send({ t: 'startGame' });
    await host.waitFor('gameStarted', 10000);
    return { host, room: withBots.room };
  }

  it('房主能看到人机、人机已准备、名字带难度', async () => {
    const host = new TestClient(port);
    await host.ready();
    host.send({ t: 'createRoom', playerName: '房主' });
    const created = await host.waitFor('room');

    host.send({ t: 'addBot', difficulty: 'hard' });
    const one = await host.waitFor('room', 8000, (m) => m.room.players.length === 2);
    const bot = one.room.players.find((p) => p.isBot)!;
    expect(bot, '★ 广播里必须有 isBot 标记（客户端靠它画难度按钮）').toBeTruthy();
    expect(bot.botDifficulty).toBe('hard');
    expect(bot.ready, '★ 人机进房就是已准备').toBe(true);
    expect(bot.name).toContain('困难');

    // 换难度：名字跟着变，广播也要跟着变
    host.send({ t: 'setBotDifficulty', playerId: bot.id, difficulty: 'easy' });
    const changed = await host.waitFor(
      'room',
      8000,
      (m) => m.room.players.find((p) => p.id === bot.id)?.botDifficulty === 'easy',
    );
    expect(changed.room.players.find((p) => p.id === bot.id)!.name).toContain('简单');

    // 移除
    host.send({ t: 'removeBot', playerId: bot.id });
    const removed = await host.waitFor('room', 8000, (m) => m.room.players.length === 1);
    expect(removed.room.players.some((p) => p.isBot)).toBe(false);

    host.close();
  });

  it('★ 人机会买牌、摆位并提交阵容（不是站着不动）', async () => {
    const { host } = await openRoomWithBots(['normal']);

    /*
      跑几回合，每回合都替房主举手（不然整房间要等满兜底超时，20 秒只够跑一回合）。
      然后等一条**有人机阵容**的 `prepTeams`。
      这是"人机真的在玩"最直接的证据 —— 它走的就是真人的 `submitTeam`，
      服务器也只是把它当成一份普通的上报。
    */
    for (let round = 0; round < 4; round++) {
      host.drain();
      const battle = await host.waitFor('battleStart', 25000);
      host.send({ t: 'playbackDone', battleId: battle.battleId });
      const seen = await host.waitFor(
        'prepTeams',
        25000,
        (m) => Object.values(m.teams).some((team) => team.units.length > 0),
      );
      if (Object.values(seen.teams).some((team) => team.units.length > 0)) {
        expect(
          Object.values(seen.teams).filter((team) => team.units.length > 0).length,
          '★ 至少一方（人机）提交了有棋子的阵容',
        ).toBeGreaterThan(0);
        host.close();
        return;
      }
      await host.waitFor('gameStarted', 25000);
    }

    host.close();
    throw new Error('人机跑了 4 个回合，一次都没提交过有棋子的阵容');
  });

  it('★ 对局不会被卡住：能自己推进到下一回合（人机会发 playbackDone）', async () => {
    const { host } = await openRoomWithBots(['normal']);

    /*
      ★ 关键时序：布阵 1 秒 -> 开打 -> 服务器等**所有人**（含人机）说"我看完了"。
      如果人机不发 playbackDone，这里就要等满兜底超时（几十秒起），
      而兜底超时之外还会挂 70 秒硬超时。所以这条断言本身就是"人机回执有效"的证明。
    */
    const battle = await host.waitFor('battleStart', 25000);
    // 房主这边也要举手（真人看完了）
    host.send({ t: 'playbackDone', battleId: battle.battleId });

    const next = await host.waitFor('gameStarted', 25000, (m) => m.round >= 4);
    expect(next.round, '★ 回合真的推进了').toBeGreaterThanOrEqual(4);

    host.close();
  });

  it('★★ 三档难度真的分得开：困难档等级 / 上场人数明显高于简单档', async () => {
    const { host, room } = await openRoomWithBots(['easy', 'hard']);
    const easyId = room.players.find((p) => p.botDifficulty === 'easy')!.id;
    const hardId = room.players.find((p) => p.botDifficulty === 'hard')!.id;

    /** 跑一个回合：等开打 -> 举手 -> 等下一回合 */
    const playOneRound = async (): Promise<void> => {
      host.drain();
      const battle = await host.waitFor('battleStart', 25000);
      host.send({ t: 'playbackDone', battleId: battle.battleId });
      await host.waitFor('gameStarted', 25000);
    };

    // 跑 4 个回合，让经济 / 等级拉开差距
    for (let i = 0; i < 4; i++) await playOneRound();

    host.drain();
    const latest = await host.waitFor('room', 8000);
    const easy = latest.room.players.find((p) => p.id === easyId);
    const hard = latest.room.players.find((p) => p.id === hardId);
    expect(easy, '★ 简单档人机应该还在房间里').toBeTruthy();
    expect(hard, '★ 困难档人机应该还在房间里').toBeTruthy();

    expect(
      hard!.level,
      `★ 困难档会买经验（简单 ${easy!.level} 级 / 困难 ${hard!.level} 级）`,
    ).toBeGreaterThan(easy!.level);

    /*
      新回合刚开始时 `prepTeams` 是空的（服务器在 beginPrepPhase 里清一次），
      所以要等**人机提交过之后**的那一条 —— 带 units 的才算数。
    */
    const teams = await host.waitFor(
      'prepTeams',
      8000,
      (m) => (m.teams[hardId]?.units.length ?? 0) > 0 || (m.teams[easyId]?.units.length ?? 0) > 0,
    );
    const easyUnits = teams.teams[easyId]?.units.length ?? 0;
    const hardUnits = teams.teams[hardId]?.units.length ?? 0;
    expect(hardUnits, `★ 困难档上场人数不少于简单档（${easyUnits} vs ${hardUnits}）`).toBeGreaterThanOrEqual(
      easyUnits,
    );
    // 等级高 = 人口上限高，所以困难档场上至少要有 2 个（简单档常常只有 1 个）
    expect(hardUnits).toBeGreaterThanOrEqual(2);

    host.close();
  });
});
