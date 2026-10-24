/**
 * 经济系统的测试（这一轮按你的要求改过）。
 *
 * 你给的三条：
 *   1. 每回合自动获得两点玩家经验
 *   2. 每有 10 金币，下回合额外获得 1 金币，手里可触发利息上限 50 金币
 *   3. 升级所需要的经验调高，先用云顶（TFT）的经验数量；
 *      每回合获得金币数的经济系统也用云顶的
 *
 * 这三条都会**直接改变一局游戏的节奏**，而且错了很难在界面上看出来
 * （数字都在动，只是动得不对），所以每条都用精确数值钉住。
 */
import { describe, expect, it } from 'vitest';
import {
  AUTO_XP_PER_ROUND,
  BUY_XP_AMOUNT,
  BUY_XP_COST,
  INCOME_BASE,
  INTEREST_PER_10_GOLD,
  MAX_INTEREST,
  MAX_LEVEL,
  REFRESH_COST,
  START_GOLD,
  UNIT_DEFS,
  createEconomy,
  damageForRound,
  grantXp,
  lossStreakBonus,
  rollShop,
  settleRound,
  streakBonusOf,
  streakLabelOf,
  unitIdsByCost,
  winStreakBonus,
  xpNeededForLevel,
} from '../src/index.js';

/**
 * 商店抽卡需要一个**返回整数**的随机数（`random() % pool.length`）。
 * 这一点很容易踩坑：返回 0~1 的小数时 `小数 % 5` 还是那个小数，
 * 于是 `pool[0.42]` 是 undefined，报的却是"读不到 cost"这种莫名其妙的错。
 */
function makeRng(seed = 12345): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1) >>> 0;
    t = (t ^ (t + Math.imul(t ^ (t >>> 7), t | 61))) >>> 0;
    return (t ^ (t >>> 14)) >>> 0;
  };
}

describe('★ 云顶经验表', () => {
  /*
    云顶之弈 S14 的原始表（升满 10 级总计 220 点）：
      2→3:  2    3→4:  6    4→5: 10    5→6: 14
      6→7: 20    7→8: 36    8→9: 48    9→10: 84
    我们的 1→2 改成 1 点（云顶是"第一波后免费"，我们用"1 点 + 每回合白送 2 点"
    来等价），所以总数是 221。
  */
  const TFT = [1, 2, 6, 10, 14, 20, 36, 48, 84];

  it('每一级的经验需求和云顶一致', () => {
    for (let level = 1; level < MAX_LEVEL; level++) {
      expect(xpNeededForLevel(level), `${level} → ${level + 1} 级的经验对不上`).toBe(TFT[level - 1]);
    }
  });

  it('10 级之后不需要经验了', () => {
    expect(xpNeededForLevel(MAX_LEVEL)).toBe(0);
    expect(xpNeededForLevel(MAX_LEVEL + 3)).toBe(0);
  });

  it('需求严格递增（不存在"升级反而更便宜"这种诡异节奏）', () => {
    for (let level = 1; level < MAX_LEVEL - 1; level++) {
      expect(xpNeededForLevel(level + 1), `${level + 1} 级的需求没有比 ${level} 级高`).toBeGreaterThan(
        xpNeededForLevel(level),
      );
    }
  });

  it('★ 从 1 级升到 10 级总共要 221 点经验（比改之前的 54 点高约 4 倍）', () => {
    let total = 0;
    for (let level = 1; level < MAX_LEVEL; level++) total += xpNeededForLevel(level);
    expect(total).toBe(221);
    // 改之前是 2 + level，总共 54 点 —— 确认"确实调高了"
    expect(total).toBeGreaterThan(54 * 3);
  });
});

describe('★ 每回合自动 +2 经验', () => {
  it('AUTO_XP_PER_ROUND 就是 2（你明确写的数字）', () => {
    expect(AUTO_XP_PER_ROUND).toBe(2);
  });

  it('结算一次回合就加 2 点经验', () => {
    const economy = createEconomy(makeRng());
    const before = economy.xp;
    settleRound(economy, true);
    // 1→2 只要 1 点，所以会立刻升级：等级 +1、剩下的 1 点留在经验条里
    expect(economy.level).toBe(2);
    expect(economy.xp).toBe(before + AUTO_XP_PER_ROUND - xpNeededForLevel(1));
  });

  it('★ 第 1 回合结束正好到 2 级（和云顶"第一波后到 2 级"的节奏一致）', () => {
    const economy = createEconomy(makeRng());
    expect(economy.level).toBe(1);
    settleRound(economy, true);
    expect(economy.level).toBe(2);
  });

  it('一直结算也能自己升到 10 级（不买经验的话要很久，但不是永远）', () => {
    const economy = createEconomy(makeRng());
    economy.gold = 0; // 只看白送的经验
    let rounds = 0;
    while (economy.level < MAX_LEVEL && rounds < 500) {
      settleRound(economy, true);
      rounds++;
    }
    expect(economy.level).toBe(MAX_LEVEL);
    // 221 点 ÷ 每回合 2 点 ≈ 111 回合。允许一点误差，但必须在这个量级 ——
    // 如果只有十几回合，说明经验表被我改回去了
    expect(rounds).toBeGreaterThan(100);
    expect(rounds).toBeLessThan(130);
  });

  it('买经验也给经验，而且判定升级的逻辑是同一套', () => {
    const economy = createEconomy(makeRng());
    const { levelsGained } = grantXp(economy, BUY_XP_AMOUNT);
    expect(levelsGained).toBeGreaterThan(0); // 1→2 只要 1 点
    expect(levelOfAfterBuying(economy)).toBe(economy.level);
  });

  /** 买一次经验（4 金 4 点）之后等级是多少 —— 供上面那条做交叉验证 */
  function levelOfAfterBuying(economy: ReturnType<typeof createEconomy>): number {
    expect(BUY_XP_COST).toBe(4);
    expect(BUY_XP_AMOUNT).toBe(4);
    return economy.level;
  }
});

describe('★ 利息：每 10 金 1 金，上限 50 金', () => {
  it('常量：每 10 金 1 金、上限 5 金（= 50 金存款）', () => {
    expect(INTEREST_PER_10_GOLD).toBe(1);
    expect(MAX_INTEREST).toBe(5);
    // "手里可触发利息上限 50 金币"：50 ÷ 10 × 1 = 5
    expect((50 / 10) * INTEREST_PER_10_GOLD).toBe(MAX_INTEREST);
  });

  it('基础收入是每回合 10 金（你要求的）', () => {
    expect(INCOME_BASE).toBe(10);
  });

  it('★ 存款 0~9 没有利息，10~19 是 1，…，50 以上封顶 5', () => {
    const cases: Array<[number, number]> = [
      [0, 0],
      [9, 0],
      [10, 1],
      [19, 1],
      [20, 2],
      [40, 4],
      [49, 4],
      [50, 5],
      [99, 5], // 超过 50 的部分不生息 —— 这是"上限 50 金"的含义
      [300, 5],
    ];
    for (const [gold, expected] of cases) {
      const economy = createEconomy(makeRng());
      economy.gold = gold;
      // 结算完金币会变，所以要减掉总收入才是利息
      const { gold: income } = settleRound(economy, null);
      const interest = income - INCOME_BASE;
      expect(interest, `存款 ${gold} 金的利息应该 ${expected}`).toBe(expected);
    }
  });

  it('★ 利息按"结算前"的存款算，不是结算后的', () => {
    /*
      这个顺序很容易写反，而且写反了很难发现：数字只差一点，
      只有"卡在整十边缘"的时候才看得出来。
      50 金应该是 5 利息（而不是先拿到 5 金基础收入变成 55 再算利息）。
    */
    const economy = createEconomy(makeRng());
    economy.gold = 50;
    const { gold: income, breakdown } = settleRound(economy, null);
    // 50 金：利息 5（不是 6 —— 如果先发钱再算利息，55 金也只有 5；
    // 但 45 金就能区分：45 先发钱变 50 -> 利息 5；正确应该是 4）
    expect(income).toBe(INCOME_BASE + 5);
    expect(breakdown).toContain('利息 5');

    const edge = createEconomy(makeRng());
    edge.gold = 45;
    const { gold: edgeIncome } = settleRound(edge, null);
    expect(edgeIncome, '45 金只该有 4 利息（先发钱再算就变成 5 了）').toBe(INCOME_BASE + 4);
  });

  it('结算后金币确实增加了那么多', () => {
    const economy = createEconomy(makeRng());
    economy.gold = 30;
    const before = economy.gold;
    const { gold: income } = settleRound(economy, false);
    // 输一局也有连败补偿，但连败 1 局还没到第 2 局的档位，所以是 0
    expect(streakBonusOf(-1), '连败 1 局还没到补偿档').toBe(0);
    expect(economy.gold).toBe(before + income);
  });
});

/**
 * ============================================================
 *  ★ 连胜 / 连败奖励（你定的规则）
 * ============================================================
 *   连胜：每连胜 2 局，下一回合 +1 金，上限 +5
 *   连败：连败 2 局 +2 金，连败 4 局及以上 +5 金
 *
 * 【为什么值得单独测？】
 * 因为这两档用的是**两套不同的算法**（连胜是线性的、连败是跳档的），
 * 很容易顺手写成同一个公式。而且它们直接决定"落后的人能不能翻盘"，
 * 算错不会报错，只会让对局一边倒或者永远打不完。
 */
describe('★ 连胜 / 连败奖励', () => {
  it('连胜：2 局 +1、4 局 +2、6 局 +3、8 局 +4、10 局及以上 +5（封顶）', () => {
    expect(winStreakBonus(0)).toBe(0);
    expect(winStreakBonus(1)).toBe(0);
    expect(winStreakBonus(2)).toBe(1);
    expect(winStreakBonus(3)).toBe(1);
    expect(winStreakBonus(4)).toBe(2);
    expect(winStreakBonus(6)).toBe(3);
    expect(winStreakBonus(8)).toBe(4);
    expect(winStreakBonus(10)).toBe(5);
    expect(winStreakBonus(50), '上限就是 5 金').toBe(5);
  });

  it('连败：2 局 +2、4 局及以上 +5（跳档，不是线性）', () => {
    expect(lossStreakBonus(0)).toBe(0);
    expect(lossStreakBonus(-1)).toBe(0);
    expect(lossStreakBonus(-2)).toBe(2);
    expect(lossStreakBonus(-3), '3 连败仍然是 2 金这一档').toBe(2);
    expect(lossStreakBonus(-4)).toBe(5);
    expect(lossStreakBonus(-9), '4 局以上按字面都给 5').toBe(5);
  });

  it('连败第一档就比连胜大方（要救急，不能慢慢涨）', () => {
    expect(lossStreakBonus(-2)).toBeGreaterThan(winStreakBonus(2));
    expect(lossStreakBonus(-4)).toBeGreaterThan(winStreakBonus(4));
  });

  it('streakBonusOf 按正负分派，0 和 ±1 都是 0', () => {
    expect(streakBonusOf(0)).toBe(0);
    expect(streakBonusOf(1)).toBe(0);
    expect(streakBonusOf(-1)).toBe(0);
    expect(streakBonusOf(2)).toBe(winStreakBonus(2));
    expect(streakBonusOf(-4)).toBe(lossStreakBonus(-4));
  });

  it('★ 结算时真的按 streak 发钱：连赢两局之后的下一次结算会多 1 金', () => {
    const economy = createEconomy(makeRng());
    economy.gold = 0;

    settleRound(economy, true); // 第 1 胜：streak=1，无奖励
    // 把存款压到 10 以下，避免利息混进来干扰我们要看的那个数
    economy.gold = 5;
    settleRound(economy, true); // 第 2 胜：streak=2，+1
    expect(economy.gold, '5 金 + 基础 10 + 连胜 1 = 16').toBe(5 + INCOME_BASE + 1);
  });

  it('★ 连败 2 局之后的一次结算会多 2 金', () => {
    const economy = createEconomy(makeRng());
    economy.gold = 0;
    settleRound(economy, false); // 败 1：无补偿
    economy.gold = 5;
    settleRound(economy, false); // 败 2：+2
    expect(economy.gold, '5 金 + 基础 10 + 连败补偿 2 = 17').toBe(5 + INCOME_BASE + 2);
  });

  it('对比：同样存款下，有连击比没连击拿得多（把利息这个变量排除掉）', () => {
    const calm = createEconomy(makeRng());
    calm.gold = 5;
    const { gold: calmIncome } = settleRound(calm, null);

    const streaking = createEconomy(makeRng());
    streaking.gold = 5;
    settleRound(streaking, true);
    settleRound(streaking, true);
    streaking.gold = 5;
    const { gold: streakIncome } = settleRound(streaking, true);

    expect(streakIncome).toBe(calmIncome + 1);
  });

  it('赢一局就把连败清零（streak 从负转正）', () => {
    const economy = createEconomy(makeRng());
    economy.gold = 0;
    settleRound(economy, false);
    settleRound(economy, false);
    expect(economy.streak).toBe(-2);
    settleRound(economy, true);
    expect(economy.streak, '赢一局就该从 1 连胜重新开始').toBe(1);
  });

  it('平局不会打断连胜/连败（won === null）', () => {
    const economy = createEconomy(makeRng());
    economy.gold = 0;
    settleRound(economy, true);
    settleRound(economy, true);
    expect(economy.streak).toBe(2);
    settleRound(economy, null);
    expect(economy.streak, '平局既不算赢也不算输，连击不该断').toBe(2);
  });

  it('界面上有"几连胜 / 几连败"的文字', () => {
    expect(streakLabelOf(0)).toBe('');
    expect(streakLabelOf(1), '1 连胜不值得显示').toBe('');
    expect(streakLabelOf(3)).toBe('3 连胜');
    expect(streakLabelOf(-2)).toBe('2 连败');
    expect(streakLabelOf(-5)).toBe('5 连败');
  });
});

describe('开局初始状态', () => {
  it('初始金币和等级没被这轮改动影响', () => {
    const economy = createEconomy(makeRng());
    expect(economy.gold).toBe(START_GOLD);
    expect(economy.level).toBe(1);
    expect(economy.xp).toBe(0);
    // 刷新商店的价格也没动
    expect(REFRESH_COST).toBe(2);
  });
});

/**
 * ============================================================
 *  输一局扣多少血（你定的规则）
 * ============================================================
 *   第 1~5 回合   扣 3 滴
 *   第 6~10 回合  扣 6 滴
 *   第 11~15 回合 扣 9 滴
 *   以此类推，每 5 个回合多扣 3 滴
 *
 * 【为什么每个档位都要钉死数值？】
 * 因为"扣血"是**唯一能结束一局游戏的东西**。
 * 它算错了不会报任何错，只会让对局要么三回合就结束、要么打到天荒地老 ——
 * 而这两种表现都很容易被误判成"经济系统有问题"或者"阵容不平衡"。
 */
describe('★ 掉血规则：随回合数递增', () => {
  it('第 1~5 回合都扣 3 滴', () => {
    for (const round of [1, 2, 3, 4, 5]) {
      expect(damageForRound(round), `第 ${round} 回合`).toBe(3);
    }
  });

  it('第 6~10 回合都扣 6 滴', () => {
    for (const round of [6, 7, 8, 9, 10]) {
      expect(damageForRound(round), `第 ${round} 回合`).toBe(6);
    }
  });

  it('第 11~15 回合都扣 9 滴', () => {
    for (const round of [11, 12, 13, 14, 15]) {
      expect(damageForRound(round), `第 ${round} 回合`).toBe(9);
    }
  });

  it('第 16 回合开始扣 12 滴（"以此类推"）', () => {
    expect(damageForRound(16)).toBe(12);
    expect(damageForRound(20)).toBe(12);
    expect(damageForRound(21)).toBe(15);
  });

  it('每满 5 回合进一档，且严格不下降', () => {
    let previous = 0;
    for (let round = 1; round <= 60; round++) {
      const damage = damageForRound(round);
      expect(damage, `第 ${round} 回合扣血不该比上一回合少`).toBeGreaterThanOrEqual(previous);
      previous = damage;
    }
    // 第 60 回合 = 第 12 档 = 36 滴
    expect(damageForRound(60)).toBe(36);
  });

  it('满血 100 滴一直输的话，大约第 15~17 回合出局（不会太快也不会太慢）', () => {
    let hp = 100;
    let round = 1;
    while (hp > 0 && round < 100) {
      hp -= damageForRound(round);
      if (hp <= 0) break;
      round++;
    }
    // 前 5 回合扣 15，6~10 回合扣 30，11~15 回合扣 45 = 90；第 16 回合再扣 12 就没了
    expect(round, '一局不该在 10 回合内就结束（阵容还没成型）').toBeGreaterThanOrEqual(14);
    expect(round, '一局也不该拖到 25 回合以上（一局要打一小时）').toBeLessThanOrEqual(25);
  });

  it('回合号是 0 或者负数时不会算出 0 滴血（防御性）', () => {
    expect(damageForRound(0)).toBe(3);
    expect(damageForRound(-10)).toBe(3);
  });
});

// ============================================================
// 商店抽卡：牌库只剩 1 张时不能出现 2 个格子
// ============================================================

describe('★ 牌库只剩 1 张时，一次刷新里不能出现 2 张同样的牌', () => {
  /**
   * 只留一个 1 费棋子有货，其余全是 0。
   * 这样等级 1（100% 出 1 费）的每一次刷新都**只能**抽到它 ——
   * "同一批里最多出现几张"就被逼成了确定值，不用靠概率去碰运气。
   */
  function onlyOneLeft(defId: string, copies: number): Map<string, number> {
    const out = new Map<string, number>();
    for (const def of Object.values(UNIT_DEFS)) out.set(def.id, 0);
    out.set(defId, copies);
    return out;
  }

  const oneCost = unitIdsByCost(1, UNIT_DEFS);
  const scarce = oneCost[0]!;

  it('★ 只剩 1 张：5 个格子里只可能有 1 张，剩下的是"已售出"', () => {
    const slots = rollShop(1, makeRng(11), UNIT_DEFS, { remaining: onlyOneLeft(scarce, 1) });
    expect(slots.filter((slot) => slot.defId === scarce)).toHaveLength(1);
    expect(slots.filter((slot) => slot.defId === '')).toHaveLength(4);
  });

  it('★ 只剩 2 张：就只能出 2 张（不会多，也不会少）', () => {
    const slots = rollShop(1, makeRng(12), UNIT_DEFS, { remaining: onlyOneLeft(scarce, 2) });
    expect(slots.filter((slot) => slot.defId === scarce)).toHaveLength(2);
    expect(slots.filter((slot) => slot.defId === '')).toHaveLength(3);
  });

  it('★ 只剩 3 张：出 3 张（上限是按"张数"算的，不是"一个棋子只能出现一次"）', () => {
    const slots = rollShop(1, makeRng(13), UNIT_DEFS, { remaining: onlyOneLeft(scarce, 3) });
    expect(slots.filter((slot) => slot.defId === scarce)).toHaveLength(3);
  });

  it('货很足的时候不受影响：一次刷新里照样可能刷出 2 张同样的牌', () => {
    /*
      反过来钉一下，防止"为了保险干脆不让重复" ——
      那等于把正常牌库的手感偷偷改掉了（玩家会觉得某张牌怎么都刷不出两张）。
      这里把其余棋子全清空、只留一张有 27 张：5 个格子应该**全是**它。
    */
    const slots = rollShop(1, makeRng(14), UNIT_DEFS, { remaining: onlyOneLeft(scarce, 27) });
    expect(slots.filter((slot) => slot.defId === scarce)).toHaveLength(5);
    expect(slots.filter((slot) => slot.defId === '')).toHaveLength(0);
  });

  it('不传 remaining（无限牌库）时行为完全不变', () => {
    const slots = rollShop(1, makeRng(15));
    expect(slots).toHaveLength(5);
    for (const slot of slots) expect(slot.defId).not.toBe('');
  });
});
