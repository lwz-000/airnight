/**
 * ============================================================
 *  ★★ 0.1.4：掉线 -> 暂停 3 分钟 -> 投票取消 / 超时淘汰
 * ============================================================
 *
 * 【规则（用户定的，一条一条对着测）】
 *   1. 只要有**还活着**的玩家掉线，对局就暂停（不再要求"在线不足 2 人"）；
 *   2. 暂停有 3 分钟倒计时；暂停途中**又有人掉线 -> 倒计时重新开始**；
 *   3. 暂停时所有人弹浮层，只有一颗「同意」：**在线的人全点过** ->
 *      暂停立刻结束 + 掉线那位**当场淘汰**，剩下的人接着打；
 *   4. 3 分钟到点还没回来 -> 同样是淘汰；
 *   5. 掉线的人自己重连回来 -> 暂停立刻解除（不用投票）。
 *
 * 【为什么这些必须用真服务器测？】
 * 全是时序和"谁还在场"：定时器有没有真的重开、票有没有清零、
 * 淘汰之后对局有没有接着走 —— 纯函数一条都测不到。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket, type WebSocketServer } from 'ws';
import {
  SERVER_VERSION,
  TEAM_0_MAX_COL,
  UNIT_DEFS,
  decodeMessage,
  type ClientMessage,
  type ServerMessage,
  type UnitPlacement,
} from '../../shared/src/index.js';

process.env.AIRNIGHT_NO_AUTOSTART = '1';
process.env.AIRNIGHT_START_ROUND = '3';
process.env.AIRNIGHT_PREP_SECONDS = '1';
/** ★ 暂停压到 1.5 秒，"超时淘汰"那条几秒就能跑完（正常是 3 分钟） */
process.env.AIRNIGHT_PAUSE_MS = '1500';
/** ★ 宽限期留长一点：这样"超时淘汰"和"宽限期清座位"两条路不会互相干扰 */
process.env.AIRNIGHT_RESUME_GRACE_MS = '30000';
const { startServer } = await import('../src/main.js');

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 一支能打几秒钟的小队伍（空阵容会让战斗一帧就结束） */
function team(): UnitPlacement[] {
  const cheap = Object.keys(UNIT_DEFS)
    .filter((id) => UNIT_DEFS[id]!.cost === 1 && !UNIT_DEFS[id]!.summonOnly && !UNIT_DEFS[id]!.monsterOnly)
    .sort();
  return [{ defId: cheap[0]!, star: 1, cell: { col: TEAM_0_MAX_COL, row: 4 } }];
}

class TestClient {
  socket: WebSocket;
  playerId = '';
  resumeToken = '';
  private inbox: ServerMessage[] = [];

  constructor(port: number) {
    this.socket = new WebSocket(`ws://127.0.0.1:${port}`);
    this.socket.on('message', (data) => {
      const message = decodeMessage<ServerMessage>(data.toString());
      if (!message) return;
      if (message.t === 'welcome') {
        this.playerId = message.playerId;
        this.resumeToken = message.resumeToken ?? '';
      }
      if (message.t === 'resumeState') this.playerId = message.playerId;
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

  /** 收过的所有 gameStarted 里最大的回合号 */
  maxRound(): number {
    return this.inbox.reduce((max, m) => (m.t === 'gameStarted' ? Math.max(max, m.round) : max), 0);
  }

  /** 最后一条 room 广播（暂停状态就是它说的） */
  lastRoom(): Extract<ServerMessage, { t: 'room' }> | undefined {
    for (let i = this.inbox.length - 1; i >= 0; i -= 1) {
      const m = this.inbox[i]!;
      if (m.t === 'room') return m;
    }
    return undefined;
  }

  /** 最后一条 pauseTick */
  lastPauseTick(): Extract<ServerMessage, { t: 'pauseTick' }> | undefined {
    for (let i = this.inbox.length - 1; i >= 0; i -= 1) {
      const m = this.inbox[i]!;
      if (m.t === 'pauseTick') return m;
    }
    return undefined;
  }

  /** 自己被淘汰了吗 */
  eliminatedMe(): boolean {
    return this.inbox.some((m) => m.t === 'playerEliminated' && m.playerId === this.playerId);
  }

  async waitFor<T extends ServerMessage['t']>(
    type: T,
    timeoutMs = 5000,
    extra?: (m: Extract<ServerMessage, { t: T }>) => boolean,
  ): Promise<Extract<ServerMessage, { t: T }>> {
    const found = this.inbox.find(
      (m) => m.t === type && (!extra || extra(m as Extract<ServerMessage, { t: T }>)),
    );
    if (found) return found as Extract<ServerMessage, { t: T }>;
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      await sleep(40);
      const hit = this.inbox.find(
        (m) => m.t === type && (!extra || extra(m as Extract<ServerMessage, { t: T }>)),
      );
      if (hit) return hit as Extract<ServerMessage, { t: T }>;
      if (Date.now() > deadline) throw new Error(`等待消息 ${type} 超时（${timeoutMs}ms）`);
    }
  }

  close(): void {
    this.socket.close();
  }
}

describe('★ 暂停 / 投票 / 超时淘汰', () => {
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

  /** 开一局 3 人、跑到第 4 回合、每个人都在自动"举手" */
  async function startThreePlayerMatch(): Promise<{
    host: TestClient;
    g1: TestClient;
    g2: TestClient;
    stop: () => void;
    roundBeforeDrop: number;
  }> {
    const host = new TestClient(port);
    const g1 = new TestClient(port);
    const g2 = new TestClient(port);
    await Promise.all([host.ready(), g1.ready(), g2.ready()]);

    host.send({ t: 'createRoom', playerName: '房主' });
    const first = await host.waitFor('room');
    g1.send({ t: 'joinRoom', roomCode: first.room.code, playerName: '朋友1' });
    g2.send({ t: 'joinRoom', roomCode: first.room.code, playerName: '朋友2' });
    await sleep(300);
    g1.send({ t: 'setReady', ready: true });
    g2.send({ t: 'setReady', ready: true });
    await sleep(300);
    // ★ 0.3：这条测的不是盟约选秀，先把选秀关掉再开局（否则会停在 covenant 阶段）
    host.send({ t: 'updateSettings', settings: { covenants: false } });
    host.send({ t: 'startGame' });
    await host.waitFor('gameStarted', 8000);

    for (const c of [host, g1, g2]) c.send({ t: 'submitTeam', units: team() });
    const timers = [host, g1, g2].map((c) =>
      setInterval(() => {
        for (const m of c.all()) {
          if (m.t === 'battleStart') c.send({ t: 'playbackDone', battleId: m.battleId });
        }
      }, 100),
    );
    await host.waitFor('gameStarted', 8000, (m) => m.round >= 4);
    const roundBeforeDrop = host.maxRound();
    // 清掉历史消息：后面全是"暂停之后"的断言，留着旧的会误判
    for (const c of [host, g1, g2]) c.clear();

    return {
      host,
      g1,
      g2,
      roundBeforeDrop,
      stop: () => {
        for (const t of timers) clearInterval(t);
      },
    };
  }

  it('★ 有人掉线就暂停（不再要求"在线不足 2 人"），重连回来就继续', async () => {
    const { host, g1, g2, stop, roundBeforeDrop } = await startThreePlayerMatch();

    g2.close();
    const pausedRoom = await host.waitFor(
      'room',
      4000,
      (m) => m.room.paused === true,
    );
    expect(pausedRoom.room.paused, '3 个人里掉 1 个也该暂停').toBe(true);
    expect(pausedRoom.room.pauseSecondsLeft, '暂停要有倒计时').toBeGreaterThan(0);
    expect(pausedRoom.room.pauseVoteNeeded, '在线的人 = 房主 + 朋友1').toBe(2);
    expect(host.maxRound(), '暂停期间不许开新回合').toBe(0);

    // 掉线的人自己回来了 -> 立刻解除暂停、继续打
    const back = new TestClient(port);
    await back.ready();
    back.send({ t: 'resume', token: g2.resumeToken });
    await back.waitFor('resumeState', 4000);
    /*
      ★ 回来的人也要继续"举手"：暂停恢复后这一回合还要打完，
      服务器要等**所有在线的人**的回执才进下一回合（只等 host/g1 是不够的）。
    */
    const backAck = setInterval(() => {
      for (const m of back.all()) {
        if (m.t === 'battleStart') back.send({ t: 'playbackDone', battleId: m.battleId });
      }
    }, 100);
    const resumed = await host.waitFor('gameStarted', 8000, (m) => m.round > roundBeforeDrop);
    expect(resumed.round).toBeGreaterThan(roundBeforeDrop);
    expect(host.lastRoom()?.room.paused, '人回来了就不该还暂停着').toBe(false);

    clearInterval(backAck);
    stop();
    host.close();
    g1.close();
    back.close();
  }, 60000);

  it('★ 在线的人全部同意 -> 暂停立刻结束，掉线那位当场淘汰，剩下的人接着打', async () => {
    const { host, g1, g2, stop, roundBeforeDrop } = await startThreePlayerMatch();

    g2.close();
    await host.waitFor('room', 4000, (m) => m.room.paused === true);

    host.send({ t: 'pauseVote' });
    await sleep(300);
    expect(host.lastRoom()?.room.paused, '只有我一个人同意，暂停不该结束').toBe(true);
    expect(host.lastPauseTick()?.voteCount, '同意人数要如实上报').toBe(1);

    g1.send({ t: 'pauseVote' });
    // 在线的人全同意 -> 立刻取消暂停 + 淘汰掉线那位
    await host.waitFor('playerEliminated', 4000, (m) => m.playerId === g2.playerId);
    expect(host.lastRoom()?.room.paused, '投票通过后暂停要取消').toBe(false);
    // 还剩 2 个人 -> 对局继续（下一回合会来）
    const next = await host.waitFor('gameStarted', 8000, (m) => m.round > roundBeforeDrop);
    expect(next.round).toBeGreaterThan(roundBeforeDrop);

    stop();
    host.close();
    g1.close();
  }, 60000);

  it('★ 暂停到点还没回来 -> 照样淘汰', async () => {
    const { host, g1, g2, stop, roundBeforeDrop } = await startThreePlayerMatch();

    g2.close();
    await host.waitFor('room', 4000, (m) => m.room.paused === true);

    // 什么都不做，等 1.5 秒的暂停到点
    await host.waitFor('playerEliminated', 6000, (m) => m.playerId === g2.playerId);
    expect(host.lastRoom()?.room.paused, '到点之后暂停也要取消').toBe(false);
    const next = await host.waitFor('gameStarted', 8000, (m) => m.round > roundBeforeDrop);
    expect(next.round).toBeGreaterThan(roundBeforeDrop);

    stop();
    host.close();
    g1.close();
  }, 60000);

  it('★ 暂停途中又有人掉线 -> 倒计时重新开始（票也清零）', async () => {
    const { host, g1, g2, stop } = await startThreePlayerMatch();

    g1.close();
    const first = await host.waitFor('room', 4000, (m) => m.room.paused === true);
    expect(first.room.pauseVoteNeeded).toBe(2);
    // 先投一票（等下要验"重新计时会把票清零"）
    host.send({ t: 'pauseVote' });
    await sleep(200);
    // 等一会儿，让倒计时确实走掉几秒
    await sleep(1100);

    g2.close();
    const restarted = await host.waitFor(
      'room',
      4000,
      (m) => m.room.paused === true && m.room.pauseVoteNeeded === 1,
    );
    expect(restarted.room.pauseSecondsLeft, '倒计时要重新开始（回到满值附近）').toBeGreaterThanOrEqual(
      first.room.pauseSecondsLeft! - 1 + 1,
    );
    await sleep(150);
    expect(
      host.lastPauseTick()?.voteCount,
      '人变了，之前投的票要作废',
    ).toBe(0);

    stop();
    host.close();
  }, 60000);

  it('★ 两个人对局：掉线的人被淘汰之后只剩一个 -> 直接判他赢、结束对局', async () => {
    const host = new TestClient(port);
    const guest = new TestClient(port);
    await Promise.all([host.ready(), guest.ready()]);
    host.send({ t: 'createRoom', playerName: '房主' });
    const first = await host.waitFor('room');
    guest.send({ t: 'joinRoom', roomCode: first.room.code, playerName: '朋友' });
    await sleep(300);
    guest.send({ t: 'setReady', ready: true });
    await sleep(300);
    host.send({ t: 'updateSettings', settings: { covenants: false } });
    host.send({ t: 'startGame' });
    await host.waitFor('gameStarted', 8000);
    for (const c of [host, guest]) c.send({ t: 'submitTeam', units: team() });
    const timers = [host, guest].map((c) =>
      setInterval(() => {
        for (const m of c.all()) {
          if (m.t === 'battleStart') c.send({ t: 'playbackDone', battleId: m.battleId });
        }
      }, 100),
    );
    host.clear();

    guest.close();
    await host.waitFor('room', 4000, (m) => m.room.paused === true);
    const over = await host.waitFor('gameOver', 8000);
    expect(over.winnerId, '对手掉线被淘汰，房主就是最后的赢家').toBe(host.playerId);

    for (const t of timers) clearInterval(t);
    host.close();
  }, 60000);
});
