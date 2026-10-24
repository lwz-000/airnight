/**
 * ============================================================
 *  ★ 0.2.2 剑士新机制：**开启技能时瞬移到血量最少的敌人面前并眩晕**
 * ============================================================
 *
 * 用户原话：「再给剑士添加一个新的机制：开启技能时会瞬移到血量最少的敌人面前格子
 * （若无位置则找最近的位置），并使这个敌人眩晕 0.5s/1s/3s」
 *
 * 【为什么单独一份测试？】
 * 这条机制横跨三层，而每一层"红了该改哪边"完全不同：
 *   ① 数据层 —— 三档的眩晕时长对不对（改的是 `trait-data.ts`）
 *   ② 内核层 —— 到底有没有真的跳过去、有没有真的把人晕住（改的是 `skills.ts`）
 *   ③ 口径层 —— 有没有"同一段眩晕算两遍"这类老坑（改的是回归）
 * 混在别的文件里，红一条也看不出该动哪里。
 *
 * ★ 这里**不测 `findEmptyNear` 的落点算法**（那是瞬移的公共实现，别处已经在盯），
 *   只测"剑士这条机制有没有正确地把落点/眩晕串起来"。
 */

import { describe, expect, it } from 'vitest';
import {
  TRAIT_DEFS,
  castSkill,
  cellDistance,
  collectMods,
  computeActiveTraitLevels,
  computeTraitBonuses,
  computeUnitTraitBonuses,
  createBattle,
  effectiveAttackDamage,
  effectiveAttackSpeed,
  moveStyleOf,
  resolveUnitMechanics,
  unitBaseStats,
  type SkillDef,
  type TeamSetup,
  type TraitDefTable,
  type UnitDef,
  type UnitDefTable,
} from '../src/index.js';

// ------------------------------------------------------------
//  合成数据（和 trait-rework-a.test.ts 同一套写法：机制从羁绊表真实解析出来）
// ------------------------------------------------------------

function makeDef(id: string, traits: string[], base: Partial<UnitDef['base']> = {}): UnitDef {
  const skill: SkillDef = {
    id: `${id}_skill`,
    name: `${id} 技能`,
    desc: '不做任何事（测试用）',
    effects: [],
    manaSource: 'attack',
  };
  return {
    id,
    name: id,
    cost: 1,
    traits,
    base: {
      hp: 1000,
      attackDamage: 100,
      attackSpeed: 1000,
      armor: 0,
      magicResist: 0,
      range: 1,
      manaPerAttack: 0,
      ...base,
    },
    starHpBp: 1000,
    starDamageBp: 1000,
    color: '#888888',
    sprite: id,
    skill,
  };
}

function tableOf(defs: UnitDef[]): UnitDefTable {
  const out: UnitDefTable = {};
  for (const def of defs) out[def.id] = def;
  return out;
}

function oneTier(
  id: string,
  count: number,
  mech: TraitDefTable[string]['tiers'][number]['mechanics'],
  /** 属性加成（0.2.2 加的"瞬移后翻倍"要读它，所以这里也得能给） */
  effects: TraitDefTable[string]['tiers'][number]['effects'] = [],
): TraitDefTable {
  return {
    [id]: { id, name: id, kind: 'class', tiers: [{ count, effects, desc: id, mechanics: mech }] },
  };
}

function teamOf(
  teamId: 0 | 1,
  entries: Array<{ defId: string; star?: number; col: number; row: number }>,
  defs: UnitDefTable,
  traits: TraitDefTable = {},
): TeamSetup {
  const units = entries.map((entry) => ({
    defId: entry.defId,
    star: entry.star ?? 1,
    cell: { col: entry.col, row: entry.row },
  }));
  return {
    team: teamId,
    units,
    // ★ 属性加成也要真的算出来（`blinkDoublesTraitBonus` 靠 `unit.traitBonusBp` 翻倍）
    traitBonuses: computeTraitBonuses(units, defs, traits),
    unitTraitBonuses: computeUnitTraitBonuses(units, defs, traits),
    activeTraits: computeActiveTraitLevels(units, defs, traits),
    unitMechanics: resolveUnitMechanics(units, defs, traits),
  };
}

// ------------------------------------------------------------
//  ① 数据层
// ------------------------------------------------------------

describe('★ 0.2.2 剑士：数据表里的三档眩晕时长', () => {
  const tiers = TRAIT_DEFS['swordsman']!.tiers;
  const blinkOf = (index: number) =>
    tiers[index]!.mechanics!.find((mech) => mech.kind === 'onCastBlinkStrike') as
      | { kind: 'onCastBlinkStrike'; stunTicks: number }
      | undefined;

  it('档位（0.3 起）是 2 / 4 / 6，原来的"概率 2 连击"一条都没丢', () => {
    expect(tiers.map((tier) => tier.count)).toEqual([2, 4, 6]);
    for (const tier of tiers) {
      expect(
        tier.mechanics?.some((mech) => mech.kind === 'probDoubleAttack'),
        `${tier.count} 人档的 2 连击被删掉了`,
      ).toBe(true);
    }
  });

  it('眩晕 0.5 / 1 / 3 秒 = 10 / 20 / 60 tick', () => {
    expect([0, 1, 2].map((index) => blinkOf(index)?.stunTicks)).toEqual([10, 20, 60]);
  });

  it('★ 绊线：都写了、而且都是"tick 数"不是"秒数"', () => {
    for (const [index, tier] of tiers.entries()) {
      const blink = blinkOf(index);
      expect(blink, `${tier.count} 人档没写 onCastBlinkStrike`).toBeTruthy();
      // 0.5 秒写成 0.5 会被取整成 0 ⇒ 完全没效果，还不会报错
      expect(Number.isInteger(blink!.stunTicks), 'stunTicks 必须是整数 tick').toBe(true);
      expect(blink!.stunTicks, '最短 0.25 秒（5 tick）').toBeGreaterThanOrEqual(5);
      expect(blink!.stunTicks, '最长 5 秒（100 tick）').toBeLessThanOrEqual(100);
    }
  });

  it('描述里写到了这条机制（改数值必须同步改 desc）', () => {
    for (const tier of tiers) {
      expect(tier.desc).toContain('瞬移');
      expect(tier.desc).toContain('眩晕');
    }
  });
});

// ------------------------------------------------------------
//  ② 内核层：真的跳过去、真的晕住
// ------------------------------------------------------------

describe('★ 0.2.2 剑士：开技能时瞬移到血量最少的敌人面前并眩晕', () => {
  /** 建一场"三个剑士 vs 一血皮 + 一肉盾"的战斗，返回 caster 打算用的那只 */
  function build(stunTicks: number, casterCell: { col: number; row: number }, weakCell: { col: number; row: number }) {
    const defs = tableOf([
      makeDef('sword1', ['swordsman']),
      makeDef('sword2', ['swordsman']),
      makeDef('sword3', ['swordsman']),
      // 血量刻意拉开：500 的明显低于 5000，谁是"血量最少"没有歧义
      makeDef('weak', [], { hp: 500 }),
      makeDef('tank', [], { hp: 5000 }),
    ]);
    const traits = oneTier('swordsman', 3, [{ kind: 'onCastBlinkStrike', stunTicks }]);
    const state = createBattle(
      defs,
      [
        teamOf(
          0,
          [
            { defId: 'sword1', col: casterCell.col, row: casterCell.row },
            { defId: 'sword2', col: 0, row: 0 },
            { defId: 'sword3', col: 0, row: 9 },
          ],
          defs,
          traits,
        ),
        teamOf(
          1,
          [
            { defId: 'weak', col: weakCell.col, row: weakCell.row },
            { defId: 'tank', col: 9, row: 0 },
          ],
          defs,
        ),
      ],
      20261018,
    );
    /*
      ★ 跳过"开局自动放技能"那条路：`castSkill` 里有一条 `state.tick > 0` 的判据
      （开局那一发时 spawn 事件还没记，插 move/status 会排在 spawn 前面）。
      这里直接把 tick 推到 1，模拟"战斗已经打起来了"。
    */
    state.tick = 1;
    const caster = state.units.find((unit) => unit.defId === 'sword1')!;
    const weak = state.units.find((unit) => unit.defId === 'weak')!;
    return { state, caster, weak, defs };
  }

  it('★ 跳过去：落点就在那个敌人的相邻格（攻击距离内）', () => {
    // 剑士原本站在很远的左下角，血皮敌人站在右上方
    const { state, caster, weak, defs } = build(60, { col: 0, row: 5 }, { col: 6, row: 5 });
    const before = { ...caster.cell };
    castSkill(state, caster, 'sword1_skill', [], defs);

    expect(caster.cell, '应该已经不在原位了').not.toEqual(before);
    const style = moveStyleOf(caster);
    expect(
      cellDistance(caster.cell, weak.cell, style),
      `落点 ${JSON.stringify(caster.cell)} 离敌人 ${JSON.stringify(weak.cell)} 太远`,
    ).toBeLessThanOrEqual(1);
  });

  it('★ 晕住：那个敌人身上挂了 stun，时长就是数据里那一档', () => {
    const { state, caster, weak, defs } = build(60, { col: 0, row: 5 }, { col: 6, row: 5 });
    expect(weak.statuses['stun']).toBeUndefined();
    castSkill(state, caster, 'sword1_skill', [], defs);
    expect(weak.statuses['stun']).toBe(60);
    // 事件流里也要有一条 status=stun（界面靠它画眩晕圈）
    const stunEvents = state.log.filter(
      (event) => event.type === 'status' && event.status === 'stun' && event.targetId === weak.id,
    );
    expect(stunEvents).toHaveLength(1);
  });

  it('★ 只晕"血量最少"那一个，肉盾不受影响', () => {
    const { state, caster, defs } = build(20, { col: 0, row: 5 }, { col: 6, row: 5 });
    const tank = state.units.find((unit) => unit.defId === 'tank')!;
    castSkill(state, caster, 'sword1_skill', [], defs);
    expect(tank.statuses['stun']).toBeUndefined();
  });

  it('已经贴身了就不再挪（只晕，不白白丢位置）', () => {
    // 剑士在己方半场最右一列（col 4），血皮敌人就在它右边一格 —— 本来就贴脸
    const { state, caster, weak, defs } = build(20, { col: 4, row: 5 }, { col: 5, row: 5 });
    const before = { ...caster.cell };
    castSkill(state, caster, 'sword1_skill', [], defs);
    expect(caster.cell).toEqual(before);
    expect(weak.statuses['stun']).toBe(20);
  });

  it('★ tick 0（开局自动施法那条路）不瞬移 —— 那时 spawn 事件还没记', () => {
    const { state, caster, defs } = build(20, { col: 0, row: 5 }, { col: 6, row: 5 });
    state.tick = 0;
    const before = { ...caster.cell };
    castSkill(state, caster, 'sword1_skill', [], defs);
    expect(caster.cell).toEqual(before);
    // 也不能有 move 事件排在 spawn 前面
    expect(state.log.some((event) => event.type === 'move')).toBe(false);
  });

  it('重复开技能：眩晕时长取"更长的那个"，不会叠加成两倍（老坑）', () => {
    const { state, caster, weak, defs } = build(60, { col: 4, row: 5 }, { col: 5, row: 5 });
    castSkill(state, caster, 'sword1_skill', [], defs);
    const first = weak.statuses['stun'];
    castSkill(state, caster, 'sword1_skill', [], defs);
    expect(weak.statuses['stun'], '同一 tick 连放两次不该变成 120').toBe(first);
  });
});

// ------------------------------------------------------------
//  ③ 瞬移后羁绊加成翻倍（0.2.2 第二次追加，用户点名）
// ------------------------------------------------------------

/*
  【用户口径】「给剑士再添加一个特性，瞬移后羁绊获得的攻击力提升和攻击速度提升效果翻倍，
  3 剑士不加这个效果」。

  ★ 这里盯的是**数值真的翻倍**（而不是"挂了个 buff"）：
    羁绊加成在 `createUnit` 里已经折进 `unit.attackDamage`，翻倍必须按
    `x/(1+x)` 折算出额外的 bp —— 直接再挂一个同额 buff 会变成 `(1+x)²`，
    9 人档就是 2.40 倍而不是 2.10 倍，差别肉眼可见。
*/
describe('★ 0.2.2 剑士：瞬移后羁绊攻/攻速翻倍（3 人档没有）', () => {
  const tiers = TRAIT_DEFS['swordsman']!.tiers;
  const hasDouble = (index: number): boolean =>
    (tiers[index]!.mechanics ?? []).some((mech) => mech.kind === 'blinkDoublesTraitBonus');

  it('★ 数据：只有 4 / 6 人档有，2 人档**没有**（用户明确要求）', () => {
    expect([0, 1, 2].map(hasDouble)).toEqual([false, true, true]);
    expect(tiers.map((tier) => tier.count)).toEqual([2, 4, 6]);
  });

  /** 造 count 个剑士（都在 0 半场）+ 一个远处不还手的靶子 */
  function build(count: 2 | 4 | 6, withDouble: boolean) {
    const swordDefs = Array.from({ length: count }, (_, index) => makeDef(`sword${index + 1}`, ['swordsman']));
    const defs = tableOf([...swordDefs, makeDef('foe', [], { hp: 1_000_000, attackDamage: 0, attackSpeed: 0 })]);
    const cells = [
      { col: 0, row: 0 },
      { col: 0, row: 2 },
      { col: 0, row: 4 },
      { col: 0, row: 6 },
      { col: 0, row: 8 },
      { col: 1, row: 1 },
    ];
    const mechs = [
      { kind: 'onCastBlinkStrike' as const, stunTicks: 20 },
      ...(withDouble ? [{ kind: 'blinkDoublesTraitBonus' as const }] : []),
    ];
    /*
      ★ 0.3 的真实属性加成（和 trait-data.ts 一致）：
        2 人档 +10%/+15%、4 人档 +15%/+20%、6 人档 +25%/+30%
      ★ 只要取到 "有 blinkDoublesTraitBonus 的那一档"（= 4 或 6），
        下面那几条断言都按 4 人档算 —— 因为它是最小的可翻倍档位。
    */
    const bpOf = (star: 2 | 4 | 6): [number, number] =>
      star === 6 ? [2500, 3000] : star === 4 ? [1500, 2000] : [1000, 1500];
    const [atkBp, spdBp] = bpOf(count);
    const effects = [
      { type: 'attackDamageBp' as const, value: atkBp },
      { type: 'attackSpeedBp' as const, value: spdBp },
    ];
    const traits = oneTier('swordsman', count, mechs, effects);
    const state = createBattle(
      defs,
      [
        teamOf(
          0,
          swordDefs.map((def, index) => ({ defId: def.id, col: cells[index]!.col, row: cells[index]!.row })),
          defs,
          traits,
        ),
        teamOf(1, [{ defId: 'foe', col: 9, row: 5 }], defs),
      ],
      771,
    );
    // 跳过 "开局自动施法" 那条路（`castSkill` 里 tick === 0 不瞬移）
    state.tick = 10;
    const caster = state.units.find((unit) => unit.defId === 'sword1')!;
    return { state, caster, defs };
  }

  const attackOf = (state: ReturnType<typeof build>['state'], unit: ReturnType<typeof build>['caster']): number =>
    effectiveAttackDamage(unit, collectMods(state, unit));
  const speedOf = (state: ReturnType<typeof build>['state'], unit: ReturnType<typeof build>['caster']): number =>
    effectiveAttackSpeed(unit, collectMods(state, unit));

  it('★★ 6 人档：瞬移后 = 白板 ×(1 + 2×25%) 攻击力、×(1 + 2×30%) 攻速', () => {
    const { state, caster, defs } = build(6, true);
    const base = unitBaseStats(defs['sword1']!, 1);
    // 瞬移之前：只有羁绊那一档（0.3：1 + 25% / 1 + 30%）
    expect(attackOf(state, caster) / base.attackDamage).toBeCloseTo(1.25, 2);
    expect(speedOf(state, caster) / base.attackSpeed).toBeCloseTo(1.3, 2);

    castSkill(state, caster, 'sword1_skill', [], defs);

    // 瞬移之后：翻倍（1 + 50% / 1 + 60%），而不是 (1.25)² = 1.5625
    expect(attackOf(state, caster) / base.attackDamage, '攻击力要正好翻倍到 1.5 倍').toBeCloseTo(1.5, 2);
    expect(speedOf(state, caster) / base.attackSpeed, '攻速要正好翻倍到 1.6 倍').toBeCloseTo(1.6, 2);
    expect(caster.traitBonusDoubled).toBe(true);
  });

  it('★ 2 人档：瞬移后**一点都没变**（用户明确要求不加）', () => {
    const { state, caster, defs } = build(2, false);
    const base = unitBaseStats(defs['sword1']!, 1);
    const beforeAttack = attackOf(state, caster);
    const beforeSpeed = speedOf(state, caster);
    expect(beforeAttack / base.attackDamage).toBeCloseTo(1.1, 2);

    castSkill(state, caster, 'sword1_skill', [], defs);
    // 瞬移照样发生（眩晕/位移都在），但加成不变
    expect(attackOf(state, caster), '2 人档不许翻倍').toBe(beforeAttack);
    expect(speedOf(state, caster)).toBe(beforeSpeed);
    expect(caster.traitBonusDoubled).toBeUndefined();
  });

  it('★ 只翻一次：再开一次技能不会变成 3 倍', () => {
    const { state, caster, defs } = build(6, true);
    const base = unitBaseStats(defs['sword1']!, 1);
    castSkill(state, caster, 'sword1_skill', [], defs);
    const once = attackOf(state, caster);
    castSkill(state, caster, 'sword1_skill', [], defs);
    expect(attackOf(state, caster), '翻倍不叠加').toBe(once);
    // 0.3：6 人档是 +25%，翻倍后 1.5 倍
    expect(attackOf(state, caster) / base.attackDamage).toBeCloseTo(1.5, 2);
  });

  it('★ 翻倍后照常回蓝（加成包必须带 passive:true，否则整场攒不到技能）', () => {
    const { state, caster, defs } = build(6, true);
    castSkill(state, caster, 'sword1_skill', [], defs);
    // `isSkillActive` 只认"技能生效中的包"；羁绊加成包不该被算进去
    expect(caster.skill?.buffs.every((buff) => buff.passive === true), '羁绊加成包必须是 passive').toBe(true);
    void state;
  });
});
