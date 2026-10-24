/**
 * ============================================================
 *  走路的表现参数（★ 0.0.3）
 * ============================================================
 *
 * 【为什么要有这个文件？】
 * 和 `attack-anim.ts` 同一个理由：**"移动怎么演"只允许有一处实现**，
 * 而且那一处要能被单测钉住（replay.ts 里全是 three.js 对象，测不动）。
 * 所以这里只放纯数学：时长、起伏曲线、方向符号，一行 three 都不引入。
 *
 * 【要解决的两个问题】
 *
 * ① 走路一顿一顿（玩家报的"移动不够平滑"）
 *    内核走一格要等 `MOVE_COOLDOWN_TICKS = 8` 个 tick（20 tick/秒 ⇒ 0.4 秒），
 *    而画面上的滑行原来只有 0.18 秒 ⇒ 每格都是"滑 0.18 秒 + 干站 0.22 秒"。
 *    现在滑行时长直接取**内核的移动周期**，滑完那一瞬间下一格刚好开始，
 *    连续走位就拼成一条匀速直线。用**线性**而不是缓动，理由也在下面。
 *
 * ② 干员没有走路素材
 *    官方战斗小人的骨架里只有 Idle / Attack / Skill / Die / Start
 *    （实测 fexli/ArknightsResource 与 Aceship/Arknight-Images 两个仓库都一样），
 *    带 Move 的只有**基建版**模型，而基建模型有的人物连武器都不一样
 *    （op01 空爆的枪会消失）—— 那是比"动作不够花哨"严重得多的观感问题。
 *    所以没有走路素材的单位改走**程序化走姿**：颠一步 + 顶一下 + 微微前倾。
 *    野怪那边有真素材（Move / Move_Loop / C1_Move…），原样播就行。
 *
 * 【瞬移不受影响】
 * 用户明确要求过"瞬移不用改"。强制位移（瞬移 / 击退 / 开局站位）在日志里带
 * `instant: true`，它走 `MOVE_LERP_SECONDS`（0.18 秒的 easeOutQuad，和以前一模一样），
 * 也**不播**走路动作 / 程序化走姿。
 */

import { MOVE_COOLDOWN_TICKS, TICKS_PER_SECOND } from '../../../../packages/shared/src/index.js';

/**
 * 强制位移（瞬移 / 击退）的归位时长（秒）—— **0.0.3 一个字都没改**。
 * 瞬移的表现是玩家已经认可的效果，改动它属于"顺手改坏"。
 */
export const MOVE_LERP_SECONDS = 0.18;

/**
 * 走一格要滑多久（秒）= 内核的移动周期。
 *
 * 【为什么不写死 0.4？】
 * 因为"走一格等几个 tick"是内核说了算的（`MOVE_COOLDOWN_TICKS`）。
 * 写死的话，哪天内核把移动调快一点，画面就又变成"滑完还站着等"。
 */
export const WALK_STEP_SECONDS = MOVE_COOLDOWN_TICKS / TICKS_PER_SECOND;

/** 走路时"颠一步"的高度（世界单位）。卡片中心高度 0.42，这个量级有弹性又不飘 */
export const WALK_HOP_HEIGHT = 0.055;

/** 走路时朝前进方向"顶一下"的幅度（世界单位），一个格子两拍（迈、迈） */
export const WALK_STEP_PUSH = 0.035;

/** 走路时朝前进方向的**前倾**（弧度）。约 2.6°，够表达"在使劲走"又不至于像要摔倒 */
export const WALK_LEAN_RAD = 0.045;

/** 这次位移该滑多久：走路 = 内核周期；强制位移 = 原来那 0.18 秒 */
export function stepSecondsFor(instant: boolean): number {
  return instant ? MOVE_LERP_SECONDS : WALK_STEP_SECONDS;
}

/**
 * 位移进度曲线。
 *
 * 【走路为什么用线性？】
 * 因为一格的滑行是**首尾相接**的：上一格滑到尽头的那一瞬间，下一格刚好开始。
 * 用缓动的话每一格的末尾都会减速到 0，连续走位就变成"一顿一顿地挪"——
 * 那正是玩家报的那个毛病的另一种样子。
 *
 * 【强制位移为什么保持 easeOutQuad？】
 * 它就是"嗖地过去、轻轻收住"的手感，而且原来就是这么写的 —— 不动它。
 */
export function walkEase(instant: boolean, progress: number): number {
  const t = Math.max(0, Math.min(1, progress));
  return instant ? 1 - (1 - t) ** 2 : t;
}

/**
 * 程序化走姿：给定"这一格走到几分之几"，返回精灵该加多少偏移。
 *
 * 三个量都随进度自然归零（t=0 与 t=1 时全是 0）——
 * 所以走到站的那一帧，小人正好回到基准位置，不需要任何收尾代码。
 *
 * @param t     这一格的进度 0..1
 * @param dirX  前进方向在**画面**上的符号（+1 向右 / -1 向左 / 0 竖直走）；
 *              联机镜像时调用方已经翻过了，这里只管用
 */
export function walkPose(t: number, dirX: number): { hop: number; push: number; lean: number } {
  const p = Math.max(0, Math.min(1, t));
  return {
    // 颠一步：离地再落地（sin 半周期 → 两端都是 0）
    hop: Math.sin(p * Math.PI) * WALK_HOP_HEIGHT,
    // 迈步的推挤：一个格子两拍（sin 整周期 → 两端都是 0，中间来回一次）
    push: Math.sin(p * Math.PI * 2) * WALK_STEP_PUSH * dirX,
    // 前倾：只在移动的中段最明显，起步/到站都不歪
    lean: -dirX * WALK_LEAN_RAD * Math.sin(p * Math.PI),
  };
}

/** 往下一格推进一帧（返回新进度，上限 1）。deltaSeconds 已经乘过播放倍速 */
export function advanceStepProgress(progress: number, deltaSeconds: number, stepSeconds: number): number {
  if (progress >= 1) return 1;
  return Math.min(1, progress + deltaSeconds / Math.max(0.01, stepSeconds));
}
