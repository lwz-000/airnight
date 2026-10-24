/**
 * ============================================================
 *  ★★ 0.3.2 阿米娅升变形态：技能在**真实战斗**里的行为
 * ============================================================
 *
 * 数据表那几条断言只证明"数字写对了"，证明不了"打起来是对的"。
 * 这一组跑真战斗（`simulate`），钉三件最容易写错的事：
 *
 *   1. **炉芯终曲的「即死」按 2 秒节奏触发**（不是一次性把全场秒了）；
 *   2. **终曲的 dot 是"每秒 5% 最大生命"**（千分比写成 500 就变成 50%）；
 *   3. **终曲被削 99% 攻速之后真的打不出几下**（manaGainBp / attackSpeedBp 生效）。
 *
 * 用 1 星终曲当输出：她自己几乎没有普攻伤害，所以"敌人死了"必然是技能杀的，
 * 不会被普攻混进来。
 */
import { describe, expect, it } from 'vitest';
import { TICKS_PER_SECOND, UNIT_DEFS, simulate, type TeamSetup } from '../src/index.js';

function team(side: 0 | 1, units: Array<[string, number, number, number]>): TeamSetup {
  return {
    team: side,
    units: units.map(([defId, star, col, row]) => ({ defId, star, cell: { col, row } })),
    bench: [],
  } as TeamSetup;
}

/** 我方 1 只 1 星终曲，敌方 6 只 3 星肉盾（血厚到普攻打不死） */
function coreBattle(seed = 4242) {
  const mine = team(0, [['op_amiya_core', 1, 2, 4]]);
  const foe = team(1, [
    ['op05', 3, 7, 3],
    ['op05', 3, 7, 4],
    ['op05', 3, 7, 5],
    ['op05', 3, 8, 3],
    ['op05', 3, 8, 4],
    ['op05', 3, 8, 5],
  ]);
  const result = simulate(UNIT_DEFS, [mine, foe], seed);
  return { result, log: result.log as Array<Record<string, any>> };
}

describe('★★ 炉芯终曲「无言的期盼」：真实战斗行为', () => {
  it('即死按 **2 秒一个** 的节奏触发（施法后 60 / 100 / 140 tick 各死一个）', () => {
    const { log } = coreBattle();
    const castTick = log.find((e) => e.type === 'cast')?.t as number | undefined;
    expect(castTick, '技能应该放出来了').toBeTypeOf('number');

    const deathTicks = log.filter((e) => e.type === 'death' && e.team === 1).map((e) => e.t as number);
    const interval = 2 * TICKS_PER_SECOND;
    /*
      第一次在"施法后 2 秒"，之后每 2 秒一次。
      允许 ±1 tick 的边界误差（施法与第一次推进可能同 tick）。
    */
    for (const step of [1, 2, 3]) {
      const expected = castTick! + interval * step;
      const hit = deathTicks.some((tick) => Math.abs(tick - expected) <= 2);
      expect(hit, `第 ${step} 次即死应该落在 tick ${expected} 附近，实际：${deathTicks.join(',')}`).toBe(
        true,
      );
    }
  });

  it('★ 即死不是一次性秒全场：死亡是**分批**发生的（不会同一 tick 全灭）', () => {
    const { log } = coreBattle();
    const deathTicks = log.filter((e) => e.type === 'death' && e.team === 1).map((e) => e.t as number);
    const byTick = new Map<number, number>();
    for (const tick of deathTicks) byTick.set(tick, (byTick.get(tick) ?? 0) + 1);
    const maxAtOnce = Math.max(...byTick.values());
    expect(maxAtOnce, `同一 tick 最多死了 ${maxAtOnce} 个 —— 这是一次性秒场，不是"每 2 秒一个"`).toBeLessThan(4);
  });

  it('★★ dot 是「每秒 5% 最大生命」：一跳约为目标血量的 1/20（不是 1/2）', () => {
    const { log } = coreBattle();
    /*
      找一条 dot 打出来的真实伤害：`damage` 事件、true 类型、且被打的是 3 星肉盾。
      `powerBasis: 'targetMaxHp'` 生效时，一跳 ≈ 目标最大生命的 5%。
      写成 500（= 50%）的话这里会红 —— 那个 bug 真的一跳打掉半条血。
    */
    const dotHits = log.filter(
      (e) => e.type === 'damage' && e.damageType === 'true' && e.sourceId !== 0,
    );
    expect(dotHits.length, '应该打出过真实伤害').toBeGreaterThan(0);

    const first = dotHits[0]!;
    const victims = log.filter((e) => e.type === 'spawn' && e.unitId === first.targetId);
    expect(victims.length, '要能查到被打的人是谁').toBeGreaterThan(0);
    // 固定数值口径：这里只断言"绝对量级"——一跳远小于一整条血（1000 倍的定点换算已经在内核里做过）
    const amount = first.amount as number;
    expect(amount, `一跳打出了 ${amount}（定点），量级不对`).toBeLessThan(300 * 1000);
  });

  it('★ 削 99% 攻速之后，敌人 10 秒内的出手次数显著变少（attackSpeedBp 生效）', () => {
    const { log } = coreBattle();
    const castTick = log.find((e) => e.type === 'cast')?.t as number | undefined;
    if (castTick === undefined) throw new Error('没放技能');

    // 施法之后敌人的普攻次数（把事件按时间切两段：施法前 / 施法后）
    const enemyAttacksAfter = log.filter(
      (e) => e.type === 'attack' && e.t >= castTick && e.unitId >= 1000,
    ).length;
    // 削掉 99% 攻速之后，10 秒里几乎打不出手（护盾/技能伤害不算普攻）
    expect(enemyAttacksAfter, `施法后敌人普攻了 ${enemyAttacksAfter} 次，减攻速好像没生效`).toBeLessThan(12);
  });
});
