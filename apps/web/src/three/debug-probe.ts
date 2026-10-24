import { Vector3, Vector4, type PerspectiveCamera, type Scene, type WebGLRenderer } from 'three';
import { chibiProbeOf } from './chibi.js';

/**
 * ============================================================
 *  棋盘取色探针（只在 `?debug=1` 时挂上，正常玩绝对不受影响）
 * ============================================================
 *
 * 【为什么需要它？】
 * 棋盘地砖的最终颜色 = 贴图 × 材质染色 × 光照，三步里任何一步改了，
 * 眼睛很难判断"现在到底偏了多少"。0.0.2 接官方地砖时就吃过这个亏：
 * 照着离线预览图（`素材\方舟地块\tools\make_preview_sheets.py`，纯乘法、无光照）
 * 调的染色值，进游戏一看整体偏暗 —— 因为 `MeshStandardMaterial` 还要过一遍光照。
 *
 * 所以调色不能靠眼睛，要靠**数值**：把游戏里每一格真正渲染出来的像素读回来，
 * 按「我方亮格 / 我方暗格 / 对方亮格 / 对方暗格」四类取平均，
 * 再和离线预览图里同样四类的平均值比 —— 差多少一目了然。
 *
 * 【怎么读的？】
 * 用 `gl.readPixels` 从帧缓冲里直接抠像素，不是截图 —— 截图要处理
 * 设备像素比、视口偏移、色彩管理，全是噪声；readPixels 拿到的就是
 * 送上屏幕的那几个字节。
 *
 * 【怎么用？】
 *   1. 浏览器打开 `<地址>/?debug=1`
 *   2. 控制台执行：`__airnightBoardProbe.sample()`
 *   3. 返回 `{ groups: { 'mine-light': [r,g,b], ... }, tiles: {...}, tints: {...} }`
 *
 * ★ 读像素之前必须先 `render()` 一次 —— WebGL 默认 `preserveDrawingBuffer: false`，
 * 帧缓冲在合成之后内容就不保证还在了。所以 `sample()` 自己会先渲染一帧。
 */

/** 一个采样分组：我方/对方 × 亮格/暗格 */
export type ProbeGroup = 'mine-light' | 'mine-dark' | 'foe-light' | 'foe-dark';

export interface ProbeResult {
  /** 每一类的平均色（8 位 sRGB，和截图/预览图上的值是同一套口径） */
  groups: Record<ProbeGroup, [number, number, number]>;
  /** 每一类包含多少个格子 —— 用来确认"两半各 100 格"没算错 */
  tiles: Record<ProbeGroup, number>;
  /** 每一类用到的材质染色值（hex）。对不上说明分组逻辑错了 */
  tints: Record<ProbeGroup, string>;
  /** 采样用的帧缓冲尺寸（设备像素） */
  drawingBuffer: [number, number];
  /** 因为落在帧缓冲外被跳过的格子数（大厅里棋盘只露一部分时会出现） */
  skipped: number;
}

/** 每个格子中心采一个 (2W+1)² 的窗口取平均 —— 单点容易被纹理噪点带偏 */
const WINDOW = 2;

/**
 * 把探针挂到 `window.__airnightBoardProbe`。
 *
 * @param scene    棋盘所在的场景（会遍历它找地砖）
 * @param camera   当前相机（用来把格子中心投影到屏幕）
 * @param renderer 渲染器（readPixels 和取视口都靠它）
 */
export function installBoardProbe(
  scene: Scene,
  camera: PerspectiveCamera,
  renderer: WebGLRenderer,
): void {
  const gl = renderer.getContext();
  const world = new Vector3();
  const pixel = new Uint8Array(4);
  const vp = new Vector4();

  function sample(): ProbeResult {
    // 先渲染一帧，保证帧缓冲里是"现在的画面"
    renderer.render(scene, camera);

    const pr = renderer.getPixelRatio();
    renderer.getViewport(vp); // 视口是 CSS 像素、原点左下角 —— 和 readPixels 同一个坐标系

    const acc = new Map<ProbeGroup, { r: number; g: number; b: number; n: number; tiles: number; tint: string }>();
    for (const key of ['mine-light', 'mine-dark', 'foe-light', 'foe-dark'] as ProbeGroup[]) {
      acc.set(key, { r: 0, g: 0, b: 0, n: 0, tiles: 0, tint: '' });
    }
    let skipped = 0;

    scene.traverse((obj) => {
      // 地砖是唯一带 col/row 的网格（见 board.ts 里 tile.userData 的赋值）
      const data = obj.userData as { col?: unknown; row?: unknown };
      if (typeof data.col !== 'number' || typeof data.row !== 'number') return;
      const col = data.col;
      const row = data.row;

      const material = (obj as unknown as { material?: { color?: { getHex(): number } } }).material;
      const hex = material?.color?.getHex();
      if (typeof hex !== 'number') return;

      /*
        我方染色偏蓝（B > R），对方偏红（R > B）—— 直接按材质色自己判断阵营，
        不用再去问 flip 状态，探针和棋盘的翻转逻辑解耦。
      */
      const r = (hex >> 16) & 0xff;
      const b = hex & 0xff;
      const side = b >= r ? 'mine' : 'foe';
      const tone = (col + row) % 2 === 0 ? 'light' : 'dark';
      const key = `${side}-${tone}` as ProbeGroup;

      obj.getWorldPosition(world);
      world.project(camera);
      if (world.z > 1) return; // 落到相机背后了

      // NDC(-1..1) -> 视口内 CSS 像素 -> 帧缓冲像素
      const px = (vp.x + ((world.x + 1) / 2) * vp.z) * pr;
      const py = (vp.y + ((world.y + 1) / 2) * vp.w) * pr;
      const w = renderer.domElement.width;
      const h = renderer.domElement.height;
      /*
        整个采样窗口都必须落在帧缓冲里 —— readPixels 对越界坐标的行为是
        "读不到就给 0"，混进来会把平均值整体拉黑，还不报错。
        （大厅界面棋盘被菜单盖住、相机框取也只露出一部分，就会走到这里。）
      */
      if (px < WINDOW || py < WINDOW || px > w - WINDOW - 1 || py > h - WINDOW - 1) {
        skipped += 1;
        return;
      }

      const group = acc.get(key)!;
      const cx = Math.round(px);
      const cy = Math.round(py);
      for (let dy = -WINDOW; dy <= WINDOW; dy++) {
        for (let dx = -WINDOW; dx <= WINDOW; dx++) {
          gl.readPixels(cx + dx, cy + dy, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
          group.r += pixel[0]!;
          group.g += pixel[1]!;
          group.b += pixel[2]!;
          group.n += 1;
        }
      }
      group.tiles += 1;
      group.tint = `#${hex.toString(16).padStart(6, '0')}`;
    });

    const result = {
      groups: {} as ProbeResult['groups'],
      tiles: {} as ProbeResult['tiles'],
      tints: {} as ProbeResult['tints'],
      drawingBuffer: [renderer.domElement.width, renderer.domElement.height] as [number, number],
      skipped,
    };
    for (const [key, g] of acc) {
      result.groups[key] = [
        g.n ? Math.round(g.r / g.n) : 0,
        g.n ? Math.round(g.g / g.n) : 0,
        g.n ? Math.round(g.b / g.n) : 0,
      ];
      result.tiles[key] = g.tiles;
      result.tints[key] = g.tint;
    }
    return result;
  }

  (globalThis as unknown as Record<string, unknown>)['__airnightBoardProbe'] = { sample };
  console.info('[探针] 棋盘取色探针已就绪：__airnightBoardProbe.sample()');
}

/** 一只棋子的体检结果 */
export interface UnitProbeRow {
  defId: string;
  star: number;
  team: number;
  mine: boolean;
  /** 场景里这一层可见吗 */
  visible: boolean;
  /** 挂上小人状态了吗（= attachChibi 走到了建 state 那一步） */
  hasChibi: boolean;
  /** 小人素材真的加载完了吗（false = 现在是看不见小人的） */
  chibiReady: boolean;
  /** 小人精灵自己是 visible 吗 */
  chibiVisible: boolean;
  /** 载入了哪些动作 */
  anims: string[];
  /** 哪些动作的序列帧真的下来了 */
  images: string[];
}

/**
 * 棋子 / 小人状态体检探针（同样只在 `?debug=1` 时挂上）。
 *
 * 【为什么要它？】
 * "干员模型丢失"是个很含糊的现象：可能是卡面立绘区留空（小人没加载出来）、
 * 可能是小人不 visible、也可能是精灵根本没被挂上。光看截图分不清是哪一种，
 * 而这个报告能一次把"每个精灵处于哪一环"列清楚：
 *   hasChibi=false            -> 压根没建小人（def 没有素材 / 索引没到）
 *   hasChibi=true ready=false -> 建了但素材没加载完（卡面这时必须是"有立绘"的那版）
 *   ready=true visible=false  -> 加载完了却没显示（异常）
 */
export function installUnitProbe(scene: Scene): void {
  const report = (): UnitProbeRow[] => {
    const rows: UnitProbeRow[] = [];
    scene.traverse((obj) => {
      const data = obj.userData as {
        defId?: unknown;
        star?: unknown;
        team?: unknown;
        mine?: unknown;
        chibi?: { ready: boolean; sprite?: { visible: boolean }; anims?: Record<string, unknown>; images?: Record<string, unknown> };
      };
      if (typeof data.defId !== 'string') return;
      const chibi = data.chibi;
      rows.push({
        defId: data.defId,
        star: typeof data.star === 'number' ? data.star : 0,
        team: typeof data.team === 'number' ? data.team : 0,
        mine: data.mine === true,
        visible: obj.visible,
        hasChibi: !!chibi,
        chibiReady: !!chibi?.ready,
        chibiVisible: chibi?.sprite?.visible === true,
        anims: chibi?.anims ? Object.keys(chibi.anims) : [],
        images: chibi?.images ? Object.keys(chibi.images) : [],
      });
    });
    return rows;
  };

  (globalThis as unknown as Record<string, unknown>)['__airnightUnitProbe'] = { report };
  console.info('[探针] 棋子体检探针已就绪：__airnightUnitProbe.report()');
}

/**
 * ============================================================
 *  ★ 0.0.3 移动动画探针（同样只在 `?debug=1` 时挂上）
 * ============================================================
 *
 * 【为什么需要它？】
 * "走路变平滑了 / 走路动作播出来了"这两件事**光看代码和单测证明不了**：
 *   · 平滑不平滑取决于每帧位移的连续性（单测只能证明公式是线性的）；
 *   · 走路动作有没有真的播，要看运行时 `current` 这个键有没有变成 `move`；
 *   · 转错层（把前倾写在卡片精灵上）只会让卡框歪掉，代码看起来完全正常。
 * 所以这里把"表现层的事实"采出来：每只棋子的**动画键 / 帧号 / 前倾角度 / 世界坐标**，
 * 外加"它到底有没有走路素材"。`scripts/walk-e2e.mjs` 会按时间采样，然后核对：
 *   ① 有走路素材的单位，在位移期间必须真的在播 move；
 *   ② 位移是**小步连续**的（走路不会一格一格干站着）；
 *   ③ 干员的程序化走姿确实产生了前倾。
 *
 * 【采样必须成对看】
 * 单看一帧什么都判断不了 —— 位置只有跟上一帧比才知道在不在动，
 * 所以调用方负责记录时间轴（见 walk-e2e.mjs 的采样循环）。
 */
export interface MotionProbeRow {
  defId: string;
  team: 0 | 1;
  /** 现在在播哪个动画键（idle / move / attack / skill / stun / die，二阶段带 2 后缀） */
  anim: string;
  /**
   * ★ 0.2：这一帧**想播**的动作。没有对应素材时 `anim` 会退回 idle，
   * 所以"眩晕有没有被识别"要看 `mode`（`mode === 'stun'`）。
   */
  mode: string;
  frame: number;
  /** 小人精灵的前倾角度（弧度）；干员走路时它会短暂变成非 0 */
  lean: number;
  /** 这只单位有走路素材吗（野怪有、干员基本没有） */
  hasMove: boolean;
  /** 世界坐标（棋盘平面上的位置） */
  x: number;
  y: number;
}

/**
 * ============================================================
 *  ★ 0.1.4 攻击特效探针（同样只在 `?debug=1` 时挂上）
 * ============================================================
 *
 * 【为什么需要它？】
 * "攻击的时候真的冒火花了吗"这件事，**单帧截图证明不了**：
 * 特效只有 0.13~0.3 秒，截图很可能正好落在两次攻击之间，
 * 拍到的是一片干净的棋盘 —— 看起来像"根本没做"。
 * 所以和移动动画探针同一个思路：让运行时**自己数**，
 * 由 e2e 按时间采样，断言"开打之后确实出现过弧 / 爆点 / 冲击环"。
 *
 * 统计口径：遍历场景里带 `userData.airnightAttackFx` 标记的壳
 * （replay 的 `addFlat` 打的那个标记），按形状和家族分类计数。
 */
export interface AttackFxProbeRow {
  /** 现在场上有几块薄片 */
  total: number;
  arc: number;
  burst: number;
  ring: number;
  /** 按单位家族分（operator / monster / summon） */
  operator: number;
  monster: number;
  summon: number;
}

export function installAttackFxProbe(scene: Scene): void {
  const sample = (): AttackFxProbeRow => {
    const row: AttackFxProbeRow = {
      total: 0,
      arc: 0,
      burst: 0,
      ring: 0,
      operator: 0,
      monster: 0,
      summon: 0,
    };
    scene.traverse((obj) => {
      const data = (obj.userData as { airnightAttackFx?: { kind?: string; family?: string } })
        .airnightAttackFx;
      if (!data) return;
      row.total++;
      if (data.kind === 'arc') row.arc++;
      else if (data.kind === 'burst') row.burst++;
      else if (data.kind === 'ring') row.ring++;
      if (data.family === 'operator') row.operator++;
      else if (data.family === 'monster') row.monster++;
      else if (data.family === 'summon') row.summon++;
    });
    return row;
  };

  (globalThis as unknown as Record<string, unknown>)['__airnightAttackFxProbe'] = { sample };
  console.info('[探针] 攻击特效探针已就绪：__airnightAttackFxProbe.sample()');
}

export function installMotionProbe(scene: Scene): void {
  const tmp = new Vector3();
  const sample = (): MotionProbeRow[] => {
    const rows: MotionProbeRow[] = [];
    scene.traverse((obj) => {
      const data = obj.userData as { defId?: unknown; team?: unknown };
      if (typeof data.defId !== 'string') return;
      const chibi = chibiProbeOf(obj as unknown as Parameters<typeof chibiProbeOf>[0]);
      if (!chibi) return;
      obj.getWorldPosition(tmp);
      rows.push({
        defId: data.defId,
        team: data.team === 1 ? 1 : 0,
        anim: chibi.anim,
        mode: chibi.mode,
        frame: chibi.frame,
        lean: Math.round(chibi.lean * 10000) / 10000,
        hasMove: chibi.hasMove,
        x: Math.round(tmp.x * 1000) / 1000,
        y: Math.round(tmp.y * 1000) / 1000,
      });
    });
    return rows;
  };

  (globalThis as unknown as Record<string, unknown>)['__airnightMotionProbe'] = { sample };
  console.info('[探针] 移动动画探针已就绪：__airnightMotionProbe.sample()');
}

/**
 * ============================================================
 *  ★ 0.0.3 鼠标拾取探针（同样只在 `?debug=1` 时挂上）
 * ============================================================
 *
 * 【为什么需要它？】
 * "鼠标点哪中哪"是这个游戏里最容易被感觉出问题、又最难自证的一环：
 *   · 3D 只在 UI 面板之间的空地渲染（setViewport），
 *     一旦视口没跟着布局更新，**拾取和画面就会整体错开**，
 *     错位量正好等于视口位移 —— 手感上就是"鼠标偏移"。
 *   · 棋子卡片是立着的，小人的画布还比卡片宽（野怪最宽 2.58 格），
 *     所以"射线先打棋子"这条路径可能把落点判到**隔壁那一格**。
 *
 * 【怎么量？—— 往返（round-trip）】
 * 上一版是"拿点中的格子去比离光标最近的格子中心"，那个判据是**错的**：
 * 一格在屏幕上约 43×39 像素，站在格子角上时离**自己**中心就有 29 像素，
 * 完全可能比隔壁中心还远 —— 于是会报出一堆假错（实测 5%，最差 29.9px）。
 *
 * 现在改成真正无歧义的问法：
 *   把每一格的**中心**（以及 ±0.3 格的几个点）投影到屏幕上，
 *   再拿这个屏幕坐标去拾取，**拾回来的必须还是同一格**。
 * 这一步同时验了两件事：
 *   1. 视口/相机这套几何对不对（对不上，投影点和拾取点就整体错开）；
 *   2. 有没有被隔壁棋子的宽画布"抢走"（棋盘上摆着棋子时最容易暴露）。
 *
 * 用 `onlyFloor: true` 量纯几何；`onlyFloor: false` 走完整拾取（和真实点击一致）。
 */
export interface PointerProbeFailure {
  /** 采样点的屏幕坐标（client 像素） */
  x: number;
  y: number;
  /** 拾取回来的格子 */
  picked: { col: number; row: number };
  /** 本来应该拾取到的那一格 */
  expected: { col: number; row: number };
}

export interface PointerProbeReport {
  /** 一共验证了多少个采样点 */
  samples: number;
  /** 其中"拾回来的格子不是期望那一格"的次数 */
  mismatches: number;
  mismatchRate: number;
  /** 前几条失败样本（最多 8 条，够定位问题就行） */
  failures: PointerProbeFailure[];
}

export interface PointerProbe {
  /** 屏幕坐标 -> 视角格子（和点击走同一条路） */
  pick(clientX: number, clientY: number, onlyFloor?: boolean): { col: number; row: number } | null;
  /** 视角格子（可以是小数）-> 屏幕坐标（用当前相机和视口反投影）。`y` 缺省是卡片中心高度 */
  project(cell: { col: number; row: number }, y?: number): { x: number; y: number } | null;
  /** 往返检查：在每一格的屏幕范围里取样，投影到屏幕再拾回来，看还是不是同一格 */
  grid(options?: { onlyFloor?: boolean; inset?: number }): PointerProbeReport;
}

/** 探针需要从 main.ts 借到的几样东西 */
export interface PointerProbeDeps {
  canvas: HTMLCanvasElement;
  camera: PerspectiveCamera;
  /** 3D 视口（像素，**左下角**原点） */
  viewport(): { x: number; y: number; width: number; height: number };
  /** 屏幕坐标 -> 视角格子（`onlyFloor` = 跳过棋子只打地板） */
  pickCell(clientX: number, clientY: number, onlyFloor: boolean): { col: number; row: number } | null;
  /** 视角格子 -> 世界坐标（已经处理过视角翻转；`y` 是要投影的高度） */
  cellToWorld(cell: { col: number; row: number }, y?: number): { x: number; y: number; z: number };
  /** 棋盘多少列 / 多少行 */
  boardW: number;
  boardH: number;
}

/** 采样方向：格子正中，以及横竖各偏一点（乘上 inset 就是"离中心多少格"） */
const PROBE_OFFSETS = [0, 1, -1];

export function installPointerProbe(deps: PointerProbeDeps): void {
  const rectOf = (): DOMRect => deps.canvas.getBoundingClientRect();

  /**
   * 世界坐标 -> 屏幕坐标。
   *
   * 【为什么不是用 renderer 的像素尺寸换算？】
   * NDC（-1..1）映射到的是**视口矩形**（setViewport 设的那块），
   * 不是整张画布 —— 这正是"视口一变、拾取就错"的根源。
   * 所以这里必须拿同一份视口参数来做逆运算，才能验证拾取对不对。
   */
  const worldToClient = (world: { x: number; y: number; z: number }): { x: number; y: number } => {
    const rect = rectOf();
    const ndc = new Vector3(world.x, world.y, world.z).project(deps.camera);
    const vp = deps.viewport();
    const px = vp.x + ((ndc.x + 1) / 2) * vp.width;
    const pyFromBottom = vp.y + ((ndc.y + 1) / 2) * vp.height;
    return { x: px + rect.left, y: rect.top + (rect.height - pyFromBottom) };
  };

  const pick = (clientX: number, clientY: number, onlyFloor = true): { col: number; row: number } | null =>
    deps.pickCell(clientX, clientY, onlyFloor);

  const project = (cell: { col: number; row: number }, y?: number): { x: number; y: number } | null =>
    worldToClient(deps.cellToWorld(cell, y));

  /**
   * 往返检查。
   *
   * 【为什么采样点要按"地板高度的四角"来定？】
   * 因为玩家**看到的是地砖**（贴在地板上），所以他点的位置天然落在
   * "这一格地砖在屏幕上的那块四边形"里。拿卡片中心高度去投影当参考点是不公平的：
   * 相机有俯角 + 透视，靠近棋盘远端时"卡片中心高度"的投影会飘到棋盘外
   * （实测会飘出 0.23 格），于是量出一堆"假失败"。
   * 所以这里改成：算出每格地砖的屏幕范围，在**里面**取样。
   */
  const grid = (options: { onlyFloor?: boolean; inset?: number } = {}): PointerProbeReport => {
    const onlyFloor = options.onlyFloor ?? true;
    // 0.25 格：够贴近格子边界，又还在"这一格地砖"里（0.5 就到隔壁了）
    const inset = Math.max(0, Math.min(0.4, options.inset ?? 0.25));
    const offsets = PROBE_OFFSETS.map((o) => (o === 0 ? 0 : Math.sign(o) * inset));

    let samples = 0;
    let mismatches = 0;
    const failures: PointerProbeFailure[] = [];

    for (let col = 0; col < deps.boardW; col++) {
      for (let row = 0; row < deps.boardH; row++) {
        for (const dc of offsets) {
          for (const dr of offsets) {
            // y = 0：按**地板**高度投影，得到的就是"这块地砖在屏幕上的位置"
            const screen = worldToClient(deps.cellToWorld({ col: col + dc, row: row + dr }, 0));
            const picked = pick(screen.x, screen.y, onlyFloor);
            samples++;
            if (!picked || picked.col !== col || picked.row !== row) {
              mismatches++;
              if (failures.length < 12) {
                failures.push({
                  x: Math.round(screen.x),
                  y: Math.round(screen.y),
                  picked: picked ?? { col: -1, row: -1 },
                  expected: { col, row },
                });
              }
            }
          }
        }
      }
    }

    return {
      samples,
      mismatches,
      mismatchRate: samples > 0 ? mismatches / samples : 0,
      failures,
    };
  };

  (globalThis as unknown as Record<string, unknown>)['__airnightPointerProbe'] = { pick, project, grid };
  console.info(
    '[探针] 鼠标拾取探针已就绪：__airnightPointerProbe.grid() / .pick(x,y) / .project({col,row})',
  );
}
