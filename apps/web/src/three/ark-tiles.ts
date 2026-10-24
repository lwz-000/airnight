import { CanvasTexture, LinearMipmapLinearFilter, NearestFilter, RepeatWrapping, SRGBColorSpace } from 'three';

/**
 * ============================================================
 *  方舟风格地砖贴图
 * ============================================================
 *
 * 【素材情况：prts.wiki 上没有"地砖贴图"这种东西】
 * 我实测过 tile / 地砖 / 地块 / 方格 / 网格 / 纹理 / 贴图 / 地形 / tileset
 * 等 20 多个前缀，全部 0 命中。全站 4 万多个文件里没有 tileset 图集。
 *
 * 所以走的是这个办法：**从一张俯视正交的关卡地图里切一块真地砖出来**。
 * prts.wiki 上 `地图_RA-*.png` 这一族（生息演算地图）是**正交俯视**的，
 * 而且格子间距精确等于 50 像素 —— 实测 25 张全部能被 (宽-18)/50 整除：
 *     格距 = 50px，原点 (9, 9)，四周边框 9px
 *     第 (c,r) 格 = 裁剪(9 + 50c, 9 + 50r, 50, 50)
 * 这不是估算，是用尺寸整除和亮度扫描两条路交叉验证出来的。
 *
 * 【为什么切一块之后还要"加工"？】
 * 1. 原始地砖是**浅灰色**的，直接铺在深色太空背景上会亮得刺眼，
 *    和整个 UI 的暗色调打架。所以要压暗、并且按"我方/对方"染成青蓝/绛红。
 * 2. 原图一块地砖只有 50×50，放大 2.5 倍会糊。所以用 NearestFilter
 *    （像素风，边缘干净）而不是线性插值（会糊成一团）。
 * 3. 方舟地砖最关键的视觉特征是**"深缝 + 缝内侧一圈亮于底色的高光边"**，
 *    这是调研里归纳出来的一条 —— 做对了立刻像。切出来的那块砖自带缝，
 *    但我还会再补一圈高光/暗边，让每格边界更清晰（棋盘需要这个来对齐视线）。
 *
 * 【没下载素材时怎么办？】
 * 完全用代码生成一块同风格的砖（配色取自实测色板）。
 * 这样即使素材缺失，棋盘也不会退化成"纯色方块"。
 */

/**
 * 从图集里切哪一块地砖。
 *
 * 【怎么换一块？】
 * 打开 `apps/web/public/assets/tiles_atlas.png`（918×618 的俯视地图），
 * 按 `x = 9 + 50 * 列`、`y = 9 + 50 * 行` 数格子。
 * 目前取的是第 0 列第 1 行 —— 左侧那片干净的灰色混凝土地砖。
 *
 * 【★ 0.0.2：这条路径已经降级成"备胎"】
 * 现在优先用 `assets/ark_tile.png`（一张**已经做好的无缝地砖**，
 * 由离线脚本从方舟地形图集里量出自相关周期切出来、提到目标亮度，
 * 见 `E:\AIRNIGHT\素材\方舟地块\tools\make_board_tile.py`）。
 * 比现场从关卡地图里切一块好在三点：
 *   · 已经是 256×256 的无缝砖，平铺不会有接缝；
 *   · 亮度是离线调好的（均值 ≈65），**不用再压暗**；
 *   · 关卡地图那张图集体积 800 KB，这张只要 6 KB。
 * 只有在新地砖缺失时才回退到切图集，再缺才纯程序化生成。
 */
export const ATLAS_TILE = {
  /** 图集里这一格的左上角 */
  x: 9,
  y: 59,
  /** 原图一格多少像素（实测固定 50） */
  size: 50,
};

/** 加工后的地砖贴图边长（2 的幂，方便显卡处理） */
const TILE_TEXTURE_SIZE = 128;

/** 专用地砖（`assets/ark_tile.png`）的贴图边长 —— 原图就是 256×256，照搬不打折 */
const SOURCE_TILE_SIZE = 256;

/**
 * ★ 地砖的提亮系数。
 *
 * 【为什么还要提亮一次？那张图不是已经调好亮度了吗？】
 * 离线脚本调的是**"图中像素本身"**的亮度；而游戏里地砖要经过
 * `MeshStandardMaterial` 的光照（环境光 + 方向光的漫反射 + 粗糙度）。
 * 实测下来游戏里的成品比离线预览**暗约 28%**：
 *
 *     预览 我方 #323a42 / 对方 #413234
 *     游戏 我方 #242a35 / 对方 #2f272d
 *
 * 预览是拿 `素材\方舟地块\tools\make_preview_sheets.py` 离线算的
 * （纯乘法、无光照），而用户指定的目标就是那张预览图 ——
 * 所以这里补一档亮度把差距补回来。
 *
 * 【为什么不加大染色值（material.color）？】
 * 因为染色已经快到顶了（我方那档的蓝通道已经是 0xff），再往上加就溢出成纯白，
 * 地砖的纹理细节会被压平。亮度这事交给贴图本身更合适 ——
 * 离线脚本里也有同一个函数（`lift()`），这里只是把同一招搬到运行时。
 *
 * 【1.35 -> 1.24 是怎么来的？】
 * 不是目测，是两次实测比出来的：`素材\方舟地块\tools\probe_board_colors.mjs`
 * 从游戏里读回每格的真实像素，`measure_colors.py` 从离线预览图上量出目标，
 * 两边逐类比差值。1.35 时游戏整体比预览亮 ~9%（我方亮格 +8/+9/+8），
 * 按亮度比（目标/实际 ≈ 0.92）折算把系数收下来，复测四类都在 ±4 以内。
 */
const SOURCE_TILE_LIFT: number = 1.24;

/** 方舟风格配色（取自实测色板：地图_RA-B-2_不灭.png 逐格中心取色） */
export const ARK_TILE_PALETTE = {
  /** 混凝土底砖的上亮部 / 下暗部 */
  baseTop: '#8f968c',
  baseBottom: '#6d7469',
  /** 缝隙（很深，接近黑） */
  groove: '#22252a',
  /** 缝内侧高光（关键！方舟地砖的辨识点） */
  grooveLight: '#c3c9c0',
  /** 缝内侧暗边 */
  grooveDark: '#4a4f47',
  /** 蓝灰高台顶面 */
  platformTop: '#65768f',
  /** 深青水面 */
  water: '#254c4c',
  /** 警示黄 */
  hazard: '#f2c14e',
};

/**
 * 地砖贴图的来源。
 *
 * `tile`  = 专门做好的无缝地砖（`assets/ark_tile.png`，首选）
 * `atlas` = 从关卡地图图集里现场切一块（备胎）
 * `null`  = 都没有，纯程序化生成一块同风格的砖
 */
export type TileSource =
  | { kind: 'tile'; image: HTMLImageElement }
  | { kind: 'atlas'; image: HTMLImageElement };

/**
 * 生成地砖贴图。
 *
 * @param source 素材来源，见 TileSource。传 null 就纯程序化生成。
 * @returns 一张可以给 MeshStandardMaterial.map 用的贴图
 */
export function createArknightsTileTexture(source: TileSource | null): CanvasTexture {
  const canvas = document.createElement('canvas');
  const size = source?.kind === 'tile' ? SOURCE_TILE_SIZE : TILE_TEXTURE_SIZE;
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    // 极端情况（拿不到 2D 上下文）：返回一张空贴图，棋盘至少不会崩
    return new CanvasTexture(canvas);
  }

  if (source?.kind === 'tile') {
    drawSourceTile(ctx, source.image);
  } else if (source?.kind === 'atlas') {
    drawFromAtlas(ctx, source.image);
  } else {
    drawProcedural(ctx);
  }

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  /*
    像素风：放大时不做平滑，边缘干净（线性插值会糊成一团）。
    缩小时交给 mipmap —— 256×256 的砖铺到 30 来个屏幕像素，
    没有 mipmap 会闪成一片噪点。
  */
  texture.magFilter = NearestFilter;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

/**
 * ★ 直接用做好的无缝地砖。
 *
 * 【为什么这一步什么都不做？】
 * 因为那张图**在离线脚本里就已经处理好了**：
 *   1. 从方舟地形图集里量出砖距（自相关，龙门实测 232px），按砖距切，
 *      保证左右上下边缘对得上 —— 这就是"无缝"的来源；
 *   2. 亮度提/降到目标均值（`make_board_tile.py --target 88`，
 *      存成 PNG 后实测均值 #414141 ≈ 65）。
 *
 * 【为什么不再压暗一次？这里踩过一个坑】
 * 原来的图集路径要压暗，是因为那张关卡地图是**白天**的、地砖很亮
 * （均值 #828a84 ≈ 133），直接铺在深色太空背景上会亮得刺眼。
 * 这张新地砖的均值只有它的一半 —— 再乘一次 0.74 的压暗系数就过暗了，
 * 和离线预览里看到的效果对不上。
 * 所以这里**照搬像素**，颜色全部交给材质的 `color`（染色）那一步。
 */
function drawSourceTile(ctx: CanvasRenderingContext2D, tile: HTMLImageElement): void {
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(tile, 0, 0, SOURCE_TILE_SIZE, SOURCE_TILE_SIZE);
  if (SOURCE_TILE_LIFT === 1) return;

  /*
    逐像素提亮。
    【为什么不用 ctx.filter = 'brightness(...)'？】
    它在新版浏览器上确实能用，但 Canvas2D 的 filter 在部分环境下会被静默忽略，
    那样亮度就悄悄不对了（而且没有报错）。
    getImageData 是老老实实、到处都有的写法；256×256 只有 6.5 万个像素，
    启动时算一次，开销可以忽略。
  */
  const image = ctx.getImageData(0, 0, SOURCE_TILE_SIZE, SOURCE_TILE_SIZE);
  const data = image.data;
  for (let i = 0; i < data.length; i += 4) {
    data[i] = Math.min(255, Math.round(data[i]! * SOURCE_TILE_LIFT));
    data[i + 1] = Math.min(255, Math.round(data[i + 1]! * SOURCE_TILE_LIFT));
    data[i + 2] = Math.min(255, Math.round(data[i + 2]! * SOURCE_TILE_LIFT));
  }
  ctx.putImageData(image, 0, 0);
}

/** 从图集里切一块真地砖，压暗后铺满贴图（备胎路径） */
function drawFromAtlas(ctx: CanvasRenderingContext2D, atlas: HTMLImageElement): void {
  const { x, y, size } = ATLAS_TILE;

  // 1) 切出那一格，放大铺满
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(atlas, x, y, size, size, 0, 0, TILE_TEXTURE_SIZE, TILE_TEXTURE_SIZE);

  // 2) 压暗 + 略微去饱和，融进深色 UI
  //    用 multiply 混合，保留地砖本身的纹理和明暗变化，而不是盖一层灰
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = 'rgba(150, 165, 195, 0.62)';
  ctx.fillRect(0, 0, TILE_TEXTURE_SIZE, TILE_TEXTURE_SIZE);
  ctx.globalCompositeOperation = 'source-over';

  polishTileEdges(ctx);
}

/** 没有素材时纯代码生成一块方舟风格地砖 */
function drawProcedural(ctx: CanvasRenderingContext2D): void {
  const size = TILE_TEXTURE_SIZE;
  const gap = Math.max(2, Math.round(size * 0.035)); // 缝宽约占 3.5%

  // 底色 = 缝的颜色（先铺满，中间那块盖上去，露出来的边就是缝）
  ctx.fillStyle = ARK_TILE_PALETTE.groove;
  ctx.fillRect(0, 0, size, size);

  // 中间的地砖：竖向渐变（上亮下暗，暗示光源在上方）
  const inset = gap;
  const tileSize = size - gap * 2;
  const gradient = ctx.createLinearGradient(0, inset, 0, inset + tileSize);
  gradient.addColorStop(0, ARK_TILE_PALETTE.baseTop);
  gradient.addColorStop(1, ARK_TILE_PALETTE.baseBottom);
  ctx.fillStyle = gradient;
  ctx.fillRect(inset, inset, tileSize, tileSize);

  // 混凝土噪点（不能是纯色，不然像塑料）
  for (let i = 0; i < size * 4; i++) {
    ctx.fillStyle = `rgba(255,255,255,${(i % 7) * 0.006})`;
    ctx.fillRect(Math.floor(Math.random() * size), Math.floor(Math.random() * size), 1, 1);
  }

  polishTileEdges(ctx);
}

/**
 * 补上"缝内侧高光 + 暗边"。
 *
 * 这一步是**最出效果**的一步：方舟的地砖不是"均匀网格线"，
 * 而是每块砖边缘有一圈亮于底色 / 暗于底色的描边。
 * 加上它之后，格子边界在 3D 斜视角下也会很清楚（棋盘很需要这个对齐视线）。
 */
function polishTileEdges(ctx: CanvasRenderingContext2D): void {
  const size = TILE_TEXTURE_SIZE;
  const line = 2;
  const inset = 1;

  // 缝内侧高光：只画上边和左边
  ctx.fillStyle = 'rgba(220, 232, 255, 0.30)';
  ctx.fillRect(inset, inset, size - inset * 2, line);
  ctx.fillRect(inset, inset, line, size - inset * 2);

  // 缝内侧暗边：只画下边和右边
  ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
  ctx.fillRect(inset, size - inset - line, size - inset * 2, line);
  ctx.fillRect(size - inset - line, inset, line, size - inset * 2);
}
