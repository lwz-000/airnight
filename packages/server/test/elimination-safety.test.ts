/**
 * ============================================================
 *  ★ 0.1.1 多人模式的两条新规则（纯 Room 单测，不起服务器）
 * ============================================================
 *
 *  ① **淘汰 -> 牌全部还回共享牌库**
 *     以前出局的人手里那几张牌就那么扣着，剩下的玩家永远等不到 ——
 *     越到残局越明显（最后两个人怎么刷都刷不到想要的牌）。
 *     现在淘汰只有**一个**处置入口（`returnCardsToPool`），
 *     场上和备战席一起还，且必须"先还牌再清阵容"（顺序反了一张都还不了）。
 *
 *  ② **阵容丢失保底**
 *     客户端偶尔会把空阵容报上来（牌一时看不见，多为网络/同步抖动）。
 *     服务器保留每个人"本回合最近一次有效的阵容"，
 *     当前这份是空的就顶上 —— 但不能跨回合乱用（新回合空着就是空着）。
 *
 *  ③ 顺带钉住：`currentTeams()` 要把**备战席**一起广播出去
 *     （观战看得见对方的备战席，靠的就是这一步）。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Room } from '../src/room.js';
import {
  TRAIT_DEFS,
  UNIT_DEFS,
  copiesOf,
  playableDefs,
  poolSizeOf,
  simulate,
  type SubmittedTeam,
} from '../../shared/src/index.js';

function makeRoom(): Room {
  const room = new Room('TESTAA', 'p1', '甲');
  room.addPlayer('p1', '甲');
  room.addPlayer('p2', '乙');
  return room;
}

/** 拼一份"客户端报上来的原始阵容"（只写测试需要的那几个字段） */
function submit(
  units: Array<{ defId: string; star: number; col?: number; row?: number }>,
  bench: Array<{ defId: string; star: number; copies: number }> = [],
): SubmittedTeam {
  return {
    units: units.map((u, index) => ({
      defId: u.defId,
      star: u.star,
      cell: { col: u.col ?? 0, row: u.row ?? index },
    })),
    bench,
  };
}

describe('★ 0.1.1 淘汰：把牌还回共享牌库', () => {
  it('场上 + 备战席的牌一起还（2★ 还 3 张、备战席按上报的张数还）', () => {
    const room = makeRoom();
    const defId = 'op01';
    const total = poolSizeOf(defId);

    // 先让玩家"手里有牌"：正常游戏里是买东西时从牌库扣走的
    room.submitTeam('p1', submit([{ defId, star: 2 }], [{ defId, star: 1, copies: 1 }]));
    expect(room.takeFromPool(defId, copiesOf(2) + 1).ok, '这 4 张应该拿得出来').toBe(true);
    const before = room.poolRemaining()[defId]!;
    expect(before).toBe(total - 4);

    const player = room.getPlayer('p1')!;
    player.hp = 0;
    room.returnCardsToPool(player);

    expect(room.poolRemaining()[defId]!, '淘汰后这 4 张必须回到牌库').toBe(before + 4);
    expect(player.team, '还完牌之后不能再留着这份阵容（否则会被重复还）').toBeUndefined();
  });

  it('白送的棋子（copies = 0）一张都不还 —— 它本来就没从牌库拿过', () => {
    const room = makeRoom();
    const defId = 'op02';
    const total = poolSizeOf(defId);

    room.submitTeam('p1', submit([], [{ defId, star: 3, copies: 0 }]));
    const before = room.poolRemaining()[defId]!;
    expect(before, '一张都没被拿走').toBe(total);

    const player = room.getPlayer('p1')!;
    player.hp = 0;
    room.returnCardsToPool(player);

    expect(room.poolRemaining()[defId]!, '不能凭空把牌还多出来').toBe(total);
  });

  it('出局的人"预定"在商店里的牌也一起放掉', () => {
    const room = makeRoom();
    const defId = 'op03';
    room.setShopHeld('p1', [defId]);
    expect(room.poolHeld()[defId], '先确认它真的被占着').toEqual(['p1']);

    const player = room.getPlayer('p1')!;
    player.hp = 0;
    room.returnCardsToPool(player);

    expect(room.poolHeld()[defId], '人出局了，占着别人就刷不到了').toBeUndefined();
  });
});

describe('★ 0.1.1 阵容丢失保底', () => {
  it('同一回合里阵容突然变空 -> 用最近一次的有效阵容顶上', () => {
    const room = makeRoom();
    room.beginRound();
    room.submitTeam('p1', submit([{ defId: 'op01', star: 1 }, { defId: 'op02', star: 1 }]));
    // 客户端抖了一下，报了个空阵容上来
    room.submitTeam('p1', submit([]));

    const player = room.getPlayer('p1')!;
    expect(room.usedSafetyNet(player), '这一场应该用上兜底').toBe(true);
    expect(room.buildTeamSetup(player, 0).units, '开打用的必须是那份有效阵容').toHaveLength(2);
  });

  it('正常提交（非空）不触发兜底', () => {
    const room = makeRoom();
    room.beginRound();
    room.submitTeam('p1', submit([{ defId: 'op01', star: 1 }]));
    const player = room.getPlayer('p1')!;
    expect(room.usedSafetyNet(player)).toBe(false);
  });

  it('跨回合不作数：新回合还没摆就是空阵容（这是正常的中间状态）', () => {
    const room = makeRoom();
    room.beginRound();
    room.submitTeam('p1', submit([{ defId: 'op01', star: 1 }]));
    // 进入下一回合：player.team 会被清空（见 Room.beginRound）
    room.beginRound();

    const player = room.getPlayer('p1')!;
    expect(room.usedSafetyNet(player), '上一回合的阵容不能跨回合顶上来').toBe(false);
    expect(room.buildTeamSetup(player, 0).units).toHaveLength(0);
  });

  it('新一局开始会把上一局的"保底阵容"清掉', () => {
    const room = makeRoom();
    room.beginRound();
    room.submitTeam('p1', submit([{ defId: 'op01', star: 1 }]));
    room.resetPool();

    const player = room.getPlayer('p1')!;
    expect(player.lastGoodTeam, '新一局不能沿用上一局的牌').toBeUndefined();
    expect(room.usedSafetyNet(player)).toBe(false);
  });
});

describe('★ 0.1.1 观战：广播里要带上备战席', () => {
  it('currentTeams() 同时给出场上棋子和备战席', () => {
    const room = makeRoom();
    room.submitTeam(
      'p1',
      submit([{ defId: 'op01', star: 1 }], [{ defId: 'op04', star: 2, copies: 3 }]),
    );

    const teams = room.currentTeams();
    expect(teams.p1!.units, '场上棋子照旧').toHaveLength(1);
    expect(teams.p1!.bench, '备战席要一起广播（观战靠它）').toEqual([
      { defId: 'op04', star: 2, copies: 3 },
    ]);
    expect(teams.p2!.units).toHaveLength(0);
    expect(teams.p2!.bench).toEqual([]);
  });
});

describe('★ 0.1.1 淘汰的处置只有一个入口（源码级防回归）', () => {
  it('playerEliminated 只从 eliminatePlayer 里发；还牌只走 Room.markEliminated', () => {
    const src = readFileSync(fileURLToPath(new URL('../src/main.ts', import.meta.url)), 'utf8');
    const hits = [...src.matchAll(/t: 'playerEliminated'/g)];
    expect(
      hits,
      '淘汰有三个触发点（野怪回合 / 真人配对 / 影子对战），广播必须收在一处 —— 分三处写必然漏掉"还牌 + 广播牌库"',
    ).toHaveLength(1);
    expect(src, '统一处置函数要存在').toContain('function eliminatePlayer');
    expect(
      src,
      '还牌 + 快照阵容走 Room.markEliminated（顺序在里面写死，外面不可能写反）',
    ).toContain('room.markEliminated(player)');

    const roomSrc = readFileSync(fileURLToPath(new URL('../src/room.ts', import.meta.url)), 'utf8');
    expect(roomSrc, '还牌的张数换算必须是 shared 的 poolCopiesOf（不许自己按星级写 1/3/9）').toContain(
      'poolCopiesOf(unit)',
    );
  });

  it('gameOver 广播里必须带上服务器算好的 standings', () => {
    const src = readFileSync(fileURLToPath(new URL('../src/main.ts', import.meta.url)), 'utf8');
    /*
      结算页的四样数据（排名 / 死亡阵容 / 羁绊 / 最高伤害）全在 standings 里。
      少传这一行 -> 结算页会安静地只剩一个空壳（客户端 `standings ?? []`），
      不报错、也不崩，最难查。所以这里钉死。
    */
    expect(src).toContain('standings: room.standings()');
    // 每场战斗都要顺手累计伤害，否则"本局最高伤害"永远是 0
    expect(src, '常规配对 + 野怪回合那一场都要记').toContain('room.recordBattleDamage(player0Id, result.log, 0)');
    expect(src, '轮空打影子那一场也要记').toContain('room.recordBattleDamage(ghost.player.id, result.log, 0)');
  });
});

describe('★ 0.1.1 结算数据（standings：排名 / 阵容 / 羁绊 / 最高伤害）', () => {
  it('淘汰时**先快照阵容再还牌** —— 结算页才拿得到"死亡时的阵容"', () => {
    const room = makeRoom();
    room.beginRound();
    room.submitTeam(
      'p1',
      submit(
        [
          { defId: 'op01', star: 1 },
          { defId: 'op02', star: 2 },
        ],
        [{ defId: 'op03', star: 1, copies: 1 }],
      ),
    );
    const player = room.getPlayer('p1')!;
    const defId = 'op01';
    expect(room.takeFromPool(defId, 4).ok).toBe(true);
    const poolBefore = room.poolRemaining()[defId]!;

    player.hp = 0;
    room.markEliminated(player);

    expect(player.finalLineup, '阵容必须留一份（还牌会把它清掉，顺序反了就没了）').toHaveLength(2);
    expect(player.eliminatedRound, '淘汰回合要记下来（排名次要用）').toBe(room.round);
    expect(player.team, '牌已经还回去了，阵容记录也该清掉').toBeUndefined();
    expect(room.poolRemaining()[defId]!).toBeGreaterThan(poolBefore);
  });

  it('名次：活着的排第一，其余按淘汰回合从晚到早', () => {
    const room = makeRoom();
    room.addPlayer('p3', '丙');
    room.beginRound();
    const a = room.getPlayer('p1')!;
    const b = room.getPlayer('p2')!;
    const c = room.getPlayer('p3')!;
    a.hp = 0;
    a.eliminatedRound = 2;
    b.hp = 0;
    b.eliminatedRound = 5;
    c.hp = 30; // 活到最后 = 冠军

    const standings = room.standings();
    expect(standings.map((s) => s.playerId)).toEqual(['p3', 'p2', 'p1']);
    expect(standings.map((s) => s.rank)).toEqual([1, 2, 3]);
    expect(standings[0]!.eliminatedRound, '冠军没有淘汰回合').toBeNull();
    expect(standings[1]!.eliminatedRound).toBe(5);
  });

  it('阵容按**费用从低到高**排好（同费用星级高的在前）', () => {
    const room = makeRoom();
    room.beginRound();
    const defs = playableDefs();
    const cheap = defs.find((d) => d.cost === 1)!;
    const pricey = defs.find((d) => d.cost === 5) ?? defs.find((d) => d.cost === Math.max(...defs.map((x) => x.cost)))!;
    // 故意反着提交：贵的在前、便宜的在后
    room.submitTeam(
      'p1',
      submit([
        { defId: pricey.id, star: 1, row: 0 },
        { defId: cheap.id, star: 2, row: 1 },
      ]),
    );

    const lineup = room.standings()[0]!.lineup;
    const costs = lineup.map((u) => UNIT_DEFS[u.defId]!.cost);
    expect(costs, '必须是升序').toEqual([...costs].sort((x, y) => x - y));
    expect(costs[0], '最便宜的排最前').toBe(cheap.cost);
  });

  it('羁绊只发**已激活**的', () => {
    const room = makeRoom();
    room.beginRound();
    // 同一个羁绊凑够最低档才算激活；这里用两个同羁绊的干员来凑
    const withTraits = playableDefs().filter((d) => d.traits.length > 0);
    const first = withTraits[0]!;
    const traitId = first.traits[0]!;
    const sameTrait = withTraits.filter((d) => d.traits.includes(traitId));
    const need = TRAIT_DEFS[traitId]?.tiers[0]?.count ?? 2;
    const picked = sameTrait.slice(0, need);
    room.submitTeam(
      'p1',
      submit(picked.map((d, i) => ({ defId: d.id, star: 1, row: i }))),
    );

    const standing = room.standings()[0]!;
    expect(standing.traits.every((t) => t.activeAt > 0), '只发已激活的（activeAt 是生效档位）').toBe(true);
    if (picked.length >= need) {
      expect(standing.traits.map((t) => t.traitId), '凑齐了就该出现').toContain(traitId);
    }
  });

  it('整局伤害按干员归并，topUnit 是打得最多的那一个；假 id 不记账', () => {
    const room = makeRoom();
    room.beginRound();
    room.submitTeam(
      'p1',
      submit([
        { defId: 'op01', star: 1, row: 0 },
        { defId: 'op27', star: 1, row: 1 },
      ]),
    );
    room.submitTeam('p2', submit([{ defId: 'op16', star: 1, row: 0 }]));

    const team0 = room.buildTeamSetup(room.getPlayer('p1')!, 0);
    const team1 = room.buildTeamSetup(room.getPlayer('p2')!, 1);
    const result = simulate(UNIT_DEFS, [team0, team1], 987654);
    room.recordBattleDamage('p1', result.log, 0);
    room.recordBattleDamage('p2', result.log, 1);

    // 自己数一遍"队伍 0 打出的伤害"，和结算数据对账
    let expected = 0;
    for (const event of result.log) {
      if (event.type !== 'damage') continue;
      if (event.sourceId < 1000) expected += event.amount + event.absorbed;
    }

    const p1 = room.standings().find((s) => s.playerId === 'p1')!;
    const p2 = room.standings().find((s) => s.playerId === 'p2')!;
    expect(p1.totalDamage, '总伤害要和日志里加起来的完全一致').toBe(expected);
    expect(
      p1.totalDamage + p2.totalDamage,
      '这一场总得有人打出伤害（否则断言没意义）',
    ).toBeGreaterThan(0);
    if (expected > 0) {
      expect(p1.topUnit, '打过伤害就该挑得出最高的一位').not.toBeNull();
      expect(['op01', 'op27'], 'topUnit 只能是自己的干员').toContain(p1.topUnit!.defId);
      expect(p1.topUnit!.dealt).toBeLessThanOrEqual(p1.totalDamage);
    }

    // 影子 / 野怪那种假 id：查不到玩家，直接忽略
    const snapshot = room.standings().map((s) => s.totalDamage);
    room.recordBattleDamage('ghost', result.log, 1);
    room.recordBattleDamage('monster', result.log, 1);
    expect(room.standings().map((s) => s.totalDamage)).toEqual(snapshot);
  });

  it('一点伤害都没有的玩家，topUnit 是 null（结算页要能显示"没有造成伤害"）', () => {
    const room = makeRoom();
    room.beginRound();
    room.submitTeam('p1', submit([{ defId: 'op01', star: 1 }]));
    const standing = room.standings()[0]!;
    expect(standing.topUnit).toBeNull();
    expect(standing.totalDamage).toBe(0);
  });
});

// ============================================================
//  ★★ 0.2.1：淘汰的玩家不能用商店（用户报的严重 bug）
// ============================================================

describe('★★ 0.2.1 淘汰之后：商店对他关闭（服务端也要拒）', () => {
  /*
    【用户口径（2026-10-17）】「淘汰后的人也能使用商店，修改为淘汰的人不能使用商店，
    商店不会对淘汰的人开放」。

    【为什么服务端必须也判一次？】
    淘汰那一刻 `markEliminated` 已经把他的牌**全部还回共享牌库**。
    他再买 -> 同一张牌卖给第二个人（牌库超发）；
    他再卖 -> 已经还过的牌再还一次（牌库凭空多牌）。
    客户端那边已经把商店整块关掉了，但那拦不住改过的客户端。
  */
  it('Room.isEliminated：血量归零 / 记了淘汰回合 -> true，查不到的 id -> false', () => {
    const room = makeRoom();
    const p2 = room.getPlayer('p2')!;
    expect(room.isEliminated('p2'), '开局都活着').toBe(false);

    p2.hp = 0;
    expect(room.isEliminated('p2'), '血量归零就是淘汰').toBe(true);

    p2.hp = 30;
    p2.eliminatedRound = 4;
    expect(room.isEliminated('p2'), '记过淘汰回合也算（血量还没结算完的那一瞬间）').toBe(true);

    expect(room.isEliminated('ghost'), '影子/野怪的假 id 不能被当成淘汰').toBe(false);
  });

  it('真淘汰（markEliminated）之后 isEliminated 为真，且他的牌已经回库', () => {
    const room = makeRoom();
    room.beginRound();
    room.submitTeam('p2', submit([{ defId: 'op01', star: 1 }]));
    const p2 = room.getPlayer('p2')!;
    p2.hp = 0;
    room.markEliminated(p2);
    expect(room.isEliminated('p2')).toBe(true);
    expect(p2.eliminatedRound, '记下了淘汰回合').toBeTypeOf('number');
  });

  it('源码级：buyCard / sellCard 两个入口都必须先过 isEliminated', () => {
    const src = readFileSync(fileURLToPath(new URL('../src/main.ts', import.meta.url)), 'utf8');
    /*
      ★ 钉"两个方向"：买（少给牌）和卖（多给牌）都会把共享牌库搞乱。
      这两个 case 各自都要有 `room.isEliminated(connection.playerId)` 的闸门 ——
      只挡住一个就是留了半个后门。
    */
    const buy = src.slice(src.indexOf("case 'buyCard'"), src.indexOf("case 'sellCard'"));
    expect(buy, 'buyCard 必须判淘汰').toContain('room.isEliminated(connection.playerId)');
    const sellStart = src.indexOf("case 'sellCard'");
    const sell = src.slice(sellStart, sellStart + 1200);
    expect(sell, 'sellCard 也必须判淘汰').toContain('room.isEliminated(connection.playerId)');
    // 判据本身只允许一处实现
    const roomSrc = readFileSync(fileURLToPath(new URL('../src/room.ts', import.meta.url)), 'utf8');
    expect(roomSrc, '判据唯一：Room.isEliminated').toContain('isEliminated(id: string): boolean');
    expect(
      [...src.matchAll(/player\.hp <= 0/g)].length,
      '别在 main.ts 里自己再写一遍"hp<=0 就是淘汰"（和 isEliminated 走散）',
    ).toBeLessThanOrEqual(1);
  });
});

describe('★ 0.3.4 观战：广播里要带上对方的藏品栏（只读）', () => {
  it('currentTeams() 把 itemState.bag 和 sharedItems 合成定长视图', () => {
    const room = makeRoom();
    room.submitTeam('p1', {
      // 场上一个、备战席一个（观战看棋盘要用）
      units: [{ defId: 'op01', star: 1, cell: { col: 0, row: 0 } }],
      bench: [{ defId: 'op04', star: 1, copies: 3 }],
      // 存放区：A 类 2 件、B 类 1 件；共享装备位 1 件
      sharedItems: ['itm_a', null, null, null],
      itemState: {
        bag: {
          a: ['itm_x', null, 'itm_y'],
          b: [null, 'itm_z'],
          cert: ['cert_qingse'],
        },
      },
    } as SubmittedTeam);

    const teams = room.currentTeams();
    const items = teams.p1!.items;
    expect(items, '观战要拿得到藏品栏').toBeTruthy();
    // ★ 长度必须和客户端画格子用的常量一致（少一格就会错位）
    expect(items!.a).toHaveLength(10);
    expect(items!.b).toHaveLength(5);
    expect(items!.bEquip).toHaveLength(4);
    expect(items!.cert).toHaveLength(3);
    // 内容按原位置落座，空格子是 null
    expect(items!.a.slice(0, 3)).toEqual(['itm_x', null, 'itm_y']);
    expect(items!.b[1]).toBe('itm_z');
    expect(items!.bEquip[0]).toBe('itm_a');
    expect(items!.cert[0]).toBe('cert_qingse');
    // 没填的尾巴一律 null（界面不用判 undefined）
    expect(items!.a.slice(3).every((v) => v === null)).toBe(true);
  });

  it('没交过阵容的人也有一份定长空视图（不会是 undefined）', () => {
    const room = makeRoom();
    const items = room.currentTeams().p2!.items;
    expect(items).toBeTruthy();
    expect(items!.a.every((v) => v === null)).toBe(true);
    expect(items!.bEquip.every((v) => v === null)).toBe(true);
    expect(items!.cert.every((v) => v === null)).toBe(true);
  });
});
