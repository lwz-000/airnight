/**
 * ============================================================
 *  ★★ 0.2.1：通用「序列帧特效」播放器（外部美术交的图 → 游戏里播）
 * ============================================================
 *
 * 【它是什么？】
 * 美术（或朋友的 AI）按《特效图制作规格书》交来的一张张**横向序列帧 PNG**，
 * 在这里被登记成"一个 id"，战斗里由内核事件点名播放：
 *   · 普攻         → `attack` 事件的 `muzzleFx` / `hitFx` / `heavyFx`
 *   · 放技能       → `cast` 事件的 `fx`（一个 id 可以带"自身 / 落点 / 技能期间每一刀"三组）
 *   · 范围爆炸     → `bloom` 事件 + `vishdal-bloom.ts`（那套是分层地面贴花，走另一条路）
 *
 * ============================================================
 *  【一、为什么所有干员共用这一个模块】
 * ============================================================
 * 项目总纲："同一动作只允许一处实现"。四套图（能天使/陈/玛恩纳/凯尔希）格式完全同构 ——
 * 都是"每帧等宽等高、横向排、加色混合、1 格 = 256 px"。所以**播放器只能有一份**，
 * 干员之间不同的只有**参数**（帧数、fps、占几格、贴哪），那些全在下面的表里。
 *
 * ★ 渲染层**不许**出现 `defId === 'op47'` 这种判断：
 *   "这一下播哪套"的唯一真相在数据表（`UnitDef.combatFx` / `SkillDef.castFx`），
 *   内核把字符串原样塞进事件，这里只查注册表。以后加人 = 加图 + 加一行数据，不改代码。
 *
 * ============================================================
 *  【二、尺寸：一切都是"格"】
 * ============================================================
 * `cells` = 这张图在世界里占几格。约定由出图规格定死：**1 格 = 256 px**，
 * 所以 `cells = 单帧宽度 / 256`（写在这个表里，别在运行时算 —— 表就是口径）。
 * 平面/精灵的实际大小 = `cells × CELL`，45° 相机自己会把地面圆压成椭圆，
 * **图里不许预压**（预压过的图到这里会被压两次，变成一颗橄榄）。
 *
 * ============================================================
 *  【三、时间：跟着回放时钟走，不开 setTimeout】
 * ============================================================
 * 实例只记 `elapsed`，`updateSeqFx` 每帧把 delta 加进去 ——
 * 于是"两倍速 / 断线重连从中间接上 / 看录像"全自动正确（和 attack-fx / slash-fx 同一条规矩）。
 * 帧号 = `floor(elapsed × fps)`，非循环的挑到最后一帧就停；
 * 循环的（玛恩纳的金色小雨滴）按 `life` 决定什么时候收 —— 而 `life` 由**技能持续时长**给。
 *
 * ============================================================
 *  【四、贴图池：clone 只 clone"帧指针"】
 * ============================================================
 * 和 `vishdal-bloom.ts` 完全一样：整张图全场只上传一次（`baseTextureCache`），
 * 每个实例 clone 一份 `repeat/offset` 指针（three.js 的 clone 共享 `Source`，不重传）。
 * 实例用完不真删，放回池子 —— 否则下一发子弹要重传一张 1.5 MB 的图。
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
  Sprite,
  SpriteMaterial,
  Texture,
  type Object3D,
} from 'three';
import { CELL } from '../game/grid.js';
import { getLoadedImage, loadImage } from './assets.js';
import { RENDER_ORDER_FX } from './card-layout.js';

/** 贴地高度：比范围白框（`replay.ts` 的 `ZONE_Y = 0.02`）再高一点点，压在白框之上 */
export const SEQ_FX_GROUND_Y = 0.024;
/** 枪口/胸口那类"挂人身上"的高度（卡面 0.96 高，取一半） */
export const SEQ_FX_CHEST_Y = 0.52;
/**
 * 枪口往目标方向推出的距离（格）。
 * ★ 0.2.1 改（用户口径）：要"从卡面边缘"冒出来 —— 卡面宽 0.72 格，
 * 所以推到半个卡面宽（0.36）正好贴着卡边；再推就飘到卡外了。
 */
export const SEQ_FX_MUZZLE_OFFSET_CELLS = 0.36;
/** 关掉前最后多少秒开始淡出（图里通常已经淡了，这里只补一个"别啪一下消失"） */
export const SEQ_FX_TAIL_SECONDS = 0.06;
/** 同时在播的实例上限（超了丢最老的 —— 和攻击特效/刀光/爆炸同一条规矩） */
export const SEQ_FX_MAX_LIVE = 60;

/** 挂在哪：`ground` = 贴地（棋盘格上）；`muzzle` = 胸口高度并朝目标推出；`between` = 摆在两者正中、大小盖住两者 */
export type SeqFxAnchor = 'ground' | 'muzzle' | 'between';

export interface SeqFxSpec {
  /** 贴图路径（相对 `apps/web/public/assets/`） */
  path: string;
  /** 一共几帧（= 图宽 / 单帧宽） */
  frames: number;
  /** 每秒几帧（出图 manifest 里那个数，别自己推） */
  fps: number;
  /** 世界尺寸 = 几格（= 单帧像素宽 / 256） */
  cells: number;
  anchor: SeqFxAnchor;
  /** 加色（火/光/斩击）还是普通（烟/尘/血泊那种要遮暗的） */
  blend: 'add' | 'normal';
  /** 贴地层的额外抬高（防止几层加色叠成一块白），不写 = 0 */
  lift?: number;
  /** 循环播放（小雨滴这种"技能期间一直在下"的），不写 = 播一遍就停 */
  loop?: boolean;
  /**
   * ★ 0.2.1：贴地层**按"我方 → 目标"的方向旋转**（通用斩击用）。
   *
   * 【为什么需要？】斩击是有方向的：刀锋必须从挥刀的人那侧扫向被打的人。
   * 之前几套斩击都是"把方向烘死在图里"（陈的五连斩是固定斜角），
   * 而通用件要服务十几个干员、站位朝哪儿都有，只能由渲染层按事件里的两人位置转。
   * 贴图按 **+X 画**（刀头在 +X 侧），这里把 +X 转到 (target - self) 的方向。
   *
   * ★ 写了它就不再使用 `flipX`（镜像会把刀头翻到反方向，整刀就"倒着砍"了）。
   */
  yawToTarget?: boolean;
  /**
   * `between` 锚点的"额外边距（格）"，不写 = 用 `cells`。
   *
   * ★ 为什么要和 `cells` 分开：`cells` 是**图的物理尺寸**（= 单帧宽 / 256，
   *   `fx-registry.test.ts` 钉死它必须和图一致）；而"摆到两人中间时再撑开多少"
   *   是**构图**问题。通用斩击的图是 1.5 格（384 px），但贴脸打只需要 1.6 格宽 ——
   *   拿 `cells` 当边距会变成 2.5 格，刀比人还长。
   */
  padCells?: number;
}

/**
 * ★★ **特效注册表**：id → 一张图怎么播。
 *
 * 表里的数全部来自美术包的 `manifest.json`，改图时**两边一起改**。
 * `cells` 的来历永远是 `单帧宽 / 256`（规格书 §5 的换算基准）。
 */
export const SEQ_FX: Record<string, SeqFxSpec> = {
  // ---- 新约能天使：枪口火光 + 命中火花（橙金）----
  angel_muzzle: { path: 'fx/angel_muzzle.png', frames: 6, fps: 36, cells: 1, anchor: 'muzzle', blend: 'add' },
  angel_muzzle_flare: { path: 'fx/angel_muzzle_flare.png', frames: 8, fps: 30, cells: 1.5, anchor: 'muzzle', blend: 'add' },
  angel_hit: { path: 'fx/angel_hit.png', frames: 6, fps: 36, cells: 1, anchor: 'ground', blend: 'add' },
  angel_hit_heavy: { path: 'fx/angel_hit_heavy.png', frames: 8, fps: 28, cells: 1.5, anchor: 'ground', blend: 'add' },

  // ---- 陈「赤刃明霄」S3：瞬移 / 连斩 / 终结（赤红）----
  chen_s3_blink: { path: 'fx/chen_s3_blink.png', frames: 10, fps: 26, cells: 2, anchor: 'ground', blend: 'add' },
  chen_s3_slash: { path: 'fx/chen_s3_slash.png', frames: 8, fps: 30, cells: 1.5, anchor: 'ground', blend: 'add', lift: 0.002 },
  chen_s3_combo: { path: 'fx/chen_s3_combo.png', frames: 12, fps: 16, cells: 2, anchor: 'ground', blend: 'add' },
  chen_s3_final: { path: 'fx/chen_s3_final.png', frames: 10, fps: 24, cells: 2, anchor: 'ground', blend: 'add', lift: 0.003 },
  chen_s3_hit: { path: 'fx/chen_s3_hit.png', frames: 6, fps: 30, cells: 1, anchor: 'ground', blend: 'add', lift: 0.004 },

  // ---- 玛恩纳 S3：起手 / 大范围金色斩击 / 小雨滴 / 命中 ----
  mlynar_s3_cast: { path: 'fx/mlynar_s3_cast.png', frames: 10, fps: 24, cells: 2, anchor: 'ground', blend: 'add' },
  /*
    ★ 0.2.1 改（用户口径）：这刀要**每次攻击都出现**，而且摆在"他砍出去的那条线上"
    ⇒ 锚点 `between`（中点 + 按距离撑开），不再贴在敌人脚下。
  */
  mlynar_s3_slash: { path: 'fx/mlynar_s3_slash.png', frames: 10, fps: 25, cells: 3, anchor: 'between', blend: 'add', lift: 0.002 },
  mlynar_s3_rain: { path: 'fx/mlynar_s3_rain.png', frames: 16, fps: 12, cells: 2, anchor: 'ground', blend: 'add', loop: true, lift: 0.005 },
  mlynar_s3_hit: { path: 'fx/mlynar_s3_hit.png', frames: 8, fps: 30, cells: 1, anchor: 'between', blend: 'add', lift: 0.004 },

  // ---- ★ 0.2.1 炮手普攻：1 格命中爆炸 + 烟尘（黄 / 红 / 灰）----
  /*
    炮手的炮弹**飞行**不在这张表里（那是 `bolt-tracer-fx.ts` 的 `shell` 弹道）；
    这里只有"落点炸开"的两层：
      · blast —— 加色（火/冲击波/火星），lift 抬高一档 ⇒ 画在烟**上面**；
      · smoke —— 普通混合（真正的暗色烟尘），贴地。
    两张单帧都是 256 px = 1 格，所以 `cells: 1`（"爆炸只覆盖一格"就是这条）。
  */
  cannon_blast_yellow: { path: 'fx/cannon_blast_yellow.png', frames: 10, fps: 24, cells: 1, anchor: 'ground', blend: 'add', lift: 0.004 },
  cannon_smoke_yellow: { path: 'fx/cannon_smoke_yellow.png', frames: 12, fps: 18, cells: 1, anchor: 'ground', blend: 'normal' },
  cannon_blast_red: { path: 'fx/cannon_blast_red.png', frames: 10, fps: 24, cells: 1, anchor: 'ground', blend: 'add', lift: 0.004 },
  cannon_smoke_red: { path: 'fx/cannon_smoke_red.png', frames: 12, fps: 18, cells: 1, anchor: 'ground', blend: 'normal' },
  cannon_blast_gray: { path: 'fx/cannon_blast_gray.png', frames: 10, fps: 24, cells: 1, anchor: 'ground', blend: 'add', lift: 0.004 },
  cannon_smoke_gray: { path: 'fx/cannon_smoke_gray.png', frames: 12, fps: 18, cells: 1, anchor: 'ground', blend: 'normal' },

  /*
    ★ 0.2.1 菲亚梅塔技能「轰击」的**卡面冲天火柱**（每开一次技能放一次）。
    Sprite（正对镜头）挂在胸口高度、2.6 格大 —— 火柱底部在纹理 30% 处，正好落在脚下。
    ★ 落点那套 5×5 凤凰不在这张表里：它走 `vishdal-bloom.ts` 的 `BLOOM_FX`
      （三层贴地，由 `splash.fx` → `bloom` 事件驱动）。
  */
  fiammetta_cast: { path: 'fx/fiammetta_cast.png', frames: 10, fps: 24, cells: 3, anchor: 'muzzle', blend: 'add' },

  /*
    ★★ 0.2.1 追加：**通用单条斩击**（用户口径）。
    "只要一条斩击动画、不绑颜色，给大部分近战角色使用" ⇒
      · 中性银白（蓝半场/暗红半场都读得出，也不和陈的赤红五连斩撞色）；
      · 锚点 `between`（摆在两人中间、按距离撑开）+ `yawToTarget`（刀锋朝目标）；
      · `cells: 0.9` = "两人距离 + 0.9 格" ⇒ 贴脸打时整刀 1.9 格宽，正好盖住两边。
    ★ 数据侧：`COMBAT_FX.melee_slash`，由 `unit-data.ts` 的 `COMBAT_FX_IDS` 点名分配。
  */
  slash_single: {
    path: 'fx/slash_single.png',
    frames: 8,
    fps: 30,
    cells: 1.5,        // = 384 px / 256（图的物理尺寸，测试钉死）
    padCells: 0.6,     // 贴脸打时整刀 1.6 格宽（正好盖住两个人，不会长到第三格）
    anchor: 'between',
    blend: 'add',
    lift: 0.003,
    yawToTarget: true,
  },
  /*
    ★★ 0.2.1（用户口径）：**按角色色系分三套**，形状/帧数/尺寸完全一样，只换配色。
    白 = `slash_single`（星熊 / 芳汀 / 风笛 / 砾 / 左乐 / 若叶睦 + 默认那几位）
    红 = `slash_red`（炎客 / 聆音 / 老鲤 / 隐德来希 / 祐天寺若麦）
    黄 = `slash_gold`（机械师 / 耀骑士临光 / 玛恩纳 / 维娜·维多利亚）
    ★ 数据侧：`COMBAT_FX` 里三条绑定（`melee_slash` / `melee_slash_red` / `melee_slash_gold`）。
  */
  slash_red: {
    path: 'fx/slash_red.png',
    frames: 8,
    fps: 30,
    cells: 1.5,
    padCells: 0.6,
    anchor: 'between',
    blend: 'add',
    lift: 0.003,
    yawToTarget: true,
  },
  slash_gold: {
    path: 'fx/slash_gold.png',
    frames: 8,
    fps: 30,
    cells: 1.5,
    padCells: 0.6,
    anchor: 'between',
    blend: 'add',
    lift: 0.003,
    yawToTarget: true,
  },

  /*
    ★★ 0.2.1 追加：夕（op02）的**黑白墨爆**。
    两张图同时播（`COMBAT_FX.ink_gun` 的 `hit` 是数组）：
      · `ink_burst_dark`  **普通混合** —— 加色下纯黑看不见，墨必须单独一层压暗地面；
      · `ink_burst_light` 加色 —— 白墨飞溅 / 水环 / 墨滴反光。
    `lift` 让白高光压在黑墨上面（数值越大越靠近相机）。
  */
  ink_burst_dark: {
    path: 'fx/ink_burst_dark.png',
    frames: 10,
    fps: 24,
    cells: 1,
    anchor: 'ground',
    blend: 'normal',
    lift: 0.001,
  },
  ink_burst_light: {
    path: 'fx/ink_burst_light.png',
    frames: 10,
    fps: 24,
    cells: 1,
    anchor: 'ground',
    blend: 'add',
    lift: 0.004,
  },

  /*
    ★★ 0.2.1 追加：天火（op12）的**单格橙黄爆炸**（普攻）。
    技能那套 3×3 橙红大爆炸不在这张表里 —— 它是 `splash.fx` → `BLOOM_FX.skyfire_nova`。
  */
  fire_burst_orange: {
    path: 'fx/fire_burst_orange.png',
    frames: 10,
    fps: 24,
    cells: 1,
    anchor: 'ground',
    blend: 'add',
    lift: 0.004,
  },

  // ---- ★ 0.3.2 阿米娅·青色怒火：黑墨斩击 + 青色刃口（普攻与技能共用这套刀）----
  /*
    【三色的分工（用户要求"明确每种颜色的呈现方式与整体协调"）】
    同一条刀的形状被按 alpha 浓度切成**嵌套的三档**（出图脚本
    `scripts/fx-recolor.py --by=alpha`），所以三色天生协调、互不打架：
      · 黑 —— `amiya_cyan_ink`：刀身主体，**普通混合**的墨（加色下纯黑不可见），
        铺面给"这一刀的重量"；受击痕也是黑的（`melee-hit-fx.ts` 的墨样式）。
      · 青 —— `amiya_cyan_edge`：刃口轮廓，加色，只落在刀形最浓的那一线，
        负责让黑刃在暗棋盘上"看得见边缘"，同时是划过后的残光。
      · 红 —— `amiya_cyan_spark`：命中爆点，加色，**只落在被打的人身上**
        （锚点 ground，和青刃错开位置 ⇒ 不会被加色混成白色），
        是"怒火点燃"的那一下 —— 面积最小、亮度最高，只做点睛。
    普攻 = 黑 + 青（`COMBAT_FX.amiya_cyan_slash`）；技能 = 黑 + 青 + 红
    （`SKILL_FX.amiya_cyan_fury`：起手墨爆 + 每一刀 + 红色命中爆点）。
  */
  amiya_cyan_ink: {
    path: 'fx/amiya_cyan_ink.png',
    frames: 8,
    fps: 30,
    cells: 1.5,
    padCells: 0.6,
    anchor: 'between',
    // ★ 黑墨必须普通混合 —— 这一条是整套特效成立的前提
    blend: 'normal',
    // 墨层压最低（0.002），青刃抬高一档画在墨上面
    lift: 0.002,
    yawToTarget: true,
  },
  amiya_cyan_edge: {
    path: 'fx/amiya_cyan_edge.png',
    frames: 8,
    fps: 30,
    cells: 1.5,
    padCells: 0.6,
    anchor: 'between',
    blend: 'add',
    lift: 0.005,
    yawToTarget: true,
  },
  amiya_cyan_spark: {
    path: 'fx/amiya_cyan_spark.png',
    frames: 6,
    fps: 30,
    cells: 1,
    anchor: 'ground',
    blend: 'add',
    lift: 0.004,
  },
  // 起手（施法那一刻）：黑墨腾起（复用夕的墨爆）+ 青色墨光 + 红火星
  amiya_cyan_cast_cyan: {
    path: 'fx/amiya_cyan_cast_cyan.png',
    frames: 10,
    fps: 24,
    cells: 1,
    anchor: 'ground',
    blend: 'add',
    lift: 0.004,
  },
  amiya_cyan_cast_ember: {
    path: 'fx/amiya_cyan_cast_ember.png',
    frames: 10,
    fps: 24,
    cells: 1,
    anchor: 'ground',
    blend: 'add',
    lift: 0.005,
  },
};

/**
 * ★★ **普攻绑定**：数据表 `UnitDef.combatFx` 写的字符串 → 这一枪的三张图。
 *
 * `muzzle` 挂在**开枪的人**身上（朝目标推出一点），`hit` / `heavy` 挂在**被打的那一格**。
 * `heavy` = 击杀那一下（比普通命中大一档），由 `damage` 事件的 `lethal` 判定。
 *
 * ★ 0.2.1：`hit` / `heavy` 可以是**一层，也可以是多层** ——
 *   炮手的命中同时要播"爆炸（加色）+ 烟（普通）"两层，一个 id 装不下。
 */
export interface CombatFxBinding {
  muzzle?: string;
  /** 命中层（一次可以播好几层：炮手 = 烟 + 爆炸） */
  hit?: string | string[];
  heavy?: string | string[];
}

/** 把绑定里的"一层 / 多层"统一成数组（唯一归一化处） */
export function combatFxIdsOf(value: string | string[] | undefined): string[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

export const COMBAT_FX: Record<string, CombatFxBinding> = {
  angel_gun: { muzzle: 'angel_muzzle', hit: 'angel_hit', heavy: 'angel_hit_heavy' },
  /*
    炮手：没有枪口火光（炮弹自己的弹头光就够）——
    命中先铺烟、再叠爆炸；爆炸的 `lift` 更高，所以画在烟上面。
  */
  cannon_gun_yellow: { hit: ['cannon_smoke_yellow', 'cannon_blast_yellow'] },
  cannon_gun_red: { hit: ['cannon_smoke_red', 'cannon_blast_red'] },
  cannon_gun_gray: { hit: ['cannon_smoke_gray', 'cannon_blast_gray'] },

  /*
    ★★ 0.2.1 追加（用户口径）：
      · `melee_slash` —— **通用近战**：一条中性银白斩击，十几个近战干员共用；
      · `ink_gun`     —— 夕（op02）普攻：黑色墨团（普通混合）+ 白墨飞溅（加色）两层；
      · `skyfire_gun` —— 天火（op12）普攻：单格橙黄爆炸。
  */
  melee_slash: { hit: 'slash_single' },
  melee_slash_red: { hit: 'slash_red' },
  melee_slash_gold: { hit: 'slash_gold' },
  ink_gun: { hit: ['ink_burst_dark', 'ink_burst_light'] },
  skyfire_gun: { hit: 'fire_burst_orange' },
  /*
    ★ 0.3.2 阿米娅·青色怒火（普攻）：黑墨刃 + 青色刃口两层。
    受击痕自动跟着变黑 —— `melee-hit-fx.ts` 的 `MELEE_SLASH_STYLES.amiya_cyan_ink`。
  */
  amiya_cyan_slash: { hit: ['amiya_cyan_ink', 'amiya_cyan_edge'] },
};

/**
 * ★★ **技能绑定**：数据表 `SkillDef.castFx`（或 3 星变体的 `castFx`）写的字符串
 * → 这一次施法要播哪几张图。
 *
 *   · `self`        —— 挂在施法者脚下（瞬移、起手光环）
 *   · `target`      —— 挂在**离她最近的敌人**脚下（大范围斩击的主要落点）
 *   · `attack`      —— 技能**生效期间**的每一次普攻（内核 `attack` 事件）用这几张，
 *                      不用单位自己的 `combatFx`。持续多久由技能数据算。
 *   · `attackFirst` —— 只挂在技能生效**第一次**普攻上的（陈的四连斩残痕：
 *                      "开技能后第一刀"才该出现，不能在施法时对着空气放）。
 *   · `castOnce`    —— 只放一次的（能天使的爆燃首枪），和 `self` 的区别是它会跟着"朝向"走。
 *   · `loop`        —— 循环层（玛恩纳的金色小雨滴），活到技能结束；
 *                      `cells: 'range'` = 铺满这个干员的**攻击范围**（射程 ×2+1 格）。
 */
export interface SkillFxBinding {
  self?: string[];
  target?: string[];
  attack?: string[];
  attackFirst?: string[];
  castOnce?: string[];
  loop?: Array<{ id: string; cells?: number | 'range' }>;
}

export const SKILL_FX: Record<string, SkillFxBinding> = {
  /*
    ★ 陈：施法那一刻只有"瞬移裂隙"（人从原地消失）；
    **连斩的残痕与每一刀都跟着"她真的砍出去"的那一刻走**（用户口径：
    "5 连斩特效应该是开启技能后下一个攻击的时候展现，而不是开技能的时候"）。
  */
  chen_s3: {
    self: ['chen_s3_blink'],
    attackFirst: ['chen_s3_combo'],
    attack: ['chen_s3_slash', 'chen_s3_hit'],
  },
  mlynar_s3: {
    self: ['mlynar_s3_cast'],
    /*
      ★ 0.2.1 改（用户口径）：**大斩击 + 命中都要"每次攻击都触发"**，
      而且摆在"他和目标的中间"。所以两组都挂到 `attack`（施法那一刻不再放斩击 ——
      那时还没砍人，放出来就是对着空气挥刀）。
    */
    attack: ['mlynar_s3_slash', 'mlynar_s3_hit'],
    // 小雨滴铺满"他能砍到的所有格子"（射程 3 ⇒ 7×7）
    loop: [{ id: 'mlynar_s3_rain', cells: 'range' }],
  },
  angel_overdrive: { castOnce: ['angel_muzzle_flare'] },
  /*
    ★ 0.2.1 菲亚梅塔「轰击」：施法那一刻只有**卡面火柱**。
    落点那套 5×5 凤凰**不挂这里** —— 它是 `splash.fx` → `bloom` 事件，
    每一次技能期间攻击都会在目标格炸一次（不是开技能时炸一次）。
  */
  fiammetta_barrage: { self: ['fiammetta_cast'] },
  /*
    ★ 0.3.2 阿米娅·青色怒火「青色怒火」（用户口径：技能特效 = 青 + 红 + 黑混合）：
      · `self`   —— 施法那一刻，脚下墨爆三层：
        黑 = 夕的墨爆（`ink_burst_dark`，普通混合，"怒火从脚下腾起"）；
        青 = 墨光勾边（`amiya_cyan_cast_cyan`）；红 = 火星（`amiya_cyan_cast_ember`，最素的一层）。
      · `attack` —— 技能生效期每一刀换三色套：黑刃 + 青刃口 + **红色命中爆点**（落点在被打的人身上）。
        技能结束后自动换回普攻的黑+青（`COMBAT_FX.amiya_cyan_slash`），红只在技能里出现。
  */
  amiya_cyan_fury: {
    self: ['ink_burst_dark', 'amiya_cyan_cast_cyan', 'amiya_cyan_cast_ember'],
    attack: ['amiya_cyan_ink', 'amiya_cyan_edge', 'amiya_cyan_spark'],
  },
};

// ============================================================
//  贴图（共享原图 + 每实例帧指针 + 池子）
// ============================================================

const baseTextureCache = new Map<string, Texture>();
const requested = new Set<string>();
const idleTextures = new Map<string, Texture[]>();
const MAX_IDLE_PER_LAYER = 2;

function textureFromImage(image: HTMLImageElement): Texture {
  const texture = new Texture(image);
  // ★ 不写色彩空间颜色会被冲淡（同 slash-fx / unit-aura / vishdal-bloom 的说明）
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}

function baseTextureOf(spec: SeqFxSpec): Texture | null {
  const cached = baseTextureCache.get(spec.path);
  if (cached) return cached;
  const image = getLoadedImage(spec.path);
  if (!image) {
    // 还没加载好就别硬等：加载完的那一帧自然接上（这函数在渲染循环里）
    if (!requested.has(spec.path)) {
      requested.add(spec.path);
      void loadImage(spec.path).then((loaded) => {
        if (loaded) baseTextureCache.set(spec.path, textureFromImage(loaded));
      });
    }
    return null;
  }
  const texture = textureFromImage(image);
  baseTextureCache.set(spec.path, texture);
  return texture;
}

function acquireTexture(spec: SeqFxSpec, base: Texture): Texture {
  const reused = idleTextures.get(spec.path)?.pop();
  if (reused) {
    reused.offset.set(0, 0);
    return reused;
  }
  const texture = base.clone();
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.repeat.set(1 / spec.frames, 1);
  texture.offset.set(0, 0);
  return texture;
}

function releaseTexture(path: string, texture: Texture): void {
  const pool = idleTextures.get(path) ?? [];
  if (pool.length >= MAX_IDLE_PER_LAYER) {
    texture.dispose();
    return;
  }
  pool.push(texture);
  idleTextures.set(path, pool);
}

/**
 * 让所有特效图**提前开始下载**。
 * 开局调一次：四套图合计约 8 MB，等第一枪打响才下就来不及了（会看到"开了技能什么都不放"）。
 */
export function preloadSeqFxTextures(): void {
  for (const spec of Object.values(SEQ_FX)) void loadImage(spec.path);
}

// ============================================================
//  纯函数：时间 → 帧号 / 透明度（可单测，不碰 three）
// ============================================================

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** 这一秒该播第几帧（循环的回绕，非循环的停在最后一帧） */
export function seqFrameAt(elapsed: number, spec: { frames: number; fps: number; loop?: boolean }): number {
  const frames = Math.max(1, spec.frames);
  const step = Math.floor(Math.max(0, elapsed) * Math.max(1, spec.fps));
  if (spec.loop) return step % frames;
  return Math.min(frames - 1, step);
}

/** 整段播完要多久（循环层由 `life` 决定，这里只给"播一遍"） */
export function seqDurationOf(spec: { frames: number; fps: number }): number {
  return Math.max(1, spec.frames) / Math.max(1, spec.fps);
}

/** 整体透明度：最后 `SEQ_FX_TAIL_SECONDS` 收尾，其余全程 1 */
export function seqOpacityAt(elapsed: number, life: number): number {
  const tail = SEQ_FX_TAIL_SECONDS;
  if (!(life > 0)) return 1;
  const left = life - elapsed;
  if (left >= tail) return 1;
  return Math.max(0, clamp01(left / tail));
}

// ============================================================
//  实例
// ============================================================

export interface SeqFxInstance {
  /** 注册表里的 id（排查用） */
  id: string;
  spec: SeqFxSpec;
  holder: Group;
  /** 贴地的是 Mesh，挂胸口的是 Sprite */
  object: Mesh | Sprite;
  material: MeshBasicMaterial | SpriteMaterial;
  geometry: PlaneGeometry | null;
  texture: Texture;
  elapsed: number;
  life: number;
  /** 跟着谁走（unitId）；null = 钉在出生点 */
  followUnitId: number | null;
}

/** 世界坐标落点 */
export interface SeqFxPoint {
  x: number;
  z: number;
}

export interface SeqFxSpawnOptions {
  /** 施法者/攻击者所在的位置 */
  self: SeqFxPoint;
  /**
   * 目标位置。三种锚点各自怎么用它：
   *   · `ground`  —— **有目标就落在目标格**（斩击打在被打的人身上），没有才退回自己脚下
   *   · `muzzle`  —— 用它算朝向（从自己朝目标推出一点）
   *   · `between` —— 用它算中点与大小（摆在两者之间）
   */
  target?: SeqFxPoint;
  /** 活多久（秒）；不写 = 播一遍（循环层必须给） */
  life?: number;
  /** 左右镜像（同一张图连着闪好几次时，交替镜像才不像"复制粘贴"） */
  flipX?: boolean;
  /**
   * ★ 覆盖"占几格"（不写 = 用注册表里的 `cells`）。
   * 用在需要按局面缩放的层：玛恩纳的小雨滴要铺满他的攻击范围（射程 ×2+1 格）。
   */
  cells?: number;
  /**
   * ★★ 跟着某个棋子走（填 `unitId`）。
   * 玛恩纳的小雨滴是"他身上一直在下的雨"，他要走位 ⇒ 雨也得跟着走，
   * 否则人走开了、雨还留在原地，看着像另一个人的技能。
   * 具体的"每帧取位置"由 `replay.ts` 做（模块本身不认识棋子）。
   */
  follow?: number;
}

/** 两人中点（`between` 锚点用；纯函数，可测） */
export function seqBetweenPoint(a: SeqFxPoint, b: SeqFxPoint): { x: number; z: number } {
  return { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
}

/**
 * `between` 锚点该多大（世界单位）：**两人距离 + 边距一格**。
 * 于是"从他那头一直盖到敌人那头"，距离多远都不会脱节（用户口径）。
 */
export function seqBetweenSize(a: SeqFxPoint, b: SeqFxPoint, paddingCells: number): number {
  return Math.hypot(b.x - a.x, b.z - a.z) + paddingCells * CELL;
}

/** 一个干员的"攻击范围"占几格（射程 3 ⇒ 7×7）—— 循环层（玛恩纳小雨滴）按它铺 */
export function seqRangeCells(range: number): number {
  return Math.max(1, Math.round(range)) * 2 + 1;
}

function spawnPointOf(spec: SeqFxSpec, opts: SeqFxSpawnOptions): { x: number; z: number } {
  if (spec.anchor === 'between' && opts.target) return seqBetweenPoint(opts.self, opts.target);
  if (spec.anchor === 'muzzle') return opts.self;
  // ★ 贴地层：**有目标就落在目标格**（"砍在谁身上"是物理事实，不该由调用方各写一遍）
  return opts.target ?? opts.self;
}

/**
 * 播一次。
 *
 * @returns 图还没加载好（或 id 不存在）时返回 null —— 调用方直接跳过，
 *          下一次事件自然接上；**绝不抛错**（特效缺失不该让整场战斗挂掉）。
 */
export function spawnSeqFx(id: string, opts: SeqFxSpawnOptions): SeqFxInstance | null {
  const spec = SEQ_FX[id];
  if (!spec) return null;
  const base = baseTextureOf(spec);
  if (!base) return null;

  const texture = acquireTexture(spec, base);
  const holder = new Group();
  const point = spawnPointOf(spec, opts);
  /*
    尺寸：默认 `cells` 格；`cells` 覆盖优先。
    ★ `between`（玛恩纳那一下砍击）按"两人距离 + 自身一格边距"算 ——
      所以它永远是"从他那头一直盖到敌人那头"，距离多远都不会脱节。
  */
  let size = (opts.cells && opts.cells > 0 ? opts.cells : spec.cells) * CELL;
  if (spec.anchor === 'between' && opts.target) {
    // ★ 边距用 `padCells`（不写才退回 `cells`）：`cells` 是图的物理尺寸，不是构图边距
    size = seqBetweenSize(opts.self, opts.target, spec.padCells ?? spec.cells);
  }

  let object: Mesh | Sprite;
  let material: MeshBasicMaterial | SpriteMaterial;
  let geometry: PlaneGeometry | null = null;

  if (spec.anchor === 'muzzle') {
    // 挂人身上的：永远正对镜头（Sprite），否则俯视 45° 时会变成一条线
    let { x, z } = opts.self;
    const toward = opts.target;
    if (toward) {
      const dx = toward.x - x;
      const dz = toward.z - z;
      const len = Math.hypot(dx, dz) || 1;
      const off = SEQ_FX_MUZZLE_OFFSET_CELLS * CELL;
      x += (dx / len) * off;
      z += (dz / len) * off;
    }
    material = new SpriteMaterial({
      map: texture,
      transparent: true,
      opacity: 1,
      blending: spec.blend === 'add' ? AdditiveBlending : NormalBlending,
      depthWrite: false,
    });
    const sprite = new Sprite(material);
    sprite.scale.set(size, size, 1);
    sprite.position.set(x, SEQ_FX_CHEST_Y, z);
    sprite.renderOrder = RENDER_ORDER_FX;
    // ★ Sprite 不能负 scale（见 memory 的铁律）⇒ 镜像只给贴地那层做
    object = sprite;
    holder.add(sprite);
  } else {
    geometry = new PlaneGeometry(size, size);
    material = new MeshBasicMaterial({
      map: texture,
      transparent: true,
      opacity: 1,
      blending: spec.blend === 'add' ? AdditiveBlending : NormalBlending,
      side: DoubleSide,
      depthWrite: false,
    });
    const mesh = new Mesh(geometry, material);
    // PlaneGeometry 在 XY 平面上，转 -90° 才是贴地
    mesh.rotation.x = -Math.PI / 2;
    /*
      ★ 0.2.1：`yawToTarget` 的层不吃 `flipX` —— 镜像会把刀头翻到反方向
      （整刀变成"倒着砍"），旋转本身已经按每人每刀的正确朝向算了。
    */
    if (opts.flipX && !spec.yawToTarget) mesh.scale.x = -1;
    mesh.position.set(0, (spec.lift ?? 0) + SEQ_FX_GROUND_Y, 0);
    // ★ 棋子精灵全是 depthWrite:false ⇒ 只认 renderOrder（见 card-layout 的 RENDER_ORDER_FX）
    mesh.renderOrder = RENDER_ORDER_FX;
    holder.add(mesh);
    object = mesh;
  }

  /*
    ★ 0.2.1：定向层（通用斩击）—— 把贴图的 +X 转到"我方 → 目标"的方向。
    旋转放在 **holder** 上（网格自己的 `rotation.x` 是"贴地"那一下，不能混）。
    ★ 数学：绕 Y 转 θ 后局部 +X → (cosθ, 0, -sinθ)，令它等于方向 (dx,dz)/len
      ⇒ θ = atan2(-dz, dx)。
  */
  if (spec.yawToTarget && spec.anchor !== 'muzzle' && opts.target) {
    const dx = opts.target.x - opts.self.x;
    const dz = opts.target.z - opts.self.z;
    if (dx * dx + dz * dz > 1e-6) holder.rotation.y = Math.atan2(-dz, dx);
  }

  /*
    ★ 贴地的：holder 摆在那一格，网格在本地原点（方便以后整体挪/缩放）。
    ★ 枪口那种：精灵自己带**绝对坐标**（要按"朝向目标"从人身上推出去），
      holder 必须留在原点 —— 否则"holder 摆到落点 + 精灵摆到绝对坐标"会**偏移两次**。
  */
  if (spec.anchor === 'muzzle') holder.position.set(0, 0, 0);
  else holder.position.set(point.x, 0, point.z);
  // ★ 名字纯粹为了排查（`?debug` 页面/浏览器控制台能一眼看出场上在播什么）
  holder.name = `seqfx:${id}`;

  return {
    id,
    spec,
    holder,
    object,
    material,
    geometry,
    texture,
    elapsed: 0,
    life: opts.life ?? Math.max(seqDurationOf(spec), 0.05),
    followUnitId: opts.follow ?? null,
  };
}

/** 每帧推进：把这一帧的帧号与透明度写上去；返回 false = 该回收了 */
export function updateSeqFx(instance: SeqFxInstance, deltaSeconds: number): boolean {
  instance.elapsed += deltaSeconds;
  if (instance.elapsed >= instance.life) return false;
  const frame = seqFrameAt(instance.elapsed, instance.spec);
  const offset = frame / Math.max(1, instance.spec.frames);
  if (instance.texture.offset.x !== offset) instance.texture.offset.x = offset;
  instance.material.opacity = seqOpacityAt(instance.elapsed, instance.life);
  return true;
}

/** 从场景里摘掉并还回帧指针（共享原图不能 dispose） */
export function disposeSeqFx(instance: SeqFxInstance): void {
  instance.holder.parent?.remove(instance.holder);
  instance.geometry?.dispose();
  instance.material.dispose();
  releaseTexture(instance.spec.path, instance.texture);
  instance.holder.clear();
}

/** 给测试/排查用：某个 id 的图 URL（相对 assets） */
export function seqFxPathOf(id: string): string | null {
  return SEQ_FX[id]?.path ?? null;
}

/** 当前有没有任何一层是循环的（测试用来钉"小雨滴必须写到 loop"） */
export function isLoopingSeqFx(id: string): boolean {
  return SEQ_FX[id]?.loop === true;
}

/** 便于外部把实例挂进自己的组（当前不用，保留接口对称性） */
export type SeqFxObject = Object3D;
