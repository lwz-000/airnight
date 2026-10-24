/**
 * ============================================================
 *  ★★ 0.2.1：通用的「技能释放」特效（所有主动技能共用一套）
 * ============================================================
 *
 * 【它是什么？】
 * 干员放技能时脚下一圈**符文环**亮起来：起手收光 → 瞬间爆闪 + 四芒星 →
 * 持续期间环慢转、时不时推一道心跳环、身上挂一层背光 → 收尾散掉。
 *
 * 参考的是官方的做法 —— 技能开启**不是"爆炸"**，而是"先收、再亮、然后一直亮着、最后收干净"。
 * 一收一亮之间，玩家才听得懂"这一下是技能"（伤害另有攻击特效，职责分开）。
 *
 * ============================================================
 *  【一、尺寸：只比一个格子大一点】
 * ============================================================
 * 用户口径：「这个特效对比棋子有点大，尽量只比一个格子大一点就好」。
 *
 * 所以这里**唯一**的尺寸来源是 `CELL`（棋盘一格 = 1.0 世界单位）：
 *   · 符文环外径 = **1.18 格**（`SKILL_CAST_RING_DIAMETER_OVER_CELL`）
 *   · 地面柔光比环再大一圈（1.42 格），因为它是"渐变到 0"的，视觉边界更小
 *   · 星芒只有 0.9 格见方，光柱宽 1.5R
 * 和 `unit-aura.ts` 的 `AURA_SCALE_OVER_CELL = 1.05` 是同一套思路：
 * **按格子算，不按小人算** —— 模型偏大的干员不会得到更大的光斑。
 *
 * ============================================================
 *  【二、不发"光污染"：五条硬约束】
 * ============================================================
 *  1. **没有全屏闪白**。最亮的一层是脚下那圈环（纹理本身是细线），不是一张大黄圆。
 *  2. **峰值透明度写死在下面几个常量里**（`SIGIL_PEAK_ALPHA` 等），
 *     改大之前先想想"8 个人同时开技能"的画面。
 *  3. **星芒只存在 0.16 秒**（`SKILL_CAST_IMPACT_SECONDS`）—— 它是"标点"，不是常驻装饰。
 *  4. **持续段只剩环 + 背光 + 心跳环**，放射光条压到 0.1 出头。
 *  5. **同时在播的上限 `SKILL_CAST_MAX_LIVE = 8`**，超了丢最老的（和攻击特效同一条规矩）。
 *
 * ============================================================
 *  【三、时间：不给 t 就不画，自己不跑计时器】
 * ============================================================
 * `skillCastFrameAt(elapsed, sustainSeconds)` 是**纯函数**：
 * 给它"开场到现在过了多久"，它返回这一帧每一层该多亮、多快、转多少。
 * `replay.ts` 每帧把 delta 加上去再调它 —— 于是
 * "两倍速 / 断线重连从中间接上 / 看录像 / seek 往回拖"全都自动正确，
 * 和 `attack-fx.ts`、`slash-fx.ts` 一个口径。
 *
 * 【持续多久？】
 * 由**技能数据**决定（最长的那条 `durationTicks`，见 `skillCastSustainSecondsOf`）。
 * 纯伤害类技能（没有"持续"字段）⇒ 持续段 0 秒，只剩"起手 + 爆闪 + 收尾"，
 * 不会出现"打一下就冒出十几秒的光环"。
 */
import {
  AdditiveBlending,
  BufferGeometry,
  CanvasTexture,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  RingGeometry,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
} from 'three';
import {
  TICKS_PER_SECOND,
  effectDurationOf,
  type SkillEffect,
  type StarValue,
} from '../../../../packages/shared/src/index.js';
import { RENDER_ORDER_FX } from './card-layout.js';
import { CELL } from '../game/grid.js';

// ============================================================
//  常量（尺寸 / 时间 / 亮度）
// ============================================================

/**
 * 符文环的**外径**是几格。
 * 用户口径"只比一个格子大一点" ⇒ 1.18（一格宽 = 1.0）。
 * ★ 改这个数之前先想清楚：它不是"看起来差不多"，而是"和棋盘格子对齐的尺子"。
 */
export const SKILL_CAST_RING_DIAMETER_OVER_CELL = 1.18;

/** 起手（收光）时长：技能真正生效在 t=0，这个窗口要短，闪必须"就是那一刻" */
export const SKILL_CAST_CAST_SECONDS = 0.32;
/** 开启瞬间（白心 + 星芒 + 冲击环）的时长 —— 只有这么长，之后星芒就不许再亮 */
export const SKILL_CAST_IMPACT_SECONDS = 0.16;
/** 收尾时长（环散掉、光柱褪掉） */
export const SKILL_CAST_END_SECONDS = 0.55;
/** 持续期间"心跳环"的间隔（秒）；0 = 不要 */
export const SKILL_CAST_HEARTBEAT_SECONDS = 1.4;
/** 持续段最长多久（再长的技能也只挂这么久，防止一直有大光环晃） */
export const SKILL_CAST_MAX_SUSTAIN_SECONDS = 20;
/** 同时在播的上限 */
export const SKILL_CAST_MAX_LIVE = 8;

/** 主题色（深黄，和项目其它技能特效用的是同一族） */
export const SKILL_CAST_COLOR = 0xffd77a;
/** 星芒的中心（接近白，但留一点暖，避免加色之后发青） */
export const SKILL_CAST_CORE_COLOR = 0xfff2cf;

/* 峰值透明度：这是"光污染"的总闸门，别随手加大 */
/** 符文环最高多亮 */
export const SIGIL_PEAK_ALPHA = 0.92;
/** 地面柔光最高多亮（它面积大，必须比环暗） */
export const GLOW_PEAK_ALPHA = 0.34;
/** 放射光条最高多亮（细长条，稍微亮一点也不会糊） */
export const RAYS_PEAK_ALPHA = 0.30;
/** 星芒最高多亮（只 0.16 秒，可以亮） */
export const STAR_PEAK_ALPHA = 0.95;
/** 冲击环最高多亮 */
export const SHOCK_PEAK_ALPHA = 0.8;

/**
 * 贴图里"1 个世界半径"占画布边长的比例。
 *
 * 【为什么要有这个数？】
 * 贴图是 512×512 的正方形，我们把"环半径 = R"画在距中心 `RATIO × 512` 的地方。
 * 那么贴地平面的边长就必须是 `R / RATIO`（而不是 `2R`）——
 * 否则环会比预期小/大一截（`slash-fx.ts` 里踩过同样的坑）。
 */
export const SIGIL_TEX_RATIO = 0.47;

// ============================================================
//  一、纯函数：时间 → 这一帧长什么样
// ============================================================

export type SkillCastPhase = 'charge' | 'impact' | 'sustain' | 'release';

/** 符文环在世界里的半径（**唯一的尺寸出口**，外面不要再自己乘一遍） */
export function skillCastRingRadius(): number {
  return (CELL * SKILL_CAST_RING_DIAMETER_OVER_CELL) / 2;
}

/**
 * 从技能数据算"持续段该挂多久"。
 *
 * 取所有效果里**最长**的那条时长：
 *   · `durationTicks` → tick / 20 秒（这是绝大多数 buff 类技能）
 *   · `attacks`（弹药类）→ 不知道攻速，按每次 0.5 秒估一个，够用（它只影响环什么时候收）
 *   · 一条都没有（纯伤害/治疗/召唤）→ **0** ⇒ 不挂持续段
 *
 * ★ 为什么读数据而不是固定 3 秒？
 *   固定值会让 20 秒的变身类技能"光环先没了、状态还在"，
 *   也会让一下就打死的瞬发技能"光环赖着不走"——两头都不对。
 */
/** 只要"时长"这两个字段就够了（不让调用方为了调用它去拼一个完整 SkillEffect） */
export interface SkillCastDurationSource {
  /**
   * ★ 带上 `kind` 只是为了让 `SkillEffect[]` 能直接传进来（TS 的"弱类型"规则：
   * 全是可选字段的类型，必须至少有一个字段和目标类型重合，否则判定"没有共同点"）。
   */
  kind?: string;
  durationTicks?: StarValue;
  attacks?: StarValue;
}

export function skillCastSustainSecondsOf(
  effects: readonly SkillCastDurationSource[],
  star = 1,
): number {
  let best = 0;
  for (const effect of effects) {
    const duration = effectDurationOf(effect, star);
    if (duration.kind === 'time') best = Math.max(best, duration.ticksLeft / TICKS_PER_SECOND);
    /*
      ★★ 0.2.1 修（陈 5 连斩"看不见"的根因）：按**次数**的时长（`attacks: N`）只能估，
      而旧的 `left * 0.5` 估得**太短** —— 赤刃明霄陈 3 星是"开技能后下一次攻击打 5 连斩"，
      她的攻击间隔约 1 秒，可窗口只给了 0.5 秒 ⇒ 等真正砍出去时窗口早过期，
      于是"斩击特效从来没出现过"。改成 1.5 秒/次：宁可多亮一会儿，也不能漏掉那一刀。
    */
    else if (duration.kind === 'count') best = Math.max(best, duration.left * 1.5);
    /*
      ★ `permanent`（`ticksLeft >= MAX_BATTLE_TICKS`，也就是"整场都在"）——
      这时给到**上限**而不是 0：环要一直在，否则"状态还挂着、光环先没了"；
      但也不能真挂满 75 秒（那是最晃眼的一档），所以夹在上限。
    */
    else if (duration.kind === 'permanent') best = Math.max(best, SKILL_CAST_MAX_SUSTAIN_SECONDS);
  }
  return Math.min(best, SKILL_CAST_MAX_SUSTAIN_SECONDS);
}

/** 整段特效一共多久（起手 + 爆闪 + 持续 + 收尾） */
export function skillCastTotalSeconds(sustainSeconds: number): number {
  const sustain = Math.max(0, Math.min(sustainSeconds, SKILL_CAST_MAX_SUSTAIN_SECONDS));
  return SKILL_CAST_CAST_SECONDS + SKILL_CAST_IMPACT_SECONDS + sustain + SKILL_CAST_END_SECONDS;
}

/** 现在处在哪一段 */
export function skillCastPhaseAt(elapsed: number, sustainSeconds: number): SkillCastPhase {
  const cast = SKILL_CAST_CAST_SECONDS;
  const impactEnd = cast + SKILL_CAST_IMPACT_SECONDS;
  const sustain = Math.max(0, Math.min(sustainSeconds, SKILL_CAST_MAX_SUSTAIN_SECONDS));
  const releaseAt = impactEnd + sustain;
  if (elapsed < cast) return 'charge';
  if (elapsed < impactEnd) return 'impact';
  if (elapsed < releaseAt) return 'sustain';
  return 'release';
}

/** 这一帧每一层的样子（都会被 `applySkillCastFrame` 直接用掉） */
export interface SkillCastFrame {
  phase: SkillCastPhase;
  /** 环 / 六芒 / 内圈：透明度与缩放 */
  ringAlpha: number;
  hexAlpha: number;
  sigilScale: number;
  /** 环自转角度（弧度，累积的绝对值，直接赋给 mesh.rotation.z） */
  spin: number;
  /** 地面柔光 */
  glowAlpha: number;
  /** 放射光条 */
  raysAlpha: number;
  raysSpin: number;
  /** 星芒（正对着镜头的 Sprite） */
  starAlpha: number;
  starScale: number;
  /** 冲击环的"年龄"（秒）；<0 = 这一帧不画 */
  shockAge: number;
  /** 冲击环这次该多大（相对环半径） */
  shockScale: number;
  /** 心跳环的年龄；<0 = 这一帧不画 */
  heartbeatAge: number;
}

const smooth = (k: number): number => (k <= 0 ? 0 : k >= 1 ? 1 : k * k * (3 - 2 * k));
const easeOut = (k: number): number => 1 - Math.pow(1 - Math.min(1, Math.max(0, k)), 3);

/**
 * ★★ 核心：给"过了多久"，返回这一帧的所有参数（纯函数，没有内部状态）。
 */
export function skillCastFrameAt(elapsed: number, sustainSeconds: number): SkillCastFrame {
  const t = Math.max(0, elapsed);
  const cast = SKILL_CAST_CAST_SECONDS;
  const impactEnd = cast + SKILL_CAST_IMPACT_SECONDS;
  const sustain = Math.max(0, Math.min(sustainSeconds, SKILL_CAST_MAX_SUSTAIN_SECONDS));
  const releaseAt = impactEnd + sustain;
  const phase = skillCastPhaseAt(t, sustainSeconds);

  const frame: SkillCastFrame = {
    phase,
    ringAlpha: 0,
    hexAlpha: 0,
    sigilScale: 0.58,
    spin: 0,
    glowAlpha: 0,
    raysAlpha: 0,
    raysSpin: 0,
    starAlpha: 0,
    starScale: 1,
    shockAge: -1,
    shockScale: 1,
    heartbeatAge: -1,
  };

  /*
    ★ 整段播完之后返回**全 0 帧**（而不是"收尾到最后那一帧"）。
    理由：调用方是按 total 决定什么时候回收的，这里再兜一道 ——
    万一某次 delta 跳得特别大（切后台回来 / 两倍速），也不会画出半格残光。
  */
  const total = cast + SKILL_CAST_IMPACT_SECONDS + sustain + SKILL_CAST_END_SECONDS;
  if (t >= total) return frame;

  if (phase === 'charge') {
    const k = cast <= 0 ? 1 : t / cast;
    frame.ringAlpha = smooth(k) * SIGIL_PEAK_ALPHA * 0.9;
    frame.hexAlpha = smooth(k) * SIGIL_PEAK_ALPHA * 0.75;
    frame.sigilScale = 0.58 + 0.42 * easeOut(k);   // 从外往里收
    frame.glowAlpha = smooth(k) * GLOW_PEAK_ALPHA * 0.8;
    frame.raysAlpha = smooth(k) * RAYS_PEAK_ALPHA * 0.6;
    // 起手越收越快（负方向 = 顺时针收紧，和"吸气"的感觉一致）
    frame.spin = -t * (6.5 + 7 * k);
    frame.raysSpin = -t * 3.2;
    return frame;
  }

  if (phase === 'impact') {
    const k = (t - cast) / Math.max(1e-6, SKILL_CAST_IMPACT_SECONDS);
    frame.ringAlpha = SIGIL_PEAK_ALPHA;
    frame.hexAlpha = SIGIL_PEAK_ALPHA;
    frame.sigilScale = 1 + k * 0.04;
    frame.glowAlpha = GLOW_PEAK_ALPHA;
    frame.raysAlpha = RAYS_PEAK_ALPHA * (1 - k * 0.4);
    frame.starAlpha = k < 0.5 ? STAR_PEAK_ALPHA : STAR_PEAK_ALPHA * (1 - k) * 2;
    frame.starScale = 1 + k * 0.25;
    frame.shockAge = t - cast;
    frame.shockScale = 1;
    frame.spin = -cast * 13.5 + k * 2.2;
    frame.raysSpin = -cast * 3.2 + k * 0.8;
    return frame;
  }

  if (phase === 'sustain') {
    const beat = 0.5 + 0.5 * Math.sin(((t - impactEnd) / Math.max(0.25, SKILL_CAST_HEARTBEAT_SECONDS)) * Math.PI * 2);
    frame.ringAlpha = SIGIL_PEAK_ALPHA * (0.42 + 0.10 * beat);
    frame.hexAlpha = SIGIL_PEAK_ALPHA * (0.34 + 0.08 * beat);
    frame.sigilScale = 1;
    frame.glowAlpha = GLOW_PEAK_ALPHA * (0.42 + 0.16 * beat);
    frame.raysAlpha = RAYS_PEAK_ALPHA * (0.32 + 0.12 * beat);
    frame.spin = -cast * 13.5 + 2.2 + (t - impactEnd) * 0.5;
    frame.raysSpin = -cast * 3.2 + 0.8 + (t - impactEnd) * 0.16;
    if (SKILL_CAST_HEARTBEAT_SECONDS > 0) {
      frame.heartbeatAge = (t - impactEnd) % SKILL_CAST_HEARTBEAT_SECONDS;
      frame.shockScale = 0.94;
    }
    return frame;
  }

  // release：外环先散、六芒后走（和提案稿同一个层次感）
  const k = Math.min(1, (t - releaseAt) / Math.max(1e-6, SKILL_CAST_END_SECONDS));
  const fade = Math.pow(1 - k, 2.4);
  frame.ringAlpha = SIGIL_PEAK_ALPHA * fade * Math.pow(1 - k, 1.4);
  frame.hexAlpha = SIGIL_PEAK_ALPHA * fade;
  frame.sigilScale = 1 + 0.24 * easeOut(k);       // 光往外散、同时变薄
  frame.glowAlpha = GLOW_PEAK_ALPHA * Math.pow(1 - k, 2.2);
  frame.raysAlpha = RAYS_PEAK_ALPHA * Math.pow(1 - k, 2.6);
  frame.spin = -cast * 13.5 + 2.2 + sustain * 0.5 + k * 5.5;
  frame.raysSpin = -cast * 3.2 + 0.8 + sustain * 0.16 + k * 1.4;
  frame.shockAge = t - releaseAt;                  // 收尾时再推一道细环
  frame.shockScale = 0.84;
  return frame;
}

// ============================================================
//  二、贴图（一次性生成，全员共享）
// ============================================================
//
// ★ 全部画成**白色**，颜色靠 `material.color` 染 —— 这样换主题色不用重画贴图，
//   而且同一个形状能被复用（我方金 / 以后要分阵营也只要换个 Color）。
// ★ 都按"1 个世界半径 = SIGIL_TEX_RATIO × 画布边长"来画，见 SIGIL_TEX_RATIO 的说明。

const TEX = 512;

function makeCanvas(size: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas 不可用');
  return { canvas, ctx };
}

function toTexture(canvas: HTMLCanvasElement): CanvasTexture {
  const texture = new CanvasTexture(canvas);
  // ★ 不写色彩空间颜色会被冲淡（见 unit-aura.ts 的同名说明）
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

let ringTextureCache: CanvasTexture | null = null;
let hexTextureCache: CanvasTexture | null = null;
let raysTextureCache: CanvasTexture | null = null;
let glowTextureCache: CanvasTexture | null = null;
let starTextureCache: CanvasTexture | null = null;

/** 外环 + 24 段刻度（留一个缺口，看起来像"刻度盘"而不是套圈） */
export function sigilRingTexture(): CanvasTexture {
  if (ringTextureCache) return ringTextureCache;
  const { canvas, ctx } = makeCanvas(TEX);
  const c = TEX / 2;
  const R = TEX * SIGIL_TEX_RATIO;

  ctx.strokeStyle = '#ffffff';
  ctx.lineCap = 'butt';
  // 主环（留 13% 的缺口）
  ctx.lineWidth = TEX * 0.008;
  ctx.beginPath();
  ctx.arc(c, c, R, -0.35, -0.35 + Math.PI * 2 * 0.87);
  ctx.stroke();

  // 24 段刻度：长短交替、外圈略亮
  for (let i = 0; i < 24; i++) {
    const ang = (i / 24) * Math.PI * 2;
    const long = i % 2 === 0;
    const r0 = R * (long ? 0.86 : 0.9);
    const r1 = R * (long ? 0.99 : 0.955);
    ctx.globalAlpha = long ? 0.9 : 0.5;
    ctx.lineWidth = TEX * (long ? 0.007 : 0.004);
    ctx.beginPath();
    ctx.moveTo(c + Math.cos(ang) * r0, c + Math.sin(ang) * r0);
    ctx.lineTo(c + Math.cos(ang) * r1, c + Math.sin(ang) * r1);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  ringTextureCache = toTexture(canvas);
  return ringTextureCache;
}

/** 六芒骨架 + 六个顶点小方片 + 内圈 */
export function sigilHexTexture(): CanvasTexture {
  if (hexTextureCache) return hexTextureCache;
  const { canvas, ctx } = makeCanvas(TEX);
  const c = TEX / 2;
  const R = TEX * SIGIL_TEX_RATIO;

  const hexPath = (radius: number, rot: number): void => {
    ctx.beginPath();
    for (let i = 0; i <= 6; i++) {
      const ang = rot + (i / 6) * Math.PI * 2 + Math.PI / 6;
      const x = c + Math.cos(ang) * radius;
      const y = c + Math.sin(ang) * radius;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();
  };

  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = TEX * 0.008;
  hexPath(R * 0.72, 0);
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = TEX * 0.005;
  hexPath(R * 0.5, 0);
  ctx.globalAlpha = 1;

  // 顶点小方片
  for (let i = 0; i < 6; i++) {
    const ang = (i / 6) * Math.PI * 2 + Math.PI / 6;
    const x = c + Math.cos(ang) * R * 0.72;
    const y = c + Math.sin(ang) * R * 0.72;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang + Math.PI / 4);
    ctx.fillStyle = '#ffffff';
    const s = TEX * 0.011;
    ctx.fillRect(-s / 2, -s / 2, s, s);
    ctx.restore();
  }

  hexTextureCache = toTexture(canvas);
  return hexTextureCache;
}

/** 放射光条（细长楔形，越往外越淡） */
export function sigilRaysTexture(): CanvasTexture {
  if (raysTextureCache) return raysTextureCache;
  const { canvas, ctx } = makeCanvas(TEX);
  const c = TEX / 2;
  const R = TEX * SIGIL_TEX_RATIO;
  const count = 14;

  for (let i = 0; i < count; i++) {
    // 每条长度略有差异，看起来才不像"复制粘贴"
    const wobble = 0.9 + ((i * 37) % 11) / 11 * 0.5;
    /*
      ★★ 0.2.1 修：长度必须**留在画布内**。
      原来是 `R * 1.15 * wobble`（最长 276 px > 画布半宽 256）——
      超出画布的部分被直接裁掉，贴图边缘就是一道**笔直的硬切口**，
      加色混合下看着像一圈方块状的光晕（用户报的"左下角奇怪的方块光晕"里就有它）。
    */
    const len = Math.min(TEX * 0.5 - 2, R * 0.98 * wobble);
    const halfW = 0.012 + ((i * 19) % 7) / 7 * 0.012;
    const ang = (i / count) * Math.PI * 2;
    const g = ctx.createRadialGradient(c, c, R * 0.42, c, c, len);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.32, 'rgba(255,255,255,0.55)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(c, c);
    ctx.arc(c, c, len, ang - halfW * Math.PI, ang + halfW * Math.PI);
    ctx.closePath();
    ctx.fill();
  }

  raysTextureCache = toTexture(canvas);
  return raysTextureCache;
}

/** 地面柔光（一个大渐变，没有硬边） */
export function sigilGlowTexture(): CanvasTexture {
  if (glowTextureCache) return glowTextureCache;
  const { canvas, ctx } = makeCanvas(256);
  const c = 128;
  const g = ctx.createRadialGradient(c, c, 0, c, c, 128);
  g.addColorStop(0, 'rgba(255,255,255,0.85)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.42)');
  g.addColorStop(0.7, 'rgba(255,255,255,0.12)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  glowTextureCache = toTexture(canvas);
  return glowTextureCache;
}

/** 四芒星（白心 + 一竖一横两根长芒 + 两根短斜芒） */
export function starFlareTexture(): CanvasTexture {
  if (starTextureCache) return starTextureCache;
  const { canvas, ctx } = makeCanvas(256);
  const c = 128;

  // 白核
  const core = ctx.createRadialGradient(c, c, 0, c, c, 96);
  core.addColorStop(0, 'rgba(255,255,255,1)');
  core.addColorStop(0.18, 'rgba(255,255,255,0.8)');
  core.addColorStop(0.55, 'rgba(255,255,255,0.16)');
  core.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = core;
  ctx.fillRect(0, 0, 256, 256);

  // 四根芒（两根长、两根短）
  const beams: Array<[number, number, number]> = [
    [Math.PI / 2, 118, 7],
    [0, 108, 6],
    [Math.PI / 4, 62, 3.6],
    [-Math.PI / 4, 62, 3.6],
  ];
  ctx.globalCompositeOperation = 'lighter';
  for (const [rot, len, wid] of beams) {
    ctx.save();
    ctx.translate(c, c);
    ctx.rotate(rot);
    const g = ctx.createLinearGradient(-len, 0, len, 0);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.4, 'rgba(255,255,255,0.22)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.95)');
    g.addColorStop(0.6, 'rgba(255,255,255,0.22)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(-len, 0);
    ctx.lineTo(0, -wid);
    ctx.lineTo(len, 0);
    ctx.lineTo(0, wid);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  ctx.globalCompositeOperation = 'source-over';

  starTextureCache = toTexture(canvas);
  return starTextureCache;
}

/*
  ★★ 0.2.1 删掉的那一层：**竖光柱**（原来那根竖直的 Sprite 光柱）。
  【为什么删？】用户报「技能开启时的特效左下角有奇怪的方块光晕」——
  定格截图 + 逐层排查（`.fx-proposal/_castcheck.html`）定位到就是它：
  柱子的贴图左右两侧的"擦除"渐变方向写反了、底边又是 72% 的硬边，
  于是整块 quad 成了一张**灰白色的硬边矩形**，加色混合下尤其像一块脏玻璃。
  它不是这套特效的必要层（环 / 六芒 / 光条 / 星芒已经够读），
  而"低透明度的宽光柱在加色混合下会变成一坨灰烟"这件事提案稿里就记过 ——
  所以直接移除，而不是继续调参数。
*/
// ============================================================
//  三、把一层层贴地/立着的面片组起来
// ============================================================

export interface SkillCastVisual {
  group: Group;
  /** 地面柔光 */
  glow: Mesh;
  /** 外环 + 刻度 */
  ring: Mesh;
  /** 六芒骨架 */
  hex: Mesh;
  /** 放射光条 */
  rays: Mesh;
  /** 冲击环（几何体，不用贴图：它是纯正的圆环，缩放时会糊） */
  shock: Mesh;
  /** 星芒（永远面向镜头） */
  star: Sprite;
  /** 贴地那几块共用的材质列表（销毁时要逐个 dispose） */
  materials: MeshBasicMaterial[];
  geometries: BufferGeometry[];
}

function flatMesh(
  texture: CanvasTexture,
  color: number,
  opacity: number,
  y: number,
): { mesh: Mesh; material: MeshBasicMaterial; geometry: PlaneGeometry } {
  const geometry = new PlaneGeometry(1, 1);
  const material = new MeshBasicMaterial({
    map: texture,
    color,
    transparent: true,
    opacity,
    // 加色混合：把地面提亮，而不是盖一张半透明的黄纸
    blending: AdditiveBlending,
    // 贴地的薄片从上方看，两面都可能朝上；不写 DoubleSide 会有一半时候看不见
    side: DoubleSide,
    // 不写深度 ⇒ 不遮挡后面的棋子（和攻击特效/范围框同一条规矩）
    depthWrite: false,
  });
  const mesh = new Mesh(geometry, material);
  // PlaneGeometry 在 XY 平面上，转 -90° 才是贴地
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = y;
  // ★ 层级：一定画在所有棋子精灵之上（见 card-layout 的 RENDER_ORDER_FX）
  mesh.renderOrder = RENDER_ORDER_FX;
  return { mesh, material, geometry };
}

/**
 * 造一套特效的"壳"（贴图共享，几何/材质各自一份）。
 *
 * ★ 只在 `replay.ts` 的 cast 事件里调一次，一个技能一套 —— 一套里所有层
 *   共用同一个 `group`，位置每帧跟着施法者走。
 */
export function createSkillCastVisual(): SkillCastVisual {
  const group = new Group();

  const glow = flatMesh(sigilGlowTexture(), SKILL_CAST_COLOR, 0, 0);
  const ring = flatMesh(sigilRingTexture(), SKILL_CAST_COLOR, 0, 0.001);
  const hex = flatMesh(sigilHexTexture(), SKILL_CAST_COLOR, 0, 0.0015);
  const rays = flatMesh(sigilRaysTexture(), SKILL_CAST_COLOR, 0, 0.0005);

  // 冲击环：纯几何圆环（贴图缩放到很大时会发虚，几何环永远是干净的细线）
  const shockGeometry = new RingGeometry(0.9, 1, 40);
  const shockMaterial = new MeshBasicMaterial({
    color: SKILL_CAST_CORE_COLOR,
    transparent: true,
    opacity: 0,
    blending: AdditiveBlending,
    side: DoubleSide,
    depthWrite: false,
  });
  const shock = new Mesh(shockGeometry, shockMaterial);
  shock.rotation.x = -Math.PI / 2;
  shock.position.y = 0.002;
  shock.renderOrder = RENDER_ORDER_FX;

  // 星芒：Sprite（永远正对镜头，技能开启那一下才出现）
  const starMaterial = new SpriteMaterial({
    map: starFlareTexture(),
    color: SKILL_CAST_CORE_COLOR,
    transparent: true,
    opacity: 0,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  const star = new Sprite(starMaterial);
  star.renderOrder = RENDER_ORDER_FX;

  group.add(glow.mesh, ring.mesh, hex.mesh, rays.mesh, shock, star);

  return {
    group,
    glow: glow.mesh,
    ring: ring.mesh,
    hex: hex.mesh,
    rays: rays.mesh,
    shock,
    star,
    // ★ 贴地那四块 + 冲击环的材质（Sprite 的材质在 dispose 里单独释放）
    materials: [glow.material, ring.material, hex.material, rays.material, shockMaterial],
    geometries: [glow.geometry, ring.geometry, hex.geometry, rays.geometry, shockGeometry],
  };
}

/** 把一帧的参数写到这套壳上（每帧调一次） */
export function applySkillCastFrame(visual: SkillCastVisual, frame: SkillCastFrame): void {
  const R = skillCastRingRadius();
  // 贴图里"1 个半径"占画布边长的 SIGIL_TEX_RATIO ⇒ 平面边长 = R / RATIO
  const sigilSize = R / SIGIL_TEX_RATIO;

  visual.ring.scale.setScalar(sigilSize * frame.sigilScale);
  visual.hex.scale.setScalar(sigilSize * frame.sigilScale);
  visual.rays.scale.setScalar(sigilSize * (0.9 + 0.1 * frame.sigilScale));
  visual.glow.scale.setScalar(R * 3.0);

  // 环与六芒反着转一点点，层次感就出来了
  visual.ring.rotation.z = frame.spin;
  visual.hex.rotation.z = -frame.spin * 0.55;
  visual.rays.rotation.z = frame.raysSpin;

  (visual.ring.material as MeshBasicMaterial).opacity = frame.ringAlpha;
  (visual.hex.material as MeshBasicMaterial).opacity = frame.hexAlpha;
  (visual.rays.material as MeshBasicMaterial).opacity = frame.raysAlpha;
  (visual.glow.material as MeshBasicMaterial).opacity = frame.glowAlpha;

  // 冲击环：优先画"开启瞬间"那一道，其次是持续期的心跳环
  const shockAge = frame.shockAge >= 0 ? frame.shockAge : frame.heartbeatAge;
  if (shockAge >= 0) {
    const strong = frame.shockAge >= 0;
    const life = strong ? 0.45 : Math.min(0.78, SKILL_CAST_HEARTBEAT_SECONDS * 0.55);
    const k = Math.min(1, shockAge / Math.max(1e-6, life));
    const grow = 0.62 + easeOut(k) * (strong ? 1.35 : 0.95);
    visual.shock.scale.setScalar(R * frame.shockScale * grow);
    (visual.shock.material as MeshBasicMaterial).opacity =
      SHOCK_PEAK_ALPHA * (strong ? 1 : 0.45) * Math.pow(1 - k, 2);
  } else {
    (visual.shock.material as MeshBasicMaterial).opacity = 0;
  }

  // 星芒：位置在胸口高度（卡面 0.96 高，取 0.52），只有爆闪那一下亮
  visual.star.position.set(0, 0.52, 0);
  visual.star.scale.setScalar(R * 2.6 * frame.starScale);
  (visual.star.material as SpriteMaterial).opacity = frame.starAlpha;
  (visual.star.material as SpriteMaterial).rotation = frame.spin * 0.02;
}

/** 摘掉并释放（Three.js 不会自动回收几何体/材质） */
export function disposeSkillCastVisual(visual: SkillCastVisual): void {
  visual.group.parent?.remove(visual.group);
  for (const geometry of visual.geometries) geometry.dispose();
  for (const material of visual.materials) material.dispose();
  (visual.star.material as SpriteMaterial).dispose();
  visual.group.clear();
}

