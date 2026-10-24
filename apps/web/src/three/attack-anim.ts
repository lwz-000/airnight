/**
 * ============================================================
 *  攻击 / 技能动画的节奏（0.0.3 末）—— "动画跟着攻速走"
 * ============================================================
 *
 * 【要解决什么？】
 * 以前小人只有"出手"那一瞬间会切到攻击动作，窗口固定 0.18 秒，
 * 而且动画速度和**面板白板攻速**挂钩 —— 于是：
 *   · 攻速被 buff/狂暴改快了，画面看不出来（只用静态白板算）；
 *   · 更糟的是**时机对不上**：内核在"伤害结算的那一 tick"发 attack 事件，
 *     小人**那时候才开始挥**，命中帧永远晚于掉血帧。
 *
 * 【现在的口径】
 *   1. 倍率 = 当前有效攻速 / 白板攻速（实时，含 buff / 羁绊 / 狂暴），
 *      并夹在上下限内 —— 攻速再快也不会抽成幻灯片、再慢也不会变成慢动作；
 *   2. **整段挥击的时长 = 当前攻击间隔**：一次攻击一个动作循环，
 *      节奏天然和攻击频率一致（上下限生效时会有少量余量，见下）；
 *   3. **提前起手**：在预测的下一次命中前 `前摇` 秒开始播，
 *      这样"命中帧"正好落在内核结算伤害的那一 tick 上；
 *   4. 倍率按帧**平滑**逼近目标（约 0.2 秒），攻速突变（比如 40 秒狂暴）
 *      不会让动作"啪"地跳一下。
 *
 * 【为什么单独一个模块？】
 * 这些全是纯计算，放 replay.ts 里就只能靠"看"来验证；
 * 抽出来之后可以直接断言"命中帧 = 伤害帧""间隔匹配""上下限生效"。
 */
import { TICKS_PER_SECOND, attackInterval } from '../../../../packages/shared/src/index.js';

/**
 * 攻速 → 攻击间隔（秒）。
 *
 * ★ 必须走内核的 `attackInterval()`，不要自己写 1/攻速 ——
 * 内核是 `ceil(24000 / 攻速) / 20` 秒（1200 = 每秒 1 下），
 * 写错了就会出现"动画比攻击快一点点"的慢性脱节（看不出来但一直错位）。
 */
export function attackIntervalSeconds(attackSpeed: number): number {
  return attackInterval(attackSpeed) / TICKS_PER_SECOND;
}

/** 攻速倍率的上下限：0.6 = 最多慢到六成（再慢就成了慢动作） */
export const ATTACK_ANIM_MIN_RATIO = 0.6;
/** 上限 4 倍：再快就只是一团残影，反而看不清在打人 */
export const ATTACK_ANIM_MAX_RATIO = 4;

/** 技能动作温和一些：技能动作本来就长，极端倍率会让它"闪一下就没了" */
export const SKILL_ANIM_MIN_RATIO = 0.8;
export const SKILL_ANIM_MAX_RATIO = 2.5;

/**
 * ★ 命中帧在整套攻击动作里的位置（0.45 = 45% 处）。
 *
 * 【这个数是怎么来的？】
 * 素材是从游戏里导出的骨骼动画，没有"哪一帧是命中"的元信息，
 * 所以按经验取中段偏前：前摇 -> **命中** -> 收招。
 * 想让手感更"重"就调大（命中更晚）、更"快"就调小 —— 只改这一个数，
 * 前摇时长、起手时刻、命中时机全都跟着变。
 */
export const SWING_HIT_RATIO = 0.45;

/** 倍率平滑的时间常数（秒）：越小越"立刻"，越大越顺滑 */
export const ANIM_SPEED_SMOOTH_SECONDS = 0.15;

/**
 * ★ 挥击倒计时的"归零阈值"（秒，1 毫秒）。
 *
 * 【为什么必须有它？】
 * 倒计时原来是 `Math.max(0, swing - dt)`：**只有当减法结果为负才会变成 0**。
 * 60 帧下 dt ≈ 0.016667，一个 1.0 秒的窗口经常刚好减到 0.0003 这种尾巴上 ——
 * 于是"这一帧挥完了"变成了"还剩 0.3 毫秒"，而下面两处都只认 `swing <= 0`：
 *   · `stepSwing` 的预测起手
 *   · `noteHit`（真实命中）的兜底补一次
 * 两条路同时被挡，这一拍就**完全排不上挥击窗口** —— 攻击动作整拍不播。
 * 要是这一拍又刚好错开下一次命中的预测点，就会连着半秒以上没有任何出手动作，
 * 表现就是用户报的"**攻击若干次后动画失效**"（间歇性、越来越频繁）。
 *
 * 归零阈值取 1 毫秒：远小于任何一帧，又足够吃掉浮点误差。
 */
export const SWING_EPS = 1e-3;

/** 把倍率夹进上下限 */
export function clampRatio(ratio: number, min: number, max: number): number {
  if (!Number.isFinite(ratio) || ratio <= 0) return min;
  return Math.max(min, Math.min(max, ratio));
}

/**
 * 攻击动作该放多快。
 *
 * @param currentAttackSpeed 当前**有效**攻速（内核刻度：1200 = 每秒 1 下）
 * @param baseAttackSpeed    白板攻速（数据表 def.base.attackSpeed）
 * @param naturalSeconds     这套动作的自然时长（帧数 / fps）
 * @param intervalSeconds    当前攻击间隔（秒）
 *
 * 【为什么还要乘 naturalSeconds / baseInterval？】
 * "倍率 = 当前/白板"回答了"快了几倍"，但没回答"这套动作本来多长"。
 * 乘上 `naturalSeconds / attackIntervalSeconds(baseAttackSpeed)`，
 * 就等于让**整段挥击的时长 = 当前攻击间隔** —— 一次攻击一个动作循环，
 * 节奏和攻击频率严丝合缝（这正是验收要的"动画与攻击间隔匹配"）。
 */
export function attackAnimSpeed(opts: {
  currentAttackSpeed: number;
  baseAttackSpeed: number;
  naturalSeconds: number;
}): number {
  const base = Math.max(1, opts.baseAttackSpeed);
  const ratio = clampRatio(opts.currentAttackSpeed / base, ATTACK_ANIM_MIN_RATIO, ATTACK_ANIM_MAX_RATIO);
  /*
    ★ 先夹攻速、再按内核公式换算间隔 —— 而不是"倍率 × 自然时长/基础间隔"。
    因为内核的间隔是 `ceil(24000 / 攻速)` 个 tick（**阶跃**的，不是连续函数），
    直接乘倍率会有最多 1 tick（0.05 秒）的偏差：1800 攻速下就有 5%，
    表现上就是"动画总是比攻击快一点点"的慢性错位。
    从夹紧后的攻速重新求间隔，就能保证**正常区间内挥击时长 = 攻击间隔**（严格相等）。
  */
  const interval = attackIntervalSeconds(base * ratio);
  if (!Number.isFinite(interval) || interval <= 0) return 1;
  return opts.naturalSeconds / interval;
}

/** 技能动作的倍率：同样跟着攻速走，但夹得更紧（技能动作本来就长） */
export function skillAnimSpeed(currentAttackSpeed: number, baseAttackSpeed: number): number {
  return clampRatio(
    currentAttackSpeed / Math.max(1, baseAttackSpeed),
    SKILL_ANIM_MIN_RATIO,
    SKILL_ANIM_MAX_RATIO,
  );
}

/** 从"起手"到"命中帧"要多久（秒）—— 预测起手用的就是这个偏移 */
export function swingWindupSeconds(naturalSeconds: number, speed: number): number {
  return (naturalSeconds * SWING_HIT_RATIO) / Math.max(0.05, speed);
}

/**
 * ★ 命中时"手上没动作"要补的那一段有多长：**本拍剩下的部分**。
 *
 * 【为什么不是补一整段（duration）？】
 * 因为一整段是"从起手到收招"的完整循环，而命中这一刻已经处在循环的
 * SWING_HIT_RATIO 位置上了 —— 再补一整段，相位就整体晚了一截：
 * 之后的每一拍都会变成"命中刚好落在动作开头"（挥出去的那一下永远慢半拍）。
 *
 * 补"剩下的 55%"（1 - 0.45）之后，这一拍结束时正好是"下一拍的起手点"
 * （窗口首尾相接），从第二拍开始命中就稳稳落在动作的 45% 处 ——
 * 也就是"命中帧 = 伤害帧"这条要求。
 *
 * 表现上：每场战斗的**第一下**动作会短一截（缺了前摇），之后完全正常。
 * 这是拿不到"未来"的必然代价（没法让时间倒回去提前 45% 起手）。
 */
export function catchUpSwingSeconds(durationSeconds: number): number {
  return durationSeconds * (1 - SWING_HIT_RATIO);
}

/** 整套动作在当前倍率下要播多久（秒） */
export function swingDurationSeconds(naturalSeconds: number, speed: number): number {
  return naturalSeconds / Math.max(0.05, speed);
}

/** 倍率平滑：按时间常数向目标逼近（帧率无关的指数逼近） */
export function smoothSpeed(current: number, target: number, deltaSeconds: number, tau = ANIM_SPEED_SMOOTH_SECONDS): number {
  if (!Number.isFinite(current) || current <= 0) return target;
  if (tau <= 0) return target;
  const k = 1 - Math.exp(-Math.max(0, deltaSeconds) / tau);
  return current + (target - current) * k;
}

/**
 * 一只棋子的挥击排程（replay 每帧拿着它推进一步）。
 *
 * `swing > 0` = 现在正在演攻击动作。它由两件事驱动：
 *   · **预测起手**：下一次命中前 `windup` 秒自动开始（命中帧才会对上掉血帧）；
 *   · **真实命中**：attack 事件到达时兜底（预测失手/第一次出手时也要有动作）。
 */
export interface SwingTiming {
  /** 当前这次挥击还剩多久（秒），0 = 没在挥 */
  swing: number;
  /** 预测的下一次命中时刻（replay 内部时间，秒） */
  nextHitAt: number;
  /** 上一次**真实**命中时刻（-1 = 还没出过手） */
  lastHitAt: number;
  /** 当前平滑后的播放倍率 */
  speed: number;
}

export function createSwingTiming(): SwingTiming {
  return { swing: 0, nextHitAt: 0, lastHitAt: -1, speed: 1 };
}

/** 记一次真实命中（attack 事件）：对齐节奏，并预测下一次 */
export function noteHit(
  timing: SwingTiming,
  now: number,
  intervalSeconds: number,
  durationSeconds: number,
): SwingTiming {
  const interval = Number.isFinite(intervalSeconds) && intervalSeconds > 0 ? intervalSeconds : 1;
  return {
    ...timing,
    lastHitAt: now,
    nextHitAt: now + interval,
    /*
      命中时若手上没有动作（预测没赶上/这是第一次出手），立刻补一次，别"打了没动作"。
      ★ 补的是"本拍剩下的 45%~55% 那一段"，不是一整段 —— 原因见 catchUpSwingSeconds：
        补整段会让相位整体晚一截，之后就永远"命中落在动作开头"了。
      ★ 判断用的是 SWING_EPS 而不是 0：见 SWING_EPS 的说明 ——
        留一个 0.3 毫秒的尾巴会让这一拍被当成"还在挥"，结果整拍没有出手动作。
      手上确实还有动作时不打断（否则就成了"动作突变"）。
    */
    swing: timing.swing > SWING_EPS ? timing.swing : catchUpSwingSeconds(durationSeconds),
  };
}

/**
 * 推进一帧。
 *
 * @param enabled 这只棋子**现在会不会出手**（不攻击的单位不预测，免得空挥）
 */
export function stepSwing(
  timing: SwingTiming,
  opts: {
    now: number;
    deltaSeconds: number;
    naturalSeconds: number;
    targetSpeed: number;
    intervalSeconds: number;
    enabled: boolean;
  },
): SwingTiming & { windup: number; duration: number } {
  const speed = smoothSpeed(timing.speed, opts.targetSpeed, opts.deltaSeconds);
  const duration = swingDurationSeconds(opts.naturalSeconds, speed);
  const windup = swingWindupSeconds(opts.naturalSeconds, speed);
  /*
    ★ 这一帧"正好挥完"就**干脆归零**，别留 1e-4 的尾巴（原因见 SWING_EPS）。
  */
  let swing = timing.swing - opts.deltaSeconds;
  if (swing <= SWING_EPS) swing = 0;

  /*
    只有"这只棋子确实会出手"时才预测起手：
      · `enabled`（不攻击的干员/阶段直接排除）；
      · 已经出过至少一次手（`lastHitAt >= 0`）—— 开局第一拍先用真实事件兜底，
        免得对着一只还没进射程的单位空挥；
      · 节奏没断（最近 3 个间隔内出过手）—— 被眩晕/走位打断后就别再空挥，
        等下一次真实命中重新校准。

    ★★ 0.0.3 修正：**窗口首尾相接**，不再用 `nextHitAt - windup` 去卡起手时刻。
    【为什么？—— 用户报的"野怪攻击若干次后攻击动画失效"的真凶】
    挥击窗口的时长**恰好等于攻击间隔**（"一次攻击一个动作循环"），所以稳态下
    "上一段挥完"和"下一拍该起手"是同一个时刻。但内核的命中事件和渲染帧不是同一套时钟：
    命中往往落在窗口结束的**同一帧**（差一帧以内），而 `noteHit` 会把 `nextHitAt`
    推到"下下次命中"—— 于是这一帧里 `now >= nextHitAt - windup` 立刻变成**假**，
    预测起手被挡掉，**整拍没有出手动作**（画面表现为"打着打着动作没了"，
    而且因为帧对齐的漂移，发作时机没有规律 —— 正是用户描述的"若干次之后"）。

    改成"只要还在节奏里（3 个间隔内出过手），上一段挥完就立刻接上下一段"：
      · 命中帧依然落在窗口的 SWING_HIT_RATIO 处（窗口恒等于间隔，相位不会漂）；
      · 少了 `nextHitAt` 这个"会被同一帧刷新"的中间量，就没有了那种同帧自锁。

    `nextHitAt` 仍然被记录（`noteHit` 里维护），但只作为"节奏是否还活着"的参考，
    不再参与"这一帧该不该起手"的判断。
  */
  const interval = Number.isFinite(opts.intervalSeconds) && opts.intervalSeconds > 0 ? opts.intervalSeconds : 1;
  const rhythmAlive = timing.lastHitAt >= 0 && opts.now <= timing.lastHitAt + interval * 3 + 0.05;
  if (opts.enabled && rhythmAlive && swing <= 0) {
    swing = duration;
  }

  return { ...timing, speed, swing, windup, duration };
}
