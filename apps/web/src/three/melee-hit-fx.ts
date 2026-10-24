/**
 * ============================================================
 *  ★★ 0.2.2：近战命中时**挨打的那个人身上**的斩击受击特效
 * ============================================================
 *
 * 【用户口径（2026-10-19）】
 *   「为所有被近战攻击命中的敌人添加斩击受击特效：根据本次攻击斩击特效的颜色
 *     自动匹配受击特效颜色，确保两者颜色一致；受击特效尺寸保持较小、不遮挡角色。
 *     请将该逻辑统一封装，确保覆盖所有近战攻击来源与新出现的敌人，
 *     避免遗漏或颜色不匹配。」
 *
 * ============================================================
 *  【一、颜色从哪来？（这是"不颜色不匹配"的关键）】
 * ============================================================
 * 唯一真相是**这一次攻击真正播出去的那条斩击**：
 *   ① 技能生效期（`SkillFxBinding.attack`）→ 用技能那几条图的 id（陈的赤红连斩）；
 *   ② 数据里的 `UnitDef.combatFx` → `COMBAT_FX[...].hit` 的图 id（银白/红/金三套通用斩击）；
 *   ③ 两者都没有（野怪、召唤物、没写 combatFx 的干员）→ 他们那一下本来就是
 *      `attack-fx.ts` 画的**队伍色弧**，所以受击色取 `FX_GLOW_COLORS[队伍]` ——
 *      仍然"和攻击特效同色"，只是那条攻击特效不是贴图。
 * `MELEE_SLASH_STYLES` 就是 ① ② 的样式表（**和贴图主色对齐**，改图要一起改）。
 *
 * ★ 所以这里**没有一张"谁用什么颜色"的名单**：新加一个近战干员、新加一只野怪，
 *   只要它走的是既有的攻击链路（combatFx 或没 combatFx），颜色自动就对。
 *   这也正是用户要的"覆盖所有近战攻击来源与新出现的敌人"。
 *
 * ============================================================
 *  【二、形态：一道**细长的斜斩痕**（不是月牙）】
 * ============================================================
 * ★★ 用户口径（2026-10-19 二改，带参考图）：要的是**一条又细又直的斩痕** ——
 *   一端拖出细尾、另一端有个亮点的斜线，**不要半月/弧形**。
 *   （第一版画的是月牙弧，用户当场否掉："记得修改斩击颜色，而不是半月形"。）
 *
 *   · **立牌**（Sprite，正对镜头）：贴地画在 45° 俯视下会压成扁椭圆，
 *     而这一下要"看得见是谁挨了刀"，必须正对镜头；
 *   · **细**：`MELEE_HIT_LENGTH 0.72 × MELEE_HIT_THICKNESS 0.18` 格 ——
 *     长度大约齐卡面宽（0.9），但**厚度只有五分之一**，斜着一划盖住的面积不到一成；
 *   · **两端收尖 + 头部一个亮点**（参考图就是"细尾 → 亮头"）；
 *   · **只走加色**：加色是"往上加光"，不是"盖一层色块"，天然不遮挡；
 *     而且被它模仿的那几条斩击贴图本身也是加色，两者观感才是同一种"亮"。
 *
 * ============================================================
 *  【三、时机：必须挂在"命中那一刻"】
 * ============================================================
 * 见 MEMORY-特效 §11：表现分"出手"和"命中"两半，命中那半必须过 `hit-timing`。
 * 近战一般没有飞行时间（`impactDelay = 0`），但**多段攻击**（`multiHit`）的第 2/3 段
 * 会各错开 90 毫秒 —— 所以这里的延迟由调用方（`replay.ts`）从同一个 `impactDelay`
 * 传进来，绝不自己再算一份。
 */

import {
  AdditiveBlending,
  CanvasTexture,
  NormalBlending,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  type Object3D,
  type Texture,
} from 'three';
import { FX_GLOW_COLORS, RANGED_ATTACK_FROM } from './attack-fx.js';
import { COMBAT_FX, combatFxIdsOf } from './sequence-fx.js';
import { RENDER_ORDER_FX } from './card-layout.js';

// ============================================================
//  ① 颜色表（与斩击贴图的主色对齐）
// ============================================================

/**
 * 斩击贴图 id → **主色**（不是高光色）。
 *
 * ★ 为什么用主色？加色混合天然往白走，用高光色（`#ffe08a` / 近白）打出来就是一片白，
 *   "红色受击"和"银色受击"会变得一模一样 —— 那就等于没匹配。
 *   这三本值对着 `apps/web/public/assets/fx/slash_*.png` 取的，**改图时一起改**。
 */
/**
 * ★★ 0.3.2：斩击贴图 id → **受击痕样式**（主色 + 混合方式）。唯一色源。
 *
 * 【为什么从"一张色表"变成"一张样式表"？】
 * 阿米娅·青色怒火（0.3.2 用户口径）的普攻/技能斩击是**黑墨刃** ——
 * 而加色混合下纯黑什么都不是（见 `sequence-fx.ts` 的 ink 系列说明），
 * 她的受击痕必须是"能看见的黑"：普通混合的墨底 + 青色刃口。
 * "颜色"和"怎么混"是一件事的两半，所以收进一张表里，别让调用方查两张。
 */
export interface MeleeSlashStyle {
  /** 主色：加色层 = 发光色；墨层 = 刃口的冷光色 */
  color: number;
  /**
   * 混合方式：`'add'`（默认）= 发光弧；`'normal'` = 墨（能看见的黑）。
   * ★ 不写就是 'add' —— 既有三套银白/红/金不受影响。
   */
  blend?: 'add' | 'normal';
  /** 墨层的墨底色（只有 `blend: 'normal'` 才用） */
  ink?: number;
}

export const MELEE_SLASH_STYLES: Record<string, MeleeSlashStyle> = {
  slash_single: { color: 0xcfd8e6 }, // 银白（通用近战）
  slash_red: { color: 0xff5040 }, // 赤红
  slash_gold: { color: 0xe0a828 }, // 深黄（用户定的主题色）
  /*
    ★ 0.3.2 阿米娅·青色怒火：黑墨刃 —— 受击痕也是黑的（普通混合墨底 + 青刃口）。
    `color` = 刃口冷光（和 `amiya_cyan_edge` 的青对齐），`ink` = 墨底（和 `amiya_cyan_ink` 对齐）。
  */
  amiya_cyan_ink: { color: 0x3fd8ff, blend: 'normal', ink: 0x05070b },
};

/**
 * 斩痕的**长度**（世界单位 = 格）。
 * 0.72 大约齐卡面宽（0.9）—— 斜着划过去才"横跨身体"，短了会像个小星点。
 */
export const MELEE_HIT_LENGTH = 0.72;

/**
 * 斩痕的**厚度**（世界单位 = 格，最粗那一点）。
 * ★ 0.18 是量出来的：再粗就变成"一道光带"，开始挡脸；
 *   `LENGTH / THICKNESS = 4` 正好是参考图那种"又细又长"的比例。
 */
export const MELEE_HIT_THICKNESS = 0.13;

/**
 * 存活时长（秒）。
 *
 * ★ 0.22 是"比攻击弧稍微多活一点点"：攻击弧是 0.18 秒，
 *   如果两者一样长，受击痕会在同一帧消失，画面上读不出"挨完刀还留着个印子"。
 *   也不能再长 —— 超过 0.3 秒就会和下一刀（攻速上限 4 倍 = 0.25 秒一下）叠起来。
 */
export const MELEE_HIT_SECONDS = 0.22;

/**
 * 挂多高（默认值）：**卡面中心**（`CARD_CENTER_Y = 0.42`）。
 * ★ 调用方一般会传受击者**自己的**视觉中心高度（`visualPosition.y`），
 *   这样野怪那种矮个头的水滴怪不会"刀痕飘在头顶上方"。
 */
export const MELEE_HIT_HEIGHT = 0.42;

/** 往攻击者那一侧偏多少格 —— 让这一刀看起来是"从那边砍过来的" */
export const MELEE_HIT_OFFSET = 0.1;

/** 同屏上限（满编对轰时每人每 0.25 秒一下，64 足够兜住） */
export const MAX_LIVE_MELEE_HITS = 64;

/**
 * 贴图尺寸：**横向长条**（4:1）。
 * ★ 别用正方形：斩痕是"细长条"，正方形纹理拉成 4:1 会把厚度一起压扁，
 *   粗细就不受 `MELEE_HIT_THICKNESS` 控制了。宽高比 = 世界长宽比，缩放才是 1:1 的。
 */
const HIT_TEXTURE_W = 256;
const HIT_TEXTURE_H = 64;

// ============================================================
//  ② 颜色解析（唯一入口）
// ============================================================

/**
 * 这一次近战该用什么受击**样式**（0.3.2：颜色 + 混合方式一起定，见 `MeleeSlashStyle`）。
 *
 * @param hitIds  这一次攻击**真正播出去**的贴图 id（技能期间是技能那几条，否则是 combatFx 那几条）
 * @param combatFx 单位数据里的 `combatFx`（拿不到 hitIds 时的第二来源，比如 `attackLink`）
 * @param team    攻击方队伍（0/1）—— 兜底用队伍色，和程序化弧同色
 *
 * ★ 顺序不能反：先看"这一次真的播了什么"，再看数据，最后才兜底。
 *   反过来会让"技能换了一套赤红斩击"的单位仍然用基础款的颜色（正是颜色不匹配的来源）。
 */
export function meleeHitStyleOf(
  hitIds: readonly string[],
  combatFx: string | null | undefined,
  team: 0 | 1,
): MeleeSlashStyle {
  for (const id of hitIds) {
    const style = MELEE_SLASH_STYLES[id];
    if (style) return style;
  }
  if (combatFx) {
    const binding = COMBAT_FX[combatFx];
    for (const id of combatFxIdsOf(binding?.hit)) {
      const style = MELEE_SLASH_STYLES[id];
      if (style) return style;
    }
  }
  /*
    兜底：这一下本来就没有"斩击贴图"，攻击特效是 `attack-fx.ts` 画的**队伍色弧** ——
    所以受击色取同一个颜色源，两者才是同色（用户要的"确保颜色一致"）。
  */
  return { color: FX_GLOW_COLORS[team === 1 ? 1 : 0]! };
}

/** 队伍色兜底色（测试用；渲染层只走 `meleeHitStyleOf`） */
export function meleeHitFallbackColorOf(team: 0 | 1): number {
  return FX_GLOW_COLORS[team === 1 ? 1 : 0]!;
}

/**
 * 这一下算不算"近战"。
 *
 * ★ 判据只有**射程**一个数，和弹道线用的是同一个阈值（`RANGED_ATTACK_FROM`）——
 *   所以"射程 2 的芳汀"归近战、"射程 3 的狙击"归远程，规则和数据完全一致，
 *   渲染层不认干员编号、也不维护名单（用户要的"覆盖新出现的敌人"就靠这一条）。
 */
export function isMeleeAttack(range: number): boolean {
  return Number.isFinite(range) && range < RANGED_ATTACK_FROM;
}

// ============================================================
//  ③ 曲线（纯函数）
// ============================================================

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

/** 稳定的 0..1 伪随机（同一组输入永远同一结果 ⇒ 两家机器上长得一样） */
function hash01(n: number): number {
  let x = Math.imul(n | 0, 2654435761) >>> 0;
  x ^= x >>> 15;
  x = Math.imul(x, 2246822519) >>> 0;
  x ^= x >>> 13;
  x = Math.imul(x, 3266489917) >>> 0;
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

/** 缩放：前 35% 冲到 1.06（"刀落下去"），之后收到 1 —— 不做缩回 0（那是"长出来又缩回去"） */
export function meleeHitScaleAt(progress: number): number {
  const t = clamp01(progress);
  const grow = Math.min(1, t / 0.35);
  const eased = 1 - (1 - grow) * (1 - grow);
  return 0.55 + eased * 0.51;
}

/** 透明度：前 25% 满亮，之后线性淡到 0（太快的闪一下会像掉帧） */
export function meleeHitOpacityAt(progress: number): number {
  const t = clamp01(progress);
  const fade = t < 0.25 ? 1 : 1 - (t - 0.25) / 0.75;
  // 0.9 封顶：加色下满不透明度会把颜色烧白，和"颜色一致"的目标相反
  return Math.max(0, fade) * 0.9;
}

/**
 * 这一刀的**倾斜角**（弧度，屏幕空间）。
 *
 * 刀要**横着切过**身体，所以取"攻击方向在屏幕上的角度 + 90°"。
 * 调用方（`replay.ts`）把世界方向投影到相机右/上两个轴之后传进来；
 * 这里只做纯计算，方便断言"角度永远是个有限的数"。
 */
export function meleeHitTiltOf(screenAngle: number, jitter: number): number {
  const base = Number.isFinite(screenAngle) ? screenAngle : 0;
  const safeJitter = Number.isFinite(jitter) ? Math.max(-1, Math.min(1, jitter)) : 0;
  return base + Math.PI / 2 + safeJitter * 0.45;
}

/** 每一下的倾角抖动（-1..1），让连续命中不要像复制粘贴 */
export function meleeHitJitterOf(seed: number): number {
  return hash01(seed) * 2 - 1;
}

// ============================================================
//  ④ 贴图（canvas 现画，按颜色缓存）
// ============================================================

const textures = new Map<string, Texture>();

function rgba(color: number, alpha: number): string {
  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * 一道**细长的斜斩痕**（参考用户给的图：细尾 → 亮头的一条直线，不是月牙）。
 *
 * 画法（从后往前叠）：
 *   ① 柔光底：整条画一遍带 `shadowBlur` 的粗线 ⇒ 加色下那圈"雾状"的辉光；
 *   ② 主体：一条**两端渐隐**的细线（线性渐变从 0 → 满 → 0）；
 *   ③ 亮芯：中间再压一条更细、更白的线，只覆盖 35%~95%，读起来是"刀锋"；
 *   ④ 头部亮点 + 几点火星（参考图右上角那一小簇）。
 * ★ 纹理是**横向长条**（不是正方形）：`sprite.scale` 才能做成 4:1 的细长条，
 *   正方形纹理拉成细条会把厚度一起压扁，粗细就不受控了。
 */
function drawHitCanvas(color: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = HIT_TEXTURE_W;
  canvas.height = HIT_TEXTURE_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  const cy = HIT_TEXTURE_H / 2;
  const x0 = HIT_TEXTURE_W * 0.04;
  const x1 = HIT_TEXTURE_W * 0.96;

  // ① 柔光底（粗 + shadowBlur）：这一层负责"在深色棋盘上看得见"
  ctx.save();
  ctx.shadowColor = rgba(color, 0.95);
  ctx.shadowBlur = HIT_TEXTURE_H * 0.36;
  ctx.strokeStyle = rgba(color, 0.42);
  ctx.lineWidth = HIT_TEXTURE_H * 0.22;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x0, cy);
  ctx.lineTo(x1, cy);
  ctx.stroke();
  ctx.restore();

  // ② 主体：两端渐隐的细线（头部那端最亮）
  const body = ctx.createLinearGradient(x0, 0, x1, 0);
  body.addColorStop(0, rgba(color, 0));
  body.addColorStop(0.38, rgba(color, 0.45));
  body.addColorStop(0.86, rgba(color, 1));
  body.addColorStop(1, rgba(color, 0));
  ctx.strokeStyle = body;
  ctx.lineWidth = HIT_TEXTURE_H * 0.16;
  ctx.beginPath();
  ctx.moveTo(x0, cy);
  ctx.lineTo(x1, cy);
  ctx.stroke();

  // ③ 亮芯：只覆盖后半段，中间偏白（加色下单看是"锋"，不会把整条洗白）
  const core = ctx.createLinearGradient(HIT_TEXTURE_W * 0.3, 0, x1, 0);
  core.addColorStop(0, rgba(0xffffff, 0));
  core.addColorStop(0.55, rgba(0xffffff, 0.35));
  core.addColorStop(0.92, rgba(0xffffff, 0.75));
  core.addColorStop(1, rgba(0xffffff, 0));
  ctx.strokeStyle = core;
  ctx.lineWidth = HIT_TEXTURE_H * 0.06;
  ctx.beginPath();
  ctx.moveTo(HIT_TEXTURE_W * 0.3, cy);
  ctx.lineTo(x1, cy);
  ctx.stroke();

  // ④ 头部亮点 + 几点火星（参考图里那一小簇）
  ctx.save();
  ctx.shadowColor = rgba(0xffffff, 0.9);
  ctx.shadowBlur = HIT_TEXTURE_H * 0.45;
  ctx.fillStyle = rgba(0xffffff, 0.85);
  ctx.beginPath();
  ctx.arc(HIT_TEXTURE_W * 0.9, cy, HIT_TEXTURE_H * 0.055, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  for (const [dx, dy, r, alpha] of [
    [0.76, -0.16, 0.022, 0.5],
    [0.82, 0.16, 0.018, 0.42],
    [0.68, 0.2, 0.014, 0.3],
  ] as const) {
    ctx.fillStyle = rgba(color, alpha);
    ctx.beginPath();
    ctx.arc(HIT_TEXTURE_W * dx, cy + HIT_TEXTURE_H * dy, HIT_TEXTURE_H * r, 0, Math.PI * 2);
    ctx.fill();
  }

  return canvas;
}

/**
 * ★ 0.3.2 阿米娅·青色怒火：**能看见的黑**受击痕（普通混合专用）。
 *
 * 加色下纯黑不可见 ⇒ 墨层必须走 `NormalBlending`，画面分三步：
 *   ① 墨底：整条画一遍**不透明深墨**（不发光，就是压在角色身上的那道黑痕）；
 *   ② 刃口：只覆盖中后段的一条细冷光线（青）—— 黑在深色棋盘上没有轮廓会糊掉，
 *      这条线是"这一刀的边缘"；
 *   ③ 头部亮点：刃口末端一颗小冷光点，读作"刀尖落点"。
 *
 * ★ 和加色版刻意的区别：这里**不画**柔光底/火星喷溅 —— 那些是"光"的语言，
 *   墨的语言只有"一道干脆的黑痕"（越素越像刀伤）。
 */
function drawInkHitCanvas(ink: number, rim: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = HIT_TEXTURE_W;
  canvas.height = HIT_TEXTURE_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  const cy = HIT_TEXTURE_H / 2;
  const x0 = HIT_TEXTURE_W * 0.04;
  const x1 = HIT_TEXTURE_W * 0.96;

  // ① 墨底：两端渐隐的粗黑线（头部那端最实）
  const body = ctx.createLinearGradient(x0, 0, x1, 0);
  body.addColorStop(0, rgba(ink, 0));
  body.addColorStop(0.4, rgba(ink, 0.78));
  body.addColorStop(0.9, rgba(ink, 0.95));
  body.addColorStop(1, rgba(ink, 0));
  ctx.strokeStyle = body;
  ctx.lineWidth = HIT_TEXTURE_H * 0.3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x0, cy);
  ctx.lineTo(x1, cy);
  ctx.stroke();

  // ② 刃口：中后段的细冷光线
  const edge = ctx.createLinearGradient(HIT_TEXTURE_W * 0.34, 0, x1, 0);
  edge.addColorStop(0, rgba(rim, 0));
  edge.addColorStop(0.5, rgba(rim, 0.5));
  edge.addColorStop(0.92, rgba(rim, 0.9));
  edge.addColorStop(1, rgba(rim, 0));
  ctx.strokeStyle = edge;
  ctx.lineWidth = HIT_TEXTURE_H * 0.1;
  ctx.beginPath();
  ctx.moveTo(HIT_TEXTURE_W * 0.34, cy);
  ctx.lineTo(x1, cy);
  ctx.stroke();

  // ③ 头部亮点（比加色版的小、也不带白芯 —— 墨刃的落点是"冷光"，不是"爆闪"）
  ctx.save();
  ctx.shadowColor = rgba(rim, 0.8);
  ctx.shadowBlur = HIT_TEXTURE_H * 0.3;
  ctx.fillStyle = rgba(rim, 0.9);
  ctx.beginPath();
  ctx.arc(HIT_TEXTURE_W * 0.9, cy, HIT_TEXTURE_H * 0.05, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  return canvas;
}

/**
 * 取（或第一次生成）某个样式的受击贴图。
 *
 * ★ 0.3.2：缓存键从"颜色"换成"样式"（墨底 + 刃口 + 混合方式）——
 *   两把钥匙相同才算同一张贴图。
 */
export function meleeHitTextureOf(style: MeleeSlashStyle): Texture {
  const key = `${style.blend ?? 'add'}:${style.ink ?? 0}:${style.color}`;
  const cached = textures.get(key);
  if (cached) return cached;
  const texture = new CanvasTexture(
    style.blend === 'normal' ? drawInkHitCanvas(style.ink ?? 0x05070b, style.color) : drawHitCanvas(style.color),
  );
  // ★ 不写 colorSpace 会发灰（note-fx / unit-aura / heal-halo 都是同一个坑）
  texture.colorSpace = SRGBColorSpace;
  texture.needsUpdate = true;
  textures.set(key, texture);
  return texture;
}

// ============================================================
//  ⑤ 实例管理
// ============================================================

interface HitInstance {
  sprite: Sprite;
  material: SpriteMaterial;
  age: number;
  /** 起点（受击者身上），用来看"要不要跟着人走"——这里不跟：0.18 秒内人几乎不会挪 */
  baseX: number;
  baseZ: number;
  baseY: number;
}

let root: Object3D | null = null;
const hits: HitInstance[] = [];

/** 把特效挂到哪个根节点上（`replay.ts` 构造时调一次） */
export function attachMeleeHitRoot(scene: Object3D): void {
  root = scene;
}

/**
 * 在受击者身上放一道斩击痕。
 *
 * @param x,z    受击者的世界坐标（一般再往攻击者方向偏 `MELEE_HIT_OFFSET`）
 * @param style  受击样式（由 `meleeHitStyleOf` 算出；0.3.2 起从"一个颜色"升级为"样式"）
 * @param tilt   屏幕空间的倾斜角（`meleeHitTiltOf`）
 * @param seed   抖动种子（一般用 攻击者id*31+受击者id，保证可复现）
 * @param y      挂在多高（默认 `MELEE_HIT_HEIGHT`；传受击者自己的视觉中心最准）
 */
export function spawnMeleeHit(
  x: number,
  z: number,
  style: MeleeSlashStyle,
  tilt: number,
  seed: number,
  y: number = MELEE_HIT_HEIGHT,
): void {
  if (!root) return;
  while (hits.length >= MAX_LIVE_MELEE_HITS) {
    const oldest = hits.shift();
    if (oldest) {
      root.remove(oldest.sprite);
      oldest.material.dispose();
    }
  }
  const ink = style.blend === 'normal';
  const material = new SpriteMaterial({
    map: meleeHitTextureOf(style),
    transparent: true,
    opacity: 0,
    /*
      ★ 加色：只往上加光、不盖色块 ⇒ 天然不遮挡角色（被模仿的斩击贴图也是加色）。
      ★ 墨（0.3.2）：普通混合 —— 纯黑在加色下什么都不是，黑痕必须"盖"在角色身上
        才读得出"挨了一刀"。透明度曲线把墨层封在 0.9，不会完全糊死角色。
    */
    blending: ink ? NormalBlending : AdditiveBlending,
    depthWrite: false,
    /*
      ★★ `depthTest: false`：这一刀要**整条**跨在受击者身上。
      开着深度测试的话，刀痕中段会被角色自己的精灵挡掉，看起来是"断成两截"
      （真机截图确认过）。它只有 0.22 秒、又是加色，画在最上面没有副作用。
    */
    depthTest: false,
  });
  const height = Number.isFinite(y) ? y : MELEE_HIT_HEIGHT;
  const sprite = new Sprite(material);
  sprite.renderOrder = RENDER_ORDER_FX;
  sprite.position.set(x, height, z);
  // ★ 非等比：长 0.72 × 厚 0.18（纹理是 4:1，所以这里是 1:1 的拉伸，不会变形）
  sprite.scale.set(MELEE_HIT_LENGTH, MELEE_HIT_THICKNESS, 1);
  material.rotation = tilt;
  root.add(sprite);
  hits.push({ sprite, material, age: 0, baseX: x, baseZ: z, baseY: height });
  // 抖动只影响倾角，已经算进 tilt 里了；seed 留着给以后加"偏移/长短"用
  void seed;
}

/** 每帧推进（缩放 + 淡出 + 回收） */
export function updateMeleeHitFx(deltaSeconds: number): void {
  for (let i = hits.length - 1; i >= 0; i--) {
    const hit = hits[i]!;
    hit.age += deltaSeconds;
    if (hit.age >= MELEE_HIT_SECONDS) {
      root?.remove(hit.sprite);
      hit.material.dispose();
      hits.splice(i, 1);
      continue;
    }
    const t = hit.age / MELEE_HIT_SECONDS;
    const k = meleeHitScaleAt(t);
    // ★ 长宽各自乘同一个系数（等比放大），比例才不会走样
    hit.sprite.scale.set(MELEE_HIT_LENGTH * k, MELEE_HIT_THICKNESS * k, 1);
    hit.material.opacity = meleeHitOpacityAt(t);
  }
}

/** 清掉所有受击痕（重开一局 / 收尾） */
export function clearMeleeHitFx(): void {
  for (const hit of hits) {
    root?.remove(hit.sprite);
    hit.material.dispose();
  }
  hits.length = 0;
}

/** 测试/调试用：现在场上有几道受击痕 */
export function meleeHitLiveCount(): number {
  return hits.length;
}
