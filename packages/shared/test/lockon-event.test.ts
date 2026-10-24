/**
 * ============================================================
 *  ★★ 0.2.2 蕾缪安 3 星「强制追思」：锁定 / 引爆的**纯表现事件**
 * ============================================================
 *
 * 【为什么内核要多报这两条事件？】
 * 技能是"先停攻 7 秒、每秒锁一个敌人的地块，7 秒后把 7 发弹药全砸在那些地块上"。
 * 这 7 秒里渲染层**什么都不知道** —— 锁定账记在 `SkillRuntime.lockOn.cells` 里，
 * 那是内核内部状态，事件流里看不见。于是用户要的那段演出
 * （地块上的狙击镜 + 向内收缩的粉色光环）没有任何触发点。
 *
 * 所以内核补两条**纯表现**事件：
 *   · `lockOnMark`  —— 每锁一个地块报一条（含"到引爆还剩几 tick"）
 *   · `lockOnBlast` —— 引爆那一刻，每个落点报一条
 *
 * ============================================================
 *  ★ 这里钉死三件事
 * ============================================================
 *  1. **数据表**：op38 的 3 星里确实写了 `fx: 'lockon_sniper'`；
 *  2. **真放一次技能**：锁定按 1 秒一个、引爆在 7 秒后，格子/序号/剩余时间都对；
 *  3. ★★ **纯表现层**：把这两类事件从日志里删掉，`computeChecksum` 一个数都不变
 *     （联机靠校验和对账 —— 加表现层事件绝不能让它变，和 `slash`/`bloom` 同一条规矩）。
 */
import { describe, expect, it } from 'vitest';
import {
  SKILLS,
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

// ------------------------------------------------------------
//  合成数据（只用一个"会锁地块"的技能，不依赖某个干员的数值）
// ------------------------------------------------------------

function makeDef(id: string, base: Partial<UnitDef['base']> = {}): UnitDef {
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
      // 谁也打不死谁：7 秒的锁定窗口必须完整跑完，战斗不能提前结束
      hp: 1_000_000,
      attackDamage: 0,
      attackSpeed: 0,
      armor: 0,
      magicResist: 0,
      range: 1,
      manaPerAttack: 0,
      ...base,
    },
    starHpBp: 1000,
    starDamageBp: 1000,
    color: '#888888',
    sprite: id,
    skill,
  };
}

function team(teamId: 0 | 1, defIds: Array<{ defId: string; col: number; row: number }>): TeamSetup {
  return {
    team: teamId,
    units: defIds.map((entry) => ({ defId: entry.defId, star: 1, cell: { col: entry.col, row: entry.row } })),
  };
}

const LOCK_EFFECT: SkillEffect = {
  kind: 'lockOn',
  count: 3,
  intervalTicks: 20, // 1 秒
  blastTicks: 60, // 3 秒（测试缩短，真正的 7 秒 = 140 tick）
  radius: 1,
  shape: 'square',
  power: 1000,
  damageType: 'physical',
  fx: 'lockon_sniper',
};

// ------------------------------------------------------------
//  ① 数据表
// ------------------------------------------------------------

describe('★ 0.2.2 蕾缪安 3 星：数据里写了锁定演出的样式 id', () => {
  it('op38 的 3 星 lockOn 带 fx = lockon_sniper', () => {
    const effects = SKILLS['op38']!.star3!.effects ?? [];
    const lock = effects.find((effect) => effect.kind === 'lockOn') as { fx?: string } | undefined;
    expect(lock, '蕾缪安 3 星该有 lockOn').toBeTruthy();
    expect(lock!.fx, '没有它渲染层就不知道该画哪套瞄准镜').toBe('lockon_sniper');
  });
});

// ------------------------------------------------------------
//  ② 真放一次技能
// ------------------------------------------------------------

describe('★ 0.2.2 锁定 / 引爆事件', () => {
  function run() {
    const defs: UnitDefTable = {};
    for (const id of ['caster', 'dummyA', 'dummyB']) defs[id] = makeDef(id);
    const state = createBattle(
      defs,
      [
        team(0, [{ defId: 'caster', col: 2, row: 2 }]),
        team(1, [
          { defId: 'dummyA', col: 7, row: 2 },
          { defId: 'dummyB', col: 8, row: 6 },
        ]),
      ],
      20261019,
    );
    // 从第 5 tick 开始放技能：落点时刻就是 25 / 45 / 65，好算
    state.tick = 5;
    const caster = state.units.find((unit) => unit.defId === 'caster')!;
    castSkill(state, caster, 'caster_skill', [LOCK_EFFECT], defs);
    // 跑够 70 tick 把锁定与引爆都走完（引爆在 65，留点余量）
    for (let i = 0; i < 70 && !state.over; i++) step(state, defs);
    return { state, caster };
  }

  it('三个落点、每 20 tick 一个，引爆在 blastTicks 那一刻', () => {
    const { state } = run();
    const marks = state.log.filter((event) => event.type === 'lockOnMark') as Array<{
      t: number;
      cell: { col: number; row: number };
      index: number;
      total: number;
      ticksLeft: number;
      fx?: string;
    }>;
    expect(marks.map((mark) => mark.t)).toEqual([25, 45, 65]);
    expect(marks.map((mark) => mark.index)).toEqual([0, 1, 2]);
    // 总弹药数由数据决定（这里写 3）
    for (const mark of marks) expect(mark.total).toBe(3);
    // "还剩几 tick 引爆"必须一路递减 —— 渲染层靠它决定瞄准镜活多久
    expect(marks.map((mark) => mark.ticksLeft)).toEqual([40, 20, 0]);
    // 样式 id 原样带过去
    for (const mark of marks) expect(mark.fx).toBe('lockon_sniper');
  });

  it('引爆：每个落点各一条 lockOnBlast（哪怕那一格已经没人了）', () => {
    const { state } = run();
    const blasts = state.log.filter((event) => event.type === 'lockOnBlast') as Array<{
      t: number;
      cell: { col: number; row: number };
      radius: number;
      shape: string;
      fx?: string;
    }>;
    expect(blasts.length).toBe(3);
    for (const blast of blasts) {
      expect(blast.t).toBe(65);
      expect(blast.radius).toBe(1);
      expect(blast.shape).toBe('square');
      expect(blast.fx).toBe('lockon_sniper');
    }
  });

  it('★★ 纯表现：删掉这两类事件，校验和一个数都不变', () => {
    const { state } = run();
    const withFx = computeChecksum(state, state.winner, state.tick);
    const full = state.log;
    // 临时把两类事件摘掉，算一次"没有它们"的指纹
    const kept = full.filter((event) => event.type !== 'lockOnMark' && event.type !== 'lockOnBlast');
    const removed = full.length - kept.length;
    expect(removed, '前提：确实产生过这两类事件').toBeGreaterThan(0);
    (state as { log: typeof full }).log = kept;
    const withoutFx = computeChecksum(state, state.winner, state.tick);
    (state as { log: typeof full }).log = full;
    expect(withoutFx, '表现层事件进了校验和就等于"多播一条特效让联机分叉"').toBe(withFx);
  });
});
