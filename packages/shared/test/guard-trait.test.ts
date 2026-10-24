/**
 * ============================================================
 *  ★★ 0.3 新羁绊「近卫」（3/4/5 人）
 * ============================================================
 *
 * 【效果（用户口径）】
 *   · 近卫干员攻击力 +5% / +10% / +25%
 *   · 吸血        +10% / +20% / +40%
 *   · 双抗        +10 / +15 / +25
 *   · 对**射程 ≥ 3** 的干员，伤害提升**至** 120% / 130% / 150%
 *
 * 【这一组守什么？】
 * 前两条（攻击力 / 双抗）走的是**已有的**属性加成通路，不太会写错；
 * 真正容易错的是后两条：
 *   · 吸血不在属性表里，走的是 `SkillStats.lifestealBp` → `Mods.lifestealBp`；
 *   · 对远程增伤走的是**新加的** `SkillStats.rangeAmp` → `Mods.rangeAmp`。
 * 数据写对了但没接到 `Mods` 上，效果就是"看起来有这个羁绊、打起来什么都没有"——
 * 门禁全绿也发现不了，所以这里直接盯着 `collectMods` 的结果。
 *
 * ★ 还有一条：**别把加成发给没这个羁绊的人**（scope 默认 members）。
 */
import { describe, expect, it } from 'vitest';
import {
  TRAIT_DEFS,
  UNIT_DEFS,
  collectMods,
  computeTraitBonuses,
  computeUnitTraitBonuses,
  createBattle,
  resolveUnitMechanics,
  type TeamSetup,
  type TraitDefTable,
  type UnitDef,
  type UnitDefTable,
  type UnitPlacement,
} from '../src/index.js';

function makeDef(id: string, traits: string[], base: Partial<UnitDef['base']> = {}): UnitDef {
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
    skill: { id: `${id}_skill`, name: id, desc: '-', effects: [], manaSource: 'attack' },
  };
}

function tableOf(defs: UnitDef[]): UnitDefTable {
  const out: UnitDefTable = {};
  for (const def of defs) out[def.id] = def;
  return out;
}

describe('★ 0.3 近卫：数据表', () => {
  const tiers = TRAIT_DEFS['guard']!.tiers;

  it('★ 档位 3 / 4 / 5，和用户给的人数一致', () => {
    expect(TRAIT_DEFS['guard']).toBeTruthy();
    expect(tiers.map((tier) => tier.count)).toEqual([3, 4, 5]);
  });

  it('★ 攻击力 +5/10/25%、双抗 +10/15/25', () => {
    expect(tiers.map((tier) => tier.effects)).toEqual([
      [
        { type: 'attackDamageBp', value: 500 },
        { type: 'armorFlat', value: 10 },
        { type: 'magicResistFlat', value: 10 },
      ],
      [
        { type: 'attackDamageBp', value: 1000 },
        { type: 'armorFlat', value: 15 },
        { type: 'magicResistFlat', value: 15 },
      ],
      [
        { type: 'attackDamageBp', value: 2500 },
        { type: 'armorFlat', value: 25 },
        { type: 'magicResistFlat', value: 25 },
      ],
    ]);
  });

  it('★ 吸血 10/20/40%，对射程≥3 的伤害提升到 120/130/150%', () => {
    const amps = tiers.map((tier) => {
      const buff = (tier.mechanics ?? []).find((mech) => mech.kind === 'startSelfBuff') as
        | { stats: { lifestealBp?: number; rangeAmp?: { minRange: number; totalBp: number } } }
        | undefined;
      expect(buff, `${tier.count} 人档缺少自带 buff`).toBeTruthy();
      return [buff!.stats.lifestealBp, buff!.stats.rangeAmp];
    });
    expect(amps).toEqual([
      [1000, { minRange: 3, totalBp: 12000 }],
      [2000, { minRange: 3, totalBp: 13000 }],
      [4000, { minRange: 3, totalBp: 15000 }],
    ]);
  });

  it('★ 成员就是用户点名的 5 个（芳汀 / 炎客 / 左乐 / 祐天寺若麦 / 丰川祥子）', () => {
    const members = Object.values(UNIT_DEFS)
      .filter((def) => def.traits.includes('guard'))
      .map((def) => def.name)
      .sort();
    expect(members).toEqual(['丰川祥子', '左乐', '炎客', '祐天寺若麦', '芳汀'].sort());
    // ★ 这 5 个人**不再**带剑豪（0.3 把他们从剑士里移出去了，剑士同时改名剑豪）
    for (const def of Object.values(UNIT_DEFS)) {
      if (def.traits.includes('guard')) expect(def.traits).not.toContain('swordsman');
    }
  });
});

describe('★ 0.3 近卫：加成真的进到战斗里', () => {
  /** 3 个近卫 + 1 个路人（路人用来验证"别发给别人"） */
  function battle(): { state: ReturnType<typeof createBattle>; defs: UnitDefTable } {
    const defs = tableOf([
      makeDef('g1', ['guard']),
      makeDef('g2', ['guard']),
      makeDef('g3', ['guard']),
      makeDef('plain', []),
      makeDef('foe', [], { range: 3, hp: 100000, attackDamage: 0, attackSpeed: 0 }),
    ]);
    const units: UnitPlacement[] = [
      { defId: 'g1', star: 1, cell: { col: 1, row: 1 } },
      { defId: 'g2', star: 1, cell: { col: 1, row: 3 } },
      { defId: 'g3', star: 1, cell: { col: 1, row: 5 } },
      { defId: 'plain', star: 1, cell: { col: 1, row: 7 } },
    ];
    const traits: TraitDefTable = { guard: TRAIT_DEFS['guard']! };
    const setup: TeamSetup = {
      team: 0,
      units,
      // ★ 三件都要传：属性加成走 traitBonuses/unitTraitBonuses，
      //   吸血/对远程增伤走 unitMechanics 里的 startSelfBuff
      traitBonuses: computeTraitBonuses(units, defs, traits),
      unitTraitBonuses: computeUnitTraitBonuses(units, defs, traits),
      unitMechanics: resolveUnitMechanics(units, defs, traits),
    };
    const state = createBattle(
      defs,
      [setup, { team: 1, units: [{ defId: 'foe', star: 1, cell: { col: 8, row: 3 } }] }],
      7,
    );
    return { state, defs };
  }

  it('★★ 3 档：近卫身上的 Mods 里真的有吸血 10% + 对射程≥3 增伤 120%', () => {
    const { state } = battle();
    const guard = state.units.find((unit) => unit.defId === 'g1')!;
    const mods = collectMods(state, guard);
    expect(mods.lifestealBp, '吸血必须真的进 Mods').toBe(1000);
    expect(mods.rangeAmp, '对远程增伤必须真的进 Mods').toEqual({ minRange: 3, totalBp: 12000 });
  });

  it('★★ 路人（没有近卫标签）一点都不吃 —— scope 是 members', () => {
    const { state } = battle();
    const plain = state.units.find((unit) => unit.defId === 'plain')!;
    const mods = collectMods(state, plain);
    expect(mods.lifestealBp).toBe(0);
    expect(mods.rangeAmp).toBeNull();
  });

  it('★ 攻击力 +5% 只加在近卫自己身上', () => {
    const { state, defs } = battle();
    const guard = state.units.find((unit) => unit.defId === 'g1')!;
    const plain = state.units.find((unit) => unit.defId === 'plain')!;
    const base = defs['g1']!.base.attackDamage * 1000; // 定点数
    expect(guard.attackDamage).toBe(base + Math.floor((base * 500) / 10000));
    expect(plain.attackDamage).toBe(defs['plain']!.base.attackDamage * 1000);
  });

  it('★ 双抗 +10 是**面板点数**（不是定点数）：护甲/魔抗各 +10', () => {
    const { state, defs } = battle();
    const guard = state.units.find((unit) => unit.defId === 'g1')!;
    expect(guard.armor).toBe(defs['g1']!.base.armor * 1000 + 10 * 1000);
    expect(guard.magicResist).toBe(defs['g1']!.base.magicResist * 1000 + 10 * 1000);
  });
});
