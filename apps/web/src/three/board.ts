import {
  AmbientLight,
  BoxGeometry,
  CanvasTexture,
  CylinderGeometry,
  DirectionalLight,
  Fog,
  GridHelper,
  Group,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  Plane,
  PlaneGeometry,
  Raycaster,
  RepeatWrapping,
  SRGBColorSpace,
  Scene,
  Sprite,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { BOARD_H, BOARD_W, TEAM_0_MAX_COL, type Cell } from '../../../../packages/shared/src/index.js';
import { ARK_TILE_PATH, BACKDROP_PATH, BOARD_TEXTURE_PATH, TILE_ATLAS_PATH, loadImage } from './assets.js';
import { createArknightsTileTexture } from './ark-tiles.js';
import { createSpaceBackdrop } from './backdrop.js';
import { CARD_CENTER_Y } from './card-layout.js';
import { chibiOpaqueAt, chibiUvAtPoint } from './chibi.js';
import { pickHitsOwnCell } from './pick-geometry.js';
import {
  CELL,
  BOARD_WORLD_H,
  BOARD_WORLD_W,
  cellToWorldFlipped as cellToWorldPointFlipped,
  cellToWorldPoint,
  flipCell,
  isOnBoard,
  isPlayerHalf,
  pointerToNdc,
  rawToViewCell,
  viewToRawCell,
  worldPointToCell,
  type ViewportRect,
} from '../game/grid.js';

/**
 * ============================================================
 *  3D 场景：棋盘地板 + 相机环绕 + 鼠标拾取
 * ============================================================
 *
 * 【坐标系约定（非常重要，改代码前先看懂这段）】
 *
 *   格子坐标 (col, row)：col = 0..7 从左到右，row = 0..5 从远到近
 *   世界坐标 (x, z)：
 *       x = (col - (BOARD_W - 1) / 2) * CELL          // 棋盘左右居中
 *       z = (row - (BOARD_H - 1) / 2) * CELL          // 棋盘前后居中
 *   高度统一用 y
 *
 *   把 (col,row) 换算成世界坐标只允许通过 cellToWorld()，
 *   把世界坐标换算回格子只允许通过 worldToCell()。
 *   所有地方都走这两个函数 —— 这样以后想改格子大小、
 *   或者把棋盘转 45 度，只需要改这两个函数。
 */

/** 棋盘地板离地高度（抬起来一点，看起来像一张桌子） */
const BOARD_Y = 0;

/**
 * ============================================================
 *  镜头参数 —— 想调视角就改这几个数
 * ============================================================
 *
 * 【设计目标：平、正、居中的固定视角，不要旋转】
 *
 * 自走棋是「看清全局、做出决策」的游戏，不是动作游戏。
 * 镜头一旦旋转，玩家的方向感就没了 —— 你会分不清哪边是自己的半场。
 * 所以这里：
 *   · 只在后方（+Z）抬到一个较平的角度，不绕圈
 *   · 水平居中（x = 0），正对棋盘中线
 *   · FOV 调小到 38 度，减少边缘透视变形，格子看起来才是方正的
 */

/**
 * 相机高度与后退距离。
 *
 * 【这块调过好几次，把结论记下来，免得以后又走弯路】
 *
 * 棋盘是 10 宽 × 20 深 —— **纵深是横向的两倍**。
 * 这带来一个几何上的硬约束：在 16:9 的屏幕上，
 * 浅俯角**永远装不下全部 20 行**，因为 20 格深度投影到画面竖直方向后太长，
 * 而画面的竖直空间是固定的。相机拉得再远，只是让棋盘变小，
 * 比例上依然装不下 —— 横向早就空出一大半了。
 *
 * 所以想「看见整个竞技场」，唯一的路就是**接近正俯视**：
 *   HEIGHT 20 / BACK 13 -> 俯角约 57°，只能看到大半个场
 *   HEIGHT 26 / BACK 13 -> 俯角约 63°，还是看不全
 *   HEIGHT 48 / BACK 10 -> 俯角约 78°，基本能看全 ← 现在用的
 *
 * 代价：接近俯视时，棋子卡片（永远是正面朝向相机的 2D 贴图）会显得比较「扁」。
 * 如果想让棋子更有立体感，就调小 HEIGHT（牺牲「看全」换观感）。
 * 这两个需求本身是矛盾的，只能取一个平衡点。
 */
const CAMERA_HEIGHT = 48;

/** 相机往后退多少（越小越平视） */
const CAMERA_BACK = 10;

/**
 * 棋子卡片的高度（世界单位）。
 * 精灵是 0.96 高、中心在 y=CARD_CENTER_Y（0.42），所以顶大约在 0.9。
 * 留到 1.5 是给「护盾光圈」「飘字」这类未来特效留余量。
 */
const UNIT_HEADROOM = 1.5;

/**
 * ★ 0.0.3：拾取守卫 —— 为什么"点中的棋子"和"眼睛看到的那一格"会错开，
 * 以及 PICK_RADIUS = 0.5 是怎么定出来的，完整推导都在
 * `pick-geometry.ts` 里（纯算术，有单元测试）。这里只是用它的规则。
 *
 * 一句话：小人的画布可以宽到 2.58 格（野怪 `mn_jakill`），
 * 只说"射线第一个命中的棋子"就会"点 A 中 B"，所以必须再拿
 * "射线在 y=CARD_CENTER_Y 平面上的落点"和棋子中心比一次。
 */

/**
 * 缩放系数：**小于 1 = 凑近一点**（因为它是乘在「相机距离」上的）。
 *
 * 【为什么要单独一个参数？】
 * 「装下整个棋盘」和「看清楚棋子」是一对矛盾：
 *   想让棋盘尽量占满画面 -> 调小这个值
 *   想保证任何窗口尺寸下都不切边 -> 调大这个值
 * 单独拿出来，你就能一个数字调手感，不用去动几何计算。
 *
 * 安全范围大约 0.85 ~ 1.0。调到 0.85 以下时，
 * 窗口比较扁的情况下最外侧的行可能被切掉一点。
 */
const CAMERA_ZOOM = 0.9;

/**
 * ============================================================
 *  滚轮拉近 / 拖动平移（你报的第 13 条）
 * ============================================================
 *
 * 【规则】（数学部分在 camera-view.ts 里，有单元测试）
 *   · 滚轮往上 = 拉近，最远就是**默认视角**（不允许比现在更远）
 *   · 拉到最近时，相机距离是默认的 **1/2**（"放近最大为现在的 50%"）
 *   · 拉近之后可以拖动平移，看棋盘的边角
 *   · 缩回默认倍率时平移自动归零（"最远视角 = 现在的视角"一模一样）
 *
 * 【为什么不做旋转、也不做自由缩到很远？】
 * 自走棋是"看清全局做决策"的游戏。能拉近是为了**看清楚棋子卡片上的字**
 * （血条、护盾、星级描边），不是为了看风景；
 * 一旦允许转到侧面，玩家就会分不清哪边是自己的半场。
 */
import {
  MAX_ZOOM_IN,
  cameraDistanceFor,
  createCameraView,
  panBy as panViewBy,
  resetView as resetCameraView,
  worldPerPixelAt,
  zoomBy as zoomByInView,
} from './camera-view.js';

/**
 * 「平视系数」= 高度 / 后退距离。
 *
 * 【为什么要把这个比值单独抽出来？】
 * 因为改分辨率时相机要整体拉远/拉近，
 * 如果直接对 position 向量做缩放，比值会变，视角角度就跟着变了 ——
 * 看起来就是「窗口一变，画面角度也变了」，非常难受。
 * 所以缩放的必须是「距离」，方向（也就是这个比值）保持不变。
 */
const CAMERA_PITCH = CAMERA_HEIGHT / CAMERA_BACK;

/** 视线焦点的高度：稍微抬一点，让棋盘落在画面中间而不是偏下 */
const CAMERA_LOOK_Y = 0.6;

/** 相机视野角（度）。调小可以减少边缘透视变形，格子看起来才是方正的 */
const CAMERA_FOV = 38;

/**
 * 给单元测试用的相机几何（**只读**）。
 *
 * 【为什么要把这几个数导出去？】
 * 拾取守卫的正确性完全建立在"相机几乎垂直俯视"这个前提上 ——
 * 俯角一旦变小，射线在 y=CARD_CENTER_Y 平面上的落点就会往远处飘，
 * "落点 = 眼睛看到的那一格"就不再成立，PICK_RADIUS 也得跟着重算。
 * 所以测试必须拿到**真实**的相机参数（而不是在测试里抄一份），
 * 这样有人改了俯角，测试能立刻发现前提被破坏了。
 */
export const CAMERA_GEOMETRY = {
  fov: CAMERA_FOV,
  height: CAMERA_HEIGHT,
  back: CAMERA_BACK,
  lookY: CAMERA_LOOK_Y,
} as const;

/**
 * 算出「相机该站多远」才能把整个棋盘装进画面。
 *
 * 【思路：把棋盘投影到相机的三个轴上】
 * 相机看东西相当于把世界投影到一个平面上：
 *   forward 轴 = 视线方向（深度）
 *   right   轴 = 画面水平方向
 *   up      轴 = 画面竖直方向
 * 把棋盘的「半宽」和「半深」分别投影到 right / up 轴上，
 * 就得到棋盘在画面里占的水平和竖直范围。
 *
 * 【两个容易漏掉的地方，我都踩过】
 *  1. 棋子是立在棋盘上的，有高度。只按地面算的话，
 *     最上面那几行的棋子头会顶出画面。所以要额外加上 UNIT_HEADROOM。
 *  2. 边距不能只留一点点。留太少时，稍微换个窗口尺寸就有一角被切掉。
 *
 * @param extraHeight 棋盘上方额外需要显示的高度（棋子 + 特效）
 */
function fitCameraDistance(
  camera: PerspectiveCamera,
  worldW: number,
  worldH: number,
  extraHeight = 0,
): number {
  const vFov = (camera.fov * Math.PI) / 180;
  const tanV = Math.tan(vFov / 2);
  const tanH = tanV * camera.aspect;

  // 相机方向（固定俯视，水平方向始终朝 -Z）
  const pitch = Math.atan(CAMERA_PITCH);
  const sinP = Math.sin(pitch);
  const cosP = Math.cos(pitch);

  const halfW = worldW / 2;
  const halfH = worldH / 2;
  const halfExtra = extraHeight / 2;

  // 投影到「画面的水平轴」：相机不左右偏，所以只有 x 方向有贡献
  const extentRight = halfW;

  // 投影到「画面的竖直轴」：z 方向（棋盘的深度）和 y 方向（棋子高度）都有贡献
  const extentUp = halfH * sinP + halfExtra * cosP;

  const distanceForWidth = extentRight / tanH;
  const distanceForHeight = extentUp / tanV;

  // 还要加上棋盘沿视线方向的厚度（它会占掉一部分最近可视距离）
  const depthOffset = halfH * cosP + halfExtra * sinP;

  return Math.max(distanceForWidth, distanceForHeight) + depthOffset;
}


/**
 * 把相机按「站多远」摆好 —— 俯角和朝向固定不变，只改距离。
 *
 * 【为什么抽成独立函数？】
 * 一是 applyCamera 和单元测试**必须共用同一份摆放逻辑**（这个项目里
 * "同一个动作只允许一处实现"是硬规矩，踩过太多次"改了一处漏了另一处"）；
 * 二是拾取守卫的正确性取决于相机的**俯角**（见 pick-geometry.ts），
 * 测试必须拿到和线上完全一样的相机，否则量出来的数字没有意义。
 */
export function placeBoardCamera(camera: PerspectiveCamera, distance: number, panX = 0, panZ = 0): void {
  const pitch = Math.atan(CAMERA_PITCH);
  camera.position.set(panX, distance * Math.sin(pitch), panZ + distance * Math.cos(pitch));
  camera.lookAt(panX, CAMERA_LOOK_Y, panZ);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
}

/**
 * 给定画布宽高比，算出**默认视角（最远）**下相机该站多远。
 *
 * 和 resize() 里算 `basePadded` 用的是同一条公式。
 * 只给单元测试用：拾取守卫的**最坏情况**恰好就出现在这个最远视角
 * （相机越远，射线越"平"，落在棋盘上的偏移越大）。
 */
export function boardCameraDistance(aspect: number): number {
  const probe = new PerspectiveCamera(CAMERA_FOV, aspect, 0.1, 400);
  return fitCameraDistance(probe, BOARD_WORLD_W, BOARD_WORLD_H, UNIT_HEADROOM) * 1.06 * CAMERA_ZOOM;
}


/**
 * 下面这些纯坐标数学其实住在 game/grid.ts 里（那里零依赖、可在 Node 里测试）。
 * 这里只是转成 Three.js 的 Vector3 类型，并重新导出方便调用。
 */
export { CELL, BOARD_WORLD_W, BOARD_WORLD_H, flipCell, viewToRawCell, rawToViewCell };
export { isOnBoard, isPlayerHalf };

/** 格子坐标 -> 世界坐标 */
export function cellToWorld(cell: Cell, y = 0): Vector3 {
  const point = cellToWorldPoint(cell, y);
  return new Vector3(point.x, point.y, point.z);
}

/** 世界坐标 -> 格子坐标（可能越界，调用方要自己检查） */
export function worldToCell(point: Vector3): Cell {
  return worldPointToCell(point.x, point.z);
}

/**
 * 格子坐标 -> 世界坐标，自动处理翻转视角。
 * @param flip 是否启用「己方在左」的翻转视角（联机时被分到队伍 1 就传 true）
 */
export function cellToWorldFlipped(cell: Cell, y: number, flip: boolean): Vector3 {
  const point = cellToWorldPointFlipped(cell, y, flip);
  return new Vector3(point.x, point.y, point.z);
}

export interface BoardScene {
  scene: Scene;
  camera: PerspectiveCamera;
  renderer: WebGLRenderer;
  /** 所有棋子精灵挂在它下面 */
  unitLayer: Group;
  /** 放高亮方块的层 */
  highlightLayer: Group;
  /** 把鼠标位置转成棋盘格子（不在棋盘上返回 null）。**会先打棋子再打地板**。
   *  `options.ignoreUnits` 跳过硬子只打地板 —— 拖动过程中必须用（见函数内注释） */
  screenToCell(clientX: number, clientY: number, options?: { ignoreUnits?: boolean }): Cell | null;
  /**
   * 某个棋子精灵当前占着哪个格子（视角坐标）。专门给拾取用 ——
   * 注意它内部**不会**再 flip 一次，原因见实现里的注释。
   */
  cellOfSprite(object: Object3D): Cell | null;
  /**
   * 把鼠标位置转成「点中的棋子」（没点到棋子返回 null）。
   * 用途和 screenToCell 不同：这个用来"点开某个干员的信息"。
   */
  pickUnit(clientX: number, clientY: number): { object: Object3D; cell: Cell } | null;
  /**
   * 在任意对象树里拾取（战斗中点棋子用 —— 那时候棋子在 BattleReplay.root 里，
   * 不在 unitLayer 里）。返回最靠前命中的对象，没打到返回 null。
   */
  pickIn(clientX: number, clientY: number, root: Object3D): Object3D | null;
  /** 高亮某一格（传 null 取消）。传入的格子可以是「视角坐标」，会按 flip 自动换算 */
  setHighlight(cell: Cell | null, ok: boolean): void;
  /**
   * 当前 3D 视口（像素，原点在画布**左下角**）。
   *
   * 【为什么要暴露出来？】
   * 渲染和拾取共用这一个视口 —— 一旦它没跟着 UI 布局更新，
   * 表现就是「点哪中哪」错位（错位量 = 视口位移）。
   * 平时界面用不到它，但调试探针（`?debug=1`）需要拿它把
   * 「屏幕坐标 <-> 格子」算一遍来验证拾取精度，见 debug-probe.ts。
   */
  viewportRect(): ViewportRect;
  /**
   * 切换棋盘半场的配色：让对方那半边显示成红色。
   * @param flip true 表示当前是「翻转视角」（自己被分到了队伍 1）
   */
  setHalfTint(flip: boolean): void;
  /** 每帧调用。目前相机是固定的，不需要做任何事（保留这个接口是为了以后加动画） */
  update(deltaSeconds: number): void;
  /**
   * 调整尺寸（窗口大小变化时）。
   * @param insets 四边被 UI 浮层遮住的像素数 —— 3D 只在没被遮住的区域里渲染
   */
  resize(width: number, height: number, insets?: ViewportInsets): void;
  /**
   * 滚轮缩放（第 13 条需求）。
   * @param deltaY 滚轮方向（往上滚 = 负数 = 拉近）
   * @returns 新的倍率，1 = 默认视角，MAX_ZOOM_IN = 最近
   */
  zoomBy(deltaY: number): number;
  /** 拖动平移（像素位移）。只有在拉近之后（倍率 > 1）才真的会动 */
  panBy(dxPixels: number, dyPixels: number): void;
  /** 当前缩放倍率 */
  zoomLevel(): number;
  /** 回到默认视角 */
  resetView(): void;
}

/**
 * UI 浮层留给 3D 画面的空间。
 *
 * 【为什么需要这个？—— 这是「看不到整个竞技场」的真正原因之一】
 * 顶部状态栏和底部商店是**浮在画布上面**的，
 * 3D 画面其实只有中间那条能看见。
 * 如果相机按「整个窗口」去框取棋盘，就等于把棋盘框进了被 UI 遮住的区域 ——
 * 上下两头自然看不见。
 *
 * 正确的做法：只让 3D 渲染在「UI 之间那块区域」，
 * 然后按那块区域去框取棋盘。这样一点画面都不会浪费。
 */
export interface ViewportInsets {
  /** 顶部被遮住的高度（像素） */
  top: number;
  /** 底部被遮住的高度（像素） */
  bottom: number;
  /** 左侧被遮住的宽度（像素） */
  left: number;
  /** 右侧被遮住的宽度（像素） */
  right: number;
}

/** 创建整个 3D 场景 */
export function createBoardScene(canvas: HTMLCanvasElement): BoardScene {
  const renderer = new WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x0a0b0d, 1);
  renderer.shadowMap.enabled = true;

  const scene = new Scene();
  // 先用程序化生成的星空 + 星云打底（零授权风险、可调、不会随刷新变化）
  scene.background = createSpaceBackdrop();
  void loadImage(BACKDROP_PATH).then((image) => {
    // 如果你放了真背景图（assets/backdrop.png），就换成它
    if (!image) return;
    const texture = new CanvasTexture(image);
    texture.colorSpace = SRGBColorSpace;
    scene.background = texture;
    console.info('[素材] 已用上背景图 backdrop.png');
  });
  // 雾效：远处淡出，给一点纵深。颜色和背景底色接近，衔接才自然。
  // 数值取的是 backdrop.png（罗德岛夜间机库）的远景色调，不然会有色差断层。
  // 范围要按棋盘的**最大跨度**来算 —— 棋盘是 10 宽 × 20 深，
  // 按宽度算的话（10）会把远处的行全部糊掉，那就看不见对手了。
  const boardSpan = Math.max(BOARD_WORLD_W, BOARD_WORLD_H);
  scene.fog = new Fog(0x15171a, boardSpan * 1.3, boardSpan * 3.2);

  const camera = new PerspectiveCamera(CAMERA_FOV, 1, 0.1, 400);
  // 初始占位，下面 resize() 会按棋盘尺寸精确算好位置
  camera.position.set(0, 10, CAMERA_BACK);
  camera.lookAt(0, 0, CAMERA_LOOK_Y);

  // --- 灯光 ---
  scene.add(new AmbientLight(0xffffff, 0.75));
  const keyLight = new DirectionalLight(0xffffff, 1.1);
  keyLight.position.set(6, 12, 8);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(1024, 1024);
  scene.add(keyLight);

  // 补一盏偏蓝的侧光，让 3D 场景有冷暖对比，不那么平
  const rimLight = new DirectionalLight(0x9aa2ab, 0.5);
  rimLight.position.set(-8, 6, -6);
  scene.add(rimLight);

  // --- 棋盘底板（一块厚板，像一张桌子） ---
  const boardGroup = new Group();
  const slabMaterial = new MeshStandardMaterial({
    color: 0x121417,
    roughness: 0.72,
    metalness: 0.25,
    // 轻微自发光，让底板在暗背景里有一点「浮起来」的感觉
    emissive: 0x08090b,
  });
  const slab = new Mesh(new BoxGeometry(BOARD_WORLD_W + 0.5, 0.32, BOARD_WORLD_H + 0.5), slabMaterial);

  // 如果用户放了棋盘地面贴图（assets/board.png），就贴上去。
  // 贴图是可选的 —— 没有的话就用纯色材质，效果也不差。
  void loadImage(BOARD_TEXTURE_PATH).then((image) => {
    if (!image) return;
    const texture = new CanvasTexture(image);
    texture.colorSpace = SRGBColorSpace;
    // 让贴图在棋盘上平铺，而不是拉伸成一整张
    texture.wrapS = RepeatWrapping;
    texture.wrapT = RepeatWrapping;
    texture.repeat.set(BOARD_WORLD_W / 4, BOARD_WORLD_H / 4);
    texture.needsUpdate = true;
    slabMaterial.map = texture;
    slabMaterial.needsUpdate = true;
    console.info('[素材] 已用上棋盘贴图 board.png');
  });
  slab.position.y = BOARD_Y - 0.16;
  slab.receiveShadow = true;
  boardGroup.add(slab);
  scene.add(boardGroup);

  // --- 格子 ---
  // 方舟风格地砖（贴图）。
  //
  // 【为什么会变两次？】
  // 1. 先用程序化生成的地砖上色（立刻有效果，不用等图片下载）
  // 2. 图片下载好了再换成真地砖，按优先级：
  //      `assets/ark_tile.png`（0.0.2 起首选：做好的无缝地砖，亮度已调好）
  //   →   `assets/tiles_atlas.png`（备胎：现场从关卡地图里切一块，需要压暗）
  //   →   程序化（都没有）
  // 这样"素材没下"和"素材下好了"两种情况下棋盘都不会是空白。
  const tileGeometry = new PlaneGeometry(CELL * 0.96, CELL * 0.96);
  const boardTiles: Mesh[] = [];
  // 先把程序化地砖建出来并共享同一张纹理（200 个格子共用一张，省显存）
  const proceduralTexture = createArknightsTileTexture(null);
  for (let row = 0; row < BOARD_H; row++) {
    for (let col = 0; col < BOARD_W; col++) {
      const tile = new Mesh(
        tileGeometry,
        new MeshStandardMaterial({
          map: proceduralTexture,
          // bumpMap 用同一张图：缝隙会有一点凹凸感，斜视角下特别明显
          bumpMap: proceduralTexture,
          bumpScale: 0.35,
          roughness: 0.74, // 半哑光。给 0 会变成塑料地板
          metalness: 0.06,
        }),
      );
      const world = cellToWorld({ col, row }, BOARD_Y + 0.005);
      tile.position.copy(world);
      tile.rotation.x = -Math.PI / 2;
      tile.receiveShadow = true;
      // 记住这一格对应的棋盘坐标，鼠标拾取时要用
      tile.userData = { col, row };
      boardGroup.add(tile);
      boardTiles.push(tile);
    }
  }

  /** 换掉所有格子的贴图（bumpMap 也用同一张：缝隙在斜视角下会有凹凸感） */
  function useTileTexture(texture: CanvasTexture): void {
    for (const tile of boardTiles) {
      const material = tile.material as MeshStandardMaterial;
      material.map = texture;
      material.bumpMap = texture;
      material.needsUpdate = true;
    }
  }

  // 首选：做好的无缝地砖（见 assets.ts 的 ARK_TILE_PATH）
  void loadImage(ARK_TILE_PATH).then((image) => {
    if (image) {
      useTileTexture(createArknightsTileTexture({ kind: 'tile', image }));
      console.info('[素材] 已用上棋盘地砖 ark_tile.png（方舟龙门无缝地砖）');
      return;
    }
    // 备胎：现场从关卡地图图集里切一块（需要额外压暗，见 ark-tiles.ts）
    void loadImage(TILE_ATLAS_PATH).then((atlas) => {
      if (!atlas) return;
      useTileTexture(createArknightsTileTexture({ kind: 'atlas', image: atlas }));
      console.info('[素材] 已用上棋盘地砖 tiles_atlas.png（从方舟关卡地图里切出来的）');
    });
  });

  /** 按当前视角给棋盘两半上色 */
  function applyHalfTint(flip: boolean): void {
    for (const tile of boardTiles) {
      const { col, row } = tile.userData as { col: number; row: number };
      // 这一格在「翻转后的视角」里属于哪一边？
      const viewCol = flip ? BOARD_W - 1 - col : col;
      const isMySide = viewCol <= TEAM_0_MAX_COL;
      const isEven = (col + row) % 2 === 0;
      /*
        颜色是**乘**在地砖贴图上的，所以这里给的是"染色"而不是"底色"：
          · 我方 -> 偏青蓝（冷色，让人安心）
          · 对方 -> 偏绛红（暖色，有压迫感）
          · 明暗交替一格，方便数格子（斜视角下很重要）

        ★ 0.0.2：地砖换成 `ark_tile.png` 时这几个值重算过一次。
        新砖的亮度只有旧砖的一半（均值 #414141 vs #828a84），而旧管线
        在贴图阶段还有一道 0.74 的"压暗"。两件事抵消不了 ——
        所以既要**去掉压暗**、又要**给贴图补一档亮度**（见 ark-tiles.ts 的
        `SOURCE_TILE_LIFT`），最后再按下面这组染色，落到离线预览
        （`素材\方舟地块\地砖\预览_3b_竞技场模拟_深灰.png`）的观感上：

            预览（目标）              游戏实测（应贴着目标走）
            我方 亮格 #323941         #3a4249 附近
            我方 暗格 #2a333b         #2f383e 附近
            对方 亮格 #413234         #423739 附近
            对方 暗格 #39282b         #3f2e2e 附近

        这些数是量出来的，不是看的：
          · 目标 = `素材\方舟地块\tools\measure_colors.py` 在预览图上逐格采样
            （预览图**左半是我方**，和游戏一致 —— 别再被旧注释带偏）；
          · 实际 = `tools\probe_board_colors.mjs` 驱动无头 Edge 打开 `?debug=1`，
            调 `three/debug-probe.ts` 挂的 `__airnightBoardProbe.sample()`，
            用 `gl.readPixels` 把每一格真正渲染出来的像素读回来。
        两个口径一致（8 位 sRGB、每格中心 5×5 窗口），差值直接可比；
        偏亮/偏暗先动 `SOURCE_TILE_LIFT`，色相不对才动这里的染色值。
      */
      const color = isMySide
        ? isEven
          ? 0xe7e9ec
          : 0xc0c5ca
        : isEven
          ? 0xffc9c4
          : 0xe89a97;
      (tile.material as MeshStandardMaterial).color.setHex(color);
    }
  }
  applyHalfTint(false);

  // --- 棋盘格线 ---
  const grid = new GridHelper(BOARD_WORLD_H, BOARD_H, 0x3b424b, 0x262a30);
  grid.position.y = BOARD_Y + 0.01;
  boardGroup.add(grid);

  // --- 中线：分隔两军，视觉上很重要 ---
  const midLine = new Mesh(
    new BoxGeometry(0.06, 0.02, BOARD_WORLD_H),
    new MeshStandardMaterial({ color: 0x9aa2ab, emissive: 0x2a2f35 }),
  );
  midLine.position.set(0, BOARD_Y + 0.02, 0);
  scene.add(midLine);

  // --- 四个角的立柱，让场景更有「棋盘」的仪式感 ---
  const pillarGeometry = new CylinderGeometry(0.09, 0.09, 1.1, 8);
  const pillarMaterial = new MeshStandardMaterial({ color: 0x2a3038, emissive: 0x14181c });
  const corners: Array<[number, number]> = [
    [-BOARD_WORLD_W / 2, -BOARD_WORLD_H / 2],
    [BOARD_WORLD_W / 2, -BOARD_WORLD_H / 2],
    [-BOARD_WORLD_W / 2, BOARD_WORLD_H / 2],
    [BOARD_WORLD_W / 2, BOARD_WORLD_H / 2],
  ];
  for (const [x, z] of corners) {
    const pillar = new Mesh(pillarGeometry, pillarMaterial);
    pillar.position.set(x, BOARD_Y + 0.55, z);
    pillar.castShadow = true;
    scene.add(pillar);
  }

  // --- 棋子层与高亮层 ---
  const unitLayer = new Group();
  scene.add(unitLayer);
  const highlightLayer = new Group();
  scene.add(highlightLayer);

  // --- 高亮方块（一个就够，反复移动它，而不是每次新建） ---
  const highlightMesh = new Mesh(
    new PlaneGeometry(CELL * 0.98, CELL * 0.98),
    new MeshStandardMaterial({
      color: 0xc9fa43,
      transparent: true,
      opacity: 0.45,
      emissive: 0xc9fa43,
      emissiveIntensity: 0.6,
    }),
  );
  highlightMesh.rotation.x = -Math.PI / 2;
  highlightMesh.visible = false;
  highlightMesh.position.y = BOARD_Y + 0.012;
  highlightLayer.add(highlightMesh);

  // --- 鼠标拾取 ---
  const raycaster = new Raycaster();
  const pointer = new Vector2();
  /** 复用的临时向量：每帧新建 Vector3 会产生垃圾，Three.js 里这是常见的性能坑 */
  const tmpVec = new Vector3();
  // 用上面收集好的格子数组，不用再遍历一遍场景树
  const tiles: Mesh[] = boardTiles;

  /**
   * 「卡片中心高度」那一层的水平面 —— 判断"这一次点击到底落在哪一格"就靠它。
   * 规则见 pick-geometry.ts。
   */
  const cardPlane = new Plane(new Vector3(0, 1, 0), -CARD_CENTER_Y);
  /** 复用的交点向量（同上：Three.js 里每帧新建 Vector3 是常见的性能坑） */
  const planeHit = new Vector3();

  /**
   * 这一次射线，是不是真的指在「这枚棋子自己那一格」上？
   *
   * 规则本身住在 pick-geometry.ts（纯算术，有单元测试）；这里只负责
   * 把 Three.js 的世界位置/求交结果喂给它。
   */
  function rayHitsOwnCell(object: Object3D): boolean {
    object.getWorldPosition(planeHit);
    const centerX = planeHit.x;
    const centerZ = planeHit.z;
    return pickHitsOwnCell(raycaster.ray.intersectPlane(cardPlane, planeHit), centerX, centerZ);
  }

  /**
   * ★ 0.0.3：这次命中**真的落在模型身上**吗？（你报的"点击面太大"）
   *
   * 规则（详见 chibi.ts 的 chibiOpaqueAt）：
   *   · 命中的是小人精灵 ->  读那个像素的 alpha，透明就**不算点中**；
   *   · 命中的只是卡面（没碰到小人）-> 只要小人素材已就绪就**不算点中**
   *     （野怪的卡面是全透明的，以前等于"点空气也能选中"）；
   *   · 小人没就绪（走立绘兜底）-> 放行，保持老行为，免得点了没反应。
   */
  function pickAcceptsModel(hit: { object: Object3D; point?: { x: number; y: number; z: number } }): boolean {
    let card: Object3D | null = hit.object;
    while (card && !(card.userData as { chibi?: unknown }).chibi) card = card.parent;
    if (!card) return true;
    const chibi = (card.userData as { chibi?: { ready?: boolean; sprite?: Object3D } }).chibi;
    if (!chibi || chibi.ready !== true) return true;
    /*
      ★ 只对"射线打在小人精灵上"的那些做像素判定。
      【为什么不去管打在卡面上的那些？】
      打在卡面上说明射线**没碰到小人**（小人精灵压在卡面前面），
      而那点面积本来就很小、又被"必须落在自己这一格"那条守卫圈着。
      反过来，如果这里也一律拒绝，就会出现"脚边/头顶点不中"的手感问题 ——
      修一个 bug 换来一个更烦人的 bug 不划算。所以这条线划在小人四边形以内。
    */
    if (hit.object === card) return true;
    /*
      用**世界交点**反算小人画布上的 uv（不用 hit.uv：它和画布的对应关系
      取决于射线先打到谁，不统一）。见 chibi.ts 的 chibiUvAtPoint。
    */
    if (!hit.point) return true;
    const uv = chibiUvAtPoint(card as Sprite, hit.point);
    if (!uv) return false; // 交点落到小人四边形之外 —— 肯定是打在空处
    return chibiOpaqueAt(card as Sprite, uv) !== false;
  }

  /**
   * 当前 3D 渲染所在的视口（像素，原点在画布左下角）。
   *
   * 【为什么必须记下来？—— 这里踩过一个坑】
   * 为了让 3D 只渲染在 UI 面板之间的空地，我们用 setViewport 把渲染区域缩进了。
   * 但鼠标拾取如果还按「整个画布」换算坐标，就会和画面对不上 ——
   * 表现为「看到的高亮格子」和「实际点中的格子」错位，
   * 而且错位量正好等于视口的位移。
   *
   * 所以拾取必须用同一套视口参数，不能各算各的。
   */
  let viewport: ViewportRect = {
    x: 0,
    y: 0,
    width: renderer.domElement.clientWidth || 1,
    height: renderer.domElement.clientHeight || 1,
  };

  // --- 视角翻转状态 ---
  // false = 默认视角（队伍 0 在左）；true = 翻转视角（自己在队伍 1，需要左右镜像显示）
  let viewFlipped = false;

  // --- 缩放 / 平移状态（滚轮拉近、拖动看边角）---
  // 数学都在 camera-view.ts 里（纯函数、有单元测试），这里只负责摆相机
  const view = createCameraView();
  /** resize 算出来的"默认距离"。缩放是**乘在这个距离上**的，所以窗口一变也不会跑偏 */
  let basePadded = 0;

  /**
   * 按当前的缩放/平移把相机摆好。
   * 方向和俯角始终不变（只改"距离"），所以拉近拉远时角度不会晃。
   */
  function applyCamera(): void {
    if (basePadded <= 0) return; // 还没 resize 过：保持初始占位位置
    placeBoardCamera(camera, cameraDistanceFor(basePadded, view.zoom), view.panX, view.panZ);
  }

  return {
    scene,
    camera,
    renderer,
    unitLayer,
    highlightLayer,

    /**
     * 把屏幕坐标换算成格子坐标（视角坐标）。
     *
     * 【为什么要先打棋子、再打地板？—— 这里踩过一个坑】
     * 最早只对地板做射线检测。但棋子是**立在地板上方**的卡片：
     * 你点棋子的脑袋，射线穿过去打到的是**它后面那一格**地板。
     * 表现就是"我明明点的是这个干员，却选中了它后面/旁边那格"，
     * 于是拖不动、也选不中。
     *
     * 现在的顺序：
     *   1. 先检测棋子层（unitLayer）里的精灵，命中就把精灵的坐标换算回格子
     *   2. 没打到棋子，再检测地板
     * 这样"点谁就是谁"，和眼睛看到的一致。
     *
     * 【★ 0.0.3：先打棋子这条路上还要再加一道"落在自己格子里"的判定】
     * 因为小人的画布比卡片宽得多（野怪最大 2.58 格），射线打中的是**四边形的范围**，
     * 于是"点空着的格子"会被判成"选中了隔壁那个大怪"，看起来就是鼠标偏移。
     * 现在用"射线在卡片中心高度那一层的落点"来确认落点属于哪一格，
     * 不属于就放行给地板 —— 详见 pick-geometry.ts。
     *
     * @param options.ignoreUnits 跳过硬子、只打地板。
     *   **拖动过程中必须传 true** —— 这是"拖动不生效"的第二个坑：
     *   棋子立绘是竖长的（半身像 1:2），在斜视角下会**盖住后面几格**。
     *   你把棋子往前拖一格，鼠标松开的位置其实还在原来那个精灵的轮廓里，
     *   于是射线又打中它自己 -> 返回原来的格子 -> "没有移动"，看起来就是拖不动。
     *   拖动时只认地板，落点才是你眼睛看到的那个格子。
     */
    screenToCell(clientX: number, clientY: number, options: { ignoreUnits?: boolean } = {}): Cell | null {
      const rect = renderer.domElement.getBoundingClientRect();

      // 用抽出去的纯函数做换算 —— 渲染和拾取共用同一套视口参数。
      // 详见 game/grid.ts 里 pointerToNdc 的注释（这里踩过坑）
      const ndc = pointerToNdc(clientX - rect.left, clientY - rect.top, rect.height, viewport);
      pointer.x = ndc.x;
      pointer.y = ndc.y;

      raycaster.setFromCamera(pointer, camera);

      // ---- 1. 先看有没有点中棋子（拖动时跳过）----
      if (!options.ignoreUnits) {
        const unitHits = raycaster.intersectObjects(unitLayer.children, true);
        for (const hit of unitHits) {
          const cell = this.cellOfSprite(hit.object);
          if (!cell) continue;
          /*
            ★ 0.0.3：还要确认"落点真的在它自己那一格"。
            小人的画布可以宽到 2.58 格（野怪），它的四边形会盖住隔壁格；
            不挡这一下就会出现"点空地被判成选中了旁边的怪"（你报的红方鼠标偏移）。
            见 pick-geometry.ts。
          */
          if (!rayHitsOwnCell(hit.object)) continue;
          // ★ 还要"点在小人身上"（不是卡面 / 透明区）—— 见 pickAcceptsModel
          if (!pickAcceptsModel(hit)) continue;
          return cell;
        }
      }

      // ---- 2. 再打地板 ----
      const hits = raycaster.intersectObjects(tiles, false);
      if (hits.length === 0) return null;
      const data = hits[0]!.object.userData as { col?: number; row?: number };
      if (typeof data.col !== 'number' || typeof data.row !== 'number') return null;
      const raw = { col: data.col, row: data.row };
      // 返回「视角坐标」：翻转显示时，逻辑上的右半边在画面上出现在左边。
      // 调用方拿到的永远是「画面上的左半边 = 我的半场」，符合直觉。
      // 要换算回逻辑坐标用 viewToRawCell()。
      return viewFlipped ? flipCell(raw) : raw;
    },

    /**
     * 某个棋子精灵当前占着哪个格子（视角坐标）。
     *
     * 【注意：这里**不能**再 flip 一次】
     * 地板的 userData 存的是"原始格子"，所以要 flip 成视角坐标；
     * 但精灵的世界坐标是**按翻转后的布局摆的**（见 cellToWorldFlipped），
     * 所以 worldPointToCell 反推出来的**已经是视角坐标**了。
     * 再 flip 一次就等于翻回去了 —— 联机时（自己被分到队伍 1）会点右半边选中左半边的棋子。
     */
    cellOfSprite(object: Object3D): Cell | null {
      const world = object.getWorldPosition(tmpVec);
      const cell = worldPointToCell(world.x, world.z);
      if (cell.col < 0 || cell.col >= BOARD_W || cell.row < 0 || cell.row >= BOARD_H) return null;
      return cell;
    },

    /**
     * 屏幕坐标 -> 棋子层里的精灵（没点到就返回 null）。
     *
     * 【和 screenToCell 的区别】
     * screenToCell 回答"点到哪个格子"（地板也算），
     * 这个回答"点到哪个棋子"。两者用途不同：
     *   · 拖动/放置 -> 要格子
     *   · 点开干员信息 -> 要棋子
     * 分开之后语义清楚，也不会出现"点空地弹出一个干员信息"这种怪事。
     */
    pickUnit(clientX: number, clientY: number): { object: Object3D; cell: Cell } | null {
      const rect = renderer.domElement.getBoundingClientRect();
      const ndc = pointerToNdc(clientX - rect.left, clientY - rect.top, rect.height, viewport);
      pointer.x = ndc.x;
      pointer.y = ndc.y;
      raycaster.setFromCamera(pointer, camera);

      const hits = raycaster.intersectObjects(unitLayer.children, true);
      for (const hit of hits) {
        const cell = this.cellOfSprite(hit.object);
        if (!cell) continue;
        // 同 screenToCell：宽画布小人的四边形不算数（见 pick-geometry.ts）
        if (!rayHitsOwnCell(hit.object)) continue;
        // ★ 战斗中点干员看属性也一样：必须点在小人身上
        if (!pickAcceptsModel(hit)) continue;
        return { object: hit.object, cell };
      }
      return null;
    },

    /**
     * 在**任意一个对象树**里做射线拾取（返回最靠前命中的 Object3D）。
     *
     * 【为什么需要它？pickUnit 不够用吗？】
     * `pickUnit` 只在 `unitLayer` 里找 —— 那是**布阵棋子**所在的层。
     * 但战斗中的棋子住在 `BattleReplay.root` 里（另一棵树，还会自己移动）。
     * 你要求"战斗时也能点干员看实时属性"，所以必须能往那棵树里打射线。
     *
     * 这里只负责"打到哪个对象"，至于那是什么（哪一号单位）
     * 由调用方拿着返回的对象去问回放层 —— 棋盘层不该知道单位编号。
     */
    pickIn(clientX: number, clientY: number, root: Object3D): Object3D | null {
      const rect = renderer.domElement.getBoundingClientRect();
      const ndc = pointerToNdc(clientX - rect.left, clientY - rect.top, rect.height, viewport);
      pointer.x = ndc.x;
      pointer.y = ndc.y;
      raycaster.setFromCamera(pointer, camera);

      const hits = raycaster.intersectObjects(root.children, true);
      /*
        命中是**从近到远**排好序的，最前面那个就是玩家视觉上点到的。
        ★ 0.0.3：跳过"只打在卡面 / 小人透明区"的那些 —— 战斗中点棋子看属性
        也要点在小人身上（见 pickAcceptsModel）。
      */
      for (const hit of hits) {
        if (!pickAcceptsModel(hit)) continue;
        return hit.object;
      }
      return null;
    },

    /**
     * 当前 3D 视口（像素，原点在画布**左下角**）。
     *
     * 【为什么要暴露出来？】
     * 渲染和拾取共用这一个视口 —— 一旦它没跟着 UI 布局更新，
     * 表现就是「点哪中哪」错位（错位量 = 视口位移）。
     * 平时界面用不到它，但调试探针（`?debug=1`）需要拿它把
     * 「屏幕坐标 <-> 格子」算一遍来验证拾取精度，见 debug-probe.ts。
     */
    viewportRect(): ViewportRect {
      return { ...viewport };
    },

    setHighlight(cell: Cell | null, ok: boolean): void {
      if (!cell) {
        highlightMesh.visible = false;
        return;
      }
      const material = highlightMesh.material as MeshStandardMaterial;
      const color = ok ? 0xc9fa43 : 0xff5252;
      material.color.setHex(color);
      material.emissive.setHex(color);
      // 传进来的是视角坐标，换回逻辑坐标才能算出正确的世界位置
      const raw = viewFlipped ? flipCell(cell) : cell;
      highlightMesh.position.copy(cellToWorld(raw, BOARD_Y + 0.012));
      highlightMesh.visible = true;
    },

    setHalfTint(flip: boolean): void {
      viewFlipped = flip;
      applyHalfTint(flip);
    },

    update(): void {
      // 相机固定，每帧不需要做任何事。
      // 保留这个方法是因为主循环还在调用它，而且以后可能会加
      // 「技能命中时轻微震屏」之类的效果 —— 那时候在这里实现。
    },

    resize(width: number, height: number, insets: ViewportInsets = { top: 0, bottom: 0, left: 0, right: 0 }): void {
      renderer.setSize(width, height, false);

      // 换算出「没被 UI 挡住」的那块区域，单位是像素
      const viewW = Math.max(80, width - insets.left - insets.right);
      const viewH = Math.max(80, height - insets.top - insets.bottom);

      // WebGL 的 viewport 原点在左下角，所以要换算坐标系。
      // 用整数 + 向下取整，避免半像素导致的接缝。
      const vx = Math.floor(insets.left);
      const vy = Math.floor(insets.bottom); // 注意：底部留白 = viewport 的下边距
      const vw = Math.floor(viewW);
      const vh = Math.floor(viewH);

      renderer.setViewport(vx, vy, vw, vh);
      // setScissor 用来把「清屏」也限制在这块区域，否则整块画布都被清成背景色、
      // 边缘会看着怪。testScissor 让 scissor 真正生效。
      renderer.setScissor(vx, vy, vw, vh);
      renderer.setScissorTest(true);

      // ★ 关键：把视口记下来，鼠标拾取要用同一套参数，
      // 否则「看到的格子」和「点中的格子」会错位（错位量 = 视口位移）
      viewport = { x: vx, y: vy, width: vw, height: vh };

      // 相机的宽高比要按「可视区域」算，不能按整个窗口 ——
      // 否则棋盘会被拉伸变形
      camera.aspect = viewW / viewH;
      camera.updateProjectionMatrix();

      // 按可视区域算出「该站多远」，俯视角度始终不变
      const distance = fitCameraDistance(camera, BOARD_WORLD_W, BOARD_WORLD_H, UNIT_HEADROOM);

      // CAMERA_ZOOM 大于 1 就是「凑近一点」。
      // 注意不能靠缩小 fit 的边距来拉近 —— 那会让边缘的格子被切掉。
      basePadded = distance * 1.06 * CAMERA_ZOOM;

      // 轮到玩家自己的缩放/平移了（滚轮拉近、拖动看边角）
      applyCamera();
    },

    /**
     * 滚轮缩放。
     * @param deltaY 滚轮方向（往上滚是负数 = 拉近，和浏览器一致）
     * @returns 新的倍率（1 = 默认视角）
     */
    zoomBy(deltaY: number): number {
      zoomByInView(view, deltaY, BOARD_WORLD_W, BOARD_WORLD_H);
      applyCamera();
      return view.zoom;
    },

    /**
     * 拖动平移（像素位移 -> 世界位移）。
     *
     * 【为什么按像素换算，而不是按格子？】
     * 玩家的手感是"抓住棋盘拖"，所以位移应该和鼠标走多远成正比。
     * 可见范围越小（拉得越近），同样的像素就对应更小的世界距离 —— 这样
     * 拉近之后拖动不会"一碰就飞出去"。
     */
    panBy(dxPixels: number, dyPixels: number): void {
      const worldPerPixel = worldPerPixelAt(
        cameraDistanceFor(basePadded, view.zoom),
        camera.fov,
        viewport.height,
      );
      panViewBy(view, dxPixels, dyPixels, worldPerPixel, BOARD_WORLD_W, BOARD_WORLD_H);
      applyCamera();
    },

    /** 当前倍率（1 = 默认视角；界面拿它判断"现在能不能拖动平移"） */
    zoomLevel(): number {
      return view.zoom;
    },

    /** 回到默认视角（点顶栏那个「视角 ×N」徽标） */
    resetView(): void {
      resetCameraView(view);
      applyCamera();
    },
  };
}
