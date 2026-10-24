/**
 * ★ 0.1.3：「这个效果怎么消耗」—— 技能 / 藏品效果的**持续口径**。
 *
 * ============================================================
 *  为什么要有这个文件？
 * ============================================================
 * 在这之前，"这个效果能持续多久"这件事**散在三处**，而且只能靠
 * "写没写某个字段"去猜：
 *   · `durationTicks` —— 按时间（几秒）
 *   · `attacks`       —— 按攻击次数（"接下来 N 次攻击"）
 *   · 都不写          —— 整场永久
 *
 * 后果有两个：
 *   1. **界面认不出来**。详情页以前把所有临时增益合并成一条笼统的「增益」，
 *      而次数型的包时长记的是"整场"，于是会显示出一个**没意义的剩余秒数** ——
 *      "接下来 6 次攻击 +1000%" 变成了"剩 75.0 秒"，玩家根本读不懂。
 *   2. **加新方式要改好几处**（数据字段、内核消费、界面判断各写一遍）。
 *
 * 现在把"怎么消耗"抽成一个显式概念，**只在这里实现一次**：
 *   · 内核采样、界面详情页、以后卡面上的倒计时，全部读同一组函数；
 *   · 以后想加"按击杀数""按回合数"之类，只加一个 `kind` 分支 + 一个显示分支。
 *
 * ============================================================
 *  ★ 这一版**不改数据格式、也不改战斗行为**
 * ============================================================
 * 下面的函数只是把老字段（`durationTicks` / `attacks`）**读出来归类**，
 * 老数据一个字节都不用动，战斗内核算出来的结果也完全一样。
 */
import { MAX_BATTLE_TICKS, TICKS_PER_SECOND } from './constants.js';
import { starValue } from './mods.js';
import type { StarValue } from './types.js';

/**
 * 一个效果"怎么消耗"。
 *
 * - `time`      按时间走：还剩多少 tick（界面显示成秒）
 * - `count`     按次数走：还剩几次（"接下来 N 次攻击"、"免疫 N 次攻击"）
 * - `permanent` 整场都在（被动、永久叠层）
 * - `instant`   一次性结算，没有"剩余"可言（伤害、治疗、召唤、瞬移…）
 */
export type EffectDuration =
  | { kind: 'time'; ticksLeft: number }
  | { kind: 'count'; left: number }
  | { kind: 'permanent' }
  | { kind: 'instant' };

/**
 * 一条"挂着的修正包"里和持续时间有关的字段（对应 `types.ts` 的 `TimedBuff`）。
 * 单独抽出来是为了让本文件不依赖 `types.ts`（那是个大文件，容易绕出循环依赖）。
 */
export interface DurationCarrier {
  /** 还剩多少 tick；`MAX_BATTLE_TICKS` = 整场 */
  ticksLeft: number;
  /** 按**攻击次数**消耗（有值时 `ticksLeft` 只是占位，真正的寿命看它） */
  attackCharges?: number;
  /** 常驻（被动挂上来的，不算"正在生效的状态"） */
  passive?: boolean;
}

/**
 * 一条**正挂在棋子身上**的修正包怎么消耗。
 *
 * ★ 判据顺序就是优先级，不能换：
 *   次数 > 被动 > 整场 > 按时间。
 *   因为次数型的包（"接下来 6 次攻击"）时长记的就是 `MAX_BATTLE_TICKS`，
 *   不先判次数就会被误认成"整场"（这正是以前详情页显示错的原因）。
 */
export function buffDurationOf(buff: DurationCarrier): EffectDuration {
  if (buff.attackCharges !== undefined) {
    return { kind: 'count', left: Math.max(0, buff.attackCharges) };
  }
  if (buff.passive) return { kind: 'permanent' };
  if (buff.ticksLeft >= MAX_BATTLE_TICKS) return { kind: 'permanent' };
  return { kind: 'time', ticksLeft: Math.max(0, buff.ticksLeft) };
}

/**
 * 一条**技能效果定义**怎么消耗（还没有挂到人身上的时候）。
 *
 * 现在读它的是**卡面技能条**（`apps/web/src/three/skill-bar.ts`）：
 * "这个技能是持续 10 秒 / 接下来 5 次攻击"，读的就是这个函数。
 * 之前详情页各写一套判断，现在统一到这里。
 *
 * ★ 0.2：`durationTicks` 允许写成**星级数组**（`[70, 100]` ⇒ 1/2 星各持续几秒），
 *   所以这里必须传 `star` 才能定死数值 —— 默认 1 星，与 `starValue` 口径一致。
 */
export function effectDurationOf(
  effect: { durationTicks?: StarValue; attacks?: StarValue },
  star = 1,
): EffectDuration {
  // ★ 0.3.2：`attacks` 也允许按星级（阿米娅·青色怒火 10/15/20 发弹药）
  if (effect.attacks !== undefined) {
    return { kind: 'count', left: Math.max(1, starValue(effect.attacks, star)) };
  }
  if (effect.durationTicks !== undefined) {
    const ticks = starValue(effect.durationTicks, star);
    return ticks >= MAX_BATTLE_TICKS
      ? { kind: 'permanent' }
      : { kind: 'time', ticksLeft: ticks };
  }
  // 伤害 / 治疗 / 召唤 / 瞬移这类没有"持续"字段 —— 结算完就没了
  return { kind: 'instant' };
}

/**
 * 把"怎么消耗"渲染成给人看的一小段字。
 *
 * ★ 界面上所有"剩余时间 / 剩余次数"的写法**只在这里**，别再各写各的
 *   （详情页、以后的卡面、备战席悬停卡都读它）。
 *   `instant` 没有"剩余"可言，返回空串（调用方直接不显示那一行）。
 */
export function durationText(duration: EffectDuration): string {
  switch (duration.kind) {
    case 'time':
      return `剩 ${(duration.ticksLeft / TICKS_PER_SECOND).toFixed(1)} 秒`;
    case 'count':
      return `剩 ${duration.left} 次`;
    case 'permanent':
      return '整场';
    case 'instant':
      return '';
  }
}
