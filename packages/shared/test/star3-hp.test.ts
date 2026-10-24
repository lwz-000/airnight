/**
 * ============================================================
 *  ★ 3 星高费：额外加固定生命上限（4 费 +3000 / 5 费 +5000）
 * ============================================================
 *
 * 【用户原话】
 *   · "给全部 3 星 5 费干员加 5000 血量上限"
 *   · "给全部 3 星 4 费干员加 3000 血量上限"
 *
 * 【为什么单独一份测试？】
 * 因为这里**有两层加成，语义完全不同**，很容易被后来的人改错：
 *   · `STAR3_HP_BONUS_BP`（旧）—— **乘算**，4 费 ×1.2、5 费 ×2
 *   · `STAR3_HP_FLAT_BY_COST`（新）—— **加算**，4 费 +3000、5 费 +5000
 * 一个"按比例翻"、一个"人人加固定值"，对血厚/血薄的人效果完全不同。
 *
 * 【为什么精确数值用一个"只有血量的假棋子"来测？】
 * 真实干员的技能/被动里还有 `hpFlat`（玛恩纳"+1000 生命"就是这一类），
 * 而且 3 星换的是**另一套技能**（star3）—— 拿真名单做加减法会把这些混进来，
 * 测出来的差值就不再是"那 3000/5000"，红了你也不知道该改哪边。
 * 所以：**精确性交给假棋子**，**覆盖面交给真名单**。
 */

import { describe, expect, it } from 'vitest';
import {
  FIX,
  STAR3_HP_BONUS_BP,
  STAR3_HP_FLAT_BY_COST,
  UNIT_DEFS,
  createRng,
  createUnit,
  isPlayableDef,
  starMultiplier,
  type UnitDef,
} from '../src/index.js';

/** 一个"除了血量什么都没有"的棋子：没有技能、没有被动 —— 只看星级那三层 */
function plainDef(cost: number, hp: number): UnitDef {
  return {
    id: `plain${cost}`,
    name: `plain${cost}`,
    cost,
    traits: [],
    base: {
      hp,
      attackDamage: 10,
      attackSpeed: 1000,
      armor: 0,
      magicResist: 0,
      range: 1,
      manaPerAttack: 0,
    },
    starHpBp: 1800,
    starDamageBp: 1800,
    color: '#888888',
    sprite: 'plain',
    skill: { id: `plain${cost}_skill`, name: 'x', desc: 'x', effects: [], manaSource: 'attack' },
  };
}

function makeUnit(def: UnitDef, star: number) {
  return createUnit(def, 0, star, { col: 0, row: 0 }, 0, createRng(1));
}

/** 「基础 × 星级倍率 × 3 星质变倍率」这一层（不含那条固定加血） */
function hpBeforeFlat(def: UnitDef, star: number): number {
  const hpBp = starMultiplier(star, def.starHpBp);
  const star3Bp = star >= 3 ? (STAR3_HP_BONUS_BP[def.cost] ?? 10000) : 10000;
  const total = Math.floor((hpBp * star3Bp) / 10000);
  return Math.floor((def.base.hp * FIX * total) / 1000);
}

/**
 * 正式干员（排除召唤物 / 野怪 / 彩蛋）。
 * ★ 0.3.2：顺带排除升变形态（ascendOnly）—— 它们不是商店名单里的棋子，
 *   判据统一走 `isPlayableDef()`（唯一实现）。
 */
const operators = Object.values(UNIT_DEFS).filter(
  (def) => isPlayableDef(def) && !def.noStar,
);

describe('★ 3 星高费加固定血量：数值表', () => {
  it('表里写的就是 4 费 +3000、5 费 +5000', () => {
    expect(STAR3_HP_FLAT_BY_COST[4]).toBe(3000);
    expect(STAR3_HP_FLAT_BY_COST[5]).toBe(5000);
  });

  it('1~3 费不许偷偷加（这两条点名的只有 4 费和 5 费）', () => {
    for (const cost of [1, 2, 3]) {
      expect(STAR3_HP_FLAT_BY_COST[cost] ?? 0, `${cost} 费不该有这条加成`).toBe(0);
    }
  });
});

describe('★ 3 星 5 费：+5000 生命上限', () => {
  const fiveCostDefs = operators
    .filter((def) => def.cost === 5)
    .sort((a, b) => a.id.localeCompare(b.id));

  it('★ 精确值：3 星时正好比"没有这条"多 5000，当前血量也一起抬高', () => {
    const def = plainDef(5, 1000);
    const unit = makeUnit(def, 3);
    expect(unit.maxHp).toBe(hpBeforeFlat(def, 3) + 5000 * FIX);
    expect(unit.baseMaxHp, 'baseMaxHp 也要带上，否则技能重算上限时会抹掉').toBe(unit.maxHp);
    expect(unit.hp, '开战时满血').toBe(unit.maxHp);
  });

  it('★ 只加 3 星的：1 星 / 2 星一点都不加', () => {
    const def = plainDef(5, 1000);
    for (const star of [1, 2]) {
      expect(makeUnit(def, star).maxHp, `${star} 星不该有这条加成`).toBe(hpBeforeFlat(def, star));
    }
  });

  it('★ 只加 4/5 费的：3 星 1~3 费一点都不加', () => {
    for (const cost of [1, 2, 3]) {
      const def = plainDef(cost, 1000);
      expect(makeUnit(def, 3).maxHp, `${cost} 费不该有这条加成`).toBe(hpBeforeFlat(def, 3));
    }
  });

  it('★ 两层是叠加的：3 星 5 费 = 基础 × 3.24 × 2 + 5000（翻倍那层还在）', () => {
    const def = plainDef(5, 1000);
    const unit = makeUnit(def, 3);
    const doubled = Math.floor(
      (1000 * FIX * Math.floor((starMultiplier(3, def.starHpBp) * STAR3_HP_BONUS_BP[5]!) / 10000)) / 1000,
    );
    expect(unit.maxHp).toBe(doubled + 5000 * FIX);
    // 翻倍那层没被顶掉：单靠"星级倍率"只有 ×3.24
    expect(unit.maxHp).toBeGreaterThan(hpBeforeFlat(def, 3));
  });

  it('正式名单里 7 个 5 费干员全部覆盖到（一个都不能漏）', () => {
    expect(fiveCostDefs.map((def) => def.id)).toEqual([
      'op45',
      'op46',
      'op47',
      'op48',
      'op49',
      'op50',
      // ★ 0.2 追加：丰川祥子
      'op55',
    ]);
  });

  it('★ 真实名单：每个 5 费干员的 3 星血量都不低于「基础 × 6.48 + 5000」', () => {
    for (const def of fiveCostDefs) {
      const lower = hpBeforeFlat(def, 3) + 5000 * FIX;
      const unit = makeUnit(def, 3);
      // 技能被动只会**加**血，所以实际值不可能低于这个下界
      expect(unit.maxHp, `${def.name}（${def.id}）的 3 星血量低于下界`).toBeGreaterThanOrEqual(lower);
    }
  });

  it('★ 真实名单：1/2 星的血量里没有混进 3 星那条「翻倍 + 5000」', () => {
    for (const def of fiveCostDefs) {
      const lower3 = hpBeforeFlat(def, 3) + 5000 * FIX;
      for (const star of [1, 2]) {
        const unit = makeUnit(def, star);
        expect(unit.maxHp, `${def.name} 的 ${star} 星不该达到 3 星的水平`).toBeLessThan(lower3);
        expect(unit.maxHp, `${def.name} 的 ${star} 星低于基础值`).toBeGreaterThanOrEqual(
          hpBeforeFlat(def, star),
        );
      }
    }
  });
});

describe('★ 3 星 4 费：+3000 生命上限', () => {
  const fourCostDefs = operators
    .filter((def) => def.cost === 4)
    .sort((a, b) => a.id.localeCompare(b.id));

  it('★ 精确值：3 星时正好比"没有这条"多 3000，当前血量也一起抬高', () => {
    const def = plainDef(4, 1000);
    const unit = makeUnit(def, 3);
    expect(unit.maxHp).toBe(hpBeforeFlat(def, 3) + 3000 * FIX);
    expect(unit.baseMaxHp, 'baseMaxHp 也要带上，否则技能重算上限时会抹掉').toBe(unit.maxHp);
    expect(unit.hp, '开战时满血').toBe(unit.maxHp);
  });

  it('★ 只加 3 星的：1 星 / 2 星一点都不加', () => {
    const def = plainDef(4, 1000);
    for (const star of [1, 2]) {
      expect(makeUnit(def, star).maxHp, `${star} 星不该有这条加成`).toBe(hpBeforeFlat(def, star));
    }
  });

  it('★ 4 费那条和 5 费那条是**各自**的：同时存在也不会串味', () => {
    // 4 费只吃 3000，绝不该吃到 5 费那 5000
    const def4 = plainDef(4, 1000);
    const def5 = plainDef(5, 1000);
    expect(makeUnit(def4, 3).maxHp - hpBeforeFlat(def4, 3)).toBe(3000 * FIX);
    expect(makeUnit(def5, 3).maxHp - hpBeforeFlat(def5, 3)).toBe(5000 * FIX);
  });

  it('★ 两层是叠加的：3 星 4 费 = 基础 × 3.24 × 1.2 + 3000', () => {
    const def = plainDef(4, 1000);
    const unit = makeUnit(def, 3);
    const scaled = Math.floor(
      (1000 * FIX * Math.floor((starMultiplier(3, def.starHpBp) * STAR3_HP_BONUS_BP[4]!) / 10000)) / 1000,
    );
    expect(unit.maxHp).toBe(scaled + 3000 * FIX);
  });

  it('正式名单里 10 个 4 费干员全部覆盖到（一个都不能漏）', () => {
    expect(fourCostDefs.map((def) => def.id)).toEqual([
      'op36',
      'op37',
      'op38',
      'op39',
      'op40',
      'op41',
      'op42',
      'op43',
      'op44',
      // ★ 0.2 追加：八幡海铃
      'op54',
    ]);
  });

  it('★ 真实名单：每个 4 费干员的 3 星血量都不低于「基础 × 3.888 + 3000」', () => {
    for (const def of fourCostDefs) {
      const lower = hpBeforeFlat(def, 3) + 3000 * FIX;
      const unit = makeUnit(def, 3);
      expect(unit.maxHp, `${def.name}（${def.id}）的 3 星血量低于下界`).toBeGreaterThanOrEqual(lower);
    }
  });

  it('★ 真实名单：1/2 星没有被这条加成污染', () => {
    for (const def of fourCostDefs) {
      const lower3 = hpBeforeFlat(def, 3) + 3000 * FIX;
      for (const star of [1, 2]) {
        const unit = makeUnit(def, star);
        expect(unit.maxHp, `${def.name} 的 ${star} 星不该达到 3 星的水平`).toBeLessThan(lower3);
      }
    }
  });
});
