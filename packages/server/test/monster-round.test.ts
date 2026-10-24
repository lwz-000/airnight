/**
 * ============================================================
 *  ★ 0.0.3 联机「野怪回合」端到端测试
 * ============================================================
 *
 * 【为什么要单独一份？】
 * 0.0.3 起第 1、2 回合就是野怪回合（对手是一波野怪，不是真人）。
 * 其它联机测试都设了 `AIRNIGHT_START_ROUND=3` 躲开野怪，
 * 于是"野怪回合到底跑不跑得通"就没人管了 —— 这份专门管它。
 *
 * 钉住三件事：
 *   ① 开局第 1 回合，每个存活玩家都收到**自己**那一场 battleStart，
 *      对手是野怪（team1PlayerId = 'monster'，带 monsterWave 文案）；
 *   ② 队伍 1 里的棋子**全是野怪**（monsterOnly），不会混进人机干员；
 *   ③ 结算走"只动这一个玩家"那条路：输了扣自己的血，野怪那边没有对象。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket, type WebSocketServer } from 'ws';
import {
  MONSTER_PLAYER_ID,
  TEAM_0_MAX_COL,
  UNIT_DEFS,
  SERVER_VERSION,
  decodeMessage,
  isMonsterRound,
  type ClientMessage,
  type ServerMessage,
  type UnitPlacement,
} from '../../shared/src/index.js';

process.env.AIRNIGHT_NO_AUTOSTART = '1';
// 布阵压到 1 秒，不然每个场景都要真等 60 秒
process.env.AIRNIGHT_PREP_SECONDS = '2';
// ★ 这里**不设** AIRNIGHT_START_ROUND —— 要的就是第 1 回合（野怪回合）
const { startServer } = await import('../src/main.js');
const { Room } = await import('../src/room.js');
type RoomInstance = InstanceType<typeof Room>;

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

/** 一个合法的阵容（按费用取干员，不写死名字） */
function testTeam(): UnitPlacement[] {
  const ids = Object.keys(UNIT_DEFS).sort();
  return [
    { defId: ids[0]!, star: 1, cell: { col: TEAM_0_MAX_COL, row: 2 } },
    { defId: ids[1]!, star: 1, cell: { col: 0, row: 5 } },
  ];
}

describe('★ Room 层：野怪回合的战斗怎么造', () => {
  function makeRoom(): RoomInstance {
    const room = new Room('WAVE01', 'p1', 'A');
    room.addPlayer('p2', 'B');
    room.startGame(); // 默认起始回合 = 1 => 野怪回合
    return room;
  }

  it('第 1 回合确实是野怪回合', () => {
    const room = makeRoom();
    expect(room.round).toBe(1);
    expect(isMonsterRound(room.round)).toBe(true);
  });

  it('createMonsterBattle：自己在队伍 0，队伍 1 全是野怪', () => {
    const room = makeRoom();
    const player = room.getPlayer('p1')!;
    player.team = { units: testTeam() };

    const battle = room.createMonsterBattle(player);
    expect(battle.team0.units).toEqual(player.team.units);
    expect(battle.team1.units.length).toBeGreaterThan(0);
    for (const unit of battle.team1.units) {
      expect(UNIT_DEFS[unit.defId]?.monsterOnly, `${unit.defId} 不是野怪`).toBe(true);
      // 野怪必须站在右半边，否则 createBattle 会报"棋子放错半场"
      expect(unit.cell.col).toBeGreaterThanOrEqual(5);
    }
  });

  it('battleId 带 wave 后缀（和真人配对、影子都区分得开）', () => {
    const room = makeRoom();
    const battle = room.createMonsterBattle(room.getPlayer('p1')!);
    expect(battle.battleId).toContain('-wave');
  });

  /**
   * ★★ 0.1.3：野怪回合里**每一场**的 battleId 必须各不相同。
   *
   * 【修的是什么】以前是 `${code}-R${round}-wave`，全房间**共用一个 id**。
   * 而客户端的观战列表是一个 `Map<battleId, 战斗>` —— 每收到一场就覆盖上一场，
   * 最后只剩一条 ⇒ `battles.length >= 2` 永远不成立 ⇒
   * **野怪回合根本看不到别人的战斗**（用户报的）。
   */
  it('★ 每个人那一场是**不同的** battleId（否则客户端观战列表会互相覆盖）', () => {
    const room = makeRoom();
    const a = room.createMonsterBattle(room.getPlayer('p1')!);
    const b = room.createMonsterBattle(room.getPlayer('p2')!);
    expect(a.battleId).not.toBe(b.battleId);
    expect(a.battleId).toContain('-wave');
    expect(b.battleId).toContain('-wave');
  });

  it('★ 结算只动参战的那个人（野怪那边没有「被扣血」的对象）', () => {
    const room = makeRoom();
    // 挑一个**扣血量 > 0** 的野怪回合：第 1、2 回合的 damageForRound 是 0
    // （前期不让玩家掉血），拿它测"扣血"会得到一个 0 对 0 的假通过。
    room.round = 9;
    const p1 = room.getPlayer('p1')!;
    const p2 = room.getPlayer('p2')!;
    // ★ 必须先把血量抄下来：p1 是**同一个对象**，applyGhostResult 会就地改它，
    //   后面再读 p1.hp 拿到的是改完之后的值（第一版就是这么假通过的）。
    const hpBeforeP1 = p1.hp;
    const hpBefore = p2.hp;

    // winner = 1 表示「队伍 1（野怪）赢了」= 玩家输
    const hpAfter = room.applyGhostResult(1, 'p1');
    expect(hpAfter['p1']).toBeLessThan(hpBeforeP1);
    expect(p2.hp, '另一个玩家的血一个字都不该动').toBe(hpBefore);
  });
});

describe('★ 端到端：第 1 回合两边都打野怪', () => {
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
    await host.waitFor('room', 5000);

    guest.send({ t: 'setReady', ready: true });
    await host.waitFor('room', 5000);
    // ★ 0.3：这条测的不是盟约选秀，先把选秀关掉再开局（否则会停在 covenant 阶段）
    host.send({ t: 'updateSettings', settings: { covenants: false } });
    host.send({ t: 'startGame' });
    await host.waitFor('gameStarted', 8000);

    /*
      开局之后要**马上**把阵容推上去：布阵是定时制（测试里压到 2 秒），
      时间一到服务器就拿"最后同步过来的阵容"开打 —— 不推的话两边都是空阵容，
      battleStart 里的 units 会是空的（第一版测试就是这么假通过的）。
    */
    host.send({ t: 'submitTeam', units: testTeam() });
    guest.send({ t: 'submitTeam', units: testTeam() });
  });

  afterAll(() => {
    host?.close();
    guest?.close();
    handle?.close();
  });

  it('★ 每个玩家都收到一场「自己 vs 野怪」的战斗', async () => {
    const mine = await host.waitFor('battleStart', 12000);
    expect(mine.team0PlayerId).toBe(host.playerId);
    expect(mine.team1PlayerId).toBe(MONSTER_PLAYER_ID);
    expect(mine.monsterWave, '野怪回合要带上波次文案').toContain('源石虫');
    // 队伍 1 全是野怪
    for (const unit of mine.team1.units) {
      expect(UNIT_DEFS[unit.defId]?.monsterOnly).toBe(true);
    }
    expect(mine.team0.units.length).toBeGreaterThan(0);
  });

  it('★ 两个人各有一场（不是共用一场）', async () => {
    // 先确认两边都收到了（广播是异步的，可能这边先到那边后到）
    await guest.waitFor('battleStart', 12000);
    const mine = host.all('battleStart');
    const theirs = guest.all('battleStart');
    expect(mine.length).toBeGreaterThan(0);
    expect(theirs.length).toBeGreaterThan(0);
    // 广播是给全房间的，所以两边看到的场次集合一致
    expect(new Set(mine.map((m) => m.battleId))).toEqual(new Set(theirs.map((m) => m.battleId)));
    // 每场都是"某个真人 vs 野怪"
    for (const battle of mine) {
      expect(battle.team1PlayerId).toBe(MONSTER_PLAYER_ID);
    }
  });

  it('★ 举手看完之后才结算（野怪回合也走同一条时序）', () => {
    for (const battle of host.all('battleStart')) {
      host.send({ t: 'playbackDone', battleId: battle.battleId });
      guest.send({ t: 'playbackDone', battleId: battle.battleId });
    }
    return Promise.all([host.waitFor('battleEnd', 12000), guest.waitFor('battleEnd', 12000)]).then(
      ([a, b]) => {
        expect(a.battleId).toContain('-wave');
        expect(b.battleId).toContain('-wave');
        expect([0, 1, null]).toContain(a.winner);
      },
    );
  });
});
