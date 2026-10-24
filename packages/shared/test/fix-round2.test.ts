/**
 * ============================================================
 *  ★★ 0.2 修 bug 第二批（用户 2026-10-16 夜报的 6 条里的 4 条）
 * ============================================================
 *
 *   ② 嘲讽：**所有**嘲讽一律只影响**周围 2 格**（以前"不写半径 = 全场"）
 *   ③ 飞行索敌：射程 1 的干员**最后**才打飞行（有人可打时不管它）
 *      —— 行为用例在 `trait-mechanics.test.ts` 的「飞行」那一组
 *   ④ 野怪攻击力：**只降小怪（minion）这一档** ×0.42，其余档位原样
 *   ⑤ 布阵阶段双抗"大了几百倍"：`SkillStats` 的 `*Flat` 是**面板点数**，
 *      而 `unit.armor` 是定点数 ⇒ 换算时要再除一次 FIX（`startResist` / `deathStatTransfer`）
 *   ⑥ 「优先攻击 X」的索敌**高于**嘲讽
 *
 * 【为什么单独一个文件？】这四条都是"看着像数值问题、其实是口径问题"，
 * 每一条都值得单独钉住 —— 而且它们各自都有过"另一边偷偷不对"的历史。
 */
import { describe, expect, it } from 'vitest';
import {
  FIX,
  MONSTER_ATTACK_SCALE_BP,
  MONSTER_ATTACK_SCALED_TIERS,
  MONSTER_TIERS,
  TAUNT_RADIUS,
  UNIT_DEFS,
  collectMods,
  createBattle,
  effectiveArmor,
  effectiveMagicResist,
  monsterAttackScaleOf,
  monsterWaveForRound,
  selectTarget,
  unitBaseStats,
  type BattleState,
  type MonsterTier,
  type ScopedMechanic,
  type TeamSetup,
  type UnitPlacement,
  type UnitState,
} from '../src/index.js';

const put = (defId: string, col: number, row: number): UnitPlacement => ({
  defId,
  star: 1,
  cell: { col, row },
});

function board(
  team0: UnitPlacement[],
  team1: UnitPlacement[],
  mech0: Record<string, ScopedMechanic[]> = {},
  mech1: Record<string, ScopedMechanic[]> = {},
): BattleState {
  const teams: [TeamSetup, TeamSetup] = [
    { team: 0, units: team0, playerContext: { gold: 0, hp: 100 }, unitMechanics: mech0 },
    { team: 1, units: team1, playerContext: { gold: 0, hp: 100 }, unitMechanics: mech1 },
  ];
  return createBattle(UNIT_DEFS, teams, 20260716);
}

const of = (state: BattleState, defId: string, team: 0 | 1 = 0): UnitState =>
  state.units.find((unit) => unit.defId === defId && unit.team === team)!;

// ============================================================
//  ② 嘲讽半径
// ============================================================
describe('★★ 0.2 嘲讽：所有嘲讽一律只影响周围 2 格', () => {
  const tauntMech: Record<string, ScopedMechanic[]> = {
    op01: [{ kind: 'taunt' }],
    // 也不许被"数据里写了更大半径"绕过：写 9 也只按 2 算
    op02: [{ kind: 'taunt', radius: 9 }],
  };

  it('2 格内的敌人会被拉走', () => {
    // 嘲讽者 (2,4)；敌人 (4,4)：|Δ列| = 2 ⇒ 正好在半径内
    const state = board([put('op01', 3, 4)], [put('mn_slime', 5, 4)], tauntMech);
    const enemy = of(state, 'mn_slime', 1);
    expect(selectTarget(state, enemy), '2 格内应该被嘲讽吸引').toBe(of(state, 'op01').id);
  });

  it('★ 3 格外的敌人不受影响（这是 0.2 改掉的"全场嘲讽"）', () => {
    const state = board([put('op01', 1, 4), put('mn_slime', 3, 4)], [put('mn_slime', 5, 4)], tauntMech);
    const enemy = of(state, 'mn_slime', 1);
    const taunter = of(state, 'op01');
    const nearer = state.units.find((unit) => unit.team === 0 && unit.id !== taunter.id)!;
    expect(selectTarget(state, enemy), '3 格外不该被拉走，应该打最近的那个').toBe(nearer.id);
  });

  it('★ 数据里写 9 格也只按 2 格算（上限在代码里夹死）', () => {
    const state = board([put('op02', 1, 4), put('mn_slime', 3, 4)], [put('mn_slime', 5, 4)], tauntMech);
    const enemy = of(state, 'mn_slime', 1);
    const taunter = of(state, 'op02');
    expect(TAUNT_RADIUS, '常量就是 2').toBe(2);
    expect(selectTarget(state, enemy), '超出的部分被夹掉了').not.toBe(taunter.id);
  });

  it('斜角（切比雪夫距离 2）也算"周围 2 格"', () => {
    const state = board([put('op01', 3, 3)], [put('mn_slime', 5, 5)], tauntMech);
    const enemy = of(state, 'mn_slime', 1);
    expect(selectTarget(state, enemy), '方形范围（含斜角）').toBe(of(state, 'op01').id);
  });
});

// ============================================================
//  ⑥ 优先索敌 > 嘲讽
// ============================================================
describe('★★ 0.2「优先攻击 X」的索敌效果高于嘲讽（用户口径 6）', () => {
  const tauntMech: Record<string, ScopedMechanic[]> = { op01: [{ kind: 'taunt' }] };

  it('开了"优先攻击血量最低"的棋子：跳过嘲讽，去打残血那个', () => {
    // 我方：嘲讽者 (4,4) 满血；残血的那个在 (4,5)
    const state = board(
      [put('op01', 3, 4), put('mn_slime', 3, 5)],
      [put('op21', 5, 4)],
      tauntMech,
    );
    const enemy = of(state, 'op21', 1);
    const taunter = of(state, 'op01');
    const lowHp = of(state, 'mn_slime');
    lowHp.hp = 1;

    expect(selectTarget(state, enemy), '不开优先：被嘲讽拉走').toBe(taunter.id);
    expect(
      selectTarget(state, enemy, { preferLowestHp: true }),
      '★ 开了优先：无视嘲讽，去打血量最低的',
    ).toBe(lowHp.id);
  });

  it('没有残血目标时，"优先攻击残血"仍然让位给嘲讽', () => {
    const state = board([put('op01', 3, 4)], [put('op21', 5, 4)], tauntMech);
    const enemy = of(state, 'op21', 1);
    expect(selectTarget(state, enemy, { preferLowestHp: true })).toBe(of(state, 'op01').id);
  });
});

// ============================================================
//  ④ 野怪攻击力：**只降「小怪」这一档**
// ============================================================
describe('★★ 0.2 野怪攻击力只降小怪档（用户口径 4 的最终版）', () => {
  /*
    【口径演变，别再把三者混起来】
      · 第一版：所有野怪 −30%（7000）
      · 第二版：所有野怪再 −40%（4200）
      · 第三版（现行）：**只有 minion 档**吃 ×0.42，其余五档一律回到 100%
    小怪 = 源石虫 / 猎狗 / 士兵 / 隐形弩手 —— 就是"一费一碰就死"那一排。
  */
  it('常量 4200，且「吃这个倍率的档位」只有 minion', () => {
    expect(MONSTER_ATTACK_SCALE_BP).toBe(4200);
    expect([...MONSTER_ATTACK_SCALED_TIERS]).toEqual(['minion']);
  });

  it('★ 档位表：minion 才打折，其余（含 special）都是原样', () => {
    for (const tier of MONSTER_TIERS) {
      expect(monsterAttackScaleOf(tier), tier).toBe(tier === 'minion' ? 4200 : 10000);
    }
    // 没有档位标记的（理论上不会出现）也不打折
    expect(monsterAttackScaleOf(undefined)).toBe(10000);
  });

  it('★★ 每一档挑一只真的开一局：攻击力 = 基础值 × 该档倍率', () => {
    const tiers: MonsterTier[] = ['minion', 'normal', 'elite', 'leader', 'boss', 'special'];
    let checked = 0;
    for (const tier of tiers) {
      const def = Object.values(UNIT_DEFS).find(
        (entry) => entry.monsterOnly && entry.monsterTier === tier,
      );
      if (!def) continue; // 万一某档空了，别把测试变成"什么都不查"
      checked++;
      const state = board([put('op01', 4, 4)], [put(def.id, 8, 4)]);
      const monster = state.units.find((unit) => unit.team === 1)!;
      const raw = unitBaseStats(def, 1).attackDamage;
      const expected = Math.floor((raw * monsterAttackScaleOf(tier)) / 10000);
      expect(monster.attackDamage, `${tier} / ${def.name}`).toBe(expected);
    }
    expect(checked, '六个档位都要真的验到').toBe(tiers.length);
  });

  it('★ 干员的攻击力一个数都不动（只减野怪小怪）', () => {
    const state = board([put('op01', 4, 4)], [put('op01', 8, 4)]);
    const mine = of(state, 'op01');
    expect(mine.attackDamage).toBe(unitBaseStats(UNIT_DEFS['op01']!, 1).attackDamage);
  });

  it('★ 二阶段野怪切阶段之后，攻击力不会"悄悄涨回来"', () => {
    // 找一只带 reborn 的多阶段野怪（杰斯顿 / 博卓卡斯替 / 奎隆这一档）
    const twoPhase = Object.values(UNIT_DEFS).find(
      (def) => def.monsterOnly && def.reborn && (def.reborn.phase1 || def.reborn.phase2),
    );
    expect(twoPhase, '前提：库里有多阶段野怪').toBeTruthy();
    const state = board([put('op01', 4, 4)], [put(twoPhase!.id, 8, 4)]);
    const monster = state.units.find((unit) => unit.team === 1)!;
    const before = monster.attackDamage;
    const raw = unitBaseStats(twoPhase!, 1).attackDamage;
    /*
      多阶段野怪都不是小怪（杰斯顿是 leader、博卓卡斯替/奎隆是 boss）
      ⇒ 现在按原样出场。这条同时钉住"倍率只在小怪身上生效"和
      "切阶段是从 phaseBase 重算，不会二次打折/涨回"。
    */
    const expected = Math.floor((raw * monsterAttackScaleOf(twoPhase!.monsterTier)) / 10000);
    expect(before).toBe(expected);
    expect(monster.attackDamage, '切阶段只按 phaseBase 重算，那份就是开战时那份').toBe(before);
  });
});

// ============================================================
//  ⑤ 双抗"大了几百倍"
// ============================================================
describe('★★ 0.2 开局双抗：百分比换算不能又被乘一次 FIX（用户口径 5）', () => {
  const RESIST: ScopedMechanic[] = [
    { kind: 'startResist', armorBp: 1000, magicResistBp: 1000, durationTicks: 200 },
  ];

  it('支援「+10% 护甲/魔抗」= 30 点护甲变 33 点（不是 30030）', () => {
    const state = board([put('op01', 4, 4)], [put('op01', 8, 4)], { op01: RESIST });
    const mine = of(state, 'op01');
    const mods = collectMods(state, mine);
    const panelArmor = Math.round(effectiveArmor(mine, mods) / FIX);
    const panelMr = Math.round(effectiveMagicResist(mine, mods) / FIX);
    const baseArmor = Math.round(mine.armor / FIX);
    const baseMr = Math.round(mine.magicResist / FIX);

    // +10%（四舍五入差 1 是允许的），关键是**量级**必须对
    expect(panelArmor).toBe(Math.round((baseArmor * 11000) / 10000));
    expect(panelMr).toBe(Math.round((baseMr * 11000) / 10000));
    expect(panelArmor, '★ 不该出现"几百倍"').toBeLessThan(baseArmor * 3 + 10);
  });

  it('不带这条机制的人双抗一点不变', () => {
    const state = board([put('op01', 4, 4)], [put('op01', 8, 4)]);
    const mine = of(state, 'op01');
    expect(Math.round(effectiveArmor(mine, collectMods(state, mine)) / FIX)).toBe(
      Math.round(mine.armor / FIX),
    );
  });
});
