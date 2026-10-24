/**
 * ★ 0.1.4：老鲤「财可通神」——「玩家每拥有 10 枚金币，攻击力 +15%/20%/30%」。
 *
 * ============================================================
 *  【为什么单独一组测试？】
 * ============================================================
 * 这条被动曾经是典型的「配好了没人读」：
 *   · `goldScalingAttackBp` 在 `skill-data.ts` 里写了；
 *   · `SkillStats` 类型里也声明了，注释还写着"开局按金币折算成固定加成"；
 *   · **但全项目没有任何一处消费它**。
 * 老鲤的技能 `effects` 是空数组（纯被动棋子），于是它在场上是一块**白板**：
 * 不放技能、也没有任何被动加成，而且不报任何错 —— 玩家只知道"这棋子没用"。
 *
 * 这一组钉住三件事：
 *   1. 金币确实折成了攻击力：`floor(金币 / perGold)` 步 × 该星级比例；
 *   2. 星级不同比例不同（1 星 15% / 2 星 20% / 3 星 30%）—— 折算必须走 `starValue`；
 *   3. 折算出的加成**真的进了战斗**（不是算完放在某个变量里就没人管了）。
 *
 * ★ 0.2 改动：三档从 10%/15%/15% 改成 **15%/20%/30%**（按策划表结构化列）。
 *   旧值里 2 星和 3 星是同一个数，本身就是"只填了两档"的痕迹。
 *
 * ★ 0.2 改动二：加了 **金币 100 封顶** —— 策划表散文列那句
 *   「当金币达到 100 时达到最大值」，结构化列里**没有**这一句，由用户拍板要。
 *   两条合起来：3 星封顶 = 10 步 × 30% = **+300% 攻击力**。
 */
import { describe, expect, it } from 'vitest';
import {
  UNIT_DEFS,
  collectMods,
  createBattle,
  effectiveAttackDamage,
  goldScalingAttackBpOf,
  type TeamSetup,
  type UnitPlacement,
} from '../src/index.js';

/** 找老鲤（不写死 id —— 名单以后会换） */
const LAOLI = Object.values(UNIT_DEFS).find((def) => def.name === '老鲤')!;

/** 只放队伍 0 的老鲤，队伍 1 空着；`gold` = 开局玩家手里的金币 */
function soloLaoli(star: number, gold: number): [TeamSetup, TeamSetup] {
  const units: UnitPlacement[] = [{ defId: LAOLI.id, star, cell: { col: 4, row: 4 } }];
  return [
    { team: 0, units, playerContext: { gold, hp: 100 } },
    { team: 1, units: [] },
  ];
}

/** 老鲤这一场实际吃到的攻击力加成（万分比） */
function attackBonusBp(star: number, gold: number): number {
  const state = createBattle(UNIT_DEFS, soloLaoli(star, gold), 20261014);
  const unit = state.units.find((u) => u.defId === LAOLI.id)!;
  return collectMods(state, unit).attackDamageBp;
}

describe('★ 0.1.4 老鲤「财可通神」：金币折算', () => {
  it('数据表确实挂着这条被动，而且老鲤是纯被动（没有主动技能）', () => {
    expect(
      LAOLI.skill.passive?.goldScalingAttackBp,
      '这条被动必须有消费方，否则老鲤在场上是一块白板',
    ).toBeDefined();
    expect(LAOLI.skill.effects, '老鲤是纯被动棋子：effects 本来就是空的').toHaveLength(0);
  });

  it('数据表三档比例就是 15%/20%/30%（万分比 1500/2000/3000），并且金币 100 封顶', () => {
    expect(LAOLI.skill.passive?.goldScalingAttackBp).toMatchObject({
      perGold: 10,
      ratioBp: [1500, 2000, 3000],
      maxGold: 100,
    });
  });

  it('3 星：每 10 金币 +30%，34 金 -> 3 步 -> +90%', () => {
    expect(attackBonusBp(3, 0)).toBe(0);
    expect(attackBonusBp(3, 9), '不够一步（9 < 10）就不该有加成').toBe(0);
    expect(attackBonusBp(3, 10), '刚好一步 × 30%').toBe(3000);
    expect(attackBonusBp(3, 34), '3 步 × 30%').toBe(9000);
  });

  it('★ 金币 100 封顶：99 金还是 9 步，100 金就满，1000 金也不会更高', () => {
    /*
      策划表 R111 的散文列写着「当金币达到 100 时达到最大值」，
      用户拍板要这个封顶 —— 不加的话屯金到 200+ 就是 +600% 攻击力。
      （结构化列里没这句，所以这是"超出表的那部分"，见 skill-data.ts 里的注释。）
    */
    expect(attackBonusBp(3, 99), '99 金 = 9 步 × 30%').toBe(27000);
    expect(attackBonusBp(3, 100), '100 金 = 10 步 × 30% = 封顶值').toBe(30000);
    expect(attackBonusBp(3, 1000), '封顶之后给再多金币也不涨').toBe(30000);
    expect(attackBonusBp(1, 1000), '1 星同样封顶：10 步 × 15%').toBe(15000);
  });

  it('封顶是"每一条被动各自的数据"，不是机制写死的（没配 maxGold 就一直涨）', () => {
    /*
      这条守的是"上限没被写死在 goldScalingAttackBpOf 里"。
      以后别的棋子要用同一条机制、但不想封顶，只要不写 maxGold 就行。
    */
    expect(goldScalingAttackBpOf({ goldScalingAttackBp: { perGold: 10, ratioBp: 1000 } }, 1, 500)).toBe(
      50 * 1000,
    );
    // 配了封顶就按封顶算
    expect(
      goldScalingAttackBpOf({ goldScalingAttackBp: { perGold: 10, ratioBp: 1000, maxGold: 100 } }, 1, 500),
    ).toBe(10 * 1000);
    // 数据写坏了（NaN / 负数）兜回"不封顶"，而不是把加成算成 NaN
    expect(
      goldScalingAttackBpOf({ goldScalingAttackBp: { perGold: 10, ratioBp: 1000, maxGold: NaN } }, 1, 200),
    ).toBe(20 * 1000);
    expect(
      goldScalingAttackBpOf({ goldScalingAttackBp: { perGold: 10, ratioBp: 1000, maxGold: -5 } }, 1, 200),
    ).toBe(20 * 1000);
  });

  it('星级比例真的用上了：同样金币，1 星 < 2 星 < 3 星', () => {
    expect(attackBonusBp(1, 20), '2 步 × 15%').toBe(3000);
    expect(attackBonusBp(2, 20), '2 步 × 20%').toBe(4000);
    expect(attackBonusBp(3, 20), '2 步 × 30%').toBe(6000);
    expect(attackBonusBp(1, 20)).toBeLessThan(attackBonusBp(2, 20));
    expect(attackBonusBp(2, 20)).toBeLessThan(attackBonusBp(3, 20));
  });

  it('负数 / 异常金币不会算出负加成（服务端数据可能被手改）', () => {
    expect(goldScalingAttackBpOf({ goldScalingAttackBp: { perGold: 10, ratioBp: 1000 } }, 1, -50)).toBe(0);
    expect(
      goldScalingAttackBpOf({ goldScalingAttackBp: { perGold: 0, ratioBp: 1000 } }, 1, 100),
      'perGold 写 0 不能除出 Infinity（兜底当成"每 1 金币一步"）',
    ).toBe(100 * 1000);
    expect(goldScalingAttackBpOf(undefined, 1, 100), '没配这条被动就是 0').toBe(0);
  });

  it('加成真的进了战斗：金币多的老鲤实际攻击力更高', () => {
    /*
      注意读的是 `effectiveAttackDamage`（基础攻击 × 修正包），
      不是 `unit.attackDamage` —— 后者是白板基础值，修正包不写回去。
      这一条守的是"折算结果真的挂到棋子身上了"，而不只是算对了一个数。
    */
    const rich = createBattle(UNIT_DEFS, soloLaoli(3, 100), 7);
    const poor = createBattle(UNIT_DEFS, soloLaoli(3, 0), 7);
    const richUnit = rich.units.find((u) => u.defId === LAOLI.id)!;
    const poorUnit = poor.units.find((u) => u.defId === LAOLI.id)!;
    const richAtk = effectiveAttackDamage(richUnit, collectMods(rich, richUnit));
    const poorAtk = effectiveAttackDamage(poorUnit, collectMods(poor, poorUnit));
    expect(richAtk).toBeGreaterThan(poorAtk);

    // ★ 封顶也真的进了战斗：1000 金的老鲤和 100 金的老鲤，面板攻击力一模一样
    const over = createBattle(UNIT_DEFS, soloLaoli(3, 1000), 7);
    const overUnit = over.units.find((u) => u.defId === LAOLI.id)!;
    expect(
      effectiveAttackDamage(overUnit, collectMods(over, overUnit)),
      '金币 100 封顶之后，给再多金币攻击力也不该再涨',
    ).toBe(richAtk);
  });
});
