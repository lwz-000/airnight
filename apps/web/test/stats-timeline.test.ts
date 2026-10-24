/**
 * ============================================================
 *  「详情页的真实数值」—— 属性时间线（0.0.3 末）
 * ============================================================
 *
 * 【用户报的 bug】
 * "给干员装了骑士戒律，开技能后面板没变"。
 * 查下来功能是实现了的，问题在**面板显示**：
 * 以前的算法是"开战基线 + buff 事件"，只有上报过事件的地方才算得出来，
 * 而战斗中改属性的写法有好几种（技能 buff / 藏品增益 / 羁绊光环 /
 * 40 秒狂暴走 statuses / 野怪换阶段直接乘属性…），漏一处面板就是错的。
 *
 * 【现在的口径】
 * 内核模拟时顺手采真值 → 面板直接读。这里测的就是"读得对不对"：
 * 取的必须是**当前 tick 生效**的那条，往回拖也要对（播放器能 seek）。
 */
import { describe, expect, it } from 'vitest';
import {
  FIX,
  type BattleStatsSample,
} from '../../../packages/shared/src/index.js';
import {
  effectsAt,
  groupStatsTimeline,
  panelStatsAt,
  panelStatsFromSample,
  statsSampleAt,
} from '../src/three/stats-timeline.js';

function sample(t: number, unitId: number, partial: Partial<BattleStatsSample> = {}): BattleStatsSample {
  return {
    t,
    unitId,
    attackSpeed: 1000,
    attackDamage: 100 * FIX,
    armor: 30 * FIX,
    magicResist: 20 * FIX,
    range: 1,
    maxHp: 600 * FIX,
    ...partial,
  };
}

describe('★ 属性时间线：面板读的是"此刻的真实数值"', () => {
  it('t=0 那条就是开战值，涨跌为 0', () => {
    const s = sample(0, 1);
    const panel = panelStatsFromSample(s);
    expect(panel.attackSpeed).toBe(1);
    expect(panel.attackDamage).toBe(100);
    expect(panel.armor).toBe(30);
    expect(panel.magicResist).toBe(20);
    expect(panel.range).toBe(1);
    expect(panel.bonusSpeedBp, '开战那一刻没有涨跌').toBe(0);
    expect(panel.bonusDamageBp).toBe(0);
  });

  it('攻速 +50% / 攻击力 +50% 会如实显示，并标出涨了多少', () => {
    const grouped = groupStatsTimeline([sample(0, 1), sample(20, 1, { attackSpeed: 1500, attackDamage: 150 * FIX })]);
    expect(panelStatsAt(grouped, 1, 20)!.attackSpeed).toBeCloseTo(1.5);
    expect(panelStatsAt(grouped, 1, 20)!.attackDamage).toBe(150);
    expect(panelStatsAt(grouped, 1, 20)!.bonusSpeedBp).toBe(5000);
    expect(panelStatsAt(grouped, 1, 20)!.bonusDamageBp).toBe(5000);
  });

  it('★ 取的是"当前 tick 生效"的那条：增益到期后回落到开战值', () => {
    const grouped = groupStatsTimeline([
      sample(0, 1),
      sample(20, 1, { attackSpeed: 1500 }),
      sample(220, 1, { attackSpeed: 1000 }),
    ]);
    expect(panelStatsAt(grouped, 1, 19)!.attackSpeed, '还没生效').toBe(1);
    expect(panelStatsAt(grouped, 1, 20)!.attackSpeed, '刚生效').toBeCloseTo(1.5);
    expect(panelStatsAt(grouped, 1, 219)!.attackSpeed, '生效期间').toBeCloseTo(1.5);
    expect(panelStatsAt(grouped, 1, 220)!.attackSpeed, '到期后回落').toBe(1);
    expect(panelStatsAt(grouped, 1, 500)!.attackSpeed, '之后一直保持').toBe(1);
  });

  it('★ 往回拖（seek）也要取对：不能用"一直往前"的指针', () => {
    const samples = [sample(0, 1), sample(20, 1, { attackSpeed: 1500 }), sample(220, 1)];
    expect(statsSampleAt(samples, 900).t, '先跳到很后面').toBe(220);
    expect(statsSampleAt(samples, 30).t, '再拖回来必须回到 20 那条').toBe(20);
    expect(statsSampleAt(samples, 0).t).toBe(0);
    expect(statsSampleAt(samples, -5).t, '拖到负数也安全').toBe(0);
  });

  it('减益（负数）也能显示：护甲掉了、攻速降了', () => {
    const grouped = groupStatsTimeline([
      sample(0, 1001, { attackSpeed: 1000, armor: 50 * FIX }),
      sample(30, 1001, { attackSpeed: 700, armor: 30 * FIX }),
    ]);
    const panel = panelStatsAt(grouped, 1001, 30)!;
    expect(panel.armor).toBe(30);
    expect(panel.attackSpeed).toBeCloseTo(0.7);
    expect(panel.bonusSpeedBp, '降了就是负数（界面标 ▼）').toBe(-3000);
    expect(panel.bonusDamageBp).toBe(0);
  });

  it('没有这枚棋子的采样时返回 null（调用方退回老算法）', () => {
    const grouped = groupStatsTimeline([sample(0, 1)]);
    expect(panelStatsAt(grouped, 999, 0)).toBeNull();
    expect(panelStatsAt(groupStatsTimeline(undefined), 1, 0)).toBeNull();
  });
});

// ============================================================
//  ★ 0.1.1：「当前效果」走的是**同一条采样**（不是从事件日志反推）
// ============================================================
//
// 【为什么不能读事件日志？】
// 日志只覆盖"护盾 / 眩晕 / 攻速 / 闪避 / 伤害"这几种（而且很多是"发生了一次"，
// 不是"现在正生效"）。隐匿 / 无敌 / 免死 / 流血 / 飞行这些**根本不进日志** ——
// 靠日志反推的话，界面上永远看不到它们。
// 所以内核在采属性时**顺手**把效果也采下来（`BattleStatsSample.effects`），
// 界面只做一件事：按时间线取值 + 把倒计时往下扣。
describe('★ 战斗中的「当前效果」（effectsAt）', () => {
  it('效果被带出来了（名字/图标来自 shared 的效果注册表）', () => {
    const grouped = groupStatsTimeline([
      sample(0, 1),
      sample(20, 1, { effects: [{ kind: 'invincible' }, { kind: 'taunt' }] }),
    ]);
    const list = effectsAt(grouped, 1, 20);
    expect(list.map((effect) => effect.kind)).toEqual(['invincible', 'taunt']);
    expect(list[0]!.name, '名字来自 EFFECT_DEFS').toBe('无敌');
    expect(list[1]!.detail, '没写 detail 就不该凭空造一个').toBeUndefined();
  });

  it('★ 剩余时间要"从采样时刻往下扣"（播放器可以往回拖）', () => {
    const grouped = groupStatsTimeline([
      sample(0, 1),
      sample(20, 1, { effects: [{ kind: 'stun', ticksLeft: 60 }] }),
    ]);
    expect(effectsAt(grouped, 1, 20)[0]!.duration).toEqual({ kind: 'time', ticksLeft: 60 });
    expect(effectsAt(grouped, 1, 40)[0]!.duration, '又过了 20 tick').toEqual({ kind: 'time', ticksLeft: 40 });
    expect(effectsAt(grouped, 1, 20)[0]!.duration, '拖回去还是 60').toEqual({ kind: 'time', ticksLeft: 60 });
  });

  /*
    ★★ 0.1.3：按**次数**的效果（"接下来 6 次攻击 +1000%"）**不能**往下扣 ——
    次数只在攻击那一刻 -1，跟"过了多少秒"没有关系。
    内核在次数变化时会补一条采样（见 rules.ts 的 effectKey），
    所以界面直接读最新那条采样里的次数就是准的。
  */
  it('★★ 按次数的效果不随时间走：直接读最新采样里的次数', () => {
    const grouped = groupStatsTimeline([
      sample(0, 1),
      sample(20, 1, { effects: [{ kind: 'buff', detail: '攻击力 +1000%', countLeft: 6 }] }),
      sample(60, 1, { effects: [{ kind: 'buff', detail: '攻击力 +1000%', countLeft: 4 }] }),
    ]);
    expect(effectsAt(grouped, 1, 20)[0]!.duration).toEqual({ kind: 'count', left: 6 });
    expect(effectsAt(grouped, 1, 59)[0]!.duration, '时间在走，次数不动').toEqual({ kind: 'count', left: 6 });
    expect(effectsAt(grouped, 1, 60)[0]!.duration, '新采样里次数变成 4 了').toEqual({ kind: 'count', left: 4 });
  });

  it('★ 到期就消失（内核下一条采样会去掉它，中间这段靠界面自己收）', () => {
    const grouped = groupStatsTimeline([
      sample(0, 1),
      sample(20, 1, { effects: [{ kind: 'stun', ticksLeft: 60 }] }),
    ]);
    expect(effectsAt(grouped, 1, 79)).toHaveLength(1);
    expect(effectsAt(grouped, 1, 80), '正好到期').toHaveLength(0);
    expect(effectsAt(grouped, 1, 500)).toHaveLength(0);
  });

  it('没有采样 / 认不出的 kind 都不会崩', () => {
    expect(effectsAt(groupStatsTimeline(undefined), 1, 0)).toEqual([]);
    const grouped = groupStatsTimeline([sample(0, 1, { effects: [{ kind: '不存在的效果' }] })]);
    expect(effectsAt(grouped, 1, 0)).toEqual([]);
  });
});
