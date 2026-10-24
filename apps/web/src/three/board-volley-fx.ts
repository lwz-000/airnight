/**
 * ============================================================
 *  ★★ 0.2.1：**全场扫射**（羁绊级大招的"面"特效）
 * ============================================================
 *
 * 【它和别的特效模块有什么区别？】
 *   · `sequence-fx` / `vishdal-bloom` / `slash-fx` 播的都是**一张贴在某个格子上**的图；
 *   · 这里播的是"从棋盘一侧扫到另一侧的**一整套弹道**"—— 十几行、上百颗，
 *     每颗都是一条独立的 `bolt-tracer-fx` 子弹（复用那边的画法/拖尾/淡出）。
 *
 * 【为什么"排布"要单独拆成纯函数？】
 * 因为排布（哪一行、第几颗、什么时候、z 落在哪）是**纯数字**，
 * 而"把子弹塞进 three.js 场景"是渲染。拆开之后：
 *   ① 排布可以在 Node 里直接单元测试（`board-volley.test.ts`）；
 *   ② 渲染层只负责"到点了就 spawn 一颗"，和普通攻击弹道走同一套生命周期。
 *
 * 【数据流】`TraitTierDef.mechanics[].fx` → `rules.ts` 塞进 `cast` 事件（`boardFx`）
 *   → `replay.ts` 查这里的注册表 → 按下面的排布逐颗 `createBoltTracer`。
 *   渲染层**不认识任何羁绊名字**，只认 id。
 */

/**
 * 同时在场的扫射子弹上限。
 *
 * ★ 为什么单独一个上限、不和 `MAX_LIVE_BOLT_TRACERS`（16）共用？
 *   普通攻击弹道是"一次几发"，上限 16 足够；而一次全场扫射**峰值就有 100+ 颗**
 *   （10 行 × 每行十几颗同时在空中）。如果共用，扫射会把别人正在飞的子弹顶掉 ——
 *   反过来也一样，激烈对轰时扫射会被顶得七零八落、看着像卡顿。
 *   两套各管各的，互不干扰。
 */
export const MAX_LIVE_VOLLEY_TRACERS = 220;

/** 一次扫射怎么排（数据里只写 id，具体长相全在这里） */
export interface BoardVolleySpec {
  /** 用哪条弹道播（`TRACER_FX` 的 id）—— 外观/速度/拖尾全在那边，这里只管"怎么排" */
  tracer: string;
  /** 打几行（= 棋盘行数；逐行错峰，形成"斜着扫过去"的弹幕墙） */
  rows: number;
  /** 同一行里相邻两颗的间隔（秒） */
  bulletGap: number;
  /** 行与行之间错峰（秒）。10 行 × 0.038 ⇒ 整面墙斜跨约 0.34 秒 */
  rowDelay: number;
  /** 一行持续打多久（秒）—— 决定一行出几颗（= sweepSeconds / bulletGap + 1） */
  sweepSeconds: number;
  /** 起点/终点在棋盘外多远处（格）：让子弹从画面外进来、打到画面外去，不在边上"凭空出现" */
  overhangCells: number;
  /** 每行的纵向散布（格）：行不是一个数学平面，是一串稍有高低差的弹丸 */
  spreadCells: number;
  /** 时间抖动（秒）：行起点与行内每颗都抖一点，避免看出"等距的尺子" */
  jitterSeconds: number;
}

/**
 * ★★ 注册表：数据里的 id → 一次扫射的排布参数。
 *
 * 以后想加第二个"扫射型"羁绊（比如某个势力的炮击），
 * 只要在这里加一条 + 拉一条弹道，不用碰 `replay.ts`。
 */
export const BOARD_VOLLEY: Record<string, BoardVolleySpec> = {
  /*
    拉特兰羁绊（累计攻击 30 次）的「齐射」：从触发方那半场横扫全场。
    参数来自美术提案 `.fx-proposal/gen-laterano-volley.py`（用户 2026-10-18 确认的那版）：
      速度 11 格/秒、同排间隔 0.086s、行错峰 0.038s、纵向散布 ±0.13 格。
    ★ 这里是 0.1s（提案是 0.086）—— 每行 13 颗 vs 15 颗，弹幕峰值少 20 颗，
      观感几乎一样，但少 20 个 draw call。
  */
  laterano_volley: {
    tracer: 'bullet_laterano',
    rows: 10,
    bulletGap: 0.1,
    rowDelay: 0.038,
    sweepSeconds: 1.15,
    overhangCells: 1.2,
    spreadCells: 0.13,
    jitterSeconds: 0.09,
  },
};

/** 棋盘在这件事上的几何（世界坐标；由渲染层用**当前视角**算好传进来） */
export interface BoardVolleyBoard {
  /** 触发方那半场**最外沿格子中心**的 x —— 扫射就从这一侧打出去 */
  sideX: number;
  /** 对面那半场最外沿格子中心的 x */
  farX: number;
  /** row 0 的 z */
  zNear: number;
  /** 最后一行（row = rows-1）的 z */
  zFar: number;
  /** 棋盘一共几行 */
  rows: number;
}

/** 一颗子弹：什么时候、从哪飞到哪 */
export interface VolleyShot {
  /** 相对触发时刻的延迟（秒） */
  at: number;
  fromX: number;
  toX: number;
  z: number;
}

/** 稳定的 0..1 伪随机（同一组输入永远同一结果 ⇒ 两局回放长得一样，不会"每次都不一样"） */
function hash01(n: number): number {
  let x = Math.imul(n | 0, 2654435761) >>> 0;
  x ^= x >>> 15;
  x = Math.imul(x, 2246822519) >>> 0;
  x ^= x >>> 13;
  x = Math.imul(x, 3266489917) >>> 0;
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

/**
 * 把一次扫射展开成"逐颗子弹"的清单（按时间排序）。
 *
 * 方向**完全由棋盘几何决定**：
 *   `sideX` 是触发方那半场的外沿，`farX` 是对面的外沿 ⇒ 子弹从 `sideX` 侧飞向 `farX` 侧。
 * 所以联机换视角（画面左右镜像）时不需要任何特殊处理 —— 传进来的两个 x 本身就是镜像过的，
 * "从玩家竞技场方向打出去"这件事自动成立（用户口径）。
 */
export function planVolleyShots(spec: BoardVolleySpec, board: BoardVolleyBoard): VolleyShot[] {
  const rows = Math.max(1, Math.min(Math.round(spec.rows), Math.round(board.rows)));
  const dir = Math.sign(board.farX - board.sideX) || 1;
  const fromX = board.sideX - dir * spec.overhangCells;
  const toX = board.farX + dir * spec.overhangCells;
  const perRow = Math.max(1, Math.floor(spec.sweepSeconds / Math.max(0.001, spec.bulletGap)) + 1);

  const shots: VolleyShot[] = [];
  for (let row = 0; row < rows; row++) {
    const t = rows === 1 ? 0.5 : row / (rows - 1);
    const zRow = board.zNear + (board.zFar - board.zNear) * t;
    // 这一行整体早/晚一点出枪（±jitter）
    const rowStart = row * spec.rowDelay + (hash01(row * 977 + 3) - 0.5) * 2 * spec.jitterSeconds;
    for (let k = 0; k < perRow; k++) {
      // 行内每一颗也抖 —— 但只有行抖动的一半，否则一行会散成"两团"
      const jitter = (hash01(row * 7919 + k * 131 + 11) - 0.5) * spec.jitterSeconds;
      const z = zRow + (hash01(row * 613 + k * 37 + 5) - 0.5) * 2 * spec.spreadCells;
      shots.push({ at: Math.max(0, rowStart + k * spec.bulletGap + jitter), fromX, toX, z });
    }
  }
  // 逐颗按时间排序：渲染层就能"从头取到点的"（不用每帧全表扫一遍）
  shots.sort((a, b) => a.at - b.at || a.z - b.z);
  return shots;
}

/** 这次扫射一共打几颗（测试/排查用） */
export function volleyShotCount(spec: BoardVolleySpec, board: BoardVolleyBoard): number {
  return planVolleyShots(spec, board).length;
}
