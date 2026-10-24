/**
 * ============================================================
 *  联机「多人」（5~8 人）静态回归测试
 * ============================================================
 *
 * 【为什么要单独一份？】
 * 之前只测过 2 人、4 人。用户手测报出了三个 bug：
 *   ① 联机里冒出单机的人机预览（客户端渲染问题，见 apps/web 的测试）；
 *   ② 奇数人时轮空者无事可做 —— 改成打「影子对战」之后要验证
 *      **被复制的那位玩家一点影响都没有**；
 *   ③ 多人时牌库广播/商店同步的问题。
 * 这份文件把 5~8 人（偶数 + 奇数）的配对、轮空影子、牌库广播全部钉住，
 * 不依赖人手开一堆浏览器标签去试。
 *
 * 【两层验证】
 *   · Room 层（纯对象，毫秒级）：影子对战选谁、镜像对不对、结算只碰轮空者；
 *   · 端到端（真服务器 + 真 WebSocket）：5/6/7/8 人的配对覆盖、
 *     影子的 battleStart/battleEnd 到底发给了谁、买牌后牌库广播对不对。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket, type WebSocketServer } from 'ws';
import {
  BOARD_H,
  TEAM_0_MAX_COL,
  TEAM_1_MIN_COL,
  UNIT_DEFS,
  damageForRound,
  SERVER_VERSION,
  decodeMessage,
  mirrorPlacements,
  playableDefs,
  poolSizeOf,
  type ClientMessage,
  type ServerMessage,
  type UnitPlacement,
} from '../../shared/src/index.js';

// 阻止 main.ts 被 import 时自动启动服务器
process.env.AIRNIGHT_NO_AUTOSTART = '1';
/*
  ★ 从第 3 回合开局。
  0.0.3 起第 1、2 回合是野怪回合（对手是野怪波次，不是真人），
  而这几份测试要验的是**真人配对 / 轮空 / 影子 / 回执**这条链路 ——
  从第 1 回合开局的话它们全都会落到野怪分支上去。
  野怪回合本身由 packages/server/test/monster-round.test.ts 单独测。
*/
process.env.AIRNIGHT_START_ROUND = '3';
// 布阵压到 2 秒，不然每个场景都要真等 60 秒
process.env.AIRNIGHT_PREP_SECONDS = '2';
const { startServer, GHOST_PLAYER_ID } = await import('../src/main.js');
const { Room } = await import('../src/room.js');

/** 第 i 号玩家的阵容：一个棋子，坐标左右不同，保证能区分是谁的 */
function teamFor(i: number): UnitPlacement[] {
  const ids = Object.keys(UNIT_DEFS).sort();
  return [
    {
      defId: ids[i % ids.length]!,
      star: 1,
      cell: { col: i % (TEAM_0_MAX_COL + 1), row: (i * 2) % BOARD_H },
    },
  ];
}

/** 极简测试客户端（发消息 / 等消息） */
class TestClient {
  socket: WebSocket;
  playerId = '';
  name = '';
  private inbox: ServerMessage[] = [];
  private waiters: Array<{ pred: (m: ServerMessage) => boolean; resolve: (m: ServerMessage) => void }> = [];

  constructor(port: number, name: string) {
    this.name = name;
    this.socket = new WebSocket(`ws://127.0.0.1:${port}`);
    this.socket.on('message', (data) => {
      const message = decodeMessage<ServerMessage>(data.toString());
      if (!message) return;
      if (message.t === 'welcome') this.playerId = message.playerId;
      this.inbox.push(message);
      this.waiters = this.waiters.filter((w) => {
        if (w.pred(message)) {
          w.resolve(message);
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
    timeoutMs = 15000,
    extra?: (m: Extract<ServerMessage, { t: T }>) => boolean,
  ): Promise<Extract<ServerMessage, { t: T }>> {
    const existing = this.inbox.find(
      (m) => m.t === type && (!extra || extra(m as Extract<ServerMessage, { t: T }>)),
    );
    if (existing) return Promise.resolve(existing as Extract<ServerMessage, { t: T }>);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`[${this.name}] 等待 ${type} 超时`)),
        timeoutMs,
      );
      this.waiters.push({
        pred: (m) => m.t === type && (!extra || extra(m as Extract<ServerMessage, { t: T }>)),
        resolve: (m) => {
          clearTimeout(timer);
          resolve(m as Extract<ServerMessage, { t: T }>);
        },
      });
    });
  }

  /** 等一小会儿，用来断言"某条消息**没有**来过" */
  async settle(ms = 400): Promise<void> {
    await new Promise((r) => setTimeout(r, ms));
  }

  all(t: ServerMessage['t']): ServerMessage[] {
    return this.inbox.filter((m) => m.t === t);
  }

  close(): void {
    this.socket.close();
  }
}

// ============================================================
// 一、Room 层：影子对战的规则（不需要网络）
// ============================================================

describe('★ Room：奇数人轮空的「影子对战」', () => {
  function makeRoom(names: string[]): { room: InstanceType<typeof Room>; ids: string[] } {
    const ids = names.map((_, i) => `p${i + 1}`);
    const room = new Room('GHOST1', ids[0]!, names[0]!);
    for (let i = 1; i < names.length; i++) room.addPlayer(ids[i]!, names[i]!);
    room.startGame();
    /*
      这几条是 **Room 层** 的配对用例，验的是 roundRobinPairings 的轮转，
      和「起始回合是几」无关 —— 所以显式钉成第 1 回合，
      不受 AIRNIGHT_START_ROUND（测试里设了 3，为了躲开野怪回合）影响。
    */
    room.round = 1;
    return { room, ids };
  }

  it('3 人：第 1 回合轮空的是最后一个加入的人，配对覆盖另外两人', () => {
    const { room, ids } = makeRoom(['A', 'B', 'C']);
    const { pairings, byePlayerId } = room.createPairings();
    expect(pairings).toHaveLength(1);
    expect(byePlayerId).toBe(ids[2]);
    const fought = [pairings[0]!.player0.id, pairings[0]!.player1.id].sort();
    expect(fought).toEqual([ids[0], ids[1]].sort());
  });

  it('★ 影子是"别人"的阵容：来源不是自己，且镜像到了右半边', () => {
    const { room, ids } = makeRoom(['A', 'B', 'C']);
    ids.forEach((id, i) => room.submitTeam(id, { units: teamFor(i) }));

    const bye = room.getPlayer(ids[2]!)!;
    const ghost = room.createGhostBattle(bye);
    expect(ghost).not.toBeNull();
    expect(ghost!.player.id).toBe(ids[2]);
    // 复制的必须是**除自己以外**的存活玩家
    expect(ghost!.source.id).not.toBe(ids[2]);
    expect([ids[0], ids[1]]).toContain(ghost!.source.id);

    // 队伍 0 = 轮空者自己的阵容（左半边）
    for (const unit of ghost!.team0.units) {
      expect(unit.cell.col).toBeLessThanOrEqual(TEAM_0_MAX_COL);
    }
    // 队伍 1 = 来源玩家阵容的镜像（右半边），逐格等于 mirrorPlacements
    const sourceIndex = ids.indexOf(ghost!.source.id);
    expect(ghost!.team1.units).toEqual(mirrorPlacements(teamFor(sourceIndex)));
    for (const unit of ghost!.team1.units) {
      expect(unit.cell.col).toBeGreaterThanOrEqual(TEAM_1_MIN_COL);
    }
  });

  it('★ 影子结算只碰轮空者：被复制的那位不掉血、不改血量记录', () => {
    const { room, ids } = makeRoom(['A', 'B', 'C']);
    ids.forEach((id, i) => room.submitTeam(id, { units: teamFor(i) }));
    const bye = room.getPlayer(ids[2]!)!;
    const ghost = room.createGhostBattle(bye)!;

    const sourceBefore = ghost.source.hp;
    const byeBefore = bye.hp;

    // 影子赢（= 轮空者输）：只有轮空者掉血
    const hpAfter = room.applyGhostResult(1, ghost.player.id);
    expect(Object.keys(hpAfter)).toEqual([ghost.player.id]);
    expect(hpAfter[ghost.player.id]).toBe(byeBefore - damageForRound(room.round));
    expect(room.getPlayer(ghost.source.id)!.hp, '被复制的玩家不该被扣血').toBe(sourceBefore);
    expect(room.getPlayer(ghost.source.id)!.losses).toBe(0);
    expect(room.getPlayer(ghost.player.id)!.losses).toBe(1);
  });

  it('轮空者赢 / 平局：轮空者自己也不掉血', () => {
    for (const winner of [0, null] as const) {
      const { room, ids } = makeRoom(['A', 'B', 'C']);
      const bye = room.getPlayer(ids[2]!)!;
      const ghost = room.createGhostBattle(bye)!;
      const byeBefore = bye.hp;
      const hpAfter = room.applyGhostResult(winner, ghost.player.id);
      expect(hpAfter[ghost.player.id]).toBe(byeBefore);
    }
  });

  it('只剩一个人时没有影子可打（返回 null）', () => {
    const { room, ids } = makeRoom(['A', 'B']);
    // 把另一个人的血打光
    const other = room.getPlayer(ids[1]!)!;
    other.hp = 0;
    expect(room.createGhostBattle(room.getPlayer(ids[0]!)!)).toBeNull();
  });

  it('★ 偶数人永远没有轮空（5 回合都不出现）', () => {
    const { room } = makeRoom(['A', 'B', 'C', 'D', 'E', 'F']);
    for (let r = 1; r <= 5; r++) {
      room.round = r;
      expect(room.createPairings().byePlayerId).toBeNull();
    }
  });
});

// ============================================================
// 二、端到端：5~8 人的配对 / 影子 / 牌库广播
// ============================================================

describe('★ Room：藏品随机招募的裁决（纯对象）', () => {
  it('★ 该费用区间被抽干 -> 招不到人，改发金币（按"本该抽到的那名"的花费）', () => {
    const room = new Room('TEST01', 'p1', 'P1');
    // 把 1~3 费全部抽干（takeFromPool 就是买牌用的那条路）
    for (const def of playableDefs()) {
      if (def.cost <= 3) room.takeFromPool(def.id, poolSizeOf(def.id));
    }
    const result = room.recruit(1, 3, 999);
    expect(result.defId).toBeNull();
    expect(result.gold, '补偿不低于最低费').toBeGreaterThanOrEqual(1);
    expect(result.gold, '补偿不超过最高费').toBeLessThanOrEqual(3);
  });

  it('牌库有货 -> 扣一张，并且是那个费用区间里的干员', () => {
    const room = new Room('TEST02', 'p1', 'P1');
    const result = room.recruit(4, 5, 4242);
    expect(result.defId).not.toBeNull();
    expect(result.gold).toBe(0);
    const def = UNIT_DEFS[result.defId!]!;
    expect(def.cost).toBeGreaterThanOrEqual(4);
    expect(def.cost).toBeLessThanOrEqual(5);
    // 扣完那一张，牌库真少一张
    expect(room.remainingOf(def.id)).toBe(poolSizeOf(def.id) - 1);
  });

  it('同一颗种子复现同一次招募（可复盘）', () => {
    const a = new Room('TEST03', 'p1', 'P1').recruit(1, 3, 777);
    const b = new Room('TEST03', 'p1', 'P1').recruit(1, 3, 777);
    expect(b).toEqual(a);
  });
});

describe('★ 端到端：5~8 人同乐房', () => {
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

  /** 建一个 n 人房、全员准备、房主开局，返回所有客户端 + 房间码 */
  async function startRoom(n: number): Promise<{ clients: TestClient[]; code: string }> {
    const clients: TestClient[] = [];
    for (let i = 0; i < n; i++) {
      const client = new TestClient(port, `P${i + 1}`);
      await client.ready();
      clients.push(client);
    }
    const host = clients[0]!;
    host.send({ t: 'createRoom', playerName: host.name });
    const room = await host.waitFor('room');
    const code = room.room.code;

    for (let i = 1; i < clients.length; i++) {
      clients[i]!.send({ t: 'joinRoom', roomCode: code, playerName: clients[i]!.name });
      await clients[i]!.waitFor('room');
    }
    const full = await host.waitFor('room', 8000, (m) => m.room.players.length === n);
    expect(full.room.players).toHaveLength(n);

    // 非房主全部准备
    for (let i = 1; i < clients.length; i++) clients[i]!.send({ t: 'setReady', ready: true });
    await host.waitFor('room', 8000, (m) => m.room.players.filter((p) => p.ready).length === n - 1);
    // ★ 0.3：这条测的不是盟约选秀，先把选秀关掉再开局（否则会停在 covenant 阶段）
    host.send({ t: 'updateSettings', settings: { covenants: false } });
    host.send({ t: 'startGame' });
    await host.waitFor('gameStarted', 10000);

    // 每个人提交自己的阵容
    clients.forEach((client, i) => client.send({ t: 'submitTeam', units: teamFor(i) }));
    return { clients, code };
  }

  /**
   * 替所有人举手"我看完了"。
   *
   * ★ 0.0.3：结算被推迟到"这一回合所有人都看完"之后了，所以必须
   * **等每个客户端都收齐这一回合的全部 battleStart** 再举手 ——
   * 少举一场（比如轮空者的那场影子）服务器就永远不会结算。
   */
  async function ackAll(clients: TestClient[], expected: number): Promise<void> {
    for (const client of clients) {
      for (let i = 0; i < 60; i++) {
        if (client.all('battleStart').length >= expected) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      for (const message of client.all('battleStart')) {
        const payload = message as Extract<ServerMessage, { t: 'battleStart' }>;
        client.send({ t: 'playbackDone', battleId: payload.battleId });
      }
    }
  }

  for (const n of [5, 6, 7, 8]) {
    it(`★ ${n} 人：配对覆盖全场${n % 2 === 1 ? '，且恰好一人打影子' : '，且没有影子'}`, async () => {
      const { clients } = await startRoom(n);
      const host = clients[0]!;

      // 等这一回合所有 battleStart 都到（配对场数 + 可能的影子 1 场）
      const expected = Math.floor(n / 2) + (n % 2);
      await host.waitFor('battleStart', 15000);
      // 全部消息在同一批里发下来，稍微等一下收齐
      for (let i = 0; i < 40; i++) {
        if (host.all('battleStart').length >= expected) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      const starts = host.all('battleStart') as Array<Extract<ServerMessage, { t: 'battleStart' }>>;
      expect(starts, `第 1 回合应有 ${expected} 场（${n} 人）`).toHaveLength(expected);

      const ghosts = starts.filter((s) => s.ghostOf !== undefined);
      const real = starts.filter((s) => s.ghostOf === undefined);

      if (n % 2 === 0) {
        expect(ghosts, '偶数人不该有影子').toHaveLength(0);
        expect(real).toHaveLength(n / 2);
      } else {
        expect(ghosts, '奇数人应该恰好一场影子').toHaveLength(1);
        expect(real).toHaveLength((n - 1) / 2);
      }

      // 真人配对：每个人的 id 恰好出现在一场里
      const seen = new Map<string, number>();
      for (const s of real) {
        for (const id of [s.team0PlayerId, s.team1PlayerId]) {
          seen.set(id, (seen.get(id) ?? 0) + 1);
        }
      }
      if (n % 2 === 0) {
        for (const client of clients) {
          expect(seen.get(client.playerId), `${client.name} 应该恰好打一场`).toBe(1);
        }
      }

      // 影子那一场：轮空者站队伍 0、对面是假 id、并且带上了被复制者的名字
      if (n % 2 === 1) {
        const ghost = ghosts[0]!;
        const bye = clients.find((c) => c.playerId === ghost.team0PlayerId);
        expect(bye, '影子对战的 team0 必须是房间里的真人（轮空者）').toBeDefined();
        expect(ghost.team1PlayerId).toBe(GHOST_PLAYER_ID);
        expect(ghost.ghostOf!.length).toBeGreaterThan(0);
        // 影子不该顶替任何真人的 id
        for (const client of clients) {
          expect(ghost.team1PlayerId).not.toBe(client.playerId);
          // 轮空者本人这一回合不该出现在任何真人配对里
          expect(seen.get(bye!.playerId) ?? 0).toBe(0);
        }
        // 影子阵容 = 某个真人阵容的镜像
        const mirrorMatch = clients.some(
          (_, i) => JSON.stringify(mirrorPlacements(teamFor(i))) === JSON.stringify(ghost.team1.units),
        );
        expect(mirrorMatch, '影子阵容必须等于某个玩家阵容的镜像').toBe(true);
      }

      // 结算：影子的 battleEnd.hpAfter 里**只能有轮空者**（被复制者不在里面）
      await ackAll(clients, expected);
      for (const s of starts) {
        const end = await host.waitFor(
          'battleEnd',
          15000,
          (m) => m.battleId === s.battleId,
        );
        if (s.ghostOf !== undefined) {
          expect(Object.keys(end.hpAfter), '影子对战不该结算到别人头上').toEqual([s.team0PlayerId]);
        }
      }

      for (const client of clients) client.close();
    });
  }

  it('★ 8 人：有人买牌之后，所有人的牌库广播都会少一张（抢牌机制是共享的）', async () => {
    const { clients } = await startRoom(8);
    const buyer = clients[4]!; // 2 号/3 号之外的一个人，避免和"旁观者"混淆
    const watcher = clients[5]!;
    const defId = Object.keys(UNIT_DEFS).sort()[0]!;

    // 买之前先等一次牌库广播，拿到基数
    const before = await watcher.waitFor('pool', 8000);
    const stockBefore = before.remaining[defId]!;

    buyer.send({ t: 'buyCard', defId });
    const bought = await buyer.waitFor('buyResult', 8000, (m) => m.defId === defId);
    expect(bought.ok).toBe(true);

    // ★ 关键：**别人**（watcher）也要收到"这张牌少了一张"的广播
    const after = await watcher.waitFor('pool', 8000, (m) => m.remaining[defId] === stockBefore - 1);
    expect(after.remaining[defId], '别人买走之后，我这边的牌库也要 -1').toBe(stockBefore - 1);

    for (const client of clients) client.close();
  });

  it('★ 藏品随机招募（博士银印）：服务器扣牌，而且所有人都看到牌库 -1', async () => {
    const { clients } = await startRoom(4);
    const recruiter = clients[1]!;
    const watcher = clients[2]!;

    const before = await watcher.waitFor('pool', 8000);

    recruiter.send({ t: 'recruitFromPool', minCost: 4, maxCost: 5, seed: 12345 });
    const result = await recruiter.waitFor('recruitResult', 8000);
    expect(result.defId, '牌库有货时该招到人').not.toBeNull();
    const def = UNIT_DEFS[result.defId!]!;
    expect(def.cost, '银印只抽 4~5 费').toBeGreaterThanOrEqual(4);
    expect(def.cost).toBeLessThanOrEqual(5);
    expect(result.gold).toBe(0);

    /*
      ★ 关键：这张牌真的从**共享牌库**扣掉了 —— 别人也要收到广播。
      否则 8 个人各招一只，牌库就超发了（和买牌同一条理由）。
    */
    const after = await watcher.waitFor(
      'pool',
      8000,
      (m) => m.remaining[def.id] === (before.remaining[def.id] ?? 0) - 1,
    );
    expect(after.remaining[def.id]).toBe((before.remaining[def.id] ?? 0) - 1);

    for (const client of clients) client.close();
  });

  it('★ 8 人：每回合都是 4 场真人配对（不会有人连打两场或轮空）', async () => {
    const { clients } = await startRoom(8);
    const host = clients[0]!;
    await host.waitFor('battleStart', 15000);
    for (let i = 0; i < 40; i++) {
      if (host.all('battleStart').length >= 4) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    const starts = host.all('battleStart') as Array<Extract<ServerMessage, { t: 'battleStart' }>>;
    expect(starts).toHaveLength(4);
    const counted = new Map<string, number>();
    for (const s of starts) {
      for (const id of [s.team0PlayerId, s.team1PlayerId]) {
        counted.set(id, (counted.get(id) ?? 0) + 1);
      }
    }
    expect(counted.size).toBe(8);
    for (const count of counted.values()) expect(count).toBe(1);
    for (const client of clients) client.close();
  });
});
