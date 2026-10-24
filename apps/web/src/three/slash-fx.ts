/**
 * ============================================================
 *  ★ 0.1.3：锏的「疯狂斩击」特效 —— **月牙刀光**
 * ============================================================
 *
 * 【它是什么？】
 * 锏开技能的那 2 秒里，每 0.2 秒斩一刀（共 10 刀）。每一刀在棋盘上就是
 * **一道以锏自己为圆心的月牙**：外弧亮、内缘收、两端渐隐，
 * 再在刀锋那头补一个"命中爆闪"。
 *
 * 【为什么是月牙，不是直线折线？】
 * 斩击提案画过两版：一版是"锐角折线（√ 骨架）"，一版是"月牙"。
 * 折线那版单看很锐，但**俯视且快速连闪**时，几条折线叠在一起会读成
 * 一团锯齿噪点；月牙是弧，弧在俯视视角下有明确的"扫过去"的方向感，
 * 十道交错时反而更乱、更像"疯狂乱刀"。用户最终定的就是月牙版
 * （提案稿在 `.fx-proposal/slash-deepyellow.html`）。
 *
 * 【颜色为什么是深黄？】
 * 用户口径："主题以深黄色为主"。整套只有三档，和提案稿一致：
 *   高光 #ffe08a / 主色 #e0a828 / 暗部 #8a5c10，刀刃那道细线用近白的 #fff0be。
 * ★ 加色混合（AdditiveBlending）天然往白走，所以主体色刻意压在饱和的金上，
 *   不用接近白的色值（那会变成一片灰雾 —— unit-aura.ts 踩过同一个坑）。
 *
 * 【为什么走"贴图 + 贴地平面"，而不是自己搭几何？】
 * 月牙的**径向渐变**和**两端渐隐**是这张图的灵魂：
 *   内缘透明 → 中段主色 → 外缘高光 → 最外圈再透明。
 * 用 canvas 画出来最省事也最好调（和 `unit-aura.ts` 同一套做法），
 * 形状/渐变改一行就能看效果；搭 BufferGeometry 还得自己写顶点色。
 *
 * 【为什么贴图是共享的？】
 * 所有刀光**长得一模一样**（只有大小、朝向不同），按张角档缓存 3 张就够，
 * 十刀连斩也只有 3 张 canvas。
 *
 * 【为什么要挂在 `slash` 事件上？】
 * 和攻击特效同一个道理：战斗是**按 tick 重放事件流**的。
 * 内核在"这一跳真的结算了"的那一刻记一条 `slash`（见 shared/skills.ts），
 * 所以"跳一次 = 挥一刀"，两倍速 / 断线重连接上 / 看录像全都自动正确。
 * 自己开 setTimeout 这三条全错。
 *
 * ★ 这个模块只负责"一刀长什么样、多大、多久、怎么淡出"；
 *   场景里怎么摆、什么时候回收由 `replay.ts` 管（和 attack-fx.ts 的分工一致）。
 */
import {
  AdditiveBlending,
  CanvasTexture,
  DoubleSide,
  Group,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SRGBColorSpace,
} from 'three';
// ★ "一格多大"从 grid 取（唯一来源）
import { CELL } from '../game/grid.js';
import { RENDER_ORDER_FX } from './card-layout.js';

/**
 * ★ 深黄主题的三档色 + 刀刃那道近白的线。
 *
 * 【为什么写成字符串？】因为它们是给 canvas 的 `rgba()` 用的；
 * 测试里断言的也是这三个十六进制（用户定的口径，不许随便改）。
 */
export const SLASH_PALETTE = {
  hi: '255,224,138', // #ffe08a 高光
  main: '224,168,40', // #e0a828 主色
  deep: '138,92,16', // #8a5c10 暗部
  edge: '255,240,190', // #fff0be 刀刃细线
} as const;

/** 一刀的存活时长（秒） */
export const SLASH_DURATION_SECONDS = 0.44;

/*
  【为什么是 0.44 秒，比攻击特效（0.13~0.30）长？】
  锏是每 0.2 秒一刀，刀光的寿命必须**明显长过 0.2 秒**：
  0.34 秒时画面上只有"当前这一刀 + 上一刀的残影"两道（截图确认过），
  和提案稿里"永远有 3~4 道交错"的观感差一截；
  0.44 秒刚好让**三道**同时在场（一亮 + 一淡 + 一缕），这才是"疯狂乱刀"。
  ★ 也别再往上加：到 0.6 秒就是四五道叠在一起，糊成一团光幕，
    反而看不出"一刀一刀在斩"。
*/

/** 月牙的内外半径比（0.5 = 刀身占外半径的一半，留出内圈才像一道刃而不是一块饼） */
export const SLASH_INNER_RATIO = 0.5;

/**
 * 三档张角（弧度）。
 *
 * 【为什么分三档而不是每刀一个随机值？】
 * 张角是**烘进贴图**的（见上面"为什么走贴图"），真随机就得每张都新建一张 canvas；
 * 三档够撑出"每一刀不一样"的观感，而贴图只有 3 张。
 */
export const SLASH_SPREAD_VARIANTS = [0.52, 0.64, 0.76] as const;

/** 三档刀身长度（倍率，乘在基准长度上） */
export const SLASH_REACH_VARIANTS = [0.82, 0.94, 1.06] as const;

/**
 * 技能半径 1 对应几格。
 *
 * 锏的范围是 `radius: 2`（星形：周围 3×3 并上十字 2 格），
 * 但刀光**不该铺满整个范围** —— 铺满就成了"地上亮了一下"，
 * 看不出是一刀。取 0.8 格/半径单位，2 格范围 ≈ 1.6 格长的刀，
 * 正好是提案稿里"一格半到两格"那个手感。
 */
export const SLASH_CELLS_PER_RADIUS = 0.8;

/** 命中爆闪挂在刀身多远处（相对刀长的比例）—— 大约"刀锋扫到的那一点" */
export const SLASH_FLASH_RATIO = 0.72;

/** 同屏刀光上限（超了丢最老的 —— 和攻击特效同一个道理） */
export const MAX_LIVE_SLASH_FX = 24;

/** 贴图画布边长（正方形，圆心在正中） */
const SLASH_TEXTURE_SIZE = 256;

/**
 * 月牙外弧半径占画布边长的比例。
 * 取 0.47（不到 0.5）是为了给刀刃那道细线留描边余量，否则会被画布裁掉。
 */
const SLASH_ARC_RATIO = 0.47;

/** 爆闪贴图边长 */
const FLASH_TEXTURE_SIZE = 128;

/**
 * 第 `seq` 刀的形状（纯函数 → 可单测，也让"每一刀都不一样"可复现）。
 *
 * @param seq 这个单位挥出的第几刀（从 0 开始）
 */
export function slashShapeOf(seq: number): { yaw: number; spreadIndex: number; reachIndex: number } {
  const i = Math.max(0, Math.floor(seq));
  /*
    朝向：每刀转 1.15 弧度（约 66°），起手偏 0.35。
    【为什么是这个步长？】它和 3、10 都互质，连斩 10 刀不会转回原处重合成一道，
    看上去才是"乱刀"而不是"风车"。
  */
  const yaw = (i * 1.15 + 0.35) % (Math.PI * 2);
  /*
    张角每刀换一档（i % 3），长度每三刀换一档（⌊i/3⌋ % 3）——
    于是**九刀之内没有重复组合**（3 × 3 = 9），十连斩里每一刀的形状都不一样。
    ★ 别写成 `(i*5)%3` + `(i*7)%3`：那两个其实是 2i%3 和 i%3，
    组合只有 3 种，九刀里会重复三轮（看起来又变回风车了）。
  */
  return { yaw, spreadIndex: i % 3, reachIndex: Math.floor(i / 3) % 3 };
}

/** 一刀的刀身长度（世界单位） */
export function slashReachWorld(radius: number, reachIndex: number): number {
  const variant = SLASH_REACH_VARIANTS[((reachIndex % 3) + 3) % 3] ?? 1;
  return radius * SLASH_CELLS_PER_RADIUS * CELL * variant;
}

/**
 * 两端渐隐的强度（0~1）。
 *
 * 【为什么要它？】月牙如果整段一样亮，看起来是一块"弯饼干"；
 * 两头淡下去，眼睛才读成"刀锋扫过留下的痕"。
 * 用 `sin(πu)` 的幂次：中间满、两头收到 `SLASH_TIP_MIN`。
 */
const SLASH_TIP_MIN = 0.32;

function tipFade(ratio: number): number {
  const u = Math.max(0, Math.min(1, ratio));
  return SLASH_TIP_MIN + (1 - SLASH_TIP_MIN) * Math.pow(Math.sin(Math.PI * u), 0.7);
}

/**
 * 画一张月牙刀光。
 *
 * 【为什么按角度切片画，而不是一次画完？】
 * 因为要"两端渐隐"：canvas 没有沿角度的遮罩（conic-gradient 兼容性不放心），
 * 所以把整段弧切成一片片小扇形，每片乘以自己的 `tipFade`，
 * 视觉上就是两端自然淡出。片与片之间只留**发丝那么细的补缝量**（`OVERLAP`），
 * 既能盖住接缝的细线，又不会叠出一道道竖棱（见下面那段说明）。
 */
function drawSlash(spread: number): HTMLCanvasElement {
  const S = SLASH_TEXTURE_SIZE;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, S, S);

  const c = S / 2;
  const R = S * SLASH_ARC_RATIO;
  const inner = R * SLASH_INNER_RATIO;

  ctx.save();
  ctx.translate(c, c);

  /*
    ★ 切片的**重叠量必须极小**（0.003 弧度 ≈ 0.17°）。
    第一版给的是 0.06（≈3.4°），本想在接缝处"补一点"防止出现细缝，
    结果是：普通合成下相邻两片重叠的地方 alpha 会累加，画出来是**一道道竖棱**，
    整条月牙看着像把扇子 —— 真机截图一眼就看出来了。
    现在只留一条发丝的补缝量，既没有缝、也没有棱。
  */
  const SLICES = 26;
  const OVERLAP = 0.003; // 弧度
  for (let i = 0; i < SLICES; i++) {
    const a0 = -spread + ((2 * spread) / SLICES) * i;
    const a1 = -spread + ((2 * spread) / SLICES) * (i + 1) + OVERLAP;
    const mid = (a0 + a1) / 2;
    const alpha = tipFade((mid + spread) / (2 * spread));

    ctx.beginPath();
    ctx.arc(0, 0, R, a0, a1);
    ctx.arc(0, 0, inner, a1, a0, true);
    ctx.closePath();

    const g = ctx.createRadialGradient(0, 0, inner * 0.96, 0, 0, R);
    g.addColorStop(0, `rgba(${SLASH_PALETTE.deep},0)`);
    g.addColorStop(0.55, `rgba(${SLASH_PALETTE.main},${0.6 * alpha})`);
    g.addColorStop(0.9, `rgba(${SLASH_PALETTE.hi},${1 * alpha})`);
    g.addColorStop(1, `rgba(${SLASH_PALETTE.hi},0)`);
    ctx.fillStyle = g;
    ctx.fill();
  }

  // 刀刃那道最亮的细线（让"快"这个感觉立住）
  ctx.beginPath();
  ctx.arc(0, 0, R * 0.93, -spread * 0.92, spread * 0.92);
  ctx.strokeStyle = `rgba(${SLASH_PALETTE.edge},0.9)`;
  ctx.lineWidth = S * 0.012;
  ctx.stroke();

  ctx.restore();
  return canvas;
}

/** 命中爆闪：一点亮黄 + 四道短芒（提案稿的 `hitFlash`） */
function drawFlash(): HTMLCanvasElement {
  const S = FLASH_TEXTURE_SIZE;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, S, S);

  const c = S / 2;
  const r = S * 0.3;

  const g = ctx.createRadialGradient(c, c, 0, c, c, r);
  g.addColorStop(0, `rgba(255,248,220,1)`);
  g.addColorStop(0.45, `rgba(${SLASH_PALETTE.main},0.6)`);
  g.addColorStop(1, `rgba(${SLASH_PALETTE.deep},0)`);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(c, c, r, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = `rgba(${SLASH_PALETTE.hi},0.85)`;
  ctx.lineWidth = S * 0.018;
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    ctx.beginPath();
    ctx.moveTo(c + Math.cos(a) * r * 0.35, c + Math.sin(a) * r * 0.35);
    ctx.lineTo(c + Math.cos(a) * r * 1.2, c + Math.sin(a) * r * 1.2);
    ctx.stroke();
  }
  return canvas;
}

function toTexture(canvas: HTMLCanvasElement): CanvasTexture {
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace; // ★ 不写颜色会被冲淡（见 unit-aura.ts 的同名说明）
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

const slashTextureCache = new Map<number, CanvasTexture>();

/** 取某一档张角的刀光贴图（按档缓存，全局共享） */
export function slashTextureOf(spreadIndex: number): CanvasTexture {
  const key = ((spreadIndex % SLASH_SPREAD_VARIANTS.length) + SLASH_SPREAD_VARIANTS.length) %
    SLASH_SPREAD_VARIANTS.length;
  const cached = slashTextureCache.get(key);
  if (cached) return cached;
  const texture = toTexture(drawSlash(SLASH_SPREAD_VARIANTS[key] ?? 0.64));
  slashTextureCache.set(key, texture);
  return texture;
}

let flashTextureCache: CanvasTexture | null = null;

/** 命中爆闪贴图（全场共用一张） */
export function slashFlashTexture(): CanvasTexture {
  if (!flashTextureCache) flashTextureCache = toTexture(drawFlash());
  return flashTextureCache;
}

// ============================================================
// 动画曲线（纯函数，渲染层每帧按 progress 取值）
// ============================================================

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

/**
 * 刀身的缩放：**先张开、再余势**。
 * 前 30% 从 0.86 冲到 1（挥出去），之后缓慢涨到 1.06 —— 不做"缩回 0"的收尾，
 * 因为刀是**扫过去**的，缩回去就变成"长出来又缩回去"，很假。
 */
export function slashScaleAt(progress: number): number {
  const t = clamp01(progress);
  const grow = Math.min(1, t / 0.3);
  const eased = 1 - (1 - grow) * (1 - grow);
  return 0.86 + eased * 0.14 + t * 0.06;
}

/** 命中爆闪：0.5 冲到 1.15，再慢慢落回 0.9（"炸"一下再收） */
export function slashFlashScaleAt(progress: number): number {
  const t = clamp01(progress);
  if (t < 0.3) return 0.5 + (t / 0.3) * 0.65;
  return 1.15 - ((t - 0.3) / 0.7) * 0.25;
}

/**
 * 透明度：前 15% 保持峰值，之后线性淡出到 0。
 * 留那一段满亮度是因为"瞬间出现又瞬间消失"会像掉帧。
 */
export function slashOpacityAt(progress: number): number {
  const t = clamp01(progress);
  const fade = t < 0.15 ? 1 : 1 - (t - 0.15) / 0.85;
  return Math.max(0, fade);
}

// ============================================================
// 场景里的一刀
// ============================================================

export interface SlashFxPart {
  mesh: Mesh;
  geometry: PlaneGeometry;
  material: MeshBasicMaterial;
  kind: 'blade' | 'flash';
}

export interface SlashFx {
  /** 挂在场景里的壳（位置 = 施法者脚下，rotation.y = 这一刀的朝向） */
  holder: Group;
  parts: SlashFxPart[];
  /** 整刀的时长（秒） */
  duration: number;
  /** 剩余寿命（秒） */
  life: number;
}

export interface SlashFxSpawnOptions {
  /** 施法者脚下（世界坐标） */
  x: number;
  z: number;
  /** 内核给的技能半径（锏是 2） */
  radius: number;
  /** 这个单位挥出的第几刀 */
  seq: number;
  /** 贴地高度（和范围框同一档，见 replay 的 ZONE_Y） */
  y: number;
}

/**
 * 造一刀。
 *
 * 【两块贴地薄片】
 *   · 月牙刀身 —— 圆心就在施法者脚下，朝 `yaw` 方向张开；
 *   · 命中爆闪 —— 挂在刀身 72% 处（"刀锋扫到的那一点"）。
 *
 * ★ 爆闪的位置**只由刀自己的形状和朝向算出来**，不去扫棋盘上有哪些敌人 ——
 *   渲染层的铁律是"只读事件流，不自己重算命中范围"（见 replay 顶部说明），
 *   而且这样它才跟得上"两倍速/接上重连"。
 */
export function createSlashFx(opts: SlashFxSpawnOptions): SlashFx {
  const { yaw, spreadIndex, reachIndex } = slashShapeOf(opts.seq);
  const reach = slashReachWorld(opts.radius, reachIndex);

  const holder = new Group();
  holder.position.set(opts.x, opts.y, opts.z);
  holder.rotation.y = yaw;

  const parts: SlashFxPart[] = [];

  /** 摆一块贴地的薄片 */
  const addFlat = (
    kind: SlashFxPart['kind'],
    localX: number,
    size: number,
    map: CanvasTexture,
    lift: number,
  ): void => {
    const geometry = new PlaneGeometry(size, size);
    const material = new MeshBasicMaterial({
      map,
      transparent: true,
      opacity: 1,
      // 加色混合：把地面提亮，而不是盖一张半透明的黄纸
      blending: AdditiveBlending,
      side: DoubleSide,
      depthWrite: false,
    });
    const mesh = new Mesh(geometry, material);
    // PlaneGeometry 在 XY 平面上，转 -90° 才是贴地
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(localX, lift, 0);
    /*
      ★★ 0.2（用户报"刀光会被敌怪挡住"）：整个刀光必须画在**所有棋子精灵之上**。
      刀光和外圈的棋子卡面在投影后几乎同一个深度，而两边都是透明物体
      （卡面和这里都 depthWrite: false ⇒ 深度测试不参与"谁压谁"），
      three.js 只能按距离排 —— 于是会随机被卡面盖住。
      `RENDER_ORDER_FX` 比棋子那几层（0~3）高，一定最后画。
      ★ 位置（y）一个数都没动：用户明确说这是图层问题，不是高度问题。
    */
    mesh.renderOrder = RENDER_ORDER_FX;
    holder.add(mesh);
    parts.push({ mesh, geometry, material, kind });
  };

  /*
    刀身平面的边长：贴图里外弧半径是画布边长的 0.47，
    所以"外弧半径 = reach"对应的平面边长是 `reach / 0.47`。
    ★ 别直接用 2*reach —— 那会让刀比实际短一截（渐变的最外圈被吃掉）。
  */
  addFlat('blade', 0, reach / SLASH_ARC_RATIO, slashTextureOf(spreadIndex), 0);
  addFlat(
    'flash',
    reach * SLASH_FLASH_RATIO,
    reach * 0.72,
    slashFlashTexture(),
    0.01, // 压在刀身之上一点点，免得被刀身的加色叠成一块白
  );

  return { holder, parts, duration: SLASH_DURATION_SECONDS, life: SLASH_DURATION_SECONDS };
}

/** 从场景里摘掉一刀并释放显存（Three.js 不会自动回收几何体和材质） */
export function disposeSlashFx(fx: SlashFx): void {
  for (const part of fx.parts) {
    fx.holder.remove(part.mesh);
    part.geometry.dispose();
    part.material.dispose();
  }
}
