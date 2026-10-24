/**
 * ============================================================
 *  ★ 0.1.4：战术柱的嘲讽 —— 从"硬编码 id"挪回"数据"
 * ============================================================
 *
 * 【你的要求】「战术柱也添加嘲讽」
 *
 * 【实际情况】它**一直都会嘲讽** —— 但那句实现是 `combat-math.ts` 里
 *   `if (def.id === 'summon_pillar') unit.taunt = true;`
 * 一句**按 id 写死**的判断。后果：
 *   · 数据表里查不到"战术柱会嘲讽"，只有读源码才知道；
 *   · 界面/图鉴只读数据，所以柱子的说明一直只有"不会攻击也不会移动"，
 *     看不出它到底是干什么用的；
 *   · 以后再出一个会嘲讽的召唤物，还得再写一句 id 判断。
 *
 * 【改法】和支援防暴桩的假人走**同一条路**：`mechanics:[{kind:'taunt'}]`，
 * 由 `spawnSummon` 读数据挂上；硬编码那句删掉。
 *
 * ============================================================
 *  为什么"召唤物"要单独补一次？（这段是 0.1.1 就有的坑）
 * ============================================================
 *  `createBattle` 那段"挂机制"的循环只跑**开局就在场上的棋子**。
 *  召唤物是战斗中临时生出来的，走 `spawnSummon`，不经过那段 ——
 *  所以 `spawnSummon` 里必须自己读一遍 `def.mechanics`。
 *  ★ 也就是说：**召唤物的嘲讽有两处可能的入口**，数据这一处才是唯一的真相。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  MANA_MAX,
  SUMMON_DEFS,
  TRAIT_DEFS,
  UNIT_DEFS,
  computeActiveTraitLevels,
  computeTraitBonuses,
  computeUnitTraitBonuses,
  createBattle,
  resolveUnitMechanics,
  selectTarget,
  step,
  type BattleState,
  type TeamSetup,
  type UnitPlacement,
  type UnitState,
} from '../src/index.js';

function place(team: 0 | 1, defId: string, col: number, row: number): UnitPlacement {
  return { defId, star: 1, cell: { col, row } };
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

function battle(units0: UnitPlacement[], units1: UnitPlacement[], seed = 11): BattleState {
  return createBattle(UNIT_DEFS, [team(0, units0), team(1, units1)], seed);
}

function unitOf(state: BattleState, defId: string): UnitState {
  const unit = state.units.find((item) => item.defId === defId);
  if (!unit) throw new Error(`场上没有 ${defId}`);
  return unit;
}

describe('★ 0.1.4 战术柱嘲讽：写在数据里', () => {
  it('★ SUMMON_DEFS.summon_pillar 带 mechanics:[{kind:"taunt"}]', () => {
    const pillar = SUMMON_DEFS.summon_pillar;
    expect(pillar, '战术柱要能在召唤物表里找到').toBeTruthy();
    expect(
      pillar.mechanics?.some((m) => m.kind === 'taunt'),
      '★ 嘲讽必须写在数据里（界面/图鉴只读数据）',
    ).toBe(true);
    // 不写 radius = 全场嘲讽（柱子的老行为，见 movement.ts 的说明）
    expect(pillar.mechanics?.find((m) => m.kind === 'taunt')).toEqual({ kind: 'taunt' });
  });

  it('说明里也写清了"会吸引敌人优先攻击"', () => {
    expect(SUMMON_DEFS.summon_pillar!.skill.desc).toContain('吸引敌人');
  });

  it('假人的嘲讽没被这次改动弄坏（同一个入口）', () => {
    expect(SUMMON_DEFS.summon_dummy!.mechanics?.some((m) => m.kind === 'taunt')).toBe(true);
  });

  it('★ 源码级：spawnSummon 里不许按 id 写死任何一个召唤物', () => {
    /*
      比"不许出现 summon_pillar"更严一点：**任何**召唤物 id 都不许出现 ——
      出现就说明有人又绕开数据、给某个召唤物开了小灶。
      （0.1.4 之前这里就有一句 `if (def.id === 'summon_pillar') unit.taunt = true;`）
    */
    const src = readFileSync(new URL('../src/combat-math.ts', import.meta.url), 'utf8');
    const start = src.indexOf('export function spawnSummon(');
    const end = src.indexOf('\nexport ', start + 10);
    const body = src.slice(start, end < 0 ? src.length : end);
    expect(start, '前提：找得到 spawnSummon').toBeGreaterThanOrEqual(0);
    for (const id of Object.keys(SUMMON_DEFS)) {
      expect(body, `★ spawnSummon 里不该出现召唤物 id「${id}」（要写数据，别写死 id）`).not.toContain(
        `'${id}'`,
      );
    }
  });
});

describe('★ 0.1.4 战术柱嘲讽：行为层（真的会把敌人拉过来）', () => {
  it('★ 柱子落地后，敌人优先打柱子而不是迷迭香本人', () => {
    /*
      场面：我方迷迭香（op18）+ 一个"更好打"的脆皮队友，敌方两个普通单位。
      柱子是 `place:'besideEnemy'`，会落在敌人旁边。
      嘲讽生效的话，敌人的锁敌结果应该是柱子，而不是迷迭香 / 那个脆皮。
    */
    const state = battle([place(0, 'op18', 2, 4), place(0, 'mn_slime', 2, 5)], [
      place(1, 'mn_slime', 7, 4),
      place(1, 'mn_slime', 7, 5),
    ]);
    const rosa = unitOf(state, 'op18');
    rosa.mana = MANA_MAX;

    let pillar: UnitState | undefined;
    for (let i = 0; i < 60 && !state.over; i++) {
      step(state, UNIT_DEFS);
      pillar = state.units.find((u) => u.defId === 'summon_pillar' && !u.dead);
      if (pillar) break;
    }
    expect(pillar, '前提：柱子得先落地').toBeTruthy();
    expect(pillar!.taunt, '★ 落地那一刻就该挂着嘲讽标记').toBe(true);

    const enemies = state.units.filter((u) => u.team === 1 && !u.dead);
    expect(enemies.length).toBeGreaterThan(0);
    for (const enemy of enemies) {
      expect(
        selectTarget(state, enemy),
        `★ 敌人 ${enemy.defId} 应该被柱子吸引，而不是去打别人`,
      ).toBe(pillar!.id);
    }
  });

  it('柱子消失（到时/被打掉）之后，敌人恢复正常锁敌', () => {
    const state = battle([place(0, 'op18', 2, 4)], [place(1, 'mn_slime', 7, 4)]);
    const rosa = unitOf(state, 'op18');
    rosa.mana = MANA_MAX;
    let pillar: UnitState | undefined;
    for (let i = 0; i < 60 && !state.over; i++) {
      step(state, UNIT_DEFS);
      pillar = state.units.find((u) => u.defId === 'summon_pillar' && !u.dead);
      if (pillar) break;
    }
    expect(pillar, '前提：柱子得先落地').toBeTruthy();
    // 直接把柱子判死，再看敌人锁谁
    pillar!.dead = true;
    pillar!.hp = 0;
    const enemy = state.units.find((u) => u.team === 1 && !u.dead)!;
    expect(selectTarget(state, enemy), '柱子没了就不该再被它吸引').not.toBe(pillar!.id);
    expect(selectTarget(state, enemy)).toBe(rosa.id);
  });
});
