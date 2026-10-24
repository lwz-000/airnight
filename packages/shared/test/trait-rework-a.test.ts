/**
 * ============================================================
 *  ★ 0.0.3「干员调整A版」的落地测试
 * ============================================================
 * 源文件：`各项数值/干员调整A版.txt`（18 条羁绊 / 干员改动 + 3 条野怪改动）。
 *
 * 【为什么单独一份，而不是塞进 trait-mechanics.test.ts？】
 * 那个文件用"合成数据"盯机制、不盯具体数值；这一份正好相反 ——
 * 它盯的就是**表上那些数字**：档位人数 2/3/4、百分比 25%/50%、
 * 固定伤害 400/500/1000、上限 250%/200%、谁身上该有哪个羁绊。
 * 两类测试"红了该改哪边"不一样（一个改代码、一个改数据表），混在一起会混淆。
 *
 * 每个 `it` 的标题都标了表里的条目号。
 */

import { describe, expect, it } from 'vitest';
import {
  TRAIT_DEFS,
  UNIT_DEFS,
  createBattle,
  dealDamage,
  killUnit,
  resolveUnitMechanics,
  step,
  type BattleEvent,
  type SkillDef,
  type TeamSetup,
  type TraitDefTable,
  type UnitDef,
  type UnitDefTable,
  type UnitPlacement,
} from '../src/index.js';

// ------------------------------------------------------------
//  合成数据的小工具（真名单那部分不需要它们）
// ------------------------------------------------------------

/** 内核的定点数倍数：伤害/血量事件里的数字是"面板值 × FIX" */
const FIX = 1000;

/** 一个"不做事"的棋子：没有任何技能效果，日志里的事件只可能来自被测机制 */
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

/** 一条单档羁绊：[人数, 机制] */
function oneTier(id: string, count: number, mech: TraitDefTable[string]['tiers'][number]['mechanics']): TraitDefTable {
  return {
    [id]: { id, name: id, kind: 'class', tiers: [{ count, effects: [], desc: id, mechanics: mech }] },
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
    // 走真实的解析链路：机制是从羁绊表算出来的，不是在测试里手写的
    unitMechanics: resolveUnitMechanics(units, defs, traits),
  };
}

// ------------------------------------------------------------
//  真名单的查表小工具
// ------------------------------------------------------------

function byName(name: string): { id: string; cost: number; traits: string[] } {
  const def = Object.values(UNIT_DEFS).find((item) => item.name === name);
  if (!def) throw new Error(`名单里没有「${name}」`);
  return { id: def.id, cost: def.cost, traits: [...def.traits] };
}

/** 某个羁绊每一档需要的人数 */
function counts(traitId: string): number[] {
  return TRAIT_DEFS[traitId]!.tiers.map((tier) => tier.count);
}

/** 某个羁绊每一档的机制（数据表里的原始写法，没有 traitId 这类运行时字段） */
function mechs(traitId: string): Array<Record<string, unknown>> {
  /*
    ★ 0.2：改成**拍平每一档的全部机制**（以前只取 `mechanics[0]`）。
    因为新数据里一档常常带两个机制（重装 = 附伤 + 周期护盾；支援 = 护盾 + 开局双抗），
    只取第一个会把后加的那个默默漏掉 —— 断言就变成"永远只检查一半"。
  */
  const out: Array<Record<string, unknown>> = [];
  for (const tier of TRAIT_DEFS[traitId]!.tiers) {
    for (const raw of (tier.mechanics ?? []) as unknown as Array<Record<string, unknown>>) {
      const copy: Record<string, unknown> = {};
      for (const key of Object.keys(raw)) copy[key] = raw[key];
      out.push(copy);
    }
  }
  return out;
}

// ============================================================
//  ①②③④⑤⑥⑦⑧  八个"改人数 / 改数值"的羁绊
// ============================================================
describe('A 版：羁绊的人数与数值', () => {
  it('第 1 条（0.2）：新增「治疗」，人数 3/4/5，治疗效果 +20%/30%/50%', () => {
    const def = TRAIT_DEFS['healing'];
    expect(def, '治疗羁绊必须存在').toBeDefined();
    expect(def!.name).toBe('治疗');
    // ★ 0.2：人数门槛 2/3/4 -> 3/4/5（数值不变）
    expect(counts('healing')).toEqual([3, 4, 5]);
    expect(def!.tiers.map((tier) => tier.effects[0])).toEqual([
      { type: 'healingBp', value: 2000 },
      { type: 'healingBp', value: 3000 },
      { type: 'healingBp', value: 5000 },
    ]);
  });

  it('第 2 / 8 条（0.2）：远射 3/6/9，攻速 +20%/35%/60%，每击 +1%，上限 +30%/50%/100%', () => {
    expect(counts('ranged')).toEqual([3, 6, 9]);
    expect(TRAIT_DEFS['ranged']!.tiers.map((tier) => tier.effects[0])).toEqual([
      { type: 'attackSpeedBp', value: 2000 },
      { type: 'attackSpeedBp', value: 3500 },
      { type: 'attackSpeedBp', value: 6000 },
    ]);
    const caps = [30, 50, 100];
    mechs('ranged').forEach((mech, index) => {
      expect(mech['kind']).toBe('rampSpeed');
      // ★ 0.2：每次 +2% -> +1%
      expect(mech['perAttackBp']).toBe(100);
      // 上限 ÷ 每次 1% = 叠数
      expect(mech['maxStacks']).toBe(caps[index]);
    });
  });

  it('第 7 条（0.3）：剑豪 2/4/6 人，+10%/15%/25% 攻击力、+15%/20%/30% 攻速，每次攻击 30/40/60% 概率 2 连击', () => {
    /*
      ★★ 0.3（用户口径）：剑士改名「剑豪」，人数 3/6/9 -> **2/4/6**，
      攻击力 +15/30/55% -> **+10/15/25%**，攻速 +20/40/60% -> **+15/20/30%**；
      连击概率（30/40/60%）与瞬移眩晕都不变。
    */
    expect(counts('swordsman')).toEqual([2, 4, 6]);
    expect(TRAIT_DEFS['swordsman']!.tiers.map((tier) => tier.effects)).toEqual([
      [
        { type: 'attackDamageBp', value: 1000 },
        { type: 'attackSpeedBp', value: 1500 },
      ],
      [
        { type: 'attackDamageBp', value: 1500 },
        { type: 'attackSpeedBp', value: 2000 },
      ],
      [
        { type: 'attackDamageBp', value: 2500 },
        { type: 'attackSpeedBp', value: 3000 },
      ],
    ]);
    /*
      ★ 0.2.2：剑士一档现在有**两条**机制（2 连击 + 开技能瞬移眩晕），
      所以这里要按 kind 取，不能像以前那样按下标 `mechs()[index]` ——
      按下标就等于"顺手把第二条当成第一条来断言"，加机制必红。
      （瞬移那条的时长在 `swordsman-blink.test.ts` 里单独盯。）
    */
    const chances = [3000, 4000, 6000];
    TRAIT_DEFS['swordsman']!.tiers.forEach((tier, index) => {
      const doubleMech = (tier.mechanics ?? []).find((mech) => mech.kind === 'probDoubleAttack');
      expect(doubleMech, `${tier.count} 人档缺少 2 连击机制`).toBeTruthy();
      expect((doubleMech as { chanceBp: number }).chanceBp).toBe(chances[index]);
      expect(
        (tier.mechanics ?? []).some((mech) => mech.kind === 'onCastBlinkStrike'),
        `${tier.count} 人档缺少「开技能瞬移 + 眩晕」`,
      ).toBe(true);
    });
    // ★ 0.2：旧的"每 3 击永久 +X% 攻速（有上限）"整条被换掉了
    for (const tier of TRAIT_DEFS['swordsman']!.tiers) {
      expect((tier.mechanics ?? []).some((mech) => mech.kind === 'attackCounterSpeed')).toBe(false);
    }
  });

  it('第 5 条（0.2）：支援 2/4/6/8，生命 +10%/10%/20%/30%，护盾 + 开局双抗', () => {
    expect(counts('support')).toEqual([2, 4, 6, 8]);
    expect(TRAIT_DEFS['support']!.tiers.map((tier) => tier.effects[0])).toEqual([
      { type: 'hpBp', value: 1000 },
      { type: 'hpBp', value: 1000 },
      { type: 'hpBp', value: 2000 },
      { type: 'hpBp', value: 3000 },
    ]);
    expect(mechs('support').filter((mech) => mech.kind === 'startShield')).toEqual([
      { kind: 'startShield', hpBp: 1000, durationTicks: 100 },
      { kind: 'startShield', hpBp: 1500, durationTicks: 100 },
      { kind: 'startShield', hpBp: 1500, durationTicks: 200 },
      { kind: 'startShield', hpBp: 3000, durationTicks: 200 },
    ]);
    // ★ 0.2 新增：开局给全队一份限时的护甲/魔抗百分比
    expect(mechs('support').filter((mech) => mech.kind === 'startResist')).toEqual([
      { kind: 'startResist', armorBp: 1000, magicResistBp: 1000, durationTicks: 200 },
      { kind: 'startResist', armorBp: 1500, magicResistBp: 1000, durationTicks: 200 },
      { kind: 'startResist', armorBp: 1500, magicResistBp: 1000, durationTicks: 200 },
      { kind: 'startResist', armorBp: 2000, magicResistBp: 2000, durationTicks: 300 },
    ]);
  });

  it('★ 支援不再管治疗效果（那条整体搬去了「治疗」）', () => {
    for (const tier of TRAIT_DEFS['support']!.tiers) {
      expect(
        tier.effects.some((effect) => effect.type === 'healingBp'),
        '支援里不该再有 healingBp',
      ).toBe(false);
    }
  });

  it('第 3 条（0.2）：重装 3/5/7，生命 +5%/10%/20%，附伤 2%/3%/5%，每 15 秒补已损失生命护盾', () => {
    expect(counts('defender')).toEqual([3, 5, 7]);
    const def = TRAIT_DEFS['defender']!;
    expect(def.tiers.map((tier) => tier.effects)).toEqual([
      [{ type: 'hpBp', value: 500 }],
      [{ type: 'hpBp', value: 1000 }],
      [{ type: 'hpBp', value: 2000 }],
    ]);
    expect(mechs('defender').filter((mech) => mech.kind === 'onHitDamage')).toEqual([
      { kind: 'onHitDamage', ratioBp: 200, damageType: 'physical', scale: 'selfMaxHp' },
      { kind: 'onHitDamage', ratioBp: 300, damageType: 'physical', scale: 'selfMaxHp' },
      { kind: 'onHitDamage', ratioBp: 500, damageType: 'physical', scale: 'selfMaxHp' },
    ]);
    // ★ 0.2 新增：每 15 秒（300 tick）获得"已损失生命 30/35/50%"的护盾（护盾存在时不获得）
    expect(mechs('defender').filter((mech) => mech.kind === 'periodicShield')).toEqual([
      { kind: 'periodicShield', intervalTicks: 300, missingHpBp: 3000 },
      { kind: 'periodicShield', intervalTicks: 300, missingHpBp: 3500 },
      { kind: 'periodicShield', intervalTicks: 300, missingHpBp: 5000 },
    ]);
    // 旧的"护甲 +50%/100% + 护甲总和分给全队"整条被换掉了
    for (const tier of def.tiers) {
      expect((tier.mechanics ?? []).some((mech) => mech.kind === 'auraFromSum')).toBe(false);
      expect(tier.effects.some((effect) => effect.type === 'armorBp')).toBe(false);
    }
  });

  it('第 4 条（0.3）：龙 1/2/3 人，按“龙干员星级总和”每星 +2%/3%/5% 攻击力', () => {
    expect(counts('dragon')).toEqual([1, 2, 3]);
    expect(TRAIT_DEFS['dragon']!.scope).toBe('team');
    /*
      ★★ 0.3（用户口径）：从“每有 1 个三星龙 +12%”改成
      “按**星级总和**每一星 +2%/3%/5%（重复干员只算最高星级）”。
    */
    const perStar = TRAIT_DEFS['dragon']!.tiers.map((tier) => {
      const mech = (tier.mechanics ?? []).find((item) => item.kind === 'attackByTraitStars');
      expect(mech, `${tier.count} 人档缺少「按星级加成」`).toBeTruthy();
      return (mech as { perStarBp: number }).perStarBp;
    });
    expect(perStar).toEqual([200, 300, 500]);
    // 旧机制不该再出现
    for (const mech of mechs('dragon')) {
      expect(mech['kind']).not.toBe('attackByTripleTrait');
    }
    // 旧版"全队全部属性 +20/30/50%"那条不该再出现
    for (const tier of TRAIT_DEFS['dragon']!.tiers) {
      expect((tier.mechanics ?? []).some((mech) => mech.kind === 'allStatsByTriple')).toBe(false);
    }
  });

  it('第 6 条（0.2.2）：拉特兰 3/6/9，攻/攻速 +25%/35%/50%，每 30/20/20 次齐射（固定值 + 攻击力总和 %）', () => {
    expect(counts('laterano')).toEqual([3, 6, 9]);
    expect(TRAIT_DEFS['laterano']!.tiers.map((tier) => tier.effects)).toEqual([
      [
        { type: 'attackDamageBp', value: 2500 },
        { type: 'attackSpeedBp', value: 2500 },
      ],
      [
        { type: 'attackDamageBp', value: 3500 },
        { type: 'attackSpeedBp', value: 3500 },
      ],
      [
        { type: 'attackDamageBp', value: 5000 },
        { type: 'attackSpeedBp', value: 5000 },
      ],
    ]);
    /*
      ★ 0.2.2：触发次数 **30 / 20 / 20**（3 人档 30 次、6 人档与 9 人档都 20 次）。
      0.2 那版是三档统一 30，再往前是 30/20/10 —— 这次是用户点名的 30/20/20。
      伤害仍然是"固定值 + 拉特兰攻击力总和的百分比"，
      所以 `flatDamage` 与 `totalAttackBp` **两个字段同时写**（引擎两条都吃）。
      ★ 0.2.1：三档都挂了 `fx: 'laterano_volley'`（发动时从本方半场横扫全场的子弹雨）。
    */
    expect(mechs('laterano')).toEqual([
      { kind: 'attackCountNuke', every: 30, flatDamage: 200, totalAttackBp: 1000, fx: 'laterano_volley' },
      { kind: 'attackCountNuke', every: 20, flatDamage: 300, totalAttackBp: 1500, fx: 'laterano_volley' },
      { kind: 'attackCountNuke', every: 20, flatDamage: 600, totalAttackBp: 2000, fx: 'laterano_volley' },
    ]);
    // 攻击力总和那条比例必须真的在数据里（否则"固定值"就退化成老口径了）
    for (const tier of TRAIT_DEFS['laterano']!.tiers) {
      expect(tier.mechanics?.[0]).toHaveProperty('totalAttackBp');
    }
  });
});

// ============================================================
//  ⑨~⑱  干员的费用调整与羁绊增删
// ============================================================
describe('A 版：干员的费用与羁绊增删', () => {
  it('第 10 条：古米 1 费 -> 2 费，新增「治疗」', () => {
    const unit = byName('古米');
    expect(unit.cost).toBe(2);
    expect(unit.traits).toContain('healing');
    expect(unit.traits).toContain('defender');
  });

  it('第 11 条：夜莺 2 费 -> 3 费，删「支援」、加「治疗」', () => {
    const unit = byName('夜莺');
    expect(unit.cost).toBe(3);
    expect(unit.traits).toContain('healing');
    expect(unit.traits).not.toContain('support');
  });

  it('第 9 / 12 / 13 / 14 / 17 / 18 条：删掉「支援」的那几个', () => {
    /*
      ★ 焰尾**不在**这一组里：A 版第 18 条写的是"焰尾删除支援"，
      但用户当天又要求"给焰尾加回支援羁绊"，以最新的话为准（下面单独测它）。
    */
    for (const name of ['阿米娅', '空弦', '机械师', '蕾缪安', '星熊']) {
      expect(byName(name).traits, `${name} 不该再有支援`).not.toContain('support');
    }
    // 其中两个还同时新增了「远射」
    expect(byName('空弦').traits).toContain('ranged');
    expect(byName('蕾缪安').traits).toContain('ranged');
    // 只删没加的：标签要一字不差
    expect(byName('阿米娅').traits).toEqual(['rhodes', 'leader', 'arts']);
    expect(byName('星熊').traits).toEqual(['yan', 'defender']);
  });

  it('★ 焰尾：支援羁绊要留着（用户撤回了"删除支援"那条）', () => {
    const unit = byName('焰尾');
    expect(unit.cost).toBe(3);
    expect(unit.traits, '焰尾必须有支援').toContain('support');
    expect(unit.traits).toContain('kazimierz');
  });

  it('第 15 / 16 条：魔王、凯尔希·思衡托新增「治疗」', () => {
    expect(byName('魔王').traits).toContain('healing');
    expect(byName('凯尔希·思衡托').traits).toContain('healing');
  });

  it('★ 成员数与档位门槛（0.2：凑不齐的档位靠转职藏品）', () => {
    const healers = Object.values(UNIT_DEFS).filter((def) => def.traits.includes('healing'));
    /*
      ★ 0.2：治疗成员只有 4 个，而档位是 3/4/5 —— 最高档差的那一个靠**转职藏品**凑。
      （用户 2026-10-16 口径："现在有转职藏品，多出的人数可以靠它凑齐"。）
      所以这里只断言"第一档凑得出来"，不再要求"最高档也凑得出来"。
    */
    // ★ 0.2 追加：三角初华（治疗）加入 ⇒ 4 → 5
    expect(healers.length).toBe(5);
    expect(counts('healing')[0]!).toBeLessThanOrEqual(healers.length);

    const supports = Object.values(UNIT_DEFS).filter((def) => def.traits.includes('support'));
    expect(
      supports.map((def) => def.name),
      '焰尾要有支援（用户撤回了"删除支援"那条）',
    ).toContain('焰尾');
    expect(supports.map((def) => def.name), '0.2：砾的「职业」补上了支援').toContain('砾');
  });
});

// ============================================================
//  新机制在战斗里真的生效（不是"只改了数据表"）
// ============================================================
describe('A 版：新机制在战斗里真的生效', () => {
  it('★ 重装附伤按**自己**的最大生命算（写成目标生命就会被这条抓住）', () => {
    const defs = tableOf([
      // 血厚的重装；对手是一个"血牛"（它的 2% 会大得离谱，正好用来区分基准）
      makeDef('tank', ['defender'], { hp: 3000, attackDamage: 10, attackSpeed: 2000 }),
      makeDef('fatty', [], { hp: 100000, attackDamage: 1, attackSpeed: 100 }),
    ]);
    const traits = oneTier('defender', 1, [
      { kind: 'onHitDamage', ratioBp: 200, damageType: 'physical', scale: 'selfMaxHp' },
    ]);
    const teams: [TeamSetup, TeamSetup] = [
      teamOf(0, [{ defId: 'tank', col: 4, row: 4 }], defs, traits),
      teamOf(1, [{ defId: 'fatty', col: 5, row: 4 }], defs),
    ];
    const state = createBattle(defs, teams, 4242);
    const tank = state.units.find((unit) => unit.defId === 'tank')!;
    const expected = Math.floor((tank.maxHp * 200) / 10000); // 自身最大生命 2%
    expect(expected).toBeGreaterThan(0);

    let guard = 0;
    while (guard++ < 200 && !state.over) step(state, defs);

    // 附伤是"物理伤害 + spell 攻击类型"，和普攻（attack）能干净地分开
    const bonusHits = state.log.filter(
      (event): event is Extract<BattleEvent, { type: 'damage' }> =>
        event.type === 'damage' &&
        event.sourceId === tank.id &&
        event.damageType === 'physical' &&
        event.attackType === 'spell',
    );
    expect(bonusHits.length, '重装普攻该附带一份额外的物理伤害').toBeGreaterThan(0);
    // 对手护甲 0 -> 数值应当**正好**等于自身最大生命的 2%
    for (const hit of bonusHits) expect(hit.amount).toBe(expected);
    // 反过来：如果是按目标最大生命算的（100000 × 2% = 2000），这里一定不相等
    expect(expected).not.toBe(Math.floor((100000 * 200) / 10000));
  });

  it('★ 龙（0.3）：按“龙干员星级总和”给全队攻击力加成（重复干员只算最高星）', () => {
    const defs = tableOf([
      makeDef('dragonA', ['dragon']),
      makeDef('dragonB', ['dragon']),
      // 围观群众：不是龙 —— 它**吃到**加成，但它的星级不该被算进去
      makeDef('bystander', []),
    ]);
    const traitTable: TraitDefTable = { dragon: TRAIT_DEFS['dragon']! };
    const noTraits: TraitDefTable = {};

    /** 造一支队伍，返回围观群众的攻击力（它是"是否吃到光环"的探针） */
    const build = (
      units: UnitPlacement[],
      traits: TraitDefTable,
      bystanderStar = 1,
    ): number => {
      const all: UnitPlacement[] = [
        ...units,
        { defId: 'bystander', star: bystanderStar, cell: { col: 4, row: 9 } },
      ];
      const setup: TeamSetup = {
        team: 0,
        units: all,
        unitMechanics: resolveUnitMechanics(all, defs, traits),
      };
      const state = createBattle(
        defs,
        [setup, { team: 1, units: [{ defId: 'bystander', star: 1, cell: { col: 6, row: 4 } }] }],
        99,
      );
      return state.units.find((unit) => unit.defId === 'bystander' && unit.team === 0)!.attackDamage;
    };

    const pair = (a: number, b: number): UnitPlacement[] => [
      { defId: 'dragonA', star: a, cell: { col: 4, row: 3 } },
      { defId: 'dragonB', star: b, cell: { col: 4, row: 5 } },
    ];

    // 基线：同样的阵容，但完全不带龙羁绊
    const base = build(pair(1, 1), noTraits);

    /*
      ① 两条 1 星龙 -> 2 人头 = 2 档（每星 3%）-> 2 星 x 3% = +6%
      ② 一条 3 星 + 一条 1 星 -> 2 人头 = 2 档 -> 4 星 x 3% = +12%
    */
    expect(build(pair(1, 1), traitTable), '合计 2 星：+6%').toBe(
      base + Math.floor((base * 600) / 10000),
    );
    expect(build(pair(3, 1), traitTable), '合计 4 星：+12%').toBe(
      base + Math.floor((base * 1200) / 10000),
    );

    // ③ 围观群众自己几星都不影响"龙星级总和"
    expect(
      build(pair(3, 1), traitTable, 3),
      '围观群众 3 星也不该被算进龙星级（数字和上面一样）',
    ).toBe(build(pair(3, 1), traitTable, 1));

    /*
      ④ 「重复干员只算最高星级」：同一个 defId 上两只（3★ + 1★）只算 3 星，
         而且人头只算 1 -> 只到 1 档（每星 2%）-> 3 星 x 2% = +6%
    */
    expect(
      build(
        [
          { defId: 'dragonA', star: 3, cell: { col: 4, row: 3 } },
          { defId: 'dragonA', star: 1, cell: { col: 4, row: 5 } },
        ],
        traitTable,
      ),
      '重复干员：只按 3 星算，且只算一个人头（1 档 2% x 3 = +6%）',
    ).toBe(base + Math.floor((base * 600) / 10000));
  });

  it('★ 拉特兰齐射打的是**固定值**（不再随攻击力浮动）', () => {
    const defs = tableOf([
      // 三个拉特兰，攻击力刻意给得很小 —— 如果还按"攻击力总和比例"算，伤害会小得可怜
      makeDef('latA', ['laterano'], { attackDamage: 1, attackSpeed: 3000 }),
      makeDef('latB', ['laterano'], { attackDamage: 1, attackSpeed: 3000 }),
      makeDef('latC', ['laterano'], { attackDamage: 1, attackSpeed: 3000 }),
      makeDef('fatty', [], { hp: 100000, attackDamage: 1, attackSpeed: 100 }),
    ]);
    const traits = oneTier('laterano', 3, [{ kind: 'attackCountNuke', every: 10, flatDamage: 500 }]);
    const teams: [TeamSetup, TeamSetup] = [
      teamOf(
        0,
        [
          { defId: 'latA', col: 4, row: 3 },
          { defId: 'latB', col: 4, row: 5 },
          { defId: 'latC', col: 4, row: 7 },
        ],
        defs,
        traits,
      ),
      teamOf(1, [{ defId: 'fatty', col: 5, row: 5 }], defs),
    ];
    const state = createBattle(defs, teams, 5150);

    let guard = 0;
    while (guard++ < 400 && !state.over) step(state, defs);

    const volleys = state.log.filter(
      (event) => event.type === 'cast' && event.skillId === 'trait_laterano_volley',
    );
    expect(volleys.length, '攒够 10 次攻击就该发动').toBeGreaterThan(0);

    const triggerTick = volleys[0]!.t;
    const hits = state.log.filter(
      (event): event is Extract<BattleEvent, { type: 'damage' }> =>
        event.type === 'damage' &&
        event.t === triggerTick &&
        event.damageType === 'physical' &&
        event.attackType === 'spell',
    );
    expect(hits.length, '齐射该打到全体敌人').toBeGreaterThan(0);
    /*
      沙包护甲 0 -> 每一发都正好是固定值 500。
      ★ 事件里的 amount 是**内核单位**（面板值 × FIX=1000），所以写 500 * FIX。
      如果实现里还按"攻击力总和的比例"算，这三个 1 点攻击力的棋子
      打出来的数会是几百而不是 500000，这条断言会直接红。
    */
    for (const hit of hits) expect(hit.amount, '固定值不随攻击力变').toBe(500 * FIX);
  });

  it('★ 剑士的攻速叠加上限真的会停住（不是无限叠）', () => {
    const defs = tableOf([
      makeDef('sword', ['swordsman'], { attackDamage: 5, hp: 200000, attackSpeed: 4000 }),
      makeDef('dummy', [], { hp: 2000000, attackDamage: 1, attackSpeed: 50 }),
    ]);
    const traits = oneTier('swordsman', 1, [
      { kind: 'attackCounterSpeed', every: 1, bonusBp: 1000, maxStacks: 25 },
    ]);
    const teams: [TeamSetup, TeamSetup] = [
      teamOf(0, [{ defId: 'sword', col: 4, row: 4 }], defs, traits),
      teamOf(1, [{ defId: 'dummy', col: 5, row: 4 }], defs),
    ];
    const state = createBattle(defs, teams, 6161);
    let guard = 0;
    while (guard++ < 600 && !state.over) step(state, defs);

    const sword = state.units.find((unit) => unit.defId === 'sword')!;
    // 每击 +10%，上限 25 叠 = +250%
    expect(sword.trait!.bonusAttackSpeedBp, '叠到上限就停住').toBe(25 * 1000);
  });
});

// ============================================================
//  ⑲ 野怪重生：倒地期间无敌 + 不能被选为攻击目标
// ============================================================
describe('A 版第 19 条：重生期间无敌、不能被选为攻击目标', () => {
  /** 造一场"我方两个干员 vs 博卓卡斯替"的战斗 */
  function bossBattle() {
    const state = createBattle(
      UNIT_DEFS,
      [
        {
          team: 0,
          units: [
            { defId: 'op08', star: 1, cell: { col: 4, row: 4 } },
            { defId: 'op15', star: 1, cell: { col: 3, row: 5 } },
          ],
        },
        { team: 1, units: [{ defId: 'mn_skzdd', star: 1, cell: { col: 5, row: 4 } }] },
      ],
      31,
    );
    const boss = state.units.find((unit) => unit.defId === 'mn_skzdd')!;
    return { state, boss };
  }

  it('★ 倒地期间：没人锁它、也吃不到任何伤害（无敌）', () => {
    const { state, boss } = bossBattle();
    killUnit(state, boss);
    expect(boss.dead, '倒地不等于死亡（否则会当场判胜负）').toBe(false);
    expect(boss.downedUntilTick, '该进入倒地等待').toBeDefined();

    for (let i = 0; i < 30 && boss.downedUntilTick !== undefined; i++) {
      step(state, UNIT_DEFS);
      for (const unit of state.units.filter((item) => item.team === 0 && !item.dead)) {
        expect(unit.targetId, `${unit.defId} 不该锁着倒地的 Boss`).not.toBe(boss.id);
      }
      const damageThisTick = state.log.filter(
        (event) => event.type === 'damage' && event.targetId === boss.id && event.t === state.tick - 1,
      );
      expect(damageThisTick, '倒地期间不该再挨打').toHaveLength(0);
    }
  });

  it('★ 连真伤也吃不进去（dealDamage 直接返回 0）', () => {
    const { state, boss } = bossBattle();
    killUnit(state, boss);
    expect(boss.hp).toBe(0);

    const attacker = state.units.find((unit) => unit.team === 0)!;
    const dealt = dealDamage(state, attacker, boss, 9999 * 1000, 'true', 'spell');
    expect(dealt, '倒地期间任何伤害都是 0').toBe(0);
    expect(boss.hp).toBe(0);
  });

  it('★ 复活之后又能被打到（无敌只存在于"倒地等待"这一段）', () => {
    const { state, boss } = bossBattle();
    killUnit(state, boss);

    let guard = 0;
    while (boss.downedUntilTick !== undefined && !state.over && guard++ < 400) {
      step(state, UNIT_DEFS);
    }
    expect(boss.downedUntilTick, '到点了该站起来').toBeUndefined();
    expect(boss.phase).toBe(2);
    expect(boss.hp).toBeGreaterThan(0);

    // 站起来之后要重新能被选中（否则会变成"永远打不死的 Boss"）
    const hpBefore = boss.hp;
    const attacker = state.units.find((unit) => unit.team === 0 && !unit.dead);
    if (attacker) {
      dealDamage(state, attacker, boss, 100 * 1000, 'true', 'spell');
      expect(boss.hp, '复活后必须能掉血').toBeLessThan(hpBefore);
    }
  });
});

// ============================================================
//  0.2：卡西米尔召唤援军（**真 bug 的回归测试**）
// ============================================================
describe('0.2：卡西米尔的援军真的会被召唤出来', () => {
  it('★ 3 人档 -> 在生命值最高的友方旁边召唤「左手」白杨', () => {
    const members = Object.values(UNIT_DEFS)
      .filter((def) => def.traits.includes('kazimierz'))
      .slice(0, 3);
    expect(members, '卡西米尔至少要有 3 个成员').toHaveLength(3);

    const units: UnitPlacement[] = members.map((def, index) => ({
      defId: def.id,
      star: 1,
      cell: { col: 3, row: 3 + index },
    }));
    const setup: TeamSetup = {
      team: 0,
      units,
      // 走真实的解析链路：机制是从羁绊表算出来的，不是在测试里手写的
      unitMechanics: resolveUnitMechanics(units, UNIT_DEFS, TRAIT_DEFS),
    };
    const state = createBattle(UNIT_DEFS, [setup, { team: 1, units: [] }], 7);

    /*
      ★★ 这条守的是一个真 bug（用户试玩报的）：
      `startSummon` 原来**只在共享藏品那条路**（`applySharedItemBattleStart`）里有分支，
      羁绊表里写的 `startSummon` 谁都不读 —— 凑齐卡西米尔却看不到援军，
      而且**不报任何错**。（和 bench / itemState.bag 被吞掉是同一种失败方式。）
    */
    const ally = state.units.find((unit) => unit.defId === 'mn_tytus' && unit.team === 0);
    expect(ally, '卡西米尔 3 人档必须召唤「左手」白杨').toBeDefined();
    expect(ally!.dead).toBe(false);
  });

  it('★ 6 人档召唤血骑士（数据是 summonId，别再写死谁召唤谁）', () => {
    const members = Object.values(UNIT_DEFS).filter((def) => def.traits.includes('kazimierz'));
    // 卡西米尔只有 6 个成员 -> 靠转职藏品才够 8 人档，这里只验 6 人档
    expect(members.length).toBeGreaterThanOrEqual(6);
    const six = members.slice(0, 6);
    const units: UnitPlacement[] = six.map((def, index) => ({
      defId: def.id,
      star: 1,
      cell: { col: 2 + (index % 3), row: 3 + Math.floor(index / 3) },
    }));
    const setup: TeamSetup = {
      team: 0,
      units,
      unitMechanics: resolveUnitMechanics(units, UNIT_DEFS, TRAIT_DEFS),
    };
    const state = createBattle(UNIT_DEFS, [setup, { team: 1, units: [] }], 11);
    expect(state.units.some((unit) => unit.defId === 'mn_bldkgt' && unit.team === 0)).toBe(true);
  });

  it('★★ 援军的「复活」必须跟着召唤物一起挂上去（spawnSummon 曾经漏了 reborn）', () => {
    const members = Object.values(UNIT_DEFS).filter((def) => def.traits.includes('kazimierz'));
    const six = members.slice(0, 6);
    const units: UnitPlacement[] = six.map((def, index) => ({
      defId: def.id,
      star: 1,
      cell: { col: 2 + (index % 3), row: 3 + Math.floor(index / 3) },
    }));
    const setup: TeamSetup = {
      team: 0,
      units,
      unitMechanics: resolveUnitMechanics(units, UNIT_DEFS, TRAIT_DEFS),
    };
    const state = createBattle(UNIT_DEFS, [setup, { team: 1, units: [] }], 11);

    /*
      ★★ 这条守的是一个真 bug（用户试玩报的）：`spawnSummon` 是手搓 UnitState 的，
      没有像 `createUnit` 那样复制 `def.reborn` ⇒ 召唤出来的援军**永远不复活**，
      而且不报任何错。
    */
    const knight = state.units.find((unit) => unit.defId === 'mn_bldkgt' && unit.team === 0);
    expect(knight, '6 人档必须召唤血骑士').toBeDefined();
    expect(knight!.reborn, '援军必须带上 def 里的 reborn（否则复活失效）').toBeDefined();
    expect(knight!.rebornUsed).toBe(false);
  });
});
