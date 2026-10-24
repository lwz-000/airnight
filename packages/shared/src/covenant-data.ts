/**
 * ============================================================
 *  ★★ 0.3 盟约（Covenant）
 * ============================================================
 *
 * 【是什么】开局的"选秀"：所有人在正式开局前依次挑一个整局强化。
 *
 * 【设计约束（用户口径）】
 *   · **单人 / 测试模式没有盟约** —— 只有多人房间才有这套流程；
 *   · 顺序随机、**且不告诉玩家完整顺序**（只告诉他"现在轮到你没有"）；
 *   · 一个盟约被选走之后，别人不能再选（界面上变暗）；
 *   · 全部选完才真正进第一回合。
 *
 * 【这一版的数据来源】用户给的《盟约效果A.txt》：
 *   每条 = 发起干员（头像）+ 盟约名 + 效果。
 *   头像放 `apps/web/public/assets/covenants/<id>.png`。
 *
 * ★ `pending: true` = **效果还没接进内核**（界面上会明写"开发中"）。
 *   宁可让玩家看见"这个还没做"，也不要让他选了一个什么用都没有的盟约还以为是 bug。
 */

import type { TraitBonus, TraitEffectType } from './types.js';

export type CovenantEffect =
  /** 全队属性加成（和羁绊同一套口径，交给 `TeamSetup.traitBonuses`） */
  | { kind: 'teamStat'; effect: TraitEffectType; value: number }
  /** 每回合基础收入 +N（可以为负） */
  | { kind: 'income'; value: number }
  /** 开局金币 +N */
  | { kind: 'startGold'; value: number }
  /** 开局生命 +N */
  | { kind: 'startHp'; value: number }
  /** 利息上限（"每 10 金 1 利息"的封顶）改成 N */
  | { kind: 'interestCap'; value: number }
  /**
   * 回合制发钱：从 `fromRound` 起，每 `everyRounds` 回合给一次 `min..max` 金。
   * ★ 数值是**按回合号算出来的**（不掷骰）—— 重连/回放不会多发一次。
   */
  | { kind: 'roundGold'; fromRound: number; everyRounds: number; min: number; max: number }
  /** 每赢 `perWins` 场回复 `heal` 点生命（上限 `cap`） */
  | { kind: 'winHeal'; perWins: number; heal: number; cap: number }
  /**
   * ★ 0.3.1 大帝「加急启动」：我方所有干员**获得技能条时额外 +N%**（万分比）。
   * 自动回复 / 攻击回复 / 受击回复三条路都算 —— 内核在唯一的回蓝入口 `gainMana` 里乘。
   */
  | { kind: 'manaGainBp'; value: number }
  /**
   * ★ 0.3.1 休谟斯「回收利用」：我方干员阵亡时，**其余我方单位**获得
   * 「阵亡者最大生命 × ratioBp」的护盾（万分比，2000 = 20%）。
   */
  | { kind: 'deathShield'; ratioBp: number }
  /**
   * ★ 0.3.1 卡莱莎「食腐之蝶」：我方干员阵亡时，**其余我方单位**攻击力 +attackBp
   * （万分比），可叠加，最多 capBp，持续到战斗结束。
   */
  | { kind: 'deathRage'; attackBp: number; capBp: number }
  /**
   * ★ 0.3.1 桑葚「药枚实验」：战斗开始时，我方**最右一列**的单位获得
   * 「每次攻击有 chanceBp 概率获得 charges 层次数护盾」。
   * 次数护盾 = 完整挡下一次任意类型的伤害（含真实伤害）。
   */
  | { kind: 'rightmostChargeShield'; chanceBp: number; charges: number }
  /**
   * ★ 0.3.1 凯瑟琳「定向投放」：从 `fromLevel` 级起，**每升一级**随机获得一件藏品。
   * `commonBp` / `advancedBp` 是普通 / 进阶的权重（万分比）。
   */
  | { kind: 'levelItem'; fromLevel: number; commonBp: number; advancedBp: number }
  /**
   * ★ 0.3.1 坎诺特「特别优惠」：坎诺特商店优惠。
   * · `freeRerolls` —— 本局**第一次**商店回合的前 N 次刷新免费；
   * · `firstBuyDiscount` —— **每个**商店回合第一个购买的藏品减 N 金。
   */
  | { kind: 'shopPerks'; freeRerolls: number; firstBuyDiscount: number };

export interface CovenantDef {
  id: string;
  /** 发起干员（头像文件名 = `<id>.png`，这里是干员名，界面上做 tooltip） */
  patron: string;
  name: string;
  /** 一句话（卡面上不显示，tooltip / 详情用） */
  brief: string;
  /** 详细说明（点开看） */
  detail: string[];
  effects: CovenantEffect[];
  /**
   * ★ 效果还没接进内核（界面上标「开发中」）。
   * 这样的盟约**仍然可以被选**（用户要求先全部加进来），但有明确提示。
   */
  pending?: boolean;
}

export const COVENANTS: CovenantDef[] = [
  {
    id: 'cv_warfarin',
    patron: '华法琳',
    name: '重生疗法',
    brief: '每赢 2 场，回复 3 点生命（上限 100）',
    detail: [
      '每累计赢下 2 场战斗，回复 3 点生命值（野怪回合不计入）。',
      '回复不会超过生命上限。',
    ],
    effects: [{ kind: 'winHeal', perWins: 2, heal: 3, cap: 100 }],
  },
  {
    id: 'cv_amiya',
    patron: '阿米娅',
    name: '不容拒绝',
    brief: '开局送 1 星阿米娅；用她打赢任务，走一条升变线（终态「炉芯终曲」）',
    detail: [
      '开局直接在备战席获得一名 1 星阿米娅（不占共享牌库）。',
      '以她为核心：用三张「升变之证」把她换成 阿米娅·青色怒火 / 慈悲愿景 / 炉芯终曲。',
      '两张证都要靠**任务**打出来（野怪回合不算，只有阿米娅本人上场才算）：',
      '  第一阶段：阿米娅累计参战 5 场并赢下 3 场 → 青色 / 慈悲 **二选一**',
      '  第二阶段：阿米娅三星 + 你到 10 级 + 她累计造成 15 万伤害 → 炉芯终曲之证',
      '三个形态和普通阿米娅共用一个牌库，升星也互通 ——',
      '手里 1 星「青色怒火」再买 2 张 1 费阿米娅，就能升成 2 星「青色怒火」。',
      '升变后的形态**不能出售**（这条路选了就不能回头）。',
      '★ 三张证有自己的专用栏位，不会被"穿戴藏品栏满了"挤掉。',
    ],
    /*
      ★ 0.3.2：机制已经全做完（开局送阿米娅 + 两段任务发证），所以**不再标 pending**。
      它的效果不在 `effects` 表里 —— 全写在客户端 state（`applyCovenantOpening` + 升变任务），
      和猎头顾问 / 通关奖励那几个同一类。
    */
    effects: [],
  },
  {
    id: 'cv_golia',
    patron: '歌利亚',
    name: '坚不可摧',
    brief: '开局生命 +30',
    detail: ['开局时你的生命上限与当前生命都 +30。', '实打实的容错，越早拿越值。'],
    effects: [{ kind: 'startHp', value: 30 }],
  },
  {
    id: 'cv_zilan',
    patron: '梓兰',
    name: '猎头顾问',
    brief: '每 2 回合一次的"特殊刷新"（必定 2 名同名）',
    detail: [
      '每 2 回合后的第一次主动刷新，会变成一次「特殊刷新」：必定刷出 2 名同名干员。',
      '特殊刷新只有一次，用掉之后恢复普通刷新。',
    ],
    effects: [],
  },
  {
    id: 'cv_justin',
    patron: '小贾斯汀',
    name: '私募基金',
    brief: '从第 6 回合起，每 7 回合获得 2~8 金',
    detail: [
      '从第 6 回合开始，每过 7 个回合（第 6、13、20…回合）随机获得 2~8 金币。',
      '每次的数额按回合号算出来，重连不会重掷。',
    ],
    effects: [{ kind: 'roundGold', fromRound: 6, everyRounds: 7, min: 2, max: 8 }],
  },
  {
    id: 'cv_emengarde',
    patron: '埃芒加德',
    name: '命结之秘',
    brief: '战斗中我方前 2 个阵亡的干员立刻复活一次',
    detail: [
      '每场战斗里，我方最先前 2 个被击败的干员会立刻原地复活一次（各一次）。',
      '复活后血量回满、技能状态保留。',
    ],
    effects: [],
  },
  {
    id: 'cv_laoli',
    patron: '老鲤',
    name: '利滚利',
    brief: '利息上限 7，但每回合基础收入 -1',
    detail: [
      '利息上限从 5 提到 7（存到 70 金吃满 7 利息）。',
      '代价：每回合的基础金币收入 -1（最低为 0）。',
      '典型的"前期难受、后期滚雪球"。',
    ],
    effects: [
      { kind: 'interestCap', value: 7 },
      { kind: 'income', value: -1 },
    ],
  },
  {
    id: 'cv_qiliang',
    patron: '绮良',
    name: '通关奖励',
    brief: '每花 50 金，从牌库随机得一张牌',
    detail: [
      '每累计花费 50 金币，从牌库随机获得一张干员牌（概率与你的等级挂钩）。',
      '花在刷新、买经验、买牌上都算。',
    ],
    effects: [],
  },
  {
    id: 'cv_peipei',
    patron: '佩佩',
    name: '博学多通',
    brief: '升到 9 / 10 级各给一次"高费刷新"',
    detail: [
      '升到 9 级、10 级时各获得一次特殊刷新：该次刷新必定出现 3 张及以上 5 费干员。',
      '牌库里 5 费不够时依次用 4 费补。',
    ],
    effects: [],
  },
  {
    id: 'cv_shapeshifter',
    patron: '变形者集群',
    name: '变形同构',
    brief: '第 4 回合获得一件装备',
    detail: ['第 4 回合开始时获得一件装备「变形同构体」。'],
    effects: [],
  },
  {
    id: 'cv_dadi',
    patron: '大帝',
    name: '加急启动',
    brief: '我方干员获得技能条时额外 +15%',
    detail: [
      '我方所有干员**获得技能条（法力）时额外获得 15%**。',
      '自动回复、攻击回复、受击回复三条路都生效。',
      '技能条上限不变，只是攒得更快。',
    ],
    effects: [{ kind: 'manaGainBp', value: 1500 }],
  },
  {
    id: 'cv_sangshen',
    patron: '桑葚',
    name: '药枚实验',
    brief: '战斗开始时，最右一列我方单位攻击有 20% 概率获得 1 层次数护盾',
    detail: [
      '战斗开始时，我方**最右一列**（站位最靠右的那一列）的所有单位获得效果：',
      '每次攻击时有 **20% 概率获得 1 层次数护盾**。',
      '次数护盾可以完整挡下一次任意类型的伤害（包括真实伤害），挡完即消耗。',
    ],
    effects: [{ kind: 'rightmostChargeShield', chanceBp: 2000, charges: 1 }],
  },
  {
    id: 'cv_humus',
    patron: '休谟斯',
    name: '回收利用',
    brief: '我方干员阵亡时，其余我方单位获得其最大生命 20% 的护盾',
    detail: [
      '我方干员阵亡时，**其余所有我方单位**获得护盾。',
      '护盾量 = 阵亡干员**最大生命值 × 20%**。',
      '护盾持续到战斗结束（可被后续阵亡继续叠加）。',
    ],
    effects: [{ kind: 'deathShield', ratioBp: 2000 }],
  },
  {
    id: 'cv_kathryn',
    patron: '凯瑟琳',
    name: '定向投放',
    brief: '3 级后每次升级随机获得一件藏品',
    detail: [
      '玩家达到 3 级之后，**每升一级**随机获得一件藏品。',
      '稀有度：普通藏品 70%，进阶藏品 30%。',
      '藏品栏满时会提示"没发下来"（和变形同构同一个处理）。',
    ],
    effects: [{ kind: 'levelItem', fromLevel: 4, commonBp: 7000, advancedBp: 3000 }],
  },
  {
    id: 'cv_kaltsa',
    patron: '卡莱莎',
    name: '食腐之蝶',
    brief: '我方干员阵亡时，其余我方单位攻击力 +15%（最多 +150%）',
    detail: [
      '我方每有一名干员被击倒，**场上剩余我方单位**攻击力 +15%。',
      '可叠加，最多 +150%（叠满 10 层）。',
      '持续到战斗结束。',
    ],
    effects: [{ kind: 'deathRage', attackBp: 1500, capBp: 15000 }],
  },
  {
    id: 'cv_cannot',
    patron: '坎诺特',
    name: '特别优惠',
    brief: '本局第一次商店 3 次免费刷新；每个商店回合首件藏品 -2 金',
    detail: [
      '本局**第一次**坎诺特商店获得 **3 次免费刷新**。',
      '**每个**坎诺特商店回合，第一个购买的藏品减 2 金币。',
      '免费刷新用完后，刷新价格照常从 4 金开始。',
    ],
    effects: [{ kind: 'shopPerks', freeRerolls: 3, firstBuyDiscount: 2 }],
  },
];

/** 按 id 取盟约（找不到返回 null —— 客户端拿到不认识的 id 时不要崩） */
export function covenantOf(id: string | undefined | null): CovenantDef | null {
  if (!id) return null;
  return COVENANTS.find((covenant) => covenant.id === id) ?? null;
}

export const COVENANT_IDS: readonly string[] = COVENANTS.map((covenant) => covenant.id);

/** 头像路径（相对 public） */
export function covenantAvatarPath(id: string): string {
  return `/assets/covenants/${id}.png`;
}

/**
 * 这个盟约折算成哪些羁绊加成（**服务端和客户端必须调同一个函数**）。
 * ★ 少一条就是"校验和不一致"，所以只能有一处实现。
 */
export function covenantTraitBonuses(id: string | undefined | null): TraitBonus[] {
  const covenant = covenantOf(id);
  if (!covenant) return [];
  const out: TraitBonus[] = [];
  for (const effect of covenant.effects) {
    if (effect.kind !== 'teamStat') continue;
    out.push({ traitId: covenant.id, effect: effect.effect, value: effect.value });
  }
  return out;
}

/** 这个盟约给了多少经济（开局金币 / 每回合基础收入） */
export function covenantEconomy(id: string | undefined | null): {
  startGold: number;
  income: number;
} {
  const covenant = covenantOf(id);
  if (!covenant) return { startGold: 0, income: 0 };
  let startGold = 0;
  let income = 0;
  for (const effect of covenant.effects) {
    if (effect.kind === 'startGold') startGold += effect.value;
    if (effect.kind === 'income') income += effect.value;
  }
  return { startGold, income };
}

/** 开局生命加成（歌利亚 +30 那种） */
export function covenantStartHpBonus(id: string | undefined | null): number {
  const covenant = covenantOf(id);
  if (!covenant) return 0;
  let bonus = 0;
  for (const effect of covenant.effects) {
    if (effect.kind === 'startHp') bonus += effect.value;
  }
  return bonus;
}

/**
 * ★ 0.3.31：**玩家血量上限的唯一口径** = 开局血量基准 + 盟约加血。
 *
 * 【为什么必须有这一层？】
 * 服务端 `Room.applyCovenantWinHeal` 用的是 `settings.startHp + bonus`，
 * 客户端以前只有一处（单机盟约回血）手写了 `100 + bonus`，
 * 藏品回血那条路**完全没夹上限** ——
 * 于是满血时吃回血藏品：本地数字涨上去、下一次广播又被夹回来，
 * 玩家看到的就是"回血藏品有时候不生效"。
 *
 * @param startHp 开局血量基准（单机写死 `START_HP`；联机 = `Room.settings.startHp`）
 */
export function playerMaxHp(startHp: number, covenantId: string | undefined | null): number {
  const base = Number.isFinite(startHp) && startHp > 0 ? Math.floor(startHp) : 100;
  return base + covenantStartHpBonus(covenantId);
}

/** 利息上限（没写就返回 null = 用默认的 5） */
export function covenantInterestCap(id: string | undefined | null): number | null {
  const covenant = covenantOf(id);
  if (!covenant) return null;
  for (const effect of covenant.effects) {
    if (effect.kind === 'interestCap') return effect.value;
  }
  return null;
}

/**
 * 这一回合有没有"回合制发钱"要发（小贾斯汀）。
 *
 * ★ 数额按回合号算出来（不掷骰）：重连、回放、多端重算都会得到同一个数，
 *   不会出现"刷新一下多领了一次"。
 */
export function covenantRoundGold(id: string | undefined | null, round: number): number {
  const covenant = covenantOf(id);
  if (!covenant) return 0;
  let gold = 0;
  for (const effect of covenant.effects) {
    if (effect.kind !== 'roundGold') continue;
    if (round < effect.fromRound) continue;
    if ((round - effect.fromRound) % effect.everyRounds !== 0) continue;
    const span = Math.max(0, effect.max - effect.min);
    gold += effect.min + ((round * 7 + effect.everyRounds) % (span + 1));
  }
  return gold;
}

/** "每赢 N 场回 M 血"的参数（没有这类效果返回 null） */
export function covenantWinHeal(
  id: string | undefined | null,
): { perWins: number; heal: number; cap: number } | null {
  const covenant = covenantOf(id);
  if (!covenant) return null;
  for (const effect of covenant.effects) {
    if (effect.kind === 'winHeal') {
      return { perWins: effect.perWins, heal: effect.heal, cap: effect.cap };
    }
  }
  return null;
}

// ============================================================
//  ★★ 0.3.1 新增盟约的折算（服务端 / 客户端 / 战斗内核共用）
// ============================================================

/** 大帝「加急启动」：技能条获取加成（万分比）。没有就是 0 */
export function covenantManaGainBp(id: string | undefined | null): number {
  const covenant = covenantOf(id);
  if (!covenant) return 0;
  let bp = 0;
  for (const effect of covenant.effects) {
    if (effect.kind === 'manaGainBp') bp += effect.value;
  }
  return bp;
}

/** 休谟斯「回收利用」：阵亡时给全队的护盾比例（万分比）。没有就是 0 */
export function covenantDeathShieldRatioBp(id: string | undefined | null): number {
  const covenant = covenantOf(id);
  if (!covenant) return 0;
  for (const effect of covenant.effects) {
    if (effect.kind === 'deathShield') return effect.ratioBp;
  }
  return 0;
}

/** 卡莱莎「食腐之蝶」：阵亡叠攻击的参数。没有返回 null */
export function covenantDeathRage(
  id: string | undefined | null,
): { attackBp: number; capBp: number } | null {
  const covenant = covenantOf(id);
  if (!covenant) return null;
  for (const effect of covenant.effects) {
    if (effect.kind === 'deathRage') {
      return { attackBp: effect.attackBp, capBp: effect.capBp };
    }
  }
  return null;
}

/** 桑葚「药枚实验」：最右列单位"攻击概率得次数护盾"的参数。没有返回 null */
export function covenantRightmostChargeShield(
  id: string | undefined | null,
): { chanceBp: number; charges: number } | null {
  const covenant = covenantOf(id);
  if (!covenant) return null;
  for (const effect of covenant.effects) {
    if (effect.kind === 'rightmostChargeShield') {
      return { chanceBp: effect.chanceBp, charges: effect.charges };
    }
  }
  return null;
}

/** 凯瑟琳「定向投放」：升级送藏品的参数。没有返回 null */
export function covenantLevelItem(
  id: string | undefined | null,
): { fromLevel: number; commonBp: number; advancedBp: number } | null {
  const covenant = covenantOf(id);
  if (!covenant) return null;
  for (const effect of covenant.effects) {
    if (effect.kind === 'levelItem') {
      return { fromLevel: effect.fromLevel, commonBp: effect.commonBp, advancedBp: effect.advancedBp };
    }
  }
  return null;
}

/** 坎诺特「特别优惠」：商店优惠参数。没有返回 null */
export function covenantShopPerks(
  id: string | undefined | null,
): { freeRerolls: number; firstBuyDiscount: number } | null {
  const covenant = covenantOf(id);
  if (!covenant) return null;
  for (const effect of covenant.effects) {
    if (effect.kind === 'shopPerks') {
      return { freeRerolls: effect.freeRerolls, firstBuyDiscount: effect.firstBuyDiscount };
    }
  }
  return null;
}
