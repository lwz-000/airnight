/**
 * ============================================================
 *  ★★ 断线重连（服务端）
 * ============================================================
 *
 * 【这里要钉住的不变量】
 *   1. 掉线**不再等于退房**：座位、血量、阵容原地留着，开着宽限期等人回来；
 *   2. 重连走 `resume` 而不是 `joinRoom` —— 拿回的是**原来那个 playerId**、
 *      原来的血量、原来的阵容（joinRoom 只会给一个 hp:100 的白板）；
 *   3. 战斗中断线重连，服务器要把这一回合**正在播的每一场**补给他
 *      （带 `elapsedMs`，不然他从第 0 秒重放，观战进度永远对不上别人）；
 *   4. 同一个令牌在两处连接 -> 后到的顶掉先到的（先到的收到 `replaced` 并断开），
 *      否则两个人共用一个座位，血量和阵容会互相覆盖。
 *
 * 【为什么必须用真连接测？】
 * 因为这几条全是**时序 + 连接生命周期**（socket close 之后服务器做什么、
 * 谁先谁后、广播有没有发出去），纯函数一个都测不到。
 * 参考 playback-ack.test.ts 的打法：真起一个服务器 + 几个裸 WS 客户端。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket, type WebSocketServer } from 'ws';
import {
  TEAM_0_MAX_COL,
  UNIT_DEFS,
  SERVER_VERSION,
  decodeMessage,
  type ClientMessage,
  type ServerMessage,
  type UnitPlacement,
} from '../../shared/src/index.js';

process.env.AIRNIGHT_NO_AUTOSTART = '1';
// 从第 3 回合开局：第 1/2 回合是野怪回合，这里要验的是真人这条链路
process.env.AIRNIGHT_START_ROUND = '3';
process.env.AIRNIGHT_PREP_SECONDS = '1';
const { startServer } = await import('../src/main.js');

class TestClient {
  socket: WebSocket;
  playerId = '';
  /** 服务器发的重连令牌（`welcome` 里带） */
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
}

/** 一强一弱的两个阵容：战斗几秒钟就打完，测试不用干等 */
function lopsidedTeams(): { strong: UnitPlacement[]; weak: UnitPlacement[] } {
  const cheap = Object.keys(UNIT_DEFS)
    .filter((id) => UNIT_DEFS[id]!.cost === 1 && !UNIT_DEFS[id]!.summonOnly && !UNIT_DEFS[id]!.monsterOnly)
    .sort();
  const defId = cheap[0]!;
  const cell = { col: TEAM_0_MAX_COL, row: 4 };
  return {
    strong: [{ defId, star: 3, cell }],
    weak: [{ defId, star: 1, cell }],
  };
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('★ 断线重连：座位保留 + 凭令牌回座', () => {
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

  /** 建房 -> 加入 -> 准备 -> 开局 */
  async function startRoom(host: TestClient, guest: TestClient): Promise<void> {
    host.send({ t: 'createRoom', playerName: '房主' });
    const room = await host.waitFor('room');
    guest.send({ t: 'joinRoom', roomCode: room.room.code, playerName: '朋友' });
    await host.waitFor('room', 5000, (m) => m.room.players.length === 2);
    guest.send({ t: 'setReady', ready: true });
    await host.waitFor('room', 5000, (m) => m.room.players.some((p) => p.ready));
    // ★ 0.3：这条测的不是盟约选秀，先把选秀关掉再开局（否则会停在 covenant 阶段）
    host.send({ t: 'updateSettings', settings: { covenants: false } });
    host.send({ t: 'startGame' });
    await host.waitFor('gameStarted', 8000);
  }

  it('★ 每个连接都会领到一枚重连令牌（welcome 里带）', async () => {
    const solo = new TestClient(port);
    await solo.ready();
    await solo.waitFor('welcome');
    expect(solo.resumeToken.length, '没有令牌就没有"回座位的钥匙"').toBeGreaterThan(16);
    solo.close();
  });

  it('★ 大厅里掉线：别人看到的是"掉线"而不是"走了"，重连拿回同一个 playerId', async () => {
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
    expect(token, '加入房间之后也必须持有令牌').not.toBe('');

    guest.close();
    // 关键：座位**不能**消失，只是 connected = false
    const offline = await host.waitFor(
      'room',
      5000,
      (m) => m.room.players.find((p) => p.id === guestId)?.connected === false,
    );
    expect(
      offline.room.players.length,
      '掉线不等于退房 —— 座位必须还留着（不然宽限期就成了摆设）',
    ).toBe(2);

    // ---- 凭令牌回座 ----
    const back = new TestClient(port);
    await back.ready();
    back.send({ t: 'resume', token });
    const state = await back.waitFor('resumeState', 5000);
    expect(state.playerId, '★ 回座必须是**原来那个** playerId').toBe(guestId);
    expect(state.room.code).toBe(room.room.code);
    expect(
      await host.waitFor('room', 5000, (m) => m.room.players.find((p) => p.id === guestId)?.connected === true),
      '重连之后别人应该看到他又在线了',
    ).toBeTruthy();

    back.close();
    host.close();
  });

  it('★ 对局中掉线重连：血量 / 回合 / 阵容都在（joinRoom 只会给一个白板）', async () => {
    const host = new TestClient(port);
    const guest = new TestClient(port);
    await host.ready();
    await guest.ready();
    await startRoom(host, guest);

    const { strong, weak } = lopsidedTeams();
    const guestId = guest.playerId;
    const token = guest.resumeToken;
    host.send({ t: 'submitTeam', units: strong });
    guest.send({ t: 'submitTeam', units: weak });
    await sleep(200);

    guest.close();
    const back = new TestClient(port);
    await back.ready();
    back.send({ t: 'resume', token });
    const state = await back.waitFor('resumeState', 5000);

    expect(state.playerId).toBe(guestId);
    expect(state.round, '回合号必须接着原来的（不是新开一局）').toBe(3);
    expect(state.phase === 'prep' || state.phase === 'battle' || state.phase === 'resolve').toBe(true);
    expect(state.myTeam, '服务器手上最完整的"我"要发回来 —— 刷新页面就靠它重建棋盘').not.toBeNull();
    expect(state.myTeam!.units.length, '我提交过的阵容要原样带回来').toBe(weak.length);
    expect(state.myTeam!.units[0]!.star).toBe(1);
    // 血量是服务端权威数据，重连时必须按房间里那份给（而不是重新发一个 100）
    const seat = state.room.players.find((p) => p.id === guestId);
    expect(seat?.hp, '血量要以座位上的为准').toBe(100);

    back.close();
    host.close();
  });

  /**
   * ★★ 0.2.2：**用户报的那条"数据非法玩家重进数据丢失"**。
   *
   * 【原来的表现】阵容里只要有一格不合法（重叠 / 越界 / 认不出的 id），
   * 服务端就**整份拒收** ⇒ `player.team` 还是更旧的一份（甚至没有）⇒
   * 重进时 `myTeam` 拿到的是旧的，玩家这一回合摆的棋子、备战席、金币全部回退。
   *
   * 【现在钉住两条】
   *   ① 合法的那些**照常参战**（不是整份作废），并且明确回一条 `TEAM_REPAIRED`；
   *   ② 重连拿到的是**他最后提交的那一份原文**（含被判非法的那几个）——
   *      "还原他的棋盘"和"能不能开打"是两件事，不能混。
   */
  it('★★ 0.2.2：阵容有非法格子也不会丢数据（重连拿到最后提交的那一份）', async () => {
    const host = new TestClient(port);
    const guest = new TestClient(port);
    await host.ready();
    await guest.ready();
    await startRoom(host, guest);

    const cheap = Object.keys(UNIT_DEFS)
      .filter((id) => UNIT_DEFS[id]!.cost === 1 && !UNIT_DEFS[id]!.summonOnly && !UNIT_DEFS[id]!.monsterOnly)
      .sort();
    const a = cheap[0]!;
    const b = cheap[1]!;
    // 第二枚和第一枚**压在同一格** —— 这就是典型的一份"非法但确实是玩家手上东西"的数据
    const broken: UnitPlacement[] = [
      { defId: a, star: 1, cell: { col: 2, row: 3 } },
      { defId: b, star: 1, cell: { col: 2, row: 3 } },
    ];

    const { strong } = lopsidedTeams();
    host.send({ t: 'submitTeam', units: strong });
    guest.send({ t: 'submitTeam', units: broken });

    // ① 服务端要明确告诉他"有几个没生效"，而不是默默吞掉
    const repaired = await guest.waitFor('error', 5000, (m) => m.code === 'TEAM_REPAIRED');
    expect(repaired.message, '提示里要说清有几处、为什么').toContain('不合法');

    // 剩下的那一枚照常参战（别人看他阵容能看到 1 个，而不是 0 个）
    await sleep(150);
    const teams = await host.waitFor('prepTeams', 5000, (m) => {
      const mine = m.teams[guest.playerId];
      return Boolean(mine && mine.units.length === 1);
    });
    expect(teams.teams[guest.playerId]!.units.length, '合法的那一枚不该被一起扔掉').toBe(1);

    // ② 重连：拿回来的是**他提交的原文**（2 个），不是"修好后的 1 个"
    const token = guest.resumeToken;
    const guestId = guest.playerId;
    guest.close();
    await sleep(100);
    const back = new TestClient(port);
    await back.ready();
    back.send({ t: 'resume', token });
    const state = await back.waitFor('resumeState', 5000);
    expect(state.playerId).toBe(guestId);
    expect(
      state.myTeam?.units.length,
      '★ 这就是用户报的丢数据：重进必须拿到他最后提交的那一份（哪怕里面有非法格子）',
    ).toBe(2);
    expect(state.myTeam?.units.map((unit) => unit.defId).sort()).toEqual([a, b].sort());

    back.close();
    host.close();
  });

  it('★ 战斗中断线重连：这一回合正在播的战斗会补发（带 elapsedMs 接上进度）', async () => {
    const host = new TestClient(port);
    const guest = new TestClient(port);
    await host.ready();
    await guest.ready();
    await startRoom(host, guest);

    const { strong, weak } = lopsidedTeams();
    const token = guest.resumeToken;
    host.send({ t: 'submitTeam', units: strong });
    guest.send({ t: 'submitTeam', units: weak });

    const battle = await host.waitFor('battleStart', 10000);
    // 掉线的人此刻已经错过广播了，只能靠重连时补
    guest.close();
    await sleep(100);

    const back = new TestClient(port);
    await back.ready();
    back.send({ t: 'resume', token });
    const state = await back.waitFor('resumeState', 5000);

    /*
      ★ 注意阶段为什么是 `resolve` 而不是 `battle`：
      服务器广播完 battleStart 就**立刻**进了 resolve（扣血和 battleEnd 会一直压到
      "所有人都看完"才发）。所以"战斗演出期间"正好对应 resolve ——
      buildResumeState 里 `inBattle = battle || resolve` 就是为这个准备的。
    */
    expect(
      state.phase === 'battle' || state.phase === 'resolve',
      '重连时这一回合还在战斗演出窗口里（还不能是下一回合的 prep）',
    ).toBe(true);
    expect(state.battles.length, '战斗缓存要把他错过的那一场补上').toBeGreaterThan(0);
    expect(state.battles[0]!.battle.battleId, '补的必须是同一场（不然他看的是"另一场战斗"）').toBe(
      battle.battleId,
    );
    expect(
      state.battles[0]!.elapsedMs,
      'elapsedMs 让客户端跳到该接上的那一秒（不给的话他从 0 秒重播，进度永远对不上）',
    ).toBeGreaterThanOrEqual(0);

    back.close();
    host.close();
  });

  it('★ 同一个令牌在两处连接：后到的顶掉先到的（先到的收到 replaced 并被断开）', async () => {
    const host = new TestClient(port);
    const guest = new TestClient(port);
    await host.ready();
    await guest.ready();

    host.send({ t: 'createRoom', playerName: '房主' });
    const room = await host.waitFor('room');
    guest.send({ t: 'joinRoom', roomCode: room.room.code, playerName: '朋友' });
    await host.waitFor('room', 5000, (m) => m.room.players.length === 2);
    const token = guest.resumeToken;
    guest.close();

    // 第一处回来
    const first = new TestClient(port);
    await first.ready();
    first.send({ t: 'resume', token });
    await first.waitFor('resumeState', 5000);

    // 第二处用同一枚令牌进来 -> 后到者赢
    const second = new TestClient(port);
    await second.ready();
    second.send({ t: 'resume', token });
    await second.waitFor('resumeState', 5000);

    const kicked = await first.waitFor('replaced', 5000);
    expect(kicked.reason.length, '要说清楚原因，别让玩家以为只是断线').toBeGreaterThan(0);
    // 被顶掉的那条连接必须真的断开，否则它会自动重连、两边互踢
    await sleep(100);
    expect(
      first.socket.readyState,
      '被顶掉的连接必须关上（不关的话它会自动重连，两个标签页无限互踢）',
    ).not.toBe(WebSocket.OPEN);

    second.close();
    host.close();
  });
});

/**
 * ============================================================
 *  ★★ 0.1.4：重连**不能只能用一次**
 * ============================================================
 *
 * 【这里钉的是什么 bug？】
 * 每条新连接建立时，服务端先发一条 `welcome`，带的是**这条连接的临时身份**令牌；
 * 客户端紧接着用**手上那枚真令牌**去 `resume`；resume 成功之后服务端会把临时身份作废
 * （`forgetSession`）—— 也就是说那条 welcome 给的令牌**当场就死了**。
 *
 * 如果客户端把 welcome 的令牌当成自己的（0.1.3 就是这么写的），就会：
 *   第一次重连成功 -> 手上换成那枚已作废的令牌 -> 第二次重连 BAD_TOKEN、
 *   **再也回不去**（用户报的"有时候能回、有时候回不去（大概率回不去）"）。
 *
 * 服务端这边的职责：**resume 成功之后补发一条带正确令牌的 welcome**，
 * 这样客户端无论怎么换都能拿到对的那一枚（客户端那边也加了一道不许顶掉的闸）。
 */
describe('★ 重连之后要补发"带正确令牌"的 welcome（重连不能只能用一次）', () => {
  let handle: { wss: WebSocketServer; close: () => void };
  let port = 0;

  beforeAll(async () => {
    handle = startServer(0, '127.0.0.1');
    if (!handle.wss.address()) {
      await new Promise<void>((resolve) => handle.wss.once('listening', () => resolve()));
    }
    const address = handle.wss.address();
    port = typeof address === 'object' && address ? address.port : 0;
  });

  afterAll(() => {
    handle?.close();
  });

  it('★ 连两次都能回：第二次用的还是原来那枚令牌（不是已作废的临时令牌）', async () => {
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
    expect(token.length).toBeGreaterThan(16);

    // ---- 第一次掉线 + 回座 ----
    guest.close();
    await sleep(200);
    const first = new TestClient(port);
    await first.ready();
    // ★ 先记下"这条新连接的临时令牌"（welcome 是连接建立时就来）
    await first.waitFor('welcome', 3000);
    const tempToken = first.resumeToken;
    expect(tempToken, '新连接也有自己的令牌').not.toBe(token);

    first.send({ t: 'resume', token });
    await first.waitFor('resumeState', 5000);
    await sleep(200);
    expect(first.playerId, '身份换回原来那个').toBe(guestId);
    expect(
      first.resumeToken,
      '★ resume 成功后必须补发一条带**原令牌**的 welcome（否则客户端手上是那枚已作废的临时令牌）',
    ).toBe(token);

    // ---- 第二次掉线 + 回座：用的还是原来那枚令牌 ----
    first.close();
    await sleep(200);
    const second = new TestClient(port);
    await second.ready();
    second.send({ t: 'resume', token });
    const state = await second.waitFor('resumeState', 5000);
    expect(state.playerId, '第二次也必须回得去').toBe(guestId);

    second.close();
    host.close();
  }, 30000);
});
