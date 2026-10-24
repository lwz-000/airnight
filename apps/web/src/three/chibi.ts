/**
 * ============================================================
 *  Q 版小人动画（官方 Spine 素材 · 离线预渲染版）
 * ============================================================
 *
 * 【先回答一个关键问题：为什么这里是"放动画"而不是"放 Spine 运行时"？】
 *
 * 官方小人在鹰角那边**不是图片，是 Spine 骨骼动画**。想在网页里播，
 * 常规做法是引一个 Spine 运行时（pixi-spine 之类）进游戏包。本项目**没这么做**，
 * 原因是两条硬伤：
 *
 *   1. **授权**。Spine 运行时的授权条款要求"每个使用者自己持有 Spine Editor 许可"。
 *      同人游戏不盈利，社区普遍默许，但那是惯例、不是豁免。
 *      把运行时打进发给朋友的包里，等于把这个风险一并分发出去。
 *   2. **面数**。官方素材里相当一部分干员是 Spine 3.5/3.8 混着的，
 *      浏览器端运行时要吃下全部版本，出错的概率不低。
 *
 * 所以走的是**离线预渲染**：
 *   构建期用无头浏览器 + pixi-spine 把每个小人的 Idle/Attack/Skill/Die
 *   逐帧渲染成横向序列帧 PNG（见 scripts/render-chibi.mjs），
 *   游戏包里只有 PNG —— **既不含 Spine 运行时，也不含骨骼数据**。
 *
 * 【这样做丢掉了什么？】
 *   · 动作不可组合（只能播预渲染的那几段，不能临时拼骨骼）
 *   · 帧率固定（但可以变速播放，见 timeScale，攻速加成照样跟得上）
 * 换来的是一条又轻又稳的链路：一次 drawImage + 一次贴图上传，不需要额外 WebGL 上下文。
 *
 * 【降级链】
 *   有小人素材 → 播小人；没有 → 卡片里继续用 stand/ 半身像；
 *   连半身像也没有 → 头像；再没有 → 程序化占位图。
 *   **这条链上任何一环出问题，游戏都必须照常能玩。**
 */

import { CanvasTexture, LinearFilter, Matrix4, SRGBColorSpace, Sprite, SpriteMaterial, Vector3, type Texture } from 'three';
import { monsterModelScaleOf, type UnitDef } from '../../../../packages/shared/src/index.js';
// 卡片版式的唯一来源。小人的宽高比和站位全靠它，不要再在别处写死数字。
import { CARD_WORLD_SCALE, CHIBI_FOOT_SCREEN, CHIBI_WORLD_H, RENDER_ORDER_CHIBI } from './card-layout.js';

/** 小人素材根目录（对应 apps/web/public/assets/chibi/） */
const CHIBI_BASE = './assets/chibi/';

/** 一个动画的定义 */
interface AnimDef {
  file: string;
  /** 一共几帧 */
  frames: number;
  /** 播放帧率（渲染时用的采样帧率） */
  fps: number;
  /** 是不是循环播放（Idle 是，Attack 不是） */
  loop: boolean;
}

/** 一个干员的小人清单 */
interface ChibiManifest {
  charId: string;
  /** 单帧**画布**的像素尺寸（所有动画共用） */
  cell: { w: number; h: number };
  /**
   * 设计框：画布里"对应卡片立绘区"的那一块（左上角为原点，y 向下）。
   *
   * 【为什么不是 cell？】
   * 挥武器 / 阵亡铺开这些动作的内容会超出立绘区，所以画布被渲染时**放大**过 ——
   * 画布装得下所有动作（不裁切），而"小人该多大"只由设计框决定。
   * 老清单没有这个字段，那就按"画布=设计框"处理，等于老行为。
   */
  box?: { x: number; y: number; w: number; h: number };
  animations: Record<string, AnimDef>;
}

/**
 * 支持的动作模式。
 *
 * ★ 0.0.3：加了 `move`（走路）。野怪的官方骨架里**都有**走路动作
 * （Move / Move_Loop / C1_Move…，见 scripts/render-chibi.page.html 的 PRIORITY.move），
 * 干员的战斗小人**没有** —— 所以干员那边退回"待机 + 程序化走姿"，
 * 见 replay.ts 的 WALK 段落。
 */
/**
 * ★ 0.2：加了 `'stun'`（眩晕）。
 *
 * 官方素材里**只有一部分**干员带 `Stun` 动作（阿米娅 / 迷迭香 / 维什戴尔 / 凯尔希 /
 * 若叶睦 / op39），其余的没有这一档 —— 没有时 `updateChibi` 会自动退回 idle，
 * 再叠一层"程序化摇晃"（见 `setChibiStunWobble`），所以**所有干员都有眩晕表现**。
 */
export type ChibiMode = 'idle' | 'move' | 'attack' | 'skill' | 'stun' | 'die';

/**
 * ★ 动作优先级（0.0.2 追加需求第 3 条：小人动画太容易被打断）。
 *
 * 【为什么需要优先级？】
 * `pickMode` 是**每帧**根据 `castGlow` / `lunge` 这两个"余量"算出来的，
 * 而这两个值都是慢慢衰减的浮点数。于是一段 0.6 秒的挥击里，
 * mode 会在 `attack → idle → attack → idle` 之间抖好几次 ——
 * 每抖一次都走"换动画 = 回到第 0 帧"这条路，小人就一直在挥第一帧，
 * 看起来就是"动画播不动 / 一直被重置"。
 *
 * 有了优先级之后规则变成一句话：
 * **只有"更重要"的动作才能打断正在播的动作，同等或更次要的必须等它播完。**
 * `die` 永远最高 —— 死亡不能等。
 */
const MODE_PRIORITY: Record<ChibiMode, number> = {
  idle: 0,
  move: 1,
  attack: 2,
  skill: 3,
  // ★ 0.2：眩晕要能打断"挥击/施法"（不然被晕了还在挥），但**打不过阵亡**
  stun: 4,
  die: 5,
};

/**
 * ★ 0.0.3：把一个动画**键**还原成基础动作。
 * `idle2 → idle`、`attack2 → attack`：二阶段的动作优先级要和一阶段一样，
 * 否则"二阶段的普攻"会被算成"比技能还高"或者"什么都打断不了"。
 */
function baseModeOf(key: string): ChibiMode {
  const base = key.replace(/\d+$/, '');
  return (
    base === 'move' || base === 'attack' || base === 'skill' || base === 'stun' || base === 'die'
      ? base
      : 'idle'
  ) as ChibiMode;
}

/**
 * ★ 0.0.3：这一形态下该用哪个动画键。
 * 二阶段优先用 `xxx2`（Boss 骨架里的 C2_* / B_* 那一套），没有就退回一阶段的键。
 */
function animKeyFor(state: ChibiState, mode: ChibiMode): string {
  if (state.phase >= 2 && state.anims[`${mode}2`]) return `${mode}2`;
  return mode;
}

/** 一个棋子身上挂着的小人状态 */
interface ChibiState {
  defId: string;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  texture: CanvasTexture;
  sprite: Sprite;
  /** 清单和序列帧图还没加载好的时候是 null —— 那时候小人精灵是隐藏的 */
  ready: boolean;
  anims: Record<string, AnimDef>;
  images: Record<string, HTMLImageElement>;
  /**
   * 当前在播哪个动画**键**（清单里的 key）。
   * 一阶段是 idle/attack/skill/die，二阶段可能是 idle2/attack2/… —— 所以是 string。
   */
  current: string;
  /**
   * ★ 0.2：这一帧**想播**的动作（`ChibiMode`）。
   * `current` 是"实际在播的键"—— 没有对应素材时会退回 idle，
   * 所以调试"眩晕/走路到底有没有被识别"要看这个，不是 `current`。
   */
  lastMode?: ChibiMode;
  frame: number;
  /** 帧计时累加器（秒） */
  acc: number;
  /** 已经画到画布上的帧号，用来避免重复上传贴图 */
  drawnFrame: number;
  drawnAnim: string;
  /**
   * 上一次画到画布上时，小人是不是"镜像版"（见 drawFrame）。
   * 它就是"重画判定"的第三个条件 —— 落了它，切阵营时小人会一直保持上一种朝向。
   */
  drawnMirror: boolean;
  /**
   * 要不要左右镜像。
   *
   * 【为什么要镜像？】
   * 官方小人素材本身只有一个朝向（基本都朝右）。红方（右半场）的棋子
   * 如果照原样摆，整排敌人就都背对着你、朝着场外 —— 看起来非常怪。
   * 镜像之后红方是"面朝左（面朝蓝方）"，两军对峙的观感才对。
   *
   * 判定规则只有一条（写在 sprite-graphics.ts 的 mirrorFor）：
   * **不是"我方"的棋子就镜像** —— 对手 / 野怪 / 看别人棋盘时的那些，
   * 正好都落在右半场（联机翻转视角时是左半场，但那时它依然是"对方"）。
   */
  mirror: boolean;
  /**
   * ★ 0.0.3：当前处在第几形态（1 = 一阶段，2 = 二阶段）。
   *
   * 【为什么放在小人身上？】
   * 因为"二阶段"在这里只影响一件事：**播哪一套动作**。
   * 清单里如果存在 `idle2 / attack2 / skill2 / die2`（Boss 骨架里的 C2_* / B_*），
   * 二阶段就优先用它们 —— 换形态时同一个动作名，动作却是另一套，
   * 玩家能一眼看出"这个 Boss 变了"。
   */
  phase: number;
  /**
   * ★ 0.0.3：这只小人现在是不是"倒地等复活"。
   *
   * 【为什么需要它？—— 它修的是"复活时模型消失"】
   * 敌人的阵亡动作是**演到消失**的（实测“复仇者”的 die 序列帧最后两帧
   * 不透明像素 = 0，整只人已经没了）。而"倒地等复活"要躺 3/5 秒才站起来 ——
   * 如果照播到底，这 5 秒里场上什么都没有，看起来就是"模型消失了"。
   * 所以倒地时只播到阵亡动作的 DOWNED_HOLD_RATIO（倒地姿势），停在那儿。
   */
  downedHold: boolean;
  /**
   * ★ 0.0.3：倒地演出的播放倍率（`reborn.downedAnimSpeed`，默认 1）。
   * 只在"正在演阵亡动作且处于倒地等待"时生效 —— 见 updateChibi 里的 playSpeed。
   */
  downedSpeed: number;
  /**
   * ★ 0.2：设计框在画布里的位置（layoutChibi 算出来的那一份）。
   * 眩晕星星要按"头顶"定位 —— 没有它就只能在画布顶上瞎猜，野怪那种有多余留白的会飘。
   */
  box: { x: number; y: number; w: number; h: number };
  /** ★ 0.2：现在要不要画"眩晕星星"（画进画布，不额外挂精灵） */
  dizzy: boolean;
  /** ★ 0.2：星星转到的角度（弧度） */
  dizzySpin: number;
  /** 挂载回调：素材到位 / 失败时通知卡片那头（见 attachChibi 的 hooks 参数） */
  hooks: ChibiHooks;
}

/**
 * ★ 0.0.3：倒地时把阵亡动作播到第几成就停住。
 *
 * 0.75 是实测出来的：再往后就开始"化掉"（帧 10/11 全透明），
 * 再往前则看起来还没倒下去。想要别的观感就改这一个数。
 */
const DOWNED_HOLD_RATIO = 0.75;

/**
 * 挂载结果回调。
 *
 * 【为什么必须有这两个回调？—— 这就是"干员模型丢失"的根因之一】
 * 卡面贴图有两种画法：
 *   · 有小人 → 立绘区**留空**（小人是另一张精灵，画了立绘会透出两个人）；
 *   · 没小人 → 立绘区画半身像/占位图。
 * 以前"留不留空"只看「这个干员**有没有**小人素材」——
 * 有素材就留空，然后才异步去加载。一旦加载失败（素材包不全、网络抖一下），
 * 小人永远出不来，而立绘区又是空的 → **画面上就是一格空白，模型"丢"了**。
 *
 * 现在改成：**先画立绘（绝不留白），等小人真的播起来了再切换成留空版**；
 * 加载失败就永远保持立绘版 —— 最坏情况是"小人变半身像"，绝不是空白。
 */
export interface ChibiHooks {
  /** 小人素材真的加载完了，此刻起可以切换成"立绘区留空"的卡面 */
  onReady?: () => void;
  /** 小人素材加载失败，卡面必须保持"有立绘"的那一版 */
  onFailed?: () => void;
}

/** defId -> charId（哪些干员有小人素材） */
let index: Record<string, string> = {};
let indexReady = false;
let indexFailed = false;

/** 清单缓存：defId -> manifest（null 表示这个干员没有小人） */
const manifestCache = new Map<string, ChibiManifest | null>();
const manifestPending = new Map<string, Promise<ChibiManifest | null>>();

/** 反算小人 uv 用的临时对象（每帧 new Matrix4 会产生垃圾，复用一份） */
const inverseMatrix = new Matrix4();
const localPoint = new Vector3();

/** 序列帧图片缓存：`defId/anim` -> 图片 */
const stripCache = new Map<string, HTMLImageElement | null>();
const stripPending = new Map<string, Promise<HTMLImageElement | null>>();

/** 诊断信息（控制台 / 界面能看到到底用上了几张小人） */
const stats = { manifests: 0, strips: 0, missing: 0 };

/** 清单还没回来时先按这个尺寸建画布，拿到清单后会被校正（见 layoutChibi）
 *
 * 尺寸要和 scripts/render-chibi.mjs 的 TUNE.cell 一致，否则清单到位前会闪一下。
 * 宽 224 是设计框的宽度（给横置武器留地方，理由写在那个 TUNE.cell 的注释里）；
 * 高 170 决定小人在卡片上多大，别动。
 * 注意这是**设计框**，不是最终画布 —— 画布可能被渲染器放大去装溢出动作。 */
const DEFAULT_CELL = { w: 224, h: 170 };

/** 把小人推到卡片前面一点点，免得和卡片同深度闪烁 */
const DEPTH_EPSILON = 0.004;

/**
 * 这只棋子的小人该放大多少倍（1 = 原尺寸）。
 *
 * ★ 0.2：**棋子自己写的 `modelScale` 优先**（召唤物/彩蛋棋子也能单独调大小）。
 * 【为什么优先？】野怪那张表（`monsterModelScaleOf`）的判据是 `monsterOnly`，
 * 对它一律返回 1 —— 而魂灵之影这种召唤物需要"比统一高度小一圈"，
 * 又不想为此放宽"野怪"的判断（会把 `noCard` 那条老坑再踩一遍）。
 * 所以顺序是：**棋子显式写的 → 野怪表 → 1**。
 *
 * 其余情况仍然走 `monsterModelScaleOf`（表和规则都在 `monster-data.ts`，
 * 那是"一份要调的数值"，得能在数值总表里被看见、并且导表和渲染读同一份）。
 * 这里保留一个薄封装，是因为渲染侧原本的调用点/测试都认这个名字。
 */
export function chibiModelScaleFor(def: UnitDef): number {
  if (def.modelScale !== undefined) return def.modelScale;
  return monsterModelScaleOf(def);
}

/**
 * 小人精灵的**世界尺寸**（世界单位）。
 *
 * 【为什么单独抽出来？】
 * 这段"像素 → 世界单位"的换算是布局里最容易写错的一段（画布比设计框大、
 * 子节点还要除掉父节点的缩放），而"野怪模型按级别/逐只缩放"这条需求
 * 恰恰只能在这里体现。抽成纯函数之后，单元测试就能拿两个倍率比一比，
 * 断言"确实是那个倍数"，而不是靠肉眼看截图。
 *
 * @param cell 画布尺寸（像素）
 * @param box  设计框（像素）。老清单没有 → 按"画布=设计框"处理
 * @param modelScale 额外倍率（见 chibiModelScaleFor）
 */
export function chibiWorldSize(
  cell: { w: number; h: number },
  box?: { x: number; y: number; w: number; h: number },
  modelScale = 1,
): { w: number; h: number } {
  const bx = box && box.w > 0 && box.h > 0 ? box : { x: 0, y: 0, w: cell.w, h: cell.h };
  const h = CHIBI_WORLD_H * (cell.h / bx.h) * modelScale;
  return { w: h * (cell.w / cell.h), h };
}

/*
  小人的渲染层级从 card-layout.ts 取（**唯一来源**）：
    0 卡片 < 1 小人 < 2 血条 < 3 星级
  只靠 z 深度在小人放大、相机斜着看的时候会算错，直接给 renderOrder 最稳。
  放在 card-layout 里而不是各写一份，是因为"谁压谁"是一件事 ——
  0.0.2 把星级插到最上面时就吃过这个亏（星级原来画在卡面里，被小人挡掉了）。
*/

/** 索引还没到位时先把棋子记下来，等索引到了再补挂小人 */
const pendingAttach: { sprite: Sprite; def: UnitDef; hooks: ChibiHooks; mirror: boolean }[] = [];

/**
 * 素材加载失败的重试上限。
 *
 * 【为什么不能"失败一次就永别"？】
 * 清单/序列帧的失败结果原来会被**永久缓存**（`stripCache.set(key, null)`），
 * 之后这个干员的小人再也不加载 —— 一次网络抖动（浏览器并发请求被掐断、
 * 静态服务器重启的那一瞬间）就足以让某个干员的模型"丢"一整局。
 * 现在前几次失败不进缓存，允许下一次挂载时重试；到上限才认命。
 */
const MAX_LOAD_RETRIES = 3;
const manifestFails = new Map<string, number>();
const stripFails = new Map<string, number>();

/** 载入「哪些干员有小人素材」这张索引。
 *
 * 【为什么失败也要继续？】
 * 因为小人素材是可选的：没跑过 scripts/fetch-chibi.ts + render-chibi.mjs 的仓库里
 * 根本没有 assets/chibi/。那时候这个请求 404，游戏必须**照常运行**，
 * 只是所有棋子继续用半身像。所以这里吞掉错误。
 */
export async function initChibi(): Promise<void> {
  if (indexReady || indexFailed) return;
  try {
    const res = await fetch(`${CHIBI_BASE}index.json`, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as Record<string, string>;
    if (!data || typeof data !== 'object') throw new Error('索引格式不对');
    index = data;
    indexReady = true;
    const n = Object.keys(index).length;
    console.info(`[小人] 素材索引载入成功：${n} 个干员有小人的序列帧，其余继续用半身像。`);
    // 索引到位前已经建好的棋子，在这里补挂
    for (const item of pendingAttach.splice(0)) attachChibi(item.sprite, item.def, item.hooks, item.mirror);
    return;
  } catch (err) {
    indexFailed = true;
    index = {};
    pendingAttach.length = 0;
    console.info(
      `[小人] 没找到 assets/chibi/index.json（${String(err)}）—— 所有棋子继续用半身像。` +
        `想要小人动画就先跑 scripts/fetch-chibi.ts 和 scripts/render-chibi.mjs。`,
    );
  }
}

/** 这个棋子有没有可用的官方小人素材 */
export function hasChibi(def: UnitDef): boolean {
  return indexReady && !!def.charId && !!index[def.id];
}

/** 拉取某个干员的清单（带缓存与去重；失败在重试上限之内不进缓存，见 MAX_LOAD_RETRIES） */
function loadManifest(defId: string): Promise<ChibiManifest | null> {
  const cached = manifestCache.get(defId);
  if (cached !== undefined) return Promise.resolve(cached);
  const pending = manifestPending.get(defId);
  if (pending) return pending;

  const task = (async (): Promise<ChibiManifest | null> => {
    try {
      const res = await fetch(`${CHIBI_BASE}${defId}/manifest.json`, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as ChibiManifest;
      if (!data?.cell?.w || !data?.animations) throw new Error('清单字段缺失');
      stats.manifests++;
      manifestFails.delete(defId);
      return data;
    } catch {
      stats.missing++;
      const fails = (manifestFails.get(defId) ?? 0) + 1;
      manifestFails.set(defId, fails);
      return null;
    } finally {
      manifestPending.delete(defId);
    }
  })();

  manifestPending.set(defId, task);
  // ★ 只有"失败到上限"才把 null 缓存住；偶发失败留在缓存外，下次挂载会再试
  void task.then((m) => {
    if (m !== null || (manifestFails.get(defId) ?? 0) >= MAX_LOAD_RETRIES) manifestCache.set(defId, m);
  });
  return task;
}

/** 拉取某个动画的横向序列帧图（失败在重试上限之内不进缓存，见 MAX_LOAD_RETRIES） */
function loadStrip(defId: string, anim: string, animDef: AnimDef): Promise<HTMLImageElement | null> {
  const key = `${defId}/${anim}`;
  const cached = stripCache.get(key);
  if (cached !== undefined) return Promise.resolve(cached);
  const pending = stripPending.get(key);
  if (pending) return pending;

  const task = new Promise<HTMLImageElement | null>((resolve) => {
    const img = new Image();
    img.onload = () => {
      stats.strips++;
      stripFails.delete(key);
      resolve(img);
    };
    img.onerror = () => resolve(null);
    img.src = `${CHIBI_BASE}${defId}/${animDef.file}`;
  }).then((img) => {
    stripPending.delete(key);
    if (img !== null) {
      stripCache.set(key, img);
    } else {
      const fails = (stripFails.get(key) ?? 0) + 1;
      stripFails.set(key, fails);
      if (fails >= MAX_LOAD_RETRIES) stripCache.set(key, null);
    }
    return img;
  });

  stripPending.set(key, task);
  return task;
}

/**
 * 把小人精灵挂到卡片精灵下面。
 *
 * 【为什么挂在卡片精灵"下面"当子节点？】
 * 因为卡片精灵身上会挂一堆临时变换 —— 受击放大、技能脉冲、死亡缩小、
 * 攻击前倾位移、每帧浮动。挂在子节点上，这些变换**自动继承**，
 * 一处都不用改 replay.ts 的动画逻辑，小人永远和卡片严丝合缝。
 *
 * @param mirror 要不要左右镜像（红方 / 对手 / 野怪 = true）。见 ChibiState.mirror。
 */
export function attachChibi(cardSprite: Sprite, def: UnitDef, hooks: ChibiHooks = {}, mirror = false): void {
  if (!def.charId) {
    hooks.onFailed?.();
    return;
  }
  // 索引还没回来：先记下，等 initChibi 完成后补挂（见 pendingAttach）
  if (!indexReady) {
    if (!indexFailed) pendingAttach.push({ sprite: cardSprite, def, hooks, mirror });
    else hooks.onFailed?.();
    return;
  }
  if (!index[def.id]) {
    hooks.onFailed?.();
    return;
  }
  const data = cardSprite.userData as { chibi?: ChibiState };
  /*
    ★ 已经挂着小人时分两种情况：
      · 同一个干员 → 幂等，只把回调换新（素材早已就绪，无需重建）；
      · 换了干员（restyle）→ 必须先把旧小人整个拆掉，
        否则画面上是"上一个干员的模型"，看起来就是模型错乱/丢失。
  */
  if (data.chibi) {
    if (data.chibi.defId === def.id) {
      data.chibi.hooks = hooks;
      // 同一个干员也可能换朝向（看别人棋盘、测试沙盒切边、战前/战中视角切换）
      setChibiMirror(cardSprite, mirror);
      if (data.chibi.ready) hooks.onReady?.();
      return;
    }
    detachChibi(cardSprite);
  }

  // 画布先按默认格尺寸建起来；清单回来后按清单里的真实尺寸校正（见 layoutChibi）
  const canvas = document.createElement('canvas');
  canvas.width = DEFAULT_CELL.w;
  canvas.height = DEFAULT_CELL.h;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    hooks.onFailed?.();
    return;
  }

  const texture = new CanvasTexture(canvas);
  /*
    ★ 必须标成 sRGB：小人序列帧 PNG 是 sRGB 数据，不标的话采样时不做 sRGB→线性 解码，
    最后输出又被编码一次 —— 小人的颜色会被冲淡、发灰。
    和卡面 / 血条是同一个原因（详见 sprite-graphics.ts 的 getUnitTexture）。
  */
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.needsUpdate = true;

  const material = new SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
  const sprite = new Sprite(material);
  sprite.visible = false;
  // 盖住卡片，但被血条盖住（见上面的 RENDER_ORDER_CHIBI）
  sprite.renderOrder = RENDER_ORDER_CHIBI;
  // 位置/缩放等清单回来再算（格子的宽高比写在清单里，见 layoutChibi）
  sprite.position.set(0, 0, DEPTH_EPSILON);

  const state: ChibiState = {
    defId: def.id,
    canvas,
    ctx,
    texture,
    sprite,
    ready: false,
    anims: {},
    images: {},
    current: 'idle',
    frame: 0,
    acc: 0,
    drawnFrame: -1,
    drawnAnim: '',
    drawnMirror: mirror,
    mirror,
    phase: 1,
    downedHold: false,
    downedSpeed: 1,
    // ★ 0.2：眩晕星星（位置等 layoutChibi 算完设计框再填）
    box: { x: 0, y: 0, w: 0, h: 0 },
    dizzy: false,
    dizzySpin: 0,
    hooks,
  };
  data.chibi = state;
  cardSprite.add(sprite);

  // 素材异步到位；没到位之前 sprite.visible 一直是 false，画面不会有半成品
  void (async () => {
    const manifest = await loadManifest(def.id);
    /*
      ★ 等待期间小人可能已经被换掉/拆掉了（换人、视角切换重建精灵…）。
      过期的异步结果必须直接丢：不检查的话，一个旧的 state 会被标记成 ready、
      新挂上的小人反而被留在"永远加载中"—— 又是一例模型丢失。
    */
    if ((cardSprite.userData as { chibi?: ChibiState }).chibi !== state) return;
    if (!manifest) {
      state.hooks.onFailed?.();
      return;
    }
    const names = Object.keys(manifest.animations);
    const loaded = await Promise.all(names.map((n) => loadStrip(def.id, n, manifest.animations[n])));
    if ((cardSprite.userData as { chibi?: ChibiState }).chibi !== state) return;
    names.forEach((n, i) => {
      const img = loaded[i];
      if (img) state.images[n] = img;
    });
    if (Object.keys(state.images).length === 0) {
      state.hooks.onFailed?.();
      return;
    }
    // 优先 idle，没有就随便挑一个有的
    if (!state.images.idle) state.current = (Object.keys(state.images)[0] as ChibiMode) ?? 'idle';
    state.anims = manifest.animations;
    // 贴图尺寸/站位要等清单回来才算得准（宽高比写在清单里）
    layoutChibi(state, manifest.cell, manifest.box, chibiModelScaleFor(def));
    state.ready = true;
    sprite.visible = true;
    drawFrame(state);
    state.hooks.onReady?.();
  })();
}

/**
 * 把小人从卡片精灵上整个拆掉。
 *
 * 【为什么必须存在这个函数？】
 * 换人（restyle）时旧小人是**上一个干员的模型**，不拆掉就是"模型错乱"；
 * 精灵被从场景里摘掉时也不拆小人 → 每个被丢弃的棋子都漏一张 224×170 的
 * canvas 贴图，一局下来能漏几百张。
 * 同时把 `pendingAttach` 里的排队项也撤掉 —— 不然索引晚到一步，
 * 会给一个早就被丢弃的精灵挂上小人（白加载，还引用着不让 GC 回收）。
 */
export function detachChibi(cardSprite: Sprite): void {
  // 还在排队等索引的也一并撤掉
  for (let i = pendingAttach.length - 1; i >= 0; i--) {
    if (pendingAttach[i]!.sprite === cardSprite) pendingAttach.splice(i, 1);
  }
  const data = cardSprite.userData as { chibi?: ChibiState };
  const state = data.chibi;
  if (!state) return;
  cardSprite.remove(state.sprite);
  state.texture.dispose();
  data.chibi = undefined;
}

/**
 * 按清单里的画布/设计框尺寸摆好小人精灵。
 *
 * 【为什么不在 attachChibi 里一次算完？】
 * 因为"宽高比"决定小人的宽高比，而这个数字写在清单里（渲染时定的）。
 * 清单是异步拉回来的，拉回来之前算出来的缩放可能偏一点，会闪一下。
 * 所以 sprite 在清单到位前一直 visible=false，到位后一次摆好再显示。
 *
 * 【尺寸换算：先按设计框算，再按画布放大】
 * 卡片精灵的世界缩放是 (0.72, 0.96)，小人精灵是它的子节点，
 * 子节点的 scale 会**再乘一次**父节点的 scale。所以这里要除掉父节点缩放。
 *
 * 小人的"视觉大小"由**设计框**决定 —— 而且现在直接锚在**世界单位**上
 * （CHIBI_WORLD_H，见 card-layout.ts），不再是"立绘区的百分之多少"。
 * 因为棋盘格子边长是固定的 1.0 世界单位，只有锚在世界单位上
 * 才能保证"小人和地块差不多大"这件事在任何卡片版式下都成立。
 * 精灵贴的是**整张画布**，画布比设计框大 (cell/box) 倍
 * （渲染器为了让挥武器/阵亡的动作不被裁掉而撑大的），
 * 所以精灵的世界尺寸要再乘 (cell.h/box.h) —— 一放一收，画面上大小不变，
 * 多出来的只是"能画到立绘区外面去"的余量。
 *
 * 【★★ 站位：用 `center`，不要用 `position` ★★】
 * 小人挂在卡片精灵下面，子节点的 `position` 是**世界坐标系**里的偏移，
 * 而卡片精灵是个 billboard：它的**大小**是视图空间里的，**位置偏移**却是世界空间的。
 * 相机俯角（约 65°）会把世界竖直偏移在屏幕上压扁到 ~42%，透视还会整体往一边推
 * —— 用 position 摆出来的"脚底在卡片高度 44% 处"，屏幕上根本不是那个位置。
 *
 * 所以站位改走 `sprite.center`：sprite 的顶点着色器里
 * `alignedPosition = (position.xy - (center - 0.5)) * scale`，
 * 这一项加在**视图空间**上（`mvPosition.xy += alignedPosition`），
 * 所以它精确等于"卡片高度的百分之几"，不受俯角影响、也不横向漂移。
 *
 * 【具体解出来的式子】
 * 设设计框底边在画布里的归一化位置是 anchorY（0.5 = 画布竖直中点），
 * 精灵世界高 worldH（世界单位）、卡片世界高 CARD_WORLD_SCALE.y。
 * 设计框底边相对精灵原点的视图空间偏移 = (anchorY - cy + 0.5) * worldH，
 * 希望它等于 -(CHIBI_FOOT_SCREEN - 0.5) * CARD_WORLD_SCALE.y（向下为正），
 *   ⇒ cy = anchorY + 0.5 + (CHIBI_FOOT_SCREEN - 0.5) * CARD_WORLD_SCALE.y / worldH
 * 横向同理：设计框在画布里水平居中，让它对齐卡片中线 ⇒ cx = 设计框水平中点。
 *
 * canvas 的 y 向下、three.js 的 y 向上 —— 上面的 anchorY 已经翻好符号了。
 */
function layoutChibi(
  state: ChibiState,
  cell: { w: number; h: number },
  box?: { x: number; y: number; w: number; h: number },
  modelScale = 1,
): void {
  if (cell && cell.w > 0 && cell.h > 0) {
    if (state.canvas.width !== cell.w || state.canvas.height !== cell.h) {
      state.canvas.width = cell.w;
      state.canvas.height = cell.h;
      state.texture.needsUpdate = true;
      state.drawnFrame = -1;
      state.drawnAnim = '';
    }
  }

  // 老清单没有 box：按"画布=设计框"处理（= 老行为）
  const bx = box && box.w > 0 && box.h > 0 ? box : { x: 0, y: 0, w: cell.w, h: cell.h };
  state.box = { x: bx.x, y: bx.y, w: bx.w, h: bx.h };
  const cw = state.canvas.width;
  const chh = state.canvas.height;

  /*
    设计框在世界里占 CHIBI_WORLD_H 这么高；精灵贴的是整张画布，所以要按 (画布/设计框) 放大。
    ★ modelScale 是"野怪按级别/逐只定的那档倍率"（见 chibiWorldSize / chibiModelScaleFor）。
    它乘在**世界尺寸**上，脚底锚点（下面的 CHIBI_FOOT_SCREEN）不动 ——
    所以是"从地面往上长高"，整体不会上浮。
  */
  const size = chibiWorldSize({ w: cw, h: chh }, bx, modelScale);
  state.sprite.scale.set(size.w / CARD_WORLD_SCALE.x, size.h / CARD_WORLD_SCALE.y, 1);

  /*
    设计框底边 / 水平中点在**画布**里的归一化坐标（y 向下 → 翻成向上为正）。
    anchorY 也就是"设计框底边在精灵本地坐标里对应的那个顶点位置"。
  */
  const anchorY = 0.5 - (bx.y + bx.h) / chh;
  const anchorX = (bx.x + bx.w / 2) / cw;

  /*
    ★ 站位：原点留在卡片中心（世界位置不动），位置全部交给 center（视图空间偏移）。
    见上面【★★ 站位 ★★】的推导。
  */
  state.sprite.center.set(
    anchorX,
    anchorY + 0.5 + ((CHIBI_FOOT_SCREEN - 0.5) * CARD_WORLD_SCALE.y) / size.h,
  );
  state.sprite.position.set(0, 0, DEPTH_EPSILON);
}

/** 把当前帧画到画布上（只在帧号真的变了的时候才重画 + 上传贴图） */
function drawFrame(state: ChibiState): void {
  const anim = state.current;
  const def = state.anims[anim] ?? state.anims.idle;
  const img = state.images[anim] ?? state.images.idle;
  if (!def || !img) return;
  /*
    ★ 0.2：眩晕时**每帧都要重画**（头顶那圈星星在转）。
    不眩晕时还是老规矩：动作/帧号/朝向都没变就直接返回，一次多余的上传都不做。
  */
  if (
    !state.dizzy &&
    state.drawnAnim === anim &&
    state.drawnFrame === state.frame &&
    state.drawnMirror === state.mirror
  ) {
    return;
  }

  const w = state.canvas.width;
  const h = state.canvas.height;
  state.ctx.clearRect(0, 0, w, h);
  /*
    ★ 镜像：**关于画布竖直中线水平翻转**（x' = w - x）。

    【为什么可以直接翻画布，而不是翻精灵的 scale？】
    three.js 的 Sprite 顶点着色器里 `scale.x = length(modelMatrix[0].xyz)` ——
    取的是**模长**，永远是正的。所以把 `sprite.scale.x` 写成负数**根本不翻**，
    只会白改一个数。真正的翻转只能落在贴图上，而这里每帧本来就要重画一次，
    顺手加一个变换即可，一点额外开销都没有。

    【为什么中线翻转不会让小人的站位偏掉？】
    小人的"站位"是靠 sprite.center 锚在**设计框**上的（见 layoutChibi）。
    所有清单里的设计框都是**水平居中**的（render-chibi.mjs 保证），
    也就是 bx.x + bx.w/2 === cw/2 —— 所以"画布中线"就是"设计框中线"，
    以它为轴翻转，锚点一个像素都不动。

    【为什么只在镜像时才 setTransform？】
    没镜像时连一次多余调用都不做，假 ctx（jsdom 测试里的桩）也就不用实现它。
    翻转画完之后必须复位，否则下一帧（可能已经不镜像了）会继续翻。
  */
  if (state.mirror) state.ctx.setTransform(-1, 0, 0, 1, w, 0);
  state.ctx.drawImage(img, state.frame * w, 0, w, h, 0, 0, w, h);
  if (state.mirror) state.ctx.setTransform(1, 0, 0, 1, 0, 0);
  // ★ 0.2：眩晕星星画在**取消镜像之后**（它是界面符号，不该跟着小人一起翻）
  if (state.dizzy) drawDizzyStars(state);
  state.texture.needsUpdate = true;
  state.drawnAnim = anim;
  state.drawnFrame = state.frame;
  state.drawnMirror = state.mirror;
}

/**
 * ★ 0.2：眩晕星星（画进小人的画布，不额外挂精灵）。
 *
 * 【为什么画进画布，而不是像金色光华那样另挂一个精灵？】
 *   · 画布本来就是"每帧可能重画"的（帧号变了就重画），顺手多画三颗星，
 *     既不用管层级（`depthWrite:false` 那一套）、也不用管"单位死了要记得摘"；
 *   · 星星天然跟着小人的缩放/镜像/站位走，不需要第二套坐标换算。
 *
 * 位置取**设计框**（`state.box`）的上沿 —— 那就是"头顶"，野怪画布多出来的留白不参与。
 */
function drawDizzyStars(state: ChibiState): void {
  const ctx = state.ctx;
  const cw = state.canvas.width;
  const box = state.box;
  const baseW = box.w > 0 ? box.w : cw;
  const cx = box.w > 0 ? box.x + box.w / 2 : cw / 2;
  const cy = (box.h > 0 ? box.y : 0) + baseW * 0.03;
  const ring = baseW * 0.13;
  const size = baseW * 0.05;
  for (let i = 0; i < 3; i++) {
    const angle = state.dizzySpin + (i * Math.PI * 2) / 3;
    // y 方向压扁 0.35：这是斜俯视的棋盘，星星绕的是"头顶那个圈"的透视
    drawDizzyStar(ctx, cx + Math.cos(angle) * ring, cy + Math.sin(angle) * ring * 0.35, size, angle * 0.6);
  }
}

/** 一颗四角星（金色 + 深色描边，和项目的特效配色一致） */
function drawDizzyStar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  rotation: number,
): void {
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const angle = rotation + (i * Math.PI) / 4 - Math.PI / 2;
    const radius = i % 2 === 0 ? r : r * 0.36;
    const px = x + Math.cos(angle) * radius;
    const py = y + Math.sin(angle) * radius;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = '#ffe08a';
  ctx.fill();
  ctx.lineWidth = Math.max(1, r * 0.18);
  ctx.strokeStyle = '#8a5c10';
  ctx.stroke();
}

/**
 * ★ 0.2：要不要给这只小人开"眩晕星星"。
 *
 * 星星**不参与**动作判定（`current` 该是 idle 还是 stun 跟它无关），
 * 所以切换时要强行重画一次 —— 否则关掉的时候会残留一圈星星。
 *
 * @param seconds 传 `this.timeSeconds`，星星会绕头顶转（约 0.7 圈/秒）
 */
export function setChibiDizzy(cardSprite: Sprite, active: boolean, seconds = 0): void {
  const state = (cardSprite.userData as { chibi?: ChibiState }).chibi;
  if (!state || !state.ready) return;
  const spin = seconds * 4.5;
  if (state.dizzy === active && Math.abs(state.dizzySpin - spin) < 0.06) return;
  state.dizzy = active;
  state.dizzySpin = spin;
  // 星星的"有/没有"不在 drawFrame 的帧号判定里 —— 这里强制它重画一次
  state.drawnFrame = -1;
  state.drawnAnim = '';
  drawFrame(state);
}

/**
 * 设置小人要不要左右镜像（红方 / 对手 / 野怪 = true）。
 *
 * 【为什么要有这个 setter，而不是只在 attachChibi 里传？】
 * 同一只棋子的朝向可能在**挂好小人之后**才确定：
 *   · 看别人的棋盘（同一批精灵先按"我方"建出来，再看他的阵容）——
 *     其实是重新建精灵，但测试沙盒切边、联机投降换视角时也会走到；
 *   · restyle（换人 / 升星）时队伍没变，可朝向要跟着走。
 * 所以给一个幂等的 setter，改了立刻重画一帧 ——
 * 不然要等下一次动画推进（几十分之一秒到一整轮循环）才翻过来，
 * 视觉上就是"切过去了但小人还朝着原来那边"。
 */
export function setChibiMirror(cardSprite: Sprite, mirror: boolean): void {
  const state = (cardSprite.userData as { chibi?: ChibiState }).chibi;
  if (!state || state.mirror === mirror) return;
  state.mirror = mirror;
  drawFrame(state);
}

/**
 * ★ 0.0.3：标记小人进入 / 离开"倒地等复活"。
 *
 * 【为什么要它？】
 * 敌人的阵亡动作演到最后会**整只消失**（见 DOWNED_HOLD_RATIO）。
 * 而"倒地等复活"这个状态要躺好几秒 —— 照播到底就变成
 * "模型消失了"。进入倒地时把这个标记打开，阵亡动作就会停在倒地姿势上；
 * 站起来（rebirth）时关掉它，下一次切 idle 就正常站起来了。
 */
export function setChibiDowned(cardSprite: Sprite, downed: boolean, speed = 1): void {
  const state = (cardSprite.userData as { chibi?: ChibiState }).chibi;
  if (!state) return;
  const nextSpeed = downed ? Math.max(0.1, speed) : 1;
  if (state.downedHold === downed && state.downedSpeed === nextSpeed) return;
  state.downedHold = downed;
  // 只有"进入倒地"时才记倍率；站起来时复位，免得下次别的动作也跟着变快
  state.downedSpeed = nextSpeed;
  // 从"倒地"回到站立：立刻切回待机，别等下一帧的 mode 计算
  if (!downed && state.ready) {
    state.current = animKeyFor(state, 'idle');
    state.frame = 0;
    state.acc = 0;
    drawFrame(state);
  }
}

/**
 * ★ 0.0.3：切换小人的**形态**（1 = 一阶段，2 = 二阶段）。
 *
 * 【它做什么？】
 * 只是把"该用哪套动作"换掉，然后立刻重画一帧：
 * 清单里有 `idle2 / attack2 / …` 就用它们（Boss 骨架里的 C2_* / B_*），
 * 没有就什么都不变（普通棋子、没有二阶段素材的野怪都是这样）。
 *
 * 【为什么立刻切到 idle 而不是等下一次 mode 计算？】
 * 复活那一刻小人正停在 die 的最后一帧（倒地）。不主动切的话，
 * 它会等到下一次"该播 idle 了"才站起来 —— 而那可能差好几帧，
 * 看起来像"复活了但还躺着"。
 */
export function setChibiPhase(cardSprite: Sprite, phase: number): void {
  const state = (cardSprite.userData as { chibi?: ChibiState }).chibi;
  if (!state) return;
  const next = phase >= 2 ? 2 : 1;
  if (state.phase === next) return;
  state.phase = next;
  if (!state.ready) return;
  state.current = animKeyFor(state, 'idle');
  state.frame = 0;
  state.acc = 0;
  drawFrame(state);
}

/**
 * ★ 0.0.3：把小人整个换成**另一套素材**（`defId` 指向另一份清单）。
 *
 * 【什么时候用？】
 * “盛怒”的二阶段在素材库里是**独立的一套文件**（`enemy_1129_spklr_2`），
 * 而不是同一套骨架里的另一批动作 —— 所以只能整个换。
 * 两个 Boss（博卓卡斯替 / 奎隆）不是这种情况，它们走 setChibiPhase。
 *
 * 【为什么不能直接 detach + attach？】
 * 那样会丢掉镜像、不透明度、以及"卡片那头已经切到留空立绘"的状态，
 * 换完还得重新走一遍异步加载和回调，中间会闪一下空白。
 * 这里保留同一个 state/canvas/贴图，只把内容换掉。
 */
export function setChibiSource(cardSprite: Sprite, defId: string, def?: UnitDef): void {
  const state = (cardSprite.userData as { chibi?: ChibiState }).chibi;
  if (!state || state.defId === defId) return;
  state.defId = defId;
  state.ready = false;
  state.sprite.visible = false;
  state.anims = {};
  state.images = {};
  state.current = 'idle';
  state.frame = 0;
  state.acc = 0;
  state.drawnAnim = '';
  state.drawnFrame = -1;

  void (async () => {
    const manifest = await loadManifest(defId);
    if ((cardSprite.userData as { chibi?: ChibiState }).chibi !== state) return;
    if (!manifest) {
      state.hooks.onFailed?.();
      return;
    }
    const names = Object.keys(manifest.animations);
    const loaded = await Promise.all(names.map((streamName) => loadStrip(defId, streamName, manifest.animations[streamName]!)));
    if ((cardSprite.userData as { chibi?: ChibiState }).chibi !== state) return;
    names.forEach((streamName, i) => {
      const img = loaded[i];
      if (img) state.images[streamName] = img;
    });
    if (Object.keys(state.images).length === 0) {
      state.hooks.onFailed?.();
      return;
    }
    state.current = animKeyFor(state, 'idle');
    if (!state.images[state.current]) state.current = Object.keys(state.images)[0] ?? 'idle';
    state.anims = manifest.animations;
    layoutChibi(state, manifest.cell, manifest.box, def ? chibiModelScaleFor(def) : 1);
    state.ready = true;
    state.sprite.visible = true;
    drawFrame(state);
    state.hooks.onReady?.();
  })();
}

/** ★ 0.0.3：这个小人现在在第几阶段（回放层用，幂等） */
export function chibiPhaseOf(cardSprite: Sprite): number {
  const state = (cardSprite.userData as { chibi?: ChibiState }).chibi;
  return state ? state.phase : 1;
}

/**
 * ★ 0.0.3：让小人**微微前倾**（走路时朝前进方向倒一点）。
 *
 * 【为什么必须由这里来转，而不是 replay 直接转精灵？】
 * 因为精灵的材质是 chibi 内部的东西，而"转哪个精灵"很容易搞错：
 * 棋子身上其实有**两层**精灵 ——
 *   · 卡片精灵（`visual.sprite`）：画的是卡框 / 立绘 / 血条，
 *   · 小人精灵（`state.sprite`）：卡片下面那层，画 Q 版小人（drawFrame 逐帧画上去的）。
 * 一开始把角度写在了卡片那层，结果**整张卡框跟着歪**，小人自己纹丝不动。
 * 所以这条规则收进 chibi.ts：转的永远是**小人**那一层。
 *
 * 【为什么转起来是"从脚底倒"而不是"绕腰转"？】
 * Sprite 是绕 `sprite.center` 转的，而小人精灵的 center 正好锚在**脚底**
 * （见 layoutChibi），所以前倾看起来是从地面蹬出去的，而不是原地扭腰。
 */
export function setChibiLean(cardSprite: Sprite, lean: number): void {
  const state = (cardSprite.userData as { chibi?: ChibiState }).chibi;
  if (!state || !state.ready) return;
  const material = state.sprite.material as SpriteMaterial;
  // 浮点比较用"变化极小就不写"，避免每帧都标记材质 dirty
  if (Math.abs(material.rotation - lean) < 1e-4) return;
  material.rotation = lean;
}

/**
 * ★ 0.0.3：给调试探针看的一张小人体检表（`?debug=1` 下由 motion 探针调用）。
 *
 * 返回的是**表现层的事实**：现在在播哪个动作、第几帧、精灵歪了多少、有没有走路素材。
 * 走路这类东西光看代码验证不了（它每帧都在变），只能真的开一次浏览器采样。
 */
export function chibiProbeOf(cardSprite: Sprite): {
  anim: string;
  /** ★ 0.2：这一帧想播的动作（没有素材时 anim 会退回 idle，但 mode 仍是真实意图） */
  mode: string;
  frame: number;
  lean: number;
  hasMove: boolean;
} | null {
  const state = (cardSprite.userData as { chibi?: ChibiState }).chibi;
  if (!state) return null;
  const material = state.sprite.material as SpriteMaterial;
  return {
    anim: state.current,
    mode: state.lastMode ?? state.current,
    frame: state.frame,
    lean: material.rotation,
    hasMove: Boolean(state.anims['move']),
  };
}

/**
 * ★ 0.0.3：这只小人有某个动作的素材吗（会走 animKeyFor，二阶段的 move2 也算）。
 *
 * 【谁在用？】
 * replay.ts 的走路段落：**有走路素材**（野怪）就直接播它；
 * **没有**（干员）就退回"待机 + 程序化走姿"（上下颠一步、朝前进方向微微前倾），
 * 这样两类单位都是"在走"，而不是干员像贴纸一样平移过去。
 */
export function hasChibiAnim(cardSprite: Sprite, mode: ChibiMode): boolean {
  const state = (cardSprite.userData as { chibi?: ChibiState }).chibi;
  if (!state || !state.ready) return false;
  const key = animKeyFor(state, mode);
  return Boolean(state.anims[key]);
}

/**
 * 这套动作在**本色**下要播多久（秒）—— 攻击/技能的动作节奏要用它算。
 *
 * 【为什么由 chibi.ts 提供，而不是让 replay 自己算？】
 * 因为"这套动作几帧、帧率多少"是素材的事，只有这里知道；
 * replay 那边要是自己写 `frames / fps`，就是在两处维护同一份知识。
 * 动作名也要走 `animKeyFor`，否则二阶段（idle2 / attack2）会算错。
 *
 * @returns 秒数；素材还没就绪时返回 null（调用方跳过节奏计算）
 */
export function chibiAnimSeconds(cardSprite: Sprite, mode: ChibiMode): number | null {
  const state = (cardSprite.userData as { chibi?: ChibiState }).chibi;
  if (!state || !state.ready) return null;
  const key = animKeyFor(state, mode);
  const def = state.anims[key] ?? state.anims.idle;
  if (!def) return null;
  return def.frames / Math.max(1, def.fps);
}

/**
 * 每帧推进小人动画。
 *
 * @param cardSprite 棋子卡片精灵
 * @param deltaSeconds 这一帧过了多久（秒）
 * @param mode 想播哪个动作（由 replay.ts 根据战斗事件决定）
 * @param speed 播放倍率。默认 1；可以拿它跟攻速挂钩（攻速快动作就快）
 * @param restartAction ★ 0.0.3：**同一个动作又开始了新的一轮**（新一次挥击 / 新一次施法）。
 *   非循环动作（attack / skill）播完会停在最后一帧，而"连续攻击"时这个动作
 *   在好几秒里一直是当前动作 —— 不重头播的话画面就僵住了（详见下面那段注释）。
 *   传 true 的那一刻会把它从第 0 帧重新播一遍。
 */
export function updateChibi(
  cardSprite: Sprite,
  deltaSeconds: number,
  mode: ChibiMode,
  speed = 1,
  restartAction = false,
): void {
  const state = (cardSprite.userData as { chibi?: ChibiState }).chibi;
  if (!state || !state.ready) return;
  state.lastMode = mode;

  // 想要的动画（没有这个动作就退回 idle）
  const wantedKey = animKeyFor(state, mode);
  const wanted: string = state.anims[wantedKey] ? wantedKey : 'idle';
  let animName: string = wanted;

  if (wanted !== state.current) {
    /*
      ★ 要不要真的切过去？（0.0.2 追加需求第 3 条）

      规则：**只有优先级更高的动作才能打断正在播的动作**；
      优先级更低（或相同）的必须等当前动作播完。
      正在播的是循环动作（idle）时，任何动作都能立刻打断它。
    */
    const currentDef = state.anims[state.current];
    const currentFinished = !currentDef || currentDef.loop || state.frame >= currentDef.frames - 1;
    // 比的是**基础动作**（idle2 的基础是 idle），否则二阶段的动作优先级会算错
    if (MODE_PRIORITY[baseModeOf(state.current)] > MODE_PRIORITY[baseModeOf(wanted)] && !currentFinished) {
      // 保持当前动作 —— 这就是"动画不再被反复打断"的地方
      animName = state.current;
    }
  }

  const animDef = state.anims[animName] ?? state.anims.idle;
  if (!animDef) return;

  /*
    ★ 动作切换：换动画就从头播（避免 Attack 播到一半切回 Idle 时停在奇怪的第 7 帧）
  */
  if (state.current !== animName) {
    state.current = animName;
    state.frame = 0;
    state.acc = 0;
  }

  /*
    ============================================================
     ★★ 用户报的 bug：野怪"攻击若干次后攻击动画失效"
    ============================================================
    根因是**非循环动作 + 连续触发**这一对：

      · 挥击窗口的时长**恰好等于攻击间隔**（设计要求的"一次攻击一个动作循环"），
        所以站桩输出时窗口首尾相接 —— `stepSwing` 在窗口结束的**同一帧**
        就把下一次挥击排上，`pickMode` 于是帧帧都是 `attack`；
      · 而攻击动作是 `loop: false`：播完停在最后一帧。既然 mode 一直是 attack，
        `state.current` 就一直是 attack，帧号永远停在那一帧 —— 整个人僵在收招姿势。
        （复现见 chibi-anim.test.ts：8 秒里有 400 多帧"一边在挥、画面一动不动"。）

    只在窗口被打断过（走位 / 被控 / 目标阵亡）之后 mode 才会掉回 idle，
    下一击才又能从第 0 帧播一遍 —— 这就是"**若干次之后**才失效"。

    修法：**由驱动方在"新一次挥击/施法开始"那一刻传 restartAction**，
    这里把这个动作从头播一遍（等价于"一次攻击一个动作循环"）。
    为什么不在这里自己"播完就重播"？那样动作会永远处在循环中，
    `currentFinished` 永远为 false，于是连"打完切回 idle"都会被优先级挡掉 ——
    就成了"挥完一直在原地空挥"。谁开始新动作，谁负责喊这一声，最不容易错。
  */
  if (restartAction && animName === wanted && !animDef.loop) {
    state.frame = 0;
    state.acc = 0;
  }

  /*
    ★ 倒地等复活时，阵亡动作只播到 DOWNED_HOLD_RATIO 就停住。
    理由见 DOWNED_HOLD_RATIO 的注释（照播到底整只人就化没了）。
    只在"确实是在演阵亡动作"时生效，死亡（真的死）不受影响。
  */
  const downedAnim = state.downedHold && baseModeOf(animName) === 'die';
  const holdFrame = downedAnim
    ? Math.max(0, Math.ceil(animDef.frames * DOWNED_HOLD_RATIO) - 1)
    : animDef.frames - 1;

  /*
    ★ 倒地演出的播放倍率（数据里的 `reborn.downedAnimSpeed`，见 setChibiDowned）。
    杰斯顿的阵亡动作有 4 秒、倒地只等 3 秒 —— 原速播"还没倒稳就到点了"，
    所以它写了 2（两倍速）。别的单位是 1，一点变化都没有。
  */
  const playSpeed = downedAnim ? Math.max(0.1, speed * state.downedSpeed) : speed;

  state.acc += deltaSeconds * Math.max(0.1, playSpeed);
  const step = 1 / Math.max(1, animDef.fps);
  while (state.acc >= step) {
    state.acc -= step;
    state.frame++;
    if (state.frame > holdFrame) {
      if (animDef.loop) {
        state.frame = 0;
      } else {
        // 非循环动画播完就停在最后一帧；下一次切回别的时候会重置
        state.frame = holdFrame;
        break;
      }
    }
  }

  drawFrame(state);
}

/**
 * 统一的动作选择：优先级 die > skill > attack > **move** > idle。
 *
 * 【为什么"走路"排在攻击/技能之后？】
 * 一边走一边打的时候，出手动作必须看得见 —— 走路是背景动作，
 * 被打断一下完全没问题（挪完剩下的那点距离滑完就行）。
 * 反过来，如果走路能压过出手，就会变成"走过去但打人的动作不见了"。
 */
export function pickMode(opts: {
  dead: boolean;
  castGlow: number;
  lunge: number;
  /** ★ 0.0.3：这一帧是不是正在往下一格挪（走路） */
  moving?: boolean;
  /**
   * ★ 0.2：这一帧是不是在眩晕状态里（`visual.effectExpiry.stun` 还没到点）。
   * 眩晕**压过出手/施法**（被晕了不该继续挥拳），只在阵亡之下。
   */
  stunned?: boolean;
}): ChibiMode {
  if (opts.dead) return 'die';
  if (opts.stunned) return 'stun';
  if (opts.castGlow > 0) return 'skill';
  if (opts.lunge > 0) return 'attack';
  if (opts.moving) return 'move';
  return 'idle';
}

/**
 * ★ 0.2：没有官方 `Stun` 动作时的"程序化眩晕"角度。
 *
 * 让小人**以脚为轴左右摇**（±0.1 弧度 ≈ ±5.7°），像被打懵了站不稳。
 *
 * 【为什么只返回一个角度、不自己写材质？】
 * 因为 `setChibiLean` **每帧**都会把"走路前倾"写进 `material.rotation`
 * （不走路时写 0）—— 眩晕自己也去写的话，谁后写谁生效，摇晃就被抹掉了。
 * 所以这里只算角度，由 `replay.ts` 把它和 `walkLean` **加起来**再一次性写下去。
 *
 * 【为什么不用序列帧？】
 *   ① 55 个干员里只有 6 个有官方 Stun，给其余 49 个每人渲一套"摇晃"要多几十 MB 素材；
 *   ② 一次正弦就够了，零素材；
 *   ③ 有官方动作的那 6 个不走这条路（播真动作更自然），不会双重摇晃。
 */
export function stunWobbleLean(seconds: number): number {
  return Math.sin(seconds * 7) * 0.1;
}

/**
 * ★ 0.0.3：这次点击的落点，在小人身上是"实的"吗？
 *
 * ============================================================
 *  【为什么需要它？—— 你报的"战斗中点击面太大"】
 * ============================================================
 * 小人精灵贴的是**整张画布**，而画布为了让"挥武器 / 倒地"不被裁掉，
 * 比模型本身大了一圈（野怪最宽 2.58 格）。射线打的是四边形，
 * 不管那里有没有像素 —— 于是"点小人旁边的空气"也算点中了它。
 *
 * 【做法：直接读那一个像素的 alpha】
 * 画布是逐帧画上去的（drawFrame 把当前帧画进 state.canvas），
 * 所以 uv 能一一对应到画布像素：拿 ctx.getImageData 读一次 alpha 就行。
 * 点击是低频操作（不是每帧），这一次读像素的开销可以忽略。
 *
 * @returns `true` = 落在实心像素上；`false` = 落在透明处；`null` = 没法判断
 *   （没有小人 / 素材没就绪 / 环境没有真的 canvas）—— 调用方应当**放行**，
 *   保持"立绘 / 占位小人照样能点"的老行为。
 */
export function chibiOpaqueAt(cardSprite: Sprite, uv?: { x: number; y: number }): boolean | null {
  const state = (cardSprite.userData as { chibi?: ChibiState }).chibi;
  if (!state || !state.ready || !uv) return null;
  const w = state.canvas.width;
  const h = state.canvas.height;
  if (!w || !h) return null;
  const px = Math.floor(uv.x * w);
  // three.js 的 uv 原点在**左下**，canvas 在左上 —— y 要翻过来
  const py = Math.floor((1 - uv.y) * h);
  try {
    /*
      采样时留一点**容差**（默认 5 像素）：只判一个点的话，
      "点在小人两腿之间 / 脚边一像素"就会落空，手感很差。
      容差取 5 是因为画布换算到屏幕上大约 30~60 像素宽，
      5 像素还不到小人的一个手指粗 —— 挡得住"点空气"，又不会把小人的边角判丢。
    */
    const pad = 5;
    const probes: Array<[number, number]> = [
      [px, py],
      [px - pad, py],
      [px + pad, py],
      [px, py - pad],
      [px, py + pad],
    ];
    for (const [x, y] of probes) {
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      if (state.ctx.getImageData(x, y, 1, 1).data[3]! > 8) return true;
    }
    // 全部落在画布外 = 这个点根本不在小人的四边形里
    if (px < -pad || py < -pad || px >= w + pad || py >= h + pad) return null;
    return false;
  } catch {
    // 假 ctx（jsdom 测试）/ 跨源画布污染 —— 判断不了就放行
    return null;
  }
}

/**
 * ★ 0.0.3：把一个**世界坐标点**换算成小人画布上的 uv。
 *
 * 【为什么不用射线自带的 hit.uv？】
 * 因为射线可能打在**卡面**上（小人精灵只是卡片下面的一张子精灵，
 * 脚底/头顶那一圈是卡面先被命中）。卡面的 uv 是小人贴图的 uv，不是画布的 ——
 * 拿它去采样会采到完全不相干的像素。
 * 所以统一改成"拿世界交点反算小人本地坐标"：
 * 小人精灵是一个单位四边形（-0.5..0.5），matrixWorld 的逆变换直接给出
 * 它在四边形里的位置，加 0.5 就是 uv。这样**不管射线先打到谁**，口径都一样。
 *
 * @returns 落在小人的四边形外时返回 null
 */
export function chibiUvAtPoint(cardSprite: Sprite, point: { x: number; y: number; z: number }): { x: number; y: number } | null {
  const state = (cardSprite.userData as { chibi?: ChibiState }).chibi;
  if (!state || !state.ready) return null;
  const sprite = state.sprite;
  sprite.updateWorldMatrix(true, false);
  inverseMatrix.copy(sprite.matrixWorld).invert();
  localPoint.set(point.x, point.y, point.z).applyMatrix4(inverseMatrix);
  const u = localPoint.x + 0.5;
  const v = localPoint.y + 0.5;
  if (u < 0 || u > 1 || v < 0 || v > 1) return null;
  return { x: u, y: v };
}

/** 从卡片精灵上取回小人贴图（调试用） */
export function chibiTextureOf(cardSprite: Sprite): Texture | null {
  const state = (cardSprite.userData as { chibi?: ChibiState }).chibi;
  return state ? state.texture : null;
}

/**
 * 调整小人的不透明度（拖动时用）。
 *
 * 【为什么需要它？】
 * 卡片精灵自己的 `opacity` **不会**影响子节点 —— 小人材质是各自 new 的。
 * 所以拖场上棋子时，光把卡片压淡、小人还是实心的，
 * 结果"被拖走的那只"依然是一坨挡在落点上，看不出格子高亮。
 * 拖动开始时连小人一起压淡，松手时再恢复。
 */
export function setChibiOpacity(cardSprite: Sprite, opacity: number): void {
  const state = (cardSprite.userData as { chibi?: ChibiState }).chibi;
  if (!state) return;
  const material = state.sprite.material as SpriteMaterial;
  material.transparent = true;
  material.opacity = opacity;
  material.needsUpdate = true;
}

/**
 * ★ 0.0.3：把小人序列帧的**第一帧**裁出来当"立绘"（data URL）。
 *
 * ============================================================
 *  【为什么需要它？】
 * ============================================================
 * 野怪走的是官方 `models_enemies` 那套素材，**没有独立立绘**
 * （`assets/units/mn_*.png` 不存在），所以备战席卡面、商店卡片那种
 * `<img src="units/xxx.png">` 的写法对它们全是空白。
 * 但备战席总得有张图 —— 玩家要的正是"用小人模型立绘"。
 *
 * 做法：载入该棋子的 `idle` 横向序列帧图，把第 0 帧裁下来画进一张
 * canvas，导出成 data URL 缓存起来。命中一次以后就是纯内存读取。
 *
 * 【为什么返回 null 还要 onReady？】
 * 素材是异步拉的，这个函数是同步接口（渲染时直接调）。
 * 第一次调用触发加载并返回 null（调用方先不画图），加载完调 onReady，
 * 调用方在回调里重绘一次、这次就能拿到 data URL 了。
 *
 * @returns 已经备好的 data URL；还没好就返回 null（并异步加载）
 */
const portraitCache = new Map<string, string>();
const portraitPending = new Set<string>();

export function chibiPortraitUrl(def: UnitDef, onReady?: () => void): string | null {
  if (!def.charId) return null;
  const cached = portraitCache.get(def.id);
  if (cached) return cached;
  // 索引已经明确说"这个棋子没有小人素材" -> 别白加载
  if (indexReady && !index[def.id]) return null;
  if (!indexReady || portraitPending.has(def.id)) return null;

  portraitPending.add(def.id);
  void (async () => {
    const manifest = await loadManifest(def.id);
    if (!manifest) {
      portraitPending.delete(def.id);
      return;
    }
    // 优先 idle；没有 idle 就随便挑一个有的动作（取第一帧总能画出点什么）
    const animKey = manifest.animations.idle ? 'idle' : Object.keys(manifest.animations)[0];
    const animDef = animKey ? manifest.animations[animKey] : undefined;
    if (!animKey || !animDef) {
      portraitPending.delete(def.id);
      return;
    }
    const img = await loadStrip(def.id, animKey, animDef);
    portraitPending.delete(def.id);
    if (!img) return;

    const w = manifest.cell?.w ?? img.width;
    const h = manifest.cell?.h ?? img.height;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    // 横向序列帧：第 0 帧在 x=0（和 drawFrame 的切图方式一致）
    ctx.drawImage(img, 0, 0, w, h, 0, 0, w, h);
    portraitCache.set(def.id, canvas.toDataURL('image/png'));
    onReady?.();
  })();
  return null;
}

/** 诊断：载入了多少小人素材 */
export function chibiStats(): { indexed: number; manifests: number; strips: number; missing: number; ready: boolean } {
  return { indexed: Object.keys(index).length, ...stats, ready: indexReady };
}
