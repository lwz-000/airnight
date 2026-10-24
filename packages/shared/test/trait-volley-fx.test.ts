/**
 * ============================================================
 *  ★★ 0.2.1：拉特兰羁绊的「全场齐射」—— 数据 → 事件 这一半
 * ============================================================
 *
 * 【这一发为什么要单独测？】
 * 它是**唯一一个"羁绊级"特效**：伤害来自全队累计攻击 30 次，跟"谁放的技能"无关。
 * 于是它踩到三条普通技能不会踩的线：
 *   ① 特效 id 写在**机制**上（`attackCountNuke.fx`），不在 `SkillDef.castFx`；
 *   ② 它借 `cast` 事件上报，但**不是棋子放技能** ⇒ 必须带 `traitCast`，
 *      否则渲染层会把技能条清零、还弹一圈"开技能"的符文环；
 *   ③ `boardFx` 要原样出现在事件里，渲染层才查得到 `BOARD_VOLLEY`。
 * 这三条任意一条漏了，游戏里都是"**什么都没放、也不报错**"（和别的特效同一个坑）。
 */
import { describe, expect, it } from 'vitest';
import {
  TRAIT_DEFS,
  UNIT_DEFS,
  computeActiveTraitLevels,
  computeChecksum,
  computeTraitBonuses,
  computeUnitTraitBonuses,
  createBattle,
  resolveUnitMechanics,
  step,
  type BattleState,
  type TeamSetup,
  type UnitPlacement,
} from '../src/index.js';

function place(defId: string, star: number, col: number, row: number): UnitPlacement {
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

/** 敌人血量拉满：齐射要打 30 下才触发，不能让对面两秒就被打死 */
function tanky(state: BattleState): BattleState {
  for (const unit of state.units) {
    if (unit.team !== 1) continue;
    unit.maxHp = 90_000_000;
    unit.hp = unit.maxHp;
    unit.armor = 0;
    unit.magicResist = 0;
  }
  return state;
}

/** 拉特兰的三个远程（空弦 / 芳汀 / 见行者）—— 一起凑 3 人档再攒 30 次攻击 */
function lateranoBattle(star: number, seed: number): BattleState {
  return tanky(
    createBattle(
      UNIT_DEFS,
      [
        team(0, [place('op10', star, 3, 4), place('op14', star, 3, 5), place('op25', star, 3, 6)]),
        team(1, [place('mn_slime', 1, 7, 4), place('mn_slime', 1, 7, 5), place('mn_slime', 1, 7, 6)]),
      ],
      seed,
    ),
  );
}

describe('★ 0.2.1 拉特兰齐射：特效 id 挂在机制上', () => {
  it('三档（3 / 6 / 9 人）的 attackCountNuke 都写了 fx = laterano_volley', () => {
    const tiers = TRAIT_DEFS['laterano']!.tiers;
    expect(tiers.length, '前提：拉特兰是三档').toBe(3);
    for (const tier of tiers) {
      const mechanic = tier.mechanics?.find((item) => item.kind === 'attackCountNuke');
      expect(mechanic, `${tier.count} 人档该有 attackCountNuke`).toBeTruthy();
      expect(
        (mechanic as { fx?: string }).fx,
        `${tier.count} 人档的齐射演出（三档演出一样，只是伤害不同）`,
      ).toBe('laterano_volley');
    }
    // ★ 0.2.2：触发次数是 30 / 20 / 20（原来是三档统一 30）
    const everyOf = tiers.map(
      (tier) => (tier.mechanics?.find((item) => item.kind === 'attackCountNuke') as { every: number } | undefined)?.every,
    );
    expect(everyOf).toEqual([30, 20, 20]);
  });

  it('≥3 个拉特兰才算生效（3 人档）—— 2 个不该有这条机制', () => {
    expect(resolveUnitMechanics([place('op10', 2, 3, 4), place('op14', 2, 3, 5)], UNIT_DEFS)[
      'op10'
    ]).toBeUndefined();
    const three = resolveUnitMechanics(
      [place('op10', 2, 3, 4), place('op14', 2, 3, 5), place('op25', 2, 3, 6)],
      UNIT_DEFS,
    );
    expect(three['op10']?.some((item) => item.kind === 'attackCountNuke')).toBe(true);
  });
});

describe('★ 0.2.1 拉特兰齐射：真打一场，事件里带出来了', () => {
  it('攒满 30 次攻击 ⇒ 一条 cast 事件带 traitCast + boardFx', () => {
    const state = lateranoBattle(2, 20261101);
    for (let i = 0; i < 2400 && !state.over; i++) step(state, UNIT_DEFS);

    const volleys = state.log.filter(
      (event) => event.type === 'cast' && (event as { traitCast?: boolean }).traitCast === true,
    ) as unknown as Array<{ unitId: number; skillId: string; boardFx?: string; t: number }>;

    expect(volleys.length, '前提：30 次攻击攒满了，齐射至少发动一次').toBeGreaterThan(0);
    for (const volley of volleys) {
      expect(volley.boardFx, '渲染层靠它查 BOARD_VOLLEY').toBe('laterano_volley');
      expect(volley.skillId, '内核里的固定名字（不进校验和，纯粹排查用）').toBe('trait_laterano_volley');
      // 发动者是"第 30 下恰好出手的那个人"，必须是这一队的
      const owner = state.units.find((unit) => unit.id === volley.unitId);
      expect(owner?.team, '必须是本队的某个棋子').toBe(0);
    }
  });

  it('齐射和"真技能施法"在同一场里并存，而且**必须能区分开**', () => {
    const state = lateranoBattle(2, 20261102);
    for (let i = 0; i < 2400 && !state.over; i++) step(state, UNIT_DEFS);

    type CastEvent = { traitCast?: boolean; boardFx?: string; unitId: number };
    const casts = state.log.filter((event) => event.type === 'cast') as unknown as CastEvent[];
    const volleys = casts.filter((event) => event.traitCast === true);
    const skillCasts = casts.filter((event) => event.traitCast !== true);
    expect(volleys.length, '前提：真的有齐射').toBeGreaterThan(0);
    expect(skillCasts.length, '前提：这三位也有主动技能 ⇒ 两种 cast 并存').toBeGreaterThan(0);
    /*
      ★ 这条是"漏了 `traitCast` 就静默出错"的防线：
      两种事件长得一模一样的话，渲染层就会把齐射当成"某个棋子开了技能"——
      技能条被清零、还弹一圈施法环；日志里也多一行"XX 释放技能"。
    */
    for (const volley of volleys) expect(volley.boardFx, '齐射带全场层').toBe('laterano_volley');
    for (const cast of skillCasts) expect(cast.boardFx, '普通技能没有全场层').toBeUndefined();
  });

  it('★★ 纯表现层：`traitCast` / `boardFx` 不进校验和', () => {
    const state = lateranoBattle(2, 20261103);
    for (let i = 0; i < 2400 && !state.over; i++) step(state, UNIT_DEFS);

    const withFx = computeChecksum(state, state.over ? (state.winner ?? null) : null, state.tick);
    // 把两个纯表现字段全部抹掉，再算一次
    for (const event of state.log) {
      if (event.type !== 'cast') continue;
      const target = event as { traitCast?: boolean; boardFx?: string };
      target.traitCast = undefined;
      target.boardFx = undefined;
    }
    const withoutFx = computeChecksum(state, state.over ? (state.winner ?? null) : null, state.tick);
    expect(withoutFx, '加特效不能让联机校验和变一个数').toBe(withFx);
  });
});
