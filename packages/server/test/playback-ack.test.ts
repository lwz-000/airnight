/**
 * ============================================================
 *  ★★ 服务器必须等客户端**真的播完**战斗，而不是猜一个时间
 * ============================================================
 *
 * 【这里修的是什么？—— 你报的"直接跳过战斗过程 / 双端不同步"】
 *
 * 旧做法：拿这场战斗打了多少 tick 换算成秒数，`setTimeout` 等这么久就发下一回合。
 * 它的隐含前提是「客户端回放的速度 = 墙钟速度」，而这个前提是**错的**：
 *   · 客户端主循环把单帧步长 cap 在 0.05 秒（防止切标签页回来画面瞬间播完），
 *     所以**帧率一旦低于 20fps，回放就比墙钟慢**（10fps 慢一倍，5fps 慢三倍）；
 *   · 切到别的窗口时浏览器会把 requestAnimationFrame 降频甚至暂停。
 * 棋多的时候（20 个棋子 + 技能特效）弱电脑掉到 15fps 太常见了。
 *
 * 于是"服务器以为大家都看完了"的时候，慢的那台还在打 ——
 * 下一回合的通知一到，客户端把回放清掉、拉回布阵，
 * 玩家看到的就是**战斗演到一半被掐掉**，两台机器看到的进度也不一样。
 *
 * 新做法：客户端在**真的播完那一刻**发 `playbackDone`，服务器收齐所有参战者的
 * 回执才推进（另有兜底超时，防止挂机的人把房间卡死）。
 *
 * 【为什么这条测试要用真实连接，而不是测纯函数？】
 * 因为要钉住的是"**没人举手 -> 下一回合就是不来**"这条时序不变量。
 * 纯函数测不到"服务器会不会手贱自己推进"。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket, type WebSocketServer } from 'ws';
import {
  TEAM_0_MAX_COL,
  UNIT_DEFS,
  SERVER_VERSION,
  decodeMessage,
  simulate,
  type ClientMessage,
  type ServerMessage,
  type UnitPlacement,
} from '../../shared/src/index.js';

process.env.AIRNIGHT_NO_AUTOSTART = '1';
/*
  ★ 从第 3 回合开局。
  0.0.3 起第 1、2 回合是野怪回合（对手是野怪波次，不是真人），
  而这几份测试要验的是**真人配对 / 轮空 / 影子 / 回执**这条链路 ——
  从第 1 回合开局的话它们全都会落到野怪分支上去。
  野怪回合本身由 packages/server/test/monster-round.test.ts 单独测。
*/
process.env.AIRNIGHT_START_ROUND = '3';
// 布阵是 60 秒定时制：测试里必须调短，否则每个用例都要等一分钟才开打
process.env.AIRNIGHT_PREP_SECONDS = '1';
const { startServer, battlePlaybackWaitMs, playbackFallbackMs } = await import('../src/main.js');

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

  /** 收到过的所有消息（用来断言"某条消息**没有**来过"） */
  inboxAll(): ServerMessage[] {
    return this.inbox;
  }

  clear(): void {
    this.inbox = [];
  }

  close(): void {
    this.socket.close();
  }
}

/**
 * 一强一弱的两个阵容，让战斗**几秒钟**就打完。
 *
 * 为什么必须短？因为旧代码的等待时间是 `battlePlaybackWaitMs(ticks)`。
 * 战斗越短，这个时间越短，测试就越快能进入"旧代码早就推进了"的区间，
 * 从而区分出新旧行为。
 */
function lopsidedTeams(): { strong: UnitPlacement[]; weak: UnitPlacement[] } {
  /*
    ★ 取 1 费里**能买到**的干员（排除召唤物和野怪）。
    野怪也写在 UNIT_DEFS 里，id 是 mn_ 开头、排序比 op 还靠前 ——
    不排除的话这里挑到的是「猎狗」（260 血、攻击很低），
    两只猎狗互相挠要打满 9000+ tick，测试直接卡住。
  */
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

describe('★ 服务器要等客户端看完战斗才进下一回合', () => {
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

  /** 建房 -> 加入 -> 准备 -> 开局，走完前置流程 */
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

  it('★ 谁都不发"我看完了" -> 服务器就不进下一回合（旧代码到点就推进，会红）', async () => {
    const host = new TestClient(port);
    const guest = new TestClient(port);
    await host.ready();
    await guest.ready();
    await startRoom(host, guest);

    const { strong, weak } = lopsidedTeams();
    host.send({ t: 'submitTeam', units: strong });
    guest.send({ t: 'submitTeam', units: weak });

    const battle = await host.waitFor('battleStart', 10000);
    const local = simulate(UNIT_DEFS, [battle.team0, battle.team1], battle.seed);
    const baseMs = battlePlaybackWaitMs(local.ticks);
    const fallbackMs = playbackFallbackMs(local.ticks);

    // 前提检查：这一场必须够短，测试才跑得快；太长就说明阵容该换了
    expect(baseMs, '这一场太长了，测试会很慢 —— 换一个更弱的阵容').toBeLessThan(8000);
    // 要等的这段时间必须落在「旧代码早就推进了」和「兜底还没到」之间
    const probeMs = baseMs + 1500;
    expect(probeMs).toBeLessThan(fallbackMs);

    host.clear();
    guest.clear();
    await new Promise((resolve) => setTimeout(resolve, probeMs));

    // ★ 核心断言：没人举手的这段时间里，绝不能冒出"下一回合开始"
    const premature = host.inboxAll().filter((m) => m.t === 'gameStarted' && m.round >= 2);
    expect(
      premature.length,
      `服务器没等回执就进了下一回合（等了 ${probeMs}ms，战斗只有 ${baseMs - 2000}ms）` +
        ' —— 这就是"战斗被跳过"的成因',
    ).toBe(0);

    host.close();
    guest.close();
  }, 30000);

  it('★ 两个人都发了"我看完了" -> 立刻进下一回合', async () => {
    const host = new TestClient(port);
    const guest = new TestClient(port);
    await host.ready();
    await guest.ready();
    await startRoom(host, guest);

    const { strong, weak } = lopsidedTeams();
    host.send({ t: 'submitTeam', units: strong });
    guest.send({ t: 'submitTeam', units: weak });

    const battle = await host.waitFor('battleStart', 10000);
    host.clear();
    guest.clear();

    // 假装两边都播完了
    host.send({ t: 'playbackDone', battleId: battle.battleId });
    guest.send({ t: 'playbackDone', battleId: battle.battleId });

    const next = await host.waitFor('gameStarted', 3000, (m) => m.round >= 2);
    // ★ 从第 3 回合开局（0.0.3 起第 1/2 回合是野怪回合），看完一场之后是第 4 回合
    expect(next.round).toBe(4);

    host.close();
    guest.close();
  }, 30000);

  it('只发一半回执也不会推进（一个人看完不算数）', async () => {
    const host = new TestClient(port);
    const guest = new TestClient(port);
    await host.ready();
    await guest.ready();
    await startRoom(host, guest);

    const { strong, weak } = lopsidedTeams();
    host.send({ t: 'submitTeam', units: strong });
    guest.send({ t: 'submitTeam', units: weak });

    const battle = await host.waitFor('battleStart', 10000);
    host.clear();
    guest.clear();

    host.send({ t: 'playbackDone', battleId: battle.battleId });
    await new Promise((resolve) => setTimeout(resolve, 900));

    expect(
      host.inboxAll().filter((m) => m.t === 'gameStarted' && m.round >= 2).length,
      '只有一个人举手就推进了 —— 慢的那个人的战斗会被掐掉',
    ).toBe(0);

    // 第二个也举手 -> 马上推进
    guest.send({ t: 'playbackDone', battleId: battle.battleId });
    const next = await host.waitFor('gameStarted', 3000, (m) => m.round >= 2);
    // ★ 从第 3 回合开局（0.0.3 起第 1/2 回合是野怪回合），看完一场之后是第 4 回合
    expect(next.round).toBe(4);

    host.close();
    guest.close();
  }, 30000);

  it('拿一个不存在的 battleId 举手不算数（防止用上一场的回执蒙混）', async () => {
    const host = new TestClient(port);
    const guest = new TestClient(port);
    await host.ready();
    await guest.ready();
    await startRoom(host, guest);

    const { strong, weak } = lopsidedTeams();
    host.send({ t: 'submitTeam', units: strong });
    guest.send({ t: 'submitTeam', units: weak });

    await host.waitFor('battleStart', 10000);
    host.clear();
    guest.clear();

    host.send({ t: 'playbackDone', battleId: '这一场根本不存在' });
    guest.send({ t: 'playbackDone', battleId: '这一场根本不存在' });
    await new Promise((resolve) => setTimeout(resolve, 900));

    expect(host.inboxAll().filter((m) => m.t === 'gameStarted' && m.round >= 2).length).toBe(0);

    host.close();
    guest.close();
  }, 30000);

  it('★ 参战的人中途掉线，剩下的人不用干等到兜底超时', async () => {
    const host = new TestClient(port);
    const guest = new TestClient(port);
    await host.ready();
    await guest.ready();
    await startRoom(host, guest);

    const { strong, weak } = lopsidedTeams();
    host.send({ t: 'submitTeam', units: strong });
    guest.send({ t: 'submitTeam', units: weak });

    const battle = await host.waitFor('battleStart', 10000);
    host.clear();

    // 朋友（对手）直接断线 —— 他永远不会举手了
    guest.close();
    await new Promise((resolve) => setTimeout(resolve, 900));

    /*
      我举手之后服务器应该**立刻**有反应，而不是干等兜底超时
      （这一场战斗的兜底是 20 多秒，所以 1 秒内出结果才算"没等"）。

      ★ 0.1.3 起"有反应"的含义变了：对手掉线之后房间里只剩我一个人，
      于是**不再急着开下一回合**，而是把对局暂停、等人回来
      （用户报的"掉线到只剩房主，房主那边卡住"—— 以前会一轮一轮地拖着打下去）。
      所以这里断言的是"很快进入暂停"，而**不是**"开下一回合"。
    */
    host.send({ t: 'playbackDone', battleId: battle.battleId });
    await new Promise((resolve) => setTimeout(resolve, 900));

    const pausedRoom = host
      .inboxAll()
      .filter((m) => m.t === 'room')
      .reverse()
      .find((m) => (m as Extract<ServerMessage, { t: 'room' }>).room.paused === true);
    expect(pausedRoom, '对手掉线后只剩我一个人 -> 应该立刻暂停（不用等兜底）').toBeTruthy();
    expect(
      host.inboxAll().filter((m) => m.t === 'gameStarted' && m.round >= 4).length,
      '只剩一个人的时候不该再开下一回合',
    ).toBe(0);

    host.close();
  }, 30000);
});
