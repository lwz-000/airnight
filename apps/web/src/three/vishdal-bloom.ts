/**
 * ============================================================
 *  ★ 0.2：维什戴尔 3 星「毁灭合奏」的 5×5 爆炸特效
 * ============================================================
 *
 * 【它是什么？】
 * 维什戴尔到 3 星之后，技能给的 6 发弹药每一发都会变成
 * **5×5 范围物理伤害（倍率 1000%）** —— 每打出一发，就在被打中的那一格
 * 炸开一片红黑色爆炸。这个模块负责"那一炸长什么样"。
 *
 * 【三张图、三种混法】（美术稿在 `特效图/vishdal_bloom_*`，见 `docs/特效图制作规格书.md`）
 *   · `_ring`  火焰主层  10 帧 —— **加色混合**（把颜色加到地面上）
 *   · `_smoke` 黑烟      10 帧 —— **普通混合**（那才是真正的黑）
 *   · `_core`  中心炸点  10 帧 —— **加色混合**
 *
 * ★★ 【为什么"黑"要单独一层、还要切断混合方式？】
 * 加色混合是"把颜色加到底色上"：**纯黑 = 加了个 0 = 完全看不见**。
 * 所以主层里的"黑"只能用深红（#84120e / #2c0604）充当 —— 观感是黑的，但它真的在发光。
 * 要真正的黑烟，就必须单独一层走 `NormalBlending`（把底色遮暗）。
 * 用户口径是"红色为主、黑色为副"，这两个"黑"缺一不可。
 *
 * 【为什么走"贴图 + 贴地平面"，而不是自己搭几何？】
 * 和锏的刀光（`slash-fx.ts`）完全同一个理由：火焰的不规则外缘、
 * 中心白热到外围深红的径向渐变，那是**画在图里的**；用几何硬搭要写一堆顶点色，
 * 而且每改一版就得重写。图还能交给美术/别的工具出（见规格书）。
 *
 * 【为什么贴图是共享的、但每个爆炸各拿一份"指针"？】
 * 一张序列帧 PNG 有 10 帧，播到第几帧是靠 `texture.offset.x` 控制的 ——
 * 那是**每个爆炸各自的进度**，不能共用一个 texture 对象（否则后炸的那个
 * 会把先炸的那个的进度也拽走，画面会跳帧）。
 * 但整张图只需要往显卡传一次：`texture.clone()` 在 three.js 里是**共享 `Source`** 的
 * （`Texture.copy` 里 `this.source = source.source`，而 WebGLTextures 按 Source 缓存
 * 上传结果），所以 clone 出来的只是"另一个指针"，不会把 3 MB 的图再传一遍。
 *
 * 【为什么要挂在 `bloom` 事件上？】
 * 和攻击特效/刀光同一个道理：战斗是**按 tick 重放事件流**的。
 * 内核在"这一发范围伤害真的结算了"的那一刻记一条 `bloom`
 * （见 `shared/rules.ts` 的溅射那一段），所以两倍速 / 断线重连接上 / 看录像
 * 全都自动正确。自己开 setTimeout 这三条全错。
 *
 * ★ 这个模块只负责"一炸长什么样、多大、多久、播到第几帧"；
 *   场景里怎么摆、什么时候回收由 `replay.ts` 管（和 `attack-fx.ts` 的分工一致）。
 */
import {
  AdditiveBlending,
  ClampToEdgeWrapping,
  DoubleSide,
  Group,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  NormalBlending,
  PlaneGeometry,
  SRGBColorSpace,
  Texture,
  type Blending,
} from 'three';
// ★ "一格多大"从 grid 取（唯一来源）
import { CELL } from '../game/grid.js';
import { getLoadedImage, loadImage } from './assets.js';
import { RENDER_ORDER_FX } from './card-layout.js';

/** 每一层怎么播、怎么混 */
export interface BloomLayerSpec {
  /** 贴图路径（相对 `apps/web/public/assets/`） */
  path: string;
  /** 混合方式：加色（火焰）/ 普通（黑烟） */
  blending: Blending;
  /** 这一层铺开的宽度 = 爆炸跨度的百分之多少（1 = 正好铺满） */
  spanRatio: number;
  /** 画在别的贴片之上多少（防止加色层叠成一块白） */
  lift: number;
}

/**
 * 一层盖满整张画布的那套（火焰主层 / 黑烟）：跨度 1.0。
 *
 * 【为什么是 1.0 而不是更大？】
 * 图里的火**最远画到画布边长的 0.94**（见出图脚本的 `R = W * 0.47`），
 * 所以平面取"正好 5 格"时，火实际盖到 4.7 格 —— 既贴住范围框、又留了渐隐余量。
 * 画得比 5 格更大的话，火会溢出范围白框，玩家会以为技能范围更大
 * （规格书 §3 第 6 条：说几格就画几格）。
 */
const FULL_SPAN_LAYERS: BloomLayerSpec[] = [
  {
    path: 'fx/vishdal_bloom_smoke.png',
    // ★★ 普通混合：黑烟要**遮暗**地面才是黑的（加色混合下黑色等于不存在）
    blending: NormalBlending,
    spanRatio: 1,
    lift: 0,
  },
  {
    path: 'fx/vishdal_bloom_ring.png',
    blending: AdditiveBlending,
    spanRatio: 1,
    lift: 0.002,
  },
  {
    path: 'fx/vishdal_bloom_core.png',
    blending: AdditiveBlending,
    // 中心炸点只占 5×5 里的一小块（原图就是按"中心那一下"画的，不是铺满）
    spanRatio: 0.42,
    lift: 0.004,
  },
];

/** 每套图各几帧、每秒几帧（和 `manifest.json` 一致，改图时两边一起改） */
export const BLOOM_FRAMES = 10;
export const BLOOM_FPS = 24;

/** 一次爆炸从第一帧播到最后一帧要多久（秒） */
export const BLOOM_DURATION_SECONDS = BLOOM_FRAMES / BLOOM_FPS;

/** 同屏爆炸上限（超了丢最老的 —— 和攻击特效/刀光同一个道理） */
export const MAX_LIVE_BLOOM_FX = 8;

/**
 * ★ **特效注册表**：数据表里 `splash.fx` 写的字符串 → 用哪几层图。
 *
 * 【为什么要一张表，而不是在渲染里判断"这是谁的技能"？】
 * 因为"这一发溅射该播哪套特效"的唯一真相在**数据表**里
 * （见 `types.ts` 的 `SkillStats.splash.fx`），内核把它原样塞进 `bloom` 事件。
 * 渲染层拿到的就是一个字符串，查表即可 —— 不用（也不该）知道 op45 是谁。
 * 以后给别的干员加爆炸，只要：数据里写个 `fx: 'xxx'` + 在这里加一行。
 */
/**
 * ★ 0.2.1：凯尔希·思衡托 3 星「保护性拒止」的 **3×3 真实伤害**爆发
 * （美术包 `kalts_nova`，格式和内建 bloom 完全一致：10 帧 / 24fps / 每帧正方形）。
 *
 * 三层分工照美术包的参数表，一格没改：
 *   · `_smoke` 暗红尘土 —— **普通混合**（唯一能"压暗"地面的一层，加色混合下暗色等于不存在）
 *   · `_ring`  冲击火墙 —— 加色，铺满 3 格
 *   · `_core`  白热火球 —— 加色，只占中心 1.25 格（spanRatio 0.42 = 美术包给的数）
 */
const KALTS_NOVA_LAYERS: BloomLayerSpec[] = [
  { path: 'fx/kalts_nova_smoke.png', blending: NormalBlending, spanRatio: 1, lift: 0 },
  { path: 'fx/kalts_nova_ring.png', blending: AdditiveBlending, spanRatio: 1, lift: 0.002 },
  { path: 'fx/kalts_nova_core.png', blending: AdditiveBlending, spanRatio: 0.42, lift: 0.004 },
];

/**
 * ★★ 0.2.1：菲亚梅塔技能「轰击」的 **5×5 凤凰爆炸**（美术包 `fiammetta_phoenix_*`）。
 *
 * 和上面两套的区别：**三层都铺满 5 格**（`spanRatio 1`）——
 * 别的爆炸的 core 层只是"中心那一小块"，而这一套的凤凰图标本身就要占满中间，
 * 所以不能按 0.42 缩。层序照旧：烟（普通）→ 火旋风（加色）→ 凤凰（加色）。
 *
 * ★ 用户口径（2026-10-18）：火旋风偏橙、凤凰偏红；凤凰没有头，只有火羽。
 */
const FIAMMETTA_PHOENIX_LAYERS: BloomLayerSpec[] = [
  { path: 'fx/fiammetta_phoenix_smoke.png', blending: NormalBlending, spanRatio: 1, lift: 0 },
  { path: 'fx/fiammetta_phoenix_ring.png', blending: AdditiveBlending, spanRatio: 1, lift: 0.002 },
  { path: 'fx/fiammetta_phoenix_core.png', blending: AdditiveBlending, spanRatio: 1, lift: 0.004 },
];

export const BLOOM_FX: Record<string, BloomLayerSpec[]> = {
  vishdal_bloom: FULL_SPAN_LAYERS,
  kalts_nova: KALTS_NOVA_LAYERS,
  fiammetta_phoenix: FIAMMETTA_PHOENIX_LAYERS,
  /*
    ★ 0.2.1 追加：夕（op02）技能的**十字白墨**。
    她技能给的溅射是 `shape: 'cross'`、`radius: 1` ⇒ 爆炸跨度就是 3×3，
    图里画的是一个"正十字"（只覆盖中心 + 上下左右 4 格，四角的格子是空的）。
    ★ 两层：黑墨底（**普通混合** —— 加色下纯黑等于不存在）+ 白墨（加色）。
  */
  ink_cross_white: [
    { path: 'fx/ink_cross_dark.png', blending: NormalBlending, spanRatio: 1, lift: 0 },
    { path: 'fx/ink_cross_white.png', blending: AdditiveBlending, spanRatio: 1, lift: 0.002 },
  ],
  /*
    ★ 0.2.1 追加：天火（op12）技能的 **3×3 橙红大爆炸**。
    她的技能把普攻换成 `splash: { radius: 1, shape: 'square' }` ⇒ 3×3。
    烟（普通混合）在下、火（加色）在上；火的内外色相是分开的（橙黄芯 → 暗红外缘）。
  */
  skyfire_nova: [
    { path: 'fx/skyfire_nova_smoke.png', blending: NormalBlending, spanRatio: 1, lift: 0 },
    { path: 'fx/skyfire_nova_fire.png', blending: AdditiveBlending, spanRatio: 1, lift: 0.002 },
  ],
};

/**
 * 一层的贴图（原图，未 clone）。
 * 按 `path` 缓存，全场只留一份 —— 每个爆炸再 clone 出自己那份"帧指针"。
 */
const baseTextureCache = new Map<string, Texture>();

/** 已经发起过加载的路径（避免同一个 URL 反复请求） */
const requested = new Set<string>();

function baseTextureOf(spec: BloomLayerSpec): Texture | null {
  const cached = baseTextureCache.get(spec.path);
  if (cached) return cached;
  const image = getLoadedImage(spec.path);
  if (!image) {
    /*
      还没加载好就别硬等 —— 每帧都试着取一次（`getLoadedImage` 是同步查缓存），
      加载完的那一帧自然就接上了。不在这里 await，是因为这里是渲染循环。
    */
    if (!requested.has(spec.path)) {
      requested.add(spec.path);
      void loadImage(spec.path).then((loaded) => {
        if (!loaded) return;
        baseTextureCache.set(spec.path, textureFromImage(loaded));
      });
    }
    return null;
  }
  const texture = textureFromImage(image);
  baseTextureCache.set(spec.path, texture);
  return texture;
}

function textureFromImage(image: HTMLImageElement): Texture {
  const texture = new Texture(image);
  // ★ 不写颜色空间会被冲淡（同 slash-fx.ts / unit-aura.ts 的说明）
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}

/**
 * 已经 clone 出来、当前**空闲**的帧指针（按贴图路径分组，用完还回来）。
 *
 * 【为什么要池子？】
 * clone 出来的 texture 一旦 dispose，three.js 的引用计数归零 ⇒ **GL 纹理被删掉**，
 * 下一次爆炸就得把整张图重新传一遍显存。而火焰主层那张是 **10240×1024**
 * （一千多万像素），重传一次能卡出一个掉帧 —— 偏偏就卡在"爆炸刚出现"那一帧。
 * 所以释放时不真删，放回池子；下一次爆炸直接拿现成的。
 *
 * 【为什么每层最多囤 2 个？】
 * 实战里一次爆炸 0.42 秒、两发弹药间隔约 1 秒，**同时最多一两炸**；
 * 囤 2 个足够覆盖"上一个刚结束、这一个刚开始"的交接。
 * 再多就是白占显存（每张 40 MB 级别），不如让它 dispose 掉。
 */
const idleTextures = new Map<string, Texture[]>();
const MAX_IDLE_PER_LAYER = 2;

/** 借一个帧指针（池子里有就用现成的，没有才 clone 一张新的） */
function acquireLayerTexture(spec: BloomLayerSpec, base: Texture): Texture {
  const reused = idleTextures.get(spec.path)?.pop();
  if (reused) {
    // 复位到第 0 帧（上一次爆炸是播到哪一帧停下的都无所谓）
    reused.offset.set(0, 0);
    return reused;
  }
  const texture = base.clone();
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.repeat.set(1 / BLOOM_FRAMES, 1);
  texture.offset.set(0, 0);
  return texture;
}

/** 还回池子（满了就真 dispose，别无限占显存） */
function releaseLayerTexture(path: string, texture: Texture): void {
  const pool = idleTextures.get(path) ?? [];
  if (pool.length >= MAX_IDLE_PER_LAYER) {
    texture.dispose();
    return;
  }
  pool.push(texture);
  idleTextures.set(path, pool);
}

/**
 * 让特效图**提前开始下载**。
 *
 * 【为什么要在开局调一次？】
 * 这三张图加起来约 4.5 MB。如果等第一发弹药打出去才开始下载，
 * 玩家会看到"技能放了但什么都没炸"（图还在路上）。
 * 所以启动时不阻塞地喊一嗓子，等真的开打时图基本已经到了。
 * 找不到图也不会报错（`loadImage` 会静默失败并提示一句），特效直接不播。
 */
export function preloadBloomTextures(): void {
  for (const layers of Object.values(BLOOM_FX)) {
    for (const spec of layers) void loadImage(spec.path);
  }
}

// ============================================================
// 动画曲线（纯函数，渲染层每帧按 progress 取值）
// ============================================================

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/**
 * 进度（0..1）对应第几帧。
 *
 * ★ 挑到最后一帧就停住（而不是回绕）：这是一次性爆炸，不是循环光效。
 * ★ 用 `floor(progress * 帧数)` 而不是 `round` —— 最后一帧只在 progress 真正到 1 时出现，
 *   否则播到 96% 就提前定格在最后一帧（那帧几乎全透明，看起来像"少了一小段"）。
 */
export function bloomFrameAt(progress: number, frames = BLOOM_FRAMES): number {
  const t = clamp01(progress);
  return Math.min(frames - 1, Math.max(0, Math.floor(t * frames)));
}

/**
 * 整体透明度。
 *
 * 【为什么图里已经渐隐了，这里还要再淡一次？】
 * 因为**帧是跳的**，不是连续的：10 帧里有 3 帧的亮度差不多，
 * 直接播完会"啪"地消失一下。留一条很平的尾（最后 15% 才收尾）既不会过度变暗、
 * 又不至于定格。主层/中心层的首尾亮度差已经写在图里了，所以这条曲线很保守。
 */
export function bloomOpacityAt(progress: number): number {
  const t = clamp01(progress);
  if (t < 0.85) return 1;
  // ★ 夹一下：`1 - (1 - 0.85) / 0.15` 在浮点下是 -2.2e-16，不夹会传个负的 opacity 给材质
  return Math.max(0, 1 - (t - 0.85) / 0.15);
}

// ============================================================
// 场景里的一次爆炸
// ============================================================

export interface BloomFxPart {
  mesh: Mesh;
  geometry: PlaneGeometry;
  material: MeshBasicMaterial;
  /** 这一层自己的帧指针（clone 出来的贴图，共享 GPU 上的同一张图） */
  texture: Texture;
  /** 它属于哪张原图 —— 还回池子时要按这个分组 */
  path: string;
}

export interface BloomFx {
  /** 挂在场景里的壳（位置 = 爆炸中心那一格的脚下） */
  holder: Group;
  parts: BloomFxPart[];
  /** 整场爆炸的时长（秒） */
  duration: number;
  /** 剩余寿命（秒） */
  life: number;
}

export interface BloomFxSpawnOptions {
  /** 爆炸中心（世界坐标） */
  x: number;
  z: number;
  /** 内核给的范围半径（维什戴尔是 2 → 周围两格 → 5×5） */
  radius: number;
  /** 播哪一套（= 数据表 `splash.fx` 的值） */
  fx: string;
  /** 贴地高度（和范围框同一档，见 replay 的 ZONE_Y） */
  y: number;
}

/**
 * 造一次爆炸。
 *
 * `radius` 是**格数**：`radius = 2` ⇒ 5×5 ⇒ 平面边长 = 5 格。
 * 平面是**世界坐标里的正方形**，45° 相机自然会把它压成菱形/椭圆 ——
 * 所以图里画正圆是对的，预压过的图到这里会被压两次。
 *
 * @returns 贴图还没加载好时返回 null（调用方直接跳过，不用重试；
 *          下一次爆炸时会自然接上）
 */
export function createBloomFx(opts: BloomFxSpawnOptions): BloomFx | null {
  const layers = BLOOM_FX[opts.fx];
  if (!layers) return null;

  const spanCells = Math.max(1, opts.radius * 2 + 1);
  const holder = new Group();
  holder.position.set(opts.x, opts.y, opts.z);

  const parts: BloomFxPart[] = [];
  for (const spec of layers) {
    const base = baseTextureOf(spec);
    if (!base) {
      // 有一层没到就整次不播：只炸一半（比如只有烟没有火）比不炸更难看
      releaseAll(parts, holder, true);
      return null;
    }

    // ★ 帧指针必须是**这一份自己的**：共用 base 的话，后炸的会把先炸的进度拽走
    const texture = acquireLayerTexture(spec, base);

    const size = spanCells * CELL * spec.spanRatio;
    const geometry = new PlaneGeometry(size, size);
    const material = new MeshBasicMaterial({
      map: texture,
      transparent: true,
      opacity: 1,
      blending: spec.blending,
      side: DoubleSide,
      depthWrite: false,
    });
    const mesh = new Mesh(geometry, material);
    // PlaneGeometry 在 XY 平面上，转 -90° 才是贴地
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(0, spec.lift, 0);
    /*
      ★★ 图层等级和锏的刀光**完全一样**（用户口径）。
      棋子的卡面/小人/血条全都是 `depthWrite: false` 的透明物体 ⇒
      深度测试不参与"谁压谁"，three.js 只能按距离排 —— 于是爆炸会被棋子随机盖住。
      `RENDER_ORDER_FX` 比棋子那几层（0~3）高，一定最后画。
      ★ 位置（y）一个数都没多动：这是图层问题，不是高度问题。
    */
    mesh.renderOrder = RENDER_ORDER_FX;
    holder.add(mesh);
    parts.push({ mesh, geometry, material, texture, path: spec.path });
  }

  if (parts.length === 0) return null;
  return { holder, parts, duration: BLOOM_DURATION_SECONDS, life: BLOOM_DURATION_SECONDS };
}

/** 把已经造好的几层摘掉（`releaseTextures` = 贴图还回池子还是真删） */
function releaseAll(parts: BloomFxPart[], holder: Group, releaseTextures: boolean): void {
  for (const part of parts) {
    holder.remove(part.mesh);
    part.geometry.dispose();
    part.material.dispose();
    if (releaseTextures) releaseLayerTexture(part.path, part.texture);
    else part.texture.dispose();
  }
  parts.length = 0;
}

/** 按进度把每一层拨到该显示的帧 + 收一点尾巴 */
export function applyBloomFrame(fx: BloomFx, progress: number): void {
  const frame = bloomFrameAt(progress);
  const opacity = bloomOpacityAt(progress);
  for (const part of fx.parts) {
    const offset = frame / BLOOM_FRAMES;
    if (part.texture.offset.x !== offset) {
      part.texture.offset.x = offset;
    }
    part.material.opacity = opacity;
  }
}

/**
 * 从场景里摘掉一次爆炸并还回显存。
 *
 * ★ 那个 clone 出来的 texture **不真删**，而是还回池子（`releaseLayerTexture`）——
 *   它和原图共享同一份 GPU 上传，重传一次一千多万像素会掉帧。
 *   共享的**原图**更不能 dispose（`baseTextureCache` 里那份还要给后面用）。
 */
export function disposeBloomFx(fx: BloomFx): void {
  releaseAll(fx.parts, fx.holder, true);
}
