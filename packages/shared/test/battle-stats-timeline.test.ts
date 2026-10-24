/**
 * ============================================================
 *  战斗属性时间线（0.0.3 末）—— 详情页"真实数值"的数据源
 * ============================================================
 *
 * 【为什么要有它】
 * 用户报"给干员装了骑士戒律，开技能后面板没变"。
 * 原来的面板是"开战基线 + 自己叠 buff 事件"，而战斗中改属性的写法不止一种
 * （技能 buff / 藏品增益 / 羁绊光环 / 40 秒狂暴走 statuses / 野怪换阶段直接乘属性），
 * 漏一处面板就是错的。现在内核模拟时顺手采真值，面板直接读 —— 全对。
 *
 * 【要钉住的三件事】
 *   1. **口径一致**：采样值必须等于内核真正在用的 effective* 函数值；
 *   2. **只记变化点**：不能每 tick 都塞一条（一场 1500 tick × 20 棋子 = 3 万条）；
 *   3. **不改战斗**：带不带时间线，校验和必须一样（它纯粹是"顺便记一份"）。
 */
import { describe, expect, it } from 'vitest';
import {
  FIX,
  UNIT_DEFS,
  collectMods,
  createBattle,
  effectiveAttackDamage,
  effectiveAttackSpeed,
  simulate,
  step,
  type BattleStatsSample,
  type TeamSetup,
  type UnitDef,
  type UnitDefTable,
} from '../src/index.js';

function makeDef(id: string, base: Partial<UnitDef['base']> = {}, skill: Partial<UnitDef['skill']> = {}): UnitDef {
  return {
    id,
    name: id,
    cost: 1,
    traits: [],
    base: { hp: 1000, attackDamage: 100, attackSpeed: 1000, armor: 0, magicResist: 0, range: 1, manaPerAttack: 0, ...base },
    starHpBp: 1000,
    starDamageBp: 1000,
    color: '#888888',
    sprite: id,
    skill: { id: `${id}_skill`, name: id, desc: '测试用', effects: [], manaSource: 'attack', ...skill },
  };
}

function tableOf(defs: UnitDef[]): UnitDefTable {
  const out: UnitDefTable = {};
  for (const def of defs) out[def.id] = def;
  return out;
}

const duel: [TeamSetup, TeamSetup] = [
  { team: 0, units: [{ defId: 'me', star: 1, cell: { col: 4, row: 4 } }] },
  { team: 1, units: [{ defId: 'foe', star: 1, cell: { col: 5, row: 4 } }] },
];

describe('★ 战斗属性时间线', () => {
  it('每个活着的棋子都有一条 t=0 的采样，且数值与内核口径一致', () => {
    const defs = tableOf([makeDef('me', { armor: 30 }), makeDef('foe')]);
    // 时间线的第一条 = 开战值，和 createBattle 之后直接算一模一样
    const state = createBattle(defs, duel, 7);
    const result = simulate(defs, duel, 7, { statsTimeline: true });

    for (const unit of state.units) {
      const first = result.statsTimeline!.find((s) => s.unitId === unit.id && s.t === 0)!;
      expect(first, `棋子 ${unit.id} 缺 t=0 采样`).toBeDefined();
      const mods = collectMods(state, unit);
      expect(first.attackSpeed).toBe(effectiveAttackSpeed(unit, mods));
      expect(first.attackDamage).toBe(effectiveAttackDamage(unit, mods));
      expect(first.armor).toBe(unit.armor);
    }
  });

  it('★ 中途挂增益会多出一条采样，到期后还会回落一条', () => {
    // 打一下技能（manaPerAttack 拉满），技能给自己 +50% 攻速 10 秒
    const me = makeDef('me', { manaPerAttack: 1000, hp: 100000, attackDamage: 10 });
    me.skill = {
      ...me.skill,
      effects: [{ kind: 'buff', target: 'self', stats: { attackSpeedBp: 5000 }, durationTicks: 200 }],
    };
    const defs = tableOf([me, makeDef('foe', { hp: 100000 })]);
    const result = simulate(defs, duel, 21, { statsTimeline: true });

    const samples = result.statsTimeline!.filter((s) => s.unitId === 1);
    // 只看 40 秒狂暴之前的那段（狂暴是另一条全局规则，这里不想被它干扰）
    const speeds = samples.filter((s) => s.t < 800).map((s) => s.attackSpeed);
    expect(speeds[0], '开战是白板').toBe(1000);
    expect(speeds, '中间必须出现 +50% 的那一条').toContain(1500);
    const boostedAt = speeds.indexOf(1500);
    expect(speeds.slice(boostedAt + 1), '增益到期后要回落到白板').toContain(1000);
    // 只记变化点：一张 10 秒的增益 = 2 条（生效 / 到期），不该每 tick 一条
    expect(samples.length, '采样条数应该很少').toBeLessThan(30);
  });

  it('★ 只记变化点：什么都不会变的棋子只有 1 条', () => {
    const defs = tableOf([makeDef('me'), makeDef('foe', { hp: 100000 })]);
    const result = simulate(defs, duel, 99, { statsTimeline: true });
    const foe = result.statsTimeline!.filter((s) => s.unitId === 1001);
    expect(foe, '对面这只从头到尾没被加过任何东西').toHaveLength(1);
  });

  it('★ 不带 opts 就没有时间线，而且校验和完全一样（它不影响战斗）', () => {
    const defs = tableOf([makeDef('me', { armor: 30 }), makeDef('foe')]);
    const plain = simulate(defs, duel, 7);
    const withTimeline = simulate(defs, duel, 7, { statsTimeline: true });
    expect(plain.statsTimeline).toBeUndefined();
    expect(withTimeline.checksum).toBe(plain.checksum);
    expect(withTimeline.winner).toBe(plain.winner);
    expect(withTimeline.ticks).toBe(plain.ticks);
  });

  it('40 秒狂暴也算进去（它走的是 statuses，从来不发 buff 事件）', () => {
    // 两边都打不死，硬撑到 40 秒
    const defs = tableOf([
      makeDef('me', { hp: 100000, attackDamage: 1, armor: 999 }),
      makeDef('foe', { hp: 100000, attackDamage: 1, armor: 999 }),
    ]);
    const result = simulate(defs, duel, 5, { statsTimeline: true });
    const mine = result.statsTimeline!.filter((s) => s.unitId === 1);
    const last = mine[mine.length - 1]!;
    expect(result.ticks, '得真的打到 40 秒之后').toBeGreaterThan(800);
    expect(last.attackSpeed, '狂暴后攻速 ×2').toBe(2000);
  });

  it('采样是只读的：连着跑两遍，结果完全一致（确定性）', () => {
    const defs = tableOf([makeDef('me', { manaPerAttack: 1000, attackDamage: 10 }), makeDef('foe', { hp: 5000 })]);
    const a = simulate(defs, duel, 3, { statsTimeline: true });
    const b = simulate(defs, duel, 3, { statsTimeline: true });
    expect(a.checksum).toBe(b.checksum);
    expect(JSON.stringify(a.statsTimeline)).toBe(JSON.stringify(b.statsTimeline));
  });

  it('真实干员打一场：采样条数不会爆掉（只记变化点）', () => {
    const result = simulate(
      UNIT_DEFS,
      [
        { team: 0, units: [{ defId: 'op01', star: 3, cell: { col: 4, row: 4 } }] },
        { team: 1, units: [{ defId: 'op11', star: 3, cell: { col: 5, row: 4 } }] },
      ],
      20261011,
      { statsTimeline: true },
    );
    expect(result.ticks).toBeGreaterThan(50);
    // 一场最多 1500 tick、每方最多十几只：只记变化点的话量级是"几十条"，不是上万条
    expect(result.statsTimeline!.length).toBeLessThan(600);
  });
});
