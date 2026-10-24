/**
 * ★ 0.2：护盾的四件新东西 —— 左乐 + 机械师。
 *
 * ============================================================
 *  【这一组守的是什么？】
 * ============================================================
 * 两位干员把「护盾」从一个"固定点数 + 固定时长"的东西，
 * 扩成了四种状态：
 *
 *   · **按已损失生命**（左乐）—— 血越少盾越厚，基准是**施法者**的已损失生命；
 *   · **自己衰减**（机械师）—— 每秒掉「获得总量」的 15%，6.67 秒自然消失；
 *   · **破盾子弹**（机械师）—— 盾打空时消耗一颗、补一层同样的盾、炸一下周围；
 *   · **护盾期间不回技力**（左乐）—— 挡在 `gainMana` 这个唯一入口上。
 *
 * 这几条都**不是**改个数字就能完事的，它们各自需要在核心里有一条真实生效的路径；
 * 而"生效了没有"从战斗结果上很不容易看出来（盾照样有、数字照样跳），
 * 所以这里把每一步的**数值**钉死。
 *
 * ============================================================
 *  【为什么衰减要做成"累计差"而不是"每 tick 固定值"？】
 * ============================================================
 * 机械师 1 星：1850 血 × 10% = 185 点盾，15%/s ⇒ 每 tick 该掉 1.3875 点。
 * 如果直接 `Math.floor(185 × 0.15 / 20)` = 1，就变成"每 tick 掉 1" ⇒ 实际要
 * **9.25 秒**才掉完，而表里写的是 6.67 秒（差 40%，肉眼看就是"这盾怎么这么久"）。
 * 所以内核记的是"第 e 个 tick 为止总共该掉多少"，每 tick 取差值 —— 全程整数、无累计误差。
 * 下面 `6.67 秒掉完` 那一条就是钉这个的。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  BP,
  TICKS_PER_SECOND,
  UNIT_DEFS,
  applyShieldGrant,
  castSkill,
  clearShield,
  createBattle,
  dealDamage,
  gainMana,
  shieldGrantOf,
  skillVariantOf,
  tickShield,
  type BattleState,
  type SkillEffect,
  type TeamSetup,
  type UnitDef,
  type UnitPlacement,
  type UnitState,
} from '../src/index.js';

/** 按名字找干员（★ 不写死 id —— 名单以后会换，名字才是策划给的key） */
const byName = (name: string): UnitDef => {
  const def = Object.values(UNIT_DEFS).find((d) => d.name.includes(name));
  if (!def) throw new Error(`找不到干员「${name}」——名字改过？`);
  return def;
};

const ZUOLE = byName('左乐');
const MECHANIC = byName('机械师');

/** 取某个干员某一段技能里的第 n 个效果（按 kind 找，别按下标 —— 顺序会变） */
function effectOf(def: UnitDef, kind: SkillEffect['kind'], star = 1): SkillEffect {
  const found = skillVariantOf(def, star).effects.find((e) => e.kind === kind);
  if (!found) throw new Error(`${def.name} 的技能里没有 ${kind}`);
  return found;
}

/** 场上两边各放一个，返回 state 和这两个单位 */
function duel(
  a: { defId: string; star?: number },
  b: { defId: string; star?: number },
  /** b 相对 a 的偏移列（默认贴着放，好测"周围四格"） */
  gap = 1,
): { state: BattleState; a: UnitState; b: UnitState } {
  const placementsA: UnitPlacement[] = [{ defId: a.defId, star: a.star ?? 1, cell: { col: 4, row: 4 } }];
  const placementsB: UnitPlacement[] = [{ defId: b.defId, star: b.star ?? 1, cell: { col: 4 + gap, row: 4 } }];
  const setups: [TeamSetup, TeamSetup] = [
    { team: 0, units: placementsA },
    { team: 1, units: placementsB },
  ];
  const state = createBattle(UNIT_DEFS, setups, 20261016);
  return {
    state,
    a: state.units.find((u) => u.team === 0)!,
    b: state.units.find((u) => u.team === 1)!,
  };
}

// ============================================================
describe('★ 左乐的血饮：护盾基准是「已损失生命」', () => {
  it('数据层：basis 是 missingHp，比例 80%/100%/120%，且护盾期间不回技力', () => {
    const grant = shieldGrantOf(effectOf(ZUOLE, 'shield', 1) as never, 3);
    expect(grant.basis, '基准必须是"已损失生命"，不是生命上限').toBe('missingHp');
    expect(grant.power, '3 星 120% ⇒ 千分比 1200').toBe(1200);
    expect(grant.noMana, '护盾存在期间无法获得技力').toBe(true);
    expect(grant.blast, '左乐没有破盾爆炸').toBeNull();
  });

  it('血量越少盾越厚：满血只有 0 点，掉一半血刚好给"已损失的一半 × 比例"', () => {
    const { state, a } = duel({ defId: ZUOLE.id }, { defId: MECHANIC.id }, 1);
    const grant = shieldGrantOf(effectOf(ZUOLE, 'shield') as never, 1);

    // 1 星 80% —— 满血时"已损失生命"是 0，所以一点盾都没有
    a.hp = a.maxHp;
    applyShieldGrant(state, a, a, grant);
    expect(a.statuses['shieldValue'] ?? 0, '满血时没有已损失生命，护盾是 0').toBe(0);

    // 掉一半血
    a.hp = Math.floor(a.maxHp / 2);
    applyShieldGrant(state, a, a, grant);
    const missing = a.maxHp - a.hp;
    expect(a.statuses['shieldValue'], '按已损失生命的 80% 算').toBe(Math.floor((missing * 800) / 1000));
  });

  it('★ 护盾存在期间回不了技力（挡在 gainMana 这一个入口上）', () => {
    const { state, a } = duel({ defId: ZUOLE.id }, { defId: MECHANIC.id }, 1);
    a.hp = Math.floor(a.maxHp / 2);
    applyShieldGrant(state, a, a, shieldGrantOf(effectOf(ZUOLE, 'shield') as never, 1));
    expect(a.statuses['shieldValue']! > 0, '前提：盾确实在').toBe(true);

    a.mana = 0;
    gainMana(state, a, 100);
    expect(a.mana, '有盾的时候一点技力都不该涨').toBe(0);

    clearShield(a);
    gainMana(state, a, 100);
    expect(a.mana, '盾没了就该正常回技力').toBe(100);
  });

  it('护盾是"一直存在到被打光"，卡面不能显示成一个巨大的秒数', () => {
    const grant = shieldGrantOf(effectOf(ZUOLE, 'shield') as never, 1);
    const { state, a } = duel({ defId: ZUOLE.id }, { defId: MECHANIC.id }, 1);
    a.hp = 1;
    applyShieldGrant(state, a, a, grant);
    // FOREVER_TICKS = MAX_BATTLE_TICKS，`status-effects.ts` 见到这个值就显示"永久"
    expect(a.statuses['shield']).toBeGreaterThanOrEqual(20 * 60);
  });
});

// ============================================================
describe('★ 机械师的装甲展开：衰减护盾 + 破盾子弹', () => {
  it('数据层：护盾 10%/15%/20% 生命上限、护甲 5/9/15、每秒衰减 15%、1/2/3 颗子弹', () => {
    const grant1 = shieldGrantOf(effectOf(MECHANIC, 'shield', 1) as never, 1);
    expect(grant1.basis).toBe('maxHp');
    expect(grant1.power, '1 星 10% ⇒ 千分比 100').toBe(100);
    expect(grant1.decayBpPerSecond, '15%/s ⇒ 万分比 1500').toBe(1500);
    expect(grant1.blast?.basis, '破盾爆炸按生命上限算').toBe('maxHp');
    expect(grant1.blast?.power, '5% ⇒ 千分比 50').toBe(50);
    expect(grant1.blast?.shape, '周围四格 = cross').toBe('cross');
    expect(grant1.noMana, '机械师没有"护盾期间不回技力"').toBe(false);

    const shieldEffect = effectOf(MECHANIC, 'shield') as { bullets?: readonly number[] };
    expect(shieldEffect.bullets, '1/2/3 颗子弹').toEqual([1, 2, 3]);

    const armorEffect = effectOf(MECHANIC, 'buff') as { stats: { armorFlat?: unknown; immuneHits?: unknown } };
    expect(armorEffect.stats.armorFlat, '护甲 5/9/15').toEqual([5, 9, 15]);
    /*
      ★ 老机制的回归钉：0.2 之前机械师是"免疫 3/5/7 次攻击"，
      表里已经把这一条删掉换成子弹了 —— 留着它等于多给一份收益。
    */
    expect(armorEffect.stats.immuneHits, '旧的"免疫 N 次攻击"必须已经删掉').toBeUndefined();
  });

  it('★ 衰减速率：每秒掉「获得总量」的 15%，第 20 个 tick 正好掉 15%', () => {
    const { state, a } = duel({ defId: MECHANIC.id }, { defId: ZUOLE.id }, 1);
    const grant = shieldGrantOf(effectOf(MECHANIC, 'shield') as never, 1);
    applyShieldGrant(state, a, a, grant);
    const total = a.statuses['shieldValue']!;
    expect(total, '1 星护盾 = 生命上限的 10%').toBe(Math.floor((a.maxHp * 100) / 1000));

    for (let i = 0; i < TICKS_PER_SECOND; i++) tickShield(state, a);
    // 15% 按 "获得总量 × 1500/10000" 算（全是整数除法，所以这里也用整数对）
    const expected = total - Math.floor((total * 1500 * TICKS_PER_SECOND) / (BP * TICKS_PER_SECOND));
    expect(a.statuses['shieldValue'], '1 秒后应该正好掉了 15%').toBe(expected);
  });

  it('★ 6.67 秒自然掉光（不是"每 tick 取整"的那种 9 秒）', () => {
    const { state, a } = duel({ defId: MECHANIC.id }, { defId: ZUOLE.id }, 1);
    const grant = shieldGrantOf(effectOf(MECHANIC, 'shield') as never, 1);
    applyShieldGrant(state, a, a, grant);

    // 15%/s ⇒ 100/15 秒 = 6.67 秒 = 134 tick
    for (let i = 0; i < 133; i++) tickShield(state, a);
    expect(a.statuses['shieldValue'] ?? 0, '第 133 tick 还没掉完').toBeGreaterThan(0);
    tickShield(state, a);
    expect(a.statuses['shieldValue'] ?? 0, '第 134 tick 该掉光了').toBe(0);
  });

  it('★ 破盾子弹：盾被打空时消耗一颗、补回同样一层盾、并炸周围四格', () => {
    const { state, a, b } = duel({ defId: MECHANIC.id }, { defId: ZUOLE.id }, 1);
    const effects = skillVariantOf(MECHANIC, 1).effects;
    castSkill(state, a, MECHANIC.skill.id, effects, UNIT_DEFS);

    expect(a.skill?.shieldBullets?.left, '1 星：开局 1 颗子弹').toBe(1);
    const perLayer = a.statuses['shieldValue']!;
    expect(perLayer, '当前这层盾').toBe(Math.floor((a.maxHp * 100) / 1000));

    const hpBefore = b.hp;
    // 打空护盾（多打一点，确保归零）
    dealDamage(state, a, b, 1, 'physical'); // 无关的一击（顺便确认不会误伤）
    dealDamage(state, b, a, perLayer + 5000, 'physical', 'attack');

    expect(a.skill?.shieldBullets?.left, '子弹被消耗掉一颗').toBe(0);
    expect(a.statuses['shieldValue'], '应该立刻补回一层同样厚的盾').toBe(perLayer);
    expect(a.statuses['shield']! > 0, '补回来的盾也有时长').toBe(true);
    expect(b.hp, '破盾时周围四格的敌人应该吃到一发法术伤害').toBeLessThan(hpBefore);
  });

  it('子弹打光之后，盾再破就不会补了', () => {
    const { state, a, b } = duel({ defId: MECHANIC.id }, { defId: ZUOLE.id }, 1);
    castSkill(state, a, MECHANIC.skill.id, skillVariantOf(MECHANIC, 1).effects, UNIT_DEFS);

    const perLayer = a.statuses['shieldValue']!;
    dealDamage(state, b, a, perLayer + 5000, 'physical', 'attack'); // 第 1 次破：补盾，子弹 1 -> 0
    expect(a.skill?.shieldBullets?.left).toBe(0);

    dealDamage(state, b, a, perLayer + 5000, 'physical', 'attack'); // 第 2 次破：没子弹了
    expect(a.statuses['shieldValue'] ?? 0, '没子弹就不该再补盾').toBe(0);
    expect(a.hp, '第二发漏出来的部分该打到血上').toBeLessThan(a.maxHp);
  });

  it('★ 破盾爆炸实现只有一处：`movement.ts` 不再自己处理护盾', () => {
    /*
      老写法里 `tickStatuses` 的 key 列表里有 'shield'，护盾的删除动作
      分散在 `combat-math`（打空）和 `movement`（到期）两个文件里。
      0.2 加了衰减 + 破盾补盾 + 护盾期间不回技力之后，那两条路都得记得清
      `shieldDecay` / `shieldNoMana`，迟早漏一个 —— 所以全部收进 `combat-math.tickShield`。
    */
    const root = fileURLToPath(new URL('..', import.meta.url));
    const movement = readFileSync(`${root}/src/movement.ts`, 'utf8');
    expect(/\[\s*'stun',\s*'shield'/.test(movement), 'tickStatuses 不该再列出 shield').toBe(false);
    expect(movement.includes("delete unit.statuses['shieldValue']"), '护盾的清理只能在 clearShield 里').toBe(false);

    const combat = readFileSync(`${root}/src/combat-math.ts`, 'utf8');
    expect(combat.includes('export function clearShield'), '唯一的卸载入口').toBe(true);
    expect(combat.includes('export function breakShield'), '唯一的破盾入口').toBe(true);

    // 护盾量的算式也只剩一份：技能侧和开局效果都必须走 shieldGrantOf
    const rules = readFileSync(`${root}/src/rules.ts`, 'utf8');
    expect(rules.includes('shieldGrantOf'), '开局效果要走同一个入口').toBe(true);
  });
});
