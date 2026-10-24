/**
 * ★★ 0.2：炎国羁绊的「燃烧」—— 叠层、刷新时长，以及卡面上怎么显示。
 *
 * ============================================================
 *  【这一组守的是什么？】（用户报："燃烧没有叠加和重复刷新时长的 bug"）
 * ============================================================
 * 这条羁绊的机制是"**每次攻击**给目标附着燃烧：每秒受到目标最大生命 1% 的法术伤害，
 * 最多 5 层，每次被附着刷新持续时间（5 秒）"。它有两个容易静默坏掉的地方：
 *
 *  1. **内核**：每层是 `skill.timed` 里的一条独立 dot（`tag: 'burn'`）。
 *     原来只有"已经满 5 层"时才刷新时长，其余情况只新增 ——
 *     而"攻击间隔 ≈ 燃烧时长"（最常见的节奏：1 秒 1 刀 × 5 秒燃烧）下，
 *     每次攻击前刚好有一层到期 ⇒ 层数停在 4→5、刷新分支几乎永不执行，
 *     早附着的那几层一直挂在"还剩 1 跳"上。
 *  2. **卡面**：所有 dot 在界面上**按种类去重只留一条**，而留下的恰好是
 *     **最早那一层** ⇒ 5 层和 1 层长得一样，剩余时间还永远显示最小的那个。
 *
 * ============================================================
 *  【写这一组踩过的坑】
 * ============================================================
 *  · 靶子必须用"惰性靶子"（`mn_duholy` + 压平护甲魔抗、血量抬到打不死），
 *    否则护甲/护盾会把掉血量吃掉一部分，断言根本对不上（见 rework-0.2.test.ts）。
 *  · `statOverride.attackSpeed` 是**面板单位**：`1` = 1 刀/秒 = 20 tick 一刀。
 *    测试里"攻击间隔 ≈ 燃烧时长"这条关键节奏就靠它摆出来。
 *  · `resolveUnitMechanics` 走的是**真的羁绊链路**（不是手写机制数组）——
 *    这样"某个档位没把 burnStack 发下去"这种 bug 也一起被钉住。
 */
import { describe, expect, it } from 'vitest';
import {
  UNIT_DEFS,
  TRAIT_DEFS,
  activeEffectsOf,
  collectMods,
  createBattle,
  resolveUnitMechanics,
  step,
  type BattleState,
  type TeamSetup,
  type TimedEffect,
  type UnitDef,
  type UnitPlacement,
  type UnitState,
} from '../src/index.js';

const s = (seconds: number): number => Math.round(seconds * 20);

const byName = (name: string): UnitDef => {
  const def = Object.values(UNIT_DEFS).find((d) => d.name === name);
  if (!def) throw new Error(`找不到干员「${name}」——名字改过？`);
  return def;
};

/** 惰性靶子：没有技能、没有羁绊，护甲/魔抗压成 0，血量抬到打不死 */
const dummy = (col: number, row: number): UnitPlacement => ({
  defId: 'mn_duholy',
  star: 3,
  cell: { col, row },
  statOverride: { hp: 100_000_000, armor: 0, magicResist: 0, attackSpeed: 0.1 },
});

/** 三个炎国干员（凑出炎 3 档）+ 一个站桩靶子，走真实羁绊链路 */
function yanBoard(attackSpeed = 1): { state: BattleState; target: UnitState; attacker: UnitState } {
  const team0: UnitPlacement[] = [
    { defId: 'op21', star: 1, cell: { col: 4, row: 4 }, statOverride: { attackSpeed } },
    { defId: 'op42', star: 1, cell: { col: 2, row: 2 } },
    { defId: 'op48', star: 1, cell: { col: 2, row: 6 } },
  ];
  const unitMechanics = resolveUnitMechanics(team0, UNIT_DEFS);
  const setups: [TeamSetup, TeamSetup] = [
    { team: 0, units: team0, playerContext: { gold: 0, hp: 100 }, unitMechanics },
    { team: 1, units: [dummy(5, 4)], playerContext: { gold: 0, hp: 100 } },
  ];
  const state = createBattle(UNIT_DEFS, setups, 20261016);
  /*
    ★ 另外两个炎国干员只用来**凑羁绊人数**，不让它们参战：
    它们会自己走进射程然后一起砍，攻击频率变成三倍 ——
    那样"攻击间隔 ≈ 燃烧时长"这条关键节奏就摆不出来了（三条 bug 都是被这个掩盖的）。
    做法：把它们的"下一次行动"推到很远之后（内核只认这一个计时器，移动和攻击都归它管）。
  */
  for (const unit of state.units) {
    if (unit.team === 0 && unit.defId !== 'op21') unit.nextActionTick = 100_000;
  }
  return {
    state,
    target: state.units.find((unit) => unit.team === 1)!,
    attacker: state.units.find((unit) => unit.defId === 'op21')!,
  };
}

/** 靶子身上的燃烧层（内核里每层一条 dot，靠 `tag: 'burn'` 认人） */
const burnsOf = (unit: UnitState): TimedEffect[] =>
  (unit.skill?.timed ?? []).filter((entry) => entry.tag === 'burn');

describe('★ 0.2 炎羁绊的燃烧：数据本身要和表里说的一致', () => {
  it('炎 3 档：每层每秒 1% 最大生命、最多 5 层、持续 5 秒', () => {
    // 表里写的是"每秒受到目标最大生命 1% 的法术伤害，最多 5 层，每次被附着刷新持续时间（5 秒）"
    const tier = TRAIT_DEFS['yan']!.tiers.find((item) => item.count === 3)!;
    const burn = tier.mechanics!.find((item) => item.kind === 'burnStack');
    expect(burn, '炎 3 档要有 burnStack').toBeTruthy();
    if (burn?.kind !== 'burnStack') throw new Error('类型不对');
    // `perSecondBp` 是**万分比**（和 `*Bp` 一个口径）⇒ 100 = 1%
    expect(burn.perSecondBp, '每秒 1% 最大生命').toBe(100);
    expect(burn.maxStacks, '最多 5 层').toBe(5);
    expect(burn.durationTicks, '5 秒（20 tick/秒）').toBe(s(5));
  });

  it('炎国成员（陈 / 望 / 赤刃明霄陈）都从羁绊链路里拿到了 burnStack', () => {
    const placements: UnitPlacement[] = [
      { defId: 'op21', star: 1, cell: { col: 4, row: 4 } },
      { defId: 'op42', star: 1, cell: { col: 2, row: 2 } },
      { defId: 'op48', star: 1, cell: { col: 2, row: 6 } },
    ];
    const mech = resolveUnitMechanics(placements, UNIT_DEFS);
    for (const defId of ['op21', 'op42', 'op48']) {
      expect(
        mech[defId]?.some((item) => item.kind === 'burnStack'),
        `${defId} 身上要有燃烧机制`,
      ).toBe(true);
    }
  });
});

describe('★ 0.2 炎羁绊的燃烧：每层的伤害是最大生命的 1%', () => {
  it('一跳 = 靶子最大生命 × 1%（法术伤害）', () => {
    const { state, target } = yanBoard();
    const maxHp = target.maxHp;
    for (let i = 0; i < 60 && !state.over; i++) step(state, UNIT_DEFS);
    const layers = burnsOf(target);
    expect(layers.length, '打了几刀就该有几层').toBeGreaterThan(0);
    // 内部是定点数：伤害按 FIX 存，这里的 `amount` 就是"一条 dot 每次跳的伤害"
    expect(layers[0]!.amount, '每层每秒 = 最大生命的 1%').toBe(Math.floor((maxHp * 100) / 10000));
    expect(layers[0]!.damageType, '是法术伤害').toBe('magic');
    expect(layers[0]!.intervalTicks, '每秒一跳').toBe(20);
  });
});

describe('★ 0.2 炎羁绊的燃烧：叠层与「每次被附着刷新时长」', () => {
  it('持续攻击会叠到 5 层，且不会超过上限', () => {
    const { state, target } = yanBoard(2);
    let maxLayers = 0;
    for (let i = 0; i < s(30) && !state.over; i++) {
      step(state, UNIT_DEFS);
      maxLayers = Math.max(maxLayers, burnsOf(target).length);
    }
    expect(maxLayers, '最多就是 5 层').toBe(5);
  });

  it('★★ 攻击间隔 ≈ 燃烧时长（1 刀/秒 × 5 秒）时，每一刀都要把**所有**层刷满', () => {
    /*
      这是原来那条 bug 的**精确复现条件**：每 20 tick 一刀、每层也正好 20 tick 跳一次，
      于是每次攻击前刚好有一层到期 ⇒ 旧代码走的是"新增一层"而不是"刷新"，
      层数在 4↔5 之间来回，早附着的那几层会一直停在"还剩 1 跳"上。
      ★ 断言用"**每一刀**都刷新"而不是"曾经刷新过一次" ——
        旧代码在第 5 刀那一刻也能凑巧刷一次（那时刚好 5 层都在），
        只断言"曾经"会漏掉这条 bug（第一版就是这么写的，红不起来）。
    */
    const { state, target } = yanBoard(1);
    let checks = 0;
    let failures = 0;
    for (let i = 0; i < s(60) && !state.over; i++) {
      step(state, UNIT_DEFS);
      const attackedNow = state.log.some(
        (event) => event.type === 'attack' && event.t === state.tick && event.unitId <= 1000,
      );
      const layered = burnsOf(target);
      // 只看"打之前就已经有燃烧层"的那些刀（第一刀是建立层数，不算刷新）
      if (attackedNow && state.tick > s(10) && layered.length > 0) {
        checks++;
        if (!layered.every((entry) => entry.ticksLeft === 5)) failures++;
      }
    }
    expect(checks, '这一局里应该有很多刀可以检查').toBeGreaterThan(5);
    expect(failures, '★ 每一刀都必须把已有燃烧层的时长刷满').toBe(0);
    expect(burnsOf(target).length, '同时存在 5 层').toBe(5);
  });

  it('★ 停手之后：从**最后一次附着**起再持续 5 秒，然后整体消失', () => {
    const { state, target } = yanBoard(2);
    // 先打到满层
    for (let i = 0; i < s(20) && burnsOf(target).length < 5; i++) step(state, UNIT_DEFS);
    expect(burnsOf(target).length, '已经叠满').toBe(5);
    // "停手"：把**我方全部**棋子的下一次行动都推到很远之后 —— 不会再附着新的燃烧
    // （★ 三个炎国干员都会挂燃烧，只停一个没用；
    //   也**不能**只把攻击者挪走：它会自己走回来继续打）
    for (const unit of state.units) {
      if (unit.team === 0) unit.nextActionTick = state.tick + 10_000;
    }
    const startTick = state.tick;
    for (let i = 0; i < s(20) && burnsOf(target).length > 0; i++) step(state, UNIT_DEFS);
    const lastedTicks = state.tick - startTick;
    // 5 秒 = 100 tick（容差：各层 timer 错开，最后一层最多晚 20 tick 才跳完）
    expect(lastedTicks, '停手后再烧 5 秒左右').toBeGreaterThanOrEqual(s(5) - 2);
    expect(lastedTicks, '不该无限烧下去').toBeLessThanOrEqual(s(5) + 22);
  });
});

describe('★ 0.2 炎羁绊的燃烧：卡面状态格要能看出层数与刷新后的时长', () => {
  it('5 层聚合成**一条**「燃烧」，detail 写层数、剩余时间取最长的那层', () => {
    const { state, target } = yanBoard(2);
    for (let i = 0; i < s(20) && burnsOf(target).length < 5; i++) step(state, UNIT_DEFS);
    expect(burnsOf(target).length, '先叠满 5 层').toBe(5);

    const mods = collectMods(state, target);
    const effects = activeEffectsOf(mods, target, UNIT_DEFS[target.defId]);
    const burn = effects.filter((effect) => effect.kind === 'burn');
    expect(burn.length, '★ 5 层只占一条，不是 5 条也不是和"持续伤害"混在一起').toBe(1);
    expect(burn[0]!.name).toBe('燃烧');
    expect(burn[0]!.detail, '要写清层数，否则玩家看不出叠上去了').toContain('5 层');
    expect(
      effects.some((effect) => effect.kind === 'dot'),
      '★ 燃烧不该同时被显示成通用的「持续伤害」',
    ).toBe(false);
    expect(burn[0]!.duration?.kind).toBe('time');
    if (burn[0]!.duration?.kind !== 'time') throw new Error('类型不对');
    /*
      ★ 剩余时间取"最长的那层"= 刚刷新过的 5 秒。
      旧代码这里会读到"最早那层"（常常只剩 1 跳 = 1 秒），
      这正是用户看到的"时长没有重复刷新"。
    */
    expect(burn[0]!.duration!.ticksLeft, '显示的是刷新后的 5 秒').toBe(s(5));
  });

  it('只有 1 层时也显示「燃烧」，并且写的是 1 层', () => {
    const { state, target } = yanBoard(1);
    // 第一刀之后就停下来看（此时只有 1 层）
    for (let i = 0; i < s(1) + 2 && burnsOf(target).length === 0; i++) step(state, UNIT_DEFS);
    expect(burnsOf(target).length).toBe(1);
    const effects = activeEffectsOf(collectMods(state, target), target, UNIT_DEFS[target.defId]);
    const burn = effects.find((effect) => effect.kind === 'burn')!;
    expect(burn.detail).toContain('1 层');
  });

  it('没有燃烧时不该冒出「燃烧」这一条', () => {
    const { state, target } = yanBoard(1);
    step(state, UNIT_DEFS);
    const effects = activeEffectsOf(collectMods(state, target), target, UNIT_DEFS[target.defId]);
    expect(effects.some((effect) => effect.kind === 'burn')).toBe(false);
  });
});

void byName;
