/**
 * 羁绊加成「给谁」的测试。
 *
 * 【为什么专门写一组测试？】
 * 因为这里有一个"数字看着对、其实错了"的坑：
 * 最早的实现把一支队伍所有羁绊的效果合并成一个扁平列表，
 * 再套到**每一个**棋子上 —— 「全体重装 +30 护甲」实际变成了「全队 +30 护甲」。
 * 战斗照样能打，棋子也确实变强了，从结果上完全看不出问题，
 * 但数据表和界面描述全是假的。
 *
 * 所以这里要钉住三件事：
 *   1. `scope: 'members'`（默认）只加给带这个标签的棋子
 *   2. `scope: 'team'` 加给全队
 *   3. 羁绊真的**进到了战斗里**（曾经算出来了但没传给内核，等于没有羁绊）
 */

import { describe, expect, it } from 'vitest';
import {
  TRAIT_DEFS,
  UNIT_DEFS,
  buildTraitStatus,
  computeActiveTraitLevels,
  computeTraitGold,
  computeTraitBonuses,
  computeUnitTraitBonuses,
  countTraits,
  createBattle,
  formatTraitEffect,
  formatTraitEffects,
  simulate,
  // ★ 0.3.31：验证治疗效果方向要用
  healUnit,
  resolveUnitMechanics,
  FIX,
  type TeamSetup,
  type TraitDefTable,
  type UnitDefTable,
  type UnitPlacement,
} from '../src/index.js';

/** 找几个带指定标签的干员（不写死名字 —— 名单以后会换） */
function unitsWithTrait(trait: string, count: number): string[] {
  return Object.values(UNIT_DEFS)
    .filter((def) => def.traits.includes(trait))
    .map((def) => def.id)
    .sort()
    .slice(0, count);
}

function placementsOf(defIds: string[]): UnitPlacement[] {
  return defIds.map((defId, index) => ({
    defId,
    star: 1,
    // 只用队伍 0 的半场；具体位置对"算羁绊"没影响
    cell: { col: index % 5, row: Math.floor(index / 5) },
  }));
}

describe('羁绊加成的作用范围', () => {
  it('真实数据里两种 scope 都存在（不然这组测试是空的）', () => {
    const scopes = new Set(Object.values(TRAIT_DEFS).map((def) => def.scope ?? 'members'));
    expect(scopes.has('members')).toBe(true);
    expect(scopes.has('team')).toBe(true);
  });

  it('默认 scope 是 members：法师吃不到剑士羁绊', () => {
    const swordsmen = unitsWithTrait('swordsman', 3);
    expect(swordsmen.length).toBe(3);

    const placements = placementsOf(swordsmen);
    const perUnit = computeUnitTraitBonuses(placements, UNIT_DEFS, TRAIT_DEFS);

    // 参与的剑士都吃到加成
    for (const id of swordsmen) {
      expect(perUnit[id], `${id} 应该吃到剑士羁绊`).toBeDefined();
      expect(perUnit[id]!.some((b) => b.traitId === 'swordsman')).toBe(true);
    }

    // 没上场的剑士不该出现在表里
    const allSwordsmen = unitsWithTrait('swordsman', 99);
    const notPlaced = allSwordsmen.filter((id) => !swordsmen.includes(id));
    if (notPlaced.length > 0) {
      expect(perUnit[notPlaced[0]!]).toBeUndefined();
    }
  });

  it('★ 只给带标签的棋子：队伍里塞一个法师，法师不该吃到剑士加成', () => {
    const swordsmen = unitsWithTrait('swordsman', 3);
    const casterId = unitsWithTrait('caster', 1)[0]!;
    // 确认这个法师真的不是剑士（否则测试没意义）
    expect(UNIT_DEFS[casterId]!.traits).not.toContain('swordsman');

    const placements = placementsOf([...swordsmen, casterId]);
    const perUnit = computeUnitTraitBonuses(placements, UNIT_DEFS, TRAIT_DEFS);

    expect(perUnit[swordsmen[0]!]).toBeDefined();
    expect(perUnit[casterId]).toBeUndefined();
  });

  it('★ 全队型羁绊（领导人）加给所有人，不管有没有这个标签', () => {
    /*
      注意：你的设计里领导人有一条特殊条件 ——
      「我方只有一个领导人干员时触发（2、3 个人时不触发）」。
      所以这里**只能上 1 个**领导人，上第 2 个反而会失效（下面有一条专门测它）。
    */
    const leaders = unitsWithTrait('leader', 1);
    expect(leaders.length).toBe(1);

    const casterId = unitsWithTrait('caster', 1)[0]!;
    const placements = placementsOf([...leaders, casterId]);

    // 全队型走另一条路：computeTraitBonuses 返回扁平列表
    const teamBonuses = computeTraitBonuses(placements, UNIT_DEFS, TRAIT_DEFS);
    expect(teamBonuses.some((b) => b.traitId === 'leader')).toBe(true);

    // 而本人型里不该出现领导人（否则会重复加两次）
    const perUnit = computeUnitTraitBonuses(placements, UNIT_DEFS, TRAIT_DEFS);
    for (const list of Object.values(perUnit)) {
      expect(list.some((b) => b.traitId === 'leader')).toBe(false);
    }
  });

  it('★ 领导人的「恰好 1 个」条件：上第 2 个就失效', () => {
    const leaders = unitsWithTrait('leader', 2);
    expect(leaders.length).toBeGreaterThanOrEqual(2);

    const one = computeTraitBonuses(placementsOf(leaders.slice(0, 1)), UNIT_DEFS, TRAIT_DEFS);
    expect(one.some((b) => b.traitId === 'leader'), '只上 1 个领导人时该生效').toBe(true);

    const two = computeTraitBonuses(placementsOf(leaders.slice(0, 2)), UNIT_DEFS, TRAIT_DEFS);
    expect(two.some((b) => b.traitId === 'leader'), '上 2 个领导人就该失效').toBe(false);
  });

  it('凑不够档位就没有任何加成', () => {
    // 罗德岛第一档要 2 个：上 1 个不该生效
    const solo = unitsWithTrait('rhodes', 1);
    expect(solo.length).toBe(1);

    const placements = placementsOf(solo);
    expect(computeUnitTraitBonuses(placements, UNIT_DEFS, TRAIT_DEFS)[solo[0]!]).toBeUndefined();
    expect(computeTraitBonuses(placements, UNIT_DEFS, TRAIT_DEFS)).toHaveLength(0);
  });

  it('★ 飞行第一档只要 1 个（你的设计是 1人/2人）', () => {
    const flying = unitsWithTrait('flying', 1);
    expect(flying.length).toBe(1);

    const placements = placementsOf(flying);
    const bonuses = computeUnitTraitBonuses(placements, UNIT_DEFS, TRAIT_DEFS);
    // 射程 +1
    expect(bonuses[flying[0]!]?.some((b) => b.effect === 'rangeFlat' && b.value === 1)).toBe(true);
  });

  it('同样的阵容永远算出同样的加成（确定性）', () => {
    const placements = placementsOf(unitsWithTrait('swordsman', 3));
    const a = computeUnitTraitBonuses(placements, UNIT_DEFS, TRAIT_DEFS);
    const b = computeUnitTraitBonuses(placements, UNIT_DEFS, TRAIT_DEFS);
    expect(a).toEqual(b);
  });

  it('用假数据验证两种 scope 的分流（不依赖真实名单的数值）', () => {
    const defs: UnitDefTable = {
      a: { ...UNIT_DEFS[unitsWithTrait('swordsman', 1)[0]!]!, id: 'a', traits: ['x'] },
      b: { ...UNIT_DEFS[unitsWithTrait('caster', 1)[0]!]!, id: 'b', traits: ['y'] },
    };
    const traitDefs: TraitDefTable = {
      x: {
        id: 'x',
        name: '只有自己人',
        kind: 'class',
        tiers: [{ count: 1, effects: [{ type: 'attackDamageBp', value: 5000 }], desc: '+50% 攻击' }],
      },
      y: {
        id: 'y',
        name: '光环',
        kind: 'class',
        scope: 'team',
        tiers: [{ count: 1, effects: [{ type: 'hpBp', value: 3000 }], desc: '全队 +30% 生命' }],
      },
    };
    const placements = placementsOf(['a', 'b']);

    const perUnit = computeUnitTraitBonuses(placements, defs, traitDefs);
    expect(perUnit['a']).toHaveLength(1);
    expect(perUnit['b']).toBeUndefined();

    const team = computeTraitBonuses(placements, defs, traitDefs);
    expect(team).toHaveLength(1);
    expect(team[0]!.traitId).toBe('y');
  });
});

describe('羁绊真的进了战斗', () => {
  it('★ 上满剑士后，攻击力比"裸数据"更高（验算到棋子属性上）', () => {
    const swordsmen = unitsWithTrait('swordsman', 3);
    const placements = placementsOf(swordsmen);
    const setup: TeamSetup = {
      team: 0,
      units: placements,
      traitBonuses: computeTraitBonuses(placements, UNIT_DEFS, TRAIT_DEFS),
      unitTraitBonuses: computeUnitTraitBonuses(placements, UNIT_DEFS, TRAIT_DEFS),
    };

    // 只为了拿到"开局时每个棋子的属性"，对手给一个空队伍就行
    const empty: TeamSetup = { team: 1, units: [] };
    const withTraits = createBattle(UNIT_DEFS, [setup, empty], 12345);
    const naked = createBattle(UNIT_DEFS, [{ team: 0, units: placements }, empty], 12345);

    for (const unit of withTraits.units) {
      const bare = naked.units.find((u) => u.id === unit.id)!;
      expect(
        unit.attackDamage,
        `${unit.defId} 上了剑士羁绊后攻击力应该更高`,
      ).toBeGreaterThan(bare.attackDamage);
    }
  });

  it('★ 把加成传进内核后，战斗结果会变（不是"算了却没用"）', () => {
    // 用同一批棋子打自己（镜像），唯一的变量是"有没有羁绊"
    const swordsmen = unitsWithTrait('swordsman', 3);
    const left = placementsOf(swordsmen);
    const right = placementsOf(swordsmen).map((p) => ({ ...p, cell: { col: 9 - p.cell.col, row: p.cell.row } }));

    const boosted: TeamSetup = {
      team: 0,
      units: left,
      traitBonuses: computeTraitBonuses(left, UNIT_DEFS, TRAIT_DEFS),
      unitTraitBonuses: computeUnitTraitBonuses(left, UNIT_DEFS, TRAIT_DEFS),
    };
    const plain: TeamSetup = { team: 1, units: right };

    const result = simulate(UNIT_DEFS, [boosted, plain], 999);
    // 吃了羁绊的一方应该赢（或者至少局面不同）
    expect(result.winner).toBe(0);
  });
});

describe('★ 同一个干员上场多个（含不同星级）只算一个人头', () => {
  /*
    【你报的问题】"上场 2 个相同的干员还是会重复触发羁绊"。

    这里要分清**两件事**，之前只修了前一件：
      1. 加成/机制被重复应用 —— 3 个同样的剑士把 +10% 攻击加了 3 次
         （实测攻击力 620 -> 1018）。这个早就修了：一个 defId 只吃一份。
      2. **人头数**也被算成 3 —— 所以 3 个同名能凑到剑士 3 档、2 个同名能凑到
         奸商 2 档。你两次说「上场相同的角色不会重复触发羁绊」，
         指的就是这个：**羁绊看的是阵容里有几种不同的干员**。

    所以现在 `countTraits` 按 defId 去重统计（见 synergies.ts 里的
    COUNT_DUPLICATE_OPERATORS 开关），下面把这条规则整个钉住。

    【配套结论】堆同一个干员对凑羁绊毫无帮助 —— 要凑剑士 3 档，
    必须上 3 个**不同**的剑士。（这对平衡影响很大，所以做成了开关。）
  */
  const swordsmen = Object.values(UNIT_DEFS)
    .filter((def) => def.traits.includes('swordsman'))
    .map((def) => def.id)
    .sort();
  const swordsman = swordsmen[0]!;

  function placements(units: Array<[string, number]>): UnitPlacement[] {
    return units.map(([defId, star], index) => ({
      defId,
      star,
      cell: { col: index % 5, row: Math.floor(index / 5) },
    }));
  }

  it('真实数据里至少有 3 个不同剑士（不然下面几条测试没意义）', () => {
    expect(swordsmen.length).toBeGreaterThanOrEqual(3);
  });

  it('★ 人头数按"不同干员"算：3 个同名剑士 = 1', () => {
    const three = placements([
      [swordsman, 1],
      [swordsman, 1],
      [swordsman, 1],
    ]);
    expect(countTraits(three, UNIT_DEFS).get('swordsman')).toBe(1);

    // 3 个不同的才是 3
    const distinct = placements([
      [swordsmen[0]!, 1],
      [swordsmen[1]!, 1],
      [swordsmen[2]!, 1],
    ]);
    expect(countTraits(distinct, UNIT_DEFS).get('swordsman')).toBe(3);
  });

  it('★ 同名但星级不同（1星 + 2星 + 1星）也只算 1 人头', () => {
    const mixed = placements([
      [swordsman, 1],
      [swordsman, 2],
      [swordsman, 1],
    ]);
    expect(countTraits(mixed, UNIT_DEFS).get('swordsman')).toBe(1);
  });

  it('★ 3 个同名剑豪 -> 羁绊根本不触发（只算 1 个人头，越不过 2 档门槛）', () => {
    const three = placements([
      [swordsman, 1],
      [swordsman, 1],
      [swordsman, 1],
    ]);
    expect(computeUnitTraitBonuses(three, UNIT_DEFS, TRAIT_DEFS)[swordsman]).toBeUndefined();
    expect(computeTraitBonuses(three, UNIT_DEFS, TRAIT_DEFS)).toHaveLength(0);
  });

  it('★ 2 个同名 + 1 个别的剑豪 -> 只算 2 人头（0.3 起刚好够 2 档）', () => {
    const mixed = placements([
      [swordsmen[0]!, 1],
      [swordsmen[0]!, 1],
      [swordsmen[1]!, 1],
    ]);
    /*
      ★ 0.3：剑豪档位 3/6/9 -> **2/4/6**，所以"2 人头"现在正好踩到第一档。
      这条用例真正要守的东西没变：**同名只算一个人头**（3 个站位只数出 2）。
    */
    expect(countTraits(mixed, UNIT_DEFS).get('swordsman')).toBe(2);
    expect(computeUnitTraitBonuses(mixed, UNIT_DEFS, TRAIT_DEFS)[swordsmen[0]!]).toHaveLength(2);
  });

  it('★ 3 个不同剑豪 -> 触发，且每人只吃一份 +10% 攻击', () => {
    const three = placements([
      [swordsmen[0]!, 1],
      [swordsmen[1]!, 1],
      [swordsmen[2]!, 1],
    ]);
    for (const id of [swordsmen[0]!, swordsmen[1]!, swordsmen[2]!]) {
      /*
        ★ 0.3：剑豪一档有**两项**加成（+10% 攻击力、+15% 攻速），
        但每一项都只算一份 —— "一个 defId 只吃一份"的口径没变，
        下面的伤害断言就是在检查"没有按人头重复加"。
      */
      expect(computeUnitTraitBonuses(three, UNIT_DEFS, TRAIT_DEFS)[id]).toHaveLength(2);
    }

    const setup = {
      team: 0 as const,
      units: three,
      traitBonuses: computeTraitBonuses(three, UNIT_DEFS, TRAIT_DEFS),
      unitTraitBonuses: computeUnitTraitBonuses(three, UNIT_DEFS, TRAIT_DEFS),
    };
    const state = createBattle(UNIT_DEFS, [setup, { team: 1, units: [] }], 1);
    const unit = state.units[0]!;
    const base = UNIT_DEFS[swordsmen[0]!]!.base.attackDamage * 1000;

    // 剑豪 2 档（0.3）：+10% 攻击力，只加一次 => 向下取整
    expect(unit.attackDamage).toBe(base + Math.floor((base * 1000) / 10000));
    // 排除"加三次"的结果（那会到 1.3 倍以上）
    expect(unit.attackDamage).toBeLessThan(base * 1.3);
  });

  it('★ 同名棋子的"战斗中机制"也只有一份（不是每个复制体各打各的累计）', () => {
    // 剑士 3 档的攻速部分是机制（每攻击 3 次 +10%），
    // 3 个同名现在人头数=1，连档位都到不了 -> 一个机制都不该有
    const three = placements([
      [swordsman, 1],
      [swordsman, 2],
      [swordsman, 3],
    ]);
    expect(computeUnitTraitBonuses(three, UNIT_DEFS, TRAIT_DEFS)[swordsman]).toBeUndefined();
  });
});

describe('羁绊效果的文字格式（三种单位不能混）', () => {
  it('万分比显示成百分比，绝对值显示成数字，金币显示成个数', () => {
    expect(formatTraitEffect({ type: 'attackDamageBp', value: 2500 })).toBe('攻击力 +25%');
    expect(formatTraitEffect({ type: 'attackSpeedBp', value: 1800 })).toBe('攻速 +18%');
    expect(formatTraitEffect({ type: 'hpBp', value: 1200 })).toBe('血量上限 +12%');
    expect(formatTraitEffect({ type: 'armorFlat', value: 30 })).toBe('护甲 +30');
    expect(formatTraitEffect({ type: 'magicResistFlat', value: 15 })).toBe('魔抗 +15');
    expect(formatTraitEffect({ type: 'manaGainBp', value: 3500 })).toBe('法力回复 +35%');
  });

  it('★ 每回合金币 / 攻击距离是"个数"，不是百分比（曾经显示成 +0%）', () => {
    expect(formatTraitEffect({ type: 'goldPerRound', value: 2 })).toBe('每回合金币 +2');
    expect(formatTraitEffect({ type: 'goldPerRound', value: 5 })).toBe('每回合金币 +5');
    // 炮手 +2 格、术士 +1 格 —— 这两个是绝对格数，不能除 100
    expect(formatTraitEffect({ type: 'rangeFlat', value: 2 })).toBe('攻击距离 +2');
    expect(formatTraitEffect({ type: 'rangeFlat', value: 1 })).toBe('攻击距离 +1');
    // 新增的百分比类
    expect(formatTraitEffect({ type: 'armorBp', value: 5000 })).toBe('护甲 +50%');
    expect(formatTraitEffect({ type: 'magicResistBp', value: 10000 })).toBe('魔抗 +100%');
    expect(formatTraitEffect({ type: 'healingBp', value: 3000 })).toBe('治疗效果 +30%');
    expect(formatTraitEffect({ type: 'allStatsBp', value: 2000 })).toBe('全部属性 +20%');
  });

  it('真实数据里每一个效果都能渲染成不含 % 错位的人话', () => {
    // 绝对值类的效果：渲染出来不该带 %
    const absoluteTypes = new Set(['goldPerRound', 'armorFlat', 'magicResistFlat', 'rangeFlat']);

    for (const def of Object.values(TRAIT_DEFS)) {
      for (const tier of def.tiers) {
        /*
          有些档位**故意没有数值效果**，只有"战斗中机制"（比如龙：加成全靠
          "每有一个三星干员提升全部属性"，写法在 mechanics 里，不在 effects 里）。
          这种档位的说明文字在 desc 里，所以这里只要求"要么有数值、要么有机制"。
        */
        const hasMechanics = (tier.mechanics ?? []).length > 0;
        if (tier.effects.length === 0) {
          expect(hasMechanics, `${def.name} 这一档既没数值也没机制`).toBe(true);
          expect(tier.desc.length, `${def.name} 这一档没有说明文字`).toBeGreaterThan(0);
          continue;
        }

        const text = formatTraitEffects(tier.effects);
        expect(text.length).toBeGreaterThan(0);
        for (const effect of tier.effects) {
          const single = formatTraitEffect(effect);
          if (absoluteTypes.has(effect.type)) {
            expect(single, `${def.name} 的 ${effect.type} 不该显示成百分比`).not.toContain('%');
          }
        }
      }
    }
  });
});

describe('羁绊的经济效果（奸商）', () => {
  /*
    你给的奸商效果：「回合结束时，每一名奸商干员（**同一干员只触发一次**）未死亡，
    金币增加 1/2」。
    注意两个细节，测试都要钉住：
      · 上两个同名奸商**不会翻倍**（同一干员只算一次）
      · 必须有"活下来"的干员才给钱
  */
  it('1 个奸商 +1 金；2 个不同奸商各 +2 金（第二档是"每名 +2"）', () => {
    const merchants = unitsWithTrait('merchant', 2);
    expect(merchants.length).toBeGreaterThanOrEqual(2);

    const one = computeTraitGold(placementsOf(merchants.slice(0, 1)), UNIT_DEFS, TRAIT_DEFS);
    expect(one.gold).toBe(1);
    expect(one.sources.join()).toContain('奸商');

    /*
      你的原文：「回合结束时，每一名奸商干员（同一干员只触发一次）未死亡，
      金币增加 1/2」，开启人数「1人/2」。
      按字面理解是"**每名**干员 +1 或 +2"，所以 2 个不同奸商在第二档是 2×2 = 4 金。
      如果你要的是"总共 +2"，把 tier 的 goldEach 改成 1 就行。
    */
    const two = computeTraitGold(placementsOf(merchants.slice(0, 2)), UNIT_DEFS, TRAIT_DEFS);
    expect(two.gold).toBe(4);
  });

  it('★ 上两个同名奸商 -> 只算 1 个奸商（退回第一档，+1）', () => {
    const merchant = unitsWithTrait('merchant', 1)[0]!;
    const other = unitsWithTrait('merchant', 2).find((id) => id !== merchant)!;
    expect(other, '需要至少两个不同的奸商干员').toBeDefined();

    // 两个同名：人头数只有 1 -> 还在第一档（每名 +1），所以 1 × 1 = 1
    const same = computeTraitGold(placementsOf([merchant, merchant]), UNIT_DEFS, TRAIT_DEFS);
    // 两个不同：人头数 2 -> 第二档（每名 +2）-> 2 × 2 = 4
    const different = computeTraitGold(placementsOf([merchant, other]), UNIT_DEFS, TRAIT_DEFS);

    expect(same.gold, '两个同名只算一个奸商，不该进第二档').toBe(1);
    expect(different.gold).toBe(4);
    expect(same.gold, '上两个同名的不该等于两个不同的').toBeLessThan(different.gold);
  });

  it('★ 干员全死了就没有奸商收入', () => {
    const merchants = unitsWithTrait('merchant', 2);
    const placements = placementsOf(merchants.slice(0, 2));
    const allDead = computeTraitGold(placements, UNIT_DEFS, TRAIT_DEFS, new Set<string>());
    expect(allDead.gold, '都阵亡了就不该给钱').toBe(0);

    // 只活下来一个：此时生效的还是"2 个奸商"那一档（人头数没变），
    // 但只有 1 个活着 -> 1 × 2 = 2 金
    const oneAlive = computeTraitGold(placements, UNIT_DEFS, TRAIT_DEFS, new Set([merchants[0]!]));
    expect(oneAlive.gold).toBe(2);
  });

  it('没有奸商就是 0', () => {
    const swordsman = unitsWithTrait('swordsman', 1);
    expect(computeTraitGold(placementsOf(swordsman), UNIT_DEFS, TRAIT_DEFS).gold).toBe(0);
  });
});

describe('★ 0.3.31 治疗效果的方向（打出去 vs 吃进来）', () => {
  /*
    【这个 bug 长什么样】
    `healingBp` 这一个效果字段，其实承载了两种**完全不同**的含义：
      · 全队型（支援）—— 我方全体**受到**的治疗 +X%
      · 本人型（治疗）—— 带标签的干员**打出**的治疗 +X%
    而内核 `healUnit` 以前**只读 `target`（被治疗者）身上那一份**，
    于是"治疗"羁绊凑齐了也一点用都没有：
      它挂在**医疗干员**身上，可只有医疗干员**自己被治疗**时才算数 ⇒ 永远不生效。

    ★ 修法：`TraitBonus` 带上 `scope`，内核按范围分流到两个状态：
        team    -> `healingBonusBp`（受到治疗提升）
        members -> `healingOutBp`  （打出去的治疗提升）
      `healUnit` 两个都吃。
  */

  /** 凑齐最高档需要几个人（数据里最后一档的 count） */
  const HEALING_MAX = TRAIT_DEFS.healing!.tiers[TRAIT_DEFS.healing!.tiers.length - 1]!.count;
  /** 第一档的门槛 —— 比它少一个就**不该**有任何加成 */
  const HEALING_MIN = TRAIT_DEFS.healing!.tiers[0]!.count;

  /**
   * 摆 n 个「医疗」干员，走真实的羁绊解析链路。
   * 敌方放一个随便的一费，只为让战斗能开起来。
   */
  function battleWithHealers(count: number) {
    const medics = unitsWithTrait('healing', count);
    expect(medics.length, '名单里医疗干员不够，测试没意义').toBe(count);
    const units = placementsOf(medics);
    const foes = placementsOf(unitsWithTrait('guard', 1)).map((placement) => ({
      ...placement,
      cell: { col: placement.cell.col + 5, row: placement.cell.row },
    }));
    return createBattle(
      UNIT_DEFS,
      [
        {
          team: 0,
          units,
          unitTraitBonuses: computeUnitTraitBonuses(units, UNIT_DEFS, TRAIT_DEFS),
          unitMechanics: resolveUnitMechanics(units, UNIT_DEFS, TRAIT_DEFS),
        },
        { team: 1, units: foes },
      ],
      999,
    );
  }

  it('★ 人数不够时**不该**有加成（守"别乱给"）', () => {
    const state = battleWithHealers(HEALING_MIN - 1);
    for (const unit of state.units.filter((item) => item.team === 0)) {
      expect(unit.statuses['healingOutBp'], `${unit.defId} 人数不够不该有治疗加成`).toBeUndefined();
    }
  });

  it('★★ 凑齐治疗羁绊 ⇒ 医疗干员身上挂上 healingOutBp（打出去的治疗 +50%）', () => {
    const state = battleWithHealers(HEALING_MAX);
    const medics = state.units.filter((item) => item.team === 0);
    expect(medics.length).toBe(HEALING_MAX);
    for (const unit of medics) {
      expect(
        unit.statuses['healingOutBp'],
        `${unit.defId} 凑齐了治疗羁绊，却没有"打出治疗"加成`,
      ).toBe(5000);
      // ★ 受治疗那一侧**不**该被这条本人型加成影响
      expect(unit.statuses['healingBonusBp']).toBeUndefined();
    }
  });

  it('★★ 端到端：治疗干员奶别人时，实际回血量被放大了', () => {
    const state = battleWithHealers(HEALING_MAX);
    const medics = state.units.filter((item) => item.team === 0);
    const patient = state.units.find((item) => item.team === 1)!;
    /*
      ★ 只在血上限上留 100 点的缺口，奶 10 点 ⇒ 不会被"不超过上限"截断
      （第一版留一半血、奶 1000，结果被上限截断，测出来是 317.5 而不是 1500 —— 假失败）。
    */
    patient.hp = patient.maxHp - 100 * FIX;
    // 医疗干员 = 打出去的那一方，被治疗的是敌方 ⇒ 只有 healingOutBp 该生效
    const healed = healUnit(state, medics[0]!, patient, 10 * FIX);
    expect(healed / FIX, '治疗羁绊没把打出去的治疗量放大').toBe(15);
  });
});

/**
 * ============================================================
 *  ★ 0.1.4：「界面口径」和「开战口径」必须永远一致
 * ============================================================
 *
 * 【为什么值得单独一组？】
 * 「这个羁绊现在生效到第几档」这件事以前**写了两遍**：
 *   · `computeActiveTraitLevels` —— 开战给不给加成；
 *   · `buildTraitStatus`       —— 界面那一行写"已生效"还是"未生效"。
 * 而「恰好 N 名才生效」（领导人）这条条件**只在开战那份里判了**，于是：
 *
 *   上 2 个领导人时 → 开战 tierIndex = -1（一点加成都没有），
 *                     界面 activeAt = 1（高亮成"已生效"、还标成满级金色）。
 *
 * 玩家看到的现象就是「领导人羁绊明明显示生效了却没效果」，
 * 而且从界面上完全查不出原因（数量那一栏会显示成 2/1 这种没法理解的数）。
 *
 * 现在判档收敛到 `activeTierIndexOf` 一处实现，这组测试守住"不许再分叉"。
 */
describe('★ 0.1.4 羁绊的两个口径必须一致（领导人）', () => {
  const leaders = unitsWithTrait('leader', 2);

  it('只上 1 个领导人：界面说生效，开战也真的给加成', () => {
    const placements = placementsOf(leaders.slice(0, 1));
    const ui = buildTraitStatus(placements, UNIT_DEFS, TRAIT_DEFS).find((t) => t.traitId === 'leader');
    const battle = computeActiveTraitLevels(placements, UNIT_DEFS, TRAIT_DEFS).find((t) => t.traitId === 'leader');

    expect(ui?.activeAt, '界面上该显示已生效').not.toBeNull();
    expect(battle?.tierIndex, '开战时也该真的生效').toBe(0);
    expect(ui?.solo, '界面要拿得到"恰好 1 名"这条条件').toEqual({ exactly: 1, ok: true });
  });

  it('上 2 个领导人：界面必须跟着说"未生效"（以前界面会谎报生效）', () => {
    const placements = placementsOf(leaders.slice(0, 2));
    const ui = buildTraitStatus(placements, UNIT_DEFS, TRAIT_DEFS).find((t) => t.traitId === 'leader');
    const battle = computeActiveTraitLevels(placements, UNIT_DEFS, TRAIT_DEFS).find((t) => t.traitId === 'leader');

    expect(battle?.tierIndex, '开战口径：上 2 个就失效（你的设计要求）').toBe(-1);
    expect(ui?.activeAt, '界面口径必须一起变成"未生效"，否则就是在骗玩家').toBeNull();
    expect(ui?.solo, '界面要能解释"为什么失效"（上多了）').toEqual({ exactly: 1, ok: false });
  });

  it('另外几个羁绊的两个口径也一致（不只领导人）', () => {
    const placements = placementsOf([
      ...leaders,
      ...unitsWithTrait('swordsman', 2),
      ...unitsWithTrait('caster', 1),
    ]);
    const ui = new Map(buildTraitStatus(placements, UNIT_DEFS, TRAIT_DEFS).map((t) => [t.traitId, t]));
    for (const level of computeActiveTraitLevels(placements, UNIT_DEFS, TRAIT_DEFS)) {
      const row = ui.get(level.traitId);
      expect(row, `${level.traitId} 该出现在界面上`).toBeDefined();
      expect(row!.activeAt === null, `${level.traitId} 的判定：界面说"生效"、开战说 tierIndex=${level.tierIndex}`).toBe(
        level.tierIndex < 0,
      );
    }
  });
});
