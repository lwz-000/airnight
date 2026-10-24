/**
 * ============================================================
 *  ★ 0.1.2 测试模式：「数值修改」逐张卡覆盖基础属性
 * ============================================================
 *
 * 【用户原话】
 *   "在测试模式中的修改器中添加数值修改按键，打开后布阵阶段点击干员不再弹出详情页，
 *    而是弹出干员基础属性面板，并可以修改，修改完点击保存可以修改这个干员
 *    （单个干员卡片，不是单种干员）在本次测试模式中的数值。"
 *
 * 【内核这一层要钉住的三件事】
 *   1. 覆盖**真的生效**（改血量就是改血量，不是只改了界面）；
 *   2. 覆盖盖的是**白板**那一层，羁绊加成**照旧叠在上面**（不是把羁绊吃掉）；
 *   3. 没有覆盖时行为完全不变（正常对局一个字节都不该受影响）。
 *
 * 【为什么用"只有血量的假棋子"？】
 * 真实干员的技能/被动里还有 `hpFlat` 之类的加法，拿真名单做加减法会把这些混进来，
 * 测出来的差值就不是"我填的那个数"了。精确性交给假棋子，覆盖面交给真名单。
 */
import { describe, expect, it } from 'vitest';
import {
  ARENA_W,
  FIX,
  UNIT_DEFS,
  createRng,
  createUnit,
  simulate,
  unitBaseStats,
  type TeamSetup,
  type TraitBonus,
  type UnitDef,
  type UnitStatOverride,
} from '../src/index.js';

/** 一个"除了数值什么都没有"的棋子：没有技能、没有被动 */
function plainDef(cost: number, hp: number, attackDamage = 100): UnitDef {
  return {
    id: `plain${cost}`,
    name: `plain${cost}`,
    cost,
    traits: [],
    base: {
      hp,
      attackDamage,
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

const CELL = { col: 0, row: 0 };
const noTraits: TraitBonus[] = [];

describe('★ 测试模式：逐张卡的基础数值覆盖', () => {
  it('★ 白板值 = 基础 × 星级（含 3 星质变加血），且改成面板单位才能对上', () => {
    const def = plainDef(3, 1000);
    // 1 星：1000 血
    expect(unitBaseStats(def, 1).hp / FIX).toBe(1000);
    // 2 星：×1.8
    expect(unitBaseStats(def, 2).hp / FIX).toBe(1800);
    // 3 星：×1.8² = 3.24（3 费没有 `STAR3_HP_BONUS_BP` 的额外乘算）
    expect(unitBaseStats(def, 3).hp / FIX).toBe(3240);

    /*
      ★ 这一条是"抽 unitBaseStats"的**真正理由**：
      界面以前自己写的是 `def.base.hp * starMul`，它**没有 3 星质变那两层**，
      于是 3 星棋子的"白板"永远偏低，详情页的 ▲▼ 全错。
      5 费 3 星 = 1000 × 3.24 × 2（质变乘算）+ 5000（质变加算）= 11480。
    */
    const costly = plainDef(5, 1000);
    expect(unitBaseStats(costly, 3).hp / FIX).toBe(1000 * 3.24 * 2 + 5000);
  });

  it('★ 覆盖写什么就是什么（面板单位 -> 内核定点数只换算一次）', () => {
    const def = plainDef(3, 1000);
    const base = unitBaseStats(def, 3, {
      hp: 4500,
      attackDamage: 777,
      attackSpeed: 2,
      armor: 30,
      magicResist: 12,
      range: 4,
    });
    expect(base.hp / FIX, '血量要按面板值原样生效').toBe(4500);
    expect(base.maxHp).toBe(base.hp);
    expect(base.attackDamage / FIX).toBe(777);
    expect(base.attackSpeed, '攻速 2 = 内核 2000（每秒 2 下）').toBe(2000);
    expect(base.armor / FIX).toBe(30);
    expect(base.magicResist / FIX).toBe(12);
    expect(base.range).toBe(4);
  });

  it('★ 没填的项保持白板 —— 覆盖不是"整份替换"', () => {
    const def = plainDef(3, 1000, 250);
    const white = unitBaseStats(def, 2);
    const patched = unitBaseStats(def, 2, { hp: 9999 });
    expect(patched.hp / FIX).toBe(9999);
    expect(patched.attackDamage, '只改了血，攻击力必须还是白板').toBe(white.attackDamage);
    expect(patched.attackSpeed).toBe(white.attackSpeed);
    expect(patched.range).toBe(white.range);
  });

  it('★ 覆盖盖的是白板那一层：羁绊加成照旧叠上去（而不是被覆盖吃掉）', () => {
    const def = plainDef(3, 1000);
    const hpBonus: TraitBonus[] = [{ traitId: 'test', effect: 'hpBp', value: 5000 }]; // +50%
    const withBonus = unitBaseStats(def, 1, { hp: 2000 });
    // 先把白板覆盖成 2000，再走一遍羁绊加成的算法
    const unit = createUnit(def, 0, 1, CELL, 0, createRng(1), hpBonus, { hp: 2000 });
    expect(withBonus.hp / FIX).toBe(2000);
    expect(
      unit.maxHp / FIX,
      '★ 覆盖之后吃 50% 血羁绊应该是 2000 × 1.5 = 3000 —— 覆盖不能把羁绊吃掉',
    ).toBe(3000);
  });

  it('★ 覆盖能真正改变战斗结果（不是只改了界面）', () => {
    /*
      ★ 判据的设计：把**同一份巨额覆盖**分别挂到两边，
      谁挂上谁就必须赢 —— 这样就不依赖"原始那场谁赢"（镜像局到底谁先出手
      受 tick 取整影响，本来就不该拿来当基准）。
    */
    const def = plainDef(1, 1000, 50);
    const defs = { [def.id]: def };
    const left = { defId: def.id, star: 1, cell: { col: 0, row: 0 } };
    const right = { defId: def.id, star: 1, cell: { col: ARENA_W, row: 0 } };
    const buff: UnitStatOverride = { hp: 20000, attackDamage: 400 };

    const buffedLeft: [TeamSetup, TeamSetup] = [
      { team: 0, units: [{ ...left, statOverride: buff }] },
      { team: 1, units: [right] },
    ];
    const buffedRight: [TeamSetup, TeamSetup] = [
      { team: 0, units: [left] },
      { team: 1, units: [{ ...right, statOverride: buff }] },
    ];

    expect(simulate(defs, buffedLeft, 4242).winner, '覆盖挂左边，左边就该赢').toBe(0);
    expect(simulate(defs, buffedRight, 4242).winner, '覆盖挂右边，右边就该赢').toBe(1);
  });

  it('★ 覆盖值会做安全钳制（手输的 0 / NaN 不能把战斗搞崩）', () => {
    const def = plainDef(1, 1000);
    const nasty = unitBaseStats(def, 1, {
      hp: 0,
      attackSpeed: 0,
      range: 0,
      attackDamage: Number.NaN,
      armor: Number.POSITIVE_INFINITY,
    });
    expect(nasty.hp, '血量至少 1（0 血会变成一具打不死的尸体）').toBeGreaterThanOrEqual(FIX);
    expect(nasty.attackSpeed, '攻速至少 100（0 会让攻击间隔变成无穷大）').toBeGreaterThanOrEqual(100);
    expect(nasty.range, '射程至少 1 格').toBeGreaterThanOrEqual(1);
    expect(nasty.attackDamage, 'NaN 直接忽略，保持白板').toBe(unitBaseStats(def, 1).attackDamage);
    expect(nasty.armor, 'Infinity 直接忽略，保持白板').toBe(0);
  });

  it('★ 真干员：覆盖之后战斗中用的就是覆盖值（回归：别只在假棋子上生效）', () => {
    const defId = Object.keys(UNIT_DEFS)
      .filter((id) => UNIT_DEFS[id]!.cost === 1 && !UNIT_DEFS[id]!.summonOnly && !UNIT_DEFS[id]!.monsterOnly)
      .sort()[0]!;
    const override = { hp: 12345 };
    const unit = createUnit(UNIT_DEFS[defId]!, 0, 1, CELL, 0, createRng(7), noTraits, override);
    expect(unit.maxHp / FIX, '真干员也要按面板值生效（别被它自己的被动 hpFlat 盖掉）').toBe(12345);

    // 走一遍完整战斗：对面空阵，我方必须赢 —— 说明这份阵容内核接受且能跑完
    const result = simulate(
      UNIT_DEFS,
      [
        { team: 0, units: [{ defId, star: 1, cell: { col: 0, row: 0 }, statOverride: override }] },
        { team: 1, units: [] },
      ],
      99,
    );
    expect(result.winner, '带上覆盖的阵容要能正常打完，并且赢得下来').toBe(0);
  });
});
