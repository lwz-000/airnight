/**
 * ============================================================
 *  ★ 0.2.1：迷迭香的「战术装置砸击」（普攻专属演出）
 * ============================================================
 *
 * 【它是什么？】
 * 迷迭香背后挂着四块编号金属板（官方骨架里的 `F_Weapon_1..4`）。
 * 她打人的时候，其中一块板**在目标头顶凭空出现，然后垂直砸下去**。
 *
 * ★★ 用户口径（2026-10-18，改过两版）：
 *   第一版是"从她背后抛出去、抛物线飞向目标"，被否了 ——
 *   「还是在平飞，让特效生成在敌方单位上方，然后落向敌人消失」。
 *   第二版改成纯世界垂直，又被否了 ——「装置是按从右侧出现，可能还是视角原因」。
 *   ⇒ 现在：高度是真·垂直落下，但**水平位置按相机做反向补偿**，
 *     让它在屏幕上始终跟目标同一列（斜视角下高处会往外飘，见 `slamPathAt`）。
 *
 * 【为什么不用官方动画，自己写一段】
 * 实测过官方骨架的 12 个动作档位（`Attack_A/B`、`Skill_2`、`Skill_3_*`）：
 * 装置**始终固定在背后展开**，从头到尾没有"飞出去"的姿势 ——
 * 那是设定描述，不是现成动画。所以这里只借它的**贴图**，动作自己排。
 *
 * 【★ 用户口径：一次只砸一个】
 * 装置是"一件大件"，不是"四块板分头飞"。所以：
 *   · 一条 `attack` 事件最多落一件；
 *   · 连击的第 2/3 段（`hitIndex > 0`）不重复落；
 *   · 再叠一道 0.12 秒的时间窗兜底 —— 同一次出手打到多个目标时也只砸一个。
 * `shouldSpawnSlam()` 是这条规则的唯一实现，测试钉住它。
 *
 * 【为什么用 Sprite 而不是贴地平面】
 * 它要"从天上掉下来"，脚下那一层贴地特效（攻击弧 / 范围框）都在地面上，
 * 两者一眼就分开；Sprite 永远面朝相机，斜视角下形状不会被压扁。
 * 代价是不能做真 3D 翻滚，所以"砸"的力度靠**加速下坠 + 落地前放大 + 快速淡出**
 * 来表达，落地的烟交给 `sequence-fx.ts` 的 `cannon_smoke_gray`。
 *
 * 【时长】
 * 从高处砸下来的东西不能飘：0.28 秒。弹道线 0.16、攻击特效 0.13~0.30，
 * 它在同一量级里偏慢一点点（要看清那块板），但绝不会拖到下一次攻击。
 */

import { SRGBColorSpace, Sprite, SpriteMaterial, Texture } from 'three';
import { getLoadedImage, loadImage } from './assets.js';
import { RENDER_ORDER_FX } from './card-layout.js';

/**
 * 数据里写的表现层标记（`UnitDef.tracerFx`）。
 * ★ 渲染层只认这个字符串，不认干员编号。
 */
export const ROSMON_SLAM_FX = 'rosmon_slam';

/** 装置贴图（相对 `apps/web/public/assets/`）。256×666，从官方 Spine 抽出的**单件**板 */
export const ROSMON_GEAR_PATH = 'fx/rosmon_gear.png';

/**
 * 落地时扬的烟 —— 直接复用炮手那套序列帧（灰烟最中性，和深色金属板也搭）。
 * ★ 不在 `sequence-fx.ts` 里新加一张图：那是同一批美术已经画好的东西，
 *   再加一张只会多一份体积，而观感上分辨不出来。
 */
export const SLAM_SMOKE_FX = 'cannon_smoke_gray';

/**
 * 烟占几格（比装置本身大一圈，才是"砸出来的"而不是"板子自带特效"）。
 * ★ 1.6 在真机上几乎看不见（那张 `cannon_smoke_gray` 本来就是"炮口余烟"，很淡），
 *   2.2 之后才读得出"地上腾起一团"。
 */
export const SLAM_SMOKE_CELLS = 2.4;

/**
 * 落地的**冲击闪光** —— 和烟叠在一起才是"砸"。
 *
 * 【为什么光有烟不够】
 * 烟是普通混合、偏暗的；单靠它在深色棋盘上只是一团灰，
 * 看不出"有什么东西砸下来了"。加一层加色混合的灰白爆炸（lift 更高，
 * 画在烟上面），落地那一帧会"闪一下"，分量就出来了。
 *
 * ★ 只用 1.1 格：比烟小得多，是"中心那一下"，不是第二次爆炸。
 */
export const SLAM_BLAST_FX = 'cannon_blast_gray';
export const SLAM_BLAST_CELLS = 1.1;

/** 一次砸击演出的总时长（秒） */
export const ROSMON_SLAM_SECONDS = 0.28;

/**
 * 视角补偿的**生效范围**（超出就判定输入不合法，退回世界垂直）。
 *
 * 【为什么需要闸门】
 * 补偿量是 `depth(高处) / depth(落点)` 的比值。这个比值只有在"相机离棋盘
 * 十几格远"的正常视角下才接近 1；一旦传进来的相机贴着落点（深度接近 0），
 * 比值会炸到几十倍，装置直接被甩到地图外 —— 表现成"偶尔一闪就没了"，
 * 比不补偿难查得多。所以宁可退回垂直，也不要放大一个不成立的比值。
 */
export const SLAM_VIEW_MIN_DEPTH = 0.5;
export const SLAM_VIEW_MIN_SCALE = 0.3;
export const SLAM_VIEW_MAX_SCALE = 2.5;

/**
 * 贴图宽高比（256 / 666 ≈ 0.384）—— 这是一块**细长**的板。
 *
 * ★ 用户口径："图上是 4 个装置，只把最右面单独那个抠出来"。
 *   所以这里不是"四件组合"（那会 556×477，接近正方形），而是单件
 *   `F_Weapon_2`（02 号板，原尺寸 188×462）。
 */
export const ROSMON_GEAR_ASPECT = 256 / 666;

/**
 * 装置在世界里的**高度**（格）。
 * ★ 定尺度用高度而不是宽度：这是一块竖着砸下来的板，
 *   按宽度定会让它变成一根 2.5 格高的杆子。
 */
export const ROSMON_GEAR_WORLD_HEIGHT = 1.12;

/** 同屏最多几件装置在空中（满编对轰时的硬上限，超了丢最老的） */
export const MAX_LIVE_ROSMON_SLAM = 6;

/** 同一次出手内，两次落下至少隔这么久（秒）—— "砸一个"的兜底闸门 */
export const ROSMON_SLAM_DEDUPE_SECONDS = 0.12;

/**
 * 生成的起始高度（格）。
 *
 * ★ 3.4 被否了：真机定格显示它已经在画面上沿之外，玩家看到的是"装置从屏幕外掉进来"，
 *   看不到"出现"那一下。2.4 刚好整块板在画面内，又有足够落程。
 *   （再低就没有"从高处砸下来"的距离感了。）
 * ★ 3.0（2026-10-18 二次调）：2.4 在真机上"落下"只有三分之一块板高，几乎读不出位移；
 *   配合下面的视角补偿（屏幕竖直线）抬到 3.0，落程接近半格，又不会顶到画面上沿。
 */
export const SLAM_TOP_Y = 3.0;

/** 落地时装置中心离地高度 —— 装置高 1.12，中心 0.56 时底边正好贴地 */
export const SLAM_END_Y = 0.56;

/**
 * 下落速度曲线里的指数。
 *
 * 取 1 = 匀速落（看起来像电梯），取 1.7 = 越落越快。
 * 重力本来就是平方关系，但完全平方会"前两帧几乎不动"，
 * 1.7 是"能看出加速、又不至于开头卡一下"的折中，靠定格图定的。
 */
export const SLAM_FALL_POW = 1.7;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

/**
 * "这一次出手该不该落一件装置"—— **"砸一个"这条规则的唯一实现**。
 *
 * @param opts.hitIndex        内核给的连击段号（单发不写，按 0 算）
 * @param opts.sinceLastSpawn  距离上一次落下过了多少秒（没有过就传 `Infinity`）
 */
export function shouldSpawnSlam(opts: {
  hitIndex?: number;
  sinceLastSpawn?: number;
}): boolean {
  if ((opts.hitIndex ?? 0) > 0) return false;
  const since = opts.sinceLastSpawn;
  if (since !== undefined && Number.isFinite(since) && since < ROSMON_SLAM_DEDUPE_SECONDS) {
    return false;
  }
  return true;
}

/**
 * 相机快照（只读）。
 *
 * ★ 为什么不直接把 three 的 `Camera` 递进来？
 *   这个文件里的几个函数是**纯函数**（不 import three），测试才能不建渲染器就断言。
 *   所以调用方（`replay.ts`）把相机摘成"位置 + 视线方向"两个向量再递进来。
 */
export interface SlamView {
  position: { x: number; y: number; z: number };
  /** 视线方向（单位向量，**指向场景内部**）—— 俯视时 `forward.y < 0` */
  forward: { x: number; y: number; z: number };
}

/**
 * 高度曲线：唯一实现（起点、终点、加速指数都只在这里用一次）。
 * @param t 0 = 刚出现，1 = 砸到地上
 */
export function slamHeightAt(t: number): number {
  const k = clamp01(t);
  return SLAM_TOP_Y + (SLAM_END_Y - SLAM_TOP_Y) * Math.pow(k, SLAM_FALL_POW);
}

/**
 * 下落轨迹：**目标格正上方 → 直落 → 贴地**。
 *
 * @param anchor 落点（目标格地面，`y = SLAM_END_Y`）—— `t = 1` 时**恰好**回到这里
 * @param t      0 = 刚出现，1 = 砸到地上
 * @param view   相机快照；不传就退化成"世界垂直"
 *
 * ★★ 视角补偿（2026-10-18 用户口径：「装置是按从右侧出现，可能还是视角原因」）
 *
 * 相机俯角 78°、后退只有 10 格，是**斜视**：同样是"x 不动、只改高度"，
 * 高处的点离镜头更近，投影出来 `x / depth` 更大 —— 于是偏离画面中线越远的目标，
 * 装置在最高点会被推得**更靠外**（目标在右半场就是"从右边冒出来"），
 * 落到地面才回到正位。落程本来就短，这个横向漂移就占了主导，看起来像"斜着飞进来"。
 *
 * 修法只锁**屏幕水平方向**：让投影的 `x / depth` 全程等于落点的那个比值 ——
 *
 *     P.x = 相机x + (落点x − 相机x) × depth(P) / depth(落点)
 *
 * `P.z` 不动（竖直落程该多长还是多长，不去拉长它），
 * 所以 `t = 1` 时 `depth(P) = depth(落点)`，公式**天然**退化成落点本身。
 * ★ 前提：棋盘相机不左右偏（见 `board.ts`「相机不左右偏」），屏幕水平轴 = 世界 X。
 */
export function slamPathAt(
  anchor: { x: number; y: number; z: number },
  t: number,
  view?: SlamView | null,
): { x: number; y: number; z: number } {
  const y = slamHeightAt(t);
  if (!view) return { x: anchor.x, y, z: anchor.z };
  /*
    沿视线方向的深度 = (P − 相机) · forward。
    ★ 抬高一格，深度就减少 `−forward.y`（俯角越陡、减得越多），
      这就是上面那个"高处离镜头更近"的量化版本。
  */
  const depthAt = (x: number, py: number, z: number): number =>
    (x - view.position.x) * view.forward.x +
    (py - view.position.y) * view.forward.y +
    (z - view.position.z) * view.forward.z;
  const depthAnchor = depthAt(anchor.x, anchor.y, anchor.z);
  const depthHere = depthAt(anchor.x, y, anchor.z);
  /*
    闸门：两个深度都得"在镜头前面足够远"，比值也得在合理范围。
    任何一条不满足 ⇒ 退回世界垂直（不是 clamp —— 半补偿只会更难解释）。
  */
  if (!(depthAnchor > SLAM_VIEW_MIN_DEPTH) || !(depthHere > SLAM_VIEW_MIN_DEPTH)) {
    return { x: anchor.x, y, z: anchor.z };
  }
  const scale = depthHere / depthAnchor;
  if (!(scale > SLAM_VIEW_MIN_SCALE) || !(scale < SLAM_VIEW_MAX_SCALE)) {
    return { x: anchor.x, y, z: anchor.z };
  }
  return {
    x: view.position.x + (anchor.x - view.position.x) * scale,
    y,
    z: anchor.z,
  };
}

/**
 * 屏幕内旋转（弧度）。
 *
 * 出现时几乎正立（-0.10），越落越斜，砸到地上时 -0.55（约 32° 斜插）。
 *
 * ★ 为什么不能"正着砸下去"？
 *   一块长方板以完全正立的姿态落下，看起来像"电梯里的牌子"。
 *   斜一点才有被甩下去的惯性感。
 * ★ 幅度上限：Sprite 的旋转是**屏幕平面内**的，转过 60° 就开始像风车。
 */
export function slamSpinAt(t: number): number {
  const k = clamp01(t);
  return -0.1 - 0.45 * Math.pow(k, 1.6);
}

/**
 * 缩放曲线。
 *   越落越近 ⇒ 越大（0.72 → 1.15）；落地前一瞬再冲 12%，砸出一个"顿"。
 * ★ 永远 > 0（Sprite 拿到 0/负数缩放会直接闪没）。
 */
export function slamScaleAt(t: number): number {
  const k = clamp01(t);
  const grow = 0.72 + 0.43 * Math.pow(k, 0.9);
  const punch = k > 0.85 ? 1 + ((k - 0.85) / 0.15) * 0.12 : 1;
  return grow * punch;
}

/**
 * 透明度。
 *   前 10% 淡入（凭空出现需要一点"凝聚"的过程，直接满不透明会很突兀）；
 *   最后 10% 淡出 —— 用户口径「落向敌人消失」，砸到就没了，由烟接住。
 */
export function slamOpacityAt(t: number): number {
  const k = clamp01(t);
  if (k < 0.1) return k / 0.1;
  if (k > 0.9) return Math.max(0, 1 - (k - 0.9) / 0.1);
  return 1;
}

/** 精灵的世界尺寸（宽, 高）—— 细长板：宽约为高的 0.384 倍 */
export function slamWorldSize(): { width: number; height: number } {
  return {
    width: ROSMON_GEAR_WORLD_HEIGHT * ROSMON_GEAR_ASPECT,
    height: ROSMON_GEAR_WORLD_HEIGHT,
  };
}

// ============================================================
// 贴图（全局一张，所有装置共用）
// ============================================================

let cachedTexture: Texture | null = null;

/**
 * 取装置贴图。
 * @returns 还没加载好就返回 null —— 调用方这一次直接跳过，不要用占位图硬撑
 *          （那会在棋盘上闪一个白块）。
 */
export function rosmonGearTexture(): Texture | null {
  if (cachedTexture) return cachedTexture;
  const image = getLoadedImage(ROSMON_GEAR_PATH);
  if (!image) return null;
  const texture = new Texture(image);
  // ★ 不写 colorSpace，图会显得发灰（note-fx / unit-aura 都踩过同一个坑）
  texture.colorSpace = SRGBColorSpace;
  texture.needsUpdate = true;
  cachedTexture = texture;
  return texture;
}

/** 启动时预热（图不存在也不报错，assets.ts 里会静默降级） */
export function preloadRosmonGear(): void {
  void loadImage(ROSMON_GEAR_PATH);
}

/** 造一件装置精灵；贴图还没好时返回 null */
export function createSlamSprite(): Sprite | null {
  const map = rosmonGearTexture();
  if (!map) return null;
  const size = slamWorldSize();
  const material = new SpriteMaterial({
    map,
    transparent: true,
    // 装置是**实体金属**（不是发光的能量），加色混合会把它洗成一块灰白
    depthWrite: false,
  });
  const sprite = new Sprite(material);
  sprite.scale.set(size.width, size.height, 1);
  // 旋转轴用默认的中心 —— 这里摆幅只有 ±0.55 rad，绕中心转不会像风车；
  // 换成底边为轴反而会让"位置 → 离地高度"的换算多一层偏移，容易算错。
  sprite.center.set(0.5, 0.5);
  sprite.renderOrder = RENDER_ORDER_FX;
  return sprite;
}

/** 测试用：把缓存清掉（改素材后要能重新建纹理） */
export function resetRosmonGearTexture(): void {
  cachedTexture = null;
}
