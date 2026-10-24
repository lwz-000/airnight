/**
 * ============================================================
 *  ★ 0.0.3 联机：藏品（装备）必须真的过网络
 * ============================================================
 *
 * 【这份测试在防什么？—— 一个真实存在过、而且完全静默的 bug】
 * 联机时客户端是把阵容"推"给服务器的（布阵定时制，见 syncTeamToServer）。
 * 那条路原来是**手抄的一份字段列表** `{defId, star, cell}`：
 *   · 没有 `items`      -> 干员身上的 A 类藏品在服务器那边根本不存在
 *   · 没有 `sharedItems`-> 共享装备栏的 B 类藏品全丢
 *   · 没有 `playerContext` -> 金酒之杯 / 皇帝的新枪拿不到金币和血量
 * 结果就是"布阵界面上装备显示已生效，打起来一点用都没有"，
 * 而且两边都不报错（客户端本地重放用的也是服务器广播的那份阵容，天然一致）。
 *
 * 更要命的是**校验和**：服务器和客户端都算"没有藏品的战斗"，当然对得上。
 * 所以这种漏字段的 bug 不会以"校验和不一致"暴露，只会以"藏品没效果"暴露。
 *
 * 【这份测试怎么钉住它】
 * 分两层：
 *   ① Room 层（不联网）：`buildTeamSetup` 有没有把三个字段带出来，
 *      以及**带出来的东西是不是真的改变了内核算出来的结果**（比校验和）。
 *   ② 端到端（真 WebSocket）：客户端 `submitTeam` 发上去的东西，
 *      服务器有没有原样收下、并且广播进 battleStart。
 * 只测 ① 会漏掉"消息处理器没转发"，只测 ② 会漏掉"buildTeamSetup 又给丢了"。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket, type WebSocketServer } from 'ws';
import {
  TEAM_0_MAX_COL,
  TEAM_1_MIN_COL,
  UNIT_DEFS,
  SERVER_VERSION,
  decodeMessage,
  playableDefs,
  simulate,
  type ClientMessage,
  type ServerMessage,
} from '../../shared/src/index.js';

process.env.AIRNIGHT_NO_AUTOSTART = '1';
process.env.AIRNIGHT_PREP_SECONDS = '2';
// ★ 躲开第 1、2 回合的野怪回合 —— 这里要验的是真人配对那条路
process.env.AIRNIGHT_START_ROUND = '3';
const { startServer } = await import('../src/main.js');
const { Room } = await import('../src/room.js');
type RoomInstance = InstanceType<typeof Room>;

/** 取两个**能买到**的干员当试验品（不用全表取，野怪会排在最前面） */
const CANDIDATES = playableDefs().map((def) => def.id);
const DEF_A = CANDIDATES[0]!;
const DEF_B = CANDIDATES[1]!;

/** 一件 A 类藏品（干员自身受益：攻击 +10% / 10% 吸血） */
const ITEM_A = 'itm_solvent';
/** 一件 B 类**属性型**藏品（奇缘面具：我方干员受到的所有伤害 -10%） */
const ITEM_B = 'itm_fate_mask';
/** 一件 B 类**看玩家金币**的藏品（金酒之杯：每 5 金币 +3% 攻速，上限 200%） */
const ITEM_GOLD = 'itm_gin_cup';

const SEED = 20250101;

// ============================================================
//  ① Room 层：提交 -> buildTeamSetup 的保真度
// ============================================================

describe('★ Room.buildTeamSetup：藏品的三个字段一个都不能丢', () => {
  function makeRoom(): RoomInstance {
    const room = new Room('ITEM01', 'p1', 'A');
    room.addPlayer('p2', 'B');
    room.startGame();
    return room;
  }

  it('队 0：干员身上的 A 类藏品原样带出来', () => {
    const room = makeRoom();
    room.submitTeam('p1', {
      units: [{ defId: DEF_A, star: 1, cell: { col: TEAM_0_MAX_COL, row: 3 }, items: [ITEM_A] }],
    });
    const setup = room.buildTeamSetup(room.getPlayer('p1')!, 0);
    expect(setup.units[0]!.items).toEqual([ITEM_A]);
  });

  it('★ 队 1：镜像之后 A 类藏品还在（镜像只换坐标，不能顺手把装备扔了）', () => {
    const room = makeRoom();
    room.submitTeam('p1', {
      units: [
        { defId: DEF_A, star: 1, cell: { col: 2, row: 3 }, items: [ITEM_A] },
        { defId: DEF_B, star: 1, cell: { col: 3, row: 5 } },
      ],
    });
    const setup = room.buildTeamSetup(room.getPlayer('p1')!, 1);
    // 坐标翻到右半边
    for (const unit of setup.units) expect(unit.cell.col).toBeGreaterThanOrEqual(TEAM_1_MIN_COL);
    // 带装备的那一枚（问东西不问位置：镜像后顺序不变，还是第 0 个）
    expect(setup.units[0]!.items).toEqual([ITEM_A]);
    expect(setup.units[1]!.items).toBeUndefined();
  });

  it('共享藏品（B 类）带得出来', () => {
    const room = makeRoom();
    room.submitTeam('p1', {
      units: [{ defId: DEF_A, star: 1, cell: { col: 3, row: 3 } }],
      sharedItems: [ITEM_B],
    });
    const setup = room.buildTeamSetup(room.getPlayer('p1')!, 0);
    expect(setup.sharedItems).toEqual([ITEM_B]);
  });

  it('★ 血量用服务端的，**不采信**客户端上报的（客户端那份可能落后一两拍）', () => {
    const room = makeRoom();
    const player = room.getPlayer('p1')!;
    player.hp = 40;
    room.submitTeam('p1', {
      units: [{ defId: DEF_A, star: 1, cell: { col: 3, row: 3 } }],
      playerContext: { gold: 25, hp: 999 },
    });
    const setup = room.buildTeamSetup(player, 0);
    expect(setup.playerContext!.hp).toBe(40);
    // 金币没有服务端账本（经济是客户端管的），只能听客户端的
    expect(setup.playerContext!.gold).toBe(25);
  });

  it('没提交共享藏品 / 没提交玩家信息时不留空壳（保持给内核的载荷干净）', () => {
    const room = makeRoom();
    room.submitTeam('p1', { units: [{ defId: DEF_A, star: 1, cell: { col: 3, row: 3 } }] });
    const setup = room.buildTeamSetup(room.getPlayer('p1')!, 0);
    expect(setup.sharedItems).toBeUndefined();
    // playerContext 会带上（hp 是服务端权威值、gold 兜底 0），但至少不该是 undefined
    expect(setup.playerContext).toBeDefined();
  });
});

// ============================================================
//  ② 「带出来了」不等于「生效了」—— 直接比内核算出来的校验和
// ============================================================

describe('★ 藏品真的改变了战斗结果（否则字段带出来也是白带）', () => {
  /**
   * 造一场 p1 vs p2 的战斗，返回校验和。
   * 两边阵容固定，只有 p1 提交的藏品不同 —— 于是**校验和不同 == 藏品真的生效了**。
   */
  function checksumWith(p1Team: Parameters<RoomInstance['submitTeam']>[1]): number {
    const room = new Room('ITEM02', 'p1', 'A');
    room.addPlayer('p2', 'B');
    room.startGame();
    room.submitTeam('p1', p1Team);
    /*
      ⚠️ p2 提交的坐标也必须是"他自己视角"的（左半边），
      因为 `buildTeamSetup(p2, 1)` 会把它**镜像**到右半边 ——
      直接写 col 5 的话镜像完变成 col 4，createBattle 会报"棋子放错半场"。
    */
    room.submitTeam('p2', {
      units: [{ defId: DEF_B, star: 2, cell: { col: TEAM_0_MAX_COL, row: 5 } }],
    });
    const result = simulate(
      UNIT_DEFS,
      [room.buildTeamSetup(room.getPlayer('p1')!, 0), room.buildTeamSetup(room.getPlayer('p2')!, 1)],
      SEED,
    );
    return result.checksum;
  }

  const bare: Parameters<RoomInstance['submitTeam']>[1] = {
    units: [{ defId: DEF_A, star: 1, cell: { col: TEAM_0_MAX_COL, row: 4 } }],
  };

  it('A 类藏品（源石溶剂）让结果不一样', () => {
    const withItem = checksumWith({
      units: [{ defId: DEF_A, star: 1, cell: { col: TEAM_0_MAX_COL, row: 4 }, items: [ITEM_A] }],
    });
    expect(withItem).not.toBe(checksumWith(bare));
  });

  it('B 类属性型藏品（奇缘面具）让结果不一样', () => {
    const withItem = checksumWith({ ...bare, sharedItems: [ITEM_B] });
    expect(withItem).not.toBe(checksumWith(bare));
  });

  it('★ playerContext 真的被读到了（金酒之杯：金币不同 -> 结果不同）', () => {
    const units = [{ defId: DEF_A, star: 1, cell: { col: TEAM_0_MAX_COL, row: 4 } }];
    const poor = checksumWith({ units, sharedItems: [ITEM_GOLD], playerContext: { gold: 0, hp: 100 } });
    const rich = checksumWith({ units, sharedItems: [ITEM_GOLD], playerContext: { gold: 200, hp: 100 } });
    expect(poor).not.toBe(rich);
  });

  it('同样的输入永远得到同样的结果（确定性没被破坏）', () => {
    const team = {
      units: [{ defId: DEF_A, star: 1, cell: { col: TEAM_0_MAX_COL, row: 4 }, items: [ITEM_A] }],
      sharedItems: [ITEM_B],
      playerContext: { gold: 30, hp: 100 },
    };
    expect(checksumWith(team)).toBe(checksumWith(team));
  });
});

// ============================================================
//  ③ 端到端：真 WebSocket 走一遍
// ============================================================

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
    timeoutMs = 8000,
  ): Promise<Extract<ServerMessage, { t: T }>> {
    const existing = this.inbox.find((m) => m.t === type);
    if (existing) return Promise.resolve(existing as Extract<ServerMessage, { t: T }>);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`等待消息 ${type} 超时（${timeoutMs}ms）`)), timeoutMs);
      this.waiters.push({
        predicate: (m) => m.t === type,
        resolve: (m) => {
          clearTimeout(timer);
          resolve(m as Extract<ServerMessage, { t: T }>);
        },
      });
    });
  }

  all<T extends ServerMessage['t']>(type: T): Array<Extract<ServerMessage, { t: T }>> {
    return this.inbox.filter((m) => m.t === type) as Array<Extract<ServerMessage, { t: T }>>;
  }

  close(): void {
    this.socket.close();
  }
}

describe('★ 端到端：submitTeam 带上装备，battleStart 里必须看得见', () => {
  let handle: { wss: WebSocketServer; close: () => void };
  let port = 0;
  let host: TestClient;
  let guest: TestClient;

  beforeAll(async () => {
    handle = startServer(0, '127.0.0.1');
    if (!handle.wss.address()) {
      await new Promise<void>((resolve) => handle.wss.once('listening', () => resolve()));
    }
    const address = handle.wss.address();
    port = typeof address === 'object' && address ? address.port : 0;

    host = new TestClient(port);
    guest = new TestClient(port);
    await Promise.all([host.ready(), guest.ready()]);

    host.send({ t: 'createRoom', playerName: '房主' });
    const room = await host.waitFor('room');
    guest.send({ t: 'joinRoom', roomCode: room.room.code, playerName: '朋友' });
    await host.waitFor('room');
    guest.send({ t: 'setReady', ready: true });
    await host.waitFor('room');
    // ★ 0.3：这条测的不是盟约选秀，先把选秀关掉再开局（否则会停在 covenant 阶段）
    host.send({ t: 'updateSettings', settings: { covenants: false } });
    host.send({ t: 'startGame' });
    await host.waitFor('gameStarted');
  });

  afterAll(() => {
    host?.close();
    guest?.close();
    handle?.close();
  });

  it('★ 客户端推上去的 items / sharedItems / playerContext 会出现在 battleStart 的阵容里', async () => {
    const team = {
      units: [{ defId: DEF_A, star: 1, cell: { col: TEAM_0_MAX_COL, row: 4 }, items: [ITEM_A] }],
      sharedItems: [ITEM_B],
      playerContext: { gold: 33, hp: 100 },
    };
    // 两个人都推同一份（谁是队 0 由服务器配对决定，不在这份测试的关心范围内）
    host.send({ t: 'submitTeam', ...team });
    guest.send({ t: 'submitTeam', ...team });

    const battle = await host.waitFor('battleStart', 20000);

    // 两个队伍里至少有一队带着我们提交的装备
    const allUnits = [...battle.team0.units, ...battle.team1.units];
    const wornItems = allUnits.flatMap((unit) => unit.items ?? []);
    expect(wornItems, 'battleStart 里没看到干员身上的 A 类藏品').toContain(ITEM_A);

    const shared = [...(battle.team0.sharedItems ?? []), ...(battle.team1.sharedItems ?? [])];
    expect(shared, 'battleStart 里没看到共享藏品').toContain(ITEM_B);
  });
});
