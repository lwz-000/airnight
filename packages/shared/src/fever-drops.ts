/**
 * ============================================================
 *  ★★ 0.2 MujicaAve：fever 档位「宝藏掉落表」
 * ============================================================
 *
 * 【这张表从哪来？】
 * 用户手写的 `各项数值/羁绊掉落表.txt`（2026-10-17），七个档位和 fever 的门槛一一对应
 * （100 / 300 / 500 / 1000 / 1500 / 2000 / 3000，见 `trait-data.ts` 的 `thresholds`）。
 *
 * 【什么时候结算？】
 * fever **跨过某一档**的那一回合（和"保留 / 消耗"那个弹窗同一时刻），
 * 每个档位**一辈子只领一次**（记在 `FeverState.treasures` 里）。
 * 掉到档位下面再涨回来，不会重复发。
 *
 * 【为什么放在 shared？】
 * 和 `fever.ts` 同一个理由：表是纯数据，抽成纯函数就能直接断言
 * "每个档位的权重加起来对不对""掷 0~9999 一定落在某一条上"，
 * 而不用去界面里点一次。
 *
 * ------------------------------------------------------------------
 * 【★★ 表里的百分比不是都等于 100，这里按比例归一】
 * 用户原表各档加起来：
 *   100 = 100% · 300 = 100% · 500 = **110%** · 1000 = **110%**
 *   1500 = **80%** · 2000 = 100% · 3000 = **99%**（写的是 33/33/33.0）
 * 这些显然不是"还有 20% 不掉东西"，而是写表时少写/重算了一个分支。
 * 所以这里**保留原权重、掷骰时按总和归一** —— 等价于"把差额按各条现有比例分摊"。
 * 哪天真要精确到 100%，把那条的 `weightBp` 改到加起来正好 10000 即可（有测试会盯着）。
 *
 * ★ 单位是**万分比**（10000 = 100%）。表里写 "30%" 就是 3000。
 */

/** 「随机获得干员」这一条：星级 / 费用 / 张数 */
export interface FeverOperatorReward {
  /** 几星（1/2/3） */
  star: number;
  /** 几费（4/5） */
  cost: number;
  /** 几只 */
  count: number;
}

/** 掉落表的一行（每个档位若干行，互斥，按权重掷一个） */
export interface FeverDropEntry {
  /** 权重（万分比）。★ 同一档内不要求总和 10000，掷骰时会归一 */
  weightBp: number;
  /** 直接给的金币 */
  gold?: number;
  /** 普通藏品件数 */
  normalItems?: number;
  /** 进阶藏品件数（**不含**转职藏品，转职有单独一条） */
  advancedItems?: number;
  /** 转职藏品件数 */
  traitRelics?: number;
  /** 拟态物质件数（它本身是一件"A 类立刻销毁"藏品，所以走藏品栏） */
  mimicMatter?: number;
  /** 随机获得干员（从牌库拿，规则同突变细胞） */
  operator?: FeverOperatorReward;
}

/**
 * 七个档位的掉落表。
 *
 * ★ key 必须是 fever 的门槛值（和 `trait-data.ts` 的 `thresholds` 完全一致），
 *   有测试会拿两边对一遍 —— 加一档只在一边加，会当场红。
 */
export const FEVER_DROP_TABLE: Readonly<Record<number, readonly FeverDropEntry[]>> = {
  100: [
    { weightBp: 5000, gold: 6 },
    { weightBp: 5000, normalItems: 1 },
  ],
  300: [
    { weightBp: 3000, gold: 18 },
    { weightBp: 3000, normalItems: 2 },
    { weightBp: 3000, advancedItems: 1 },
    // "10%概率随机获得1张1星4费干员（来源牌库）和20块钱"
    { weightBp: 1000, gold: 20, operator: { star: 1, cost: 4, count: 1 } },
  ],
  500: [
    { weightBp: 3000, gold: 40 },
    { weightBp: 3000, gold: 25, advancedItems: 2 },
    { weightBp: 2000, gold: 10, normalItems: 8 },
    { weightBp: 2000, advancedItems: 3 },
    { weightBp: 1000, gold: 20, operator: { star: 2, cost: 4, count: 2 } },
  ],
  1000: [
    { weightBp: 3000, gold: 66 },
    { weightBp: 3000, gold: 33, advancedItems: 4 },
    { weightBp: 2000, gold: 20, traitRelics: 3 },
    { weightBp: 2000, advancedItems: 4 },
    { weightBp: 1000, gold: 40, operator: { star: 2, cost: 5, count: 1 } },
  ],
  1500: [
    { weightBp: 3000, gold: 90 },
    { weightBp: 1000, gold: 50, advancedItems: 4 },
    { weightBp: 2000, gold: 20, advancedItems: 4 },
    { weightBp: 1000, gold: 20, operator: { star: 3, cost: 4, count: 1 } },
    { weightBp: 1000, gold: 10, mimicMatter: 3 },
  ],
  2000: [
    { weightBp: 3000, gold: 120 },
    { weightBp: 3000, gold: 80, advancedItems: 4 },
    { weightBp: 1000, gold: 30, traitRelics: 6 },
    { weightBp: 2000, gold: 20, mimicMatter: 5 },
    { weightBp: 1000, gold: 20, operator: { star: 3, cost: 4, count: 2 } },
  ],
  3000: [
    { weightBp: 3300, gold: 150 },
    { weightBp: 3300, gold: 100, mimicMatter: 5 },
    /*
      ★ 原表这条写的是 "33.0%" —— 三个 33% 加起来 99%。
      这里把最后一条补到 34%，让总和正好 100%（等价于"零头归它"），
      免得归一化时把前两条的比例也一起抬 1%。
    */
    { weightBp: 3400, gold: 20, operator: { star: 3, cost: 5, count: 1 } },
  ],
};

/** 这件藏品能不能被"随机给一件普通/进阶藏品"抽到（转职藏品自己一个类别，排除掉） */
export function isPlainItem(item: { rarity: string; grantsTrait?: string }): boolean {
  return item.grantsTrait === undefined;
}

/** 这一档的表（不认识 = null） */
export function feverDropTableOf(tier: number): readonly FeverDropEntry[] | null {
  return FEVER_DROP_TABLE[tier] ?? null;
}

/**
 * 这一档的权重总和。
 * ★ 界面/测试用它说明"这一档不是 100%"（原表 500 档是 110%）。
 */
export function feverDropWeightSum(tier: number): number {
  const table = feverDropTableOf(tier);
  if (!table) return 0;
  return table.reduce((sum, entry) => sum + Math.max(0, entry.weightBp), 0);
}

/**
 * 掷一次。
 *
 * @param tier 档位（100 / 300 / …）
 * @param roll 0 ~ (权重总和-1) 之间的整数（由调用方用 `state.random() % sum` 得到）
 * @returns 命中的那一行；档位不存在 = null
 *
 * ★ 归一化就发生在这一步：把 roll 模掉总和再累加，
 *   所以"500 档加起来 110%"也能正常工作（每条的实际概率 = 权重 / 总和）。
 */
export function rollFeverDrop(tier: number, roll: number): FeverDropEntry | null {
  const table = feverDropTableOf(tier);
  if (!table || table.length === 0) return null;
  const total = feverDropWeightSum(tier);
  if (total <= 0) return null;
  // 负数/超界的 roll 也夹进来（调用方理论上不会给，但别让骰子把索引甩出去）
  let point = ((Math.floor(roll) % total) + total) % total;
  for (const entry of table) {
    const weight = Math.max(0, entry.weightBp);
    if (point < weight) return entry;
    point -= weight;
  }
  // 浮点/空表的兜底：给最后一条
  return table[table.length - 1] ?? null;
}

/**
 * 一行掉落写成中文（日志 / 提示共用这一处文案）。
 *
 * 例：`66 金币` · `25 金币 + 2 件进阶藏品` · `2 张 2 星 4 费干员 + 20 金币`
 */
export function describeFeverDrop(entry: FeverDropEntry): string {
  const parts: string[] = [];
  if (entry.gold) parts.push(`${entry.gold} 金币`);
  if (entry.normalItems) parts.push(`${entry.normalItems} 件普通藏品`);
  if (entry.advancedItems) parts.push(`${entry.advancedItems} 件进阶藏品`);
  if (entry.traitRelics) parts.push(`${entry.traitRelics} 件转职藏品`);
  if (entry.mimicMatter) parts.push(`${entry.mimicMatter} 个拟态物质`);
  if (entry.operator) {
    const { star, cost, count } = entry.operator;
    parts.push(`${count} 张 ${star} 星 ${cost} 费干员`);
  }
  return parts.join(' + ') || '什么都没有';
}
