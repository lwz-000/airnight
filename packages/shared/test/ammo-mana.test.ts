/**
 * ============================================================
 *  ★★ 0.2.1：两条**「技能还没放完就不回蓝」**的口径（用户明确要求）
 * ============================================================
 *
 *   ① **弹药类技能**（`attacks: N`）：子弹没打完之前技能条一格都不涨，打空之后才开始攒。
 *   ② **锁定—引爆**（蕾缪安 3 星）：7 颗弹药炸下去之前一格都不涨，炸完之后才开始攒。
 *
 * 【口径（别改反了）】
 *   这两条**长得都像 bug**（"技能条不动了"），但都是要的效果。
 *   曾经按"这是 bug"去改过一版（让弹药期也回蓝）—— 被用户纠正，已回滚。
 *   见 `gainMana` 里那两段注释。
 *
 * 【为什么值得钉测试】
 *   后面接手的人很容易又去"修"一次，所以用测试把它固定成"预期行为"。
 *
 * 【② 为什么必须单独一条】
 *   蕾缪安走的是**自动回复**（`manaSource: 'auto'`），那条路特意绕开了
 *   "技能生效中不攒蓝"的闸门，光靠 `isSkillActive` 根本拦不住她。
 */
import { describe, expect, it } from 'vitest';
import {
  MANA_MAX,
  TRAIT_DEFS,
  UNIT_DEFS,
  computeActiveTraitLevels,
  computeTraitBonuses,
  computeUnitTraitBonuses,
  createBattle,
  resolveUnitMechanics,
  step,
  type TeamSetup,
  type UnitPlacement,
} from '../src/index.js';

function place(team: 0 | 1, defId: string, star: number, col: number, row: number): UnitPlacement {
  return { defId, star, cell: { col, row } };
}
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

/** 开一场战斗：我方一只、敌方两只**不还手**的靶子（保证她能活到引爆） */
function soloBattle(op: string, star: number) {
  const state = createBattle(
    UNIT_DEFS,
    [team(0, [place(0, op, star, 3, 5)]), team(1, [place(1, 'mn_slime', 1, 6, 5), place(1, 'mn_slime', 1, 7, 5)])],
    20261024,
  );
  for (const unit of state.units) {
    if (unit.team !== 1) continue;
    unit.maxHp = 90_000_000;
    unit.hp = unit.maxHp;
    unit.armor = 0;
    unit.magicResist = 0;
    unit.attackDamage = 0; // ★ 不还手：这条测的是回蓝，不是生存
  }
  const me = state.units.find((unit) => unit.team === 0)!;
  me.mana = MANA_MAX;
  return { state, me };
}

/** 弹药期专用：靶子不用改攻击力 */
function ammoBattle(op: string, star: number) {
  return soloBattle(op, star);
}

/** 这只棋子身上还有没有技能给的弹药 */
function ammoLeft(unit: { skill?: { buffs: Array<{ ticksLeft: number; fromSkill?: true; attackCharges?: number }> } }): boolean {
  return (unit.skill?.buffs ?? []).some(
    (buff) => buff.ticksLeft > 0 && buff.fromSkill === true && (buff.attackCharges ?? 0) > 0,
  );
}

describe('★ 0.2.1 弹药类技能：**子弹没打完就不回蓝**（用户口径）', () => {
  for (const [op, label] of [
    ['op50', '新约能天使 3 星'],
    ['op45', '维什戴尔 3 星'],
    ['op46', '凯尔希·思衡托 3 星'],
  ] as const) {
    it(`${label}：弹药期法力一直是 0，打空之后才涨`, () => {
      const { state, me } = ammoBattle(op, 3);
      let sawAmmo = false;
      let manaDuringAmmo = 0;
      let manaAfterAmmo = 0;

      for (let i = 0; i < 600 && !state.over; i++) {
        step(state, UNIT_DEFS);
        if (ammoLeft(me)) {
          sawAmmo = true;
          manaDuringAmmo = Math.max(manaDuringAmmo, me.mana);
        } else if (sawAmmo) {
          manaAfterAmmo = Math.max(manaAfterAmmo, me.mana);
        }
      }

      expect(sawAmmo, '前提：技能确实是"按次数"的').toBe(true);
      expect(manaDuringAmmo, '★ 子弹没打完时法力必须一直是 0').toBe(0);
      expect(manaAfterAmmo, '打空之后技能条要能重新攒').toBeGreaterThan(0);
    });
  }
});

describe('★ 0.2.1 锁定—引爆（蕾缪安 3 星）：**炸之前不回蓝**（用户口径）', () => {
  it('7 颗弹药锁定期间法力一直是 0，引爆之后才开始攒', () => {
    const { state, me } = soloBattle('op38', 3);
    let sawLockOn = false;
    let manaDuringLockOn = 0;
    let manaAfterBlast = 0;

    for (let i = 0; i < 900 && !state.over; i++) {
      step(state, UNIT_DEFS);
      if (me.skill?.lockOn) {
        sawLockOn = true;
        manaDuringLockOn = Math.max(manaDuringLockOn, me.mana);
      } else if (sawLockOn) {
        manaAfterBlast = Math.max(manaAfterBlast, me.mana);
      }
    }

    expect(sawLockOn, '前提：3 星确实进了"锁定—引爆"').toBe(true);
    expect(manaDuringLockOn, '★ 锁定期间（自动回复也拦）法力必须一直是 0').toBe(0);
    expect(manaAfterBlast, '引爆之后技能条要能重新攒').toBeGreaterThan(0);
  });

  it('引爆之后锁定计划必须清掉（否则永远回不了蓝）', () => {
    const { state, me } = soloBattle('op38', 3);
    let sawLockOn = false;
    for (let i = 0; i < 900 && !state.over; i++) {
      step(state, UNIT_DEFS);
      if (me.skill?.lockOn) sawLockOn = true;
      else if (sawLockOn) break;
    }
    expect(sawLockOn).toBe(true);
    expect(me.skill?.lockOn, '引爆那一 tick 要把 lockOn 置空').toBeUndefined();
  });
});
