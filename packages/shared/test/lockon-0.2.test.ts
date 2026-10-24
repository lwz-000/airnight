/**
 * ★ 0.2 蕾缪安：攻速恒定 / 攻速折算攻击力 / 3 星「强制追思」的锁定—引爆。
 *
 * ============================================================
 *  【为什么这三条要一起钉？】
 * ============================================================
 * 表里对蕾缪安写了两条"人不看就会漏"的规矩：
 *   1. **攻速恒定 0.55，每额外获得 1% 的攻速转化为 0.1% 的攻击力**
 *      —— 锁死攻速、把加成改道成攻击力。少写一半就会出现
 *      "加成既让攻速变快、又让攻击力变高"，等于双吃。
 *   2. **3 星：获得 7 颗弹药 + 停止攻击 7 秒 + 每秒锁一个地块 + 7 秒后一起引爆**
 *      —— 落点是 7 秒前记下来的，人走开了照打不误；
 *      "每个目标只锁一次，不够就都锁百分比生命最高的"也在这条里。
 *
 * 这两条都改了 `mods.ts`（攻速/攻击力的合成）和 `skills.ts`（新增 lockOn），
 * 属于"改错了战斗还能跑、只是强度悄悄变成另一个样子"的那类改动，
 * 所以每一条都拿具体数字钉死。
 */
import { describe, expect, it } from 'vitest';
import {
  BP,
  TICKS_PER_SECOND,
  UNIT_DEFS,
  castSkill,
  collectMods,
  createBattle,
  effectiveAttackDamage,
  effectiveAttackSpeed,
  skillVariantOf,
  step,
  type BattleState,
  type SkillEffect,
  type TeamSetup,
  type UnitDef,
  type UnitPlacement,
  type UnitState,
} from '../src/index.js';

const byName = (name: string): UnitDef => {
  const def = Object.values(UNIT_DEFS).find((d) => d.name.includes(name));
  if (!def) throw new Error(`找不到干员「${name}」——名字改过？`);
  return def;
};

const LEMUEN = byName('蕾缪安');
/** 不会移动也不会攻击的活靶子（它自己写死了 noMove + noAttack） */
const TARGET = byName('玛恩纳');

const s = (seconds: number): number => Math.round(seconds * TICKS_PER_SECOND);

function battle(placementsA: UnitPlacement[], placementsB: UnitPlacement[], seed = 20261016): BattleState {
  const setups: [TeamSetup, TeamSetup] = [
    { team: 0, units: placementsA },
    { team: 1, units: placementsB },
  ];
  return createBattle(UNIT_DEFS, setups, seed);
}

const effectOf = (def: UnitDef, kind: SkillEffect['kind'], star: number): SkillEffect => {
  const found = skillVariantOf(def, star).effects.find((e) => e.kind === kind);
  if (!found) throw new Error(`${def.name} 在 ${star} 星没有 ${kind}`);
  return found;
};

// ============================================================
describe('★ 蕾缪安的「攻速恒定 + 攻速折算攻击力」', () => {
  it('数据层：被动里写了攻速恒定与 1%→0.1% 的折算比例', () => {
    const passive = LEMUEN.skill.passive as { attackSpeedLocked?: boolean; attackSpeedToAttackRatioBp?: number } | undefined;
    expect(passive?.attackSpeedLocked, '攻速恒定').toBe(true);
    expect(passive?.attackSpeedToAttackRatioBp, '每 100% 攻速 → 10% 攻击力').toBe(1000);
    const bonus = LEMUEN.skill.passive?.bonusDamage;
    expect(bonus?.ratioBp, '被动三档 40%/60%/80%').toEqual([4000, 6000, 8000]);
  });

  it('★ 攻速加成不再让攻速变快，而是折成攻击力', () => {
    const state = battle(
      [{ defId: LEMUEN.id, star: 1, cell: { col: 4, row: 4 } }],
      [{ defId: TARGET.id, star: 1, cell: { col: 5, row: 4 } }],
    );
    const lemuen = state.units.find((u) => u.defId === LEMUEN.id)!;

    const beforeSpeed = effectiveAttackSpeed(lemuen, collectMods(state, lemuen));
    const beforeAttack = effectiveAttackDamage(lemuen, collectMods(state, lemuen));
    expect(beforeSpeed, '恒定 = 面板原值 550').toBe(lemuen.attackSpeed);

    // 挂一份 +100% 攻速的包（模拟羁绊/藏品/队友技能给的加成）
    lemuen.skill!.buffs.push({ stats: { attackSpeedBp: 10000 }, ticksLeft: 999, sourceId: lemuen.id });

    const afterSpeed = effectiveAttackSpeed(lemuen, collectMods(state, lemuen));
    const afterAttack = effectiveAttackDamage(lemuen, collectMods(state, lemuen));
    expect(afterSpeed, '攻速一点都不能变').toBe(beforeSpeed);
    // +100% 攻速 × 0.1 = +10% 攻击力
    expect(afterAttack, '+100% 攻速该折成 +10% 攻击力').toBe(beforeAttack + Math.floor((lemuen.attackDamage * 1000) / BP));
  });

  it('攻速被减（负数加成）时不折算攻击力，也不倒扣', () => {
    const state = battle(
      [{ defId: LEMUEN.id, star: 1, cell: { col: 4, row: 4 } }],
      [{ defId: TARGET.id, star: 1, cell: { col: 5, row: 4 } }],
    );
    const lemuen = state.units.find((u) => u.defId === LEMUEN.id)!;
    const before = effectiveAttackDamage(lemuen, collectMods(state, lemuen));
    lemuen.skill!.buffs.push({ stats: { attackSpeedBp: -3000 }, ticksLeft: 999, sourceId: lemuen.id });
    expect(effectiveAttackSpeed(lemuen, collectMods(state, lemuen)), '攻速照样恒定').toBe(lemuen.attackSpeed);
    expect(effectiveAttackDamage(lemuen, collectMods(state, lemuen)), '负加成不该倒扣攻击力').toBe(before);
  });
});

// ============================================================
describe('★ 蕾缪安 3 星「强制追思」的锁定—引爆', () => {
  /** 造一场：蕾缪安（3 星）对两个不还手的靶子 */
  function setup(): { state: BattleState; lemuen: UnitState; targets: UnitState[] } {
    const state = battle(
      [{ defId: LEMUEN.id, star: 3, cell: { col: 4, row: 4 } }],
      [
        { defId: TARGET.id, star: 1, cell: { col: 5, row: 3 } },
        { defId: TARGET.id, star: 1, cell: { col: 5, row: 5 } },
      ],
    );
    const lemuen = state.units.find((u) => u.defId === LEMUEN.id)!;
    const targets = state.units.filter((u) => u.team === 1);
    return { state, lemuen, targets };
  }

  it('数据层：7 颗弹药 / 4 秒锁完 / 4 秒后引爆 / 每颗 600% 物理 / 3×3', () => {
    const e = effectOf(LEMUEN, 'lockOn', 3) as Extract<SkillEffect, { kind: 'lockOn' }>;
    expect(e.count).toBe(7);
    // ★ 0.3.2：读条 7 秒 → 4 秒。仍然锁 7 个 ⇒ 间隔压到 s(4)/7 = 11 tick（0.55 秒一个）
    expect(e.intervalTicks, '4 秒锁 7 个 ⇒ 每 11 tick 一个').toBe(Math.floor(s(4) / 7));
    expect(e.blastTicks, '4 秒后引爆').toBe(s(4));
    expect(e.power, '每颗 600% 攻击力').toBe(6000);
    expect(e.damageType).toBe('physical');
    expect(e.radius, '3×3 ⇒ 半径 1 方形').toBe(1);
    expect(e.shape).toBe('square');
    // 同一个技能里必须还带着"停攻"和"射程 +10"
    const stats = skillVariantOf(LEMUEN, 3)
      .effects.filter((item) => item.kind === 'buff')
      .map((item) => (item as unknown as { stats: Record<string, unknown> }).stats);
    expect(stats.some((st) => st.noAttack === true), '停止攻击 4 秒').toBe(true);
    expect(stats.some((st) => st.rangeFlat === 10), '攻击距离 +10').toBe(true);
    expect(skillVariantOf(LEMUEN, 3).name).toBe('蕾缪安·强制追思');
  });

  it('★ 放技能后：4 秒里一个地块一个地块地锁，4 秒后才一起引爆', () => {
    const { state, lemuen, targets } = setup();
    const variant = skillVariantOf(LEMUEN, 3);
    castSkill(state, lemuen, LEMUEN.skill.id, variant.effects, UNIT_DEFS);

    expect(lemuen.skill?.lockOn?.locksLeft, '登记了 7 颗弹药').toBe(7);
    expect(targets[0]!.hp, '刚放技能时还一点伤害都没有').toBe(targets[0]!.maxHp);

    // 第 1 秒：锁下 1 个地块
    for (let i = 0; i < s(1); i++) step(state, UNIT_DEFS);
    expect(lemuen.skill?.lockOn?.cells.length, '1 秒后锁了 1 个地块').toBe(1);
    expect(lemuen.skill?.lockOn?.locksLeft).toBe(6);
    expect(targets.some((t) => t.hp < t.maxHp), '还没到引爆时刻，不该有人掉血').toBe(false);

    // 再走 3 秒（累计 4 秒）：7 个地块全锁完并引爆
    for (let i = 0; i < s(3); i++) step(state, UNIT_DEFS);
    expect(lemuen.skill?.lockOn, '引爆之后计划就清掉了').toBeUndefined();
    expect(targets.some((t) => t.hp < t.maxHp), '引爆之后靶子该掉血了').toBe(true);
  });

  it('★ 打的是「锁定时的地块」：人跑掉了，已经锁下的落点不会跟着改', () => {
    const { state, lemuen, targets } = setup();
    castSkill(state, lemuen, LEMUEN.skill.id, skillVariantOf(LEMUEN, 3).effects, UNIT_DEFS);
    // 走 1 秒把第一个地块锁下来
    for (let i = 0; i < s(1); i++) step(state, UNIT_DEFS);
    const first = { ...lemuen.skill!.lockOn!.cells[0]! };

    /*
      把两个靶子都挪到 9 列（离落点 4 格以上，3×3 打不到）。
      之后每一秒的"现锁"会跟着他们跑到 9 列去 —— 这正是要证明的：
      落点是**锁定那一刻**记下的，先锁下的那个不会被改写成新位置。
    */
    for (const [index, target] of targets.entries()) {
      target.cell = { col: 9, row: index === 0 ? 0 : 9 };
    }
    // 走满 4 秒但**差一 tick** 到引爆，这样计划还在、能读
    for (let i = 0; i < s(3) - 1; i++) step(state, UNIT_DEFS);

    const plan = lemuen.skill!.lockOn!;
    expect(plan.cells[0], '第 1 个落点停在原地没被改写').toEqual(first);
    expect(plan.cells[0]!.col, '第 1 个落点不是他们后来的位置').not.toBe(9);
    expect(plan.cells[1]!.col, '后面的落点确实是"现锁"到的 9 列').toBe(9);
  });

  it('★ 7 颗弹药**全部**打出去（最后一颗和引爆同一 tick，不能被吞掉）', () => {
    const { state, lemuen, targets } = setup();
    /*
      把攻击力压到 1，让 7 发都打不死人 —— 这一条测的是"打了几发"，
      不是"打多疼"。`damageArea` 只要圈里有敌人就会记一条 zone 事件，
      所以 zone 的条数就是真正引爆的落点数。
    */
    lemuen.attackDamage = 1;
    castSkill(state, lemuen, LEMUEN.skill.id, skillVariantOf(LEMUEN, 3).effects, UNIT_DEFS);
    expect(targets.every((t) => !t.dead)).toBe(true);

    for (let i = 0; i < s(4); i++) step(state, UNIT_DEFS);

    const zones = state.log.filter((event) => event.type === 'zone').length;
    expect(zones, '7 个落点各炸一次（漏掉"锁完即引爆"那一 tick 就会少一发）').toBe(7);
    expect(lemuen.skill?.lockOn, '引爆之后计划清掉').toBeUndefined();
  });

  it('每个目标只锁一次；目标不够时剩余弹药锁百分比生命最高的敌人', () => {
    const { state, lemuen, targets } = setup();
    castSkill(state, lemuen, LEMUEN.skill.id, skillVariantOf(LEMUEN, 3).effects, UNIT_DEFS);
    // 让 targets[0] 明显更残 ⇒ 它是"百分比生命最低"，第一个被锁
    targets[0]!.hp = Math.floor(targets[0]!.maxHp / 4);
    const lowHp = targets[0]!.id;
    const fullHp = targets[1]!.id;
    // 锁完前 6 颗、第 7 颗还没锁（第 7 颗在 6×间隔 = 66 tick，引爆在 80）
    const interval = (effectOf(LEMUEN, 'lockOn', 3) as Extract<SkillEffect, { kind: 'lockOn' }>)
      .intervalTicks;
    for (let i = 0; i < interval * 6; i++) step(state, UNIT_DEFS);

    const plan = lemuen.skill!.lockOn!;
    expect(plan.lockedIds[0], '先锁百分比生命最低的那个').toBe(lowHp);
    expect(plan.lockedIds[1], '再锁另一个（每个目标只锁一次）').toBe(fullHp);
    expect(
      plan.lockedIds.slice(2),
      '没新的可锁了 ⇒ 剩下的全锁百分比生命最高的那个',
    ).toEqual([fullHp, fullHp, fullHp, fullHp]);
  });
});
