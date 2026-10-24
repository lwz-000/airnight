import {
  CircleGeometry,
  BufferGeometry,
  DoubleSide,
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
  Sprite,
  SpriteMaterial,
  Vector3,
  type Camera,
} from 'three';
import {
  ATTACK_SPEED_DEFAULT,
  BOARD_H,
  BOARD_W,
  FIX,
  MANA_MAX,
  MOVE_COOLDOWN_TICKS,
  TICKS_PER_SECOND,
  collectMods,
  effectiveArmor,
  effectiveAttackDamage,
  effectiveAttackSpeed,
  effectiveMagicResist,
  effectiveRange,
  hasActiveSkill,
  skillVariantOf,
  withinShape,
  type ActiveEffect,
  type BattleResult,
  type BattleState,
  type BattleStatsSample,
  type SplashShape,
  type UnitDef,
  type UnitDefTable,
} from '../../../../packages/shared/src/index.js';
import { CELL, cellToWorldFlipped } from './board.js';
import { createFxLayer } from './fx-layer.js';
import { effectsAt, groupStatsTimeline, panelStatsAt } from './stats-timeline.js';
import { advanceStepProgress, stepSecondsFor, walkEase, walkPose } from './walk-anim.js';
import {
  attackAnimSpeed,
  attackIntervalSeconds,
  createSwingTiming,
  noteHit,
  skillAnimSpeed,
  smoothSpeed,
  stepSwing,
  type SwingTiming,
} from './attack-anim.js';
import { CARD_CENTER_Y, CARD_WORLD_SCALE } from './card-layout.js';
import {
  ARC_INNER_RATIO,
  ARC_SPAN_RADIANS,
  BASE_ARC_RADIUS,
  BASE_BURST_RADIUS,
  BASE_RING_RADIUS,
  FX_BURST_COLOR,
  FX_GLOW_COLORS,
  FX_TEAM_COLORS,
  MAX_LIVE_ATTACK_FX,
  RANGED_ATTACK_FROM,
  arcScaleAt,
  arcSweepAt,
  attackFxPresetFor,
  burstScaleAt,
  fxOpacityAt,
  ringScaleAt,
} from './attack-fx.js';
import {
  chibiAnimSeconds,
  detachChibi,
  hasChibiAnim,
  pickMode,
  setChibiLean,
  setChibiDowned,
  setChibiPhase,
  setChibiDizzy,
  setChibiSource,
  stunWobbleLean,
  updateChibi,
} from './chibi.js';
import {
  createUnitSprite,
  getSpriteMeta,
  NO_EFFECTS,
  setUnitItemDots,
  setUnitSkillBar,
  updateUnitSprite,
  type UnitEffectFlags,
} from './sprite-graphics.js';
import {
  AURA_REBIRTH_MIN_RATIO,
  auraWorldSize,
  createAuraSprite,
  updateAuraSprite,
} from './unit-aura.js';
import {
  MAX_LIVE_SLASH_FX,
  createSlashFx,
  disposeSlashFx,
  slashFlashScaleAt,
  slashOpacityAt,
  slashScaleAt,
  type SlashFx,
} from './slash-fx.js';
/*
  ★★ 0.2.1：通用的「技能释放」特效（所有主动技能共用）。
  只在这一层"把它摆上去 / 每帧推进 / 到期回收"，形状与尺寸全在 skill-cast-fx.ts 里。
*/
import {
  SKILL_CAST_END_SECONDS,
  SKILL_CAST_MAX_LIVE,
  applySkillCastFrame,
  createSkillCastVisual,
  disposeSkillCastVisual,
  skillCastFrameAt,
  skillCastSustainSecondsOf,
  skillCastTotalSeconds,
  type SkillCastVisual,
} from './skill-cast-fx.js';
import {
  MAX_LIVE_NOTE_FX,
  NOTE_FX_SECONDS,
  NOTE_FX_WORLD_SIZE,
  createNoteSprite,
  isNoteFx,
  noteOpacityAt,
  notePathAt,
  noteScaleAt,
} from './note-fx.js';
import {
  attachHealHaloRoot,
  clearHealHaloFx,
  spawnHealHalo,
  updateHealHaloFx,
} from './heal-halo-fx.js';
/*
  ★★ 0.2.2：蕾缪安 3 星「强制追思」的锁定演出 ——
  地块上的狙击镜 + 向内收缩的粉色光环 + 引爆时的粉色/金色爆炸。
  判据只看事件里带的 `fx` 字符串，渲染层不认干员编号。
*/
import {
  attachLockOnRoot,
  clearLockOnFx,
  spawnLockOnBurst,
  spawnLockOnMark,
  updateLockOnFx,
} from './lockon-fx.js';
/*
  ★★ 0.2.2：近战命中时**挨打者身上**的那道斩击痕（颜色跟着这一下的斩击走）。
  唯一入口是下面的 `spawnMeleeHit` —— 所有近战来源（普攻 / 技能期普攻 / 额外目标）
  都必须走它，否则就会出现"某类攻击没有受击特效"或者"颜色和刀光不一样"。
*/
/*
  ★★ 0.2.2：陈「赤霄」—— 覆盖前方 3 格的剑光（程序化贴地长条，不是序列帧）。
  判据只看数据里的 `castFx: 'chen_thrust'`。
*/
import {
  attachChenThrustRoot,
  clearChenThrustFx,
  isChenThrustFx,
  spawnChenThrust,
  updateChenThrustFx,
} from './chen-thrust-fx.js';
import {
  MELEE_HIT_OFFSET,
  attachMeleeHitRoot,
  clearMeleeHitFx,
  isMeleeAttack,
  meleeHitJitterOf,
  meleeHitLiveCount,
  meleeHitStyleOf,
  meleeHitTiltOf,
  spawnMeleeHit,
  updateMeleeHitFx,
  type MeleeSlashStyle,
} from './melee-hit-fx.js';
/*
  ★ 0.2.1：迷迭香的「战术装置砸击」（普攻专属演出）。
  和音符同一套结构（Sprite 沿轨迹飞），但轨迹是**从目标正上方直落 + 末段加速**。
*/
import {
  MAX_LIVE_ROSMON_SLAM,
  ROSMON_SLAM_FX,
  ROSMON_SLAM_SECONDS,
  SLAM_BLAST_CELLS,
  SLAM_BLAST_FX,
  SLAM_END_Y,
  SLAM_SMOKE_CELLS,
  SLAM_SMOKE_FX,
  createSlamSprite,
  preloadRosmonGear,
  shouldSpawnSlam,
  slamOpacityAt,
  slamPathAt,
  slamScaleAt,
  slamSpinAt,
  slamWorldSize,
  type SlamView,
} from './rosmon-slam-fx.js';
/*
  ★★ 0.2.1：外部美术交的**序列帧特效**（能天使的枪口/命中、陈的赤色连斩、
  玛恩纳的金色斩击/小雨滴）。这一层只做三件事：按事件点名 → 摆到位置 → 每帧推进/回收；
  图怎么播、占几格、贴哪儿全在 `sequence-fx.ts` 的注册表里。
*/
import {
  COMBAT_FX,
  SEQ_FX_MAX_LIVE,
  SKILL_FX,
  combatFxIdsOf,
  disposeSeqFx,
  seqRangeCells,
  spawnSeqFx,
  updateSeqFx,
  type SeqFxInstance,
} from './sequence-fx.js';
/*
  ★ 0.2.1：隐德来希（op40）的「血镰」—— 连续旋转的东西不做序列帧，
  用 canvas 画弯刃/血泊再每帧转（`.fx-proposal/leto-scythe.html` 的 3D 版）。
*/
import {
  createBoltTracer,
  disposeBoltTracer,
  isTracerFx,
  updateBoltTracer,
  TRACER_FX,
  MAX_LIVE_BOLT_TRACERS,
  type BoltTracer,
} from './bolt-tracer-fx.js';
/*
  ★★ 0.2.1：「统一命中时刻」（用户口径 · 方案 A）。
  「出手 → 命中」的延迟和"哪条结算属于哪一发"的配对**全在这个模块里** ——
  血条 / 闪白 / 程序化爆点 / 命中贴图 / 闪避 / 致死 都读同一个数，
  否则就是"敌人还没挨打，血先掉了"（5 个炮手 + 8 个子弹手全部中招）。
*/
import { IMPACT_MIN_DELAY_SECONDS, ImpactQueue, projectileFlightSeconds } from './hit-timing.js';
/*
  ★★ 0.2.1：羁绊级「全场扫射」（拉特兰齐射）。
  排布是**纯函数**（`planVolleyShots`，可以在 Node 里测），
  子弹本身还是走 `bolt-tracer-fx` 的那一套 —— 这里只管排队与回收。
*/
import {
  BOARD_VOLLEY,
  MAX_LIVE_VOLLEY_TRACERS,
  planVolleyShots,
  type BoardVolleyBoard,
} from './board-volley-fx.js';
import {
  attachLetoScytheRoot,
  clearLetoScytheFx,
  letoScytheModeOf,
  spawnLetoAura,
  spawnLetoSweep,
  updateLetoScytheFx,
} from './leto-scythe-fx.js';
/*
  ★★ 0.3.2：阿米娅两套升变形态的技能特效（表格式/氛围式/即死叠加，全程序化）。
  判据只看事件里带的 `fx` 字符串 —— 渲染层不认干员编号，也不猜"这是谁的技能"。
*/
import {
  attachAmiyaFormFxRoot,
  clearAmiyaFormFx,
  isExecuteFx,
  isRequiemFx,
  isVerdictFx,
  spawnExecuteShard,
  spawnRequiemAmbient,
  spawnVerdictGrid,
  updateAmiyaFormFx,
} from './amiya-form-fx.js';
import { skillBarOf } from './skill-bar.js';
import {
  MAX_LIVE_BLOOM_FX,
  applyBloomFrame,
  createBloomFx,
  disposeBloomFx,
  type BloomFx,
} from './vishdal-bloom.js';

/**
 * ============================================================
 *  战斗播放器：把一串战斗事件变成动画
 * ============================================================
 *
 * 【这是本项目最核心的架构优势的落地】
 *
 * 战斗内核产出的不是「当前画面」，而是一串带时间戳的事件：
 *   [t=0] 登场  #1001 铁壁骑士 @(3,2)
 *   [t=24] 技能  #1001 释放【坚壁】
 *   [t=51] 伤害  #1004 -> #1001 -63.0
 *   [t=51] 阵亡  #1001
 *   ...
 *
 * 播放器的工作就是：随着时间推移，把这些事件一条条「演」出来。
 * 因为事件本身就是完整答案，所以这个播放器天然支持：
 *   · 暂停 / 变速 / 快进
 *   · 从头重播（录像回放）
 *   · 拖到任意时间点（把之前的事件快速过一遍即可）
 * 完全不需要额外写任何同步逻辑。
 */

/** 一个棋子在画面上需要的全部信息 */
interface UnitVisual {
  sprite: Sprite;
  /** ★ 0.1.3：金色光华（无敌 / 重生过渡）那一层 */
  aura: Sprite;
  /** ★ 0.1.3：这层光已经亮了多久（秒）—— 重生过渡拿它算"由暗到亮"的进度 */
  auraElapsed: number;
  unitId: number;
  team: 0 | 1;
  defId: string;
  star: number;
  /** 逻辑位置（格子） */
  logicalCell: { col: number; row: number };
  /** 视觉位置（世界坐标，会平滑追向 logicalCell） */
  visualPosition: Vector3;
  /** 上一次移动的起点，用于插值 */
  moveFrom: Vector3;
  moveTo: Vector3;
  /** 移动插值进度 0..1 */
  moveProgress: number;
  /**
   * 这次位移要滑多久（秒）。
   *
   * 走路 = 一个内核移动周期（`MOVE_COOLDOWN_TICKS / TICKS_PER_SECOND` = 0.4 秒），
   * 于是连续走格时"上一格刚滑到、下一格刚好开始"，拼成一段匀速的行进。
   * 强制位移（瞬移 / 击退）= 原来那套 0.18 秒的快速归位，表现不变。
   */
  stepSeconds: number;
  /**
   * ★ 0.0.3：这一帧是不是在**走路**（区别于被技能挪走）。
   *
   * 只有走路才播走路动作 / 程序化走姿；瞬移、击退不算（用户要求瞬移别改）。
   */
  moving: boolean;
  /** 走路方向（列、行的符号），程序化走姿的倾斜方向用它 */
  walkDir: { x: number; y: number };
  hp: number;
  maxHp: number;
  /**
   * 当前护盾值（**和 hp 一样的内部单位**，1 点血 = FIX）。
   *
   * 【为什么要单独记？】
   * 你要求"有护盾的干员也要能看到护盾数值"。
   * 战斗日志里护盾只有两条线索：
   *   · `shield` 事件带 amount（加了多少）
   *   · `damage` 事件带 absorbed（这一下被护盾吃掉多少）
   * 跟着这两个走就能实时算出还剩多少盾。
   * 护盾到期的判断在 refreshEffects 里（盾没了就把这个数清零，
   * 否则界面上会显示一个"看不见的盾还剩 300"）。
   */
  shield: number;
  /**
   * 当前法力（0..MANA_MAX）。
   *
   * 【为什么要记这个？】
   * 因为你要求"战斗时点开干员能看到技能条（CD / 回复情况）"。
   * 法力条就是技能条：满蓝就放技能，放完清零重新攒。
   * 战斗日志里有 `mana` 事件（每次涨蓝都记一条），跟着走就行。
   */
  mana: number;
  /** 已经放了几次技能（放完的那一瞬间法力清零，界面上显示"冷却中"） */
  castCount: number;
  /**
   * ★ 0.1.3：这个单位已经挥出几刀（给斩击特效当"第几刀"用）。
   *
   * 【为什么要按单位记？】
   * 刀的朝向/长度/张角全靠这个序号错开（见 `slashShapeOf`），
   * 记在单位身上，连斩才会一刀一刀转过去；用全局计数的话
   * 两个锏同时开技能就会互相抢序号，两串刀光会长得一模一样。
   */
  slashSeq: number;
  dead: boolean;
  /**
   * ★ 0.0.3：Boss「倒地等复活」—— 它不是死亡（精灵不移除、格子不释放），
   * 只是躺一会儿再站起来进二阶段。表现上按"播阵亡动作并停在最后一帧"处理。
   */
  downed: boolean;
  /** 死亡动画进度 0..1（1 表示已经完全消失） */
  deathProgress: number;
  /** 受击闪光剩余时间（秒） */
  hitFlash: number;
  /** 攻击前倾剩余时间（秒） */
  lunge: number;
  /** 前倾方向（列、行的符号），由攻击者指向目标 */
  lungeDir: { x: number; y: number };
  /** 技能特效剩余时间（秒） */
  castGlow: number;
  /**
   * ★ 0.0.3 末：攻击/技能动画的节奏（跟着攻速走，见 three/attack-anim.ts）。
   *
   * `swing` > 0 = 正在演攻击动作。它比 `lunge`（0.18 秒的前倾）长得多 ——
   * 整段挥击的时长按**当前攻击间隔**算，并且会在预测的下一次命中前
   * `前摇` 秒起手，这样"命中帧"正好落在掉血的那一 tick 上。
   */
  swing: SwingTiming;
  /**
   * ★ 0.0.3：这一帧**刚刚开始了一次新的挥击**（窗口从 0 被重新排上）。
   *
   * 【为什么要单独记一个布尔？】
   * 连续攻击时挥击窗口首尾相接，`pickMode` 会连着好几秒都返回 'attack'，
   * 而攻击动作是非循环的（播完停在最后一帧）—— 不重头播的话画面就僵住了
   * （用户报的"野怪攻击若干次后动画失效"，根因见 chibi.ts 里那段注释）。
   * 判断"窗口重排"在这里最准：`swing` 只减不加，一旦变大就一定是新的一次。
   */
  swingRestart: boolean;
  /** 技能动作的平滑倍率（技能动作也跟攻速走，但夹得更紧） */
  skillSpeed: number;
  /**
   * 身上的状态（护盾 / 加速 / 加攻 / 眩晕），画在卡面上。
   * 每一项记的是"还剩多少 tick"，到点自动清掉 ——
   * 因为战斗日志只有"什么时候给的"，没有"什么时候结束"，
   * 结束时间要用事件里的 durationTicks 自己算。
   */
  effects: UnitEffectFlags;
  effectExpiry: { shield: number; attackSpeed: number; attackDamage: number; stun: number; evade: number };
}

/** 攻击前倾时长（秒） */
const LUNGE_SECONDS = 0.18;

/** 前倾的最大位移（世界单位）。别给太大，否则会看起来像瞬移 */
const LUNGE_DISTANCE = 0.22;

/** 远程攻击的弹道线存活时长（秒） */
const TRACER_SECONDS = 0.16;

/*
  多远算"远程"（攻击时要画弹道线、特效也要换成"枪口闪光 + 命中爆点"那一套）。
  ★ 阈值只在 `attack-fx.ts` 定义一处，这里 import —— 两处各写一个 2，
    改了一处就会出现"弹道线画了但特效没换"这种对不上的事（见 attack-fx.test.ts 的源码级用例）。
*/

/**
 * 弹道线的高度。
 * 贴着地板上方一点（0.42 是棋子中心高度）—— 太高会穿过棋子，
 * 太低会被地板挡住看不见。
 */
const TRACER_Y = 0.5;

/**
 * 范围框贴地的高度。
 *
 * 【为什么是 0.02 而不是 0？】
 * 因为棋盘的格子贴图也在 y=0 那一层，两条线**完全重合**时会打架
 * （depth test 谁赢看运气），表现为框的边一闪一闪的。
 * 抬高 0.02 就稳定压在地板上面，而且贴得够近，看起来还是"画在地上"。
 */
const ZONE_Y = 0.02;
/** 闪电弹道的高度：棋子卡面中线（0.96 高的一半再略低） */
const BOLT_TRACER_Y = 0.55;
/**
 * ★ 0.2.1：法术流光（`kind === 'flow'`）的最短长度（格）。
 *
 * 流光和子弹不一样 —— 它是"一整条铺满 A→B 的光带"，靠**长度**表达"能量流过去"。
 * 按卡面内缩（两边各 0.36 格）时，贴脸打（相距 1 格）只剩 0.28 格 ⇒
 * 画布只有 18×40 px，柔光糊成一团（真机截图里是一个暗灰圆斑）。
 * 所以内缩量再夹一次：宁可少收一点，也要留出这个长度。
 */
const FLOW_MIN_LENGTH = 0.75;
/**
 * ★ 0.2.1：连击命中特效的**段间延迟**（秒）。
 *
 * 内核的 `multiHit: 3`（维什戴尔 1/2 星）是在**同一 tick** 连报 3 条 attack ——
 * 3 张命中图会在同一帧叠成一张，看起来只有一次。每往后一段延 90 毫秒，
 * 才能看出"连续炸三下"（3 段共 0.18 秒，比一次普通攻击间隔还短，不会拖）。
 */
const COMBO_HIT_STAGGER_SECONDS = 0.09;

/**
 * 治疗流光的最小间隔（秒）。
 *
 * 持续治疗（`healOverTime`）每跳都会报一条 `heal`（0.2 秒一跳、甚至每 tick 一条），
 * 不拦的话屏幕上会同时出现十几条绿色光带，看起来像"整个棋盘在漏水"。
 * 0.25 秒 = 每秒最多 4 条，正好跟得上"一次攻击奶一口"的节奏。
 */
const HEAL_FX_MIN_INTERVAL_SECONDS = 0.25;

/** 一个格子矩形（格子坐标；格子 (c,w) 的正方形是 [c-0.5,c+0.5] × [w-0.5,w+0.5]） */
export interface CellRect {
  c0: number;
  w0: number;
  c1: number;
  w1: number;
}

/**
 * ★★ 0.2：把一条 `zone` 事件翻译成"要画出来的那些矩形"（格子坐标）。
 *
 * 【为什么不直接在 spawnZone 里画？】这段全是纯几何，抽出来才能**单测**
 * （测"陈的直线框住的格子 == 内核真正打到的格子"，不用起 three.js 场景）。
 *
 * 【四种形状分别画成什么？】
 *   · `square`  —— 一个 (2r+1)² 的大方块（周围 9 格 / 25 格）
 *   · `cross`   —— 十字（"周围 4 格"）：横条 + 竖条，**不能**画成 3×3 方块，
 *                  否则就是把"只打 4 格"表现成"打 9 格"，玩家会照着错的框摆位
 *   · `line`    —— ★ 0.2：陈的"前方 3 格"。方向是"从施法者（`from`）指向中心格"：
 *                  横/竖时整条画一个长条；**斜着**时逐格画（阶梯状），
 *                  这样"框住的格子"和内核 `withinShape` 真正打到的格子**完全一致**。
 *                  老数据没有 `from` ⇒ 退回方块（和以前一样，不会崩）。
 *   · `star`    —— 只有锏的范围持续伤害用，而它走的是 `slash` 事件（不报 zone），
 *                  所以这里不会收到 `star`；真收到了也按方块画（不会崩）。
 */
export function zoneShapeRects(event: {
  cell: { col: number; row: number };
  radius: number;
  shape: SplashShape;
  from?: { col: number; row: number };
}): CellRect[] {
  const { col, row } = event.cell;
  const r = Math.max(0, event.radius);

  if (event.shape === 'cross') {
    return [
      { c0: col - r - 0.5, w0: row - 0.5, c1: col + r + 0.5, w1: row + 0.5 }, // 横条
      { c0: col - 0.5, w0: row - r - 0.5, c1: col + 0.5, w1: row + r + 0.5 }, // 竖条
    ];
  }

  if (event.shape === 'line' && event.from && r > 0) {
    const sc = Math.sign(col - event.from.col);
    const sr = Math.sign(row - event.from.row);
    if (sc === 0 && sr === 0) return [squareRect(col, row)];
    // 直线上的格子 = 施法者 + 方向 × k（k = 1…r）—— 和 withinShape 的算法一致
    const cells: Array<{ col: number; row: number }> = [];
    for (let k = 1; k <= r; k++) {
      cells.push({ col: event.from.col + sc * k, row: event.from.row + sr * k });
    }
    if (sc === 0 || sr === 0) {
      const cols = cells.map((c) => c.col);
      const rows = cells.map((c) => c.row);
      return [
        {
          c0: Math.min(...cols) - 0.5,
          w0: Math.min(...rows) - 0.5,
          c1: Math.max(...cols) + 0.5,
          w1: Math.max(...rows) + 0.5,
        },
      ];
    }
    return cells.map((c) => squareRect(c.col, c.row));
  }

  return [{ c0: col - r - 0.5, w0: row - r - 0.5, c1: col + r + 0.5, w1: row + r + 0.5 }];
}

/** 单个格子的正方形 */
function squareRect(col: number, row: number): CellRect {
  return { c0: col - 0.5, w0: row - 0.5, c1: col + 0.5, w1: row + 0.5 };
}

/**
 * ★★ 0.3.2：把一个范围事件翻成**一格一格的清单**（慈悲愿景的 3×4 方格阵要用）。
 *
 * 【为什么不复用 `zoneShapeRects`？】
 * 那个返回的是"要画几个矩形"，`rect` 在它那里会退化成一个大方块
 * （它没有 rect 分支，只服务白框）。方格阵要的是**每一格**：
 * 12 个独立的方块、各自的三角粒子、外接矩形做爆闪 —— 粒度不一样。
 *
 * 【为什么是遍历整块棋盘 + `withinShape`，而不是自己按 rect 推 12 个格子？】
 * "同一动作只允许一处实现"。自己推一遍就等于把内核的范围判定抄了一份，
 * 以后内核改了矩形量法、或者新增形状，画面就会和真实命中范围对不上
 * —— 而这种错**不会报错**，只会"看起来好像少打了一格"。
 *
 * @returns 每格 + 它离施法者的距离（格子数）——距离只用来决定起亮/熄灭的先后
 */
export function zoneCellsOf(event: {
  cell: { col: number; row: number };
  radius: number;
  shape: SplashShape;
  from?: { col: number; row: number };
}): Array<{ col: number; row: number; order: number }> {
  const from = event.from ?? event.cell;
  const out: Array<{ col: number; row: number; order: number }> = [];
  for (let col = 0; col < BOARD_W; col++) {
    for (let row = 0; row < BOARD_H; row++) {
      if (!withinShape(from, event.cell, { col, row }, event.radius, event.shape, 'orthogonal')) continue;
      out.push({ col, row, order: Math.hypot(col - from.col, row - from.row) });
    }
  }
  return out;
}

/** 死亡动画时长（秒） */
const DEATH_ANIM_SECONDS = 0.45;
/** ★ 0.1.4：一组攻击特效里的一块贴地薄片 */
interface AttackFxPart {
  /** 挂在场景里的壳（弧靠它的 rotation.y 对着打击方向） */
  holder: Group;
  geometry: BufferGeometry;
  material: MeshBasicMaterial;
  /** 用哪条缩放曲线 */
  kind: 'arc' | 'burst' | 'ring';
  /**
   * 出生时的朝向（弧用它当基准，再叠上"扫过去"的角度）。
   * 爆点/环是圆的，值恒为 0。
   */
  baseYaw: number;
  /** 这一块的峰值透明度（弧 1 / 爆点 1 / 冲击环 0.62） */
  opacity: number;
}

/** ★ 0.1.4：一次攻击产生的整组特效（几块薄片共享一个进度） */
type AttackFxEntry = { parts: AttackFxPart[]; duration: number; life: number; alpha: number };

/*
  ★ 0.0.3 末：原来这里有 ATTACK_ANIM_BASE / _MIN / _MAX 三个常量，它们回答的是
  "把这套动作塞进固定的 0.18 秒窗口里要放多快"。现在口径换成
  "整段挥击 = 当前攻击间隔、并在命中前前摇秒起手"，倍率与上下限全部搬到
  `three/attack-anim.ts`（纯函数，能单测，见该文件顶部说明）。
*/

/*
  ★ 0.0.3：走路的全部参数（滑行时长 / 起伏曲线 / 前后倾）搬到了 `three/walk-anim.ts`。
  这里只留一句提醒：**瞬移那 0.18 秒的归位没有动**（见那边的 MOVE_LERP_SECONDS）。
*/

export class BattleReplay {
  readonly root = new Group();

  /**
   * ★★ 0.2.1 **特效层**：所有演出对象（刀光 / 弹道 / 贴图特效 / 飘字 / 范围框 / 光环…）
   * **一律加到这里**，不要直接加进 `root`。
   *
   * 【为什么要有它？】战斗中"点棋子看面板"是往 `root` 打射线，
   * 而特效和棋子原本是兄弟节点、又画在棋子前面 ⇒ 射线先撞特效，面板就点不开了。
   * 这一层的 `raycast()` 返回 false ⇒ **整棵子树都不参与拾取**，特效从此"透明"。
   * 详见 `fx-layer.ts`。
   */
  readonly fxLayer = createFxLayer();

  private defs: UnitDefTable;
  private result: BattleResult | null = null;
  /** 记住战斗的初始状态，往回拖动进度条时要靠它重新摆盘 */
  private lastState: BattleState | null = null;
  private visuals = new Map<number, UnitVisual>();
  /**
   * 正在淡出的远程攻击弹道线。
   *
   * 【为什么要手动管理生命周期？】
   * 每开一枪就新建一条线（几何体 + 材质），如果只在淡出后从场景移除、
   * 不调用 dispose()，显存会一直涨 —— Three.js 不会自动回收。
   * 所以这里明确记着它们，到期就 dispose。
   */
  private tracers: Array<{
    line: Line;
    material: LineBasicMaterial;
    geometry: BufferGeometry;
    life: number;
  }> = [];
  /**
   * ★ 0.1.4：正在播的攻击特效。
   *
   * 一组特效由 1~3 块**贴地薄片**组成（弧 / 爆点 / 冲击环），
   * 它们共享同一个进度，按各自所属家族的曲线缩放 + 淡出。
   * 和弹道线一样**必须手动 dispose**（Three.js 不会自动回收几何体/材质），
   * 而且必须在重开一局时清空，否则薄片会留在棋盘上（就是"打完最后一下特效不淡出"那个坑）。
   */
  private attackFx: Array<{ parts: AttackFxPart[]; duration: number; life: number; alpha: number }> = [];
  /**
   * ★★ 0.2.1：正在播的**技能释放特效**（每个主动技能一套）。
   *
   * 一套 = 一个 Group（贴地柔光 / 外环 / 六芒 / 放射光条 / 冲击环 + 星芒 Sprite + 光柱 Sprite），
   * 位置**每帧跟着施法者走**（技能开了之后他还会走位，光环得跟上）。
   * 和攻击特效一样：手动 dispose、重开一局必须清空。
   */
  private skillCastFx: Array<{
    unitId: number;
    visual: SkillCastVisual;
    /** 已经播了多久（秒） */
    elapsed: number;
    /** 持续段多长（来自技能数据，纯伤害技能 = 0） */
    sustain: number;
    /** 整段一共多久 */
    total: number;
  }> = [];
  /**
   * ★★ 0.2.1：正在播的**序列帧特效**（贴图特效，`sequence-fx.ts`）。
   * 每项自己带贴图指针与寿命 —— 到期就 dispose（帧指针还回池子，原图共享不释放）。
   */
  private seqFx: SeqFxInstance[] = [];
  /**
   * ★ 0.2.1：**技能生效期间**这一刀该播哪几张图（`cast` 时登记，技能结束就失效）。
   *
   * 【为什么要单独记一张表？】
   * 陈/玛恩纳的红色/金色斩击只在**技能期间**才该出现 —— 平时的普攻还是原来那套。
   * 而"技能还有多久"只有内核知道（`skillCastSustainSecondsOf` 从技能数据算），
   * 所以这里记一个"到什么时候为止"，攻击事件来的时候先看它。
   */
  private skillAttackFx = new Map<
    number,
    { ids: string[]; firstIds: string[]; until: number; firstDone: boolean }
  >();
  /**
   * ★ 0.2.1：最近一次普攻的贴图 key（按**被打的人**记）。
   * 击杀那一下要换成加强版（`heavy`），而"是否击杀"只有随后的 `damage.lethal` 才知道 ——
   * 所以先记着，等伤害事件来了再决定要不要补一张大的。
   */
  private lastHitFx = new Map<number, { key: string; at: number }>();
  /** 治疗流光的节流表（unitId → 上一条流光的时间） */
  private lastHealFxAt = new Map<number, number>();
  /** 左右交替用的节拍（同一个人连着砍，交替镜像才不像"同一张贴图在闪"） */
  private seqBeat = new Map<number, number>();
  /**
   * ★ 0.2.1：闪电弹道（澄闪的普攻）。
   * ★ 它需要一个**相机**：贴片要正对镜头、X 轴沿弹道（45° 俯视下否则只剩一条缝），
   *   相机由 `main.ts` 通过 `setCamera()` 递进来 —— 渲染模块自己不认识相机。
   */
  private boltFx: BoltTracer[] = [];
  private camera: Camera | null = null;
  /**
   * ★★ 0.2.1：**羁绊级全场扫射**（拉特兰齐射）在场的那一批子弹。
   *
   * 【为什么不直接塞进 `boltFx`？】
   * `MAX_LIVE_BOLT_TRACERS` 只有 16 发 —— 那是按"一次攻击连几条"定的。
   * 一次齐射峰值有 100+ 颗同时在飞，塞进同一个数组会把别人正在飞的普攻弹道全顶掉
   * （反过来也会被顶掉）。两套各管各的上限，互不干扰。
   *
   * 排布（哪一行、第几颗、什么时候打）在 `board-volley-fx.ts` 的纯函数里算好，
   * 这里只负责"到点了就生成一颗，到期就回收"。
   */
  private volleyBolts: BoltTracer[] = [];
  /** 还没打出去的那些（按 `at` 升序；到点了从队头取） */
  private pendingVolleyShots: Array<{ at: number; tracer: string; fromX: number; toX: number; z: number }> = [];
  /**
   * ★ 0.2.1：**延后播**的贴图特效（子弹还在飞，命中火花先别炸）。
   * 子弹是"飞过去"的，可伤害是**瞬间**结算的 —— 如果火花跟着伤害那一刻就炸，
   * 画面上会"火花先亮、子弹还在路上"。所以按飞行时长把它们排个队。
   */
  /**
   * 延后播放的贴图特效（子弹飞到才炸的那一发）。
   * ★ 0.2.1：这里必须**连"谁打的"一起记**（`self`）—— 命中层里可能有
   *   `between` 锚点（通用斩击摆在两人中间），只给落点的话它会贴在敌人身上。
   */
  private pendingSeqFx: Array<{
    at: number;
    id: string;
    x: number;
    z: number;
    self?: { x: number; z: number };
    flipX: boolean;
  }> = [];
  // ============================================================
  //  ★★ 0.2.1：统一命中时刻（用户口径 · 方案 A）
  // ============================================================
  /** 「这一发还在飞、还没结算」的记录（配对靠它，语义见 `hit-timing.ts`） */
  private readonly impacts = new ImpactQueue();
  /**
   * 推到命中时刻才播的**内核事件**（`damage` / `death` / `dodge`）。
   * ★ 为什么不干脆改 `visual.hp` 一个数？因为"掉血"和"死了"必须同一帧发生，
   *   否则会出现"卡面还是满血，人却已经缩没了"。
   */
  private pendingImpactEvents: Array<{ at: number; event: BattleResult['log'][number] }> = [];
  /**
   * 推到命中时刻才炸的**程序化爆点**（`spawnAttackFx` 的命中层）。
   * 只记 id、到点再取位置 —— 因为飞到的时候双方可能都已经挪了格子。
   */
  private pendingImpactFx: Array<{ at: number; attackerId: number; targetId: number | null }> = [];
  /**
   * ★★ 0.2.2：推到命中时刻才画的**近战受击痕**。
   *
   * 近战一般没有飞行时间（`impactDelay = 0`，当帧就画）；但**多段攻击**
   * （`multiHit: 3` 的第 2/3 段）会各错开 90 毫秒 —— 那两下如果当帧画，
   * 三道痕会叠在同一帧上，看起来只有一下。
   * ★ 颜色在这里就定下来（而不是到点再算）：到点时可能已经进了/出了技能窗口，
   *   那时候再问"这一下播的是哪套斩击"会拿到**下一段**的答案。
   */
  private pendingMeleeHit: Array<{
    at: number;
    attackerId: number;
    targetId: number;
    /** ★ 0.3.2：从"一个颜色"升级为"样式"（阿米娅·青色怒火的黑痕 = 墨底 + 混合方式） */
    style: MeleeSlashStyle;
  }> = [];
  /**
   * 「这一下打死的人，什么时候才该演死」。
   * `death` 事件没有 `sourceId`，所以由前一条 `damage.lethal` 的认领结果带过来。
   */
  private readonly pendingDeathAt = new Map<number, number>();
  /** 排查用：累计生成过多少发弹道（含失败的） */
  private boltSpawnTries = 0;
  /** 排查用：累计回收过多少发（到期被摘掉） */
  private boltDisposed = 0;
  /** 排查用：最后一发弹道的生成参数 */
  private lastBoltInfo = '-';
  /**
   * ★ 0.2：正在飞的**音符**（丰川祥子的普攻弹道，贴图就是 🎶）。
   *
   * 每个音符是一个 Sprite，沿着"自己 → 目标"的拱形轨迹飞过去。
   * ★ 材质要手动 dispose；**贴图是全局共享的**（`note-fx.ts` 里缓存），别在这里释放，
   *   否则第二个音符就没图了。
   * ★ 与攻击特效一样必须在重开一局时清空。
   */
  private noteFx: Array<{
    sprite: Sprite;
    material: SpriteMaterial;
    from: { x: number; z: number };
    to: { x: number; z: number };
    life: number;
    duration: number;
  }> = [];
  /**
   * ★ 0.2.1：正在飞的**战术装置**（迷迭香的普攻演出，贴图是官方 Spine 里那套板子）。
   *
   * 和音符是同一套结构（一个 Sprite 沿轨迹飞），区别是：
   *   · 轨迹是**从目标正上方直落 + 末段加速**（砸，不是飘过去）；
   *   · 带屏幕内旋转、落地前放大，以及**按相机做的视角补偿**。
   * ★ 贴图全局共享（`rosmon-slam-fx.ts` 缓存），这里只 dispose 材质。
   */
  private rosmonSlamFx: Array<{
    sprite: Sprite;
    material: SpriteMaterial;
    /**
     * 落点（目标格的**地面**那个点，`y = SLAM_END_Y`）。
     * ★ 装置是从这个点的正上方直落下来的，没有 from；
     *   它同时是"视角补偿"的锚点（见 `slamPathAt` 的注释），所以必须带 y。
     */
    to: { x: number; y: number; z: number };
    life: number;
    duration: number;
  }> = [];
  /** 上一次装置起飞的时间（秒）——"一次只砸一个"的时间窗闸门用它 */
  private lastSlamSpawnAt = -Infinity;
  /**
   * 视角补偿用的相机快照 —— **原地复用**，别每帧 new。
   * 只在 `slamView()` 里写、在同一次 `slamPathAt()` 调用里读，
   * 所以复用一个对象是安全的（不要把它存下来跨帧用）。
   */
  private readonly slamViewCache = { position: new Vector3(), forward: new Vector3(0, 0, 1) };
  /**
   * ★ 0.1.3：正在播的**斩击刀光**（锏的"疯狂斩击"）。
   *
   * 每一刀 = 一块月牙刀身 + 一个命中爆闪，两块贴地薄片共享一个进度。
   * 和攻击特效一样**必须手动 dispose**，也必须在重开一局时清空
   * （否则刀光会挂在棋盘上不消失 —— 和弹道线/范围框同一个坑）。
   */
  private slashFx: SlashFx[] = [];
  /**
   * ★ 0.2：地板上正在播的「范围爆炸」（维什戴尔 3 星的 5×5 大招）。
   *
   * 每一次爆炸 = 3 块贴地薄片（黑烟 / 火焰主层 / 中心炸点），共享一个进度。
   * 和攻击特效、刀光一样**必须手动 dispose**，也必须在重开一局时清空
   * （否则爆炸会定格在棋盘上 —— 和弹道线/范围框同一个坑）。
   *
   * 【它和旁边那个 `zones`（范围白框）是什么关系？】
   * 两条并行的表现，同一个事件触发点：
   *   · `zone` 事件 -> 白框（**所有**范围伤害都有，它回答"打到了哪些格子"）；
   *   · `bloom` 事件 -> 这套爆炸（**只有数据里写了 `fx` 的**才有，
   *     它回答"这一发是什么技能、有多狠"）。
   * 分开的理由见 `shared/types.ts` 里 `bloom` 事件的说明。
   */
  private bloomFx: BloomFx[] = [];
  /**
   * 地板上正在显示的「范围框」（白框 = 范围伤害，绿框 = 回血光环）。
   *
   * 【为什么要有这个？】
   * 范围技能之前是"看不见"的：维什戴尔 3 星的 5×5 一炸，屏幕上只有几个
   * 伤害数字跳出来，玩家根本不知道**打到的是哪一片**。
   * 有了框之后，"这一下扫了多大一片"一眼就看得出来。
   *
   * 【为什么可以有几个框同时存在？】
   * 回血光环是每秒刷一次的，框的存活时间比间隔略长 ——
   * 于是看起来是"一直亮着一个圈"，而不是每秒闪断。
   * 同一个棋子身上也可能同时有白框和绿框（比如魔王 3 星又在回血又在被打）。
   */
  private zones: Array<{
    lines: Line[];
    materials: LineBasicMaterial[];
    geometries: BufferGeometry[];
    life: number;
    maxLife: number;
  }> = [];
  /** 事件游标：指向下一条还没播放的事件 */
  private eventCursor = 0;
  /** 播放位置，单位是「战斗内秒数」 */
  private timeSeconds = 0;
  private speed = 1;
  private finished = false;
  /**
   * 是否左右翻转显示。
   *
   * 联机时服务器返回的队伍 1 永远在右半边，但玩家希望自己的棋子在画面左下角。
   * 如果自己被分到队伍 1，就把 flip 设为 true，整场战斗镜像显示。
   * 注意：只影响画面，事件数据一个字节都没改 —— 所以不影响确定性。
   */
  private flip = false;

  /**
   * ★ 0.0.3：战斗单位编号 -> 身上装了几件 A 类藏品。
   *
   * 【为什么由外面传进来，而不是从 BattleState 里读？】
   * 因为战斗状态是**确定性内核**的数据：为了"同一套阵容 + 同一个种子
   * 永远推出同一个校验和"，往里面加显示用的字段是要非常小心的。
   * 而"显示两个小圆点"纯粹是画面问题 —— 让它待在画面层最省事：
   * main.ts 从自己手里的 TeamSetup（`units[i].items`）建一张对照表传进来。
   * 编号规则是内核固定的：`unitId = team * 1000 + index + 1`。
   *
   * 【为什么不在 load 里清掉？】
   * 调用顺序可能是 `setItemCounts` 然后 `load`，也可能是反过来 ——
   * 两边都支持（setItemCounts 会顺手给已经存在的精灵补上），调用方就不用记。
   */
  private itemCounts = new Map<number, number>();

  /*
    ============================================================
    ★ 0.0.3：战斗中的**实时数值**（点开棋子时显示的攻速/攻击/双抗）
    ============================================================
    【为什么不能直接读面板值？】
    因为面板值是"数据表里的白板"，而战斗里这些数一直在变：
    被动（泥岩 -50% 攻速）、羁绊光环、技能增益、藏品……
    直接显示白板等于骗玩家。

    【数据从哪来？分三层，缺一不可】
      1. `load()` 时拿**开战状态**算一次基线 —— 被动、羁绊、藏品、开局光环
         （重装那种 t=0 的光环已经在 createBattle 里加到属性上了）都在里面；
      2. `buff` 事件（攻速/攻击加成，带到期时间）叠上去 —— 技能、残血爆发都走它；
      3. `status` 事件（护盾/眩晕）只影响卡面上的状态标记，不改数值。
    这样一来"战斗中打开面板"看到的数字和战斗内核真正用的那两个数
    （effectiveAttackSpeed / effectiveAttackDamage）口径完全一致。

    ★★ 单位：返回给界面的全是**面板单位** ★★
    战斗内核里的攻击力 / 护甲 / 魔抗都是 ×1000 的定点数（`FIX`），
    直接把内部值丢给界面，玩家就会在详情页看到 `675000` 这种数字
    （用户报的"干员详细页面的数据显示过大"就是这个）。
    所以这里统一换算：攻击/护甲/魔抗 ÷ FIX，攻速换算成"每秒几次"。
  */
  private liveBase = new Map<
    number,
    { attackSpeed: number; attackDamage: number; armor: number; magicResist: number; range: number }
  >();
  private liveBuffs = new Map<number, Array<{ stat: 'attackSpeed' | 'attackDamage'; bonusBp: number; untilTick: number }>>();

  /**
   * ★ 0.0.3：**属性时间线**（`result.statsTimeline`）—— 内核每 tick 采下来的真值。
   *
   * 【为什么不用"基线 + buff 事件"算了？】
   * 那条路只能算"上报过事件"的加成，而战斗中改属性的写法有好几种
   * （技能 buff、藏品增益、羁绊光环、野怪换阶段直接乘属性…）。
   * 漏一处 → 面板显示错数字，而且不报错、只是"看起来没变"。
   * 现在直接读内核采的真值：**不管属性被谁改过，面板都对**（用户的要求）。
   *
   * 拿不到时间线时（老的假日志单测、或者服务端不带它）自动退回
   * liveBase + liveBuffs 那条老路，面板照样能显示。
   */
  private statsTimeline = new Map<number, BattleStatsSample[]>();

  constructor(defs: UnitDefTable) {
    this.defs = defs;
    this.root.add(this.fxLayer);
    // ★ 0.2.1：隐德来希的血镰特效自己管"转/回收"，把根节点交给它一次即可
    attachLetoScytheRoot(this.fxLayer);
    // ★ 0.2.1：回血光环（夜莺 / 魔王）同样自带生命周期，根节点交给它一次
    attachHealHaloRoot(this.fxLayer);
    // ★ 0.3.2：阿米娅两套升变形态的技能特效（方格阵 / 全场氛围 / 即死叠加）
    attachAmiyaFormFxRoot(this.fxLayer);
    // ★ 0.2.2：蕾缪安的锁定瞄准镜 + 爆炸同理
    attachLockOnRoot(this.fxLayer);
    // ★ 0.2.2：近战受击痕同理
    attachMeleeHitRoot(this.fxLayer);
    // ★ 0.2.2：陈的前方三格剑光同理
    attachChenThrustRoot(this.fxLayer);
  }

  /** 用一个**开战状态**把所有棋子的基线数值算一遍（见 liveBase 的说明） */
  private captureLiveBase(state: BattleState): void {
    this.liveBase.clear();
    this.liveBuffs.clear();
    /*
      ★ 容错：回放层的单测会手搓一个"只有日志"的假状态喂进来（没有 units）。
      拿不到开战状态就不要基线 —— 面板会退回数据表里的白板值，不会炸。
    */
    if (!Array.isArray((state as { units?: unknown } | null)?.units)) return;
    for (const unit of state.units) {
      const mods = collectMods(state, unit);
      this.liveBase.set(unit.id, {
        attackSpeed: effectiveAttackSpeed(unit, mods),
        attackDamage: effectiveAttackDamage(unit, mods),
        armor: effectiveArmor(unit, mods),
        magicResist: effectiveMagicResist(unit, mods),
        // 射程也在基线里：羁绊会改它（炮手 +2、术士 +1），不记就显示的是白板射程
        range: effectiveRange(state, unit),
      });
    }
  }

  /**
   * 某个棋子**此刻**的数值（含被动 / 羁绊 / 增益 / 光环）。返回的都是面板单位：
   *   · attackSpeed  —— 每秒攻击次数（1.2 = 每秒 1.2 下）
   *   · attackDamage / armor / magicResist —— 面板上的那个整数
   *   · bonusSpeedBp / bonusDamageBp —— 战中被改了多少（万分比，界面用它标 ▲/▼）
   */
  liveStatsOf(unitId: number): {
    attackSpeed: number;
    attackDamage: number;
    armor: number;
    magicResist: number;
    range: number;
    bonusSpeedBp: number;
    bonusDamageBp: number;
  } | null {
    const base = this.liveBase.get(unitId);
    const tick = Math.floor(this.timeSeconds * TICKS_PER_SECOND);
    /*
      ★ 首选：内核采下来的真值（任何来源的 buff/debuff 都在里面）。
      时间线里没有这枚棋子（老的假日志单测 / 不带时间线的战斗）才退回老路。
    */
    const live = panelStatsAt(this.statsTimeline, unitId, tick);
    if (live) return live;
    if (!base) return null;
    let bonusSpeedBp = 0;
    let bonusDamageBp = 0;
    for (const buff of this.liveBuffs.get(unitId) ?? []) {
      // 到期的直接跳过（战斗日志只有"什么时候加上"，到期要自己算）
      if (buff.untilTick <= tick) continue;
      if (buff.stat === 'attackSpeed') bonusSpeedBp += buff.bonusBp;
      else bonusDamageBp += buff.bonusBp;
    }
    // 攻速：内核算出来还是 1/1000 刻度（1200 = 每秒 1.2 次），这里除回来
    const speedPerThousand = Math.max(50, Math.floor((base.attackSpeed * (10000 + bonusSpeedBp)) / 10000));
    return {
      attackSpeed: speedPerThousand / 1000,
      attackDamage: Math.max(
        0,
        Math.round((base.attackDamage * Math.max(0, 10000 + bonusDamageBp)) / 10000 / FIX),
      ),
      armor: Math.max(0, Math.round(base.armor / FIX)),
      magicResist: Math.max(0, Math.round(base.magicResist / FIX)),
      range: base.range,
      bonusSpeedBp,
      bonusDamageBp,
    };
  }

  /**
   * ★ 0.1.1 藏品二版：某个棋子此刻**正生效的状态效果**（含剩余时间）。
   *
   * 【数据从哪来？】
   * 和 `liveStatsOf` 同一个源头 —— 内核在属性时间线里顺手采的
   * `BattleStatsSample.effects`（口径就是 status-effects.ts 的 activeEffectsOf，
   * 所以"有哪些效果"这件事**加新效果时界面一行都不用改**）。
   *
   * 【为什么界面不能自己去日志里推？】
   * 日志只上报了护盾 / 眩晕 / 攻速 buff / 闪避这几种，
   * 隐匿、无敌、免死、流血、飞行这些**根本不在日志里**（它们只是修正包或机制）。
   * 自己去推的结果就是"面板上永远少一半效果"，而且不报错。
   */
  effectsOf(unitId: number): ActiveEffect[] {
    const tick = Math.floor(this.timeSeconds * TICKS_PER_SECOND);
    return effectsAt(this.statsTimeline, unitId, tick);
  }

  /**
   * 设置"每个战斗单位装了几件藏品"（见 itemCounts 的说明）。
   * 装载新战斗后调用；对当前已经在场的精灵也会立刻生效。
   */
  setItemCounts(counts: Map<number, number>): void {
    this.itemCounts = counts;
    for (const [unitId, visual] of this.visuals) {
      setUnitItemDots(visual.sprite, counts.get(unitId) ?? 0);
    }
  }

  /** 设置是否左右翻转显示（换视角后需要重新 load 才生效） */
  setFlip(flip: boolean): void {
    this.flip = flip;
  }

  /** 把逻辑格子坐标换算成画面上的世界坐标（自动处理翻转） */
  private place(cell: { col: number; row: number }, y: number): Vector3 {
    return cellToWorldFlipped(cell, y, this.flip);
  }

  /**
   * 这个队伍是不是"我方"。
   *
   * 【为什么不能只比较 team === 0？】
   * 联机时服务器可能把你分到队伍 1。那时候画面是镜像的（flip = true），
   * 你的棋子显示在左下角 —— 所以"我方"是 team 1，不是 team 0。
   * 血条颜色（我方绿/敌方红）就靠这个判断。
   */
  private isMine(team: 0 | 1): boolean {
    return this.flip ? team === 1 : team === 0;
  }

  /** 当前显示视角下，我是不是左半边那一队 */
  get flipped(): boolean {
    return this.flip;
  }

  /** 装载一场战斗，重置到开头 */
  load(state: BattleState, result: BattleResult): void {
    this.result = null;
    this.clear();
    this.result = result;
    this.lastState = state;
    // ★ 0.0.3：用"开战那一刻"的状态算一遍实时数值的基线（见 liveBase 的说明）
    this.captureLiveBase(state);
    this.statsTimeline = groupStatsTimeline(result.statsTimeline);
    this.eventCursor = 0;
    this.timeSeconds = 0;
    this.finished = false;

    /*
      1) 先在棋盘上摆好所有棋子的初始位置（用 spawn 事件，而不是最终状态，
         否则一开始就会看到棋子站在它的死亡位置上）

      ★ 只处理 `t === 0` 的开局 spawn。
      因为**召唤物和复活也是 spawn 事件**（迷迭香的柱子、维娜的金狮子、
      望的棋子、新约能天使复活的队友），它们是在战斗中才出现的。
      如果这里把"整条日志里的 spawn"全铺一遍，柱子就会在开局第 0 秒
      凭空出现在它 20 秒后才该出现的位置上 —— 而且**永远不动**，
      看起来像卡了个贴图。所以战斗中途的 spawn 交给 playEvent 现场生成。
    */
    for (const event of result.log) {
      if (event.type !== 'spawn' || event.t !== 0) continue;
      const def = this.defs[event.defId];
      if (!def) continue;
      this.createVisual(event.unitId, event.defId, def, event.star, event.team, event.cell, event.maxHp);
    }

    // 2) 事件游标要跳过开局的 spawn 事件（它们已经在上面处理掉了）
    while (
      this.eventCursor < result.log.length &&
      result.log[this.eventCursor]!.type === 'spawn' &&
      result.log[this.eventCursor]!.t === 0
    ) {
      this.eventCursor++;
    }
  }

  /**
   * 造一个棋子的视觉对象并摆到棋盘上。
   *
   * 【为什么抽成函数？】
   * 因为现在有两个地方要造：开局的 spawn（上面）和战斗中途的 spawn
   * （召唤物 / 复活，见 playEvent）。两处各写一份的话，
   * 以后给 UnitVisual 加字段一定会漏掉一处 —— 那种 bug 很难查。
   */
  private createVisual(
    unitId: number,
    defId: string,
    def: UnitDef,
    star: number,
    team: 0 | 1,
    cell: { col: number; row: number },
    maxHp: number,
  ): UnitVisual {
    /*
      ★★ 同一个 unitId "死而复生"时必须先把旧精灵摘掉 ★★
      【这是"能天使复活时卡面残留"的根因】
      复活（新约能天使 3 星）推的 `spawn` 事件用的还是**阵亡前那个 unitId**
      —— 见 skills.ts 的 doRevive：它只把 dead 翻回 false，编号一个字没变。
      而播放器是拿 unitId 当表键的：
        · 那一刻旧精灵很可能还在演那 0.45 秒的阵亡动画（还没从 root 里摘掉）；
        · 下面 `this.visuals.set(unitId, …)` 会**直接覆盖**表里的这一项。
      覆盖之后旧精灵就再也没人引用了：不会被 updateVisual 更新、
      也不会走到"死亡动画播完就移除"那一句 —— 它就那么定格在竞技场上。
      你看到的"卡面残留、怎么都不消失"就是它。
      所以造新的之前，先把同一个编号的旧精灵摘干净。
    */
    const stale = this.visuals.get(unitId);
    if (stale) this.dropVisual(stale);

    const sprite = createUnitSprite(def, star, team, this.isMine(team));
    /*
      ★ 0.0.3：把"这个棋子装了几件藏品"画到血条左边那两个小圆点上。
      createUnitSprite 一律从 0 件开始，真实件数在这里补。
    */
    setUnitItemDots(sprite, this.itemCounts.get(unitId) ?? 0);
    // 战斗中点棋子要靠它反查是哪一个单位（见 unitIdAt）
    (sprite.userData as { unitId?: number }).unitId = unitId;
    const position = this.place(cell, CARD_CENTER_Y);
    sprite.position.copy(position);
    this.root.add(sprite);

    /*
      ★ 0.1.3：角色身上的**金色光华**（无敌 / 重生过渡）单独一层，叠在小人之上。
      它是**独立精灵**而不是小人的子节点 —— 小人那套是序列帧、会自己换贴图，
      叠一层进它的贴图管线会把帧动画搞乱（而且加色混合也要单独一个材质）。
    */
    const aura = createAuraSprite();
    /*
      ★ 0.1.3：光效挂在**卡片下面**（小人的兄弟节点），不是独立放进场景 ——
      这样位置 / 尺寸 / 跟着卡片移动旋转缩放全都自动成立，
      不用每帧手动同步一个世界坐标（第一版就是独立精灵 + 按贴图像素设 scale，
      结果光效比竞技场还大、还和卡片错位）。
    */
    sprite.add(aura);

    const visual: UnitVisual = {
      sprite,
      aura,
      auraElapsed: 0,
      unitId,
      team,
      defId,
      star,
      logicalCell: { col: cell.col, row: cell.row },
      visualPosition: position.clone(),
      moveFrom: position.clone(),
      moveTo: position.clone(),
      moveProgress: 1,
      stepSeconds: stepSecondsFor(false),
      moving: false,
      walkDir: { x: 0, y: 0 },
      hp: maxHp,
      maxHp,
      shield: 0,
      mana: 0,
      castCount: 0,
      slashSeq: 0,
      dead: false,
      downed: false,
      deathProgress: 0,
      hitFlash: 0,
      lunge: 0,
      lungeDir: { x: 0, y: 0 },
      castGlow: 0,
      swing: createSwingTiming(),
      swingRestart: false,
      skillSpeed: 1,
      effects: { ...NO_EFFECTS },
      effectExpiry: { shield: 0, attackSpeed: 0, attackDamage: 0, stun: 0, evade: 0 },
    };
    this.visuals.set(unitId, visual);
    return visual;
  }

  /**
   * 把一个视觉对象从场景里**彻底**摘掉（并从表里删掉）。
   *
   * 【为什么必须抽成一个函数？】
   * 摘精灵要做的不止 `root.remove`：小人是**另一张 canvas 贴图**
   * （挂在卡片下面的子精灵），不调 detachChibi 就会漏显存，
   * 而且它自己还在 `pendingAttach` 里被引用着 —— GC 也收不走。
   * 三处（清场 / 死亡动画播完 / 复活顶替旧精灵）各写一遍的话，
   * 以后再加一样"身上挂着的东西"一定会漏掉其中一处，而且不会报错。
   */
  private dropVisual(visual: UnitVisual): void {
    // 光效是小人的兄弟节点（挂在卡片下），跟着卡片一起离开场景；这里显式断开引用
    visual.sprite.remove(visual.aura);
    this.root.remove(visual.sprite);
    detachChibi(visual.sprite);
    this.visuals.delete(visual.unitId);
  }

  /**
   * ★ 0.1.3：这一帧该给这枚棋子亮什么金光。
   *
   * 【优先级：重生过渡 > 无敌】
   * 倒地等复活那两三秒里，玩家最需要读到的信息是"它要活过来了"；
   * 而这段本来就是无敌的（倒地期间打不到它），所以两种光同时命中时只显示重生那一种。
   *
   * 【时长从哪来？——没有任何"猜"的时间，全是数据】
   *   · **无敌**：亮多久完全由数据决定（技能 / 藏品给多久就亮多久）。
   *     内核每 tick 采样的 `effects` 里带着 `invincible`，界面只是如实显示。
   *   · **重生过渡**：倒地时长 = `def.reborn.delayTicks / 20` 秒（杰斯顿 3 秒、Boss 5 秒、
   *     锏 / 血骑士 3 秒、"左手" 2 秒），强度按这个比例从 `AURA_REBIRTH_MIN_RATIO` 一路爬到 1 ——
   *     所以"光越来越亮"这件事本身就在告诉玩家"快起来了"。
   */
  private updateUnitAura(visual: UnitVisual, deltaSeconds: number): void {
    /*
      ★ 尺寸和位置都**照抄小人那一层** ——
      它才是"这枚棋子现在多大、站在卡片里的哪个位置"的答案
      （不同干员的模型缩放不同、换素材时也会变，光效得跟着一起变）。
      比小人放大 `AURA_SCALE_OVER_CHIBI`：光要"包住"人，不是压在他脸上。
      ★ 没有小人时（素材没抓到，退回卡面立绘）就保持上一帧的尺寸 ——
      这时光是浮在卡面立绘上的，观感也讲得通。
    */
    const chibiSprite = (visual.sprite.userData as { chibi?: { sprite?: Sprite } }).chibi?.sprite;
    if (chibiSprite) {
      // 位置**跟小人** —— 它才是"人站在卡片里的哪一处"的答案
      visual.aura.position.copy(chibiSprite.position);
    }
    /*
      ★★ 尺寸**跟格子**（不是跟小人）：小人多大各干员不同（Boss、巨像的模型缩放更大），
      按小人算的话它们会得到一个大得多的光斑；而"一格"是棋盘上恒定的尺子
      （`CELL = 1.0` 世界单位）—— 用户要的就是"比一格大一点点"这个手感。
      ★ 光效是卡片的子节点，子节点的 scale 会**再乘一次**父节点的 scale，
      所以要除掉卡片的 scale 才能得到想要的世界尺寸（和 chibi.ts 同一个算法）。
    */
    const size = auraWorldSize();
    visual.aura.scale.set(size.w / CARD_WORLD_SCALE.x, size.h / CARD_WORLD_SCALE.y, 1);

    if (visual.downed) {
      visual.auraElapsed += deltaSeconds;
      const def = this.defs[visual.defId];
      const totalSeconds = Math.max(0.2, (def?.reborn?.delayTicks ?? 60) / 20);
      const progress = Math.min(1, visual.auraElapsed / totalSeconds);
      const intensity = AURA_REBIRTH_MIN_RATIO + (1 - AURA_REBIRTH_MIN_RATIO) * progress;
      updateAuraSprite(visual.aura, 'rebirth', intensity, deltaSeconds);
      return;
    }

    // 站着的时候：重新计数（下次倒地要从"最暗"开始爬）
    visual.auraElapsed = 0;
    if (visual.dead) {
      updateAuraSprite(visual.aura, null, 0, deltaSeconds);
      return;
    }
    const invincible = this.effectsOf(visual.unitId).some((effect) => effect.kind === 'invincible');
    updateAuraSprite(visual.aura, invincible ? 'invincible' : null, 1, deltaSeconds);
  }

  /** 清空所有棋子（不动 result / lastState，seek 往回跳时还要用） */
  clear(): void {
    /*
      ★ 必须遍历**副本**：dropVisual 会边删边改 this.visuals，
      在 Map 的迭代过程中删当前项虽然合法，但语义很绕（而且一旦以后再往里加东西就容易踩坑）。
    */
    for (const visual of [...this.visuals.values()]) this.dropVisual(visual);
    this.clearTracers();
    this.clearZones();
    // ★ 0.1.4：攻击特效也要清（否则薄片留在棋盘上，像卡了个贴图）
    this.clearAttackFx();
    // ★ 0.2.1：技能特效同理
    this.clearSkillCastFx();
    // ★ 0.2.1：贴图特效同理（不清的话枪口/斩击会留在棋盘上）
    this.clearSeqFx();
    // ★ 0.2.1：闪电弹道同理
    this.clearBoltFx();
    // ★ 0.2.1：羁绊级全场扫射（拉特兰齐射）—— 在场子弹与"还没打的"一起清
    this.clearBoardVolley();
    // ★ 0.2.1：血镰同理
    clearLetoScytheFx();
    // ★ 0.2.1：回血光环（夜莺 / 魔王）同理 —— 光环和符号一起收
    clearHealHaloFx();
    // ★ 0.3.2：阿米娅升变技能的方格阵 / 氛围碎片 / 即死叠加
    clearAmiyaFormFx();
    // ★ 0.2.2：蕾缪安的瞄准镜与爆炸（不清的话狙击镜会一直锁在棋盘上）
    clearLockOnFx();
    // ★ 0.2.2：近战受击痕（不清的话最后一道痕会定格在棋盘上）
    clearMeleeHitFx();
    // ★ 0.2.2：陈的前方三格剑光（不清的话会定格在棋盘上）
    clearChenThrustFx();
    this.pendingMeleeHit.length = 0;
    // ★ 0.2：音符同理
    this.clearNoteFx();
    // ★ 0.2.1：迷迭香的战术装置同理（不清的话会有一件装置停在半空）
    this.clearRosmonSlamFx();
    // ★ 0.1.3：斩击刀光同理
    this.clearSlashFx();
    // ★ 0.2：范围爆炸同理（不清的话爆炸会定格在棋盘上）
    this.clearBloomFx();
    this.eventCursor = 0;
    this.timeSeconds = 0;
    this.finished = false;
    /*
      ★★ 0.2.1：命中队列也要清 —— 不清的话上一局最后几发"还在飞"的攻击
      会挂到下一局去，第一发普攻的掉血就被推到某个莫名其妙的时刻。
    */
    this.impacts.clear();
    this.pendingImpactEvents.length = 0;
    this.pendingImpactFx.length = 0;
    this.pendingDeathAt.clear();
  }

  /** 清掉所有弹道线（重新装填/清空时必须做，否则线会残留在地板上） */
  private clearTracers(): void {
    for (const tracer of this.tracers) {
      this.fxLayer.remove(tracer.line);
      tracer.geometry.dispose();
      tracer.material.dispose();
    }
    this.tracers.length = 0;
  }

  /** 清掉所有范围框（同弹道线：不 dispose 会一直占显存） */
  private clearZones(): void {
    for (const zone of this.zones) {
      for (const line of zone.lines) this.fxLayer.remove(line);
      for (const geometry of zone.geometries) geometry.dispose();
      for (const material of zone.materials) material.dispose();
    }
    this.zones.length = 0;
  }

  get durationSeconds(): number {
    return this.result ? this.result.ticks / TICKS_PER_SECOND : 0;
  }

  get currentSeconds(): number {
    return this.timeSeconds;
  }

  get isFinished(): boolean {
    return this.finished;
  }

  setSpeed(speed: number): void {
    this.speed = speed;
  }

  /**
   * 跳到指定时间点。
   * 做法：清空重来，然后以「瞬间」模式把时间快进过去。
   * 因为内核是确定性的、事件是完整的，这样跳转永远能得到正确画面。
   */
  seek(seconds: number): void {
    if (!this.result || !this.lastState) return;
    const target = Math.max(0, Math.min(seconds, this.durationSeconds));
    // 往回跳：重新摆一遍
    if (target < this.timeSeconds) {
      const { result, lastState } = this;
      this.load(lastState, result);
    }
    // 往前快进（用很小的步长，保证事件顺序不乱）
    let guard = 0;
    while (this.timeSeconds < target && guard++ < 10000) {
      this.advance(Math.min(0.05, target - this.timeSeconds));
    }
  }

  /**
   * 推进播放。
   * @param deltaSeconds 真实经过的秒数
   */
  advance(deltaSeconds: number): void {
    if (!this.result) return;

    /*
      战斗已经播完 —— 但**特效还没淡完**。
      【为什么不能直接 return？】
      战斗最后一下爆炸（比如维什戴尔 3 星的 5×5）画的方框有 0.6 秒寿命。
      如果"播完"就彻底停止推进，那个框会**一直留在地板上**，
      直到进入下一局才消失 —— 看起来像卡了个贴图。
      弹道线同理。所以这里继续推进这两样，让它们自然淡完。
    */
    if (this.finished) {
      /*
        ★★ 0.2.1：战斗已经播完 ⇒ **强行**把还在飞的命中一次放完。
        这时 `timeSeconds` 不再推进，靠"到点判断"永远等不到 ⇒
        最后几发炮弹的掉血 / 死亡会永远不出现（棋盘定格在"人被打了还满血"）。
      */
      this.flushImpactMoment(true);
      this.updateTracers(deltaSeconds);
      this.updateZones(deltaSeconds);
      /*
        ★ 0.1.4：攻击特效也要继续淡完。
        不推进的话，战斗最后一下的火花会**一直贴在棋盘上**（和弹道线/范围框同样的坑）。
      */
      this.updateAttackFx(deltaSeconds);
      /*
        ★ 0.2.1：技能特效同理 —— 战斗最后一下如果是"开技能"，那圈光环必须淡完。
        不推进的话它会一直亮在棋盘上，直到下一局才消失（子弹线和范围框踩过同样的坑）。
      */
      this.updateSkillCastFx(deltaSeconds);
      // ★ 0.2.1：贴图特效也要淡完（否则最后一张枪口会定格在棋盘上）
      this.updateSeqFxList(deltaSeconds);
      // ★ 0.2.1：闪电弹道同理
      this.updateBoltFxList(deltaSeconds);
      // ★ 0.2.1：羁绊齐射同理（战斗在自己这一发打到一半时结束的话，让它自然飞完）
      this.updateBoardVolley(deltaSeconds);
      // ★ 0.2.1：血镰（转 / 回收）
      updateLetoScytheFx(deltaSeconds);
      // ★ 0.2.1：回血光环（呼吸 / 波环 / 符号往上飘）
      updateHealHaloFx(deltaSeconds);
      // ★ 0.3.2：阿米娅升变技能（方格阵 / 氛围碎片 / 即死叠加）——
      //   战斗最后一下如果是技能，这几层也必须淡完，否则会定格在棋盘上
      updateAmiyaFormFx(deltaSeconds);
      // ★ 0.2.2：瞄准镜自转 + 收缩光环 + 爆炸（战斗最后一下炸到一半就结束的话，让它自然放完）
      updateLockOnFx(deltaSeconds);
      // ★ 0.2.2：近战受击痕（同理，最后一下挨刀也要淡完）
      updateMeleeHitFx(deltaSeconds);
      // ★ 0.2.2：陈的前方三格剑光（伸展 + 淡出）
      updateChenThrustFx(deltaSeconds);
      this.updateNoteFx(deltaSeconds);
      // ★ 0.2.1：战术装置同理（战斗最后一下砸到一半就结束的话，让它自然砸完）
      this.updateRosmonSlamFx(deltaSeconds);
      // ★ 0.1.3：斩击刀光也要淡完（战斗最后一下的刀光不该定格在场上）
      this.updateSlashFx(deltaSeconds);
      // ★ 0.2：爆炸同理（战斗最后一下炸到一半就结束的话，那团火会一直贴在地上）
      this.updateBloomFxList(deltaSeconds);
      /*
        ★ 死亡动画也要继续放完。
        【为什么？】
        战斗结束的那一刻，最后被打死的棋子可能正"缩到一半"。
        如果这里直接收工，它就会**定格在半途**：半透明地卡在棋盘上，
        既难看，又会让"战斗中点它看属性"还能点到一具尸体。
        所以播完之后继续推进死亡动画，让它们自然缩到消失。
      */
      for (const visual of [...this.visuals.values()]) {
        if (visual.dead) this.updateVisual(visual, deltaSeconds);
      }
      return;
    }

    const battleDelta = deltaSeconds * this.speed;
    this.timeSeconds += battleDelta;

    // 1) 播放所有「时间已经到达」的事件
    const currentTick = Math.floor(this.timeSeconds * TICKS_PER_SECOND);
    while (this.eventCursor < this.result.log.length) {
      const event = this.result.log[this.eventCursor]!;
      if (event.t > currentTick) break;
      this.playEvent(event);
      this.eventCursor++;
    }

    /*
      ★★ 0.2.1：把"已经飞到"的那几发的表现补上（血条 / 闪白 / 致死 / 爆点）。
      放在事件循环之后、`updateVisual` 之前 —— 这样同一帧里
      "卡面掉血"和"火花炸开"是同一帧，不会有一个先一个后。
    */
    this.flushImpactMoment(false);

    // 2) 更新每个棋子的视觉状态（插值、闪现、死亡动画、状态特效）
    for (const visual of [...this.visuals.values()]) {
      this.updateVisual(visual, deltaSeconds);
    }

    // 3) 弹道线淡出
    this.updateTracers(deltaSeconds);
    // 4) 范围框淡出
    this.updateZones(deltaSeconds);
    // 5) 攻击特效（缩放曲线 + 淡出）
    this.updateAttackFx(deltaSeconds);
    // 5.2) 技能释放特效（起手 / 爆闪 / 持续 / 收尾）
    this.updateSkillCastFx(deltaSeconds);
    // 5.3) 贴图序列帧特效（能天使的枪口/命中、陈与玛恩纳的技能斩击）
    this.updateSeqFxList(deltaSeconds);
    // 5.35) 闪电弹道（澄闪的普攻）
    this.updateBoltFxList(deltaSeconds);
    // 5.36) 羁绊级全场扫射（拉特兰齐射）—— 到点就打出去一颗
    this.updateBoardVolley(deltaSeconds);
    // 5.4) 血镰（隐德来希：环绕转 + 横扫）
    updateLetoScytheFx(deltaSeconds);
    // 5.45) 回血光环（夜莺 / 魔王：呼吸 + 波环 + 符号）
    updateHealHaloFx(deltaSeconds);
    // 5.46) 阿米娅升变技能（慈悲愿景的方格阵 / 炉芯终曲的全场碎片 / 即死叠加）
    updateAmiyaFormFx(deltaSeconds);
    // 5.47) 蕾缪安的锁定瞄准镜 / 收缩光环 / 爆炸
    updateLockOnFx(deltaSeconds);
    // 5.48) 近战受击痕（缩放 + 淡出）
    updateMeleeHitFx(deltaSeconds);
    // 5.49) 陈「赤霄」的前方三格剑光
    updateChenThrustFx(deltaSeconds);
    // 5.5) 音符弹道（丰川祥子）
    this.updateNoteFx(deltaSeconds);
    // 5.55) 战术装置砸击（迷迭香）
    this.updateRosmonSlamFx(deltaSeconds);
    // 6) 斩击刀光（锏的技能）
    this.updateSlashFx(deltaSeconds);
    // 7) 范围爆炸（维什戴尔的大招）
    this.updateBloomFxList(deltaSeconds);

    // 7) 判断是否播完
    if (this.eventCursor >= this.result.log.length) {
      this.finished = true;
    }
  }

  /** 播放单条事件 */
  private playEvent(event: BattleResult['log'][number], fromImpactQueue = false): void {
    /*
      ★★ 0.2.1：先问一句"这条结算是不是一发**还在飞**的攻击？"
      是 ⇒ 整条事件推到命中时刻再播（血条 / 闪白 / 致死 / 闪避跟着一起走），
      这一帧什么都不做（弹道还在路上，看到掉血才是错的）。
      ★ `fromImpactQueue` 是"正在补播"的标记：从延迟队列里放出来的事件
        **绝不能再被自己推后一次**（否则永远播不出来）。
    */
    if (!fromImpactQueue && this.deferToImpactMoment(event)) return;
    switch (event.type) {
      case 'spawn': {
        /*
          战斗**中途**冒出来的棋子：召唤物（迷迭香的柱子、维娜的金狮子、
          望的棋子）和复活的队友。
          开局的那批已经在 reset 里处理过了，走到这里的一定是中途出现的。
        */
        const def = this.defs[event.defId];
        if (!def) break;
        this.createVisual(event.unitId, event.defId, def, event.star, event.team, event.cell, event.maxHp);
        // 出场反馈：复用"放技能"的金色脉冲，一眼能看出"这里刚冒出来一个东西"
        const visual = this.visuals.get(event.unitId);
        if (visual) visual.castGlow = 0.35;
        break;
      }

      case 'zone': {
        // 范围框：白框 = 范围伤害，绿框 = 回血光环（见 spawnZone 的说明）
        this.spawnZone(event);
        /*
          ★ 0.2.1：数据里写了 `fx` 的范围效果，额外播一套**专属特效**
          （隐德来希：脉冲 = 血镰环绕，溅射 = 血镰横扫）。
          ★ "这个 id 是哪种形态"只查 `leto-scythe-fx.ts` 的注册表 —— 渲染层不认 op 编号。
        */
        const mode = event.fx ? letoScytheModeOf(event.fx) : null;
        if (mode === 'aura') {
          const casterVisual = this.visuals.get(event.unitId);
          const point = casterVisual ? this.pointOf(casterVisual) : this.place(event.cell, ZONE_Y);
          spawnLetoAura(String(event.unitId), point.x, point.z, event.radius);
        } else if (mode === 'sweep') {
          const point = this.place(event.cell, ZONE_Y);
          spawnLetoSweep(point.x, point.z, event.radius);
        }
        /*
          ★★ 0.3.2 阿米娅·慈悲愿景「慈悲愿景」：3×4 方格阵 + 局部爆闪 + 三角粒子。

          【为什么挂在这里，而不是 `cast`？】用户口径是「**仅在造成伤害的那一瞬间**」。
          内核的 `emitZone` 只有 `hitAny` 才报 ⇒ 一个人都没打到的空放**不会**铺这片方块，
          而挂在 `cast` 上就会"对着空气放一片粉色"。这条差异是靠挂载点保证的，不靠判断。

          【格子怎么来的】`zoneCellsOf` 用共享层的 `withinShape` 逐格问 ——
          内核按什么规则算命中范围，这里就按什么规则画，绝不在渲染层重写一遍 rect。
        */
        if (isVerdictFx(event.fx)) {
          const cells = zoneCellsOf(event);
          if (cells.length > 0) {
            let minX = Infinity;
            let maxX = -Infinity;
            let minZ = Infinity;
            let maxZ = -Infinity;
            const specs = cells.map((cell) => {
              const point = this.place(cell, ZONE_Y);
              minX = Math.min(minX, point.x);
              maxX = Math.max(maxX, point.x);
              minZ = Math.min(minZ, point.z);
              maxZ = Math.max(maxZ, point.z);
              return { x: point.x, z: point.z, order: cell.order };
            });
            spawnVerdictGrid(specs, { minX, maxX, minZ, maxZ });
          }
        }
        /*
          ★ 0.2.1：**回血光环**（夜莺 / 魔王）**不挂在这里** ——
          它挂在 `heal` 事件上（见 `refreshHealHalo`）。
          原因：魔王 3 星的治疗是"全体每秒回血"，发的是半径 0 的框，
          照那个半径画出来只剩脚下一小圈，用户要的"光环"直接没了。
        */
        break;
      }

      case 'slash': {
        /*
          ★ 0.1.3：锏的「疯狂斩击」—— 内核每跳一次（每 0.2 秒）记一条 `slash`，
          这里就挥一刀。所以"跳一次 = 一刀"，掉血和刀光落在同一帧。
          ★ 这个事件是**纯表现层**的（不进校验和，见 shared 的 computeChecksum），
          但它由内核在真正结算的那一刻发出 —— 画面不用自己重算范围
          （渲染层只读事件流，不猜命中，见本文件顶部说明）。
        */
        this.spawnSlashFx(event.unitId, event.radius);
        break;
      }

      case 'bloom': {
        /*
          ★ 0.2：维什戴尔 3 星的 5×5 大招 —— 每一发弹药命中就在那一格炸一片。

          【为什么不能让渲染层看 `zone` 事件自己判断？】
          因为范围白框是**所有**溅射共用的（炮手羁绊、彩蛋的"周围 8 格"都会发），
          而"该播哪套爆炸"只有数据表知道。所以内核在"数据里写了 `fx`"的那一发上
          多报一条 `bloom`，把 `fx` 原样带过来 —— 这一层只查注册表，不做任何推断。
          ★ 纯表现层事件（不进校验和，见 shared 的 computeChecksum）。
        */
        this.spawnBloomFx(event.cell, event.radius, event.fx);
        break;
      }

      case 'executeFx': {
        /*
          ★★ 0.3.2：炉芯终曲「无言的期盼」**真的抹掉了一个人**。

          【为什么不能靠 `death` 事件凑合？】`death` 分不清"被打死"和"被即死"，
          两者读感完全不同：一个是"打完最后一下倒了"，一个是**人凭空被抹掉**
          （暗心 + 熔红裂隙 + 碎片外飞 + 一点白）。所以内核在 `tickExecute`
          真正杀人的那一 tick 多报一条这个事件，带的是被抹掉那个人的 id。
          ★ 纯表现层（不进校验和）。触发时机是离散的：技能开始 +2/4/6/8/10 秒。
        */
        if (!isExecuteFx(event.fx)) break;
        const victim = this.visuals.get(event.unitId);
        if (!victim) break;
        const point = this.place(victim.logicalCell, ZONE_Y);
        spawnExecuteShard(point.x, point.z);
        break;
      }

      case 'dodge': {
        // 闪避 / 免疫：卡面闪一下，"这一下没打出伤害"是看得见的
        const visual = this.visuals.get(event.targetId);
        if (!visual) break;
        visual.effects.evade = true;
        visual.effectExpiry.evade = event.t + 6;
        break;
      }

      case 'move': {
        const visual = this.visuals.get(event.unitId);
        if (!visual) break;
        visual.logicalCell = { col: event.to.col, row: event.to.row };
        visual.moveFrom = visual.visualPosition.clone();
        visual.moveTo = this.place(event.to, CARD_CENTER_Y);
        visual.moveProgress = 0;
        /*
          ★ 0.0.3：**走路**和**强制位移**分开演。

          · 走路（`tryMoveToward`，一次一格）= 滑满一个移动周期 + 播走路动作。
            滑行时长取内核周期，连续走格时首尾相接，看去就是匀速行进。
          · 强制位移（瞬移 / 击退 / 开局站位）= 保持原来那 0.18 秒的快速归位，
            **不播走路动作** —— 用户的要求是"瞬移的表现不要改"。
            顺带把它标成"没在走"，万一瞬移打断了走路，程序化走姿也会立刻收掉，
            不会出现"人已经瞬移过去了、腿还在迈步"。
        */
        const instant = event.instant === true;
        visual.moving = !instant;
        visual.stepSeconds = stepSecondsFor(instant);
        visual.walkDir = {
          x: Math.sign(event.to.col - event.from.col),
          y: Math.sign(event.to.row - event.from.row),
        };
        break;
      }

      case 'attack': {
        /*
          攻击前倾：朝目标方向冲一小步再弹回来。
          【为什么这个很重要？】
          以前 attack 事件是被忽略的 —— 只有伤害数字和受击闪光。
          结果战斗看起来像"两边站着一动不动地互相掉血"，
          完全没有"在交手"的感觉。加一个 0.18 秒的前倾，
          观感立刻就变成"在打"。
          方向由"自己 -> 目标"的格子差算出来，所以翻转视角也不会反。
        */
        const attacker = this.visuals.get(event.unitId);
        const target = this.visuals.get(event.targetId);
        if (!attacker) break;
        const from = attacker.logicalCell;
        const to = target?.logicalCell ?? from;
        const dc = Math.sign(to.col - from.col);
        const dr = Math.sign(to.row - from.row);
        attacker.lunge = LUNGE_SECONDS;
        // 记的是"视觉方向"，用来在 update 里做偏移
        attacker.lungeDir = { x: dc, y: dr };
        /*
          ★ 真实命中这一刻：用"当前攻击间隔"重设节奏，并预测下一次命中。
          之后每一拍都由"预测起手"提前前摇秒开播 —— 命中帧才会和掉血帧重合。
          这里同时兜底：预测没赶上（第一次出手/刚被打断）时就地补一次挥击。
        */
        const natural = chibiAnimSeconds(attacker.sprite, 'attack');
        if (natural !== null) {
          const interval = attackIntervalSeconds(this.liveAttackSpeed(attacker));
          attacker.swing = noteHit(
            attacker.swing,
            this.timeSeconds,
            interval,
            natural / Math.max(0.05, attacker.swing.speed),
          );
        }

        /*
          --- 远程攻击：画一条弹道线 ---
          【为什么需要？】
          远程棋子隔着好几格打人，画面上"人没动、敌人却掉血"，
          看起来很假、也看不出是谁打的。
          画一条从攻击者到目标的细线（0.16 秒淡出），立刻就能看懂。
          近战贴脸打就不用画了 —— 那会变成一圈糊在脸上的线。
        */
        const attackerDef = this.defs[attacker.defId];
        /*
          ★ 0.2：`fx === 'note'` 的是"音符弹道"（丰川祥子）。
          它自己就是一条看得见的飞行物，再画一条弹道线会变成"线 + 音符"两层，
          反而看不出是音符打过去的 ⇒ 这种情况下跳过弹道线。
          ★★ 0.2.1：判据改走注册表 `isNoteFx()` —— 因为现在有**配色变体**
          （`note` 金色 = 祥子、`note_purple` 紫色 = 八幡海铃）。
          在这里写 `=== 'note'` 的话，海铃的音符会被当成"没有专属特效"而多画一条白线。
        */
        const isNoteShot = isNoteFx(event.fx);
        /*
          ★ 0.2.1：迷迭香的**战术装置砸击**（`tracerFx: 'rosmon_slam'`）。
          它自己就是一个飞行的大件，所以同样不画白线、也不走 `TRACER_FX` 那套
          "沿弹道拉伸的贴片"——形状和运动方式都不一样。
        */
        const isSlamShot = event.fx === ROSMON_SLAM_FX;
        /*
          ★ 0.2.1：数据里写了 `tracerFx` 的（澄闪的粉色闪电）用**专属弹道**，
          就不画原来那根白线了 —— 否则会"闪电 + 白线"叠在一起。
          判据只查 `bolt-tracer-fx.ts` 的注册表，渲染层不认干员编号。
        */
        const isBoltShot = isTracerFx(event.fx);
        /*
          ★★ 0.2.1：连击的**第 2/3 段不再各打一发炮弹**。
          维什戴尔 1/2 星的 3 连击在同一 tick 报 3 条 attack（还可能飞向随机目标），
          三发炮弹同时从卡边飞出去会像三个人在开炮。只让第一段飞，
          后面两段由"延后 90ms 的命中爆炸"接上（见 `COMBO_HIT_STAGGER_SECONDS`）。
        */
        const isComboFollowUp = (event.hitIndex ?? 0) > 0;
        /*
          ★★ 0.2.1（用户口径）：**已经有自己的普攻特效的干员，不再画那根白色指示线**。
          白线原本是给"远程看不到是谁在打"兜底的；可数据里写了 `combatFx`
          （贴图版挥砍 / 枪口 / 墨爆 / 火焰…）的人本来就有明确的攻击表现，
          再叠一条白线只会把特效盖住（菲亚梅塔的炮弹那条白线最明显）。
          判据只看数据字段，渲染层不认干员编号。
        */
        const hasOwnAttackFx = attackerDef?.combatFx !== undefined;
        if (
          attackerDef &&
          attackerDef.base.range >= RANGED_ATTACK_FROM &&
          target &&
          !isNoteShot &&
          !isBoltShot &&
          !isSlamShot &&
          !hasOwnAttackFx
        ) {
          this.spawnTracer(attacker, target);
        }
        if (isNoteShot && target && event.fx) this.spawnNoteFx(attacker, target, event.fx);
        if (isSlamShot && target) this.spawnRosmonSlam(attacker, target, event.hitIndex);
        if (isBoltShot && target && event.fx && !isComboFollowUp) this.spawnBoltFx(event.fx, attacker, target);
        /*
          ★ 0.1.4：攻击特效。就挂在这一刻 —— 也就是内核结算伤害的那一 tick，
          所以"火花炸开的那一帧"和"目标掉血的那一帧"是同一帧。
          具体形状/大小/时长按单位家族走（野怪最重、干员轻快、召唤物最轻），
          见 three/attack-fx.ts。
          ★★ 0.2.1：「攻击改为治疗队友」的出手（三角初华 / 芙蓉）例外 ——
          内核给它报的 `attack` 事件 `targetId === unitId`（她"打"的其实是自己），
          真正的表现是那条飞向队友的绿色流光。命中火花要是还炸在自己脸上，
          读起来就变成"她在自残"。判据只看"目标是不是施法者本人"，
          渲染层不认干员编号。
        */
        const isHealAttack = target === attacker;
        /*
          ============================================================
          ★★ 0.2.1：「统一命中时刻」—— **全场景唯一一处**算"这一发飞多久"
          ============================================================
          用户报的"敌人还没挨打血先掉"就出在这里：以前这一整段都在 attack
          当帧画完，可炮弹要飞 0.3~0.6 秒。
          现在把这一个延迟记进 `impacts` 队列，接着由 `deferToImpactMoment()`
          把 `damage` / `death` / `dodge` 一起推到那一刻再播。
          ★ 算法本身（按弹道 id 分派、距离 ÷ 速度）在 `hit-timing.ts`，
            这里只负责"问一次、用一次"。
        */
        const impactDelay =
          attackerDef && target && !isHealAttack
            ? this.impacts.push(
                this.timeSeconds,
                event.unitId,
                event.targetId,
                projectileFlightSeconds(
                  event.fx,
                  Math.hypot(
                    target.visualPosition.x - attacker.visualPosition.x,
                    target.visualPosition.z - attacker.visualPosition.z,
                  ),
                ) +
                  /*
                    ★ 连击的第 2/3 段再加上"错开 90 毫秒"（用户口径：要连续炸三下）。
                    这一笔也必须在**命中的那个数**里，否则第 2/3 段的掉血会和第一段同一帧。
                  */
                  Math.max(0, event.hitIndex ?? 0) * COMBO_HIT_STAGGER_SECONDS,
              )
            : 0;
        if (attackerDef && !isHealAttack) {
          if (impactDelay > 0) {
            // 出手这一刻：只画"枪口"（落在攻击者脚下的那半）
            this.spawnAttackFx(attacker, target ?? null, attackerDef, 'muzzle');
            // 命中这一刻：爆点 / 冲击环 / 近战弧 —— 到点再画（位置那时再取）
            this.pendingImpactFx.push({
              at: this.timeSeconds + impactDelay,
              attackerId: event.unitId,
              targetId: event.targetId,
            });
          } else {
            this.spawnAttackFx(attacker, target ?? null, attackerDef);
          }
        }
        /*
          ★ 0.2.1：贴图版攻击特效（能天使的枪口火光 + 命中火花）。
          只在数据写了 `combatFx`、或这个人正处在"技能生效期"时才播 ——
          两者都没有的话上面那套程序化特效就是全部，行为不变。
          ★ 治疗型出手传 `null` 目标：命中层是"打在谁身上"，这里没有"谁"。
          ★ `impactDelay` 传进去：枪口当帧、命中层按同一个数推后（唯一实现）。
        */
        const hitIds = this.playCombatSeqFx(
          event,
          attacker,
          isHealAttack ? null : (target ?? null),
          impactDelay,
        );
        /*
          ★★ 0.2.2：近战命中 ⇒ 在**挨打的人**身上补一道斩击痕（颜色跟着这一下的斩击走）。
          ★ 走的延迟和上面完全同一个 `impactDelay`：多段攻击的第 2/3 段才不会叠在同一帧。
        */
        this.spawnMeleeHit(
          attacker,
          isHealAttack ? null : (target ?? null),
          attackerDef ?? null,
          hitIds,
          impactDelay,
        );
        break;
      }

      case 'attackLink': {
        /*
          ★ 0.2.1：一次攻击"额外打到"的那些人（"额外攻击 1/2 名敌人"）。
          它没有自己的 `attack` 事件，所以内核补了一条**纯表现**事件 ——
          这里照着连第二条弹道，否则屏幕上只有一条线。
        */
        const source = this.visuals.get(event.sourceId);
        const victim = this.visuals.get(event.targetId);
        if (source && victim && isTracerFx(event.fx) && event.fx) {
          this.spawnBoltFx(event.fx, source, victim);
        }
        /*
          ★★ 0.2.2：**额外目标**（"额外攻击 1/2 名敌人"）也要有受击痕。
          它们没有自己的 `attack` 事件，如果只在 `case 'attack'` 里挂受击痕，
          一个近战干员同时砍三个人时，只有一个会"挨刀的痕迹"。
          ★ 颜色仍然走同一个解析器：技能生效期用技能那套斩击的 id，否则回落到 `combatFx`。
        */
        if (source && victim) {
          const activeSkillFx = this.skillAttackFx.get(source.unitId);
          const ids =
            activeSkillFx && this.timeSeconds <= activeSkillFx.until ? activeSkillFx.ids : [];
          this.spawnMeleeHit(source, victim, this.defs[source.defId] ?? null, ids, 0);
        }
        break;
      }

      case 'lockOnMark': {
        /*
          ★★ 0.2.2：蕾缪安 3 星「强制追思」——**锁住一个地块**。

          【演出分两层，都挂在这个地块上】
            ① 贴地的**狙击镜**（十字线 + 刻度 + 四角括号，慢慢自转）；
            ② 两圈**粉色光环循环向内收缩**（错开半圈，一波接一波往里收）。
          一直到 7 秒后引爆才收掉 —— "活多久"由内核递过来的 `ticksLeft` 决定
          （= 到引爆还剩几秒），渲染层不用反推技能参数。
          ★ 纯表现事件，不进校验和。
        */
        const point = this.place(event.cell, ZONE_Y);
        const seconds = event.ticksLeft / TICKS_PER_SECOND;
        spawnLockOnMark(point.x, point.z, event.fx, seconds);
        break;
      }

      case 'lockOnBlast': {
        /*
          ★★ 0.2.2：同上，**引爆一个落点**（7 个落点各一条）。
          粉色为主、外缘转金的一团光 + 金色冲击波 + 一圈碎屑。
          ★ 不能靠 `zone` 事件播 —— 落点空了 `damageArea` 一条 zone 都不发，
            "炸了但没打到人"就完全看不见（见 types.ts 里这条事件的说明）。
        */
        const point = this.place(event.cell, 0);
        spawnLockOnBurst(point.x, point.z, event.fx, event.radius);
        break;
      }

      case 'cast': {
        /*
          ★★ 0.2.1：**羁绊级施法**（拉特兰齐射）—— 先分流，别走下面那套"棋子放技能"。

          【为什么必须在最前面？】下面三件事对它是**错的**：
            · `caster.mana = 0` —— 羁绊齐射一点法力都没花（它靠"全队打了 30 下"触发），
              清零会让技能条凭空归零，下一发技能莫名其妙延后；
            · `spawnSkillCast` —— 那一圈金色符文环是"棋子开技能"的通用演出，
              齐射的演出是**整块棋盘**的子弹雨，再叠一圈环会读成"这个人偷偷开了技能"；
            · `spawnSkillSeqFx` —— `fx` 是技能专属的，齐射没有。
          所以这里直接转去播全场层，然后 `break`。
          ★ 触发者可能**恰好在同一 tick 死了**（齐射是打中第 30 下时顺手结算的），
            所以这里不拿 caster 当必要条件 —— 方向由"哪一队"决定，见 spawnBoardVolley。
        */
        if (event.traitCast) {
          this.spawnBoardVolley(event.boardFx, event.unitId);
          break;
        }
        // 放技能：一圈金色脉冲（用缩放 + 短暂"放大"替代真正的特效）
        const caster = this.visuals.get(event.unitId);
        if (!caster) break;
        caster.castGlow = 0.35;
        caster.castCount++;
        // 放完技能法力清零（内核也是这么做的），界面上表现为"技能条空了、重新充"
        caster.mana = 0;
        /*
          ★★ 0.2.1：通用的「技能释放」特效（起手收光 → 爆闪 → 持续 → 收尾）。
          ★ 用户口径：「被动技能不要有这个特效」—— 闸门在 spawnSkillCast 里
            （`hasActiveSkill`）：纯被动的棋子（夜莺的光环、若叶睦的锁血…）
            本来就不会产生 `cast` 事件，这里再挡一道，fever 那种"自动施放"
            和以后新增的内核施法路径也都绕不过去。
        */
        this.spawnSkillCast(caster);
        /*
          ★★ 0.2.2：**前方 3 格的剑光**（陈「赤霄」）—— 程序化的一整套，走专属通道。
          ★ 为什么不塞进 `SKILL_FX`：那套是"按帧切图"的序列帧，而这一招是
            **沿一个方向铺 3 格**的几何效果，长度直接跟着技能数据走 ——
            出贴图得按 3 格宽手绘一整条长图，改一次长度就得重画。
          ★ 朝向 = 卡面 → 最近的敌人（技能本身就是朝目标前方打）。
        */
        if (isChenThrustFx(event.fx)) {
          const aim = this.nearestEnemyPointOf(caster);
          const dx = aim.x - caster.visualPosition.x;
          const dz = aim.z - caster.visualPosition.z;
          const yaw = Math.abs(dx) + Math.abs(dz) < 1e-6 ? 0 : Math.atan2(-dz, dx);
          spawnChenThrust(caster.visualPosition.x, caster.visualPosition.z, yaw);
        }
        /*
          ★ 0.2.1：数据里写了 `castFx` 的，再加一套**专属施法演出**
          （陈的瞬移+连斩底、玛恩纳的起手光环+金色斩击+小雨滴、能天使的爆燃首枪）。
          没有 `castFx` 的干员只有上面那一圈通用符文环 —— 和原来完全一样。
          ★ 程序化那一招没有 `SKILL_FX` 条目，`spawnSkillSeqFx` 会自己早退。
        */
        this.spawnSkillSeqFx(caster, event.fx);
        /*
          ★★ 0.3.2：**程序化**的技能专属演出（阿米娅·炉芯终曲「无言的期盼」）。
          和 `SKILL_FX`（序列帧）并列的另一条通道：挂在同一个 `castFx` 字符串上，
          谁有注册表谁就播 —— 数据仍然只说一句"这次施法该是那套"。
          ★ 时长读技能数据（和通用符文环、序列帧用的是同一个函数），不写死 10 秒：
            以后改了 `durationTicks`，氛围会跟着变长变短。
        */
        if (isRequiemFx(event.fx)) {
          const def = this.defs[caster.defId];
          if (def) {
            const variant = skillVariantOf(def, caster.star);
            spawnRequiemAmbient(
              skillCastSustainSecondsOf([...variant.effects, ...(variant.battleStart ?? [])], caster.star),
            );
          }
        }
        break;
      }

      case 'mana': {
        // 法力变化 —— 界面上就是"技能条在涨"
        const visual = this.visuals.get(event.unitId);
        if (!visual) break;
        visual.mana = event.manaAfter;
        break;
      }

      case 'shield': {
        // 护盾：卡面上加一层青色半透明 + 盾牌图标；数值累计起来给详情面板显示
        const visual = this.visuals.get(event.targetId);
        if (!visual) break;
        visual.effectExpiry.shield = event.t + event.durationTicks;
        visual.shield += event.amount;
        break;
      }

      case 'buff': {
        const visual = this.visuals.get(event.targetId);
        if (!visual) break;
        if (event.stat === 'attackSpeed') {
          visual.effectExpiry.attackSpeed = event.t + event.durationTicks;
        } else {
          visual.effectExpiry.attackDamage = event.t + event.durationTicks;
        }
        // ★ 0.0.3：同时记进"实时数值"那一层（点开棋子要看到真实的攻速/攻击）
        const list = this.liveBuffs.get(event.targetId) ?? [];
        list.push({ stat: event.stat, bonusBp: event.bonusBp, untilTick: event.t + event.durationTicks });
        this.liveBuffs.set(event.targetId, list);
        break;
      }

      case 'aura': {
        /*
          ★ 重装的"护甲总和分给全队"是 t=0 的光环事件。
          它**已经**被 createBattle 加到 unit.armor 上了（见 rules.ts 的
          applyStartOfBattleMechanics），而我们的基线正是从"createBattle 之后的状态"
          算出来的 —— 所以这里**不能再加一遍**，否则重装的护甲会显示成两倍
          （这也是"详情页面数据过大"的一个来源）。
          事件本身照样留着：羁绊日志/结算回执都要读它。
        */
        break;
      }

      case 'status': {
        const visual = this.visuals.get(event.targetId);
        if (!visual) break;
        if (event.status === 'stun') visual.effectExpiry.stun = event.t + event.durationTicks;
        break;
      }

      case 'damage': {
        const visual = this.visuals.get(event.targetId);
        if (!visual) break;
        visual.hp = event.hpAfter;
        // 这一下被护盾吃掉的量要减掉，否则界面上的盾值只增不减
        if (event.absorbed > 0) visual.shield = Math.max(0, visual.shield - event.absorbed);
        visual.hitFlash = 0.14;
        // ★ 0.2.1：这一下把人打死了 ⇒ 补一张"击杀加强版"命中（比普通命中大一档）
        if (event.lethal) this.playKillSeqFx(event.targetId);
        // 血量一变就刷新卡片上的血条
        const def = this.defs[visual.defId];
        if (def) {
          updateUnitSprite(visual.sprite, def, visual.maxHp > 0 ? visual.hp / visual.maxHp : 0, visual.effects);
        }
        break;
      }

      case 'heal': {
        const visual = this.visuals.get(event.targetId);
        if (!visual) break;
        visual.hp = event.hpAfter;
        const def = this.defs[visual.defId];
        if (def) {
          updateUnitSprite(visual.sprite, def, visual.maxHp > 0 ? visual.hp / visual.maxHp : 0, visual.effects);
        }
        /*
          ★ 0.2.1：治疗流光（绿色）——数据里写了 `UnitDef.healFx` 的干员才有
          （古米 / 芙蓉）。判据只看数据，渲染层不认干员编号。
        */
        this.playHealFx(event.sourceId, event.targetId);
        /*
          ★★ 0.2.1：**回血光环**（夜莺绿 / 魔王粉）—— 数据里写了 `UnitDef.healHaloFx` 才有。
          和流光不同，光环"自己奶自己也该有"（那是光环，不是射出去的光带），
          所以这一句放在 `playHealFx` 外面，不受"源 == 目标就跳过"那条限制。
        */
        this.refreshHealHalo(event.sourceId);
        break;
      }

      case 'death': {
        const visual = this.visuals.get(event.unitId);
        if (!visual) break;
        visual.dead = true;
        visual.hp = 0;
        const def = this.defs[visual.defId];
        if (def) updateUnitSprite(visual.sprite, def, 0, NO_EFFECTS);
        break;
      }

      /*
        ★ 0.0.3：Boss 的「倒地等复活」与「站起来进二阶段」。
        倒地**不是死亡**（不走死亡动画的缩小消失，精灵留在原地），
        只是把动作切成阵亡并停在最后一帧；站起来时才换形态/换素材。
      */
      case 'downed': {
        const visual = this.visuals.get(event.unitId);
        if (!visual) break;
        visual.downed = true;
        visual.hp = 0;
        /*
          ★ 阵亡动作只播到"倒地姿势"就停住 —— 否则整只人会化掉，看起来像模型丢了。
          倍率取数据里的 `reborn.downedAnimSpeed`（杰斯顿 2 倍速：它的阵亡动作
          有 4 秒，而倒地只等 3 秒，原速播"还没倒稳就到点了"）。
        */
        const def = this.defs[visual.defId];
        setChibiDowned(visual.sprite, true, def?.reborn?.downedAnimSpeed ?? 1);
        if (def) updateUnitSprite(visual.sprite, def, 0, visual.effects);
        break;
      }

      case 'rebirth': {
        const visual = this.visuals.get(event.unitId);
        if (!visual) break;
        visual.downed = false;
        visual.dead = false;
        visual.deathProgress = 0;
        visual.hp = event.hpAfter;
        // 换阶段可能改了生命上限（奎隆二阶段 -30%），血条要按新的算
        if (event.maxHp > 0) visual.maxHp = event.maxHp;
        const def = this.defs[visual.defId];
        if (def) {
          updateUnitSprite(visual.sprite, def, visual.maxHp > 0 ? visual.hp / visual.maxHp : 0, visual.effects);
        }
        /*
          换形态的两条路：
            · 有独立二阶段素材（“盛怒”）-> 整个换一套素材
            · 只是同一套骨架里的另一批动作（两个 Boss）-> 切到 idle2/attack2/…
        */
        if (event.artId) setChibiSource(visual.sprite, event.artId, def);
        setChibiPhase(visual.sprite, event.phase);
        // 站起来：关掉"倒地姿势"的冻结，并立刻切回待机（先切阶段再解冻也行，
        // 两个函数都是幂等的，谁先谁后结果一样）
        setChibiDowned(visual.sprite, false);
        break;
      }

      // 其余事件（mana / end）不改动画面
      default:
        break;
    }
  }

  // ============================================================
  //  ★★ 0.2.1：「统一命中时刻」（用户口径 · 方案 A）
  // ============================================================

  /**
   * 这条结算事件是不是"一发还在飞的攻击"？是就推到命中时刻再播。
   *
   * 【口径】
   *   · `attack` 当帧该发生的（前倾 / 挥击 / 枪口 / 弹道飞出）—— **已经发生了**，
   *     就在上面那个 `case 'attack'` 里；
   *   · 命中那一下该发生的（掉血、闪白、致死、闪避弹字）—— 全部**推后** `flight` 秒。
   *
   * 【为什么按 `attackType` 而不是按"之前 0.1 秒内有没有 attack"猜？】
   * 因为内核把"这一下是普攻结算还是技能结算"直接写在事件里了
   * （`dealDamage(..., 'attack')` 只出现在普攻那条路上，溅射/技能/持续伤害都是 `'spell'`）。
   * 用现成字段比猜时间窗可靠得多 —— 猜时间窗会把"技能刚好在普攻后 0.1 秒结算"
   * 误判成同一次命中，那才是真正的错。
   *
   * @returns 已推后 ⇒ `true`（调用方这一帧什么都别做）
   */
  private deferToImpactMoment(event: BattleResult['log'][number]): boolean {
    switch (event.type) {
      case 'damage': {
        // 只有"普攻结算"才等弹道；技能 / 溅射 / 持续伤害当场掉血
        if (event.attackType !== 'attack') return false;
        const at = this.impacts.claim(this.timeSeconds, event.sourceId, event.targetId);
        if (at === null) return false;
        this.pendingImpactEvents.push({ at, event });
        /*
          ★ 致死要单独记一笔：`death` 事件里**没有 sourceId**，
          只能靠刚才这次认领的结果把"什么时候才该演死"带过去。
          不这么做就会"血条还在，人已经缩没了"（掉血推后了、死亡没有）。
        */
        if (event.lethal) this.pendingDeathAt.set(event.targetId, at);
        return true;
      }
      case 'dodge': {
        /*
          闪避 / 免疫也是"命中那一刻"才知道的事 —— 弹道都还没到就先闪一下，
          看起来像"隔空闪避"。`dodge` 自带 sourceId/targetId，配对规则和 damage 一样。
        */
        const at = this.impacts.claim(this.timeSeconds, event.sourceId, event.targetId);
        if (at === null) return false;
        this.pendingImpactEvents.push({ at, event });
        return true;
      }
      case 'death': {
        const at = this.pendingDeathAt.get(event.unitId);
        if (at === undefined) return false;
        this.pendingDeathAt.delete(event.unitId);
        if (!(at > this.timeSeconds + IMPACT_MIN_DELAY_SECONDS)) return false;
        this.pendingImpactEvents.push({ at, event });
        return true;
      }
      default:
        return false;
    }
  }

  /**
   * 每帧把"到点了"的命中表现放出来。
   *
   * @param force 战斗已经结束 ⇒ **立刻放完**（那时 `timeSeconds` 不再推进，
   *              不强行放的话最后几发炮弹的掉血永远不会出现）
   *
   * ★ 顺序：先血条/死亡，再爆点 —— 同一帧里"人先掉血、火花跟着炸"，
   *   和逻辑上的因果顺序一致（反过来会让火花像是凭空出现的）。
   */
  private flushImpactMoment(force: boolean): void {
    if (this.pendingImpactEvents.length > 0) {
      const due: Array<{ at: number; event: BattleResult['log'][number] }> = [];
      this.pendingImpactEvents = this.pendingImpactEvents.filter((item) => {
        if (!force && item.at > this.timeSeconds) return true;
        due.push(item);
        return false;
      });
      // 保持日志顺序（同一帧到点的那几条按原顺序播）
      for (const item of due) this.playEvent(item.event, true);
    }

    if (this.pendingImpactFx.length > 0) {
      const due: Array<{ at: number; attackerId: number; targetId: number | null }> = [];
      this.pendingImpactFx = this.pendingImpactFx.filter((item) => {
        if (!force && item.at > this.timeSeconds) return true;
        due.push(item);
        return false;
      });
      for (const item of due) {
        const attacker = this.visuals.get(item.attackerId);
        if (!attacker) continue;
        const def = this.defs[attacker.defId];
        if (!def) continue;
        const target = item.targetId === null ? null : (this.visuals.get(item.targetId) ?? null);
        // ★ 位置是**现在**的（飞到的时候双方可能都挪了格子），所以只能到点再取
        this.spawnAttackFx(attacker, target, def, 'impact');
      }
    }

    /*
      ★★ 0.2.2：到点的**近战受击痕**（多段攻击的第 2/3 段走这条）。
      位置也在这时候取 —— 90 毫秒里人可能已经挨了别的打、被击退了。
    */
    if (this.pendingMeleeHit.length > 0) {
      const dueHit: typeof this.pendingMeleeHit = [];
      this.pendingMeleeHit = this.pendingMeleeHit.filter((item) => {
        if (!force && item.at > this.timeSeconds) return true;
        dueHit.push(item);
        return false;
      });
      for (const item of dueHit) {
        const attacker = this.visuals.get(item.attackerId);
        const target = this.visuals.get(item.targetId);
        if (!attacker || !target) continue;
        this.drawMeleeHit(attacker, target, item.style);
      }
    }

    this.impacts.prune(this.timeSeconds);
  }

  /**
   * ★ 0.1.4：刷新这张卡面上的技能条（血条下面那条细的）。
   *
   * 【它为什么能算出来，而不需要内核额外发消息？】
   * 因为两半数据都已经在客户端手上了：
   *   · **总量**来自技能数据（`skillWindowDurationOf`：按时间 / 按次数）；
   *   · **剩余量**来自属性时间线（`effectsAt` 已经帮我们把时间型的往下数好、
   *     次数型的取最新一条）。
   * 所以这一层一个字节的战斗逻辑都不用改，确定性与校验和自然不受影响。
   *
   * 【哪些棋子没有这条？】
   *   · 纯被动干员（没有"要攒蓝才能放"的技能）—— 一辈子都是空的，画出来是干扰；
   *   · 已经阵亡 / 倒地等复活的 —— 状态条跟着人一起收起来。
   * 两件事分别在 skill-bar.ts 和这里判，别的调用点不用管。
   */
  private updateSkillBar(visual: UnitVisual, currentTick: number): void {
    const def = this.defs[visual.defId];
    if (!def) return;
    if (visual.dead || visual.downed) {
      setUnitSkillBar(visual.sprite, null);
      return;
    }
    const state = skillBarOf({
      def,
      star: visual.star,
      // 法力条就是"技能攒到多少了"——满蓝就放，放完清零（内核也是这么做的）
      manaRatio: visual.mana / MANA_MAX,
      effects: effectsAt(this.statsTimeline, visual.unitId, currentTick),
    });
    setUnitSkillBar(visual.sprite, state);
  }

  /**
   * 状态到期检查 + 卡面重画。
   *
   * 【为什么要单独一步？】
   * 战斗日志里只有"什么时候给上了状态"（shield / buff / status 事件），
   * **没有"什么时候结束"** —— 结束时间要用事件里的 durationTicks 自己算。
   * 所以每帧拿当前 tick 和记录里的到期 tick 比一次，
   * 一旦有状态消失，就重画那张卡面（把特效去掉）。
   */
  private refreshEffects(visual: UnitVisual, currentTick: number): void {
    const expiry = visual.effectExpiry;
    const next: UnitEffectFlags = {
      shield: currentTick < expiry.shield,
      attackSpeed: currentTick < expiry.attackSpeed,
      attackDamage: currentTick < expiry.attackDamage,
      stun: currentTick < expiry.stun,
      evade: currentTick < expiry.evade,
    };
    // 状态没变就不重画（updateUnitSprite 内部也会再判一次，这里先挡掉省函数调用）
    if (
      next.shield === visual.effects.shield &&
      next.attackSpeed === visual.effects.attackSpeed &&
      next.attackDamage === visual.effects.attackDamage &&
      next.stun === visual.effects.stun &&
      next.evade === visual.effects.evade
    ) {
      return;
    }
    visual.effects = next;
    // 盾到期了就把数值也清零 —— 不然详情面板上会挂着一个"看不见的盾还剩 300"
    if (!next.shield) visual.shield = 0;
    const def = this.defs[visual.defId];
    if (!def) return;
    updateUnitSprite(visual.sprite, def, visual.maxHp > 0 ? visual.hp / visual.maxHp : 0, next);
  }

  /**
   * 生成一条远程攻击的弹道线。
   *
   * 【实现方式：地板上的一条细亮线】
   * 没有用"飞行的小球"，因为棋子是永远面朝相机的 2D 贴片，
   * 一个在空中飞的小球在斜视角下很难看清落点。
   * 贴着地面画一条线更直观：**从谁打到谁一目了然**，
   * 而且它天然贴合这个"俯视棋盘"的视角。
   */
  private spawnTracer(attacker: UnitVisual, target: UnitVisual): void {
    const from = attacker.visualPosition;
    const to = target.visualPosition;
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const length = Math.hypot(dx, dz);
    if (length < 0.01) return;

    // ★ 队伍色和攻击特效共用同一对（只在 attack-fx.ts 定义一处），这里不再写十六进制
    const color = FX_TEAM_COLORS[attacker.team === 1 ? 1 : 0];
    const material = new LineBasicMaterial({ color, transparent: true, opacity: 0.9 });
    const geometry = new BufferGeometry().setFromPoints([
      new Vector3(from.x, TRACER_Y, from.z),
      new Vector3(to.x, TRACER_Y, to.z),
    ]);
    const line = new Line(geometry, material);
    this.fxLayer.add(line);
    this.tracers.push({ line, material, geometry, life: TRACER_SECONDS });
  }

  /** 弹道线的淡出（每帧调一次） */
  private updateTracers(deltaSeconds: number): void {
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const tracer = this.tracers[i]!;
      tracer.life -= deltaSeconds;
      if (tracer.life <= 0) {
        this.fxLayer.remove(tracer.line);
        tracer.geometry.dispose();
        tracer.material.dispose();
        this.tracers.splice(i, 1);
        continue;
      }
      tracer.material.opacity = (tracer.life / TRACER_SECONDS) * 0.9;
    }
  }

  // ============================================================
  // ★ 0.1.4：攻击特效（干员 / 野怪 / 召唤物 三套预设）
  // ============================================================

  /**
   * 生成一次攻击特效。
   *
   * 【触发时机】在 `attack` 事件处调用 = **内核结算伤害的那一 tick**。
   * 而 `attack-anim.ts` 已经把挥击动作提前起手排好（命中帧落在动作的 45% 处），
   * 所以"特效出现在刀真正打到的那一帧"是白拿的 —— 不用自己算时间，
   * 也天然跟着攻速缩放（攻速快 → 命中密 → 特效也密）。
   *
   * 【为什么挂在 `attack` 事件上、而不是自己攒计时器？】
   * 战斗回放是**按 tick 重放事件流**的。特效挂在事件流上，
   * "两倍速播放 / 断线重连后从中间接上 / 看录像"全都会自动正确 ——
   * 自己开 `setTimeout` 这三条全都错。
   *
   * 具体"多大、多久、落在谁脚下"由 `attack-fx.ts` 按单位家族决定
   * （野怪最重、干员轻快、召唤物最轻），这里只负责把三块贴地几何摆上去：
   * **贴地弧**（队伍色）+ **命中爆点**（白色）+ **冲击环**（只有野怪有）。
   *
   * ★★ 0.2.1（统一命中时刻）新增 `phase`：
   * 这三块贴地的几何其实属于**两个时刻** ——
   *   · 远程的「贴地弧」是**枪口闪光**，落在攻击者脚下 ⇒ 出手那一刻就该亮；
   *   · 「命中爆点」「冲击环」（以及近战的弧）落在目标身上 ⇒ 要等弹道飞到。
   * 以前两者一起在 attack 当帧画，于是炮弹还在半路、敌人脚下已经白了一下。
   * 现在由调用方分两次调：`'muzzle'` 立刻、`'impact'` 等 `projectileFlightSeconds`。
   * `'all'` = 一次画全（没有飞行时间的近战/白线/能量流，行为和以前完全一样）。
   */
  private spawnAttackFx(
    attacker: UnitVisual,
    target: UnitVisual | null,
    def: UnitDef,
    phase: 'all' | 'muzzle' | 'impact' = 'all',
  ): void {
    const preset = attackFxPresetFor(def, { range: def.base.range });
    /*
      ★ 弧和冲击环用**提亮的**队伍色（近白），不是弹道线那对原始色。
      原因：棋盘左右半场本身就是蓝/红底色，直接同色画贴地大特效会"红弧压红场"，
      对比度低到读不出来（真机截图确认过）。详见 attack-fx.ts 的 FX_GLOW_COLORS。
    */
    const glowColor = FX_GLOW_COLORS[attacker.team === 1 ? 1 : 0];

    /*
      ★ 上限保护：满编对轰时（攻速上限 4 倍 = 每 0.25 秒每人一下）
      每秒能产出几十个特效。需求清单里写过"20 个棋子 + 技能特效，弱电脑掉到 15fps"，
      所以超了就把**最老的那个**丢掉 —— 丢老的不会让人看出"少了一下"，
      丢新的才会（玩家看到的是"最后那一下没打出火花"）。
    */
    while (this.attackFx.length >= MAX_LIVE_ATTACK_FX) {
      const oldest = this.attackFx.shift();
      if (oldest) this.disposeAttackFx(oldest);
    }

    const parts: AttackFxPart[] = [];

    /** 摆一块贴地的弧/环/爆点 */
    const addFlat = (
      kind: AttackFxPart['kind'],
      x: number,
      z: number,
      geometry: BufferGeometry,
      color: number,
      opacity: number,
      yaw: number,
    ): void => {
      const material = new MeshBasicMaterial({
        color,
        transparent: true,
        opacity,
        // 贴地的薄片从上方看，两面都可能朝上；不写 DoubleSide 会有一半时候看不见
        side: DoubleSide,
        // 关键：不写深度 = 不遮挡后面的棋子，只靠 ZONE_Y 那一点点高度分先后
        depthWrite: false,
      });
      const mesh = new Mesh(geometry, material);
      // RingGeometry / CircleGeometry 都在 XY 平面上，转 -90° 才是贴地
      mesh.rotation.x = -Math.PI / 2;
      const holder = new Group();
      holder.position.set(x, kind === 'burst' ? ZONE_Y + 0.01 : ZONE_Y, z);
      // 弧要对着"打过去"的方向：爆点和环是圆的，转不转都一样，统一转省一个分支
      holder.rotation.y = yaw;
      /*
        ★ 打上标记，`?debug=1` 的攻击特效探针靠它统计
        （`__airnightAttackFxProbe.sample()`）—— 没有它，"真打的时候到底有没有冒火花"
        这件事就只能靠肉眼盯截图，而单帧截图恰恰看不出"有没有存在过"。
      */
      holder.userData['airnightAttackFx'] = { kind, family: preset.family };
      holder.add(mesh);
      this.fxLayer.add(holder);
      parts.push({ holder, geometry, material, kind, baseYaw: yaw, opacity });
    };

    /** 从 a 指向 b 的世界方向算出的 yaw（让 Group 的 +X 轴指向 b） */
    const aimYaw = (a: UnitVisual, b: UnitVisual | null): number => {
      const from = a.visualPosition;
      const to = b?.visualPosition ?? from;
      const dx = to.x - from.x;
      const dz = to.z - from.z;
      if (Math.abs(dx) < 1e-4 && Math.abs(dz) < 1e-4) return 0;
      // 绕 Y 转 φ 后局部 +X 指向 (cosφ, -sinφ)，所以要取 -dz
      return Math.atan2(-dz, dx);
    };

    // ① 贴地弧：近战落在目标身上（斩击扫过），远程留在攻击者脚下（枪口闪光）
    if (preset.arcAt !== 'none' && target) {
      const anchor = preset.arcAt === 'attacker' ? attacker : target;
      /*
        ★ 弧的锚点决定它属于哪个时刻（见方法头的 `phase` 说明）：
          attacker 锚点 = 枪口 ⇒ 只在 `'muzzle'` / `'all'` 时画；
          target   锚点 = 斩击 ⇒ 只在 `'impact'` / `'all'` 时画。
      */
      const arcPhaseMatches =
        phase === 'all' || (phase === 'muzzle') === (preset.arcAt === 'attacker');
      if (arcPhaseMatches) {
        const radius = BASE_ARC_RADIUS * preset.arcScale;
        const geometry = new RingGeometry(
          radius * ARC_INNER_RATIO,
          radius,
          20,
          1,
          -ARC_SPAN_RADIANS / 2,
          ARC_SPAN_RADIANS,
        );
        addFlat('arc', anchor.visualPosition.x, anchor.visualPosition.z, geometry, glowColor, 1, aimYaw(anchor, target));
      }
    }

    // ② 命中爆点：白色的小圆，标出"打中的是哪一点"（只在命中时刻画）
    if (preset.burstAt !== 'none' && target && phase !== 'muzzle') {
      const anchor = preset.burstAt === 'attacker' ? attacker : target;
      const geometry = new CircleGeometry(BASE_BURST_RADIUS * preset.burstScale, 16);
      addFlat('burst', anchor.visualPosition.x, anchor.visualPosition.z, geometry, FX_BURST_COLOR, 1, 0);
    }

    // ③ 冲击环：野怪独有的"砸在地上"那一层（命中时刻）
    if (preset.ringScale > 0 && phase !== 'muzzle') {
      const anchor = target ?? attacker;
      const geometry = new RingGeometry(
        BASE_RING_RADIUS * preset.ringScale * 0.78,
        BASE_RING_RADIUS * preset.ringScale,
        28,
      );
      addFlat('ring', anchor.visualPosition.x, anchor.visualPosition.z, geometry, glowColor, 0.62, 0);
    }

    if (parts.length === 0) return;
    this.attackFx.push({ parts, duration: preset.duration, life: preset.duration, alpha: preset.alpha });
  }

  /** 每帧推进所有攻击特效（缩放曲线 + 淡出 + 到期回收） */
  private updateAttackFx(deltaSeconds: number): void {
    for (let i = this.attackFx.length - 1; i >= 0; i--) {
      const fx = this.attackFx[i]!;
      fx.life -= deltaSeconds;
      if (fx.life <= 0) {
        this.disposeAttackFx(fx);
        this.attackFx.splice(i, 1);
        continue;
      }
      // 0 → 1 的进度（life 从 duration 走到 0）
      const progress = 1 - fx.life / fx.duration;
      for (const part of fx.parts) {
        const scale =
          part.kind === 'arc' ? arcScaleAt(progress) : part.kind === 'burst' ? burstScaleAt(progress) : ringScaleAt(progress);
        part.holder.scale.setScalar(scale);
        part.material.opacity = fxOpacityAt(progress, fx.alpha) * part.opacity;
        // 弧额外"扫过去"一点 —— 这是"斩击"和"地上亮了一下"的区别（见 attack-fx 的 ARC_SWEEP_RADIANS）
        if (part.kind === 'arc') part.holder.rotation.y = part.baseYaw + arcSweepAt(progress);
      }
    }
  }

  /** 清掉所有攻击特效（重开一局时必须做，否则薄片会残留在棋盘上） */
  private clearAttackFx(): void {
    for (const fx of this.attackFx) this.disposeAttackFx(fx);
    this.attackFx.length = 0;
  }

  /** 把一组特效从场景里摘掉并释放显存（Three.js 不会自动回收几何体和材质） */
  private disposeAttackFx(fx: AttackFxEntry): void {
    for (const part of fx.parts) {
      this.fxLayer.remove(part.holder);
      part.geometry.dispose();
      part.material.dispose();
    }
  }

  /** 测试/调试用：现在场上有几组攻击特效（e2e 用它确认"真打的时候真的冒火花了"） */
  liveAttackFxCount(): number {
    return this.attackFx.length;
  }

  // ============================================================
  //  ★★ 0.2.1：通用「技能释放」特效
  // ============================================================

  /**
   * 在施法者脚下摆一套技能特效。
   *
   * ============================================================
   *  【为什么被动技能一定要排除？】
   * ============================================================
   * 用户口径（2026-10-17）：「被动技能不要有这个特效」。
   * 纯被动的棋子（夜莺的光环、若叶睦的锁血、玛恩纳 3 星的常驻…）**没有"施法"这件事**，
   * 它们的效果是开局烘上去的常驻包。给它们画一圈"开技能"的光，
   * 玩家会以为这个技能要攒蓝、要按时机放 —— 那是错的。
   *
   * 判据用 shared 的 `hasActiveSkill`（技能条读的也是它）：
   * `skillVariantOf(def, star).effects.length > 0` 才算"有主动技能"。
   * ★ 用这个判据还顺手挡住了 fever 那种"自动施放"—— 它走的也是 castSkill，
   *   但只有真有主动效果的棋子才会被 fever 触发，所以语义上正好。
   */
  private spawnSkillCast(caster: UnitVisual): void {
    const def = this.defs[caster.defId];
    // ★ 被动技能不放（见上面这段说明）
    if (!def || !hasActiveSkill(def, caster.star)) return;

    /*
      持续多久：从**技能数据**里读最长的一条 `durationTicks`（`skillCastSustainSecondsOf`）。
      纯伤害/治疗/召唤类没有"持续"字段 ⇒ 0 秒 ⇒ 只有"起手 + 爆闪 + 收尾"，
      不会出现"打一下就冒出十几秒光环"。
    */
    const sustain = skillCastSustainSecondsOf(skillVariantOf(def, caster.star).effects, caster.star);
    const total = skillCastTotalSeconds(sustain);

    // 上限保护：和攻击特效同一条规矩 —— 超了丢最老的（丢老的看不出"少了一下"）
    while (this.skillCastFx.length >= SKILL_CAST_MAX_LIVE) {
      const oldest = this.skillCastFx.shift();
      if (oldest) disposeSkillCastVisual(oldest.visual);
    }

    const visual = createSkillCastVisual();
    visual.group.position.set(caster.visualPosition.x, ZONE_Y, caster.visualPosition.z);
    applySkillCastFrame(visual, skillCastFrameAt(0, sustain));
    // 给探针留一份"这是谁、多长"，`?debug=1` 能直接读出来
    visual.group.userData['airnightSkillCast'] = { unitId: caster.unitId, sustain, total };
    this.fxLayer.add(visual.group);
    this.skillCastFx.push({ unitId: caster.unitId, visual, elapsed: 0, sustain, total });
  }

  /** 每帧推进（位置跟着施法者、参数按时间重算、到期回收） */
  private updateSkillCastFx(deltaSeconds: number): void {
    for (let i = this.skillCastFx.length - 1; i >= 0; i--) {
      const fx = this.skillCastFx[i]!;
      fx.elapsed += deltaSeconds;

      const caster = this.visuals.get(fx.unitId);
      if (!caster || caster.dead) {
        /*
          ★ 施法者死了 / 被清出场：**立刻切到收尾那一段**（而不是让它挂完）。
          不这么做的话，一个 20 秒的变身技能会把光环留在空地上十几秒 ——
          人没了、光还在，最容易被看成"bug"。
        */
        const releaseStart = fx.total - SKILL_CAST_END_SECONDS;
        if (fx.elapsed < releaseStart) fx.elapsed = releaseStart;
      } else {
        // 技能开着的时候他还会走位 → 光环要跟人走
        fx.visual.group.position.set(caster.visualPosition.x, ZONE_Y, caster.visualPosition.z);
      }

      if (fx.elapsed >= fx.total) {
        disposeSkillCastVisual(fx.visual);
        this.skillCastFx.splice(i, 1);
        continue;
      }
      applySkillCastFrame(fx.visual, skillCastFrameAt(fx.elapsed, fx.sustain));
    }
  }

  /** 清掉所有技能特效（重开一局 / seek 归零时必须做） */
  private clearSkillCastFx(): void {
    for (const fx of this.skillCastFx) disposeSkillCastVisual(fx.visual);
    this.skillCastFx.length = 0;
  }

  /** 测试/调试用：现在场上有几套技能特效 */
  liveSkillCastCount(): number {
    return this.skillCastFx.length;
  }

  // ============================================================
  //  ★ 0.2.1：序列帧特效（贴图版）
  // ============================================================

  /** 一只棋子此刻的世界坐标（跟随平滑后的视觉位置，瞬移/走位都能跟上） */
  private pointOf(visual: UnitVisual): { x: number; z: number } {
    return { x: visual.visualPosition.x, z: visual.visualPosition.z };
  }

  /** 离这只棋子最近的敌人（技能落点用；没有就退回自己脚下） */
  private nearestEnemyPointOf(caster: UnitVisual): { x: number; z: number } {
    let best: UnitVisual | null = null;
    let bestDist = Infinity;
    for (const other of this.visuals.values()) {
      if (other.dead || other.team === caster.team) continue;
      const dx = other.visualPosition.x - caster.visualPosition.x;
      const dz = other.visualPosition.z - caster.visualPosition.z;
      const dist = dx * dx + dz * dz;
      if (dist < bestDist) {
        bestDist = dist;
        best = other;
      }
    }
    return best ? this.pointOf(best) : this.pointOf(caster);
  }

  /**
   * 播一张图（统一从这里进，负责"上限淘汰 + 挂进场景"）。
   * 图还没加载好时 `spawnSeqFx` 返回 null —— 直接跳过，不重试（下一次事件自然接上）。
   */
  private spawnSeq(
    id: string | undefined,
    self: { x: number; z: number },
    target?: { x: number; z: number },
    options: { life?: number; flipX?: boolean; cells?: number; follow?: number } = {},
  ): void {
    if (!id) return;
    while (this.seqFx.length >= SEQ_FX_MAX_LIVE) {
      const oldest = this.seqFx.shift();
      if (oldest) disposeSeqFx(oldest);
    }
    const created = spawnSeqFx(id, { self, target, ...options });
    if (!created) return;
    this.fxLayer.add(created.holder);
    this.seqFx.push(created);
  }

  /**
   * `cast`：数据里写了 `castFx` 的那几个干员的专属施法演出。
   *
   * 各组图分工（见 `sequence-fx.ts` 的 `SKILL_FX`）：
   *   · `self`        —— 施法者脚下（陈的瞬移裂隙、玛恩纳的起手光环）
   *   · `target`      —— 离她最近的敌人脚下（3×3 金色斩击的主要落点）
   *   · `castOnce`    —— 朝目标的"那一下"（能天使的爆燃首枪）
   *   · `loop`        —— 循环层（玛恩纳的金色小雨滴），活到技能结束
   *   · `attack` / `attackFirst` —— 只是**登记**，等真的砍出去才播
   *     （用户口径：陈的 5 连斩要在"开技能后的下一次攻击"，不能在施法那一刻对着空气放）
   */
  /**
   * ★★ 0.2.2：近战受击痕的**唯一入口**。
   *
   * 【为什么要收成一个函数？】
   * 用户要求"覆盖所有近战攻击来源与新出现的敌人，避免遗漏或颜色不匹配"。
   * 满足这句话只有一条路：**判断、取色、定时全在一处**，所有调用方都只能走它。
   * 现在它被三个来源调用，一个都不许绕过：
   *   · 普攻（`case 'attack'`）—— 含技能生效期的普攻（那时贴图换成技能那套）；
   *   · 额外目标（`case 'attackLink'`）—— 一次打多名敌人时，其余几个也要有受击痕；
   *   · 多段攻击的第 2/3 段 —— 它们带 `hitIndex`，延迟由 `impactDelay` 一起给。
   *
   * 【判据全部来自数据，没有名单】
   *   · "是不是近战" = `def.base.range < RANGED_ATTACK_FROM`（和弹道线同一个阈值）；
   *   · "用什么样式" = `meleeHitStyleOf(...)`（先看这一次真播了哪套斩击，再兜底队伍色）。
   * ⇒ 以后新增近战干员 / 野怪 / 召唤物，什么都不用改。
   */
  private spawnMeleeHit(
    attacker: UnitVisual,
    target: UnitVisual | null,
    def: UnitDef | null,
    hitIds: readonly string[],
    impactDelay: number,
  ): void {
    if (!def || !target) return;
    // 治疗型出手（目标是自己）：那一下不是"挨刀"，没有受击痕
    if (target === attacker || target.unitId === attacker.unitId) return;
    // 只给近战：远程的命中表现是弹道终点的那套火花，不该再加一道斩击痕
    if (!isMeleeAttack(def.base.range)) return;
    const style = meleeHitStyleOf(hitIds, def.combatFx, attacker.team === 1 ? 1 : 0);
    if (impactDelay > 0.02) {
      this.pendingMeleeHit.push({
        at: this.timeSeconds + impactDelay,
        attackerId: attacker.unitId,
        targetId: target.unitId,
        style,
      });
      return;
    }
    this.drawMeleeHit(attacker, target, style);
  }

  /** 真正把一道受击痕摆到受击者身上（位置/朝向在**这一刻**取，因为人可能刚走位） */
  private drawMeleeHit(attacker: UnitVisual, target: UnitVisual, style: MeleeSlashStyle): void {
    const at = this.pointOf(target);
    const from = this.pointOf(attacker);
    const dx = at.x - from.x;
    const dz = at.z - from.z;
    const length = Math.hypot(dx, dz) || 1;
    // 往攻击者那一侧偏一点点：贴着受击者的"近侧"，看起来是刀从那边砍过来的
    const x = at.x - (dx / length) * MELEE_HIT_OFFSET;
    const z = at.z - (dz / length) * MELEE_HIT_OFFSET;
    const tilt = meleeHitTiltOf(
      this.screenAngleOf(dx, dz),
      meleeHitJitterOf(attacker.unitId * 31 + target.unitId),
    );
    /*
      ★ 高度取**受击者自己的视觉中心**（卡面是 0.42，矮个头的野怪会更低）——
      写死一个 0.46 的话，打小怪时刀痕会飘在它头顶上方（真机截图看出来的）。
    */
    spawnMeleeHit(x, z, style, tilt, target.unitId, target.visualPosition.y);
  }

  /**
   * 世界方向 `(dx, dz)` 在**屏幕**上的角度（弧度）。
   *
   * 【为什么要投影到相机上？】
   * 受击痕是立牌（Sprite），它的旋转只发生在屏幕平面里 ——
   * 直接拿地面的 `atan2(-dz, dx)` 当角度，在 45° 俯视下会和"看起来的刀向"差一大截。
   * 投影到相机的右/上轴，得到的就是玩家**眼睛看到的那个方向**。
   * 没有相机时（回放层单测）退回地面角，反正只是朝向，不会算错数值。
   */
  private screenAngleOf(dx: number, dz: number): number {
    const camera = this.camera;
    if (!camera) return Math.atan2(-dz, dx);
    const right = new Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    const up = new Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
    const dir = new Vector3(dx, 0, dz);
    const x = dir.dot(right);
    const y = dir.dot(up);
    // 方向正好对着镜头（投影退化成一个点）时给个固定角，别返回 NaN
    if (Math.abs(x) < 1e-6 && Math.abs(y) < 1e-6) return 0;
    return Math.atan2(y, x);
  }

  private spawnSkillSeqFx(caster: UnitVisual, fxKey?: string): void {
    const binding = fxKey ? SKILL_FX[fxKey] : undefined;
    if (!binding) return;
    const def = this.defs[caster.defId];
    if (!def) return;

    /*
      技能持续多久 —— 和 `spawnSkillCast` 用的是**同一个函数**（唯一出处），
      所以"光环什么时候收"和"技能斩击什么时候换回普攻"永远一致。
      ★ 开局类技能（玛恩纳 3 星"开局立刻开启技能"）**没有 `effects`**，时长写在
        `battleStart` 里，所以这里把两组合起来算 —— 否则他的小雨滴只闪 0.3 秒。
    */
    const variant = skillVariantOf(def, caster.star);
    const sustain =
      skillCastTotalSeconds(
        skillCastSustainSecondsOf([...variant.effects, ...(variant.battleStart ?? [])], caster.star),
      ) - SKILL_CAST_END_SECONDS;

    const self = this.pointOf(caster);
    const landing = this.nearestEnemyPointOf(caster);

    for (const id of binding.self ?? []) this.spawnSeq(id, self);
    for (const id of binding.target ?? []) this.spawnSeq(id, landing);
    for (const id of binding.castOnce ?? []) this.spawnSeq(id, self, landing);
    /*
      ★ 循环层：以**施法者**为中心（不是落点）——
      "覆盖他能砍到的所有格子"这件事由 `cells: 'range'` 表达（射程 3 ⇒ 7×7）。
    */
    for (const layer of binding.loop ?? []) {
      const cells = layer.cells === 'range' ? seqRangeCells(def.base.range) : layer.cells;
      this.spawnSeq(layer.id, self, undefined, { life: Math.max(0.3, sustain), cells, follow: caster.unitId });
    }

    if (binding.attack && binding.attack.length > 0) {
      this.skillAttackFx.set(caster.unitId, {
        ids: [...binding.attack],
        firstIds: [...(binding.attackFirst ?? [])],
        until: this.timeSeconds + sustain,
        firstDone: false,
      });
    }
  }

  /**
   * `attack`：这一刀的贴图。
   *
   * 优先级：**技能生效期 > 单位自己的 `combatFx` > 什么都不播**（只留程序化特效）。
   * 技能期的斩击打在**被打的人**脚下；枪口火光挂在**开枪的人**身上并朝目标推出一点；
   * `between` 锚点（玛恩纳那一刀）摆在两人正中、大到同时盖住两边。
   */
  private playCombatSeqFx(
    event: { unitId: number; targetId: number; combatFx?: string; hitIndex?: number },
    attacker: UnitVisual,
    target: UnitVisual | null,
    /**
     * ★★ 0.2.1：「出手 → 命中」的延迟（秒），由 `hit-timing.ts` 算、由 `case 'attack'` 传进来。
     * **不要再在这里自己算一遍** —— 一旦贴图层和血条层用的不是同一个数，
     * 就会出现"火花炸了血没掉"或者"血掉了火花还没炸"。
     */
    impactDelay = 0,
  ): readonly string[] {
    const beat = this.seqBeat.get(event.unitId) ?? 0;
    const self = this.pointOf(attacker);
    const at = target ? this.pointOf(target) : null;
    const flipX = beat % 2 === 1;

    const active = this.skillAttackFx.get(event.unitId);
    if (active && this.timeSeconds <= active.until) {
      this.seqBeat.set(event.unitId, beat + 1);
      /*
        ★★ 0.2.1 修：这里必须传**攻击者**当 `self`、**目标**当 `target` ——
        贴地层（陈的斩击）会自动落在目标格，`between` 层（玛恩纳的大斩击闪）
        会自动摆到两人中间。之前把"目标格"当成 `self` 传进去，
        于是 `between` 算出的中点是"目标到目标"的中点 ⇒ 永远贴在敌人身上（用户报的）。
      */
      if (!active.firstDone && active.firstIds.length > 0) {
        active.firstDone = true;
        for (const id of active.firstIds) this.spawnSeq(id, self, at ?? undefined);
      }
      for (const id of active.ids) this.spawnSeq(id, self, at ?? undefined, { flipX });
      // ★ 技能期用的是技能自己那套图 ⇒ 受击痕的颜色要跟着这套走（赤红/金色都对）
      return active.ids;
    }

    if (!event.combatFx) return [];
    const binding = COMBAT_FX[event.combatFx];
    if (!binding) return [];
    this.seqBeat.set(event.unitId, beat + 1);
    // 枪口：挂在开枪的人身上、朝目标推出 0.3 格（不推会糊在人脸上）
    // ★ 枪口是"出手那一刻"的表现，永远当帧播 —— 不参与命中延迟
    if (binding.muzzle) this.spawnSeq(binding.muzzle, self, at ?? undefined);
    /*
      ★ 命中层可以是**好几层**（炮手 = 烟 + 爆炸）。数组顺序不影响叠放，
      真正决定"火在烟上面"的是注册表里的 `lift`（爆炸抬高一档 ⇒ 离相机更近 ⇒ 后画）。
    */
    const hitIds = combatFxIdsOf(binding.hit);
    if (hitIds.length > 0 && at) {
      /*
        ★★ 0.2.1（用户口径）：连击要"**连续**炸三下"，不能三张图叠在同一帧。
        维什戴尔 1/2 星是 `multiHit: 3`，内核在同一 tick 报 3 条 attack（带 `hitIndex`）
        ⇒ 第 2/3 段依次往后挪 90 毫秒。单发没有 `hitIndex`，永远是 0 延迟。
        ★ 这两笔（飞行 + 连击错开）已经在上面的 `case 'attack'` 里合进 `impactDelay` 了。
      */
      if (impactDelay > 0.02) {
        for (const id of hitIds) {
          this.pendingSeqFx.push({ at: this.timeSeconds + impactDelay, id, x: at.x, z: at.z, self, flipX });
        }
      } else {
        /*
          ★★ 0.2.1（用户口径：通用斩击要"从我这头砍到敌人那头"）：
          命中层也要把**攻击者**当 `self` 传进去 —— `ground` 锚点仍然落在目标格
          （有 target 就用 target），而 `between` 锚点（通用斩击）会自动摆到两人中间。
        */
        for (const id of hitIds) this.spawnSeq(id, self, at, { flipX });
      }
      /*
        ★ 记下"这一下是谁打的、打的是哪套图" —— 击杀要换加强版，
        而"是否击杀"只有紧接着的 `damage.lethal` 才知道（attack 事件在它之前）。
        ★★ 0.2.1：时间也要记**命中时刻**（`+ impactDelay`）而不是"现在" ——
        致死的那条 `damage` 已经被推到命中时刻才播，用"现在"当基准的话
        炮弹飞 0.33 秒之后它就被 0.25 秒的窗口判成"不是这一下打死的"，
        击杀加强版会**静默丢失**（而且不报错）。
      */
      this.lastHitFx.set(event.targetId, { key: event.combatFx, at: this.timeSeconds + impactDelay });
    }
    // ★★ 0.2.2：把"这一下真正播了哪几张命中图"交回去 —— 近战受击痕要按它取颜色
    return hitIds;
  }

  /** `damage.lethal`：这一下打死了 ⇒ 补一张加强版命中（比普通命中大一档） */
  private playKillSeqFx(targetId: number): void {
    const last = this.lastHitFx.get(targetId);
    if (!last) return;
    // 只认"同一瞬间"的那一击（超过 0.25 秒就不是这一下的功劳了）
    if (this.timeSeconds - last.at > 0.25) {
      this.lastHitFx.delete(targetId);
      return;
    }
    const binding = COMBAT_FX[last.key];
    const target = this.visuals.get(targetId);
    if (target) {
      for (const id of combatFxIdsOf(binding?.heavy)) this.spawnSeq(id, this.pointOf(target));
    }
    this.lastHitFx.delete(targetId);
  }

  /** 每帧推进所有贴图特效（到期就 dispose + 还回帧指针） */
  private updateSeqFxList(deltaSeconds: number): void {
    // ★ 先把"到点了"的延后特效放出来（子弹飞到了，命中火花才炸）
    if (this.pendingSeqFx.length > 0) {
      const due = this.pendingSeqFx.filter((item) => item.at <= this.timeSeconds);
      if (due.length > 0) {
        this.pendingSeqFx = this.pendingSeqFx.filter((item) => item.at > this.timeSeconds);
        for (const item of due) {
          this.spawnSeq(
            item.id,
            item.self ?? { x: item.x, z: item.z },
            { x: item.x, z: item.z },
            { flipX: item.flipX },
          );
        }
      }
    }
    for (let i = this.seqFx.length - 1; i >= 0; i--) {
      const instance = this.seqFx[i]!;
      /*
        ★★ 0.2.1：跟随层（玛恩纳的小雨滴）每帧把位置挪到人脚下 ——
        他要走位，雨必须跟着走（不然人走了、雨还留在原地，像另一个人的技能）。
        人没了（被清场）就保持最后位置，让它自然淡完。
      */
      if (instance.followUnitId !== null) {
        const host = this.visuals.get(instance.followUnitId);
        if (host) instance.holder.position.set(host.visualPosition.x, 0, host.visualPosition.z);
      }
      if (updateSeqFx(instance, deltaSeconds)) continue;
      disposeSeqFx(instance);
      this.seqFx.splice(i, 1);
    }
  }

  /** 清掉所有贴图特效（重开一局必须清，否则贴图会留在棋盘上） */
  private clearSeqFx(): void {
    this.pendingSeqFx.length = 0;
    for (const instance of this.seqFx) disposeSeqFx(instance);
    this.seqFx.length = 0;
    this.skillAttackFx.clear();
    this.lastHitFx.clear();
    this.lastHealFxAt.clear();
    this.seqBeat.clear();
  }

  // ============================================================
  //  ★ 0.2.1：闪电弹道（澄闪的普攻）
  // ============================================================

  /**
   * 递给回放层一个相机 —— 闪电贴片要"正对镜头 + X 轴沿弹道"，
   * 没有相机它只能按默认 45° 俯角猜，视角一变就会变成一条细缝。
   */
  setCamera(camera: Camera): void {
    this.camera = camera;
  }

  // ============================================================
  //  ★ 0.2.1：治疗流光（古米 / 芙蓉的绿色流光）
  // ============================================================

  /**
   * `heal`：治疗流光。
   *
   * 【为什么要单独一条】
   * 用户口径：古米和芙蓉"向回复目标队友发射一枚绿色流光"。
   * 治疗事件（`heal`）本来就带 `sourceId` + `targetId`，所以"从谁到谁"是现成的，
   * 不需要内核多报任何东西 —— 只查 `UnitDef.healFx`（数据说了算，渲染层不认人）。
   *
   * ★ 节流：持续治疗（`healOverTime`）每跳都会报一条 `heal`，
   *   不拦的话画面会被刷成一片绿光带（0.25 秒最多一条）。
   * ★ 自己奶自己（源 == 目标）没有"流过去"的方向，直接跳过。
   */
  private playHealFx(sourceId: number, targetId: number): void {
    if (sourceId === targetId) return;
    const source = this.visuals.get(sourceId);
    const target = this.visuals.get(targetId);
    if (!source || !target || target.dead) return;
    const fxId = this.defs[source.defId]?.healFx;
    if (!fxId) return;
    const last = this.lastHealFxAt.get(sourceId) ?? -1;
    if (this.timeSeconds - last < HEAL_FX_MIN_INTERVAL_SECONDS) return;
    this.lastHealFxAt.set(sourceId, this.timeSeconds);
    this.spawnBoltFx(fxId, source, target);
  }

  /**
   * `heal`：**回血光环**刷新（夜莺绿 / 魔王粉）。
   *
   * 【什么时候没有】
   * 数据没写 `UnitDef.healHaloFx` ⇒ 直接返回，什么都不画（老行为）。
   * 【为什么每一条 heal 都刷】
   * 这圈光的语义是"这个人在给队友回血"，所以只要还在治疗就该亮着；
   * 寿命 1.4 秒 > 脉冲间隔 1 秒 ⇒ 治疗不停就一直亮，停了就自己收。
   * 【免死更闪】
   * 用户口径：「3 星技能加的免死效果可以让光环在开启技能时更加闪亮」。
   * 判据是施法者身上**正生效的 cannotDie**（属性时间线里查），
   * 不自己推"技能开没开" —— 免死窗口只有 5 秒，比技能本身短。
   */
  private refreshHealHalo(sourceId: number): void {
    const source = this.visuals.get(sourceId);
    if (!source || source.dead) return;
    const fxId = this.defs[source.defId]?.healHaloFx;
    if (!fxId) return;
    const immune = this.effectsOf(sourceId).some((effect) => effect.kind === 'cannotDie');
    spawnHealHalo(
      String(sourceId),
      source.visualPosition.x,
      source.visualPosition.z,
      fxId,
      immune,
    );
  }

  /** 打一发闪电（数据里写了 `tracerFx` 的干员走这里，替代原来那根白线） */
  private spawnBoltFx(id: string, attacker: UnitVisual, target: UnitVisual): void {    /*
      ★ 0.2.1（用户口径）：弹道**不从卡面正中冒出来**，从卡面朝目标的那一侧边缘开始。
      卡面宽 `CARD_WORLD_SCALE.x`（0.72 格），所以各往里收半个卡面宽。
      两边都收 ⇒ 距离太近时会收到没有，所以夹一下（至少留 0.15 格）。
    */
    const fromRaw = attacker.visualPosition.clone();
    const toRaw = target.visualPosition.clone();
    const dir = new Vector3().subVectors(toRaw, fromRaw);
    const gap = dir.length();
    /*
      ★★ 0.2.1（用户口径统一）：**所有远程特效都从卡面边缘出发**，参考澄闪的闪电。
      卡面宽 `CARD_WORLD_SCALE.x`（0.72 格）⇒ 各往里收半个卡面宽（0.36 格）。

      ★ 只有 `flow`（法术流光）额外保一个**最短长度**：
      它是一条"整段铺满"的光带，贴脸（相距 1 格）时按卡面内缩只剩 0.28 格，
      画布 18×40 px —— 31px 宽的柔光直接糊成一团（曾经读成"暗灰圆斑"）。
      所以流光的内缩量再夹一次：宁可少收一点，也要留出 `FLOW_MIN_LENGTH` 格。
    */
    const isFlow = TRACER_FX[id]?.kind === 'flow';
    const cardHalf = (CARD_WORLD_SCALE.x * CELL) / 2;
    const inset = Math.min(cardHalf, Math.max(0, gap / 2 - (isFlow ? FLOW_MIN_LENGTH / 2 : 0.15)));
    const from = fromRaw.clone().add(dir.clone().normalize().multiplyScalar(inset));
    const to = toRaw.clone().sub(dir.clone().normalize().multiplyScalar(inset));
    from.y = BOLT_TRACER_Y;
    /*
      ★ 0.2.1：炮弹是**抛物线落到地面**的（命中爆炸贴地），
      所以终点放在地面高度；闪电/子弹仍然是"同一高度飞过去"。
    */
    to.y = TRACER_FX[id]?.kind === 'shell' ? ZONE_Y : BOLT_TRACER_Y;
    while (this.boltFx.length >= MAX_LIVE_BOLT_TRACERS) {
      const oldest = this.boltFx.shift();
      if (oldest) disposeBoltTracer(oldest);
    }
    /*
      ★ 去重：多段攻击（`multiHit` / 多个目标）会在**同一 tick** 连报几条 attack，
      它们打到同一个目标时端点完全一样 —— 叠两三条只会更亮，不会有新信息。
      所以"刚出生、端点几乎重合"的就不再生成。
    */
    const dup = this.boltFx.find(
      (other) =>
        other.elapsed < 0.05 &&
        other.mesh.position.distanceToSquared(new Vector3((from.x + to.x) / 2, from.y, (from.z + to.z) / 2)) < 0.01,
    );
    if (dup) return;
    this.boltSpawnTries++;
    const bolt = createBoltTracer(id, from, to, this.camera);
    this.lastBoltInfo = bolt
      ? `t=${this.timeSeconds.toFixed(2)} dur=${bolt.duration.toFixed(3)} len=${bolt.lengthWorld.toFixed(2)} from=(${from.x.toFixed(2)},${from.z.toFixed(2)}) to=(${to.x.toFixed(2)},${to.z.toFixed(2)})`
      : 'null';
    if (!bolt) return;
    this.fxLayer.add(bolt.mesh);
    this.boltFx.push(bolt);
  }

  /** 排查/测试用：累计尝试生成弹道的次数、当前在场条数 */
  boltDebug(): { tries: number; live: number; disposed: number; last: string } {
    return { tries: this.boltSpawnTries, live: this.boltFx.length, disposed: this.boltDisposed, last: this.lastBoltInfo };
  }

  /** 每帧推进（换抖动帧 + 淡出 + 到期回收） */
  private updateBoltFxList(deltaSeconds: number): void {
    for (let i = this.boltFx.length - 1; i >= 0; i--) {
      const bolt = this.boltFx[i]!;
      if (updateBoltTracer(bolt, deltaSeconds)) continue;
      this.boltDisposed++;
      disposeBoltTracer(bolt);
      this.boltFx.splice(i, 1);
    }
  }

  /** 清掉所有闪电（重开一局必须清） */
  private clearBoltFx(): void {
    for (const bolt of this.boltFx) disposeBoltTracer(bolt);
    this.boltFx.length = 0;
  }

  // ============================================================
  //  ★★ 0.2.1：羁绊级「全场扫射」（拉特兰齐射）
  // ============================================================

  /** 某个棋子是哪一队（渲染层判"我方/敌方"之外，扫射方向也要用） */
  private teamOfUnit(unitId: number): 0 | 1 | null {
    const visual = this.visuals.get(unitId);
    if (visual) return visual.team;
    /*
      ★ 死角：**触发这一发的人可能已经在同一 tick 阵亡**（齐射由"第 30 下攻击"顺带触发，
        那一下可能同时把出手的人打死）。那时候 `visuals` 里已经没有他了，
        所以退回开战状态去查 —— 队伍归属整场不变，查得到。
    */
    const unit = this.lastState?.units.find((item) => item.id === unitId);
    return unit ? unit.team : null;
  }

  /**
   * 播一次全场扫射（用户口径：「从玩家竞技场方向，一次覆盖全场的子弹扫射」）。
   *
   * 【方向怎么定？】
   * **不看"我方/敌方"，看棋盘的物理几何** —— 触发方那半场在世界坐标的哪一侧，
   * 就从那一侧打向对面。这样：
   *   · 我方触发 ⇒ 从我这半场打出去（用户要的就是这个）；
   *   · 敌方触发 ⇒ 从他们那半场打过来（同一套代码，不需要特判）；
   *   · 联机换视角（画面左右镜像）⇒ `cellToWorldFlipped` 已经把两侧的 x 换过了，
   *     所以"从玩家竞技场方向"这件事**自动成立**。
   */
  private spawnBoardVolley(id: string | undefined, triggerUnitId: number): void {
    const spec = id ? BOARD_VOLLEY[id] : undefined;
    if (!spec) return;
    const team = this.teamOfUnit(triggerUnitId);
    if (team === null) return;
    /*
      这一队在哪半边：队伍 0 贴着 col 0，队伍 1 贴着 col BOARD_W-1。
      `cellToWorldFlipped` 会按当前视角镜像 ⇒ 拿到的就是"画面上"的 x。
    */
    const board: BoardVolleyBoard = {
      sideX: cellToWorldFlipped({ col: team === 0 ? 0 : BOARD_W - 1, row: 0 }, 0, this.flip).x,
      farX: cellToWorldFlipped({ col: team === 0 ? BOARD_W - 1 : 0, row: 0 }, 0, this.flip).x,
      zNear: cellToWorldFlipped({ col: 0, row: 0 }, 0, this.flip).z,
      zFar: cellToWorldFlipped({ col: 0, row: BOARD_H - 1 }, 0, this.flip).z,
      rows: BOARD_H,
    };
    for (const shot of planVolleyShots(spec, board)) {
      this.pendingVolleyShots.push({
        at: this.timeSeconds + shot.at,
        tracer: spec.tracer,
        fromX: shot.fromX,
        toX: shot.toX,
        z: shot.z,
      });
    }
  }

  /**
   * 每帧：把"到点了"的那几颗打出去 + 推进所有在飞的。
   *
   * ★ 为什么按队头取？`planVolleyShots` 返回的清单已经**按时间排好序**了，
   *   所以只要队头还没到点，后面的一定也没到 —— 不用每帧扫全表。
   */
  private updateBoardVolley(deltaSeconds: number): void {
    while (this.pendingVolleyShots.length > 0 && this.pendingVolleyShots[0]!.at <= this.timeSeconds) {
      const shot = this.pendingVolleyShots.shift()!;
      while (this.volleyBolts.length >= MAX_LIVE_VOLLEY_TRACERS) {
        const oldest = this.volleyBolts.shift();
        if (oldest) disposeBoltTracer(oldest);
      }
      /*
        高度沿用普攻弹道的胸口高度：子弹是在**棋子之间穿过去**的，
        贴地会钻到卡面底下（贴地那层已经有棋子和范围框了）。
      */
      const from = new Vector3(shot.fromX, BOLT_TRACER_Y, shot.z);
      const to = new Vector3(shot.toX, BOLT_TRACER_Y, shot.z);
      const bolt = createBoltTracer(shot.tracer, from, to, this.camera);
      if (!bolt) continue;
      this.fxLayer.add(bolt.mesh);
      this.volleyBolts.push(bolt);
    }
    for (let i = this.volleyBolts.length - 1; i >= 0; i--) {
      const bolt = this.volleyBolts[i]!;
      if (updateBoltTracer(bolt, deltaSeconds)) continue;
      disposeBoltTracer(bolt);
      this.volleyBolts.splice(i, 1);
    }
  }

  /** 重开一局：在场子弹与"还没打的"一起清（不清的话下一局会在中途突然下起子弹雨） */
  private clearBoardVolley(): void {
    for (const bolt of this.volleyBolts) disposeBoltTracer(bolt);
    this.volleyBolts.length = 0;
    this.pendingVolleyShots.length = 0;
  }

  // ============================================================
  //  ★ 0.2：音符弹道（丰川祥子）—— 贴图就是 🎶
  // ============================================================

  /**
   * 放一个音符，让它从攻击者飞向目标。
   *
   * 【为什么起点不用攻击者脚下、而是抬到腰高？】
   * 这是"飞出去的弹丸"，不是"地上的效果"。`note-fx.ts` 里起点 0.55 + 拱顶再抬 0.45，
   * 斜视角下能清楚看出它**从人身上出来、越过棋盘、落到目标身上**。
   *
   * ★ 上限保护的理由和攻击特效一样：满编对轰 + 攻速加成时，音符会一秒冒出十几个
   *   （3 星祥子一次攻击就是两发）。超了就丢**最老的**。
   */
  private spawnNoteFx(attacker: UnitVisual, target: UnitVisual, fx: string): void {
    while (this.noteFx.length >= MAX_LIVE_NOTE_FX) {
      const oldest = this.noteFx.shift();
      if (oldest) this.disposeNoteFx(oldest);
    }
    // ★ 配色由数据里那个 id 决定（金 / 紫…），渲染层不认干员编号
    const sprite = createNoteSprite(fx);
    const material = sprite.material as SpriteMaterial;
    const from = { x: attacker.visualPosition.x, z: attacker.visualPosition.z };
    const to = { x: target.visualPosition.x, z: target.visualPosition.z };
    const start = notePathAt(from, to, 0);
    sprite.position.set(start.x, start.y, start.z);
    sprite.scale.setScalar(noteScaleAt(0) * NOTE_FX_WORLD_SIZE);
    material.opacity = noteOpacityAt(0);
    // 调试探针：和攻击特效同一套（`?debug=1` 时能采样到"真的有音符在飞"）
    sprite.userData['airnightNoteFx'] = { from, to };
    this.fxLayer.add(sprite);
    this.noteFx.push({ sprite, material, from, to, life: NOTE_FX_SECONDS, duration: NOTE_FX_SECONDS });
  }

  /** 每帧推进所有音符（沿拱形轨迹飞 + 淡入淡出） */
  private updateNoteFx(deltaSeconds: number): void {
    for (let i = this.noteFx.length - 1; i >= 0; i--) {
      const note = this.noteFx[i]!;
      note.life -= deltaSeconds;
      if (note.life <= 0) {
        this.disposeNoteFx(note);
        this.noteFx.splice(i, 1);
        continue;
      }
      const progress = 1 - note.life / note.duration;
      const at = notePathAt(note.from, note.to, progress);
      note.sprite.position.set(at.x, at.y, at.z);
      note.sprite.scale.setScalar(noteScaleAt(progress) * NOTE_FX_WORLD_SIZE);
      note.material.opacity = noteOpacityAt(progress);
    }
  }

  /** 清掉所有音符（重开一局 / 战斗结束收尾） */
  private clearNoteFx(): void {
    for (const note of this.noteFx) this.disposeNoteFx(note);
    this.noteFx.length = 0;
  }

  /**
   * 摘掉一个音符并释放它的材质。
   * ★ **不 dispose 贴图**：那是 `note-fx.ts` 里全局缓存的一张图，所有音符共用。
   */
  private disposeNoteFx(note: {
    sprite: Sprite;
    material: SpriteMaterial;
  }): void {
    this.fxLayer.remove(note.sprite);
    note.material.dispose();
  }

  /** 测试/调试用：现在场上有几个音符在飞 */
  liveNoteFxCount(): number {
    return this.noteFx.length;
  }

  // ============================================================
  //  ★ 0.2.1：迷迭香的战术装置砸击
  // ============================================================

  /**
   * ★★ 0.2.1：在**目标头顶凭空生成**一块装置，垂直砸下去，落地扬烟后消失。
   *
   * ★ 用户口径改过两版（2026-10-18）：
   *   第一版是"从她背后抛出去飞过棋盘"，被否了 ——「还是在平飞」。
   *   第二版是纯世界垂直，又被否了 ——「装置是按从右侧出现，可能还是视角原因」。
   *   ⇒ 现在高度仍是真·垂直，水平位置按相机反向补偿，让它**在屏幕上**跟目标同一列
   *     （补偿的推导和前提都写在 `slamPathAt` 里）。
   *
   * 【"一次只砸一个"】
   * `shouldSpawnSlam()` 是这条规则的唯一实现（连击后续段 + 时间窗），
   * 它返回 false 就整段跳过 —— 绝不能在这里再补一套判断。
   */
  private spawnRosmonSlam(
    attacker: UnitVisual,
    target: UnitVisual,
    hitIndex: number | undefined,
  ): void {
    if (
      !shouldSpawnSlam({
        hitIndex,
        sinceLastSpawn: this.timeSeconds - this.lastSlamSpawnAt,
      })
    ) {
      return;
    }
    const sprite = createSlamSprite();
    // 贴图还没加载好 —— 宁可不画，也不要拿占位色块硬撑（那会在棋盘上闪一个白块）
    if (!sprite) return;

    while (this.rosmonSlamFx.length >= MAX_LIVE_ROSMON_SLAM) {
      const oldest = this.rosmonSlamFx.shift();
      if (oldest) this.disposeRosmonSlam(oldest);
    }

    // ★ 落点 = 目标格**地面**（不是攻击者）。她只负责"砸谁"，不负责"从哪飞"
    const to = { x: target.visualPosition.x, y: SLAM_END_Y, z: target.visualPosition.z };

    const start = slamPathAt(to, 0, this.slamView());
    sprite.position.set(start.x, start.y, start.z);
    const base = slamWorldSize();
    const scale = slamScaleAt(0);
    sprite.scale.set(base.width * scale, base.height * scale, 1);
    // ★ Sprite 的 `rotation` 是只读的，旋转写在 material 上（three 的约定）
    const material = sprite.material as SpriteMaterial;
    material.rotation = slamSpinAt(0);
    material.opacity = slamOpacityAt(0);
    sprite.userData['airnightRosmonSlam'] = { to };

    this.fxLayer.add(sprite);
    this.lastSlamSpawnAt = this.timeSeconds;
    this.rosmonSlamFx.push({
      sprite,
      material,
      to,
      life: ROSMON_SLAM_SECONDS,
      duration: ROSMON_SLAM_SECONDS,
    });
  }

  /**
   * 一张「相机位姿快照」，给装置砸击的**视角补偿**用（见 `slamPathAt`）。
   *
   * ★ 为什么要每帧取、不能开局缓存一次？
   *   玩家能缩放 / 拖动视角（`camera-view.ts`），补偿量跟相机位置直接相关，
   *   缓存开局那一次，拖动之后装置就会重新飘到旁边去。
   * ★ 没有相机时返回 null —— `slamPathAt` 会退化成"世界垂直"，
   *   不在调用方另写一套轨迹（同一动作只允许一处实现）。
   */
  private slamView(): SlamView | null {
    const camera = this.camera;
    if (!camera) return null;
    camera.getWorldPosition(this.slamViewCache.position);
    camera.getWorldDirection(this.slamViewCache.forward);
    return this.slamViewCache;
  }

  /** 每帧推进所有装置（垂直加速下落 + 旋转/放大） */
  private updateRosmonSlamFx(deltaSeconds: number): void {
    for (let i = this.rosmonSlamFx.length - 1; i >= 0; i--) {
      const slam = this.rosmonSlamFx[i]!;
      slam.life -= deltaSeconds;
      if (slam.life <= 0) {
        /*
          正常到点 = **砸到地上了** ⇒ 叠两层：
            · 烟（普通混合、偏暗，2.4 格，慢慢散开）；
            · 冲击闪光（加色、1.1 格，落地那一帧闪一下）。
          单靠烟在深色棋盘上只是一团灰，看不出"有东西砸下来"。
          被上限挤掉的（`shift` 走的）不会走这里，所以不会凭空冒烟。
        */
        this.spawnSeq(SLAM_SMOKE_FX, slam.to, slam.to, { cells: SLAM_SMOKE_CELLS });
        this.spawnSeq(SLAM_BLAST_FX, slam.to, slam.to, { cells: SLAM_BLAST_CELLS });
        this.disposeRosmonSlam(slam);
        this.rosmonSlamFx.splice(i, 1);
        continue;
      }
      const progress = 1 - slam.life / slam.duration;
      const at = slamPathAt(slam.to, progress, this.slamView());
      slam.sprite.position.set(at.x, at.y, at.z);
      const base = slamWorldSize();
      const scale = slamScaleAt(progress);
      slam.sprite.scale.set(base.width * scale, base.height * scale, 1);
      // ★ 同 spawn：Sprite 的旋转在 material 上
      slam.material.rotation = slamSpinAt(progress);
      slam.material.opacity = slamOpacityAt(progress);
    }
  }

  /** 清掉所有装置（重开一局 / 战斗结束收尾） */
  private clearRosmonSlamFx(): void {
    for (const slam of this.rosmonSlamFx) this.disposeRosmonSlam(slam);
    this.rosmonSlamFx.length = 0;
    this.lastSlamSpawnAt = -Infinity;
  }

  /**
   * 摘掉一件装置并释放材质。
   * ★ **不 dispose 贴图**：那是 `rosmon-slam-fx.ts` 里全局缓存的一张图。
   */
  private disposeRosmonSlam(slam: { sprite: Sprite; material: SpriteMaterial }): void {
    this.fxLayer.remove(slam.sprite);
    slam.material.dispose();
  }

  /** 测试/调试用：现在场上有几件装置在飞 */
  liveRosmonSlamCount(): number {
    return this.rosmonSlamFx.length;
  }

  // ============================================================
  //  ★ 0.1.3：斩击刀光（锏的技能）
  // ============================================================

  /**
   * 在施法者脚下挥一刀。
   *
   * 【为什么刀光跟着施法者走，而不是画在固定的一片地上？】
   * 锏的范围持续伤害是"以它**当前位置**为中心"的 —— 它一边走一边斩。
   * 所以刀光必须挂在它当时站的那一格上，两秒里才会拖出一串移动的刀痕。
   */
  private spawnSlashFx(unitId: number, radius: number): void {
    const caster = this.visuals.get(unitId);
    if (!caster) return;

    /*
      ★ 上限保护：和攻击特效同一个道理（超了丢最老的 ——
      丢老的不会让人看出"少了一刀"，丢新的才会）。
    */
    while (this.slashFx.length >= MAX_LIVE_SLASH_FX) {
      const oldest = this.slashFx.shift();
      if (oldest) {
        this.fxLayer.remove(oldest.holder);
        disposeSlashFx(oldest);
      }
    }

    const fx = createSlashFx({
      x: caster.visualPosition.x,
      z: caster.visualPosition.z,
      radius: Math.max(1, radius),
      seq: caster.slashSeq,
      y: ZONE_Y,
    });
    caster.slashSeq++;
    this.fxLayer.add(fx.holder);
    this.slashFx.push(fx);
  }

  /** 每帧推进所有刀光（缩放曲线 + 淡出 + 到期回收） */
  private updateSlashFx(deltaSeconds: number): void {
    for (let i = this.slashFx.length - 1; i >= 0; i--) {
      const fx = this.slashFx[i]!;
      fx.life -= deltaSeconds;
      if (fx.life <= 0) {
        this.fxLayer.remove(fx.holder);
        disposeSlashFx(fx);
        this.slashFx.splice(i, 1);
        continue;
      }
      const progress = 1 - fx.life / fx.duration;
      const opacity = slashOpacityAt(progress);
      for (const part of fx.parts) {
        const scale =
          part.kind === 'blade' ? slashScaleAt(progress) : slashFlashScaleAt(progress);
        part.mesh.scale.setScalar(scale);
        part.material.opacity = opacity;
      }
    }
  }

  /** 清掉所有刀光（重开一局时必须做） */
  private clearSlashFx(): void {
    for (const fx of this.slashFx) {
      this.fxLayer.remove(fx.holder);
      disposeSlashFx(fx);
    }
    this.slashFx.length = 0;
  }

  /** 测试/调试用：现在场上有几道刀光 */
  liveSlashFxCount(): number {
    return this.slashFx.length;
  }

  /**
   * ★ 0.2：在某一个格子上炸一片（维什戴尔 3 星的 5×5 大招）。
   *
   * 【位置从哪来？】
   * `bloom` 事件带的是**格子**（内核记的就是它），这里用 `place()` 换算成世界坐标 ——
   * 和范围白框走同一个换算，所以"炸的那一片"和"白框圈的那一片"必然重合。
   *
   * 【为什么半径要 `Math.round` 夹一下？】
   * 数据里的 `radius` 是格数（维什戴尔写 2 = 周围两格 = 5×5）。
   * 万一以后有人写了 1.5，`Math.round` 会把它收成整数格 ——
   * 免得平面边长算出一个"4 格"，和白框对不上（说几格就画几格）。
   */
  private spawnBloomFx(cell: { col: number; row: number }, radius: number, fx: string): void {
    // 贴图还没加载好就别炸（`createBloomFx` 返回 null）——不重试，
    // 下一次爆炸时缓存已经在了，自然就接上
    const position = this.place(cell, ZONE_Y);
    while (this.bloomFx.length >= MAX_LIVE_BLOOM_FX) {
      const oldest = this.bloomFx.shift();
      if (oldest) {
        this.fxLayer.remove(oldest.holder);
        disposeBloomFx(oldest);
      }
    }
    const created = createBloomFx({
      x: position.x,
      z: position.z,
      radius: Math.max(1, Math.round(radius)),
      fx,
      y: ZONE_Y,
    });
    if (!created) return;
    this.fxLayer.add(created.holder);
    this.bloomFx.push(created);
  }

  /** 每帧推进所有爆炸（拨帧 + 收尾淡出 + 到期回收） */
  private updateBloomFxList(deltaSeconds: number): void {
    for (let i = this.bloomFx.length - 1; i >= 0; i--) {
      const fx = this.bloomFx[i]!;
      fx.life -= deltaSeconds;
      if (fx.life <= 0) {
        this.fxLayer.remove(fx.holder);
        disposeBloomFx(fx);
        this.bloomFx.splice(i, 1);
        continue;
      }
      applyBloomFrame(fx, 1 - fx.life / fx.duration);
    }
  }

  /** 清掉所有爆炸（重开一局时必须做） */
  private clearBloomFx(): void {
    for (const fx of this.bloomFx) {
      this.fxLayer.remove(fx.holder);
      disposeBloomFx(fx);
    }
    this.bloomFx.length = 0;
  }

  /** 测试/调试用：现在场上有几次爆炸 */
  liveBloomFxCount(): number {
    return this.bloomFx.length;
  }

  /**
   * 在地板上画一个「范围框」。
   *
   * 【颜色是固定的两种，不是随便挑的】
   *   白色 = 范围**伤害**（维什戴尔 3 星的 5×5、炮手溅射、范围技能）
   *   绿色 = 回**血**（夜莺/魔王的回血光环）
   * 玩家看一眼颜色就知道"这一下是打我还是奶我"，不用去读数字。
   *
   * 【形状跟着内核算，不自己猜】
   * 半径和形状都来自 `zone` 事件（内核在真正生效的那一刻记下来的），
   * 所以画出来的框**一定和实际打到的那一片一致**。
   * 十字（空爆的"周围 4 格"）画成十字而不是 3×3 方块，
   * 免得把"只打 4 格"表现成"打 9 格"。
   */
  private spawnZone(event: {
    cell: { col: number; row: number };
    radius: number;
    shape: SplashShape;
    kind: 'damage' | 'heal';
    durationTicks: number;
    /** ★ 0.2：施法者所在格 —— 只有 `line` 用得上（见 zoneShapeLoops） */
    from?: { col: number; row: number };
  }): void {
    const color = event.kind === 'damage' ? 0xffffff : 0x5ce08a;
    const seconds = Math.max(0.15, event.durationTicks / TICKS_PER_SECOND);
    const material = new LineBasicMaterial({ color, transparent: true, opacity: 0.95 });

    /** 把格子坐标（可以是小数）转成世界坐标点。y 已经设成贴地高度了 */
    const at = (c: number, w: number): Vector3 => this.place({ col: c, row: w }, ZONE_Y);
    const rect = (c0: number, w0: number, c1: number, w1: number): Vector3[] => [
      at(c0, w0),
      at(c1, w0),
      at(c1, w1),
      at(c0, w1),
      at(c0, w0),
    ];

    const loops: Vector3[][] = zoneShapeRects(event).map((box) =>
      rect(box.c0, box.w0, box.c1, box.w1),
    );

    const lines: Line[] = [];
    const geometries: BufferGeometry[] = [];
    for (const points of loops) {
      const geometry = new BufferGeometry().setFromPoints(points);
      const line = new Line(geometry, material);
      this.fxLayer.add(line);
      lines.push(line);
      geometries.push(geometry);
    }

    this.zones.push({ lines, materials: [material], geometries, life: seconds, maxLife: seconds });
  }

  /** 范围框的淡出 */
  private updateZones(deltaSeconds: number): void {
    for (let i = this.zones.length - 1; i >= 0; i--) {
      const zone = this.zones[i]!;
      zone.life -= deltaSeconds;
      if (zone.life <= 0) {
        for (const line of zone.lines) this.fxLayer.remove(line);
        for (const geometry of zone.geometries) geometry.dispose();
        for (const material of zone.materials) material.dispose();
        this.zones.splice(i, 1);
        continue;
      }
      const ratio = zone.life / zone.maxLife;
      for (const material of zone.materials) material.opacity = 0.95 * Math.min(1, ratio * 2);
    }
  }

  /**
   * 这只棋子**当前**的有效攻速（内核刻度：1200 = 每秒 1 下）。
   *
   * 【为什么现在能拿实时值了？】
   * 以前只能用 `def.base.attackSpeed`（白板）—— 因为播放器手上没有内核状态。
   * 0.0.3 末加了「属性时间线」之后，`liveStatsOf()` 给的**就是内核此刻的真值**
   * （技能 buff、羁绊光环、40 秒狂暴全在里面），所以这里的攻速是实时的：
   * 攻速一变，动画倍率立刻跟着变（下面还有 0.2 秒平滑，避免突变）。
   */
  private liveAttackSpeed(visual: UnitVisual): number {
    const live = this.liveStatsOf(visual.unitId);
    if (live && live.attackSpeed > 0) return live.attackSpeed * 1000;
    return this.defs[visual.defId]?.base.attackSpeed ?? ATTACK_SPEED_DEFAULT;
  }

  /** 这只棋子现在会不会出手（不攻击的干员/阶段不预测挥击，免得空挥） */
  private canAttack(visual: UnitVisual): boolean {
    const def = this.defs[visual.defId];
    if (!def) return false;
    const variant = skillVariantOf(def, visual.star);
    // 夜莺那种「不攻击、只回血」的被动：动画不该有出手动作
    if (variant.passive?.noAttack) return false;
    return true;
  }

  /**
   * ★ 推进"挥击窗口"（攻速 -> 动画节奏的唯一实现，见 three/attack-anim.ts）。
   *
   * 做三件事：
   *   1. 用**实时攻速 / 白板攻速**算目标倍率（上下限夹住），并按帧平滑；
   *   2. 让整段挥击的时长 ≈ 当前攻击间隔（一次攻击一个动作循环）；
   *   3. 在**预测的下一次命中**前 `前摇` 秒起手 —— 命中帧才会落在掉血那一 tick。
   *
   * @returns 这段挥击还剩多久（秒），0 = 没在挥
   */
  private advanceSwing(visual: UnitVisual, deltaSeconds: number): number {
    const natural = chibiAnimSeconds(visual.sprite, 'attack');
    if (natural === null) {
      visual.swingRestart = false;
      return visual.swing.swing > 0 ? Math.max(0, visual.swing.swing - deltaSeconds) : 0;
    }

    const baseSpeed = this.defs[visual.defId]?.base.attackSpeed ?? ATTACK_SPEED_DEFAULT;
    const currentSpeed = this.liveAttackSpeed(visual);
    const interval = attackIntervalSeconds(currentSpeed);
    // 倍率只认"当前攻速 / 白板攻速"（夹紧后的间隔由 attackAnimSpeed 内部按内核公式求）
    const target = attackAnimSpeed({
      currentAttackSpeed: currentSpeed,
      baseAttackSpeed: baseSpeed,
      naturalSeconds: natural,
    });
    const before = visual.swing.swing;
    const next = stepSwing(visual.swing, {
      now: this.timeSeconds,
      deltaSeconds,
      naturalSeconds: natural,
      targetSpeed: target,
      intervalSeconds: interval,
      enabled: this.canAttack(visual),
    });
    visual.swing = { swing: next.swing, nextHitAt: next.nextHitAt, lastHitAt: next.lastHitAt, speed: next.speed };
    /*
      `swing` 只会往下减（见 stepSwing）—— 一旦比上一帧还大，
      就说明"窗口被重新排上了"，也就是新的一次挥击开始了。
      真实命中的兜底（noteHit 里 `swing <= 0` 时补一次）同样会走到这里，
      所以两条路都覆盖得到。
    */
    visual.swingRestart = next.swing > before + 1e-6;
    return next.swing;
  }

  /**
   * 技能动作的倍率（同样跟着攻速走，但夹得更紧 —— 技能动作本来就长）。
   * 每帧平滑，所以攻速突变时不会"啪"地跳一下。
   */
  private skillAnimationSpeed(visual: UnitVisual, deltaSeconds: number): number {
    const base = this.defs[visual.defId]?.base.attackSpeed ?? ATTACK_SPEED_DEFAULT;
    const target = skillAnimSpeed(this.liveAttackSpeed(visual), base);
    visual.skillSpeed = smoothSpeed(visual.skillSpeed, target, deltaSeconds);
    return visual.skillSpeed;
  }

  /**
   * ★ 0.0.3：把"这一格"的位移推进一帧（走路 / 瞬移共用）。
   *
   * 【为什么放在动作选择**之前**？】
   * 因为小人该播哪个动作要问一句话：**这一帧在不在走**。
   * 原来是先选动作、再插值位置，于是"刚到站"的那一帧还在播走路动作 ——
   * 差一帧，但滚动起来能看出来（脚到了、身子还在迈）。
   *
   * 【两种节奏（唯一实现）】
   *   走路   —— **线性**滑过一个内核移动周期。连续走格时首尾严格相接，
   *             拼成匀速直线；用缓动的话每格的末尾都会"刹一下"，反而一顿一顿。
   *   瞬移/击退 —— 原来那套 easeOutQuad 0.18 秒（起步快、收尾慢），
   *             用户要求过它不要改，所以一个字都没动。
   */
  private advanceWalk(visual: UnitVisual, deltaSeconds: number): void {
    if (visual.moveProgress >= 1) return;
    visual.moveProgress = advanceStepProgress(visual.moveProgress, deltaSeconds, visual.stepSeconds);
    visual.visualPosition.lerpVectors(
      visual.moveFrom,
      visual.moveTo,
      walkEase(!visual.moving, visual.moveProgress),
    );
    if (visual.moveProgress >= 1) visual.moving = false;
  }

  /** 更新单个棋子的视觉表现 */
  private updateVisual(visual: UnitVisual, deltaSeconds: number): void {
    // --- 位移：先把这一格走完（动作选择要用"这一帧在不在走"，见 advanceWalk）---
    this.advanceWalk(visual, deltaSeconds);

    /*
      --- Q 版小人：推进一帧动画 ---
      放在最前面是有意的：死亡那段代码走到最后会 `return`（甚至把精灵移除），
      小人动画必须在那之前推进，否则"阵亡"这个动作永远播不出来。

      动作的选择直接复用战斗事件已经在维护的三个量：
        dead（死亡）> castGlow（放技能）> lunge（出手）> idle
      这样做的好处是**不新增任何状态**——小人跟着战斗日志走，
      而战斗日志本来就是确定性的，所以联机两边的小人动作天然一致。
    */
    // 倒地等复活也按"阵亡动作"演（但不会走下面那段缩小消失的逻辑）
    const swingLeft = this.advanceSwing(visual, deltaSeconds);
    /*
      攻击动作由两个量共同决定（取更大的那个）：
        · `lunge` —— 真实命中那一瞬间的前倾（0.18 秒，手感上的"顶一下"）；
        · `swing` —— 整段挥击窗口（跟着攻速拉长/缩短，见 advanceSwing）。
      以前只有 lunge，所以整套动作永远只播一小截、还总是晚于掉血。
    */
    /*
      ★ 0.2：眩晕的判据和血条/技能条用的是同一份时间轴（`effectExpiry.stun`，
      由 `status: 'stun'` 事件写进去）—— 所以小人的晕、界面上的晕永远是同一段。
    */
    const stunnedNow =
      Math.floor(this.timeSeconds * TICKS_PER_SECOND) < (visual.effectExpiry.stun ?? 0);
    const chibiMode = pickMode({
      dead: visual.dead || visual.downed,
      castGlow: visual.castGlow,
      lunge: Math.max(visual.lunge, swingLeft),
      // 走路是"最低一档"的动作：出手 / 技能随时可以打断它（见 chibi.ts 的优先级表）
      moving: visual.moving,
      stunned: stunnedNow,
    });
    updateChibi(
      visual.sprite,
      deltaSeconds,
      chibiMode,
      // 出手/放技能都跟着攻速走；待机与阵亡保持原速（待机加速会很诡异）
      chibiMode === 'attack'
        ? visual.swing.speed
        : chibiMode === 'skill'
          ? this.skillAnimationSpeed(visual, deltaSeconds)
          : 1,
      /*
        ★ 新一次挥击 -> 让攻击动作从头播一遍。
        不加这一个参数，站桩输出时（挥击窗口首尾相接、mode 连着几秒都是 attack）
        非循环的攻击动作会停在最后一帧不动 —— 就是"攻击若干次后动画失效"。
      */
      chibiMode === 'attack' && visual.swingRestart,
    );

    // ★ 0.1.3：金色光华（无敌 / 重生过渡）每帧推一下
    this.updateUnitAura(visual, deltaSeconds);

    // --- 状态（护盾/加速/加攻/眩晕）到期检查 + 卡面重画 ---
    this.refreshEffects(visual, Math.floor(this.timeSeconds * TICKS_PER_SECOND));

    /*
      ★ 0.1.4：卡面那条技能条（血条正下方）。
      它每帧都要重算 —— 因为"还剩多少"是一个连续量：
        · 按时间的（红条）自己往下走，不需要内核再发包；
        · 按次数的（橙条）读最新一条采样（内核在次数变化时补采）。
      判据全在 skill-bar.ts 那个纯函数里，这里只负责把结果交给精灵。
    */
    this.updateSkillBar(visual, Math.floor(this.timeSeconds * TICKS_PER_SECOND));

    /*
      --- 位移插值已经搬到了 updateVisual 开头的 advanceWalk ---
      （它必须跑在动作选择之前，否则"刚到站"那一帧还在播走路动作，
        看起来就是"脚到了、腿还在迈"。两种节奏的说明也都在那边。）
    */

    /*
      ============================================================
       ★ 每帧都从「逻辑位置」重新摆，绝不能在上一次的位置上累加
      ============================================================
      【这里踩过一个很严重的坑：干员"乱飞"】
      原来的写法是"只在移动插值时 copy 位置"，而攻击前倾那一行写的是
      `sprite.position.x += 偏移`。看起来没问题，实际上：
        · 棋子站着不动时（moveProgress 已经是 1），位置**不会被重置**
        · 于是前倾的偏移每帧都往上加一次，0.18 秒里累加十几帧
        · 偏移量加到 1 格多，而且**前倾结束也不会收回来**
      结果就是"一开打，棋子就朝各个方向飞出去，再也回不来"。
      每个棋子朝各自目标的方向飞，所以看起来是"乱飞"。

      正确做法：每帧先把位置**设成**逻辑位置，再把浮动/前倾当成"临时偏移"加上去。
      这样任何临时效果结束的那一刻，位置自然就回到基准了。
    */
    visual.sprite.position.copy(visual.visualPosition);

    // --- 受击闪光：短暂放大一下 ---
    if (visual.hitFlash > 0) {
      visual.hitFlash = Math.max(0, visual.hitFlash - deltaSeconds);
      const shaking = visual.hitFlash > 0 ? 1 + visual.hitFlash * 0.9 : 1;
      visual.sprite.scale.set(0.72 * shaking, 0.96 * shaking, 1);
    }

    // --- 死亡动画：缩小并下沉，最后移除 ---
    if (visual.dead) {
      visual.deathProgress = Math.min(1, visual.deathProgress + deltaSeconds / DEATH_ANIM_SECONDS);
      const remain = 1 - visual.deathProgress;
      visual.sprite.scale.set(0.72 * remain, 0.96 * remain, 1);
      visual.sprite.position.y = visual.visualPosition.y - visual.deathProgress * 0.3;
      if (visual.deathProgress >= 1) {
        this.dropVisual(visual);
      }
      return;
    }

    // --- 待机微动：轻微上下浮动，避免画面死板（在基准高度上加，不能改基准） ---
    const bob = Math.sin(performance.now() / 420 + visual.unitId) * 0.018;
    visual.sprite.position.y = visual.visualPosition.y + bob;

    /*
      ============================================================
       ★ 0.0.3：走路
      ============================================================
      【有走路素材的（野怪）】
      updateChibi 那边已经在播 move / move2 的序列帧（见 chibi.ts），这里不用管。

      【没有走路素材的（干员）】
      官方战斗小人的骨架里**没有走路动作** —— 实测两个素材仓库
      （fexli/ArknightsResource、Aceship/Arknight-Images）的 Front 都只有
      Idle / Attack / Skill / Die / Start。唯一带 Move 的是**基建版**模型
      （isHarryh/Ark-Models 的 build_char_*），但基建模型有的人物连武器都不一样
      （op01 空爆手里那把枪就没了），换过去会"走路时武器凭空消失"，
      比"走路动作不够花哨"糟糕得多。所以这里用**程序化走姿**补：

        · 颠一步   —— 挪一格的时间里离地再落地（sin 半周期）；
        · 顶一下   —— 朝前进方向推一下，一个格子两拍（sin 整周期）；
        · 微微前倾 —— 约 2.6°，够表达"在使劲走"，又不会像要摔倒。

      全部只在**位置上做偏移**（不改基准、不动缩放）——
      缩放被受击闪光和阵亡动画占着，位置每帧都会从 visualPosition 重设，
      所以这里的浮动不可能像以前那样"累加着飞出去"（见下面那段注释）。
    */
    let walkLean = 0;
    if (visual.moving && !hasChibiAnim(visual.sprite, 'move')) {
      const dirX = this.flip ? -visual.walkDir.x : visual.walkDir.x;
      const pose = walkPose(visual.moveProgress, dirX);
      visual.sprite.position.y += pose.hop;
      visual.sprite.position.x += pose.push;
      walkLean = pose.lean;
    }
    /*
      前倾每帧都写一次（不走路时归零）。
      只在走路时赋值的话，走完最后一步会一直歪着 —— 这是个很容易漏的收尾。
      ★ 转的是**小人那一层**精灵（不是卡片那层）：写错层的话整张卡框会跟着歪
      （踩过，所以这条收进了 chibi.ts 的 setChibiLean）。
    */
    /*
      ★ 0.2：眩晕的**通用表现**（"程序化摇晃"）。
      有官方 `Stun` 动作的干员正在播真动作，不用这层；没有的那 49 个就是
      "待机 + 左右摇" —— 所以 55 个干员被晕的时候都有明确反馈。
      ★ 必须**并进 walkLean 一起写**：下面是每帧无条件调用的 `setChibiLean`，
        单独写材质会被它这一帧的 0 覆盖掉（见 `stunWobbleLean` 的说明）。
    */
    const stunLean =
      chibiMode === 'stun' && !hasChibiAnim(visual.sprite, 'stun')
        ? stunWobbleLean(this.timeSeconds)
        : 0;
    setChibiLean(visual.sprite, walkLean + stunLean);

    /*
      ★ 0.2：**眩晕星星**（头顶三颗转圈的星）—— 所有被晕的单位都画，包括那 6 个
      有官方 Stun 动作的（动作本身是"蹲下抱头"，星星让"被控"更一眼可见）。
      画在小人的画布里，所以不用管层级、也不用在阵亡时特意摘掉。
    */
    setChibiDizzy(visual.sprite, chibiMode === 'stun', this.timeSeconds);

    /*
      --- 攻击前倾 ---
      把"朝目标方向冲一小步"折算成世界坐标偏移。
      注意方向要按**画面翻转**换算：联机时自己被分到队伍 1，
      整个战场是镜像显示的，直接用格子差会让棋子朝反方向冲。
    */
    if (visual.lunge > 0) {
      visual.lunge = Math.max(0, visual.lunge - deltaSeconds);
      // 0 -> 1 -> 0 的曲线：冲出去再收回来
      const t = visual.lunge / LUNGE_SECONDS;
      const amount = Math.sin(t * Math.PI) * LUNGE_DISTANCE;
      const dirX = this.flip ? -visual.lungeDir.x : visual.lungeDir.x;
      visual.sprite.position.x += dirX * amount;
      visual.sprite.position.z += visual.lungeDir.y * amount;
    }

    // --- 技能特效：短暂放大（金圈由卡片贴图上的高光表现） ---
    if (visual.castGlow > 0) {
      visual.castGlow = Math.max(0, visual.castGlow - deltaSeconds);
      const pulse = 1 + (visual.castGlow / 0.35) * 0.22;
      visual.sprite.scale.set(0.72 * pulse, 0.96 * pulse, 1);
    }
  }

  /**
   * 调试/测试用：某个棋子的精灵相对「它应该在的那一格」偏了多少（世界单位）。
   *
   * 【为什么要暴露这个？】
   * 因为"棋子乱飞"这个 bug 只在**连续播放**时才出现，
   * 看代码看不出来（每一行都挺合理），单帧截图也看不出来。
   * 有了这个函数，测试就能在每一帧检查"偏移有没有越来越大" ——
   * 正常情况偏移只有两种来源：攻击前倾（≤0.22）和一帧内的移动插值，
   * 绝不应该累积。
   */
  spriteDrift(unitId: number): { x: number; z: number } | null {
    const visual = this.visuals.get(unitId);
    if (!visual) return null;
    // 用"视觉位置"做基准，而不是格子中心 —— 移动插值中间态本来就该偏
    return {
      x: visual.sprite.position.x - visual.visualPosition.x,
      z: visual.sprite.position.z - visual.visualPosition.z,
    };
  }

  /** 当前场上还活着的棋子的信息，用于 HUD 显示 */
  snapshot(): Array<{ unitId: number; team: 0 | 1; defId: string; star: number; hpPercent: number }> {    const out: Array<{ unitId: number; team: 0 | 1; defId: string; star: number; hpPercent: number }> = [];
    for (const visual of this.visuals.values()) {
      out.push({
        unitId: visual.unitId,
        team: visual.team,
        defId: visual.defId,
        star: visual.star,
        hpPercent: visual.maxHp > 0 ? visual.hp / visual.maxHp : 0,
      });
    }
    return out.sort((a, b) => a.unitId - b.unitId);
  }

  /**
   * ★ 双方**当前的总血量**（你报的第 12 条）。
   *
   * 【为什么要"总量"而不是"平均值"？】
   * 顶部那两条血条原来显示的是"存活干员的**平均**血量百分比" ——
   * 那是个看不出规模的平均数：9 个残血和一个满血一样都算"50%"，
   * 玩家完全不知道对面还剩多少血。改成总血量之后，
   * "我这边还剩多少"和"对面还剩多少"才是可以直接对比的两个数。
   *
   * 返回的是**按 team 下标**的两项（0/1），左右怎么摆由调用方按视角翻转决定。
   * hp 单位是战斗内核的定点数（FIX），除一下才是面板血量。
   */
  hpTotals(): [ { hp: number; maxHp: number }, { hp: number; maxHp: number } ] {
    const out: [ { hp: number; maxHp: number }, { hp: number; maxHp: number } ] = [
      { hp: 0, maxHp: 0 },
      { hp: 0, maxHp: 0 },
    ];
    for (const visual of this.visuals.values()) {
      const slot = out[visual.team];
      slot.hp += Math.max(0, visual.hp);
      slot.maxHp += visual.maxHp;
    }
    return out;
  }

  /** 供调试：取某个棋子的元数据 */
  metaOf(unitId: number): { defId: string; star: number; team: 0 | 1 } | null {
    const visual = this.visuals.get(unitId);
    if (!visual) return null;
    return getSpriteMeta(visual.sprite);
  }

  /**
   * ★ 战斗中点开干员信息用：拿某一个单位的实时状态。
   *
   * 【为什么要有这个？】
   * 你要求"战斗时点干员能看到实时的血量和面板属性，包括敌方"。
   * 战斗里的单位状态全在这个类里（血量、法力、身上的状态），
   * 所以信息面板必须从这里取 —— 而不是去读 state.placements
   * （那份数据是"布阵时的阵容"，战斗里早就过时了）。
   */
  unitInfo(unitId: number): {
    unitId: number;
    defId: string;
    star: number;
    team: 0 | 1;
    mine: boolean;
    hp: number;
    maxHp: number;
    shield: number;
    hpPercent: number;
    mana: number;
    castCount: number;
    dead: boolean;
    effects: UnitEffectFlags;
  } | null {
    const visual = this.visuals.get(unitId);
    if (!visual) return null;
    return {
      unitId: visual.unitId,
      defId: visual.defId,
      star: visual.star,
      team: visual.team,
      mine: this.isMine(visual.team),
      /*
        ★ 血量在战斗内核里是"千分之一"的定点数（`hp = 面板血量 × FIX`）。
        直接把内部值丢给界面，就会显示出"几十万几百万"这种数字 ——
        所以这里统一除回面板单位再交出去，**界面层永远拿不到内部定点数**。
        （这条修的就是你报的"战斗中点开干员血量不正常"。）
      */
      hp: Math.max(0, Math.round(visual.hp / FIX)),
      maxHp: Math.round(visual.maxHp / FIX),
      shield: Math.max(0, Math.round(visual.shield / FIX)),
      hpPercent: visual.maxHp > 0 ? Math.max(0, visual.hp / visual.maxHp) : 0,
      mana: Math.round(visual.mana),
      castCount: visual.castCount,
      dead: visual.dead,
      effects: { ...visual.effects },
    };
  }

  /**
   * 某个 Object3D 是哪一号单位（点棋子时用）。
   * 拿不到就返回 null —— 比如点到了地板。
   *
   * 【★ 为什么要沿着 parent 往上找？】（0.0.2 追加需求第 1 条）
   * 棋子精灵现在挂着两个子精灵：Q 版小人和**血条**（都在卡片前面，
   * 所以射线打到的**首先**是它们）。`unitId` 只写在卡片精灵上，
   * 不往上找的话就会出现"点小人/点血条没反应，只有点到卡片露出来的边缘才弹面板"。
   * 子节点又一定在卡片下面，所以往上走几层就一定能找到。
   */
  unitIdOf(object: { userData?: unknown; parent?: unknown } | null | undefined): number | null {
    let node = object;
    // 限制层数：层级是"卡片 > 小人/血条"这么浅，走 4 层足够，也防环
    for (let depth = 0; node && depth < 4; depth++) {
      const data = node.userData as { unitId?: number } | undefined;
      if (typeof data?.unitId === 'number') return data.unitId;
      node = node.parent as typeof node;
    }
    return null;
  }
}

export { CELL };
