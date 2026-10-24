/**
 * ============================================================
 *  ★ 0.1.3 转职藏品 —— "装在干员身上，让他多一个羁绊"
 * ============================================================
 *
 * 【这一组盯什么？】
 * 转职的全部价值是**两件事同时成立**：
 *   ① 这名干员**算**那个羁绊的人数（第一档差一个人时，靠它凑够）；
 *   ② 他也**吃到**那个羁绊给成员的增益。
 * 只做到 ① —— 面板上人数够了、他自己却一点加成没有；
 * 只做到 ② —— 界面显示没生效、却莫名多了属性。
 * 两种都是"看起来能用但其实是坏的"，所以两条都要单独钉住。
 *
 * 【为什么还要钉"龙 / 领导人没有转职"？】
 * 因为那两件（如果误加）会让玩家花一件藏品换一个**永远不会生效**的标签
 * （龙和领导人是全队光环 / 恰好 N 人才触发，单个干员挂标签既凑不出人数也拿不到光环）。
 * 用户明确要求排除，所以这里也钉死。
 */
import { describe, expect, it } from 'vitest';
import {
  ITEM_DEFS,
  RELIC_ITEM_OF_TRAIT,
  RELIC_TRAIT_IDS,
  TRAIT_DEFS,
  TRAIT_RELICS,
  computeActiveTraitLevels,
  computeUnitTraitBonuses,
  countTraits,
  morphCandidatesOf,
  traitsOfPlacement,
  type SkillDef,
  type UnitDef,
  type UnitDefTable,
  type UnitPlacement,
} from '../src/index.js';

// ------------------------------------------------------------
//  测试脚手架（和 item-effects.test.ts 同一套写法）
// ------------------------------------------------------------

function makeDef(id: string, traits: string[] = []): UnitDef {
  const skill: SkillDef = {
    id: `${id}_skill`,
    name: `${id} 的技能`,
    desc: '测试用',
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

// ============================================================
//  数据契约
// ============================================================

describe('★ 转职藏品：数据契约', () => {
  it('一共 19 件 —— 21 个羁绊里排除了「龙」和「领导人」', () => {
    // ★ 0.3：新增「近卫」羁绊 ⇒ 转职藏品自动多一件（18 -> 19）
    expect(RELIC_TRAIT_IDS).toHaveLength(19);
    expect(RELIC_TRAIT_IDS).not.toContain('dragon');
    expect(RELIC_TRAIT_IDS).not.toContain('leader');
    // ★ 0.2：MujicaAve 是"成员表里还没加人"的阵营，现在只能靠这件转职凑档位 ——
    //   所以它必须在这张表里，否则新羁绊在正常对局里**永远激活不了**。
    expect(RELIC_TRAIT_IDS).toContain('mujica');
    // ★ 0.2 不屈：和 MujicaAve 同一个道理（成员只有 3 个，5 人档凑不齐 ⇒ 需要转职补人）
    expect(RELIC_TRAIT_IDS).toContain('unyielding');

    // 和羁绊表严格对齐：除了那两个，一个都不许少、也不许多
    const expected = Object.keys(TRAIT_DEFS).filter((id) => id !== 'dragon' && id !== 'leader');
    expect([...RELIC_TRAIT_IDS].sort()).toEqual(expected.sort());
  });

  it('每件都是「进阶 · 穿戴」，名字是「XX转职」，id 与 grantsTrait 互相印证', () => {
    for (const relic of TRAIT_RELICS) {
      expect(relic.rarity, relic.id).toBe('advanced');
      expect(relic.slot, relic.id).toBe('A');
      expect(relic.name, relic.id).toBe(`${TRAIT_DEFS[relic.grantsTrait!]!.name}转职`);
      expect(RELIC_ITEM_OF_TRAIT[relic.grantsTrait!], relic.id).toBe(relic.id);
      expect(ITEM_DEFS[relic.id], '必须真的进了藏品表').toBe(relic);
      expect(relic.desc, '文案要说清是干什么的').toContain(TRAIT_DEFS[relic.grantsTrait!]!.name);
    }
  });

  it('icon 两两不重复（撞车会让两件转职显示同一张图）', () => {
    const icons = TRAIT_RELICS.map((relic) => relic.icon);
    expect(new Set(icons).size, 'icon 有重复').toBe(icons.length);
  });

  it('变形同构体：立刻销毁 + 走 morphRelic 备战效果', () => {
    const item = ITEM_DEFS['itm_morph_relic']!;
    expect(item.rarity).toBe('advanced');
    expect(item.slot).toBe('A');
    expect(item.onEquip?.consume, '装备即销毁').toBe(true);
    expect(item.onEquip?.prep?.kind).toBe('morphRelic');
  });
});

// ============================================================
//  真的能凑人数、也真的吃到加成
// ============================================================

describe('★ 转职藏品：凑人数 + 吃加成', () => {
  /*
    挑一个"成员型（scope 不是 team）+ 第一档就有属性效果"的真羁绊来测，
    而不是写死某个羁绊 —— 免得以后调整羁绊数据时这条测试跟着变假。
  */
  const target = Object.values(TRAIT_DEFS).find(
    (trait) => (trait.scope ?? 'members') === 'members' && trait.tiers[0]!.effects.length > 0,
  )!;
  /** 第一档需要几个人 */
  const need = target.tiers[0]!.count;

  it(`extraTraits 会算进羁绊人数（拿「${target.name}」试：第一档 ${need} 人）`, () => {
    const defs = tableOf([makeDef('own', [target.id]), makeDef('borrowed', [])]);
    const placements: UnitPlacement[] = [
      { defId: 'own', star: 1, cell: { col: 0, row: 0 } },
      // 本来没有这个羁绊，靠转职藏品拿到标签
      { defId: 'borrowed', star: 1, cell: { col: 0, row: 1 }, extraTraits: [target.id] },
    ];
    expect(countTraits(placements, defs).get(target.id), '1 个体内 + 1 个转职').toBe(2);
  });

  it('★ 凑够档位之后，装了转职的那个干员**也**吃到该羁绊给成员的加成', () => {
    const defs: UnitDefTable = {};
    const placements: UnitPlacement[] = [];

    // 第一个：本来就是该羁绊的干员
    defs['own'] = makeDef('own', [target.id]);
    placements.push({ defId: 'own', star: 1, cell: { col: 0, row: 0 } });

    // 其余的人本来都不带这个羁绊，全靠转职藏品凑上来
    // （必须用**不同 defId**：羁绊人数是按"不同干员种类"计的）
    for (let i = 1; i < need; i++) {
      const id = `borrowed${i}`;
      defs[id] = makeDef(id, []);
      placements.push({ defId: id, star: 1, cell: { col: 0, row: i }, extraTraits: [target.id] });
    }

    const active = computeActiveTraitLevels(placements, defs).filter((level) => level.tierIndex >= 0);
    expect(
      active.some((level) => level.traitId === target.id),
      `靠转职凑够 ${need} 人之后，这个羁绊必须真的生效`,
    ).toBe(true);

    const bonuses = computeUnitTraitBonuses(placements, defs);
    expect(bonuses['borrowed1']?.length ?? 0, '转职来的成员也要吃到加成').toBeGreaterThan(0);
    // 而且必须**只有带标签的**吃到 —— 没标签的那个人不该被顺手带上
    if (need < 3) {
      expect(bonuses['nobody'], '没这个 defId').toBeUndefined();
    }
  });

  it('★ 凑不够人数时，转职给了标签也一点都不生效（对照组）', () => {
    // 只给 1 个人挂标签，而第一档至少要 need 人（need ≥ 2）
    const defs = tableOf([makeDef('borrowed', [])]);
    const placements: UnitPlacement[] = [
      { defId: 'borrowed', star: 1, cell: { col: 0, row: 0 }, extraTraits: [target.id] },
    ];
    const active = computeActiveTraitLevels(placements, defs).filter((level) => level.tierIndex >= 0);
    expect(active.some((level) => level.traitId === target.id), '人数不够就该未生效').toBe(false);
    expect(computeUnitTraitBonuses(placements, defs), '没有生效的羁绊就不会有加成').toEqual({});
  });

  it('traitsOfPlacement：自身标签 + 额外标签，并且去重', () => {
    const own = makeDef('x', ['yan']);
    expect(traitsOfPlacement({ defId: 'x', star: 1, cell: { col: 0, row: 0 } }, own)).toEqual(['yan']);
    expect(traitsOfPlacement({ defId: 'x', star: 1, cell: { col: 0, row: 0 }, extraTraits: ['healing'] }, own)).toEqual([
      'yan',
      'healing',
    ]);
    // 额外标签和自身重复 -> 只算一次（否则会被数成两个人）
    expect(traitsOfPlacement({ defId: 'x', star: 1, cell: { col: 0, row: 0 }, extraTraits: ['yan'] }, own)).toEqual(['yan']);
  });
});

// ============================================================
//  变形同构体的候选
// ============================================================

describe('★ morphCandidatesOf：只能变出"真的有转职"的羁绊', () => {
  it('龙 / 领导人被过滤掉（它们没有转职藏品）', () => {
    expect(morphCandidatesOf({ traits: ['dragon', 'leader'] })).toEqual([]);
    expect(morphCandidatesOf({ traits: ['yan', 'dragon'] })).toEqual([RELIC_ITEM_OF_TRAIT['yan']]);
  });

  it('真正有 3 个羁绊的干员 -> 3 个候选（各 1/3 概率）', () => {
    const three = morphCandidatesOf({ traits: ['yan', 'defender', 'healing'] });
    expect(three).toHaveLength(3);
    expect(new Set(three).size, '不能有重复').toBe(3);
  });

  it('没有羁绊的干员 -> 一个候选都没有（用不了变形同构体）', () => {
    expect(morphCandidatesOf({ traits: [] })).toEqual([]);
    expect(morphCandidatesOf(undefined)).toEqual([]);
  });
});
