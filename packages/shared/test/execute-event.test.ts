/**
 * ============================================================
 *  ★★ 0.3.2 炉芯终曲「无言的期盼」：即死叠加的**纯表现事件**
 * ============================================================
 *
 * 【为什么内核要多报一条 `executeFx`？】
 * `killUnit` 只发 `death`，而 `death` 分不清"被打死"和"被即死"。两者读感完全不同：
 * 前者是"打完最后一下倒了"，后者是**人凭空被抹掉**（暗心 + 熔红裂隙 + 碎片外飞）。
 * 用户口径要求后者在被抹掉的那个人身上**单独叠一段黑红破碎**，
 * 而事件流里没有任何东西能触发它 —— 所以内核在 `tickExecute` 真正得手的那一 tick 补一条。
 *
 * ============================================================
 *  ★ 这里钉死五件事
 * ============================================================
 *  1. **数据表**：炉芯终曲的 execute 写了 `fx: 'amiya_execute'`，
 *     慈悲愿景的 damage 写了 `fx: 'amiya_verdict'`，两个形态都有 `tracerFx`；
 *  2. **真放一次技能**：每 `intervalTicks` 报一条，一个人只报一次；
 *  3. **时机**：报在 `killUnit` **之前**（特效与掉血同帧，且排在 `death` 前面）；
 *  4. **数据驱动**：数据没写 `fx` 时一条都不报（不许往日志里灌无用事件）；
 *  5. ★★ **纯表现层**：把 `executeFx` 删掉，`computeChecksum` 一个数都不变。
 */
import { describe, expect, it } from 'vitest';
import {
  ASCEND_DEFS,
  AMIYA_FORM_IDS,
  castSkill,
  computeChecksum,
  createBattle,
  step,
  type SkillDef,
  type SkillEffect,
  type TeamSetup,
  type UnitDef,
  type UnitDefTable,
} from '../src/index.js';

function makeDef(id: string): UnitDef {
  const skill: SkillDef = {
    id: `${id}_skill`,
    name: `${id} 技能`,
    desc: '测试用（效果在 castSkill 里显式传）',
    effects: [],
    manaSource: 'attack',
  };
  return {
    id,
    name: id,
    cost: 1,
    traits: [],
    base: {
      // 谁也别打死谁：即死的节奏必须完整跑完，战斗不能提前结束
      hp: 1_000_000,
      attackDamage: 0,
      attackSpeed: 0,
      armor: 0,
      magicResist: 0,
      range: 1,
      manaPerAttack: 0,
    },
    starHpBp: 1000,
    starDamageBp: 1000,
    color: '#888888',
    sprite: id,
    skill,
  };
}

function team(teamId: 0 | 1, entries: Array<{ defId: string; col: number; row: number }>): TeamSetup {
  return {
    team: teamId,
    units: entries.map((entry) => ({ defId: entry.defId, star: 1, cell: { col: entry.col, row: entry.row } })),
  };
}

/** 10 tick（0.5 秒）一次、持续 40 tick ⇒ 最多 4 次；测试缩短得比数据快，好在几十 tick 内跑完 */
const EXECUTE_EFFECT: SkillEffect = {
  kind: 'execute',
  target: 'randomEnemies',
  count: 1,
  intervalTicks: 10,
  durationTicks: 40,
  fx: 'amiya_execute',
};

// ------------------------------------------------------------
//  ① 数据表
// ------------------------------------------------------------

describe('★ 0.3.2 阿米娅升变：数据里写了三套演的样式 id', () => {
  it('炉芯终曲：普攻弹道 / 技能氛围 / 即死叠加都写了', () => {
    const core = ASCEND_DEFS[AMIYA_FORM_IDS.core]!;
    expect(core.tracerFx, '没有它普攻会退回那根白线（不是"黑色法术"）').toBe('amiya_core');
    expect(core.skill.castFx, '没有它全场碎裂氛围不知道挂哪').toBe('amiya_requiem');
    const execute = core.skill.effects.find((effect) => effect.kind === 'execute') as
      | { fx?: string }
      | undefined;
    expect(execute, '炉芯终曲该有 execute').toBeTruthy();
    expect(execute!.fx, '没有它即死那一刻什么都不放').toBe('amiya_execute');
  });

  it('慈悲愿景：普攻弹道 + 3×4 伤害圈都写了', () => {
    const mercy = ASCEND_DEFS[AMIYA_FORM_IDS.mercy]!;
    expect(mercy.tracerFx, '没有它普攻会退回那根白线（不是"柔和粉"）').toBe('amiya_mercy');
    const damage = mercy.skill.effects.find((effect) => effect.kind === 'damage') as
      | { fx?: string; shape?: string; radius?: number }
      | undefined;
    expect(damage).toBeTruthy();
    expect(damage!.fx, '没有它方块阵不知道挂哪').toBe('amiya_verdict');
    // ★ 方块阵画出来的必须是 3 宽 × 4 深 —— 半径和形状任何一项变了，那 12 格就不是 12 格了
    expect(damage!.shape).toBe('rect');
    expect(damage!.radius).toBe(3);
  });
});

// ------------------------------------------------------------
//  ② 真放一次技能
// ------------------------------------------------------------

describe('★ 0.3.2 即死事件', () => {
  function run(effect: SkillEffect = EXECUTE_EFFECT) {
    const defs: UnitDefTable = {};
    for (const id of ['caster', 'foeA', 'foeB', 'foeC']) defs[id] = makeDef(id);
    const state = createBattle(
      defs,
      [
        team(0, [{ defId: 'caster', col: 2, row: 2 }]),
        team(1, [
          { defId: 'foeA', col: 7, row: 2 },
          { defId: 'foeB', col: 8, row: 5 },
          { defId: 'foeC', col: 6, row: 7 },
        ]),
      ],
      20261022,
    );
    state.tick = 5;
    const caster = state.units.find((unit) => unit.defId === 'caster')!;
    castSkill(state, caster, 'caster_skill', [effect], defs);
    // 跑 45 tick：三次判定分别在 +10 / +20 / +30 这一 tick（都在 40 tick 之内）
    for (let i = 0; i < 45 && !state.over; i++) step(state, defs);
    return { state };
  }

  it('每个人只报一条 executeFx，而且带的是数据里那个 id', () => {
    const { state } = run();
    const events = state.log.filter((event) => event.type === 'executeFx') as Array<{
      t: number;
      unitId: number;
      fx?: string;
    }>;
    // 3 个敌人 ⇒ 三次判定各抹掉一个，之后就没人可抹了
    expect(events.length).toBe(3);
    for (const event of events) expect(event.fx).toBe('amiya_execute');
    // 同一个 unitId 不许出现两次（否则就是"同一个人被抹了两遍"，画面会叠两层）
    expect(new Set(events.map((event) => event.unitId)).size).toBe(3);
    // 判定间隔 = intervalTicks
    expect(events.map((event) => event.t)).toEqual([15, 25, 35]);
  });

  it('★ 报在 killUnit 之前（同一个人先 executeFx、后 death）', () => {
    const { state } = run();
    const firstExecute = state.log.findIndex((event) => event.type === 'executeFx');
    expect(firstExecute).toBeGreaterThanOrEqual(0);
    const executed = state.log[firstExecute] as { unitId: number };
    const death = state.log.findIndex(
      (event) => event.type === 'death' && (event as { unitId: number }).unitId === executed.unitId,
    );
    expect(death, '被即死的人当然要有一条 death').toBeGreaterThan(firstExecute);
    /*
      ★ 紧挨着：中间不许插别的结算 ——
      "特效和掉血落在同一帧"就是靠这个顺序保证的（和 `slash` 同一条口径）。
    */
    expect(death).toBe(firstExecute + 1);
  });

  it('数据没写 fx ⇒ 一条都不报（不许往日志里灌无用事件）', () => {
    const { state } = run({ ...EXECUTE_EFFECT, fx: undefined });
    expect(state.log.filter((event) => event.type === 'executeFx').length).toBe(0);
    // 前提：人确实还是被抹掉了（不是"技能没生效所以没事件"）
    expect(state.log.filter((event) => event.type === 'death').length).toBe(3);
  });

  it('★★ 纯表现：删掉 executeFx，校验和一个数都不变', () => {
    const { state } = run();
    const withFx = computeChecksum(state, state.winner, state.tick);
    const full = state.log;
    const kept = full.filter((event) => event.type !== 'executeFx');
    expect(full.length - kept.length, '前提：确实产生过 executeFx').toBeGreaterThan(0);
    (state as { log: typeof full }).log = kept;
    const withoutFx = computeChecksum(state, state.winner, state.tick);
    (state as { log: typeof full }).log = full;
    expect(withoutFx, '表现层事件进了校验和就等于"多播一条特效让联机分叉"').toBe(withFx);
  });
});
