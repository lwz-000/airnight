/**
 * ============================================================
 *  ★ 0.1.4：隐匿（原「隐秘」）
 * ============================================================
 *
 * 【你的规则原文】
 *   「不会成为棋子的锁敌目标（也不会走向有隐匿的单位），但会被 AOE 技能伤害到」
 *
 * 这三句话分别落在**三个不同的地方**，所以这个文件一条一条钉：
 *
 * | 规则 | 实现处 |
 * |---|---|
 * | ① 不被锁敌 | `canTargetUnit` → `selectTarget`（普攻选目标） |
 * | ② 不被走向 | `nearestApproachTarget`（"打不到时朝谁走"的那个兜底） |
 * | ③ 会被 AOE 打到 | 范围伤害**不过** `canTargetUnit`，直接遍历范围内单位 |
 *
 * 【为什么②要单独钉？】
 * 那个兜底函数当年是为了修「1 攻击距离的单位锁不到飞行单位就挂机」才加的 ——
 * 它的口径是"**无视射程免疫**，走过去"。隐匿的要求正好相反（**连走都不要走**），
 * 两者混在一起，很容易在改动时把对方弄坏。
 * 所以这里既有"隐匿不被走向"，也有"飞行仍然会被走向"（回归）。
 *
 * 【为什么用真战斗而不是造假状态？】
 * 因为这三条都是"跨模块的联动"（修正包 → 选目标 → 走位 / 溅射），
 * 造一个假 state 只能证明我造的那个假 state 是对的。
 */
import { describe, expect, it } from 'vitest';
import {
  EFFECT_DEFS,
  TRAIT_DEFS,
  UNIT_DEFS,
  activeEffectsOf,
  collectMods,
  computeActiveTraitLevels,
  computeTraitBonuses,
  computeUnitTraitBonuses,
  createBattle,
  nearestApproachTarget,
  resolveUnitMechanics,
  selectTarget,
  step,
  type BattleState,
  type TeamSetup,
  type UnitPlacement,
  type UnitState,
} from '../src/index.js';

/** 开局 10 秒（200 tick）自带隐匿的野怪：深池伙友影刃精英，技能「影匿」 */
const HIDDEN = 'mn_dushdo';

function place(team: 0 | 1, defId: string, col: number, row: number): UnitPlacement {
  return { defId, star: 1, cell: { col, row } };
}

/**
 * 一支队伍 —— **四个字段都要填**（和真实客户端 `toTeamSetup` 一致）。
 *
 * 【为什么不能只写 units？】
 * 羁绊的**机制**（炮手的溅射、飞行的"打不到"）不是内核自己算的，
 * 是调用方通过 `unitMechanics` 传进来的。只写 `units` 的话，
 * "炮手溅射"这条根本不存在 —— 第一次写这个测试就踩了：
 * 隐匿单位一点血都没掉，看着像 bug，其实是测试没把羁绊接上。
 */
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

/** 造一场战斗：team0 放左半场，team1 放右半场 */
function battle(units0: UnitPlacement[], units1: UnitPlacement[], seed = 1): BattleState {
  return createBattle(UNIT_DEFS, [team(0, units0), team(1, units1)], seed);
}

function unitOf(state: BattleState, defId: string): UnitState {
  const unit = state.units.find((item) => item.defId === defId);
  if (!unit) throw new Error(`场上没有 ${defId}`);
  return unit;
}

/** 按羁绊标签找几个不同的单位（不写死 id —— 名单以后会换） */
function unitsWithTrait(trait: string, count: number): string[] {
  return Object.values(UNIT_DEFS)
    .filter((def) => def.traits.includes(trait))
    .map((def) => def.id)
    .sort()
    .slice(0, count);
}

describe('★ 0.1.4 隐匿：名字与说明', () => {
  it('改名成「隐匿」，说明里三件事都写清了', () => {
    const def = EFFECT_DEFS.stealth;
    expect(def.name, '原「隐秘」要改成「隐匿」').toBe('隐匿');
    expect(def.desc, '要说清"不被锁敌"').toContain('锁敌');
    expect(def.desc, '要说清"也不会被走向"').toContain('走向');
    expect(def.desc, '要说清"仍然会被范围技能打到"（否则玩家会当成无敌）').toContain('范围');
  });

  it('修正包 → 状态分类的映射没变（卡面上那个👻还是它）', () => {
    const state = battle([place(0, 'mn_slime', 4, 4)], [place(1, HIDDEN, 5, 4)]);
    const hidden = unitOf(state, HIDDEN);
    const mods = collectMods(state, hidden);
    expect(mods.untargetable).toBe(true);
    expect(activeEffectsOf(mods, hidden).map((e) => e.kind)).toContain('stealth');
  });
});

describe('★ 0.1.4 隐匿：① 不会被锁敌', () => {
  it('场上只有隐匿单位时，普攻选不出目标', () => {
    const state = battle([place(0, 'mn_slime', 4, 4)], [place(1, HIDDEN, 5, 4)]);
    const slime = unitOf(state, 'mn_slime');
    const hidden = unitOf(state, HIDDEN);
    expect(collectMods(state, hidden).untargetable, '前提：它此刻真的是隐匿').toBe(true);
    expect(selectTarget(state, slime), '锁敌必须跳过隐匿单位').toBe(-1);
  });

  it('旁边有非隐匿单位时，会去打那个（隐匿不干扰正常锁敌）', () => {
    const state = battle(
      [place(0, 'mn_slime', 4, 4)],
      [place(1, HIDDEN, 5, 4), place(1, 'mn_slime', 5, 5)],
    );
    const attacker = unitOf(state, 'mn_slime');
    const visible = state.units.find((u) => u.team === 1 && u.defId === 'mn_slime')!;
    expect(selectTarget(state, attacker), '该打那个能打的').toBe(visible.id);
  });

  it('隐匿过期之后又能被锁敌了（增益是按 tick 掉的）', () => {
    const state = battle([place(0, 'mn_slime', 4, 4)], [place(1, HIDDEN, 5, 4)]);
    const slime = unitOf(state, 'mn_slime');
    const hidden = unitOf(state, HIDDEN);
    // 把这条增益的剩余时间压到 1 帧，再走一帧
    hidden.skill!.buffs[0]!.ticksLeft = 1;
    step(state, UNIT_DEFS);
    expect(collectMods(state, hidden).untargetable).toBe(false);
    expect(selectTarget(state, slime)).toBe(hidden.id);
  });
});

describe('★ 0.1.4 隐匿：② 也不会走向它', () => {
  it('走路兜底也要跳过隐匿单位（返回 -1）', () => {
    const state = battle([place(0, 'op11', 0, 5)], [place(1, HIDDEN, 9, 5)]);
    const me = unitOf(state, 'op11');
    expect(
      nearestApproachTarget(state, me),
      '隐匿单位不属于"打不到但可以走过去"，它属于"根本不该走向"',
    ).toBe(-1);
  });

  it('★ 行为层：敌方只有隐匿单位时，我方近战原地不动（不会傻走过去）', () => {
    const state = battle([place(0, 'op11', 0, 5)], [place(1, HIDDEN, 9, 5)]);
    const me = unitOf(state, 'op11');
    const from = { ...me.cell };
    for (let i = 0; i < 80; i++) {
      if (state.over) break;
      step(state, UNIT_DEFS);
    }
    expect(me.cell, '这段时间里它一步都不该动').toEqual(from);
  });
});

describe('★ 0.1.4 隐匿：③ 仍然会被 AOE 伤害到', () => {
  it('炮手溅射会打到旁边的隐匿单位（它从头到尾不是直接目标）', () => {
    /*
      场景：两个炮手（羁绊第 1 档 = 攻击溅射半径 1、倍率 15%）+ 一个普通敌人 + 一只隐匿野怪。
      炮手只会锁那个普通敌人（隐匿的锁不到），但溅射会把隐匿的那只一起打掉血 ——
      这正是"会被 AOE 技能伤害到"。
    */
    const cannons = unitsWithTrait('cannon', 2);
    expect(cannons.length, '需要至少两个不同的炮手干员').toBe(2);

    const state = battle(
      [place(0, cannons[0]!, 4, 4), place(0, cannons[1]!, 4, 5)],
      // 普通敌人放 (5,4)，隐匿野怪贴在它旁边 (5,5) —— 溅射半径 1 正好够到
      [place(1, 'mn_slime', 5, 4), place(1, HIDDEN, 5, 5)],
    );
    const cannon = unitOf(state, cannons[0]!);
    const hidden = unitOf(state, HIDDEN);

    expect(collectMods(state, hidden).untargetable, '前提：它此刻真的是隐匿').toBe(true);
    expect(selectTarget(state, cannon), '炮手锁不到隐匿那只').not.toBe(hidden.id);

    const hpBefore = hidden.hp;
    for (let i = 0; i < 120; i++) {
      if (state.over) break;
      step(state, UNIT_DEFS);
    }
    expect(hidden.hp, '溅射应该已经打到它了（这就是 AOE 和"不被锁敌"的区别）').toBeLessThan(hpBefore);
  });
});

describe('★ 0.1.4 隐匿：别把"飞行"那条回归弄坏', () => {
  it('敌方全是飞行单位时，近战仍然会朝它们走过去（当年修过的 bug）', () => {
    /*
      飞行是"打不到，但可以走过去"（射程免疫），隐匿是"根本不该走向"。
      两者的筛选口径不一样，这条守住"改隐匿的时候顺手把飞行弄坏"。
    */
    const flying = unitsWithTrait('flying', 2);
    expect(flying.length, '需要两个不同的飞行干员才能开出飞行羁绊').toBe(2);

    const state = battle(
      [place(0, 'op11', 0, 5)],
      [place(1, flying[0]!, 9, 4), place(1, flying[1]!, 9, 5)],
    );
    const me = unitOf(state, 'op11');
    const flyingIds = state.units.filter((u) => u.team === 1).map((u) => u.id);

    expect(
      nearestApproachTarget(state, me),
      '飞行单位打不到，但兜底仍然要走向它们（否则又变回"原地罚站到死"）',
    ).toBeGreaterThanOrEqual(0);
    expect(flyingIds).toContain(nearestApproachTarget(state, me));
  });
});
