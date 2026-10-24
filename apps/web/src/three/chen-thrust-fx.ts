/**
 * ============================================================
 *  ★★ 0.2.2 陈「赤霄」：覆盖**前方 3 格**的剑光
 * ============================================================
 *
 * 【用户口径（2026-10-19，带手绘草图）】
 *   黄色方块 = 卡面位置；从卡面向**左（前方）**伸出一道 3 格长的剑光：
 *   中间是一条**深色（近黑）的长芯**，两侧是几道**红色剑光**（越往前越尖、
 *   远端收成一个箭头），靠近卡面的地方还有几道更短的红色斜光。
 *
 * 【为什么是程序化，不是序列帧？】
 *   ① 它是"从卡面往前铺一条"的**方向性**效果，长度直接跟着技能数据走
 *      （`op21` 的 `radius: 3`）；出序列帧得按 3 格宽手绘一整条横向长条，
 *      改一次长度就要重画；
 *   ② 一条 = 一块贴地平面，十几块的总量比一张 2560px 的长图便宜得多。
 *   ★ 形状本身用 canvas 画（细长、越往前越亮），和斩击贴图同一套做法。
 *
 * 【为什么暗芯要单独一层普通混合？】
 *   加色混合下纯黑/深色**根本看不见**（MEMORY-特效 §7）——
 *   草图里那条黑芯是"剑身压住地面"的感觉，所以它必须走 `NormalBlending`，
 *   红色剑光再叠在它上面。
 *
 * 【判据只看数据里的 `castFx`】
 *   数据写 `castFx: 'chen_thrust'`，渲染层查 `isChenThrustFx` 分流；
 *   不认干员编号，以后谁想用同一招直接写这个 id 就行。
 */

import {
  AdditiveBlending,
  CanvasTexture,
  Group,
  Mesh,
  MeshBasicMaterial,
  NormalBlending,
  PlaneGeometry,
  SRGBColorSpace,
  type Object3D,
  type Texture,
} from 'three';
import { CELL } from '../game/grid.js';
import { RENDER_ORDER_FX } from './card-layout.js';

/** 数据里写的样式 id（`SkillDef.castFx`） */
export const CHEN_THRUST_FX = 'chen_thrust';

/**
 * 剑光往前覆盖几格。
 * ★ 必须和技能数据一致：`op21` 的 `radius: 3 / shape: 'line'`（对前方 3 格）。
 *   改数据时一起改这里 —— `fx-wiring` 里有一条绊线在盯这个数。
 */
export const CHEN_THRUST_CELLS = 3;

/** 世界长度 */
export const CHEN_THRUST_LENGTH = CHEN_THRUST_CELLS * CELL;

/** 整段演出多长（秒）。和攻击特效那一档（0.13~0.30）同量级，比它略长一点"够看" */
export const CHEN_THRUST_SECONDS = 0.38;

/** 同屏上限（一次施法只有一个，留点余量给连放） */
export const MAX_LIVE_CHEN_THRUST = 4;

/** 配色（草图是赤红 + 近黑的芯） */
export const CHEN_THRUST_COLORS = {
  /** 暗芯（普通混合：加色下深色看不见）。★ 要够黑才压得住红光，`0x2b0608` 在深红半场上几乎看不出来 */
  core: 0x120203,
  /** 主剑光 */
  red: 0xff3a2a,
  /** 内侧更亮的一道 */
  hot: 0xff8a66,
  /** 远端箭头 / 尖端闪 */
  tip: 0xffd9c0,
} as const;

/** 这个 id 是不是"陈的前方三格剑光" —— 渲染层唯一判据 */
export function isChenThrustFx(id: string | undefined | null): boolean {
  return id === CHEN_THRUST_FX;
}

// ============================================================
//  曲线（纯函数）
// ============================================================

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

/**
 * 伸展进度：前 45% 从 0.12 冲到 1（"刺出去"），之后保持。
 * ★ 不做"缩回去"：剑光是**扫/刺出去**的，收回来会变成"长出来再吸回去"。
 */
export function thrustReachAt(progress: number): number {
  const t = clamp01(progress);
  const grow = Math.min(1, t / 0.45);
  return 0.12 + 0.88 * (1 - (1 - grow) * (1 - grow));
}

/** 不透明度：前 25% 满亮，之后线性淡出到 0 */
export function thrustOpacityAt(progress: number): number {
  const t = clamp01(progress);
  const fade = t < 0.25 ? 1 : 1 - (t - 0.25) / 0.75;
  return Math.max(0, fade);
}

// ============================================================
//  贴图：一条越往前越亮、远端收尖的细光带
// ============================================================

const TEXTURE_W = 256;
const TEXTURE_H = 32;
let streakTexture: Texture | null = null;
let spineTexture: Texture | null = null;

function toTexture(canvas: HTMLCanvasElement): Texture {
  const texture = new CanvasTexture(canvas);
  // ★ 不写 colorSpace 会发灰（note-fx / unit-aura / heal-halo 都是同一个坑）
  texture.colorSpace = SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function rgba(color: number, alpha: number): string {
  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * 红色剑光：细长条，**远端（+X）最亮并收成尖**，近端渐隐。
 * 画布左边 = 卡面那头（暗），右边 = 剑尖那头（亮）。
 */
export function chenThrustStreakTexture(): Texture {
  if (streakTexture) return streakTexture;
  const canvas = document.createElement('canvas');
  canvas.width = TEXTURE_W;
  canvas.height = TEXTURE_H;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const cy = TEXTURE_H / 2;
    // ① 柔光底
    ctx.save();
    ctx.shadowColor = rgba(CHEN_THRUST_COLORS.red, 0.95);
    ctx.shadowBlur = TEXTURE_H * 0.55;
    ctx.strokeStyle = rgba(CHEN_THRUST_COLORS.red, 0.5);
    ctx.lineWidth = TEXTURE_H * 0.34;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(0, cy);
    ctx.lineTo(TEXTURE_W * 0.98, cy);
    ctx.stroke();
    ctx.restore();

    // ② 主体：从卡面这头渐亮，远端再收尖
    const body = ctx.createLinearGradient(0, 0, TEXTURE_W, 0);
    body.addColorStop(0, rgba(CHEN_THRUST_COLORS.red, 0));
    body.addColorStop(0.25, rgba(CHEN_THRUST_COLORS.red, 0.55));
    body.addColorStop(0.78, rgba(CHEN_THRUST_COLORS.red, 0.95));
    body.addColorStop(1, rgba(CHEN_THRUST_COLORS.tip, 0));
    ctx.strokeStyle = body;
    ctx.lineWidth = TEXTURE_H * 0.2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(0, cy);
    ctx.lineTo(TEXTURE_W * 0.99, cy);
    ctx.stroke();

    // ③ 亮芯：只有后半段，越靠近剑尖越白
    const core = ctx.createLinearGradient(TEXTURE_W * 0.3, 0, TEXTURE_W, 0);
    core.addColorStop(0, rgba(CHEN_THRUST_COLORS.hot, 0));
    core.addColorStop(0.6, rgba(CHEN_THRUST_COLORS.hot, 0.55));
    core.addColorStop(0.95, rgba(CHEN_THRUST_COLORS.tip, 0.85));
    core.addColorStop(1, rgba(CHEN_THRUST_COLORS.tip, 0));
    ctx.strokeStyle = core;
    ctx.lineWidth = TEXTURE_H * 0.075;
    ctx.beginPath();
    ctx.moveTo(TEXTURE_W * 0.3, cy);
    ctx.lineTo(TEXTURE_W, cy);
    ctx.stroke();
  }
  streakTexture = toTexture(canvas);
  return streakTexture;
}

/** 暗芯：近黑的一条，两端收细（普通混合，负责"剑身压地"的实体感） */
export function chenThrustSpineTexture(): Texture {
  if (spineTexture) return spineTexture;
  const canvas = document.createElement('canvas');
  canvas.width = TEXTURE_W;
  canvas.height = TEXTURE_H;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const cy = TEXTURE_H / 2;
    const grad = ctx.createLinearGradient(0, 0, TEXTURE_W, 0);
    grad.addColorStop(0, rgba(CHEN_THRUST_COLORS.core, 0));
    grad.addColorStop(0.18, rgba(CHEN_THRUST_COLORS.core, 0.95));
    grad.addColorStop(0.85, rgba(CHEN_THRUST_COLORS.core, 0.95));
    grad.addColorStop(1, rgba(CHEN_THRUST_COLORS.core, 0));
    ctx.strokeStyle = grad;
    ctx.lineWidth = TEXTURE_H * 0.42;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(0, cy);
    ctx.lineTo(TEXTURE_W, cy);
    ctx.stroke();
  }
  spineTexture = toTexture(canvas);
  return spineTexture;
}

// ============================================================
//  实例
// ============================================================

interface StreakLayer {
  mesh: Mesh;
  geometry: PlaneGeometry;
  material: MeshBasicMaterial;
  /** 这一道的长度（世界单位）—— 伸展动画按它做 scale.x */
  length: number;
  /** 这一道的**固有**不透明度（每道不一样：中轴最亮、外围更淡） */
  opacity: number;
}

interface ThrustInstance {
  group: Group;
  layers: StreakLayer[];
  age: number;
}

let root: Object3D | null = null;
const instances: ThrustInstance[] = [];

export function attachChenThrustRoot(scene: Object3D): void {
  root = scene;
}

/**
 * 放一道「前方 3 格剑光」。
 *
 * @param x,z   卡面中心（世界坐标）
 * @param yaw   朝向（弧度，绕 Y）。调用方用 `atan2(-dz, dx)` 从"卡面 → 目标"算
 */
export function spawnChenThrust(x: number, z: number, yaw: number): void {
  if (!root) return;
  while (instances.length >= MAX_LIVE_CHEN_THRUST) {
    const oldest = instances.shift();
    if (oldest) disposeThrust(oldest);
  }

  const group = new Group();
  group.position.set(x, 0, z);
  // ★ 朝向放在最外层，里面每一道只按"自己的张角"再偏一点
  group.rotation.y = yaw;
  const layers: StreakLayer[] = [];

  /** 加一层并挂到 group 上 */
  const add = (
    texture: Texture,
    length: number,
    thickness: number,
    angle: number,
    offsetAlong: number,
    color: number,
    opacity: number,
    blend: 'add' | 'normal',
  ): void => {
    const geometry = new PlaneGeometry(length, thickness);
    /*
      ★★ 把几何的**原点挪到条子的近端**（而不是中心）。
      不这么做的话 `mesh.scale.x = reach` 会以**条子中心**为基准缩放 ——
      伸展动画看起来是"从中间往两头长"，没伸展时还是一小截飘在 3 格中间，
      而不是从卡面刺出来（真机第一版就是这样，屏幕上几乎什么都看不到）。
    */
    geometry.translate(length / 2, 0, 0);
    const material = new MeshBasicMaterial({
      map: texture,
      color,
      transparent: true,
      opacity,
      depthWrite: false,
      blending: blend === 'add' ? AdditiveBlending : NormalBlending,
    });
    const mesh = new Mesh(geometry, material);
    // 平面在 XY 上 ⇒ 转 -90° 贴地
    mesh.rotation.x = -Math.PI / 2;
    // ★ 贴地之后"绕世界 Y 转"必须靠父节点（在 mesh 上再转就是绕自己的法线了）
    const holder = new Group();
    holder.rotation.y = angle;
    /*
      原点已经在近端 ⇒ 位置就是起点（卡面那一侧）。
      ★★ y 必须抬起来一点（0.03）：组本身在 y=0，和棋盘**共面**的话会 z-fighting，
      表现是"特效时有时无、大部分时候根本看不见"（真机第一版就是这样，查了半天）。
      0.03 比范围白框（ZONE_Y = 0.02）再高一点点，压在上面才读得清。
    */
    mesh.position.set(offsetAlong, 0.03, 0);
    mesh.renderOrder = RENDER_ORDER_FX;
    holder.add(mesh);
    group.add(holder);
    layers.push({ mesh, geometry, material, length, opacity });
  };

  const streak = chenThrustStreakTexture();
  const spine = chenThrustSpineTexture();
  const L = CHEN_THRUST_LENGTH;

  /*
    层次（对照草图）：
      ① 中轴暗芯（普通混合、最粗）—— 草图里那条黑色的"剑身"
      ② 中轴红芯（加色、更细更长）—— 覆盖暗芯，形成"红里透黑"
      ③ 两侧扇形红剑光（±6° / ±14° / ±26°），越往外越短
      ④ 远端箭头：两道反向斜光在剑尖处收成 "<"
      ⑤ 近端几道短斜光（卡面附近那几撇）
  */
  // ① 暗芯：草图里那条最显眼的黑线（普通混合才看得见，纯黑在加色下等于没有）
  add(spine, L * 0.97, 0.2, 0, 0, 0xffffff, 1, 'normal');
  // ② 中轴红芯（压在暗芯上，形成"红里透黑"）
  add(streak, L, 0.11, 0, 0, CHEN_THRUST_COLORS.red, 1, 'add');
  add(streak, L * 0.98, 0.055, 0, 0, CHEN_THRUST_COLORS.tip, 0.9, 'add');
  /*
    ③ 扇开的红色剑光。
    ★ 张角刻意收得小（±3.4° / ±9° / ±17°）：第一版开到了 ±26°，
      真机上像"手电筒散光"，和草图那种**几乎平行、只在远端微微发散**的观感差很远。
  */
  for (const [angle, len, alpha] of [
    [0.06, 0.98, 0.85],
    [-0.06, 0.98, 0.85],
    [0.16, 0.92, 0.7],
    [-0.16, 0.92, 0.7],
    [0.3, 0.74, 0.55],
    [-0.3, 0.74, 0.55],
  ] as const) {
    add(streak, L * len, 0.06, angle, 0, CHEN_THRUST_COLORS.red, alpha, 'add');
  }
  // ④ 剑尖箭头：两道**反向**的短斜光收成 "<"
  add(streak, 0.5, 0.05, Math.PI - 0.42, L, CHEN_THRUST_COLORS.tip, 0.9, 'add');
  add(streak, 0.5, 0.05, Math.PI + 0.42, L, CHEN_THRUST_COLORS.tip, 0.9, 'add');
  // ⑤ 近端短斜光（草图里卡面附近那几撇）
  for (const [angle, len, alpha] of [
    [0.7, 0.3, 0.5],
    [-0.7, 0.3, 0.5],
    [0.95, 0.22, 0.38],
    [-0.95, 0.22, 0.38],
  ] as const) {
    add(streak, L * len * 0.5, 0.045, angle, 0.05, CHEN_THRUST_COLORS.red, alpha, 'add');
  }

  root.add(group);
  instances.push({ group, layers, age: 0 });
}

function disposeThrust(instance: ThrustInstance): void {
  root?.remove(instance.group);
  for (const layer of instance.layers) {
    layer.geometry.dispose();
    layer.material.dispose();
  }
}

/** 每帧推进（伸展 + 淡出） */
export function updateChenThrustFx(deltaSeconds: number): void {
  for (let i = instances.length - 1; i >= 0; i--) {
    const instance = instances[i]!;
    instance.age += deltaSeconds;
    if (instance.age >= CHEN_THRUST_SECONDS) {
      disposeThrust(instance);
      instances.splice(i, 1);
      continue;
    }
    const t = instance.age / CHEN_THRUST_SECONDS;
    const reach = thrustReachAt(t);
    const opacity = thrustOpacityAt(t);
    for (const layer of instance.layers) {
      // ★ 沿长度方向伸展（scale.x），厚度不变 —— 剑光是"刺出去"，不是"整体放大"
      layer.mesh.scale.set(reach, 1, 1);
      // 叠上这一道自己的基础亮度（中轴最亮、外围更淡）
      layer.material.opacity = opacity * layer.opacity;
    }
  }
}

/** 清掉所有剑光（重开一局 / 收尾） */
export function clearChenThrustFx(): void {
  for (const instance of instances) disposeThrust(instance);
  instances.length = 0;
}

/** 测试/调试用：现在场上几道 */
export function chenThrustLiveCount(): number {
  return instances.length;
}
