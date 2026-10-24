/**
 * ============================================================
 *  护盾规则（你要求改的两条）
 * ============================================================
 *
 *   1. **护盾不再享受物抗/法抗的减伤加持**
 *   2. **护盾挡不住真实伤害**
 *
 * 【为什么值得单独开一个文件测？】
 * 因为护盾的"收益"完全是**顺序问题**决定的，而顺序错了从结果上很难看出来 ——
 * 伤害数字照样跳、战斗照样打完，只是"坦克身上的护盾强得离谱"。
 *
 * 具体说：
 *   旧顺序 = 先减免、再让护盾吃  → 100 点护盾在 90% 减免的坦克身上能挡 1000 点伤害
 *   新顺序 = 护盾先按原始伤害 1:1 吃、剩下的才减免 → 100 点护盾就只挡 100 点
 * 两种写法都"能跑"，只有把数字钉死才分得出来。
 */
import { describe, expect, it } from 'vitest';
import { FIX, UNIT_DEFS, applyShield, createBattle, dealDamage, type BattleState, type UnitState } from '../src/index.js';

/** 造一场两个棋子的战斗，返回双方单位 */
function makeDuel(): { state: BattleState; attacker: UnitState; target: UnitState } {
  const ids = Object.keys(UNIT_DEFS).sort();
  const state = createBattle(
    UNIT_DEFS,
    [
      { team: 0, units: [{ defId: ids[0]!, star: 1, cell: { col: 4, row: 4 } }] },
      { team: 1, units: [{ defId: ids[0]!, star: 1, cell: { col: 5, row: 4 } }] },
    ],
    1234,
  );
  const attacker = state.units.find((unit) => unit.team === 0)!;
  const target = state.units.find((unit) => unit.team === 1)!;
  return { state, attacker, target };
}

/**
 * 人为给目标堆一个很高的护甲，让"减免了多少"一眼可辨。
 *
 * ★ 注意单位：护甲在核心里是**定点数**（30 点护甲存成 30 × FIX）。
 * 第一版我直接写 `target.armor = 200`，那其实是"0.2 点护甲"，
 * 减免几乎为零，于是"漏出来的部分该被减免"这条断言红了 ——
 * 红的是测试自己写错了单位，不是产品错。
 */
function makeTanky(target: UnitState): void {
  target.armor = 200 * FIX;
  target.magicResist = 200 * FIX;
}

describe('★ 护盾不享受抗性减免', () => {
  it('护甲再高，护盾也是按**原始伤害**1:1 掉', () => {
    const { state, attacker, target } = makeDuel();
    makeTanky(target);

    const raw = 1000;
    applyShield(state, attacker, target, raw, 999);
    expect(target.statuses['shieldValue'], '前提：盾刚好给 1000').toBe(raw);

    dealDamage(state, attacker, target, raw, 'physical');

    /*
      ★ 核心断言：这一发正好把盾打空。
      旧顺序下，200 护甲会把 1000 减到很小，护盾只会掉那一点点、剩下大半 ——
      所以"盾归零"这一条就能把新旧行为分开。
    */
    expect(target.statuses['shieldValue'] ?? 0, '1000 点盾应该被 1000 点原始伤害正好打空').toBe(0);
    expect(target.hp, '盾刚好够，血不该掉').toBe(target.maxHp);
  });

  it('护盾吃满之后，**漏出来的那部分**才走护甲减免', () => {
    const { state, attacker, target } = makeDuel();
    makeTanky(target);
    target.hp = target.maxHp;

    applyShield(state, attacker, target, 100, 999);
    dealDamage(state, attacker, target, 1000, 'physical');

    expect(target.statuses['shieldValue'] ?? 0, '盾该被打空').toBe(0);
    const lost = target.maxHp - target.hp;
    expect(lost, '漏出来的 900 应该被护甲减掉一部分，所以掉血少于 900').toBeGreaterThan(0);
    expect(lost, '但也不该完全免伤').toBeLessThan(900);
    // 减伤之后应该明显低于"完全没有护甲"的情况
    expect(lost, `200 护甲下掉血 ${lost} 太多了，说明减免没生效`).toBeLessThan(500);
  });

  it('没护盾时行为和以前一样（护甲照常减免）', () => {
    const { state, attacker, target } = makeDuel();
    makeTanky(target);
    const before = target.hp;
    dealDamage(state, attacker, target, 1000, 'physical');
    const lost = before - target.hp;
    expect(lost, '有护甲就该掉得比原始伤害少').toBeLessThan(1000);
    expect(lost).toBeGreaterThan(0);
  });
});

describe('★ 护盾挡不住真实伤害', () => {
  it('真实伤害直接穿盾打血，盾一点不掉', () => {
    const { state, attacker, target } = makeDuel();
    makeTanky(target);
    target.hp = target.maxHp;

    applyShield(state, attacker, target, 5000, 999);
    const shieldBefore = target.statuses['shieldValue']!;

    dealDamage(state, attacker, target, 300, 'true');

    expect(target.statuses['shieldValue'], '真实伤害不该消耗护盾').toBe(shieldBefore);
    expect(target.maxHp - target.hp, '真实伤害也不吃护甲，应该原样掉 300').toBe(300);
  });

  it('真实伤害即使护盾很厚也照样掉血（不会出现"真伤打不动"）', () => {
    const { state, attacker, target } = makeDuel();
    makeTanky(target);
    target.hp = target.maxHp;
    applyShield(state, attacker, target, 999999, 999);

    dealDamage(state, attacker, target, 1200, 'true');
    expect(target.maxHp - target.hp, '盾再厚也挡不住真伤').toBe(1200);
  });

  it('魔法伤害走魔抗，规则和物理一致', () => {
    const { state, attacker, target } = makeDuel();
    makeTanky(target);
    target.hp = target.maxHp;
    applyShield(state, attacker, target, 1000, 999);

    dealDamage(state, attacker, target, 1000, 'magic');
    expect(target.statuses['shieldValue'] ?? 0, '魔抗也不该让护盾少掉').toBe(0);
    expect(target.hp).toBe(target.maxHp);
  });
});

describe('护盾的基本行为没被改坏', () => {
  it('多个护盾会叠加', () => {
    const { state, attacker, target } = makeDuel();
    applyShield(state, attacker, target, 300, 999);
    applyShield(state, attacker, target, 200, 999);
    expect(target.statuses['shieldValue']).toBe(500);
  });

  it('伤害事件里记的 absorbed 就是被护盾吃掉的那部分（界面靠它显示剩余盾值）', () => {
    const { state, attacker, target } = makeDuel();
    target.armor = 200 * FIX;
    applyShield(state, attacker, target, 400, 999);

    dealDamage(state, attacker, target, 1000, 'physical');
    const event = state.log.filter((item) => item.type === 'damage').at(-1)!;
    expect(event.type === 'damage' && event.absorbed, '这一发应该被护盾吃掉 400').toBe(400);
  });
});
