/**
 * 客户端备战阶段的单元测试。
 *
 * 【为什么只测这一层？】
 * 3D 场景和 DOM 交互需要有浏览器才能跑（Three.js 要 WebGL），
 * 在无头环境里测试性价比很低。
 * 但「买棋子、升级、人口上限、羁绊统计、合成」这些规则是纯逻辑，
 * 恰恰是最容易写错、也最影响玩家体验的部分。
 * 所以把规则拆到 state.ts + economy.ts 里，就能这样直接测。
 */
import { describe, expect, it } from 'vitest';
import {
  BENCH_SLOTS,
  BUY_XP_COST,
  MAX_LEVEL,
  REFRESH_COST,
  TEST_MODE_GOLD,
  INCOME_BASE,
  START_GOLD,
  TRAIT_DEFS,
  UNIT_DEFS,
  buyXp,
  createEconomy,
  damageForRound,
  levelSummary,
  mergeBench,
  playableDefs,
  populationCap,
  rollShop,
  sellPriceOf,
  xpNeededForLevel,
  // ★ 0.1.1：野怪回合不计入连胜/连败 —— 测试用它确认"哪些回合是野怪回合"
  isMonsterRound,
  type Cell,
} from '../../../packages/shared/src/index.js';
import {
  advanceRound,
  applyApprovedBuy,
  canShopNow,
  canStartBattle,
  createGameState,
  currentTraits,
  doBuyShopSlot,
  doBuyXp,
  doRefreshShop,
  doSellBench,
  doToggleShopLock,
  isPlayerCell,
  levelInfo,
  didIWin,
  localHpLossForRound,
  shouldClientAdvanceRound,
  shouldFinishBattle,
  mergeAllUnits,
  movePlacement,
  placeSelected,
  placementAt,
  popCap,
  recallFromBoard,
  selectBench,
  switchMode,
  toTeamSetup,
  type GameState,
} from '../src/game/state.js';
import { flipCell, pointerToNdc, rawToViewCell, viewToRawCell } from '../src/game/grid.js';
import { BOARD_H, ENEMY_FRONT_COL, LAST_COL, OWN_FRONT_COL, ownCell, someEnemyCell } from './helpers.js';

/** 造一个确定性随机源，让测试可复现 */
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

/** 把商店的 5 个格子压成一个字符串，方便比较「是不是同一批」 */
/**
 * 测试用的 uid 发放器。
 * mergeBench 的 uid 必须由外部发放（见它的注释：自己编 uid 会撞号），
 * 所以测试里也提供一个自增计数器。
 */
let testUidCounter = 100000;
function testNextUid(): number {
  return ++testUidCounter;
}

/** 按费用挑一个真实存在的干员 id（不写死名字 —— 名单以后会换） */
function sampleDefIdOfCost(cost: number): string {
  const id = Object.values(UNIT_DEFS)
    .filter((def) => def.cost === cost)
    .map((def) => def.id)
    .sort()[0];
  if (!id) throw new Error(`没有 ${cost} 费的干员`);
  return id;
}

function shopSignature(state: GameState): string {
  return state.economy.shop.map((slot) => slot.defId).join(',');
}

/**
 * 找自己半场里第一个空着的格子。
 *
 * 【为什么要"找"而不是直接用 ownCell(0, i)？】
 * 因为合成会让"第 i 个棋子落在第 i 个格子"这个假设失效 ——
 * 买了第三个同名干员时，三个一星会合成一个二星，格子数就对不上了。
 */
function freeOwnCell(state: GameState): Cell {
  for (let row = 0; row < BOARD_H; row++) {
    const cell = ownCell(0, row);
    if (!state.placements.some((p) => p.cell.col === cell.col && p.cell.row === cell.row)) return cell;
  }
  throw new Error('自己半场第一列都被占满了');
}

describe('等级与人口系统', () => {
  it('初始 1 级、人口上限 1', () => {
    const state = createGameState();
    expect(state.economy.level).toBe(1);
    expect(popCap(state)).toBe(1);
    expect(state.economy.gold, '开局 3 金（你要求的）').toBe(START_GOLD);
  });

  it('每升一级人口上限 +1', () => {
    for (let level = 1; level <= MAX_LEVEL; level++) {
      expect(populationCap(level)).toBe(level);
    }
  });

  it('等级上限是 10 级', () => {
    expect(populationCap(20)).toBe(MAX_LEVEL);
    expect(xpNeededForLevel(MAX_LEVEL)).toBe(0);
  });

  it('经验需求随等级递增', () => {
    for (let level = 1; level < MAX_LEVEL - 1; level++) {
      expect(xpNeededForLevel(level + 1)).toBeGreaterThan(xpNeededForLevel(level));
    }
  });

  it('买经验会扣钱、加经验，够了就升级', () => {
    const state = createGameState();
    // 开局只有 3 金（买经验要 4 金），先给够钱再测"扣钱"这件事本身
    state.economy.gold = 20;
    const before = state.economy.gold;
    const result = doBuyXp(state);
    expect(result.ok).toBe(true);
    expect(state.economy.gold).toBe(before - BUY_XP_COST);
    // 至少加了经验，或者已经升级
    expect(state.economy.xp + state.economy.level).toBeGreaterThan(1 + 1);
  });

  it('一直买经验能升到 10 级', () => {
    const state = createGameState();
    // 给足金币，避免因为没钱而中断
    state.economy.gold = 9999;
    for (let i = 0; i < 100 && state.economy.level < MAX_LEVEL; i++) {
      doBuyXp(state);
    }
    expect(state.economy.level).toBe(MAX_LEVEL);
    expect(popCap(state)).toBe(MAX_LEVEL);
  });

  it('满级后不能再买经验', () => {
    const state = createGameState();
    state.economy.gold = 9999;
    state.economy.level = MAX_LEVEL;
    const result = doBuyXp(state);
    expect(result.ok).toBe(false);
    expect(result.message).toContain('最高等级');
  });

  it('钱不够买不了经验', () => {
    const state = createGameState();
    state.economy.gold = 0;
    const result = doBuyXp(state);
    expect(result.ok).toBe(false);
    expect(result.message).toContain('金币不够');
  });

  it('levelSummary 给出正确的进度', () => {
    const econ = createEconomy(makeRng());
    const info = levelSummary(econ);
    expect(info.level).toBe(1);
    expect(info.xpNeeded).toBe(xpNeededForLevel(1));
    expect(info.populationCap).toBe(1);
    expect(info.atMaxLevel).toBe(false);
    expect(info.progress).toBeGreaterThanOrEqual(0);
    expect(info.progress).toBeLessThanOrEqual(1);
  });
});

describe('商店系统', () => {
  it('开局商店有 5 格，且都是有效干员', () => {
    const state = createGameState();
    expect(state.economy.shop).toHaveLength(5);
    for (const slot of state.economy.shop) {
      expect(UNIT_DEFS[slot.defId]).toBeDefined();
      expect(slot.sold).toBe(false);
      expect(slot.cost).toBe(UNIT_DEFS[slot.defId]!.cost);
    }
  });

  it('1 级商店只出 1 费（概率表决定的）', () => {
    const slots = rollShop(1, makeRng(999));
    for (const slot of slots) {
      expect(slot.cost).toBe(1);
    }
  });

  it('等级越高，出现高费干员的概率越大', () => {
    const countExpensive = (level: number): number => {
      let total = 0;
      // 抽 200 次统计，确保样本够大
      for (let seed = 0; seed < 200; seed++) {
        for (const slot of rollShop(level, makeRng(seed * 7919 + 13))) {
          if (slot.cost >= 4) total++;
        }
      }
      return total;
    };
    const low = countExpensive(3);
    const high = countExpensive(9);
    expect(high).toBeGreaterThan(low);
  });

  it('刷新商店要花钱', () => {
    const state = createGameState();
    const before = state.economy.gold;
    const result = doRefreshShop(state);
    expect(result.ok).toBe(true);
    expect(state.economy.gold).toBe(before - REFRESH_COST);
    expect(state.economy.shop).toHaveLength(5);
  });

  it('钱不够不能刷新', () => {
    const state = createGameState();
    state.economy.gold = 0;
    const result = doRefreshShop(state);
    expect(result.ok).toBe(false);
  });

  it('买下商店某一格：扣钱、进备战席、格子标记已售', () => {
    const state = createGameState();
    const slot = state.economy.shop[0]!;
    const cost = UNIT_DEFS[slot.defId]!.cost;
    const before = state.economy.gold;

    const result = doBuyShopSlot(state, 0);
    expect(result.ok).toBe(true);
    expect(state.economy.gold).toBe(before - cost);
    expect(state.economy.shop[0]!.sold).toBe(true);
    expect(state.economy.bench).toHaveLength(1);
    expect(state.economy.bench[0]!.defId).toBe(slot.defId);
    expect(state.economy.bench[0]!.star).toBe(1);
  });

  it('同一格不能买两次', () => {
    const state = createGameState();
    state.economy.gold = 100;
    expect(doBuyShopSlot(state, 0).ok).toBe(true);
    const second = doBuyShopSlot(state, 0);
    expect(second.ok).toBe(false);
    expect(second.message).toContain('已经被买走');
  });

  it('钱不够买不了', () => {
    const state = createGameState();
    state.economy.gold = 0;
    const result = doBuyShopSlot(state, 0);
    expect(result.ok).toBe(false);
    expect(result.message).toContain('金币不够');
  });

  /**
   * ★ 这条以前是**随机红**的，修一下。
   *
   * 【原来为什么不稳定？】
   * 原写法是"把备战席填满 → 刷新 → 直接买 0 号格，断言必须失败"。
   * 但 0.0.2 加了「备战席满、但这一买能立刻合成三星就放行」
   * （见 buyShopSlot 的 allowFullBench），于是：
   *   · 0 号格刚好是"备战席上已经有 2 个"的干员 → 买得进去（合成腾格）
   *   · 0 号格是别的干员 → 被拦下
   * 走哪条路完全看随机商店发了什么牌 → 大约每 6 次跑挂 1 次，
   * 而且**每次都可能挂在不同用例上**，最坏的地方是你会开始怀疑自己刚改的代码。
   *
   * 【修法】把"不该被放行"的那一类干员**手工摆进商店**：
   * 挑一个备战席上完全没有的干员，这种买了必然塞不进去，必须被拦。
   * 涉及随机商店的断言，要么把牌摆定，要么就别断言 —— 不能靠运气。
   */
  it('备战席满了就买不了（席上没这个干员，合成腾不出格子）', () => {
    const state = createGameState();
    state.economy.gold = 9999;
    // 反复刷新并购买，直到备战席满
    let guard = 0;
    while (state.economy.bench.length < BENCH_SLOTS && guard++ < 200) {
      doRefreshShop(state);
      for (let i = 0; i < 5; i++) {
        if (state.economy.bench.length >= BENCH_SLOTS) break;
        doBuyShopSlot(state, i);
      }
    }
    expect(state.economy.bench.length).toBe(BENCH_SLOTS);

    // 把 0 号格摆成一个"备战席上完全没有"的干员 —— 这一买合成腾不出格子
    const onBench = new Set(state.economy.bench.map((unit) => unit.defId));
    const outsider = Object.values(UNIT_DEFS).find((def) => !def.summonOnly && !onBench.has(def.id));
    expect(outsider, '应该能找到一个备战席上没有的干员').toBeDefined();
    state.economy.shop[0] = { defId: outsider!.id, cost: outsider!.cost, sold: false };

    const overflow = doBuyShopSlot(state, 0);
    expect(overflow.ok).toBe(false);
    expect(overflow.message).toContain('备战席满');
  });

  /**
   * ★ 0.1.1 / 0.1.2：**整个商店在战斗阶段（含"等别人看完"的结算阶段）都能用**
   * （用户要求"商店功能不受战斗状态限制"）。
   *
   * 【这条规则改过两次，别改回去】
   * 0.0.3 时只开了"买"一个口子（刷新 / 买经验 / 锁定仍然是布阵专属，
   * 理由是"那三个会改变这一回合的运营状态"）。
   * 0.1.1 按用户要求把战斗阶段**全部**放开 —— 战斗演出十几秒到一分多钟，玩家想边看边运营。
   * ★ 0.1.2 又把 `result` 也放开：多人模式里"我自己先打完、别人还在打"的这段时间
   * 阶段就是 `result`，而玩家正是在这段里最想继续运营（用户报的"多人模式战斗中还是
   * 不能买卖棋子/刷新/锁定"就是这段）。对局真正结束时有全屏结算页盖住，商店点不到。
   *
   * 【唯一没放开的是"改上阵容"】落子 / 换位 / 收回仍然是布阵专属，
   * 那几条闸门在 movePlacement 那几个函数里（开打那一刻阵容就锁死了），
   * 和商店这一套完全是两码事 —— 别把两者混在一起删。
   */
  it('★ 战斗 / 等别人看完（result）期间整个商店都能用（买 / 卖 / 刷新 / 买经验 / 锁定）', () => {
    const state = createGameState();
    state.economy.gold = 9999;

    // 先确认布阵阶段一切正常
    expect(canShopNow(state.phase)).toBe(true);
    expect(doBuyShopSlot(state, 0).ok).toBe(true);
    const goldAfterPrepBuy = state.economy.gold;

    // 切到战斗阶段：五个操作一条龙全过
    state.phase = 'battle';
    expect(canShopNow('battle'), '战斗中应该允许逛商店').toBe(true);

    expect(doRefreshShop(state).ok, '战斗中应该能刷新商店').toBe(true);
    let bought = false;
    for (let slot = 0; slot < 5 && !bought; slot++) bought = doBuyShopSlot(state, slot).ok;
    expect(bought, '战斗中应该买得到棋子').toBe(true);
    expect(state.economy.gold, '战斗中买牌要照常扣钱').toBeLessThan(goldAfterPrepBuy);

    const lastBought = state.economy.bench[state.economy.bench.length - 1]!;
    expect(doSellBench(state, lastBought.uid).ok, '战斗中应该卖得掉备战席的棋子').toBe(true);
    expect(doBuyXp(state).ok, '战斗中应该能买经验').toBe(true);
    expect(doToggleShopLock(state).ok, '战斗中应该能锁定商店').toBe(true);

    // ★ 0.1.2：结算阶段（我已打完、等别人看完）照样能用 —— 多人模式里玩家就在这个窗口里运营
    state.phase = 'result';
    expect(canShopNow('result'), '等别人看完的这段时间应该也能逛商店').toBe(true);
    expect(doRefreshShop(state).ok, 'result 阶段应该能刷新商店').toBe(true);
    let boughtInResult = false;
    for (let slot = 0; slot < 5 && !boughtInResult; slot++) boughtInResult = doBuyShopSlot(state, slot).ok;
    expect(boughtInResult, 'result 阶段应该买得到棋子').toBe(true);
    expect(doToggleShopLock(state).ok, 'result 阶段应该能锁定商店').toBe(true);
  });

  /**
   * ★★ 0.1.3：**联机那条腿**也要能买 —— 用户报的"多人模式战斗阶段还是买不了干员，
   * 刷新、锁定、买经验却都可以"。
   *
   * 【为什么上面那条用例测不到这个 bug？】
   * 联机买牌是**两条腿**：先问服务器（`buyCard`），服务器同意之后再回到客户端
   * `applyApprovedBuy` 落地。上面那条走的是本地那条腿（`doBuyShopSlot` → `canShopNow`），
   * 而 `applyApprovedBuy` 里当时还写着 `state.phase !== 'prep'` ——
   * 于是"战斗中也能买"这条规则只生效了一半：服务器把牌扣掉、客户端却拒绝落地，
   * 还顺手把牌还了回去、弹一句"战斗进行中不能购买"。
   *
   * 这条用例把两条腿钉成同一个口径：**任何 `canShopNow` 认得的状态都能买到**。
   */
  it('★ 联机"服务器已批准"的那次购买，在战斗 / 等别人看完期间同样成立', () => {
    for (const phase of ['battle', 'result'] as const) {
      const state = createGameState();
      state.economy.gold = 9999;
      state.phase = phase;

      const slotIndex = state.economy.shop.findIndex((slot) => slot.defId !== null);
      expect(slotIndex, `${phase}：商店里应该有牌`).toBeGreaterThanOrEqual(0);
      const goldBefore = state.economy.gold;

      const result = applyApprovedBuy(state, slotIndex);
      expect(result.ok, `${phase}：服务器已经批准了，客户端不该再拿阶段把人挡回去`).toBe(true);
      expect(state.economy.bench.length, `${phase}：棋子要真的进备战席`).toBeGreaterThan(0);
      expect(state.economy.gold, `${phase}：要照常扣钱`).toBeLessThan(goldBefore);
    }
  });
});

describe('3 合 1 合成机制', () => {
  it('三个同样的 1 星合成一个 2 星', () => {
    const state = createGameState();
    state.economy.gold = 9999;
    const targetId = state.economy.shop[0]!.defId;

    // 直接往备战席塞三个同样的棋子，然后调用合成
    for (let i = 0; i < 3; i++) {
      state.economy.bench.push({ uid: 9000 + i, defId: targetId, star: 1 });
    }
    const merged = mergeBench(state.economy, testNextUid);

    expect(merged).toHaveLength(1);
    expect(merged[0]!.star).toBe(2);
    expect(state.economy.bench).toHaveLength(1);
    expect(state.economy.bench[0]!.star).toBe(2);
    expect(state.economy.bench[0]!.defId).toBe(targetId);
  });

  it('三个 2 星合成一个 3 星', () => {
    const state = createGameState();
    const targetId = state.economy.shop[0]!.defId;
    for (let i = 0; i < 3; i++) {
      state.economy.bench.push({ uid: 8000 + i, defId: targetId, star: 2 });
    }
    const merged = mergeBench(state.economy, testNextUid);
    expect(merged[0]!.star).toBe(3);
    expect(state.economy.bench).toHaveLength(1);
  });

  it('九个 1 星能一路合到 3 星（连锁合成）', () => {
    const state = createGameState();
    const targetId = state.economy.shop[0]!.defId;
    for (let i = 0; i < 9; i++) {
      state.economy.bench.push({ uid: 7000 + i, defId: targetId, star: 1 });
    }
    mergeBench(state.economy, testNextUid);
    // 9 个 1 星 -> 3 个 2 星 -> 1 个 3 星
    expect(state.economy.bench).toHaveLength(1);
    expect(state.economy.bench[0]!.star).toBe(3);
  });

  it('两个不会合成', () => {
    const state = createGameState();
    const targetId = state.economy.shop[0]!.defId;
    for (let i = 0; i < 2; i++) {
      state.economy.bench.push({ uid: 6000 + i, defId: targetId, star: 1 });
    }
    const merged = mergeBench(state.economy, testNextUid);
    expect(merged).toHaveLength(0);
    expect(state.economy.bench).toHaveLength(2);
  });

  it('不同棋子各两个，不会互相合成', () => {
    const state = createGameState();
    const ids = Object.keys(UNIT_DEFS).slice(0, 2);
    state.economy.bench.push({ uid: 5001, defId: ids[0]!, star: 1 });
    state.economy.bench.push({ uid: 5002, defId: ids[0]!, star: 1 });
    state.economy.bench.push({ uid: 5003, defId: ids[1]!, star: 1 });
    state.economy.bench.push({ uid: 5004, defId: ids[1]!, star: 1 });
    mergeBench(state.economy, testNextUid);
    expect(state.economy.bench).toHaveLength(4);
  });

  it('三星是上限，不会再往上合', () => {
    const state = createGameState();
    const targetId = state.economy.shop[0]!.defId;
    for (let i = 0; i < 3; i++) {
      state.economy.bench.push({ uid: 4000 + i, defId: targetId, star: 3 });
    }
    mergeBench(state.economy, testNextUid);
    // 三个三星应该原样留着（不能合成四星）
    expect(state.economy.bench).toHaveLength(3);
    for (const unit of state.economy.bench) expect(unit.star).toBe(3);
  });

  // ============================================================
  // 用户报的 bug：「干员在竞技场上无法参与合成」
  // ============================================================
  describe('★ 场上干员也参与合成（用户报的 bug）', () => {
    /** 直接往备战席塞 n 个一星 */
    function feedBench(state: GameState, defId: string, n: number, star = 1): void {
      for (let i = 0; i < n; i++) {
        state.economy.bench.push({ uid: testNextUid(), defId, star });
      }
    }
    /** 直接往场上塞一个棋子 */
    function feedBoard(state: GameState, defId: string, cell: Cell, star = 1): void {
      state.placements.push({ uid: testNextUid(), defId, star, cell: { ...cell } });
    }

    it('场上 3 个一样的一星 → 合成一个二星（留在场上）', () => {
      const state = createGameState();
      const defId = state.economy.shop[0]!.defId;
      feedBoard(state, defId, ownCell(0, 0));
      feedBoard(state, defId, ownCell(0, 1));
      feedBoard(state, defId, ownCell(0, 2));

      const reports = mergeAllUnits(state);
      expect(reports).toHaveLength(1);
      expect(reports[0]!.star).toBe(2);
      expect(reports[0]!.onBoard).toBe(true);
      expect(state.placements).toHaveLength(1);
      expect(state.placements[0]!.star).toBe(2);
      expect(state.economy.bench).toHaveLength(0);
    });

    it('★ 场上 2 个 + 备战席 1 个 → 合成结果落在**场上**（不是备战席）', () => {
      const state = createGameState();
      const defId = state.economy.shop[0]!.defId;
      feedBoard(state, defId, ownCell(1, 0));
      feedBoard(state, defId, ownCell(1, 1));
      feedBench(state, defId, 1);

      const reports = mergeAllUnits(state);
      expect(reports).toHaveLength(1);
      expect(reports[0]!.onBoard, '场上的棋子是摆好的战力，不能因为合成而消失').toBe(true);
      expect(state.placements).toHaveLength(1);
      expect(state.placements[0]!.star).toBe(2);
      expect(state.economy.bench).toHaveLength(0);
    });

    it('★ 场上 1 个 + 备战席 2 个 → 结果也落在场上', () => {
      const state = createGameState();
      const defId = state.economy.shop[0]!.defId;
      feedBoard(state, defId, ownCell(2, 3));
      feedBench(state, defId, 2);

      mergeAllUnits(state);
      expect(state.placements).toHaveLength(1);
      expect(state.placements[0]!.star).toBe(2);
      expect(state.economy.bench).toHaveLength(0);
    });

    it('3 个都在备战席 → 结果落在备战席（不凭空上场）', () => {
      const state = createGameState();
      const defId = state.economy.shop[0]!.defId;
      feedBench(state, defId, 3);

      const reports = mergeAllUnits(state);
      expect(reports[0]!.onBoard).toBe(false);
      expect(state.placements).toHaveLength(0);
      expect(state.economy.bench).toHaveLength(1);
      expect(state.economy.bench[0]!.star).toBe(2);
    });

    it('★ 买第 3 个时，场上的两个会参与合成（这就是那个 bug）', () => {
      const state = createGameState();
      const defId = state.economy.shop[0]!.defId;
      state.economy.gold = 9999;
      feedBoard(state, defId, ownCell(0, 5));
      feedBoard(state, defId, ownCell(1, 5));
      state.economy.bench.push({ uid: testNextUid(), defId, star: 1 });
      // 再买一个同样的（直接放进备战席，模拟"买下")
      state.economy.bench.push({ uid: testNextUid(), defId, star: 1 });

      const reports = mergeAllUnits(state);
      expect(reports.length).toBeGreaterThan(0);
      expect(state.placements.filter((p) => p.star === 2)).toHaveLength(1);
    });

    it('★ 九个一星（场上+备战席混合）能一路合到三星', () => {
      const state = createGameState();
      const defId = state.economy.shop[0]!.defId;
      feedBoard(state, defId, ownCell(0, 0));
      feedBoard(state, defId, ownCell(0, 1));
      feedBoard(state, defId, ownCell(0, 2));
      feedBench(state, defId, 6);

      const reports = mergeAllUnits(state);
      // 9 个一星 -> 3 个二星 -> 1 个三星，共 4 次合成
      expect(reports).toHaveLength(4);
      const threeStars = [
        ...state.placements.filter((p) => p.star === 3),
        ...state.economy.bench.filter((u) => u.star === 3),
      ];
      expect(threeStars).toHaveLength(1);
      expect(state.placements.length + state.economy.bench.length).toBe(1);
    });

    it('合成不改变「总星级价值」：吃掉的三个 = 生成的一个', () => {
      const state = createGameState();
      const defId = state.economy.shop[0]!.defId;
      feedBoard(state, defId, ownCell(3, 0));
      feedBench(state, defId, 2);

      const before = starValue(state);
      mergeAllUnits(state);
      // 3 个一星（价值 3）-> 1 个二星（价值 3）
      expect(starValue(state)).toBe(before);
    });

    it('★ uid 不重复（合成后场上和备战席加起来也不能撞号）', () => {
      const state = createGameState();
      const defId = state.economy.shop[0]!.defId;
      feedBoard(state, defId, ownCell(0, 0));
      feedBoard(state, defId, ownCell(0, 1));
      feedBench(state, defId, 7); // 总共 9 个
      mergeAllUnits(state);

      const uids = [...state.placements.map((p) => p.uid), ...state.economy.bench.map((u) => u.uid)];
      expect(new Set(uids).size).toBe(uids.length);
    });

    it('★ 场上的格子占用正确：合成后空出来的格子可以再放人', () => {
      const state = createGameState();
      const defId = state.economy.shop[0]!.defId;
      feedBoard(state, defId, ownCell(0, 0));
      feedBoard(state, defId, ownCell(0, 1));
      feedBench(state, defId, 1);
      mergeAllUnits(state);

      // 只应该剩一个格子被占（原 uid 最小的那个）
      const occupied = new Set(state.placements.map((p) => `${p.cell.col},${p.cell.row}`));
      expect(occupied.size).toBe(state.placements.length);
    });

    /** 场上+备战席的"总星级价值"：一星算 1、二星算 3、三星算 9 */
    function starValue(state: GameState): number {
      const value = (star: number): number => 3 ** (star - 1);
      return (
        state.placements.reduce((sum, p) => sum + value(p.star), 0) +
        state.economy.bench.reduce((sum, u) => sum + value(u.star), 0)
      );
    }
  });

  // ============================================================
  // 回归测试：用户报过「合成第二个二星时，会消失一个二星」
  // ============================================================
  describe('★ 回归：连续合成不会丢棋子', () => {
    /**
     * 核心不变量：备战席里不能有两条 uid 相同的记录。
     *
     * 这个 bug 的根因就是 uid 撞号 ——
     * mergeBench 原本自己用 `Math.max(现有uid) + 1` 编 uid，
     * 而外部发放 uid 的计数器并不知道合成造了哪些号。
     * 一旦撞号，「吃掉三个」按 uid 过滤时就会**连带删掉同号的其它棋子**。
     */
    function assertUidUnique(bench: Array<{ uid: number }>): void {
      const uids = bench.map((u) => u.uid);
      expect(new Set(uids).size, `uid 撞号了: [${uids.join(',')}]`).toBe(uids.length);
    }

    it('★ 买 6 个同样的棋子，应该得到 2 个二星（一个都不能少）', () => {
      const state = createGameState();
      const defId = state.economy.shop[0]!.defId;

      for (let i = 0; i < 6; i++) {
        state.economy.bench.push({ uid: testNextUid(), defId, star: 1 });
        mergeBench(state.economy, testNextUid);
        assertUidUnique(state.economy.bench);
      }

      expect(state.economy.bench.filter((u) => u.star === 2), '应该是 2 个二星').toHaveLength(2);
      expect(state.economy.bench).toHaveLength(2);
    });

    it('★ 买 18 个同样的棋子，应该得到 2 个三星', () => {
      const state = createGameState();
      const defId = state.economy.shop[0]!.defId;

      for (let i = 0; i < 18; i++) {
        state.economy.bench.push({ uid: testNextUid(), defId, star: 1 });
        mergeBench(state.economy, testNextUid);
        assertUidUnique(state.economy.bench);
      }

      expect(state.economy.bench.filter((u) => u.star === 3), '应该是 2 个三星').toHaveLength(2);
      expect(state.economy.bench.filter((u) => u.star === 2)).toHaveLength(0);
      expect(state.economy.bench).toHaveLength(2);
    });

    it('★ 每次合成的棋子数量变化必须正好是 -2（三个变一个）', () => {
      const state = createGameState();
      const defId = state.economy.shop[0]!.defId;

      for (let i = 0; i < 12; i++) {
        state.economy.bench.push({ uid: testNextUid(), defId, star: 1 });
        const countBefore = state.economy.bench.length;
        const merged = mergeBench(state.economy, testNextUid);
        expect(state.economy.bench.length).toBe(countBefore - 2 * merged.length);
        assertUidUnique(state.economy.bench);
      }
    });

    it('★ 合成消耗的星数必须符合 3N -> N+1 的规律', () => {
      // 一次合成把三个 N 星变成 (N+1) 星，星数从 3N 变成 N+1，少了 2N-1
      const state = createGameState();
      const defId = state.economy.shop[0]!.defId;

      for (let i = 0; i < 9; i++) {
        state.economy.bench.push({ uid: testNextUid(), defId, star: 1 });
        const starBefore = state.economy.bench.reduce((s, u) => s + u.star, 0);
        const merged = mergeBench(state.economy, testNextUid);
        const starAfter = state.economy.bench.reduce((s, u) => s + u.star, 0);

        const expectedLoss = merged.reduce((s, m) => s + (2 * (m.star - 1) - 1), 0);
        expect(starBefore - starAfter, `第 ${i + 1} 次合成的星数损失不对`).toBe(expectedLoss);
      }
    });

    it('两个不同的棋子各买 3 个，各得一个二星，互不干扰', () => {
      const state = createGameState();
      /*
        ★ 只挑"有星级机制"的常规干员：彩蛋棋子（noStar，id 是 `egg_mvm`）
        排序还排在所有 `opNN` / `mn_*` 前面 —— 直接取 UNIT_DEFS 的前两个
        会拿到它，而它**故意不参与合成**，这条断言就没意义了。
      */
      const [a, b] = playableDefs()
        .filter((def) => def.noStar !== true)
        .map((def) => def.id)
        .sort();

      for (let i = 0; i < 3; i++) {
        state.economy.bench.push({ uid: testNextUid(), defId: a!, star: 1 });
        state.economy.bench.push({ uid: testNextUid(), defId: b!, star: 1 });
      }
      mergeBench(state.economy, testNextUid);

      expect(state.economy.bench.filter((u) => u.defId === a && u.star === 2)).toHaveLength(1);
      expect(state.economy.bench.filter((u) => u.defId === b && u.star === 2)).toHaveLength(1);
      expect(state.economy.bench).toHaveLength(2);
    });
  });
});

describe('备战席与上场', () => {
  it('选中备战席棋子，再放到场上', () => {
    const state = createGameState();
    state.economy.gold = 9999;
    doBuyShopSlot(state, 0);
    const unit = state.economy.bench[0]!;

    selectBench(state, unit.uid);
    expect(state.selectedBenchUid).toBe(unit.uid);

    const cell = ownCell(0, 2);
    const result = placeSelected(state, cell);
    expect(result.ok).toBe(true);
    expect(state.placements).toHaveLength(1);
    expect(state.economy.bench).toHaveLength(0);
    expect(placementAt(state, cell)?.defId).toBe(unit.defId);
  });

  it('人口上限会拦住你（1 级只能上 1 个）', () => {
    const state = createGameState();
    state.economy.gold = 9999;
    expect(popCap(state)).toBe(1);

    doBuyShopSlot(state, 0);
    doBuyShopSlot(state, 1);
    selectBench(state, state.economy.bench[0]!.uid);
    expect(placeSelected(state, ownCell(0, 1)).ok).toBe(true);

    selectBench(state, state.economy.bench[0]!.uid);
    const second = placeSelected(state, ownCell(0, 3));
    expect(second.ok).toBe(false);
    expect(second.message).toContain('人口已满');
  });

  it('升级之后能上更多', () => {
    /*
      ============================================================
      ★ 这条测试修的是它自己的一个"千分之一概率随机红"
      ============================================================
      原来的写法是每轮 `selectBench(state, state.economy.bench[0]!.uid)`，
      默认"买完一定有一个棋子在备战席"。

      但商店是**随机**出的：如果三轮恰好都买到同一个干员，第三个一星买进来时
      会和场上那两个合成一个二星，而合成规则是
      「被吃掉的三个里有任何一个在场上，结果就落到场上」——
      于是**备战席变成空的**，`bench[0]` 是 undefined，
      报 `Cannot read properties of undefined (reading 'uid')`。

      我把 4000 个种子挨个跑了一遍：4 个会踩到（0.1%）。
      这种"千分之一概率红一次"的测试比没有测试更坏 ——
      你会开始怀疑自己刚改的东西，而其实什么都没坏。
      （它是**早就存在**的：只要商店是随机的就会偶发，和这轮改动无关。）

      现在的写法不假设备备席里有东西：
      合成产生的**场上**棋子同样算"上场了"，人口上限照样被它占掉。
    */
    const state = createGameState();
    state.economy.gold = 9999;
    // 升到 3 级
    while (state.economy.level < 3) doBuyXp(state);
    expect(popCap(state)).toBe(3);

    for (let guard = 0; guard < 60 && state.placements.length < 3; guard++) {
      // 备战席空了（还没买，或者合成把棋子收到场上了）就先买一个
      if (state.economy.bench.length === 0) {
        let bought = false;
        for (let slot = 0; slot < 5 && !bought; slot++) bought = doBuyShopSlot(state, slot).ok;
        if (!bought) doRefreshShop(state);
        continue;
      }
      const unit = state.economy.bench[0]!;
      selectBench(state, unit.uid);
      const result = placeSelected(state, freeOwnCell(state));
      expect(result.ok, `第 ${state.placements.length + 1} 个应该能上场：${result.message}`).toBe(true);
    }

    expect(state.placements, '升到 3 级应该能上 3 个干员').toHaveLength(3);
  });

  it('不能放在对方半场', () => {
    const state = createGameState();
    state.economy.gold = 9999;
    doBuyShopSlot(state, 0);
    selectBench(state, state.economy.bench[0]!.uid);
    const result = placeSelected(state, someEnemyCell());
    expect(result.ok).toBe(false);
    expect(result.message).toContain('左半边');
  });

  /**
   * ★ 这条测试原来叫「同一个格子不能放两个」，断言的是 `ok === false`。
   *
   * 【为什么改成"互换"了？】
   * 因为玩家操作的手感：换位是自走棋里最频繁的动作，
   * 原来"这个格子已经有人了"逼你先右键收回、再点一次放上去 ——
   * 三下操作做一件本来就是一步的事。
   * 现在点上去直接互换，所以这条测试改成断言"换成功了，而且两边都还在"。
   */
  it('★ 把备战席干员放到已有干员的格子上 -> 互换（不是放不上去）', () => {
    const state = createGameState();
    state.economy.gold = 9999;
    state.economy.level = 5;
    const cell = ownCell(1, 1);

    doBuyShopSlot(state, 0);
    const bought = state.economy.bench[0];
    expect(bought, '前提：第一个干员要买成功').toBeDefined();
    const firstUid = bought!.uid;
    const firstDefId = bought!.defId;
    selectBench(state, firstUid);
    expect(placeSelected(state, cell).ok).toBe(true);
    expect(state.placements).toHaveLength(1);

    // 再买一个不一样的，放到同一个格子上
    /*
      ★ 这里以前写的是 `state.economy.bench[0]!` —— 也是随机红的来源。
      买完之后备战席第 0 格**不一定存在、也不一定是刚买的那个**：
      合成会吃掉若干格子，`bench[0]` 可能是 undefined。
      改成"从备战席里找一个和 first 不同的"，不依赖下标也不依赖顺序。
    */
    const findOther = () => state.economy.bench.find((unit) => unit.defId !== firstDefId);
    let secondUnit = findOther();
    let secondDefId = secondUnit?.defId ?? '';
    for (let attempt = 0; attempt < 10 && !secondUnit; attempt++) {
      for (let slot = 0; slot < 5 && !secondUnit; slot++) {
        if (doBuyShopSlot(state, slot).ok) secondUnit = findOther();
      }
      if (!secondUnit) doRefreshShop(state);
    }

    const secondUid = secondUnit?.uid;
    if (secondUid === undefined) return; // 极端情况：商店一直只出同一个干员，跳过
    secondDefId = secondUnit!.defId;

    selectBench(state, secondUid);
    const swapped = placeSelected(state, cell);
    expect(swapped.ok, `互换应该成功：${swapped.message}`).toBe(true);
    expect(swapped.message).toContain('互换');

    // 关键：数量不变（一个下去一个上来），而且换了人
    expect(state.placements, '互换不该改变场上人数').toHaveLength(1);
    expect(state.placements[0]!.defId, '格子上应该站着刚放下去的那个').toBe(secondDefId);
    expect(
      state.economy.bench.some((b) => b.uid === firstUid),
      '原来在格子上的那个应该回到备战席，不能凭空消失',
    ).toBe(true);
  });

  it('★ 互换不受人口上限影响（场上人数没变，不该被"人口已满"拦住）', () => {
    const state = createGameState();
    state.economy.gold = 9999;
    // 停在 1 级：人口上限就是 1
    expect(popCap(state)).toBe(1);
    const cell = ownCell(2, 2);

    doBuyShopSlot(state, 0);
    const firstUid = state.economy.bench[0]!.uid;
    selectBench(state, firstUid);
    expect(placeSelected(state, cell).ok).toBe(true);

    // 场上已经有 1 个 = 人口满了；此时把另一个放到同一格应该仍然能换
    doRefreshShop(state);
    let placed = false;
    for (let slot = 0; slot < 5 && !placed; slot++) {
      if (!doBuyShopSlot(state, slot).ok) continue;
      const candidate = state.economy.bench[state.economy.bench.length - 1]!;
      if (candidate.uid === firstUid) continue;
      selectBench(state, candidate.uid);
      const result = placeSelected(state, cell);
      expect(result.ok, `人口满了也应该能换位：${result.message}`).toBe(true);
      placed = true;
    }
    expect(placed, '没能买到第二个干员，测试没意义').toBe(true);
    expect(state.placements).toHaveLength(1);
  });

  it('收回棋子会回到备战席，且可能触发合成', () => {
    const state = createGameState();
    state.economy.gold = 9999;
    state.economy.level = 5;
    const cell = ownCell(0, 0);

    doBuyShopSlot(state, 0);
    const defId = state.economy.bench[0]!.defId;
    selectBench(state, state.economy.bench[0]!.uid);
    placeSelected(state, cell);

    // 再买两个同样的（直接塞进备战席凑数）
    state.economy.bench.push({ uid: 9500, defId, star: 1 });
    state.economy.bench.push({ uid: 9501, defId, star: 1 });

    const result = recallFromBoard(state, cell);
    expect(result.ok).toBe(true);
    expect(state.placements).toHaveLength(0);
    // 三个一星应该已经合成一个二星
    expect(state.economy.bench).toHaveLength(1);
    expect(state.economy.bench[0]!.star).toBe(2);
  });

  it('卖掉备战席棋子会返还金币', () => {
    const state = createGameState();
    state.economy.gold = 9999;
    doBuyShopSlot(state, 0);
    const unit = state.economy.bench[0]!;
    const cost = UNIT_DEFS[unit.defId]!.cost;
    const before = state.economy.gold;

    const result = doSellBench(state, unit.uid);
    expect(result.ok).toBe(true);
    expect(state.economy.gold).toBe(before + cost);
    expect(state.economy.bench).toHaveLength(0);
  });

  /**
   * 这一组是用户报的 bug：「2 星和 3 星角色出售获得的金币数量不对，不是原价卖出」
   *
   * 合成一个 N 星要花 3^(N-1) 个一星的钱：
   *   1 星 = 1 个 → 花 1 份钱
   *   2 星 = 3 个 → 花 3 份钱
   *   3 星 = 9 个 → 花 9 份钱
   * 卖出的返还额必须等于原价，否则玩家每合成一次就白亏一笔，
   * 等于在惩罚玩家使用这个核心机制。
   */
  describe('出售返还 = 原价（用户报的 bug）', () => {
    it('sellPriceOf 的公式：费用 × 3^(星级-1)', () => {
      expect(sellPriceOf(1, 1)).toBe(1);
      expect(sellPriceOf(1, 2)).toBe(3);
      expect(sellPriceOf(1, 3)).toBe(9);
      expect(sellPriceOf(5, 1)).toBe(5);
      expect(sellPriceOf(5, 2)).toBe(15);
      expect(sellPriceOf(5, 3)).toBe(45);
      // 星级越界不该崩，按最近的合法档处理
      expect(sellPriceOf(3, 0)).toBe(3);
      expect(sellPriceOf(3, 9)).toBe(27);
    });

    it('★ 买 3 个一星合成二星后卖掉，金币回到原点（不亏不赚）', () => {
      const state = createGameState();
      state.economy.gold = 9999;
      state.economy.level = 5;
      doBuyShopSlot(state, 0);
      const defId = state.economy.bench[0]!.defId;
      const cost = UNIT_DEFS[defId]!.cost;

      // 手动凑够三个（模拟买了三次同一个干员）
      state.economy.bench = [
        { uid: 7001, defId, star: 1 },
        { uid: 7002, defId, star: 1 },
        { uid: 7003, defId, star: 1 },
      ];
      const goldBefore = state.economy.gold;
      const merged = mergeBench(state.economy, testNextUid);
      expect(merged).toHaveLength(1);
      expect(state.economy.bench[0]!.star).toBe(2);

      // 这三份钱是"花掉"的，先记下来
      const spent = cost * 3;
      const goldAfterMerge = state.economy.gold;

      const sold = doSellBench(state, state.economy.bench[0]!.uid);
      expect(sold.ok).toBe(true);
      expect(goldAfterMerge - goldBefore).toBe(0); // 合成本身不花钱
      expect(state.economy.gold).toBe(goldAfterMerge + spent);
      expect(sold.message).toContain(`+${spent}`);
    });

    it('★ 三星返还 9 倍费用', () => {
      const state = createGameState();
      state.economy.gold = 0;
      const defId = sampleDefIdOfCost(1);
      state.economy.bench = [{ uid: 8001, defId, star: 3 }];

      const sold = doSellBench(state, 8001);
      expect(sold.ok).toBe(true);
      expect(state.economy.gold).toBe(UNIT_DEFS[defId]!.cost * 9);
    });

    it('★ 回归：旧公式 cost × star 会算少，这里明确钉住正确值', () => {
      const state = createGameState();
      const defId = sampleDefIdOfCost(2);
      const cost = UNIT_DEFS[defId]!.cost;

      // 2 星的旧公式给 cost*2，正确是 cost*3
      expect(sellPriceOf(cost, 2)).not.toBe(cost * 2);
      expect(sellPriceOf(cost, 2)).toBe(cost * 3);
      // 3 星的旧公式给 cost*3，正确是 cost*9
      expect(sellPriceOf(cost, 3)).not.toBe(cost * 3);
      expect(sellPriceOf(cost, 3)).toBe(cost * 9);

      state.economy.gold = 0;
      state.economy.bench = [{ uid: 8002, defId, star: 2 }];
      doSellBench(state, 8002);
      expect(state.economy.gold).toBe(cost * 3);
    });
  });
});

describe('羁绊统计', () => {
  it('空场时没有羁绊', () => {
    const state = createGameState();
    expect(currentTraits(state)).toHaveLength(0);
  });

  it('上场干员后，它会带来自己的标签', () => {
    const state = createGameState();
    state.economy.gold = 9999;
    state.economy.level = 5;

    doBuyShopSlot(state, 0);
    const unit = state.economy.bench[0]!;
    const def = UNIT_DEFS[unit.defId]!;

    selectBench(state, unit.uid);
    placeSelected(state, ownCell(0, 0));

    const traits = currentTraits(state);
    // 这个干员的每个标签都应该出现在羁绊列表里
    for (const trait of def.traits) {
      expect(traits.some((t) => t.traitId === trait)).toBe(true);
    }
    // 数量至少是 1
    for (const trait of traits) {
      expect(trait.count).toBeGreaterThanOrEqual(1);
    }
  });

  it('★ 同样的干员上两个，标签数量还是 1（羁绊按"不同干员"算）', () => {
    /*
      你报的"上场 2 个相同的干员还是会重复触发羁绊"。

      规则：羁绊看的是阵容里有几种**不同**的干员，不是上了几个棋子。
      所以每个标签的数量都不会因为"又上了一个同名"而增加；
      UI 上显示的"N 人"也就永远等于"这队里有几种这个标签的干员"。
    */
    const state = createGameState();
    state.economy.gold = 9999;
    state.economy.level = 5;

    doBuyShopSlot(state, 0);
    const defId = state.economy.bench[0]!.defId;
    selectBench(state, state.economy.bench[0]!.uid);
    placeSelected(state, ownCell(0, 0));

    // 第二个同名干员直接放进备战席再上场
    state.economy.bench.push({ uid: 9600, defId, star: 1 });
    selectBench(state, 9600);
    placeSelected(state, ownCell(0, 2));

    // 场上确实站了 2 个棋子（这条没变）
    expect(state.placements.filter((p) => p.defId === defId).length).toBe(2);

    const def = UNIT_DEFS[defId]!;
    const traits = currentTraits(state);
    for (const traitId of def.traits) {
      const entry = traits.find((t) => t.traitId === traitId);
      expect(entry, `${traitId} 应该还在列表里`).toBeDefined();
      expect(entry!.count, `${traitId} 上两个同名不该变成 2`).toBe(1);
    }
  });

  it('羁绊表里没有的标签不会出现在列表里', () => {
    const state = createGameState();
    const traits = currentTraits(state);
    for (const trait of traits) {
      expect(TRAIT_DEFS[trait.traitId]).toBeDefined();
    }
  });

  it('每个干员的标签都有对应的羁绊定义（数据一致性）', () => {
    for (const def of Object.values(UNIT_DEFS)) {
      for (const trait of def.traits) {
        expect(TRAIT_DEFS[trait], `干员 ${def.name} 的标签 ${trait} 没有羁绊定义`).toBeDefined();
      }
    }
  });

  it('每个羁绊至少有一个干员能用（不会出现永远凑不出的羁绊）', () => {
    /*
      ★ 0.2：MujicaAve 是"**先写效果、成员后面再加**"的批次（用户口径），
      这期间它能被凑出来的唯一途径是「MujicaAve转职」（转职会挂标签）。
      ⇒ 这是一个**待办清单**：加完人必须把 id 删掉。
      （和 packages/shared/test/validate-data.test.ts 里那份保持一致。）
    */
    // ★ 0.2：MujicaAve 五人已录入 ⇒ 清单清空（和 shared 那份保持一致）
    const NO_MEMBERS_YET = new Set<string>();
    for (const traitId of Object.keys(TRAIT_DEFS)) {
      if (NO_MEMBERS_YET.has(traitId)) continue;
      const owners = Object.values(UNIT_DEFS).filter((def) => def.traits.includes(traitId));
      expect(owners.length, `羁绊 ${traitId} 没有任何干员带有这个标签`).toBeGreaterThan(0);
    }
  });
});

describe('开战前检查', () => {
  it('空阵容不能开战', () => {
    const state = createGameState();
    expect(canStartBattle(state).ok).toBe(false);
  });

  it('有干员上场就能开战', () => {
    const state = createGameState();
    state.economy.gold = 9999;
    doBuyShopSlot(state, 0);
    selectBench(state, state.economy.bench[0]!.uid);
    placeSelected(state, ownCell(0, 1));
    expect(canStartBattle(state).ok).toBe(true);
  });

  it('toTeamSetup 产出的阵容全部在自己半场', () => {
    const state = createGameState();
    state.economy.gold = 9999;
    state.economy.level = 5;
    for (let i = 0; i < 3; i++) {
      doRefreshShop(state);
      doBuyShopSlot(state, 0);
      selectBench(state, state.economy.bench[0]!.uid);
      placeSelected(state, ownCell(0, i));
    }
    const team = toTeamSetup(state);
    expect(team.team).toBe(0);
    for (const unit of team.units) {
      expect(isPlayerCell(unit.cell)).toBe(true);
    }
  });
});

describe('视角翻转（联机时「我的干员必须在画面左边」）', () => {
  it('翻两次回到原处', () => {
    for (let col = 0; col <= LAST_COL; col++) {
      for (let row = 0; row < BOARD_H; row++) {
        expect(flipCell(flipCell({ col, row }))).toEqual({ col, row });
      }
    }
  });

  it('镜像公式：首尾互换', () => {
    expect(flipCell({ col: 0, row: 0 })).toEqual({ col: LAST_COL, row: 0 });
    expect(flipCell({ col: LAST_COL, row: 0 })).toEqual({ col: 0, row: 0 });
    expect(flipCell({ col: OWN_FRONT_COL, row: 1 })).toEqual({ col: ENEMY_FRONT_COL, row: 1 });
  });

  it('视角坐标与逻辑坐标互为逆运算', () => {
    for (const flipped of [false, true]) {
      for (let col = 0; col <= LAST_COL; col++) {
        const cell = { col, row: 1 };
        expect(rawToViewCell(viewToRawCell(cell, flipped), flipped)).toEqual(cell);
      }
    }
  });

  it('不翻转时坐标原样返回（单机模式不受影响）', () => {
    for (let col = 0; col <= LAST_COL; col++) {
      const cell = { col, row: 1 };
      expect(viewToRawCell(cell, false)).toEqual(cell);
    }
  });

  it('★ 翻转后「画面上点左边」仍落在自己半场（联机最容易错的一点）', () => {
    const rawCell = viewToRawCell({ col: 0, row: 2 }, true);
    expect(rawCell.col).toBe(LAST_COL);
    expect(rawCell.col).toBeGreaterThanOrEqual(ENEMY_FRONT_COL);
  });
});

describe('测试模式（无限金币 + 切换即重开一局）', () => {
  it('默认是关闭的，而且是普通模式的开局状态', () => {
    const state = createGameState();
    expect(state.testMode).toBe(false);
    expect(state.economy.gold, '开局 3 金（你要求的）').toBe(START_GOLD);
    expect(state.economy.level).toBe(1);
    expect(state.round).toBe(1);
    expect(state.placements).toHaveLength(0);
    expect(state.economy.bench).toHaveLength(0);
  });

  it('切到测试模式后金币无限，而且是全新一局', () => {
    const state = createGameState();
    const result = switchMode(state);
    expect(result.ok).toBe(true);

    const test = result.next;
    expect(test.testMode).toBe(true);
    expect(test.economy.gold).toBe(TEST_MODE_GOLD);
    // 等级/回合/阵容都重置成开局状态
    expect(test.economy.level).toBe(1);
    expect(test.economy.xp).toBe(0);
    expect(test.round).toBe(1);
    expect(test.placements).toHaveLength(0);
    expect(test.economy.bench).toHaveLength(0);
    expect(test.phase).toBe('prep');
  });

  it('★ 切换模式会把等级和阵容重置（这是用户明确要求的）', () => {
    const state = createGameState();
    // 先把普通模式玩到「等级高 + 场上有棋子 + 备战席有货」
    state.economy.gold = 9999;
    state.economy.level = 7;
    while (state.economy.level < 7) doBuyXp(state);
    doBuyShopSlot(state, 0);
    selectBench(state, state.economy.bench[0]!.uid);
    placeSelected(state, ownCell(0, 1));
    expect(state.economy.level).toBeGreaterThan(1);
    expect(state.placements.length).toBeGreaterThan(0);

    // 切到测试模式 —— 应该是一局全新的
    const test = switchMode(state).next;
    expect(test.economy.level).toBe(1);
    expect(test.economy.xp).toBe(0);
    expect(test.placements).toHaveLength(0);
    expect(test.economy.bench).toHaveLength(0);
    expect(test.round).toBe(1);
  });

  it('★ 从测试模式切回普通模式，会把之前的进度还给你', () => {
    const state = createGameState();
    state.economy.gold = 9999;
    while (state.economy.level < 5) doBuyXp(state);
    doBuyShopSlot(state, 0);
    const savedLevel = state.economy.level;

    // 进测试模式
    const test = switchMode(state).next;
    expect(test.testMode).toBe(true);
    // 在测试模式里乱搞一通
    test.economy.level = 10;
    test.economy.gold = TEST_MODE_GOLD;

    // 切回普通模式 —— 应该恢复到刚才存的进度
    const back = switchMode(test).next;
    expect(back.testMode).toBe(false);
    expect(back.economy.level).toBe(savedLevel);
    expect(back.economy.gold).not.toBe(TEST_MODE_GOLD);
  });

  it('测试模式下买干员不会把钱花光（金币永远是满的）', () => {
    const state = switchMode(createGameState()).next;
    for (let i = 0; i < 20; i++) {
      doRefreshShop(state);
      doBuyShopSlot(state, 0);
      doSellBench(state, state.economy.bench[0]!.uid);
      expect(state.economy.gold).toBe(TEST_MODE_GOLD);
    }
  });

  it('测试模式下能一路升到 10 级', () => {
    const state = switchMode(createGameState()).next;
    /*
      上限从 50 提到 90：换成云顶经验表之后，1→10 总共要 221 点经验，
      而买一次只给 4 点 —— 50 次只有 200 点，**升不满**。
      （这类"测试里的魔法数字"要跟着数值改动一起调，否则会变成一条
       看起来在测功能、其实只是在测"数字够不够大"的假测试。）
    */
    for (let i = 0; i < 90 && state.economy.level < MAX_LEVEL; i++) {
      doBuyXp(state);
    }
    expect(state.economy.level).toBe(MAX_LEVEL);
    expect(popCap(state)).toBe(10);
  });

  it('回合结算不会把无限金币改回正常数值', () => {
    const state = switchMode(createGameState()).next;
    // ★ 0.0.3：第 1 回合是**野怪回合**，赢了会掉金币/藏品 —— 这里只想测经济结算，
    //   所以先把回合挪到一个"普通回合"（3 回合不是野怪回合）
    state.round = 3;
    advanceRound(state, true);
    expect(state.economy.gold).toBe(TEST_MODE_GOLD);
  });

  it('退出测试模式后，回合结算恢复正常', () => {
    const state = createGameState();
    state.economy.gold = 10;
    const test = switchMode(state).next;
    const back = switchMode(test).next;
    // 退出测试模式是"回到进测试模式之前的那一份"，所以是当时的 10 金，不是开局金币
    expect(back.economy.gold).toBe(10);

    back.round = 3; // 躲开野怪回合的掉落
    advanceRound(back, true);
    // 基础收入 10 + 利息 1（10 金）+ 连胜 0 = 11
    expect(back.economy.gold).toBe(10 + INCOME_BASE + 1);
  });

  it('切换模式总是返回一个「新对象」，不会改动传进去的状态', () => {
    const state = createGameState();
    state.economy.gold = 42;
    const test = switchMode(state).next;

    // 原状态不该被改动（这样调用方可以安全地把它存起来）
    expect(state.testMode).toBe(false);
    expect(state.economy.gold).toBe(42);
    // 新状态是另一个对象
    expect(test).not.toBe(state);
  });
});

describe('商店随机性（防止「每局商店都一样」）', () => {
  it('★ 不传种子时，两次新局的商店不应该完全一样', () => {
    // 这条测试是为了防止一个真实出现过的 bug：
    // createGameState 以前用固定种子 20250101，导致每次重开一局
    // 第一回合的商店完全一样。修法是种子默认按时间生成。
    //
    // 注意：理论上仍有极小概率两次抽到同一批（5 个格子都撞），
    // 所以这里比较「多次新局里至少出现过两种不同的商店」，
    // 而不是死磕两次必须不同。
    const seen = new Set<string>();
    for (let i = 0; i < 10; i++) {
      const state = createGameState();
      seen.add(shopSignature(state));
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it('★ 传同一个种子时，两局必须完全一样（可复现，方便调试）', () => {
    const a = createGameState(12345);
    const b = createGameState(12345);
    expect(shopSignature(a)).toBe(shopSignature(b));
    expect(a.seed).toBe(b.seed);
  });

  it('★ 连续刷新商店不应该反复拿到同一批（同一毫秒也不会）', () => {
    // 另一个真实出现过的 bug：刷新时用 Date.now() 当种子，
    // 同一毫秒内连点刷新会拿到完全相同的序列，看起来像「没刷新」。
    // 现在改成用状态里那条持续往下走的随机序列。
    //
    // 【注意要把等级调高】
    // 1 级时商店只能出 1 费的 10 个干员，5 个格子重复是正常的 ——
    // 那样测不出「随机源坏掉」这个问题。
    // 升到 7 级后可选干员覆盖 1~5 费共 50 个，组合数足够大，
    // 如果随机源坏了（序列不往前走），重复率会立刻异常。
    const state = createGameState(999);
    state.economy.level = 7;
    // ★ 必须给足金币：刷新一次 2 金，初始只有 10 金 ——
    // 刷 5 次就没钱了，后面全部静默失败，看起来像「商店不刷新」。
    // （我第一次写这条测试时就踩了这个坑，seen.size 恰好等于 5。）
    state.economy.gold = 9999;

    const seen = new Set<string>();
    const rounds = 30;
    for (let i = 0; i < rounds; i++) {
      const result = doRefreshShop(state);
      // 顺便断言每次刷新都真的成功了，避免以后再出现「静默失败」
      expect(result.ok, `第 ${i + 1} 次刷新失败了：${result.message}`).toBe(true);
      seen.add(shopSignature(state));
    }
    // 30 次刷新里，不同批次应该占绝大多数
    expect(seen.size).toBeGreaterThan(rounds * 0.8);
  });

  it('同一个种子 + 同样的操作序列，结果完全一致', () => {
    const run = (): string => {
      const state = createGameState(4242);
      doRefreshShop(state);
      doRefreshShop(state);
      doBuyXp(state);
      doRefreshShop(state);
      return shopSignature(state) + '|' + state.economy.gold + '|' + state.economy.level;
    };
    expect(run()).toBe(run());
  });
});

describe('锁定商店', () => {
  it('默认未锁定', () => {
    const state = createGameState(1);
    expect(state.economy.shopLocked).toBe(false);
  });

  it('可以锁定和解锁', () => {
    const state = createGameState(1);
    doToggleShopLock(state);
    expect(state.economy.shopLocked).toBe(true);
    doToggleShopLock(state);
    expect(state.economy.shopLocked).toBe(false);
  });

  it('★ 回合结束会自动刷新商店', () => {
    const state = createGameState(777);
    const before = shopSignature(state);
    advanceRound(state, true);
    expect(shopSignature(state)).not.toBe(before);
    expect(state.economy.shopLocked).toBe(false);
  });

  it('★ 锁定的商店，回合结束不会刷新（这是锁定的意义）', () => {
    const state = createGameState(777);
    doToggleShopLock(state);
    const locked = shopSignature(state);
    const result = advanceRound(state, true);

    expect(shopSignature(state)).toBe(locked);
    expect(result.shopRefreshed).toBe(false);
  });

  it('自动刷新是免费的（不会扣钱）', () => {
    const state = createGameState(555);
    state.economy.gold = 10;
    state.round = 3; // 躲开野怪回合的掉落（第 1 回合是野怪回合）
    advanceRound(state, true);
    // 基础收入 10 + 利息 1（10 金） = 11，扣掉刷新的 2 金就只剩 9 ——
    // 所以金币必须是 21 才对（不能是 19）
    expect(state.economy.gold, '基础 10 + 利息 1 = 11，自动刷新不该扣那 2 金').toBe(
      10 + INCOME_BASE + 1,
    );
  });

  it('手动刷新会解除锁定（既然换了一批，锁就没意义了）', () => {
    const state = createGameState(3);
    doToggleShopLock(state);
    expect(state.economy.shopLocked).toBe(true);
    doRefreshShop(state);
    expect(state.economy.shopLocked).toBe(false);
  });

  it('刷新的商店不会留下「已售出」的格子', () => {
    const state = createGameState(8);
    state.economy.gold = 9999;
    doBuyShopSlot(state, 0);
    expect(state.economy.shop[0]!.sold).toBe(true);
    doRefreshShop(state);
    for (const slot of state.economy.shop) {
      expect(slot.sold).toBe(false);
    }
  });
});

describe('拖动放置（movePlacement）', () => {
  /** 造一个「场上已经摆好两个棋子」的状态 */
  function stateWithTwoOnBoard(): { state: GameState; a: Cell; b: Cell } {
    const state = createGameState(31);
    state.economy.gold = 9999;
    state.economy.level = 5;

    doBuyShopSlot(state, 0);
    selectBench(state, state.economy.bench[0]!.uid);
    const a = ownCell(0, 1);
    placeSelected(state, a);

    doRefreshShop(state);
    doBuyShopSlot(state, 0);
    selectBench(state, state.economy.bench[0]!.uid);
    const b = ownCell(0, 3);
    placeSelected(state, b);

    return { state, a, b };
  }

  it('拖到空格子：直接移过去，棋子数量不变', () => {
    const { state, a } = stateWithTwoOnBoard();
    const target = ownCell(3, 2);
    const unit = placementAt(state, a)!;

    const result = movePlacement(state, a, target);
    expect(result.ok).toBe(true);
    expect(state.placements).toHaveLength(2);
    // 原格子空了，新格子上是同一个棋子
    expect(placementAt(state, a)).toBeUndefined();
    expect(placementAt(state, target)?.uid).toBe(unit.uid);
  });

  it('★ 拖到有棋子的格子：交换位置（不是拒绝）', () => {
    const { state, a, b } = stateWithTwoOnBoard();
    const unitA = placementAt(state, a)!;
    const unitB = placementAt(state, b)!;
    expect(unitA.uid).not.toBe(unitB.uid);

    const result = movePlacement(state, a, b);
    expect(result.ok).toBe(true);
    expect(result.message).toContain('交换');
    // 两边互换，数量不变
    expect(placementAt(state, a)?.uid).toBe(unitB.uid);
    expect(placementAt(state, b)?.uid).toBe(unitA.uid);
    expect(state.placements).toHaveLength(2);
  });

  it('不能拖到对方半场', () => {
    const { state, a } = stateWithTwoOnBoard();
    const result = movePlacement(state, a, someEnemyCell());
    expect(result.ok).toBe(false);
    expect(result.message).toContain('左半边');
  });

  it('拖到原地等于没动，给出提示', () => {
    const { state, a } = stateWithTwoOnBoard();
    const result = movePlacement(state, a, a);
    expect(result.ok).toBe(false);
    expect(result.message).toContain('没有移动');
  });

  it('拖一个空格子会提示而不是崩溃', () => {
    const { state } = stateWithTwoOnBoard();
    const result = movePlacement(state, ownCell(4, 4), ownCell(0, 0));
    expect(result.ok).toBe(false);
    expect(result.message).toContain('空的');
  });

  it('战斗进行中不能移动', () => {
    const { state, a } = stateWithTwoOnBoard();
    state.phase = 'battle';
    const result = movePlacement(state, a, ownCell(2, 2));
    expect(result.ok).toBe(false);
  });

  it('交换不会改变羁绊统计（只是换位置）', () => {
    const { state, a, b } = stateWithTwoOnBoard();
    const before = currentTraits(state)
      .map((t) => `${t.traitId}:${t.count}`)
      .join(',');
    movePlacement(state, a, b);
    const after = currentTraits(state)
      .map((t) => `${t.traitId}:${t.count}`)
      .join(',');
    expect(after).toBe(before);
  });
});

describe('鼠标拾取的坐标换算（视口与渲染必须一致）', () => {
  // 模拟「顶部 52px、底部 190px 被 UI 遮住」的常见情形
  const canvasW = 1600;
  const canvasH = 900;
  const viewport = { x: 200, y: 190, width: 1200, height: 658 };

  it('视口正中心换算成 (0, 0)', () => {
    // 视口中心：x = 200 + 600, y（左下角原点）= 190 + 329
    const ndc = pointerToNdc(200 + 600, canvasH - (190 + 329), canvasH, viewport);
    expect(ndc.x).toBeCloseTo(0, 5);
    expect(ndc.y).toBeCloseTo(0, 5);
  });

  it('视口四角换算成 ±1', () => {
    // 左上角（CSS 左上角原点）
    const topLeft = pointerToNdc(200, canvasH - (190 + 658), canvasH, viewport);
    expect(topLeft.x).toBeCloseTo(-1, 5);
    expect(topLeft.y).toBeCloseTo(1, 5);

    // 右下角
    const bottomRight = pointerToNdc(200 + 1200, canvasH - 190, canvasH, viewport);
    expect(bottomRight.x).toBeCloseTo(1, 5);
    expect(bottomRight.y).toBeCloseTo(-1, 5);
  });

  it('★ 必须按视口算，不能按整个画布算（这是点击偏移的根因）', () => {
    // 注意：不能拿「画布正中心」当测试点 —— 视口中心恰好也在画布中心附近，
    // 两种算法都会算出 (0,0)，测不出区别。
    // 所以要用几个明显偏离中心的点。
    const points: Array<[number, number]> = [
      [300, 200],
      [1200, 700],
      [1350, 300],
      [500, 800],
    ];

    // 「错误的做法」：把整个画布当成视口
    const wrongViewport = { x: 0, y: 0, width: canvasW, height: canvasH };

    for (const [clickX, clickY] of points) {
      const correct = pointerToNdc(clickX, clickY, canvasH, viewport);
      const wrong = pointerToNdc(clickX, clickY, canvasH, wrongViewport);

      // 两种算法必须给出不同结果，差值就是视口位移造成的偏移
      const dx = Math.abs(correct.x - wrong.x);
      const dy = Math.abs(correct.y - wrong.y);
      expect(
        dx > 0.02 || dy > 0.02,
        `点 (${clickX},${clickY}) 两种算法结果太接近，测不出偏移`,
      ).toBe(true);
    }
  });

  it('视口高度只影响竖直方向，宽度只影响水平方向', () => {
    const base = pointerToNdc(900, 400, canvasH, viewport);
    const tallerViewport = pointerToNdc(900, 400, canvasH, {
      ...viewport,
      height: viewport.height - 100,
    });
    // 水平方向不该变
    expect(tallerViewport.x).toBeCloseTo(base.x, 5);
    // 竖直方向会变
    expect(tallerViewport.y).not.toBeCloseTo(base.y, 3);
  });

  it('视口尺寸为 0 时不会算出 NaN（防御性）', () => {
    const ndc = pointerToNdc(100, 100, canvasH, { x: 0, y: 0, width: 0, height: 0 });
    expect(Number.isFinite(ndc.x)).toBe(true);
    expect(Number.isFinite(ndc.y)).toBe(true);
  });
});

/**
 * 「我赢了没有」和「该不该自己推进回合」。
 *
 * 【为什么这两条要单独测？】
 * 它们都是**联机时才暴露**的 bug，而且症状和真正的原因离得很远：
 *   · 输赢文案反了 -> 你会先怀疑"是不是战斗算反了"（战斗其实是对的）
 *   · 莫名回到单机 -> 你会以为"掉线了"（连接其实一直好的）
 * 共同点是同一个错误：**把"队伍 0"当成"我方"**。
 * 单机里玩家永远是队伍 0，所以这两条怎么看都是对的 ——
 * 一到联机被分到右边，立刻就错。
 */
describe('★ 联机视角：我赢了没有 / 该不该自己推进回合', () => {
  it('★ 我在队伍 0：谁赢就是谁赢', () => {
    expect(didIWin(0, 0)).toBe(true);
    expect(didIWin(1, 0)).toBe(false);
    expect(didIWin(null, 0)).toBeNull();
  });

  it('★ 我在队伍 1：输赢必须反过来（这里原来写死了队伍 0）', () => {
    // 服务器判队伍 1 赢 -> 那就是**我**赢
    expect(didIWin(1, 1)).toBe(true);
    // 服务器判队伍 0 赢 -> 那就是我输
    expect(didIWin(0, 1)).toBe(false);
    expect(didIWin(null, 1)).toBeNull();
  });

  it('★ 联机时客户端永远不自己推进回合（哪怕这一局已经打完）', () => {
    const base = { hp: 100, phase: 'result' as const, onGameView: true };
    // 对局进行中
    expect(shouldClientAdvanceRound({ ...base, netplay: true })).toBe(false);
    // 这一局已经打完了 —— 这条最关键：原来这里会返回 true，
    // 于是客户端自己开了一局单机、冒出人机阵容
    expect(shouldClientAdvanceRound({ ...base, netplay: true })).toBe(false);
  });

  it('单机：战斗播完、还在游戏界面、血量没空 -> 该进下一回合', () => {
    expect(
      shouldClientAdvanceRound({ netplay: false, hp: 100, phase: 'result', onGameView: true }),
    ).toBe(true);
  });

  it('单机：这几个情况下都不能推进', () => {
    const single = { netplay: false, onGameView: true };
    // 还在打
    expect(shouldClientAdvanceRound({ ...single, hp: 100, phase: 'battle' })).toBe(false);
    // 还在布阵
    expect(shouldClientAdvanceRound({ ...single, hp: 100, phase: 'prep' })).toBe(false);
    // 血打空了（这局结束）
    expect(shouldClientAdvanceRound({ ...single, hp: 0, phase: 'result' })).toBe(false);
    // 已经回主界面了
    expect(
      shouldClientAdvanceRound({ netplay: false, hp: 100, phase: 'result', onGameView: false }),
    ).toBe(false);
  });
});

/**
 * ★★ 0.1.2 末修：用户报的"战斗回合结束后不会结束、不会正常切回合"。
 *
 * 【根因】"回放播完该不该收尾"这条判断，把联机的口径（必须是在看自己那场）
 * 直接套到了单机上 —— 而 `viewingBattleId` 只有联机的 battleStart 才会赋值，
 * 单机 / 测试沙盒里恒为 null ⇒ 永远不收尾 ⇒ 战斗播完卡在战斗画面、
 * `phase` 一直是 battle、回合永远不推进。
 *
 * 【为什么要单独测这个纯函数？】因为这条判断踩了**两次**相反的坑：
 *   0.1.1：谁播完都收尾 → 旁观别人时拿别人的战果收了自己的尾；
 *   0.1.2：只认"在看自己那场" → 单机永远收不了尾。
 * 抽出来钉住，就不会再修一次错一次。
 */
describe('★ 回放播完了该不该收尾（单机 vs 联机）', () => {
  it('★ 单机 / 测试沙盒：播完就是自己那场，必须收尾（不然回合永远不推进）', () => {
    expect(
      shouldFinishBattle({
        replayFinished: true,
        netplay: false,
        viewingBattleId: null, // 单机恒为 null —— 就是这一条以前把收尾挡死了
        currentBattleId: null,
      }),
    ).toBe(true);
  });

  it('联机：正在看自己那场 -> 收尾', () => {
    expect(
      shouldFinishBattle({
        replayFinished: true,
        netplay: true,
        viewingBattleId: 'battle-7',
        currentBattleId: 'battle-7',
      }),
    ).toBe(true);
  });

  it('联机：在看别人的战斗 -> 绝不能收尾（否则日志/横幅串成别人的）', () => {
    expect(
      shouldFinishBattle({
        replayFinished: true,
        netplay: true,
        viewingBattleId: 'battle-9',
        currentBattleId: 'battle-7',
      }),
    ).toBe(false);
    // 连"自己那场是哪个"都不知道（id 还没赋值）时也不能收
    expect(
      shouldFinishBattle({
        replayFinished: true,
        netplay: true,
        viewingBattleId: null,
        currentBattleId: 'battle-7',
      }),
    ).toBe(false);
  });

  it('还没播完 -> 谁都不收尾', () => {
    expect(
      shouldFinishBattle({ replayFinished: false, netplay: false, viewingBattleId: null, currentBattleId: null }),
    ).toBe(false);
    expect(
      shouldFinishBattle({
        replayFinished: false,
        netplay: true,
        viewingBattleId: 'battle-7',
        currentBattleId: 'battle-7',
      }),
    ).toBe(false);
  });
});

/**
 * 「打输了本地扣多少血」。
 *
 * 【为什么这条规则值得单独测？】
 * 因为它修的是一个**一局扣两倍血**的 bug：
 * 联机时血量由服务器决定（`battleEnd` 已经发过来了），
 * 而客户端的战斗演出会晚十几秒才结束 ——
 * 那时候再按同样规则扣一次，两个人打几回合就会"莫名其妙被打空血"结束。
 * 症状看起来像"对局进行不下去"，很难联想到"血扣了两次"。
 */
describe('★ 打输了本地扣多少血（联机不能扣）', () => {
  it('★ 联机时永远是 0（血量以服务器为准）', () => {
    for (const winner of [0, 1, null] as const) {
      for (const round of [1, 5, 12, 30]) {
        expect(
          localHpLossForRound({ winner, round, netplay: true }),
          `联机第 ${round} 回合、winner=${winner} 时不该本地扣血`,
        ).toBe(0);
      }
    }
  });

  it('★ 单机输了要扣血，赢了和平局都不扣', () => {
    expect(localHpLossForRound({ winner: 1, round: 1, netplay: false })).toBe(3);
    expect(localHpLossForRound({ winner: 0, round: 1, netplay: false })).toBe(0);
    expect(localHpLossForRound({ winner: null, round: 1, netplay: false })).toBe(0);
  });

  /*
    ★ 扣血公式和服务器**共用一个函数**（`damageForRound`）。
    以前这里又抄了一遍，两处一旦不同步就是"联机扣 3 滴、单机扣 2 滴"。
    所以这里不只测数值，还特意断言"客户端算出来的 = shared 里的公式算出来的"。
  */
  it('★ 单机的扣血必须和服务器用同一条公式（不能各写一份）', () => {
    for (let round = 1; round <= 40; round++) {
      expect(
        localHpLossForRound({ winner: 1, round, netplay: false }),
        `第 ${round} 回合：客户端和 shared 里的 damageForRound 不一致`,
      ).toBe(damageForRound(round));
    }
  });

  it('越到后期扣得越多（每 5 回合多 3 滴）', () => {
    const loss = (round: number): number => localHpLossForRound({ winner: 1, round, netplay: false });
    expect(loss(1)).toBe(3);
    expect(loss(5)).toBe(3);
    expect(loss(6)).toBe(6);
    expect(loss(10)).toBe(6);
    expect(loss(11)).toBe(9);
    expect(loss(20)).toBe(12);
  });
});

// ============================================================
//  ★ 0.1.1：野怪回合不计入连胜 / 连败
// ============================================================
describe('★ 0.1.1：野怪回合的胜负不计入连胜 / 连败', () => {
  /** 造一个"正在结算第 round 回合"的状态 */
  function stateAtRound(round: number, streak: number): GameState {
    const state = createGameState(round * 7 + 1);
    state.round = round;
    state.economy.streak = streak;
    return state;
  }

  it('野怪回合赢了：连胜层数**保持原值**（不加）', () => {
    const state = stateAtRound(1, 3); // 第 1 回合就是野怪回合
    expect(isMonsterRound(1), '前提：第 1 回合是野怪回合').toBe(true);
    advanceRound(state, true);
    expect(state.economy.streak, '打赢野怪不该白赚一层连胜').toBe(3);
  });

  it('野怪回合输了：连胜**不清零**、也不转成连败', () => {
    const state = stateAtRound(1, 4);
    advanceRound(state, false);
    expect(state.economy.streak, '被野怪打输不该把攒的连胜搭进去').toBe(4);

    // 连败那边同理：别把连败洗成 1
    const losing = stateAtRound(1, -3);
    advanceRound(losing, true);
    expect(losing.economy.streak, '打赢野怪不该清掉连败进度').toBe(-3);
  });

  it('野怪回合的下一场真人对战：层数在原值上继续累积', () => {
    const state = stateAtRound(1, 2);
    advanceRound(state, true); // 野怪回合：不动
    expect(state.economy.streak).toBe(2);

    // 跳到第 3 回合（真人对战），赢一场 -> 2 -> 3
    state.round = 3;
    expect(isMonsterRound(3), '前提：第 3 回合不是野怪回合').toBe(false);
    advanceRound(state, true);
    expect(state.economy.streak, '真人对战要照常累加').toBe(3);
  });

  it('真人对战输一场：连胜清零转连败（这条没变）', () => {
    const state = stateAtRound(3, 5);
    advanceRound(state, false);
    expect(state.economy.streak).toBe(-1);
  });

  it('野怪回合照常发钱（只是连胜奖励按原层数算，不受这一场影响）', () => {
    const state = stateAtRound(1, 2);
    const before = state.economy.gold;
    const result = advanceRound(state, true);
    expect(result.gold, '该发的钱一分不少').toBeGreaterThan(0);
    expect(state.economy.gold).toBeGreaterThan(before);
  });
});
