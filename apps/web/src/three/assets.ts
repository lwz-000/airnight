/**
 * ============================================================
 *  素材（贴图）管理
 * ============================================================
 *
 * 【设计目标：把图丢进目录就能用，不用改代码】
 *
 * 你从网上下载素材后，按下面这个命名规则放进
 * `apps/web/public/assets/`，游戏会自动用上；
 * 没放的图就继续用代码画的占位图 —— 不会报错、不会白屏。
 *
 * ## 放哪里
 *
 * ```
 * apps/web/public/assets/
 *   backdrop.png        场景背景（星空/星云），建议 2048×1024（2:1）
 *   board.png           棋盘地面贴图，建议 512×512，可平铺
 *   units/
 *     op01.png          干员立绘，建议 256×256 或 256×341（3:4）
 *     op02.png
 *     ...
 * ```
 *
 * ## 命名规则
 *
 * 干员立绘的文件名 = 干员 id。干员 id 在
 * `packages/shared/src/unit-data.ts` 里（现在占位的是 op01 ~ op50）。
 *
 * ## 换素材要注意的
 *
 * · **立绘建议用「去背景的 PNG」**（透明底）。如果带白底，
 *   棋子会变成一个白色方块，很难看。
 * · 立绘尺寸不用完全一致，程序会按 3:4 的比例缩放。
 * · 建议长边不超过 512 像素 —— 太大了没必要，还会拖慢加载。
 */

/** 素材根目录（对应 apps/web/public/assets/） */
const ASSET_BASE = '/assets/';

/**
 * 判断一张图片是不是真的可用。
 *
 * 见 loadImage 里的说明 —— 主要用来识别
 * 「服务器把网页兜底内容当图片返回」这种情况。
 */
function isUsableImage(image: HTMLImageElement): boolean {
  // 没解码出尺寸 = 根本没解出来
  if (!Number.isFinite(image.width) || !Number.isFinite(image.height)) return false;
  // 尺寸为 0 或负数 = 解码失败（各浏览器表现不同，都拦掉）
  if (image.width <= 0 || image.height <= 0) return false;
  // 极端小的图也当无效（1×1 的透明占位图没有意义，而且容易是错误响应）
  if (image.width < 2 || image.height < 2) return false;
  return true;
}

/** 已加载成功的贴图缓存：key -> 图片元素 */
const imageCache = new Map<string, HTMLImageElement>();

/** 已经尝试过但失败的路径，避免反复请求 404 刷控制台 */
const failedPaths = new Set<string>();

/** 加载中的请求，避免同一张图被并发加载多次 */
const pendingLoads = new Map<string, Promise<HTMLImageElement | null>>();

/**
 * 尝试加载一张图片。
 *
 * 【为什么失败要静默？】
 * 因为素材是可选的 —— 你没放图的时候，
 * 浏览器的控制台会刷一堆 404 报错，看着像程序坏了。
 * 所以这里把失败吞掉，只在第一次失败时用 console.info 提示一句，
 * 并且记下来不再重试。
 *
 * @returns 加载成功返回图片，失败返回 null
 */
export function loadImage(path: string): Promise<HTMLImageElement | null> {
  const url = ASSET_BASE + path;

  const cached = imageCache.get(url);
  if (cached) return Promise.resolve(cached);

  if (failedPaths.has(url)) return Promise.resolve(null);

  const pending = pendingLoads.get(url);
  if (pending) return pending;

  const promise = new Promise<HTMLImageElement | null>((resolve) => {
    const image = new Image();
    image.onload = () => {
      // ★ 关键的一道保险。
      //
      // 【为什么需要它？—— 踩过一个坑】
      // Vite 开发服务器对「不存在的文件」不一定返回 404，
      // 而是返回网页的兜底 HTML（Content-Type: text/html）。
      // 浏览器把 HTML 当图片解码通常会触发 onerror，
      // 但**跨浏览器行为不完全可靠** —— 万一某个浏览器触发了 onload，
      // 我们就会把一张无效图片当成素材用上去，画面直接坏掉。
      //
      // 所以这里额外校验两件事：
      //   1. 有没有真的解码出尺寸（没解码成功的话尺寸是 0）
      //   2. 尺寸是不是负数（图片解码失败的经典表现）
      if (!isUsableImage(image)) {
        failedPaths.add(url);
        console.info(
          `[素材] ${url} 不是有效的图片（可能服务器返回了网页兜底内容）—— 继续用占位图。`,
        );
        pendingLoads.delete(url);
        resolve(null);
        return;
      }

      imageCache.set(url, image);
      pendingLoads.delete(url);
      resolve(image);
    };
    image.onerror = () => {
      // 只提示一次，避免刷屏
      if (!failedPaths.has(url)) {
        failedPaths.add(url);
        console.info(
          `[素材] 没找到 ${url} —— 继续用代码画的占位图。` +
            `想换成真素材就把它放进 apps/web/public/assets/ 里（详见 assets.ts 顶部说明）。`,
        );
      }
      pendingLoads.delete(url);
      resolve(null);
    };
    image.src = url;
  });

  pendingLoads.set(url, promise);
  return promise;
}

/**
 * 批量预加载素材。
 *
 * 【为什么要预加载而不是用的时候再加载？】
 * 因为「战斗打到一半突然冒出一张图」的观感很差。
 * 启动时先把常用的图拉下来，之后就是内存里取，不会再卡。
 *
 * 这个函数不会阻塞启动 —— 它返回 Promise，调用方可以选择等或不等。
 */
export async function preloadAssets(paths: string[]): Promise<{ loaded: number; missing: number }> {
  const results = await Promise.all(paths.map((path) => loadImage(path)));
  const loaded = results.filter((image) => image !== null).length;
  return { loaded, missing: results.length - loaded };
}

/** 某个路径的素材是否已经加载好了（同步查询，渲染时用） */
export function getLoadedImage(path: string): HTMLImageElement | null {
  return imageCache.get(ASSET_BASE + path) ?? null;
}

/** 干员立绘的路径规则。改命名规则只需要改这一个函数 */
export function unitSpritePath(defId: string): string {
  return `units/${defId}.png`;
}

/**
 * ★ 0.0.3 藏品图标的路径规则。
 *
 * 【为什么图标名 = 藏品 id？】
 * 因为 `ItemDef.icon` 在数据表里就写成藏品 id（见 item-data.ts），
 * 所以"加一件新藏品"只需要放一张同名 png，不用同时改数据表里的 icon 字段 ——
 * 少一处要同步的地方，就少一次"图放对了但名字没改"。
 *
 * 找不到图片时**不报错**：界面上回退成"首字 + 稀有度配色"的方块
 * （见 main.ts 的 buildItemIcon），所以素材可以慢慢补。
 */
export function itemIconPath(icon: string): string {
  return `items/${icon}.png`;
}

/**
 * 藏品图标的**完整 URL**（给 <img src> 用）。
 * 和 unitPortraitUrl 同一套做法：加载过的图直接用浏览器解析后的绝对地址。
 */
export function itemIconUrl(icon: string): string {
  const loaded = getLoadedImage(itemIconPath(icon));
  return loaded?.src ?? ASSET_BASE + itemIconPath(icon);
}

/** 一批藏品图标的路径（启动时预载用） */
export function allItemIconPaths(icons: string[]): string[] {
  return icons.map((icon) => itemIconPath(icon));
}

/** 这张藏品图标已经加载好了吗（没有就画首字色块兜底） */
export function itemIconLoaded(icon: string): boolean {
  return getLoadedImage(itemIconPath(icon)) !== null;
}

/**
 * 干员头像的**完整 URL**（给 <img src> 用）。
 *
 * 【为什么不让调用方自己拼？】
 * 因为素材基址是 `ASSET_BASE`（见文件顶部），调用方很容易写成相对路径
 * `units/op46.png` —— 从页面看会变成 `/units/op46.png`，直接 404，
 * 而且是"主界面头像全空"这种一眼看不出原因的症状。
 * 已经加载过的图直接用它的 `.src`（那是浏览器解析后的绝对地址），
 * 没加载过再按基址拼，两种情况都对。
 */
export function unitPortraitUrl(defId: string): string {
  const loaded = getLoadedImage(unitSpritePath(defId));
  return loaded?.src ?? ASSET_BASE + unitSpritePath(defId);
}

/**
 * 干员**半身像**的路径规则（180×360，竖长、透明底、正面）。
 *
 * 【为什么棋盘上不用头像，而用半身像？】
 * 因为棋子在棋盘上是"站着"的：用 180×180 的方形头像，
 * 会变成一个方方正正的贴片，完全没有"立绘"的感觉。
 * 半身像是竖长的，贴在格子上的观感接近游戏里的立绘。
 *
 * 【为什么不去抓官方 Q 版小人？】
 * 我调研过：prts.wiki 上**没有**静态的 Q 版小人 PNG（全站 4 万多个文件里没有）。
 * 官方小人只有 Spine 骨骼动画，而那有两条硬伤：
 *   1. 约三分之二的干员用的是 Spine 3.5.51，**没有任何官方 JS 运行时能播**；
 *   2. Spine 运行时的授权要求**每个使用者自己持有 Spine Editor 许可**，
 *      不适合打进一个给朋友玩的小游戏里。
 * 所以现在的方案是：用半身像当立绘 + 代码做动作（待机浮动、攻击前冲、受击闪白）。
 * 想要真小人动画，可以走"离线预渲染成 PNG 序列"的路子（见 docs）。
 */
export function unitStandPath(defId: string): string {
  return `stand/${defId}.png`;
}

/** 背景图的路径 */
export const BACKDROP_PATH = 'backdrop.png';

/** 棋盘地面贴图的路径（可选，放一张无缝地砖图即可） */
export const BOARD_TEXTURE_PATH = 'board.png';

/**
 * 方舟关卡地图图集的路径。
 *
 * 从里面切一块地砖当棋盘地面用（网格参数见 three/ark-tiles.ts：
 * 格距 50px、原点 (9,9)）。
 *
 * 【★ 0.0.2：它已经降级成"备胎"】
 * 现在优先用下面的 `ARK_TILE_PATH`（一张做好的无缝地砖）。
 * 这张 800 KB 的图集只有在新地砖缺失时才会被加载。
 */
export const TILE_ATLAS_PATH = 'tiles_atlas.png';

/**
 * ★ 棋盘地砖（0.0.2 接入）。
 *
 * 一张 **256×256 的无缝地砖**：从方舟龙门的地形图集里量出砖距切出来、
 * 提到目标亮度（均值 ≈65），离线脚本在
 * `E:\AIRNIGHT\素材\方舟地块\tools\make_board_tile.py`。
 *
 * 用它替换"现场切图集"的三个好处：无缝、亮度已经调好（不用再压暗）、
 * 体积从 800 KB 降到 6 KB。
 * 效果对照图见 `E:\AIRNIGHT\素材\方舟地块\地砖\预览_3b_竞技场模拟_深灰.png`。
 */
export const ARK_TILE_PATH = 'ark_tile.png';

/** 收集所有干员的半身像路径（棋盘上显示用） */
export function allUnitStandPaths(defIds: string[]): string[] {
  return defIds.map((id) => unitStandPath(id));
}

/**
 * 收集所有干员的立绘路径（启动时预加载用）。
 */
export function allUnitSpritePaths(defIds: string[]): string[] {
  return defIds.map((id) => unitSpritePath(id));
}

/** 诊断信息：界面或控制台可以显示「加载了几张、缺几张」 */
export function assetStats(): { loaded: number; failed: number } {
  return { loaded: imageCache.size, failed: failedPaths.size };
}
