/**
 * ============================================================
 *  野怪掉落表（★ 0.0.3 建立，0.1.1 按《各项数值/掉落表 二版.txt》补二版藏品）
 * ============================================================
 *
 * 【表怎么读？】
 * 每个档位都分两件事：
 *   1. **先掷一次金币**（小怪 45% 掉 2 金、普通 30% 掉 4 金；
 *      精英/小领袖/Boss 没有这一档，它们**必掉藏品**）。
 *   2. 没掉金币（或者本来就没有金币档）时，按**分组**掷一件藏品：
 *      先按各组的百分比决定落在哪一组，再在组内**等概率**挑一件。
 *
 * 【为什么"某组 60%"是"等概率挑一件"而不是"每件 60%"？】
 * 因为稀有组（无瑕宝玉那一档）在表里是**逐件写了百分比**的
 * （0.5% / 2% / 0.25%…），而它们加起来正好等于那一组的总百分比 ——
 * 也就是说"百分比"是**组级**的，组内是等概率（稀有组则按各自权重）。
 * 这样四组正好凑满 100%，语义自洽。
 *
 * 【★ 0.1.1：稀有组的"逐件权重"是**组内相对权重**，不是绝对概率】
 * 二版把 10 件进阶共享藏品并进稀有组（8 → 18 件）之后，
 * 组内权重之和**不再**等于组级权重 —— 挑的时候按"权重 ÷ 组内权重和"归一化，
 * 所以：老件按原比例整体稀释，新件拿"基础档"权重。
 * 真实概率 = 组权重 × 权重 ÷ 组内权重和（导表脚本按这个公式算）。
 *
 * 【数据唯一真相】改掉落只改这个文件，界面/服务端不认识任何具体藏品名。
 */

import type { BattleEvent } from './types.js';
import type { Rng } from './rng.js';

/** 掉落表里的"组"：要么等概率挑一件，要么按逐件权重挑 */
export interface DropGroup {
  /** 这一组占的万分比权重（6000 = 60%） */
  weightBp: number;
  /** 组内的候选藏品；等概率（不写 weightsBp）或按逐件权重 */
  items: readonly string[];
  /** 逐件权重（万分比）。不写 = 组内等概率 */
  weightsBp?: readonly number[];
}

/** 一个档位的掉落规则 */
export interface DropRule {
  /** 先掷金币：命中概率 + 金币数（不写 = 这个档不掉金） */
  gold?: { chanceBp: number; amount: number };
  /** 必掉的藏品件数（0 = 没掉金币时才掉一件） */
  guaranteed?: number;
  /** 在必掉的基础上，有 chanceBp 概率再掉一件 */
  extraChanceBp?: number;
  /** 分组（权重之和应当是 10000） */
  groups: readonly DropGroup[];
}

// ============================================================
// 藏品清单（按掉落表里的行号分组）
// ============================================================

/** 1~8：便宜的普通藏品（＋二版新增的 5 件普通穿戴藏品） */
const A = [
  'itm_solvent',
  'itm_yan_blade',
  'itm_bulwark',
  'itm_goliath_helm',
  'itm_arcane_array',
  'itm_dormant_spawn',
  'itm_accelerator',
  'itm_blast_shield',
  // ---- 0.1.1 二版新增（普通 穿戴）----
  'itm_bloody_dictionary', // 染血辞典
  'itm_dancer_bracelet', // 舞者手链
  'itm_designer_ruler', // 设计师量尺
  'itm_mage_slayer', // “法术杀手”
  'itm_gaul_check', // 高卢银行支票
] as const;

/** 9~20：中间那批（含三件共享藏品）＋二版新增的 3 件普通共享藏品 */
const B = [
  'itm_m3_cocoon',
  'itm_raid_grenade',
  'itm_ration',
  'itm_terrain_map',
  'itm_old_coin',
  'itm_lucky_coin',
  'itm_kettle',
  'itm_fate_mask',
  'itm_emperor_favor',
  'itm_silver_fork',
  'itm_medkit',
  'itm_pill',
  // ---- 0.1.1 二版新增（普通 共享）----
  'itm_hr_bronze_seal', // 人事部铜印
  'itm_riot_bunker', // 支援防暴桩
  'itm_live_rose', // 活玫瑰
] as const;

/** 进阶那 8 件（双模机械臂 … 骑士戒律）＋二版新增的 12 件进阶穿戴藏品 */
const C = [
  'itm_dual_arm',
  'itm_mimic_mass',
  'itm_doctor_projection',
  'itm_mutant_cell',
  'itm_pegasus_helm',
  'itm_rider_might',
  'itm_sand_compass',
  'itm_knight_oath',
  // ---- 0.1.1 二版新增（进阶 穿戴）----
  'itm_grudge_list', // 仇名录
  'itm_sad_red', // 悲伤的红
  'itm_mercenary_trinket', // 佣兵的饰物
  'itm_fist_three_questions', // 《拳经三问》
  'itm_spicy_cocoa', // 热辣可可
  'itm_painkiller', // 止痛片
  'itm_horn_ang', // 岩角号
  'itm_blaze_saw', // Blaze 的电锯
  'itm_scout_scope', // Scout 的狙击镜
  'itm_stimulant', // 紧急活性剂
  'itm_econ_reform', // 《第二经济改革法》
  'itm_home_stirfry', // 家常小炒
  /*
    ---- 0.1.3 转职体系 ----
    ★ 这里**只有「变形同构体」一件**：16 件转职藏品刻意不进任何掉落组 ——
      它们是变形同构体的产出物（用户口径：「只靠变形同构体 + 修改器」）。
      整条链路是：打野怪掉变形同构体 → 装到干员身上 → 变成对应的转职藏品。
    ★ 如果只把转职放进掉落表、不放变形同构体，正常对局里就永远变不出来；
      反过来（只放变形同构体）才是设计稿要的。
  */
  'itm_morph_relic', // 变形同构体
] as const;

/** 稀有那批（表里逐件写了百分比）＋二版新增的 10 件进阶共享藏品 */
const D = [
  'itm_flawless_jade',
  'itm_treasure_ring',
  'itm_blood_bed',
  'itm_lost_key',
  'itm_rosemary_embrace',
  'itm_old_fan',
  'itm_gin_cup',
  'itm_emperor_gun',
  // ---- 0.1.1 二版新增（进阶 共享）----
  'itm_doc_silver_seal', // 博士银印
  'itm_blackflow_notes', // 黑流树海笔记
  'itm_pebble_altar', // 圆石祭坛
  'itm_celestial_pouch', // 天师锦囊
  'itm_sword_hammer', // “剑锤”
  'itm_surge_meal', // 涌动之餐
  'itm_survivor_contract', // 生还者合约
  'itm_demon_king_banner', // 魔王的旗帜
  'itm_cangtong', // “苍桐”
  'itm_knight_lance_pro', // 骑士长枪专业版
] as const;

/** BOSS 专属的"便宜档"（表里 5% 的那一组，0.1.1 并进二版 3 件普通共享藏品） */
const BOSS_CHEAP = [
  'itm_accelerator',
  'itm_terrain_map',
  'itm_fate_mask',
  'itm_emperor_favor',
  'itm_silver_fork',
  'itm_medkit',
  'itm_pill',
  // ---- 0.1.1 二版新增（组权重仍是 5%，10 件等概率）----
  'itm_hr_bronze_seal',
  'itm_riot_bunker',
  'itm_live_rose',
] as const;

/**
 * 稀有组的逐件权重（**组内相对权重**）。
 *
 * 前 8 个是老件（对应表里写的那档百分比，这里按原比例保留）；
 * 后面 10 个是二版新件，统一给"基础档"（= 老件里最常见的那个权重）。
 * 组内会归一化，所以新件进来后老件的**真实百分比**按比例被稀释
 * （小怪/普通档：血魔的寝床 2% → 1%、其余 0.5% → 0.25%；新件各 0.25%）。
 */
const D_WEIGHTS_COMMON = [
  50, 50, 200, 25, 50, 50, 25, 50,
  ...Array.from({ length: 10 }, () => 50),
] as const; // 组内合计 1000（组级仍是 5%）
const D_WEIGHTS_ELITE = [
  100, 100, 400, 50, 100, 100, 50, 100,
  ...Array.from({ length: 10 }, () => 100),
] as const; // 组内合计 2000
const D_WEIGHTS_LEADER = [
  300, 300, 1200, 150, 300, 300, 150, 300,
  ...Array.from({ length: 10 }, () => 300),
] as const; // 组内合计 6000


/** 野怪档位（和 MonsterTier 对齐，但这里不 import 那份，避免循环依赖） */
export type DropTier = 'minion' | 'normal' | 'elite' | 'leader' | 'boss';

/** 掉落表：档位 -> 规则 */
export const MONSTER_DROP_TABLE: Readonly<Record<DropTier, DropRule>> = {
  minion: {
    gold: { chanceBp: 4500, amount: 2 },
    groups: [
      { weightBp: 6000, items: A },
      { weightBp: 2500, items: B },
      { weightBp: 1000, items: C },
      { weightBp: 500, items: D, weightsBp: D_WEIGHTS_COMMON },
    ],
  },
  normal: {
    gold: { chanceBp: 3000, amount: 4 },
    groups: [
      { weightBp: 4000, items: A },
      { weightBp: 4000, items: B },
      { weightBp: 1500, items: C },
      { weightBp: 500, items: D, weightsBp: D_WEIGHTS_COMMON },
    ],
  },
  elite: {
    guaranteed: 1,
    extraChanceBp: 2000,
    groups: [
      { weightBp: 3000, items: A },
      { weightBp: 3000, items: B },
      { weightBp: 3000, items: C },
      { weightBp: 1000, items: D, weightsBp: D_WEIGHTS_ELITE },
    ],
  },
  leader: {
    guaranteed: 1,
    extraChanceBp: 5000,
    groups: [
      { weightBp: 1000, items: A },
      { weightBp: 2000, items: B },
      { weightBp: 4000, items: C },
      { weightBp: 3000, items: D, weightsBp: D_WEIGHTS_LEADER },
    ],
  },
  boss: {
    guaranteed: 2,
    extraChanceBp: 5000,
    groups: [
      { weightBp: 500, items: BOSS_CHEAP },
      { weightBp: 4000, items: C },
      /*
        ★ 0.1.1：BOSS 的这一组表里只写了「以上 55% 掉落其中之一」，
        **没有**逐件百分比 → 组内**等概率**。
        （以前这里错用了小领袖那套逐件权重：血魔的寝床会变成 12% 而不是 1/18，
        和用户的表对不上。）
      */
      { weightBp: 5500, items: D },
    ],
  },
};

/** 一次掉落的结算结果 */
export interface DropResult {
  /** 掉了哪些藏品（按掉落顺序） */
  items: string[];
  /** 掉了多少金币 */
  gold: number;
}

/**
 * ★ 0.0.3：从战斗日志里数出「被谁打死了哪些单位」。
 *
 * 【为什么需要它？—— 掉落是按**击杀**算的，不是按"这一波过了"算的】
 * 用户的表是"小怪掉落表 / 精英掉落表…"，也就是**打死一只怪掉什么**。
 * 所以要先知道这一场到底打死了几只、分别是哪一档 —— 那就只能看战斗日志。
 *
 * 【怎么认？】
 *   · `spawn`（t = 0）告诉你**开战时在场**的单位有哪些（unitId -> defId）；
 *     只看 t = 0 是有意的：Boss 召唤出来的“盛怒”不算这波的怪，
 *     否则奎隆就成了刷装备机器。
 *   · `death` 告诉你 unitId 死了。两者一交叉就是"被打倒的野怪"。
 *   · 复活型 Boss 会死两次（事件重复），按 unitId 去重。
 *
 * @param victimTeam 被击杀方是哪个队（野怪永远在玩家对面：`1 - myTeam`）
 */
export function killedDefIds(log: readonly BattleEvent[], victimTeam: 0 | 1): { defId: string; tick: number }[] {
  const spawned = new Map<number, string>();
  for (const event of log) {
    if (event.type === 'spawn' && event.team === victimTeam && event.t === 0) {
      spawned.set(event.unitId, event.defId);
    }
  }
  const dead = new Set<number>();
  const kills: { defId: string; tick: number }[] = [];
  for (const event of log) {
    if (event.type !== 'death') continue;
    const defId = spawned.get(event.unitId);
    if (!defId || dead.has(event.unitId)) continue;
    dead.add(event.unitId);
    kills.push({ defId, tick: event.t });
  }
  return kills;
}

/** 在组内挑一件（等概率，或按 weightsBp 逐件权重） */
function pickFromGroup(group: DropGroup, rng: Rng, skip?: (itemId: string) => boolean): string {
  const items = group.items;
  /*
    ★ 0.2：「这一件不能再获得」（失落之钥买过之后）要能不落给玩家。
    做法不是"抽到了就整个掉空"，而是**在同一组里重抽**（最多组内件数那么多次）——
    组内概率本来是均分/按权重，重抽等价于"把这件从池子里拿掉再归一化"，
    而且不会因为一次跳过就让整次掉落白掉。
    ★ 重抽会推进 rng —— 但它是**确定性的**（同一个种子 + 同一个 skip 判定 ⇒ 同一结果），
      掉落本来就不进校验和，所以不影响联机一致性。
  */
  const pickOnce = (): string => {
    if (!group.weightsBp) return items[rng.nextInt(items.length)]!;
    const total = group.weightsBp.reduce((sum, w) => sum + w, 0);
    if (total <= 0) return items[rng.nextInt(items.length)]!;
    let roll = rng.nextInt(total);
    for (let i = 0; i < items.length; i++) {
      roll -= group.weightsBp[i] ?? 0;
      if (roll < 0) return items[i]!;
    }
    return items[items.length - 1]!;
  };
  if (!skip) return pickOnce();
  const allowed = items.filter((itemId) => !skip(itemId));
  if (allowed.length === 0) return pickOnce(); // 整组都被禁 -> 只能原样给（不会发生，兜底而已）
  for (let attempt = 0; attempt < items.length; attempt++) {
    const picked = pickOnce();
    if (!skip(picked)) return picked;
  }
  return allowed[rng.nextInt(allowed.length)]!;
}

/**
 * 某个档位里，**某件藏品**在"掉物判定"里的概率（万分比）。
 *
 * 【口径：和用户的表一致】
 * 用户的表写的是"以上 X% 掉落其中之一"（那是**进入掉物判定之后**的比例），
 * 所以这里**不**乘"没中金币"的那部分 —— 小怪 / 普通档要换算成"每次击杀"，
 * 用下面的 `dropChancePerKillBp`。
 *
 * 【为什么需要它？】
 * 稀有组的权重是**组内相对权重**（二版并进 10 件之后，权重之和不再等于组级权重），
 * 所以真实概率 = 组权重 × 权重 ÷ 组内权重和；等概率组则是 组权重 ÷ 件数。
 * 导表脚本和概率测试都走这一个函数（同一份算法，不许各写一遍）。
 */
export function dropChanceBp(tier: DropTier, itemId: string): number {
  const rule: DropRule = MONSTER_DROP_TABLE[tier];
  let chance = 0;
  for (const group of rule.groups) {
    const index = group.items.indexOf(itemId);
    if (index < 0) continue;
    if (!group.weightsBp) {
      chance += group.weightBp / group.items.length;
      continue;
    }
    const total = group.weightsBp.reduce((sum, w) => sum + w, 0) || 1;
    chance += (group.weightBp * (group.weightsBp[index] ?? 0)) / total;
  }
  return chance;
}

/**
 * 每次击杀的**实际**掉落概率（万分比）—— 把"先掷金币"那一档也算进去。
 * 小怪 ×55%、普通 ×70%；精英以上没有金币档，所以和上面那个一样。
 */
export function dropChancePerKillBp(tier: DropTier, itemId: string): number {
  const rule: DropRule = MONSTER_DROP_TABLE[tier];
  const factor = rule.gold ? (10000 - rule.gold.chanceBp) / 10000 : 1;
  return dropChanceBp(tier, itemId) * factor;
}

/** 掷一件藏品：先按组权重决定落在哪一组，再在组内挑 */
export function rollOneItem(tier: DropTier, rng: Rng, skip?: (itemId: string) => boolean): string {
  const rule: DropRule = MONSTER_DROP_TABLE[tier];
  const total = rule.groups.reduce((sum, g) => sum + g.weightBp, 0);
  let roll = rng.nextInt(Math.max(1, total));
  for (const group of rule.groups) {
    roll -= group.weightBp;
    if (roll < 0) return pickFromGroup(group, rng, skip);
  }
  return pickFromGroup(rule.groups[rule.groups.length - 1]!, rng, skip);
}

/**
 * 结算一个野怪档位的掉落。
 *
 * 【随机数从哪来？】
 * 由调用方传进来（走战斗/房间的种子），这样联机两边掷出同一套结果。
 */
export function rollDrops(tier: DropTier, rng: Rng, skip?: (itemId: string) => boolean): DropResult {
  const rule: DropRule = MONSTER_DROP_TABLE[tier];
  const items: string[] = [];
  let gold = 0;

  // 1) 先掷金币。掉了金币就不掉藏品（表里写的是"有 X% 掉金币，剩下 Y% 掉物"）
  if (rule.gold) {
    if (rng.nextInt(10000) < rule.gold.chanceBp) {
      return { items, gold: rule.gold.amount };
    }
  }

  // 2) 藏品
  const guaranteed = rule.guaranteed ?? 1;
  for (let i = 0; i < guaranteed; i++) items.push(rollOneItem(tier, rng, skip));
  if (rule.extraChanceBp && rng.nextInt(10000) < rule.extraChanceBp) {
    items.push(rollOneItem(tier, rng, skip));
  }
  return { items, gold };
}

/** 中文档位名（界面文案用） */
export const DROP_TIER_LABEL: Record<DropTier, string> = {
  minion: '小怪',
  normal: '普通',
  elite: '精英',
  leader: '小领袖',
  boss: 'Boss',
};
