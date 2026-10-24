/**
 * ============================================================
 *  ★ 0.2：范围爆炸特效事件（`bloom`）—— 内核侧那一半
 * ============================================================
 *
 * 【它是什么？】
 * 维什戴尔 3 星的技能给 6 发弹药，每一发都变成 **5×5 群体物理伤害**。
 * 渲染层要在那一格炸一片红黑色爆炸，但它**不能自己判断**"这一发是不是那个大招" ——
 * 判断的唯一真相在**数据表**里（`SkillStats.splash.fx`）。
 * 所以内核负责：数据里写了 `fx` 的溅射，就在结算完那一刻多报一条 `bloom`。
 *
 * 【为什么不能直接用 `zone` 事件？】
 * `zone`（范围白框）是**所有**溅射共用的：炮手羁绊的"周围四格"、彩蛋的"周围 8 格"
 * 都发它。而维什戴尔那套爆炸图是量着 5×5 画的，套到"周围四格"上会糊。
 * 所以两条事件分工不同：
 *   · `zone`  —— "打到了哪些格子"（所有范围伤害都有）
 *   · `bloom` —— "这一发是什么技能、该播哪套图"（只有数据里写了 `fx` 的才有）
 *
 * ============================================================
 *  ★ 这里钉死三件事
 * ============================================================
 *  1. 数据表：op45 3 星的溅射确实是 5×5 且写了 `fx: 'vishdal_bloom'`；
 *  2. 真打一场：那一发确实报出了 `bloom`，格子/半径/形状/名字都对；
 *  3. ★★ **纯表现层**：把 `bloom` 从日志里删掉，校验和一个字节都不变
 *     （联机靠校验和对账，加表现层事件绝不能让它变 —— 和 `slash` 同一条规矩）。
 */
import { describe, expect, it } from 'vitest';
import {
  MANA_MAX,
  SKILLS,
  TRAIT_DEFS,
  UNIT_DEFS,
  computeActiveTraitLevels,
  computeChecksum,
  computeTraitBonuses,
  computeUnitTraitBonuses,
  createBattle,
  resolveUnitMechanics,
  step,
  type BattleState,
  type TeamSetup,
  type UnitPlacement,
} from '../src/index.js';

function place(team: 0 | 1, defId: string, star: number, col: number, row: number): UnitPlacement {
  return { defId, star, cell: { col, row } };
}

/** 四个字段都要填（羁绊机制靠 unitMechanics 传进来） */
function team(teamId: 0 | 1, units: UnitPlacement[]): TeamSetup {
  return {
    team: teamId,
    units,
    traitBonuses: computeTraitBonuses(units, UNIT_DEFS, TRAIT_DEFS),
    unitTraitBonuses: computeUnitTraitBonuses(units, UNIT_DEFS, TRAIT_DEFS),
    activeTraits: computeActiveTraitLevels(units, UNIT_DEFS, TRAIT_DEFS),
    unitMechanics: resolveUnitMechanics(units, UNIT_DEFS, TRAIT_DEFS),
  };
}

// ------------------------------------------------------------------
// 1) 数据表
// ------------------------------------------------------------------

describe('★ 0.2 bloom：数据表里怎么标"这一发要播专属特效"', () => {
  it('★ op45 3 星的溅射是 5×5，并写了 fx = vishdal_bloom', () => {
    const star3 = SKILLS['op45']!.star3!;
    const buff = star3.effects.find((effect) => effect.kind === 'buff');
    expect(buff, 'op45 3 星应该是"给一段时间的 buff"').toBeTruthy();
    const splash = (buff as { stats: { splash?: Record<string, unknown> } }).stats.splash!;
    expect(splash, '前提：它有溅射').toBeTruthy();
    expect(splash.radius, 'radius 2 = 周围两格 = 5×5').toBe(2);
    expect(splash.shape).toBe('square');
    expect(
      splash.fx,
      '★ 特效写在数据里（渲染层按 defId 判断就是第二处真相）',
    ).toBe('vishdal_bloom');
  });

  it('★ 不是每个带溅射的干员都写 fx（没写就是"只闪范围白框"的老行为）', () => {
    const withFx: string[] = [];
    const withSplash: string[] = [];
    for (const [unitId, def] of Object.entries(SKILLS)) {
      const variants = [def, def.star3].filter(Boolean) as Array<{ effects: readonly unknown[] }>;
      for (const variant of variants) {
        for (const effect of variant.effects) {
          const stats = (effect as { stats?: { splash?: { fx?: string } } }).stats;
          if (!stats?.splash) continue;
          withSplash.push(unitId);
          if (stats.splash.fx) withFx.push(`${unitId}:${stats.splash.fx}`);
        }
      }
    }
    expect(withSplash.length, '前提：库里确实有别的溅射').toBeGreaterThan(1);
    /*
      ★ 0.2.1：写 `fx` 的现在有六个 —— 每一套都必须是**渲染层注册表里真有的 key**
      （`BLOOM_FX` 是夕/天火/维什戴尔/凯尔希/菲亚梅塔，`LETO_SCYTHE_FX` 是隐德来希的横扫）；
      名单钉死是为了防"随手给某个溅射加了 fx、图却没做"，那种情况游戏里什么都不放。
    */
    expect(withFx).toEqual([
      'op02:ink_cross_white', // 夕：十字白墨（3×3 里的十字，走 BLOOM_FX）
      'op12:skyfire_nova', // 天火：3×3 橙红大爆炸
      'op28:fiammetta_phoenix',
      'op40:leto_scythe_sweep',
      'op45:vishdal_bloom',
      'op46:kalts_nova',
    ]);
  });
});

// ------------------------------------------------------------------
// 2) 真打一场：事件真的出来了
// ------------------------------------------------------------------

/** 维什戴尔 3 星 + 一圈打不死的敌人（5×5 得有人，才看得出范围） */
function bloomBattle(seed = 20261017): BattleState {
  const units1: UnitPlacement[] = [
    place(1, 'mn_slime', 1, 5, 4),
    place(1, 'mn_slime', 1, 5, 5),
    place(1, 'mn_slime', 1, 6, 4),
  ];
  const state = createBattle(
    UNIT_DEFS,
    [team(0, [place(0, 'op45', 3, 3, 4)]), team(1, units1)],
    seed,
  );
  // 让敌人耐打一点：我们要的是"6 发弹药都打出去"，不是"几秒打完"
  for (const unit of state.units) {
    if (unit.team !== 1) continue;
    unit.maxHp = 9_000_000;
    unit.hp = unit.maxHp;
    unit.armor = 0;
    unit.magicResist = 0;
  }
  const cara = state.units.find((unit) => unit.defId === 'op45')!;
  cara.mana = MANA_MAX;
  return state;
}

describe('★ 0.2 bloom：真打一场', () => {
  it('★★ 弹药打出去的那一刻，日志里会出现 bloom 事件（格子/半径/形状/名字都对）', () => {
    const state = bloomBattle();
    for (let i = 0; i < 600 && !state.over; i++) step(state, UNIT_DEFS);

    const blooms = state.log.filter((event) => event.type === 'bloom');
    expect(blooms.length, '6 发弹药应该炸 6 次（至少得炸出来）').toBeGreaterThan(0);
    expect(blooms.length, '弹药就 6 发，别炸多了').toBeLessThanOrEqual(6);

    const cara = state.units.find((unit) => unit.defId === 'op45')!;
    for (const event of blooms) {
      expect(event.fx).toBe('vishdal_bloom');
      expect(event.radius, '5×5').toBe(2);
      expect(event.shape).toBe('square');
      // 爆炸中心必须是棋盘上的合法格子
      expect(event.cell.col).toBeGreaterThanOrEqual(0);
      expect(event.cell.col).toBeLessThan(10);
      expect(event.cell.row).toBeGreaterThanOrEqual(0);
      expect(event.cell.row).toBeLessThan(10);
      /*
        ★ "炸在谁身上"：同一 tick 里必须有维什戴尔打出来的伤害事件。
        （不写成"必须在敌方半场"—— 敌人会走过来，两边半场都可能有人。）
      */
      const sameTickDamage = state.log.some(
        (other) =>
          other.type === 'damage' && other.t === event.t && other.sourceId === cara.id,
      );
      expect(sameTickDamage, '爆炸必须和"这一发真的打出了伤害"落在同一 tick').toBe(true);
    }
  });

  it('★ 6 发弹药 = 最多炸 6 次（打光就不再炸）', () => {
    const state = bloomBattle();
    for (let i = 0; i < 600 && !state.over; i++) step(state, UNIT_DEFS);
    const blooms = state.log.filter((event) => event.type === 'bloom').length;
    const ammoUsed = state.log.filter(
      (event) => event.type === 'status' && (event as { kind?: string }).kind === 'ammo',
    ).length;
    // 弹药消耗不一定有专门的 status 事件，所以这条只做上界判断
    expect(blooms).toBeLessThanOrEqual(6);
    void ammoUsed;
  });

  it('★★ 纯表现层：把 bloom 从日志里删掉，校验和一字节都不变', () => {
    /*
      【为什么必须钉？】
      联机靠校验和对账（服务端和客户端各算一遍，不一样就判分叉）。
      往事件流里加东西第一反应就应该是"会不会把校验和改了"。
      所以 `bloom` 必须在 `computeChecksum` 里被跳过（见 combat-math.ts）。
    */
    const state = bloomBattle();
    for (let i = 0; i < 600 && !state.over; i++) step(state, UNIT_DEFS);

    const removed = state.log.filter((event) => event.type === 'bloom').length;
    expect(removed, '这一段里应该炸过，不然这条测试没意义').toBeGreaterThan(0);

    const withBloom = computeChecksum(state, state.winner, state.tick);
    state.log = state.log.filter((event) => event.type !== 'bloom');
    const without = computeChecksum(state, state.winner, state.tick);
    expect(withBloom).toBe(without);
  });

  it('★ 没有 fx 的溅射一个 bloom 都不发（炮手羁绊只是范围伤害，不是大招）', () => {
    /*
      炮手羁绊给的是"攻击溅射"，走的是同一段代码但数据里没写 `fx`。
      它一条 bloom 都不该发 —— 否则维什戴尔那套 5×5 的图会被套到炮手上。
    */
    const teams: [TeamSetup, TeamSetup] = [
      team(0, [
        place(0, 'op14', 3, 2, 4),
        place(0, 'op15', 3, 2, 5),
        place(0, 'op16', 3, 2, 6),
      ]),
      team(1, [place(1, 'mn_slime', 1, 5, 4), place(1, 'mn_slime', 1, 6, 4)]),
    ];
    const state = createBattle(UNIT_DEFS, teams, 99);
    for (let i = 0; i < 400 && !state.over; i++) step(state, UNIT_DEFS);

    // 前提：这三个棋子至少有人真的打出了范围伤害（有 zone 事件）
    const zones = state.log.filter((event) => event.type === 'zone').length;
    expect(zones, '前提：这一场里确实发生过范围伤害').toBeGreaterThan(0);
    expect(
      state.log.filter((event) => event.type === 'bloom').length,
      '★ 数据里没写 fx 的溅射不该播专属爆炸',
    ).toBe(0);
  });
});
