/**
 * ============================================================
 *  ★ 0.1.3：布阵时长按回合给 —— 前 3 回合 30 秒，其余 60 秒
 * ============================================================
 *
 * 【为什么要把它抽成一个函数、并且两边都用它？】
 * 这件事有两个"消费者"：
 *   · 服务器：真的等这么多秒（`beginPrepPhase`）；
 *   · 客户端：界面提示"布阵 30 秒"（`onGameStarted` 的那句 message）。
 * 两边各写一遍 `round <= 3 ? 30 : 60`，迟早会走散 ——
 * 那时玩家看到的是"写着 30 秒、实际等 60 秒"，而且没人能一眼看出问题在哪。
 *
 * 所以规则放在 shared 里，这条测试把它钉死（改数值必须改这里，改不动的就知道影响面）。
 */
import { describe, expect, it } from 'vitest';
import { EARLY_PREP_SECONDS, EARLY_ROUND_COUNT, PREP_SECONDS, prepSecondsForRound } from '../src/index.js';

describe('★ 布阵时长：前 3 回合 30 秒，其余 60 秒', () => {
  it('常量本身是设计值（60 / 30 / 3）', () => {
    expect(PREP_SECONDS).toBe(60);
    expect(EARLY_PREP_SECONDS).toBe(30);
    expect(EARLY_ROUND_COUNT).toBe(3);
  });

  it('第 1~3 回合都是 30 秒', () => {
    expect(prepSecondsForRound(1)).toBe(EARLY_PREP_SECONDS);
    expect(prepSecondsForRound(2)).toBe(EARLY_PREP_SECONDS);
    expect(prepSecondsForRound(3)).toBe(EARLY_PREP_SECONDS);
  });

  it('第 4 回合开始恢复 60 秒（含野怪回合 8 / 15 这些）', () => {
    expect(prepSecondsForRound(4)).toBe(PREP_SECONDS);
    expect(prepSecondsForRound(8)).toBe(PREP_SECONDS);
    expect(prepSecondsForRound(15)).toBe(PREP_SECONDS);
    expect(prepSecondsForRound(99)).toBe(PREP_SECONDS);
  });
});
