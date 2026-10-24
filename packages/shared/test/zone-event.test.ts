/**
 * ★★ 0.2：`zone` 事件（范围白框的数据来源）—— 陈的"前方 3 格"必须是**直线**。
 *
 * ============================================================
 *  【用户报的是什么？】
 * ============================================================
 * "陈的技能是面朝的直线 3 格，不是半径三格。"
 * 实测：**内核本来就是直线**（这一组的第一条用例把它钉住），
 * 看起来像"半径 3 格"的是**界面画出来的那个白框** ——
 * 渲染层原来只会画"以中心格为圆心、半径 r 的方块"，
 * 而 `line` 这种形状它压根没处理（`replay.ts` 的 spawnZone 只特判了 cross）。
 *
 * ⇒ 所以这里是两件事：
 *   1. 内核：伤害范围确实是直线、并且 `zone` 事件带上了**施法者所在格**
 *      （没有它，界面无从知道"这条线朝哪边"）；
 *   2. 界面：照 `from` + `cell` 画成一条 3 格长条（纯几何那部分见
 *      `apps/web/test/zone-shape.test.ts`）。
 *
 * 【写这一组踩过的坑】
 *  · 半场是按**列**分的（0~4 / 5~9），敌人不能摆在左边；
 *  · 靶子用"惰性靶子"（压平护甲魔抗），否则伤害数字和掉血格子对不上。
 */
import { describe, expect, it } from 'vitest';
import {
  UNIT_DEFS,
  castSkill,
  createBattle,
  skillVariantOf,
  type BattleState,
  type TeamSetup,
  type UnitDef,
  type UnitPlacement,
  type UnitState,
} from '../src/index.js';

const dummy = (col: number, row: number): UnitPlacement => ({
  defId: 'mn_duholy',
  star: 3,
  cell: { col, row },
  statOverride: { hp: 100_000_000, armor: 0, magicResist: 0, attackSpeed: 0.1 },
});

function board(a: UnitPlacement[], b: UnitPlacement[]): BattleState {
  const setups: [TeamSetup, TeamSetup] = [
    { team: 0, units: a, playerContext: { gold: 0, hp: 100 } },
    { team: 1, units: b, playerContext: { gold: 0, hp: 100 } },
  ];
  return createBattle(UNIT_DEFS, setups, 20261016);
}

const byName = (name: string): UnitDef => {
  const def = Object.values(UNIT_DEFS).find((d) => d.name === name);
  if (!def) throw new Error(`找不到干员「${name}」——名字改过？`);
  return def;
};

/** 谁掉了血（用来断言"打到的格子"） */
const hurtCells = (state: BattleState): string[] =>
  state.units
    .filter((unit) => unit.team === 1 && unit.hp < unit.maxHp)
    .map((unit) => `${unit.cell.col},${unit.cell.row}`)
    .sort();

describe('★ 0.2 陈·赤霄：范围是"面朝的直线 3 格"', () => {
  it('数据：shape 是 line、radius 是 3、倍率 150%/180%/230%', () => {
    const effects = skillVariantOf(byName('陈'), 1).effects;
    const damage = effects.find((effect) => effect.kind === 'damage');
    expect(damage).toMatchObject({
      damageType: 'physical',
      shape: 'line',
      radius: 3,
      power: [1500, 1800, 2300],
    });
  });

  it('★★ 只打正面那 3 格：斜角 / 侧后方 / 第 4 格都不掉血', () => {
    const state = board([{ defId: 'op21', star: 1, cell: { col: 4, row: 4 } }], [
      dummy(5, 4), // 正前方 1 格 —— 主目标
      dummy(6, 4), // 直线上 2 格
      dummy(7, 4), // 直线上 3 格
      dummy(8, 4), // 直线上 4 格（超出）
      dummy(6, 3), // 斜前方（不是"半径"，不该被打）
      dummy(6, 5), // 另一个斜角
      dummy(5, 8), // 侧面远处
    ]);
    const chen = state.units.find((unit) => unit.defId === 'op21') as UnitState;
    castSkill(state, chen, 'op21_skill', [...skillVariantOf(byName('陈'), 1).effects], UNIT_DEFS);

    expect(hurtCells(state), '只有直线上的 3 格').toEqual(['5,4', '6,4', '7,4']);
  });

  it('★ zone 事件要带上「施法者所在格」，方向才画得出来', () => {
    const state = board([{ defId: 'op21', star: 1, cell: { col: 4, row: 4 } }], [dummy(5, 4)]);
    const chen = state.units.find((unit) => unit.defId === 'op21') as UnitState;
    castSkill(state, chen, 'op21_skill', [...skillVariantOf(byName('陈'), 1).effects], UNIT_DEFS);

    const zone = state.log.find((event) => event.type === 'zone');
    expect(zone, '要报一条 zone（界面的白框就是照它画的）').toBeTruthy();
    if (zone?.type !== 'zone') throw new Error('类型不对');
    expect(zone.shape).toBe('line');
    expect(zone.radius).toBe(3);
    expect(zone.cell, '中心 = 主目标那一格').toEqual({ col: 5, row: 4 });
    expect(zone.from, '★ 起点 = 施法者那一格').toEqual({ col: 4, row: 4 });
  });

  it('方形（妮芙"目标周围四格"）的范围也照样带 from，不破坏别的技能', () => {
    const state = board([{ defId: 'op34', star: 1, cell: { col: 4, row: 4 } }], [
      dummy(5, 4),
      dummy(6, 5),
    ]);
    const caster = state.units.find((unit) => unit.defId === 'op34') as UnitState;
    const variant = skillVariantOf(UNIT_DEFS['op34']!, 1);
    castSkill(state, caster, 'op34_skill', [...variant.effects], UNIT_DEFS);
    const zone = state.log.find((event) => event.type === 'zone');
    if (zone?.type !== 'zone') throw new Error('这条技能的溅射应该报了 zone');
    expect(zone.from).toEqual({ col: 4, row: 4 });
  });
});
