/**
 * ============================================================
 *  野怪（敌方中立单位）棋子表 + 野怪回合表
 * ============================================================
 *
 * 【野怪是什么？】
 * 一波由系统生成的敌人，玩家在「野怪回合」跟它们打（单机 / 联机都一样）。
 * 打赢之后（后续版本）会掉藏品。
 *
 * ============================================================
 *  ⚠️ 数值和技能**全部是占位**，等你给正式数据
 * ============================================================
 *  数值：按「级别模板 × 个体微调」生成，只保证"小怪打不过精英、精英打不过 Boss"
 *        这个量级关系是对的，具体数字没有平衡过。
 *  技能：一个野怪一句话，用现成效果类型拼的，能跑、能看清，但不等同于官方技能。
 *  二阶段：`reborn` 是「重生」占位（血归零后按比例站起来 + 强化），
 *        目前挂在部分精英 / 小领袖 / Boss 上。
 *  改的时候：**在这里改就行**，不用动战斗内核。
 *
 * ============================================================
 *  ★ 三条硬约定
 * ============================================================
 *  1. **野怪永远不进商店 / 牌库 / 单机敌方干员阵营** —— 靠 `monsterOnly` 标记，
 *     由 `isPlayableDef()` 统一排除（抽牌的地方只调那一个函数）。
 *  2. **野怪没有星级**：`starHpBp` / `starDamageBp` 都是 1000（不成长），
 *     战斗里固定用 1 星；棋盘上也不画星星（见 sprite-graphics 的 syncStarSprite）。
 *  3. **野怪没有卡面**：只画小人模型 + 血条，不画背景/边框/费用徽章。
 *
 * 【id 为什么是 `mn_slime` 这种而不是 `mn01`？】
 * 干员表是 `op01…op50`（按行号），中间插一行会整体位移 —— 那是历史包袱。
 * 野怪这张表以后会经常加/改，所以用**稳定的语义 id**：
 * 往后插入新野怪不会动到任何人的 id，素材目录名（`assets/chibi/<id>/`）也跟着稳。
 */

import { MAX_BATTLE_TICKS } from './constants.js';
import { formationCells } from './field.js';
import { createRng } from './rng.js';
import type { Rng } from './rng.js';
import type {
  Cell,
  ManaSource,
  PeriodicEffect,
  ScopedMechanic,
  SkillEffect,
  SkillStats,
  TeamSetup,
  UnitDef,
  UnitDefTable,
  UnitPhaseOverride,
} from './types.js';

// ============================================================
// 级别
// ============================================================

/** 五档：小怪 / 普通 / 精英 / 小领袖 / Boss */
export type MonsterTier = 'minion' | 'normal' | 'elite' | 'leader' | 'boss' | 'special';

/**
 * 从弱到强（界面上的下拉、图鉴都按这个顺序）。
 *
 * ★ 0.1.3：多了 `special` —— **不参与野怪波次**的特殊野怪（"左手" / 血骑士 / 锏）。
 *
 * 【它为什么天然"不进波次"？】
 * 因为 `MONSTER_WAVE_TABLE` 是**手写的档位组合**，里面根本没有 special 这一档 ——
 * `monsterWaveForRound` 只从那几个档里抽，所以永远抽不到它们（用户要的
 * "不加入回合野怪表"就是靠这条，不需要额外写排除逻辑）。
 * 加这个档位是为了另外两件事：① 让它们出现在修改器的下拉里；
 * ② 给"模型尺寸"一个可挂的地方（也可以逐只覆盖，见 MONSTER_MODEL_SCALE_BY_ID）。
 */
export const MONSTER_TIERS: readonly MonsterTier[] = ['minion', 'normal', 'elite', 'leader', 'boss', 'special'];

/** 级别 → 中文名 */
export const MONSTER_TIER_LABEL: Record<MonsterTier, string> = {
  minion: '小怪',
  normal: '普通',
  elite: '精英',
  leader: '小领袖',
  boss: 'Boss',
  // ★ 0.1.3：不参与波次的特殊野怪（只在修改器里能发出来）
  special: '特殊',
};

/** UnitDef.cost 的取值（只影响排序/展示，野怪不进牌库所以不参与任何抽卡） */
const TIER_COST: Record<MonsterTier, number> = {
  minion: 1,
  normal: 2,
  elite: 3,
  leader: 4,
  boss: 5,
  // ★ 0.1.3：特殊野怪没有"费用"这个概念（用户口径），这里只是给排序一个位置
  special: 3,
};

/** 没立绘时用的色块（野怪没有卡面，这是程序化占位小人的颜色） */
export const MONSTER_TIER_COLOR: Record<MonsterTier, string> = {
  minion: '#6d7a52',
  normal: '#7a6a52',
  elite: '#7a4a4a',
  leader: '#5b4a7a',
  boss: '#8a2f2f',
  // ★ 0.1.3：特殊野怪（只在修改器里发，正常对局见不到）
  special: '#4a6f8f',
};

/**
 * ============================================================
 *  ★ 模型大小：**级别默认 + 逐只覆盖**
 * ============================================================
 *
 * 【为什么不放 apps/web 的 chibi.ts？】
 * 原先这两张表在渲染层，但它是"一份要调的数值"，得能在**数值总表**里被看到
 * （否则改完只能靠肉眼比大小）。放在这里 = 唯一来源，chibi 和导表脚本读同一份。
 * （和 `MONSTER_TIER_COLOR` 同一个性质：都是展示用常量，但必须只有一处。）
 *
 * 【级别默认】没被逐只点名的野怪用这套：
 *   小领袖 ×1.35 —— 原 ×1.5，按需求"所有小领袖缩小 10%"（1.5 × 0.9）。
 *   Boss   ×1.5  —— 这次没点名，维持"放大 50%"。
 *   小怪 / 普通 / 精英 ×1 —— 个别调整见下面那张逐只表。
 *
 * 【放大的是"世界尺寸"，不是卡片】
 * 小人世界高度直接乘这个倍率，脚底锚点不动 → "从地面往上长高/变矮"。
 */
export const MONSTER_MODEL_SCALE: Readonly<Record<string, number>> = { leader: 1.35, boss: 1.5 };

/**
 * ★★ 0.2（用户口径）：野怪攻击力下调 —— **只降「小怪」这一档**。
 *
 * 【怎么走到这一步的】
 *   · 第一版：所有野怪 −30%（7000）；
 *   · 第二版：所有野怪再 −40%（4200 = 7000 × 0.6）；
 *   · 第三版（用户口径原话）：「伤害只降小怪这一栏（源石虫，士兵等那一档），
 *     其他的档野怪还原」⇒ 小怪继续 ×0.42，其余五档一律回到 100%。
 *
 * 【为什么是一个常量 + 一张档位表，而不是去改 29 行 `attackDamage`？】
 * 改数据的话：29 行散在二十几个 def 里、`mn_*` 的数值还各有出处（有的按血量推的），
 * 调一次就得改 29 行，而且和策划表对账时会到处"对不上"。
 * 现在「哪几档吃这个倍率」只写在 `MONSTER_ATTACK_SCALED_TIERS` 里，
 * 想再改一次范围/数值，动这一处就够（`createUnit` 一处应用，见 rules.ts）。
 *
 * ★ 小怪 = `minion` 档：源石虫 / 猎狗 / 士兵 / 隐形弩手。
 *   normal/elite/leader/boss **以及 special**（血骑士 / 锹 / 「左手」这些羁绊援军）
 *   都按原始数值出场。
 *
 * ★ 万分比：4200 = ×0.42。
 */
export const MONSTER_ATTACK_SCALE_BP = 4200;

/**
 * 吃上面那个倍率的档位。**唯一出处** —— 想调整范围就改这一行。
 * ★ 别在 `createUnit` 里写 `tier === 'minion'`：写死了以后加档位要回来找。
 */
export const MONSTER_ATTACK_SCALED_TIERS: readonly MonsterTier[] = ['minion'];

/**
 * 这一档的野怪，攻击力该乘多少（万分比）。
 *
 * @returns 10000 = 原样（不打折）
 */
export function monsterAttackScaleOf(tier: MonsterTier | undefined): number {
  return tier && MONSTER_ATTACK_SCALED_TIERS.includes(tier) ? MONSTER_ATTACK_SCALE_BP : 10000;
}

/**
 * 逐只覆盖表 —— 点名的那些野怪（值是**最终倍率**，不是增量）：
 *
 *   源石虫 / 猎狗                             ×0.85（缩小 15%）
 *   萨卡兹大剑手 / 重装防御者 / 游击队盾卫      ×1.15（变大 15%）
 *   "盛怒" / 深池伙友影刃精英 / 深池伙友卫队精英 ×1.2（变大 20%）
 *   泥岩巨像                                  ×1.3（变大 30%）
 *
 * key 用稳定语义 id（`mn_xxx`）：名字会改写，id 不会。
 * 二阶段（reborn）沿用本体倍率 —— 它只是换了素材（enemyId），def 还是同一只。
 */
const MONSTER_MODEL_SCALE_OVERRIDES: Readonly<Record<string, number>> = {
  // 小怪：缩小 15%
  mn_slime: 0.85, // 源石虫
  mn_gopro: 0.85, // 猎狗
  // 普通：变大 15%
  mn_demon: 1.15, // 萨卡兹大剑手
  mn_shield: 1.15, // 重装防御者
  // 精英：按各自的分量微调
  mn_sotisd: 1.15, // 游击队盾卫（+15%）
  mn_spklr: 1.2, // "盛怒"（+20%）
  mn_mdgint: 1.3, // 泥岩巨像（+30%）
  mn_dushdo: 1.2, // 深池伙友影刃精英（+20%）
  mn_duholy: 1.2, // 深池伙友卫队精英（+20%）
};

/**
 * ★ 0.1.3：野怪「W」（`mn_cqbw`）的最终倍率。
 *
 * 【为什么单独拎出来？】用户要求三只特殊野怪"**和野怪 W 一样大**" ——
 * 那就该**引用** W 的倍率，而不是在这儿抄一个 1.35。
 * 以后 W 换成逐只覆盖、或者小领袖档整体缩放调整，这三只会跟着一起变。
 */
const W_MODEL_SCALE =
  MONSTER_MODEL_SCALE_OVERRIDES['mn_cqbw'] ?? MONSTER_MODEL_SCALE['leader'] ?? 1;

export const MONSTER_MODEL_SCALE_BY_ID: Readonly<Record<string, number>> = {
  ...MONSTER_MODEL_SCALE_OVERRIDES,
  // ★ 0.1.3 特殊野怪：和「W」同尺寸（用户口径）
  mn_tytus: W_MODEL_SCALE,
  mn_bldkgt: W_MODEL_SCALE,
  mn_blkswb: W_MODEL_SCALE,
  // ★ 凝血之刃跟着血骑士走（它是血骑士的伴生，小一号才像"碎片"）
  mn_bloodblade: W_MODEL_SCALE * 0.6,
};

/**
 * 这只棋子的小人该放大多少倍（1 = 原尺寸）。
 *
 * 干员一律 1 —— 缩放只属于野怪（`monsterOnly`）。
 * 查表顺序：**逐只覆盖 → 级别默认 → 1**。
 */
export function monsterModelScaleOf(def: Pick<UnitDef, 'id' | 'monsterOnly' | 'monsterTier'>): number {
  if (def.monsterOnly !== true) return 1;
  return MONSTER_MODEL_SCALE_BY_ID[def.id] ?? MONSTER_MODEL_SCALE[def.monsterTier ?? ''] ?? 1;
}

/**
 * 各级别的**基准数值**（占位）。
 * 个体只写"和基准不一样的地方"，改整体强度就改这里。
 *
 * 量级参考（干员一星）：血 400~1400 / 攻 38~75。
 *   小怪   约等于最脆的干员
 *   精英   约等于一个 3 星干员
 *   小领袖 一个能一挑三的强干员
 *   Boss   需要整套阵容 + 羁绊才打得过
 */
const TIER_BASE = {
  minion: { hp: 320, attackDamage: 32, attackSpeed: 1200, armor: 0, magicResist: 0, range: 1, manaPerAttack: 200 },
  normal: { hp: 760, attackDamage: 68, attackSpeed: 1150, armor: 20, magicResist: 10, range: 1, manaPerAttack: 200 },
  elite: { hp: 1900, attackDamage: 140, attackSpeed: 1100, armor: 45, magicResist: 25, range: 1, manaPerAttack: 200 },
  leader: { hp: 5200, attackDamage: 260, attackSpeed: 1050, armor: 70, magicResist: 40, range: 1, manaPerAttack: 200 },
  boss: { hp: 14000, attackDamage: 480, attackSpeed: 1000, armor: 100, magicResist: 60, range: 1, manaPerAttack: 200 },
  /*
    ★ 0.1.3：特殊野怪的数值**全部写在个体上**（用户给的正式数据），
    这里只是"某项忘了写"时的兜底 —— 但**不能留空**，
    否则 `buildMonsterDef` 里的 `...TIER_BASE[tier]` 会展开成 undefined。
  */
  special: { hp: 2000, attackDamage: 120, attackSpeed: 1500, armor: 40, magicResist: 40, range: 1, manaPerAttack: 200 },
} as const;

/**
 * 各级别的基准数值（只读出口，给「数值总表」导出脚本用）。
 *
 * 【为什么要导出去？】
 * 因为每个野怪只写"和基准不一样的地方"，所以"这只怪实际多少血"=
 * 基准 + 个体覆盖。导表脚本必须拿到**同一份**基准才能算出真实数值 ——
 * 在脚本里再抄一份基准，改了上面这张表就会和表格对不上（而且不会报错）。
 */
export const MONSTER_TIER_BASE: Readonly<Record<MonsterTier, UnitDef['base']>> = TIER_BASE;

/** 各级别对应的 cost（只用影响排序/展示） */
export const MONSTER_TIER_COST: Readonly<Record<MonsterTier, number>> = TIER_COST;

type BaseStats = UnitDef['base'];

/**
 * 「重生」—— 二阶段占位。
 *
 * 【做什么？】
 * 血量第一次归零时不倒下：按 `hpBp` 站起来，并套一层强化，
 * 相当于"第二条命 + 进入二阶段"。同一场只触发一次。
 *
 * 【为什么写在数据里而不是内核里写死？】
 * 因为哪几个野怪有、站起来多强，都是要调的数值。
 * 内核只负责"照着做"，见 combat-math.ts 的 applyReborn。
 */
export interface MonsterReborn {
  /** 重生后恢复到生命上限的万分比（10000 = 满血） */
  hpBp: number;
  /** 重生后攻击力乘算（万分比，12000 = ×1.2）。不写 = 不变 */
  damageBp?: number;
  /** 重生后攻速乘算（万分比）。不写 = 不变 */
  attackSpeedBp?: number;
  /**
   * 二阶段用的素材 id（官方 enemy id）。
   * 不写就沿用本体模型 —— 实测两个 Boss（博卓卡斯替 / 奎隆）的二阶段
   * 在素材库里就是**同一个模型文件**，所以它们不写这个字段
   * （二阶段只是同一套骨架里的 C2_* 动作，见 phase2.artId）。
   */
  enemyId?: string;
  /**
   * ★ 0.0.3：死亡后**倒地等待**多少 tick 才站起来（表里的「需要 3/5 秒复活」）。
   * 20 tick = 1 秒。不写 = 立刻站起来（老行为）。
   */
  delayTicks?: number;
  /**
   * ★ 0.0.3：倒地演出的**播放速度倍数**（只是观感，不影响任何数值）。
   *
   * 【为什么需要它？】
   * 敌人的阵亡动作长短差很多：杰斯顿的 C1_Die 有 4 秒，而它只倒地 3 秒 ——
   * 按原速播会"还没倒稳就到点了"。写 2 就是两倍速演完。
   * 客户端在 `setChibiDowned` 时读它（见 three/chibi.ts）。
   */
  downedAnimSpeed?: number;
  /** ★ 一阶段覆盖（复活前生效）。不写 = 用 def 里那套 */
  phase1?: UnitPhaseOverride;
  /** ★ 二阶段覆盖（复活后生效，一阶段那套被换掉） */
  phase2?: UnitPhaseOverride;
  /** 给界面/日志用的一句话 */
  desc: string;
}

/** 一条野怪定义 */
export interface MonsterEntry {
  /** 稳定 id，同时是 chibi 素材目录名（assets/chibi/<id>/） */
  id: string;
  /** 显示名（用官方写法） */
  name: string;
  tier: MonsterTier;
  /**
   * 官方敌人 id（挂 Q 版小人素材用）。
   * 素材来源：isHarryh/Ark-Models 的 `models_enemies/{key}/`，
   * key = 这个 id 去掉 `enemy_` 前缀。见 scripts/fetch-chibi.ts。
   */
  enemyId: string;
  /**
   * ★ 0.2.1 表现层：普攻弹道特效（渲染层 `TRACER_FX` 注册表键）。
   * 不写 = 画原来那根白线。见 types.ts 的 `UnitDef.tracerFx`。
   */
  tracerFx?: string;
  /** 和级别基准不一样的数值，只写要改的那几项 */
  stats?: Partial<BaseStats>;
  /** 技能（占位） */
  skill: {
    name: string;
    desc: string;
    effects: SkillEffect[];
    passive?: SkillStats;
    /** 开局一次性效果（“复仇者”的开场瞬移 / 深池影刃的开场不可选中） */
    battleStart?: SkillEffect[];
    manaSource: ManaSource;
    manaPerSecond?: number;
    /** ★ 0.1.3：开局技能条有多少（万分比）—— "左手"的"入场立刻放一次技能" */
    startManaBp?: number;
  };
  /**
   * ★ 0.0.3：写在数据里的**战斗中机制**（嘲讽 / 流血 / 残血增伤 / 成对光环 / 周期落雷…）。
   * 这些是"与阶段无关"的被动 —— 换阶段要换的机制写在 reborn.phase1/phase2.mechanics 里。
   */
  mechanics?: ScopedMechanic[];
  /** 二阶段「重生」（只有部分精英 / 小领袖 / Boss 有） */
  reborn?: MonsterReborn;
}

/**
 * 奎隆「连击可以攻击到附近 4 格」的强度（万分比）。
 *
 * 【为什么是 10000（100%）？】
 * 溅射在引擎里是"按这次攻击**总共打出的伤害**乘比例"分摊到周围格子的，
 * 而连击一次总共打出 5 段。用户要的是「**5 段全打过去**」——
 * 也就是周围 4 格各吃一遍完整的 5 连击：
 *   一阶段：5 段 × 90%  = 450% ✔
 *   二阶段：5 段 × 150% = 750% ✔
 * 所以比例写 100%（不是"其中一段"的 20%）。
 */
const COMBO_SPLASH_BP = 10000;

// ============================================================
// 野怪名单（19 只）
// ============================================================

/**
 * 【怎么加一只野怪？】
 * 往对应级别下面加一条就行（id 自己起一个 `mn_xxx`，别和已有的重名）。
 * 加完记得跑一次素材：
 *   node node_modules/tsx/dist/cli.mjs scripts/fetch-chibi.ts
 *   node node_modules/tsx/dist/cli.mjs scripts/render-chibi.mjs
 */
export const MONSTER_ROSTER: readonly MonsterEntry[] = [
  // ---------------- 小怪（4）----------------
  {
    id: 'mn_slime',
    name: '源石虫',
    tier: 'minion',
    enemyId: 'enemy_1007_slime',
    // 无技能：只有站桩面板
    stats: { hp: 300, attackDamage: 20, armor: 10, magicResist: 10, range: 1, attackSpeed: 1200 },
    skill: { name: '—', desc: '无技能', effects: [], manaSource: 'attack' },
  },
  {
    id: 'mn_gopro',
    name: '猎狗',
    tier: 'minion',
    enemyId: 'enemy_1000_gopro',
    // 快、脆：靠数量咬人 —— 攻速比别的野怪高一档（0.8 秒一下）
    stats: { hp: 300, attackDamage: 30, armor: 10, magicResist: 10, range: 1, attackSpeed: 1500 },
    skill: { name: '—', desc: '无技能', effects: [], manaSource: 'attack' },
  },
  {
    id: 'mn_nsabr',
    name: '士兵',
    tier: 'minion',
    enemyId: 'enemy_1002_nsabr',
    stats: { hp: 500, attackDamage: 50, armor: 10, magicResist: 10, range: 1, attackSpeed: 1200 },
    skill: { name: '—', desc: '无技能', effects: [], manaSource: 'attack' },
  },
  {
    id: 'mn_jshoot',
    name: '隐形弩手',
    tier: 'minion',
    enemyId: 'enemy_1019_jshoot',
    // 远程脆皮（攻击距离 2）
    stats: { hp: 200, attackDamage: 50, armor: 10, magicResist: 10, range: 2, attackSpeed: 1200 },
    skill: { name: '—', desc: '无技能', effects: [], manaSource: 'attack' },
  },

  // ---------------- 普通（5）----------------
  {
    id: 'mn_rogue',
    name: '双持剑士',
    tier: 'normal',
    enemyId: 'enemy_1014_rogue',
    // 攻速高一档（0.8 秒一下）
    stats: { hp: 700, attackDamage: 70, armor: 20, magicResist: 10, range: 1, attackSpeed: 1500 },
    // 被动：攻击无视对方 10% 物抗 + 攻击速度 +50%
    mechanics: [{ kind: 'armorPen', ratioBp: 1000 }],
    skill: {
      name: '双剑连斩',
      desc: '被动：攻击无视对方 10% 物抗，攻击速度 +50%',
      effects: [],
      passive: { attackSpeedBp: 5000 },
      manaSource: 'attack',
    },
  },
  {
    id: 'mn_reveng',
    name: '寻仇者',
    tier: 'normal',
    enemyId: 'enemy_1025_reveng',
    // 越残血越猛（低血狂暴，永久生效）
    stats: { hp: 800, attackDamage: 90, armor: 10, magicResist: 10, range: 1, attackSpeed: 1200 },
    mechanics: [{ kind: 'lowHpSurge', hpThresholdBp: 5000, speedBp: 7000, attackDamageBp: 10000 }],
    skill: {
      name: '追猎',
      desc: '被动：生命值降到 50% 及以下时，攻击力 +100%、攻击速度 +70%',
      effects: [],
      manaSource: 'attack',
    },
  },
  {
    id: 'mn_demon',
    name: '萨卡兹大剑手',
    tier: 'normal',
    enemyId: 'enemy_1010_demon',
    stats: { hp: 1000, attackDamage: 100, armor: 10, magicResist: 10, range: 1, attackSpeed: 1200 },
    // 被动：魔抗 +20
    skill: { name: '—', desc: '被动：魔抗 +20', effects: [], passive: { magicResistFlat: 20 }, manaSource: 'attack' },
  },
  {
    id: 'mn_wteeth',
    name: '拾荒者',
    tier: 'normal',
    enemyId: 'enemy_1030_wteeth',
    stats: { hp: 900, attackDamage: 70, armor: 20, magicResist: 20, range: 1, attackSpeed: 1200 },
    // 被动：攻击时附带 5 秒流血（每秒扣目标最大生命 1%）
    mechanics: [{ kind: 'bleed', ratioBp: 100, intervalTicks: 20, durationTicks: 100 }],
    skill: {
      name: '扒取',
      desc: '被动：攻击时附带 5 秒流血效果（每秒扣除目标最大生命值 1% 的生命值）',
      effects: [],
      manaSource: 'attack',
    },
  },
  {
    id: 'mn_shield',
    name: '重装防御者',
    tier: 'normal',
    enemyId: 'enemy_1006_shield',
    // 高护甲肉盾（表里物抗 50 + 被动 +20 = 70）
    stats: { hp: 1200, attackDamage: 50, armor: 50, magicResist: 10, range: 1, attackSpeed: 1200 },
    skill: { name: '—', desc: '被动：物抗 +20', effects: [], passive: { armorFlat: 20 }, manaSource: 'attack' },
  },

  // ---------------- 精英（5）----------------
  {
    id: 'mn_sotisd',
    name: '游击队盾卫',
    tier: 'elite',
    enemyId: 'enemy_1081_sotisd',
    // 表里物抗 50 + 被动 +30 = 80、魔抗 50 + 30 = 80
    stats: { hp: 2000, attackDamage: 120, armor: 50, magicResist: 50, range: 1, attackSpeed: 1200 },
    // 常驻嘲讽（表里"每 10 秒强制周围 3 格干员改打自己"，用户确认按常驻处理）
    mechanics: [{ kind: 'taunt', radius: 2 }],
    skill: {
      name: '盾卫压制',
      desc: '自然回复：持续迫使周围 3 格内的干员改变攻击目标、优先攻击自己；被动：物抗 +30、魔抗 +30',
      effects: [],
      passive: { armorFlat: 30, magicResistFlat: 30 },
      manaSource: 'auto',
      manaPerSecond: 100,
    },
  },
  {
    id: 'mn_mdgint',
    name: '泥岩巨像',
    tier: 'elite',
    enemyId: 'enemy_1092_mdgint',
    // 超肉、慢：表里生命 2500，被动 +200% -> 实际 7500；攻速 -50%
    stats: { hp: 2500, attackDamage: 500, armor: 10, magicResist: 10, range: 1, attackSpeed: 1200 },
    skill: {
      name: '岩躯',
      desc: '被动：生命值 +200%，攻击速度 -50%',
      effects: [],
      passive: { hpBp: 20000, attackSpeedBp: -5000 },
      manaSource: 'attack',
    },
  },
  {
    id: 'mn_spklr',
    name: '“盛怒”',
    tier: 'elite',
    enemyId: 'enemy_1129_spklr',
    stats: { hp: 2200, attackDamage: 170, armor: 10, magicResist: 10, range: 1, attackSpeed: 1200 },
    // 被动：攻击生命值低于一半的干员时，造成的伤害 +50%
    mechanics: [{ kind: 'executeBonus', hpThresholdBp: 5000, ratioBp: 5000 }],
    skill: {
      name: '积怒',
      desc: '被动：攻击生命值低于一半的干员时，造成的伤害 +50%',
      effects: [],
      manaSource: 'attack',
    },
    /*
      ★ “盛怒”**没有复活机制**（用户确认：表里没写它的二阶段，就是没有）。
      素材库里那套 `enemy_1129_spklr_2`（无羁的“盛怒”）现在**用不上了**，
      assets/chibi/mn_spklr_2 留在那儿不动 —— 万一以后要加回来，接上就行。
    */
  },
  {
    id: 'mn_dushdo',
    name: '深池伙友影刃精英',
    tier: 'elite',
    enemyId: 'enemy_1175_dushdo_2',
    stats: { hp: 1700, attackDamage: 200, armor: 10, magicResist: 60, range: 1, attackSpeed: 1200 },
    // 被动：场上有卫队精英时，普通攻击变成法术伤害
    mechanics: [{ kind: 'pairRequires', requiresDefId: 'mn_duholy', damageType: 'magic' }],
    skill: {
      name: '影匿',
      desc: '被动：回合开始 10 秒内进入隐匿（不会被敌人选为目标、也不会被走向，但仍会被范围技能打到）；场上有深池伙友卫队精英时，攻击造成法术伤害',
      effects: [],
      // 开局 10 秒不可选中（200 tick）
      battleStart: [{ kind: 'buff', target: 'self', stats: { untargetable: true }, durationTicks: 200 }],
      manaSource: 'attack',
    },
  },
  {
    id: 'mn_duholy',
    name: '深池伙友卫队精英',
    tier: 'elite',
    enemyId: 'enemy_1174_duholy_2',
    stats: { hp: 2300, attackDamage: 100, armor: 60, magicResist: 10, range: 1, attackSpeed: 1200 },
    // 被动：场上有影刃精英时，自身每 3 秒回复最大生命 10%（3 秒 = 60 tick）
    mechanics: [{ kind: 'pairRequires', requiresDefId: 'mn_dushdo', intervalTicks: 60, selfHealBp: 1000 }],
    skill: {
      name: '卫队庇护',
      desc: '被动：场上有深池伙友影刃精英时，自身每 3 秒回复自身最大生命值的 10%',
      effects: [],
      manaSource: 'attack',
    },
  },

  // ---------------- 小领袖（3）----------------
  {
    id: 'mn_cqbw',
    name: 'W',
    tier: 'leader',
    enemyId: 'enemy_1504_cqbw',
    // 远程爆破（攻击距离 3）
    stats: { hp: 3500, attackDamage: 250, armor: 40, magicResist: 40, range: 3, attackSpeed: 1200 },
    // 被动：免疫眩晕；击杀干员时回复自身 10% 生命值
    mechanics: [{ kind: 'stunImmune' }, { kind: 'healOnKill', hpBp: 1000 }],
    skill: {
      name: '阔剑地雷',
      desc: '每 10 秒锁定一名生命值最低的敌方干员，造成一次 3×3 范围的 200% 爆炸物理伤害；被动：免疫眩晕，击杀干员时回复自身 10% 生命值',
      // 每 10 秒一轮 -> 自动回蓝 100/秒
      effects: [
        {
          kind: 'damage',
          target: 'lowestHpEnemy',
          fallback: 'nearestEnemy',
          power: 2000,
          damageType: 'physical',
          radius: 1,
          shape: 'square',
        },
      ],
      manaSource: 'auto',
      manaPerSecond: 100,
    },
  },
  {
    id: 'mn_jakill',
    name: '杰斯顿·威廉姆斯',
    tier: 'leader',
    enemyId: 'enemy_1516_jakill',
    stats: { hp: 4000, attackDamage: 270, armor: 30, magicResist: 30, range: 3, attackSpeed: 1200 },
    skill: {
      name: '处刑宣告',
      // 一阶段的主动技能写在 phase1.effects 里（见下），这里只留一句说明
      desc: '一阶段：每 2 次攻击，下一次攻击附带 2 秒眩晕；被动：攻击距离 3、攻击速度 -30%、魔抗 +20',
      effects: [],
      manaSource: 'attack',
    },
    /*
      ★ 一二阶段**不同时生效**（表里特别注了这一句）：
      一阶段那套被动/机制在二阶段会被整个换掉，所以两边都写全。
      死亡后倒地 3 秒（60 tick）站起来进二阶段。
    */
    reborn: {
      hpBp: 10000,
      delayTicks: 60,
      /*
        ★ 倒地演出加速一倍（用户点名要的）。
        它的阵亡动作 C1_Die 有 4 秒（24 帧 @ 6fps），倒地只等 3 秒 ——
        按原速播会"还没倒稳就到点了"。×2 之后 1.5 秒演完，剩下的时间保持倒地姿势。
      */
      downedAnimSpeed: 2,
      phase1: {
        range: 3,
        passive: { attackSpeedBp: -3000, magicResistFlat: 20 },
        mechanics: [
          {
            kind: 'everyNthAttack',
            every: 2,
            stats: { stunOnHit: { chanceBp: 10000, durationTicks: 40 } },
          },
        ],
        desc: '一阶段：远程（3 格）、攻速 -30%、魔抗 +20，每 2 击附带 2 秒眩晕',
      },
      phase2: {
        range: 1,
        passive: { attackSpeedBp: 5000, attackDamageBp: 5000, armorFlat: 30 },
        mechanics: [],
        desc: '二阶段：近战（1 格）、攻速 +50%、攻击力 +50%、物抗 +30',
      },
      desc: '死亡后 3 秒复活，转入近战二阶段',
    },
  },
  {
    id: 'mn_reid',
    name: '“复仇者”',
    tier: 'leader',
    enemyId: 'enemy_1539_reid',
    stats: { hp: 3300, attackDamage: 310, armor: 20, magicResist: 20, range: 1, attackSpeed: 1200 },
    // 一二阶段**同时生效**的被动：生命值 ≤50% 时，攻击力 +100%、攻速 +100%
    mechanics: [{ kind: 'lowHpSurge', hpThresholdBp: 5000, speedBp: 10000, attackDamageBp: 10000 }],
    skill: {
      name: '复仇誓约',
      desc: '开局瞬移到离自己最近的敌方单位面前；被动：生命值 ≤50% 时攻击力与攻击速度各 +100%',
      effects: [],
      // 一阶段：回合开始瞬移到最近的敌人面前
      battleStart: [{ kind: 'teleport', target: 'nearestEnemy' }],
      manaSource: 'attack',
    },
    /*
      一二阶段**同时生效**：所以被动（lowHpSurge）与开场瞬移写在"基础层"，
      不会被二阶段换掉。二阶段独有的是"复活后血量重置为 49% + 无敌 8 秒"。
      死亡后倒地 5 秒（100 tick）再站起来。
    */
    reborn: {
      hpBp: 4900,
      delayTicks: 100,
      phase2: {
        reviveHpBp: 4900,
        // 无敌 8 秒 = 160 tick
        buffs: [{ stats: { invulnerable: true }, durationTicks: 160 }],
        desc: '二阶段：血量重置为最大生命的 49%，并无敌 8 秒',
      },
      desc: '死亡后 5 秒复活，血量回到 49% 且无敌 8 秒',
    },
  },

  // ---------------- Boss（2）----------------
  {
    id: 'mn_skzdd',
    name: '博卓卡斯替，圣卫铳骑',
    tier: 'boss',
    enemyId: 'enemy_2082_skzdd',
    // ★ 0.2.1 表现层（用户口径）：他的普攻也走"子弹"弹道（二阶段射程 3 时最明显）
    tracerFx: 'bullet_angel',
    /*
      ★ 0.0.3「干员调整A版」第 20 条：面板改成 生命 18000 / 攻击 800 / 双抗 80 / 射程 1。
      （A 版那句"生命值18000，攻击距离1，攻击力800，物抗80，魔抗80"就是这一行；
        它前面的"二阶段攻击距离变为3格"是**阶段覆盖**，不是基础射程。）
    */
    stats: { hp: 18000, attackDamage: 800, armor: 80, magicResist: 80, range: 1, attackSpeed: 1200 },
    skill: {
      name: '圣卫铳击',
      desc: '一阶段：每 10 秒对全部敌方单位造成攻击力 100% 的物理伤害；被动：被攻击时按距离减伤（每远 1 格 -20%，5 格封顶 -80%，真实伤害无视）',
      effects: [],
      manaSource: 'auto',
      manaPerSecond: 100,
    },
    /*
      一二阶段**不同时生效**（表里注明了）：
        · 一阶段：射程 1、10 秒一次全体 100% 物伤、按距离减伤（每格 -20%，5 格封顶 -80%）
        · 二阶段：射程 3、5 秒一次全体 150% 物伤、受伤 +50%、攻速 +30%
      死亡后倒地 3 秒（60 tick）站起来，**倒地期间无敌且不能被选为目标**
      （这条通用规则在 combat-math.ts 的 downedUntilTick 上，不写在这里）。
      （素材里二阶段就是同一套骨架的 C2_* 动作，所以 phase2 不写 artId ——
       客户端按"同清单里的 _2 动作集"切。）
    */
    reborn: {
      hpBp: 10000,
      delayTicks: 60,
      phase1: {
        range: 1,
        manaSource: 'auto',
        manaPerSecond: 100,
        effects: [{ kind: 'damage', target: 'allEnemies', power: 1000, damageType: 'physical' }],
        mechanics: [{ kind: 'distanceReduction', perCellBp: 2000, maxBp: 8000 }],
        desc: '一阶段：近战，每 10 秒对全体造成 100% 攻击力物伤，按距离减伤（每格 -20%，封顶 -80%）',
      },
      phase2: {
        range: 3,
        manaSource: 'auto',
        manaPerSecond: 200,
        effects: [{ kind: 'damage', target: 'allEnemies', power: 1500, damageType: 'physical' }],
        passive: { attackSpeedBp: 3000, damageTakenBp: 5000 },
        mechanics: [],
        desc: '二阶段：远程，每 5 秒对全体造成 150% 攻击力物伤，攻速 +30%、受伤 +50%',
      },
      desc: '死亡后 3 秒复活并转入远程二阶段',
    },
  },
  {
    id: 'mn_skzjkl',
    name: '奎隆，摩诃萨埵权化',
    tier: 'boss',
    enemyId: 'enemy_2089_skzjkl',
    stats: { hp: 15000, attackDamage: 750, armor: 70, magicResist: 65, range: 1, attackSpeed: 1200 },
    skill: {
      name: '权化',
      desc: '在场时：每 4 秒随机对场地 5 格落雷（不分敌我，每格 300 点真实伤害）；全部敌方单位受到的伤害 +20%、物抗 -50%',
      effects: [],
      /*
        开局对**敌方全体**上两条永久负面（-50% 物抗 = armorBp -5000）。
        用 MAX_BATTLE_TICKS 当"永久"（tickSkill 认得这个值，不会倒计时）。
      */
      battleStart: [
        { kind: 'buff', target: 'allEnemies', stats: { damageTakenBp: 2000 }, durationTicks: MAX_BATTLE_TICKS },
        { kind: 'buff', target: 'allEnemies', stats: { armorBp: -5000 }, durationTicks: MAX_BATTLE_TICKS },
      ],
      manaSource: 'attack',
    },
    /*
      一二阶段**同时生效**（表里注明了），所以上面那两条 battleStart 不随阶段变。
      不同的是：
        · 一阶段：每 5 击 → 下一次 5 连击（每段 90%）；每 15 秒召唤 2 只“盛怒”
        · 二阶段：每 3 击 → 下一次 5 连击（每段 150%）；落雷速度 +100%；最大生命 -30%
      死亡后倒地 3 秒（60 tick）站起来。
    */
    reborn: {
      hpBp: 10000,
      delayTicks: 60,
      phase1: {
        mechanics: [
          // 每 4 秒 = 80 tick，随机 5 格落雷（每格 300 真伤）
          {
            kind: 'periodic',
            intervalTicks: 80,
            effect: { type: 'randomCellStrike', power: 300, damageType: 'true', cells: 5 },
          },
          // 每 15 秒 = 300 tick 召唤两只“盛怒”
          { kind: 'periodic', intervalTicks: 300, effect: { type: 'summon', defId: 'mn_spklr', count: 2 } },
          // 每 5 击 -> 下一次 5 连击（每段 90%）且波及相邻 4 格
          {
            kind: 'everyNthAttack',
            every: 5,
            stats: {
              multiHit: 5,
              attackDamageBp: -1000,
              splash: { radius: 1, shape: 'cross', ratioBp: COMBO_SPLASH_BP, damageType: 'physical' },
            },
          },
        ],
        desc: '一阶段：每 5 击变 5 连击（每段 90%，并波及相邻 4 格），每 15 秒召唤两只“盛怒”',
      },
      phase2: {
        /*
          ★ 0.0.3「干员调整A版」第 21 条：二阶段独享被动改成
            「落雷速度 +100%，最大生命值 **+30%**，攻击速度 **+30%**」。
          以前这里写的是 maxHpBp: 7000（-30%，明显是抄错了方向），
          现在按 A 版改成 13000（×1.3），并把 +30% 攻速补上。
        */
        maxHpBp: 13000,
        passive: { attackSpeedBp: 3000 },
        mechanics: [
          // 落雷速度 +100% -> 每 2 秒 = 40 tick
          {
            kind: 'periodic',
            intervalTicks: 40,
            effect: { type: 'randomCellStrike', power: 300, damageType: 'true', cells: 5 },
          },
          // 二阶段也有召唤，而且更快：每 10 秒 = 200 tick
          { kind: 'periodic', intervalTicks: 200, effect: { type: 'summon', defId: 'mn_spklr', count: 2 } },
          // 每 3 击 -> 下一次 5 连击（每段 150%）且波及相邻 4 格
          {
            kind: 'everyNthAttack',
            every: 3,
            stats: {
              multiHit: 5,
              attackDamageBp: 5000,
              splash: { radius: 1, shape: 'cross', ratioBp: COMBO_SPLASH_BP, damageType: 'physical' },
            },
          },
        ],
        desc: '二阶段：每 3 击变 5 连击（每段 150%，并波及相邻 4 格），每 10 秒召唤两只“盛怒”，落雷速度 +100%，最大生命 +30%，攻速 +30%',
      },
      desc: '死亡后 3 秒复活并转入二阶段（落雷更快、连击更狠、召唤更勤、血更多更硬）',
    },
  },

  // ============================================================
  //  ★ 0.1.3：特殊野怪（3 只）—— **不进野怪波次**，只从测试模式的修改器发
  // ============================================================
  //
  // 【和别的野怪不一样的三点】
  //   1. 档位是 `special` —— 波次表里没有这一档，所以**永远不会**出现在野怪回合；
  //   2. 数值 / 技能是**用户直接给的正式数据**，不是按档位模板套的占位；
  //   3. 后续会作为"羁绊的召唤单位"登场（用户原话），所以依然走 `mn_` 前缀、
  //      和其它野怪共用同一套机制（嘲讽 / 复活 / 召唤 / 周期技能）。
  //
  // 【"左手"为什么挂锋盔骑士团精锐的素材？】
  //   游戏里"左手"和锋盔骑士团学徒 / 精锐**共用同一套模型与能力**
  //   （官方 tooltip 就是同一句话），它自己**没有独立素材** —— 这点查证过。
  {
    id: 'mn_tytus',
    name: '“左手”泰特斯·白杨',
    tier: 'special',
    enemyId: 'enemy_1104_lfkght_2',
    stats: { hp: 2000, attackDamage: 120, armor: 40, magicResist: 40, range: 1, attackSpeed: 1800 },
    skill: {
      name: '锋盔削弱',
      desc: '每 15 秒使敌方攻击力最高的 3 名单位攻击力 -40%，持续 10 秒；被动：入场时立刻释放一次',
      effects: [
        {
          kind: 'debuff',
          target: 'highestAttackEnemies',
          count: 3,
          stats: { attackDamageBp: -4000 },
          durationTicks: 200,
        },
      ],
      manaSource: 'auto',
      // 每 15 秒一轮 -> 自动回蓝 1000/15
      manaPerSecond: 1000 / 15,
      // ★ 被动「入场时立刻开启一次技能」= 开局技能条就是满的
      startManaBp: 10000,
    },
    reborn: {
      hpBp: 10000,
      // 复活时间 2 秒
      delayTicks: 40,
      phase2: {
        // 复活后 2 秒无敌
        buffs: [{ stats: { invulnerable: true }, durationTicks: 40 }],
        desc: '复活后无敌 2 秒',
      },
      desc: '首次阵亡后倒地 2 秒复活（满血），并无敌 2 秒',
    },
  },
  {
    id: 'mn_bldkgt',
    name: '血骑士狄开俄波利斯',
    tier: 'special',
    enemyId: 'enemy_1524_bldkgt',
    stats: { hp: 4000, attackDamage: 180, armor: 50, magicResist: 50, range: 1, attackSpeed: 1500 },
    skill: {
      name: '凝血',
      desc:
        '每 4 秒在场地边缘随机生成一个凝血之刃；刀刃走到血骑士身边时为其回复 8% 最大生命，' +
        '并使其攻击力与攻速 +50%（持续 10 秒，不叠加），随后刀刃消失',
      effects: [
        // durationTicks: 0 = 不限期（刀刃只会在"送达"或主人阵亡时消失）
        { kind: 'summon', summonId: 'mn_bloodblade', count: 1, durationTicks: 0, place: 'randomEdge' },
      ],
      manaSource: 'auto',
      // 每 4 秒一轮
      manaPerSecond: 250,
    },
    reborn: {
      hpBp: 10000,
      // 复活时间 3 秒
      delayTicks: 60,
      phase2: {
        // 复活后 3 秒无敌
        buffs: [{ stats: { invulnerable: true }, durationTicks: 60 }],
        /*
          复活后**立刻**再来一波 6 只刀刃 —— 走 `onEnter`（进入这一阶段时结算一次）。
          ★ 这里**不能**用 `effects`：那会把技能**永久**换成"召唤 6 只"，
          复活之后每 4 秒都会再召 6 只，和"每 4 秒 1 只"的原设计冲突。
        */
        onEnter: [
          { kind: 'summon', summonId: 'mn_bloodblade', count: 6, durationTicks: 0, place: 'randomEmpty' },
        ],
        desc: '复活后无敌 3 秒，并立刻随机召唤 6 只凝血之刃',
      },
      desc: '首次阵亡后倒地 3 秒复活，无敌 3 秒并召唤 6 只凝血之刃',
    },
  },
  {
    id: 'mn_blkswb',
    name: '锏',
    tier: 'special',
    enemyId: 'enemy_1525_blkswb',
    stats: { hp: 7000, attackDamage: 250, armor: 50, magicResist: 50, range: 1, attackSpeed: 1800 },
    skill: {
      name: '斩击',
      desc:
        '每 10 秒：2 秒内无敌，随后对周围 3×3 及十字 2 格范围造成 10 次 60% 攻击力的斩击，' +
        '被打的敌人战栗 4 秒（不能普通攻击）；被动：普攻造成 2 次 90% 的连击，' +
        '每段各 10% 概率使目标战栗 1.5 秒',
      effects: [
        // ① 先给自己 2 秒无敌（40 tick）
        { kind: 'buff', target: 'self', stats: { invulnerable: true }, durationTicks: 40 },
        /*
          ② 星形范围斩击：**2 秒内每 0.2 秒一次、共 10 次**（用户口径）。
          ★ 原来是 `damage` + `hits: 10` —— 那样 10 段会在**同一 tick** 全部打完，
          看起来像"瞬间爆发"，和"2 秒内斩 10 次"完全不是一回事（用户报的就是这条）。
          改成挂在**自己身上**的范围持续伤害：每跳以它当前的位置为中心打一圈，
          所以它一边走一边斩 —— 这才是"斩击"该有的样子。
          `durationTicks: 40`（2 秒）÷ `intervalTicks: 4`（0.2 秒）= 正好 10 跳。
        */
        {
          kind: 'dot',
          target: 'self',
          power: 600,
          damageType: 'physical',
          durationTicks: 40,
          intervalTicks: 4,
          radius: 2,
          shape: 'star',
          // 被打到的敌人战栗 4 秒（80 tick）—— 每跳都会刷新，所以效果上是"斩击期间一直被按住"
          debuff: { stats: { disarmed: true }, durationTicks: 80 },
        },
      ],
      // 被动：2 连击 ×90%，逐段各 10% 概率上 1.5 秒战栗（30 tick）
      passive: {
        multiHit: 2,
        multiHitBp: 9000,
        disarmOnHit: { chanceBp: 1000, durationTicks: 30, perHit: true },
      },
      manaSource: 'auto',
      // 每 10 秒一轮
      manaPerSecond: 100,
    },
    reborn: {
      hpBp: 10000,
      // 复活时间 3 秒
      delayTicks: 60,
      phase2: {
        buffs: [{ stats: { invulnerable: true }, durationTicks: 60 }],
        // 复活后获得 50% 技能条
        manaBp: 5000,
        desc: '复活后无敌 3 秒，并获得 50% 技能条',
      },
      desc: '首次阵亡后倒地 3 秒复活（满血），无敌 3 秒并获得 50% 技能条',
    },
  },
  {
    /*
      ★ 0.1.3：**凝血之刃** —— 血骑士召唤出来的伴生单位。
      【它为什么算"野怪"而不是普通召唤物？】用户口径：
      「凝血之刃也使用野怪模型的效果（没有卡面背景，但有模型，模型使用的官方，属于敌对怪物）」
      —— 所以它走 `monsterOnly` 那一套（不画卡面背景、按野怪的方式缩放小人），
      素材用官方的 `enemy_1186_bldbld`（图鉴号 NL21）。
      【和普通野怪的差别】档位 `special` -> 不进波次、也没有掉落表。
    */
    id: 'mn_bloodblade',
    name: '凝血之刃',
    tier: 'special',
    enemyId: 'enemy_1186_bldbld',
    stats: { hp: 1000, attackDamage: 0, armor: 10, magicResist: 10, range: 1, attackSpeed: 1200 },
    mechanics: [
      // 永久嘲讽：敌人优先打它（它是来"送"的，正好替主人挡刀）
      { kind: 'taunt' },
      {
        kind: 'escort',
        targetDefId: 'mn_bldkgt',
        // 「处于血骑士周围 8 格时」-> 贴到身边那一圈就送达
        range: 1,
        healBp: 800,
        stats: { attackDamageBp: 5000, attackSpeedBp: 5000 },
        // ★ 用户补充口径：+50% 只持续 10 秒、不叠加
        buffTicks: 200,
      },
    ],
    skill: {
      name: '凝血',
      desc: '不攻击；只朝血骑士前进，贴身时为其回复生命并强化，随后消散',
      effects: [],
      manaSource: 'auto',
    },
  },
];

// ============================================================
// 由名单生成 UnitDef
// ============================================================

/**
 * ★ 用户要求：**所有小领袖和 Boss 都免疫眩晕**。
 *
 * 【为什么写成"按档位的规则"而不是给每个条目手写一行？】
 * 因为这是一条**规则**，不是三个人的巧合。写成规则之后：
 *   · 以后再加一个小领袖 / Boss 会自动带上，不会漏；
 *   · 条目里已经手写过 `stunImmune` 的（比如 W）也不会被重复追加。
 *
 * （精英及以下**不免疫** —— 那些是"可以被控住"的常规敌人，
 *   不然玩家的眩晕/冰冻体系在整场战斗里几乎没有着力点。）
 */
const STUN_IMMUNE_TIERS: ReadonlySet<MonsterTier> = new Set<MonsterTier>(['leader', 'boss']);

/**
 * 把"数据表自带机制" + "按档位自动附带的机制"合成一份。
 * 没有任何机制时返回 `undefined`（保持字段不出现，和以前一样）。
 */
function monsterMechanicsOf(entry: MonsterEntry): ScopedMechanic[] | undefined {
  const list: ScopedMechanic[] = entry.mechanics ? [...entry.mechanics] : [];
  if (STUN_IMMUNE_TIERS.has(entry.tier) && !list.some((item) => item.kind === 'stunImmune')) {
    list.push({ kind: 'stunImmune' });
  }
  return list.length > 0 ? list : undefined;
}

function buildMonsterDef(entry: MonsterEntry): UnitDef {
  const base: BaseStats = { ...TIER_BASE[entry.tier], ...entry.stats };
  const mechanics = monsterMechanicsOf(entry);
  return {
    id: entry.id,
    name: entry.name,
    cost: TIER_COST[entry.tier],
    // 野怪不吃羁绊（它们没有阵营），traits 留空 => 羁绊计算天然把它们排除在外
    traits: [],
    base,
    // ★ 野怪不升星：星级倍率固定 1000（×1），战斗里永远按 1 星算
    starHpBp: 1000,
    starDamageBp: 1000,
    color: MONSTER_TIER_COLOR[entry.tier],
    sprite: entry.id,
    // ★ 素材走官方敌人模型（Ark-Models 的 models_enemies/<key>/）
    charId: entry.enemyId,
    // ★ 0.2.1 表现层：普攻弹道（Bullet FX 注册表键），不写就画原来那根白线
    tracerFx: entry.tracerFx,
    // ★ 标记：不进商店、不进牌库、不当"敌方干员"
    monsterOnly: true,
    monsterTier: entry.tier,
    reborn: entry.reborn,
    // ★ 0.0.3：数据表自带的战斗中机制（与阶段无关的那一层）
    //   + 小领袖 / Boss 自动附带的"免疫眩晕"（见 STUN_IMMUNE_TIERS）
    ...(mechanics ? { mechanics } : {}),
    skill: {
      id: `${entry.id}_skill`,
      name: entry.skill.name,
      desc: entry.skill.desc,
      effects: entry.skill.effects,
      ...(entry.skill.passive ? { passive: entry.skill.passive } : {}),
      ...(entry.skill.battleStart ? { battleStart: entry.skill.battleStart } : {}),
      manaSource: entry.skill.manaSource,
      ...(entry.skill.manaPerSecond !== undefined ? { manaPerSecond: entry.skill.manaPerSecond } : {}),
      // ★ 0.1.3：开局技能条（"左手"的"入场时立刻开一次技能"）
      ...(entry.skill.startManaBp !== undefined ? { startManaBp: entry.skill.startManaBp } : {}),
    },
  };
}

/** 野怪定义表（会被并进 UNIT_DEFS，见 unit-data.ts） */
export const MONSTER_DEFS: UnitDefTable = Object.fromEntries(
  MONSTER_ROSTER.map((entry) => [entry.id, buildMonsterDef(entry)]),
);

/**
 * ★ 0.0.3：把一条机制写成一句人话（界面详情页用）。
 *
 * 【为什么要单独写？】
 * "详情页把技能写得更详细"是用户点名要的。而野怪的能力有一大半是
 * **机制**（嘲讽 / 流血 / 周期落雷…），它们不是 `skill.desc` 里的字符串 ——
 * 不翻译出来，玩家在详情页就只能看到一句概括。
 * 这里做的是"机制 -> 中文"的唯一映射，改机制名只要改这一处。
 */
export function mechanicText(mechanic: ScopedMechanic): string {
  const pct = (bp: number): string => `${Math.round(bp / 100)}%`;
  switch (mechanic.kind) {
    case 'armorPen':
      return `攻击无视目标 ${pct(mechanic.ratioBp)} 护甲`;
    case 'bleed':
      return `攻击附带流血：每 ${mechanic.intervalTicks / 20} 秒扣目标最大生命 ${pct(mechanic.ratioBp)}，持续 ${mechanic.durationTicks / 20} 秒`;
    case 'executeBonus':
      return `目标生命低于 ${pct(mechanic.hpThresholdBp)} 时，造成的伤害 +${pct(mechanic.ratioBp)}`;
    case 'stunImmune':
      return '免疫眩晕';
    case 'healOnKill':
      return `击杀时回复自身最大生命 ${pct(mechanic.hpBp)}`;
    case 'pairRequires':
      return `场上有同伴时生效：${mechanic.damageType ? '普通攻击变为法术伤害' : ''}${
        mechanic.selfHealBp ? `每 ${(mechanic.intervalTicks ?? 0) / 20} 秒回复最大生命 ${pct(mechanic.selfHealBp)}` : ''
      }`;
    case 'taunt':
      return `嘲讽：${mechanic.radius ? `周围 ${mechanic.radius} 格` : '全场'}的敌人优先攻击自己`;
    case 'periodic':
      return `每 ${mechanic.intervalTicks / 20} 秒：${periodicText(mechanic.effect)}`;
    case 'distanceReduction':
      return `被攻击时每远 1 格减伤 ${pct(mechanic.perCellBp)}，最多减 ${pct(mechanic.maxBp)}（真实伤害无视）`;
    case 'lowHpSurge':
      return `生命降到 ${pct(mechanic.hpThresholdBp)} 以下时，攻击速度 +${pct(mechanic.speedBp)}${
        mechanic.attackDamageBp ? `、攻击力 +${pct(mechanic.attackDamageBp)}` : ''
      }`;
    default:
      return mechanic.kind;
  }
}

/** 周期效果 -> 中文 */
function periodicText(effect: PeriodicEffect): string {
  if (effect.type === 'allEnemiesDamage') return `对全体敌人造成攻击力 ${Math.round(effect.attackBp / 100)}% 的伤害`;
  if (effect.type === 'randomCellStrike') {
    return `随机对场地 ${effect.cells ?? 1} 格落雷，对格内所有单位（不分敌我）造成 ${effect.power} 点真实伤害`;
  }
  return `在最上方和最下方召唤 ${effect.count} 只「${MONSTER_DEFS[effect.defId]?.name ?? effect.defId}」`;
}

/**
 * ★ 0.0.3：野怪详情页的"技能详表"—— 档位 / 一二阶段 / 逐条机制。
 * 普通干员返回空数组（它们的技能说明已经写在 `skill.desc` 里了）。
 */
export function monsterSkillDetail(def: UnitDef): string[] {
  if (def.monsterOnly !== true) return [];
  const lines: string[] = [];
  const tier = def.monsterTier;
  if (tier) lines.push(`级别：${MONSTER_TIER_LABEL[tier]}`);
  if (def.reborn?.phase1?.desc) lines.push(`一阶段：${def.reborn.phase1.desc}`);
  if (def.reborn?.phase2?.desc) lines.push(`二阶段：${def.reborn.phase2.desc}`);
  else if (def.reborn) lines.push(`重生：${def.reborn.desc}`);
  for (const mechanic of def.mechanics ?? []) lines.push(mechanicText(mechanic));
  return lines;
}

/** 所有野怪（按级别从弱到强排序，级别内保持名单顺序） */
export function monsterDefs(defs: UnitDefTable = MONSTER_DEFS): UnitDef[] {
  const order = new Map(MONSTER_TIERS.map((tier, i) => [tier, i]));
  return Object.values(defs).sort(
    (a, b) => (order.get(a.monsterTier ?? 'minion') ?? 0) - (order.get(b.monsterTier ?? 'minion') ?? 0),
  );
}

// ============================================================
// 野怪回合
// ============================================================

/**
 * 【哪几回合是野怪回合？】
 *   第 1、2 回合，然后**每隔 7 回合**一次：9 / 16 / 23 / 30 / 37 / 44 / 51 / 58 / 65 / 72 / 79 …
 *
 * ★ 用户表里原来写的是 43 / 50 / 57 / 63 / 70，其中 37→43、57→63 是 +6 ——
 *   用户确认那是**笔误**，正确的一律 +7（所以整段顺延成 44 / 51 / 58 / 65 / 72）。
 *   现在这个判定就是一句等差数列，不再维护一份"手抄的回合号数组"。
 */
export const MONSTER_ROUNDS: readonly number[] = [
  1,
  ...Array.from({ length: 11 }, (_, i) => 2 + i * 7), // 2, 9, 16, … 72
];

export function isMonsterRound(round: number): boolean {
  if (!Number.isFinite(round) || round < 1) return false;
  const r = Math.floor(round);
  if (r === 1) return true;
  return (r - 2) % 7 === 0;
}

/** 第 round 回合之后，下一个野怪回合是第几回合（界面提示用） */
export function nextMonsterRound(round: number): number {
  let r = Math.floor(round) + 1;
  while (!isMonsterRound(r)) r++;
  return r;
}

/**
 * ★ 0.2.2：「距离下一个野怪回合还剩几回合」—— 顶部状态栏那一格用它。
 *
 * 【返回值三样】
 *   · `now`       —— **本回合就是野怪回合**
 *   · `roundsLeft`—— 还要打几个回合才轮到野怪（本回合是野怪时为 0）
 *   · `round`     —— 那个野怪回合是第几回合（本回合是野怪时就是自己）
 *
 * 【为什么放在 shared，不放界面里算？】
 * 这条规则的唯一实现是 `isMonsterRound`（1、2，然后每 7 回合一次）。
 * 界面自己再写一遍 `(r-2)%7` 就等于把节奏抄了两份 —— 以后改节奏（比如改成每 6 回合）
 * 必然只改一处、另一处静默错。所以这里也收进 shared，界面只管念数字。
 *
 * ★ 单人 / 多人**共用**这一份：两边顶栏都读 `state.round`，
 *   区别只在"对手是野怪还是真人"（那由服务器决定），倒计时本身是一样的。
 */
export function monsterRoundCountdown(round: number): {
  now: boolean;
  roundsLeft: number;
  round: number;
} {
  const current = Number.isFinite(round) ? Math.max(1, Math.floor(round)) : 1;
  if (isMonsterRound(current)) return { now: true, roundsLeft: 0, round: current };
  const next = nextMonsterRound(current);
  return { now: false, roundsLeft: next - current, round: next };
}

// ============================================================
// 野怪波次
// ============================================================

/** 波次里的一个位置：哪个野怪、站哪儿 */
export interface MonsterWaveUnit {
  defId: string;
  star: number;
  cell: Cell;
}

/**
 * ============================================================
 *  ★ 波次表（来自《各项数值/野怪分布.txt》）
 * ============================================================
 * key = 野怪回合，value = 这一波由哪些档位、各几只组成。
 * 具体的**哪一只**是随机挑的（骰子只由回合号决定，所以联机两边算出来一样）。
 */
const MONSTER_WAVE_TABLE: Readonly<Record<number, readonly { tier: MonsterTier; count: number }[]>> = {
  1: [{ tier: 'minion', count: 2 }],
  2: [{ tier: 'minion', count: 3 }],
  9: [{ tier: 'normal', count: 5 }],
  16: [
    { tier: 'elite', count: 3 },
    { tier: 'normal', count: 3 },
  ],
  23: [
    { tier: 'elite', count: 5 },
    { tier: 'normal', count: 5 },
  ],
  30: [
    { tier: 'leader', count: 1 },
    { tier: 'elite', count: 3 },
  ],
  37: [
    { tier: 'leader', count: 2 },
    { tier: 'elite', count: 5 },
  ],
  44: [
    { tier: 'leader', count: 3 },
    { tier: 'elite', count: 5 },
  ],
  51: [{ tier: 'boss', count: 1 }],
  58: [
    { tier: 'boss', count: 1 },
    { tier: 'leader', count: 1 },
  ],
  65: [
    { tier: 'boss', count: 1 },
    { tier: 'leader', count: 3 },
  ],
  72: [
    { tier: 'boss', count: 2 },
    { tier: 'leader', count: 3 },
    { tier: 'elite', count: 5 },
  ],
};

/**
 * 深池伙友影刃精英 / 卫队精英**必定同时出现**（用户表里点名的）。
 * 所以它们在抽签时被当成**一只占两个位置**的"组合项"。
 */
const PAIR_IDS: readonly string[] = ['mn_dushdo', 'mn_duholy'];

/** 按档位抽若干只（尽量不重复；组合项要占两格） */
function pickWaveUnits(tier: MonsterTier, count: number, rng: Rng): string[] {
  const all = monsterDefs().filter((def) => def.monsterTier === tier);
  const singles = all.filter((def) => !PAIR_IDS.includes(def.id));
  const entries: string[][] = singles.map((def) => [def.id]);
  if (all.some((def) => def.id === PAIR_IDS[0])) entries.push([...PAIR_IDS]);

  const picked: string[] = [];
  const usedEntries = new Set<number>();
  let guard = 0;
  while (picked.length < count && guard++ < 200) {
    const remaining = count - picked.length;
    const fits = entries.map((entry, i) => ({ entry, i })).filter((x) => x.entry.length <= remaining);
    if (fits.length === 0) break;
    // 优先挑还没出现过的（"5 个普通野怪"应当尽量是 5 只不同的）
    const fresh = fits.filter((x) => !usedEntries.has(x.i));
    const pool = fresh.length > 0 ? fresh : fits;
    const choice = pool[rng.nextInt(pool.length)]!;
    usedEntries.add(choice.i);
    picked.push(...choice.entry);
  }
  return picked.slice(0, count);
}

/**
 * 把一波野怪摆到**对手半场**（右半边）。
 *
 * 站位规则和干员对手**共用同一个函数**（field.ts 的 formationCells）：
 * 近战靠前、远程靠后，行号从中间往两边排 —— 免得所有野怪都挤在最上面一行。
 */
export function placeMonsterWave(units: ReadonlyArray<{ defId: string; star: number }>): MonsterWaveUnit[] {
  const ranges = units.map((unit) => MONSTER_DEFS[unit.defId]?.base.range ?? 1);
  const cells = formationCells(1, ranges);
  return units.map((unit, i) => ({ defId: unit.defId, star: unit.star, cell: cells[i]! }));
}

/**
 * 第 round 回合的野怪波次（含站位）。
 *
 * ★ 布阵阶段显示的、和开战时打的，必须都调这一个函数 ——
 * 否则会出现"看到一波、打另一波"。
 */
export function monsterWaveForRound(round: number): MonsterWaveUnit[] {
  const r = Math.max(1, Math.floor(round));
  // 72 之后沿用最后一档（79/86/… 都是"2 Boss + 3 小领袖 + 5 精英"）
  const rule = MONSTER_WAVE_TABLE[r] ?? MONSTER_WAVE_TABLE[72]!;
  // 骰子**只由回合号决定** —— 联机两边、布阵预览和真正开打，算出来必须是同一波
  const rng = createRng((Math.imul(r, 0x9e3779b1) ^ 0x5bf03635) >>> 0);
  const ids: string[] = [];
  for (const part of rule) ids.push(...pickWaveUnits(part.tier, part.count, rng));
  return placeMonsterWave(ids.map((defId) => ({ defId, star: 1 })));
}

/** 这波野怪都是些什么（一行话，显示在顶部状态栏） */
export function monsterWaveText(wave: ReadonlyArray<MonsterWaveUnit>, defs: UnitDefTable = MONSTER_DEFS): string {
  const counts = new Map<string, number>();
  for (const unit of wave) counts.set(unit.defId, (counts.get(unit.defId) ?? 0) + 1);
  const parts: string[] = [];
  for (const [defId, count] of counts) {
    const name = defs[defId]?.name ?? defId;
    parts.push(count > 1 ? `${name}×${count}` : name);
  }
  return parts.join(' + ') || '（空波次）';
}

/**
 * 把一波野怪包成战斗用的 TeamSetup。
 *
 * 【为什么这里不填羁绊？】
 * 野怪的 `traits` 是空的 —— 它们没有阵营，本来就不该吃羁绊。
 * TeamSetup 上那几个羁绊字段全是可选的（`rules.ts` 里读的时候都带 `?? []`），
 * 所以"什么都不填"就是正确表达，不是偷懒。
 *
 * @param team 这一波野怪算哪一方。单机固定是 1（对手半场）；联机由调用方决定
 */
export function monsterTeamSetup(round: number, team: 0 | 1 = 1): TeamSetup {
  return { team, units: monsterWaveForRound(round) };
}
