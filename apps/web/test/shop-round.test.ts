/**
 * ============================================================
 *  ★★ 0.2 商店回合（野怪回合之后的 90 秒限时商店）
 * ============================================================
 *
 * 【这一组守的规则】（用户 2026-10-17 拍板）
 *   · 出现在**野怪回合之后**，第 1、2 回合不算 ⇒ 实际是 9 / 16 / 23 / 30 …
 *   · **不计入回合数**（`state.round` 不因它变化）
 *   · **独立阶段**，持续 **90 秒**，到点自动收摊回布阵
 *   · 弹窗**默认开**、可自由开关；金币上方有开关按钮（只在商店回合出现）
 *   · 8 个货架 = 4 普通 + 2 进阶（**不含转职**）+ 1 干员 + 1 转职
 *   · 干员位**直接卖 2 星**，价格 = 3 × 费用（= 合成成本），
 *     而且**牌库不够 3 张就不卖**（不能凭空印牌）
 *   · 买价 8 / 16 / 12，卖价 = 买价一半 = 4 / 8 / 6
 *   · 刷新 4 / 8 / 12 / 16（第 4 次起都是 16），**次数只增不减**
 *   · 售卖页只列**没装备**的藏品（a / b 两个存放区；bequip 是装备位，不能卖）
 *
 * 【为什么价格/时长这些常量也要测？】
 * 因为它们是玩家能直接看见的三张价目表（货架、卖出、刷新）。
 * 改价只改 `shop-round.ts` 那一张表，测试和界面读的是同一份 ——
 * 钉住它们，就不会出现"界面写 8 金、扣 16 金"那种两处走散。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ITEM_DEFS, RELIC_ITEM_OF_TRAIT, UNIT_DEFS, isMonsterRound } from '../../../packages/shared/src/index.js';
import {
  SHOP_BUY_PRICE,
  SHOP_SELL_PRICE,
  SHOP_SLOT_LIMITS,
  SHOP_ROUND_SECONDS,
  OPERATOR_SLOT_COPIES,
  OPERATOR_SLOT_STAR,
  SHOP_POOLS,
  isItemSlot,
  isShopRoundAfter,
  rerollPriceOf,
  rollShopRoundSlots,
  sellPriceOfItem,
  shopItemWeightOf,
} from '../src/game/shop-round.js';
import {
  advanceRound,
  addItem,
  buyShopRoundSlot,
  closeShopRound,
  createGameState,
  doBuyShopSlot,
  doBuyXp,
  doRefreshShop,
  doSellBench,
  doToggleShopLock,
  enterPrepPhase,
  enterShopRound,
  equipSharedItem,
  rerollShopRound,
  sellShopRoundItem,
  sellableShopRoundItems,
  setShopRoundMode,
  shopBlockedByElimination,
  shopRoundActive,
  shopRoundRerollPrice,
  shopRoundUsable,
  tickShopRound,
  toggleShopRoundOpen,
  type GameState,
} from '../src/game/state.js';
import { isConsumedOnEquip } from '../src/game/items.js';

/** 一个能开商店的状态（金币给够，免得被"钱不够"挡住） */
function fresh(gold = 999): GameState {
  const state = createGameState(20261017);
  state.economy.gold = gold;
  return state;
}

/** 随便一件普通 / 进阶 / 转职藏品 */
const SOME_NORMAL = SHOP_POOLS.normal[0]!.id;
const SOME_ADVANCED = SHOP_POOLS.advanced[0]!.id;
const SOME_RELIC = SHOP_POOLS.traitRelic[0]!.id;

// ============================================================
//  出现时机
// ============================================================

describe('商店回合的出现时机', () => {
  it('★ 野怪回合才可能有商店回合（普通回合没有）', () => {
    for (const round of [3, 4, 5, 6, 7, 8, 10, 11]) {
      expect(isMonsterRound(round)).toBe(false);
      expect(isShopRoundAfter(round)).toBe(false);
    }
  });

  /**
   * 用户口径「在野怪回合后（1.2 层不算）出现」。
   * 野怪回合 = 1、2、9、16、23…，扣掉 1 和 2 ⇒ 9 起。
   */
  it('★★ 第 1、2 个野怪回合不算（1 / 2 之后没有商店）', () => {
    expect(isMonsterRound(1)).toBe(true);
    expect(isMonsterRound(2)).toBe(true);
    expect(isShopRoundAfter(1)).toBe(false);
    expect(isShopRoundAfter(2)).toBe(false);
  });

  it('★ 第 9、16、23 之后都有', () => {
    for (const round of [9, 16, 23, 30, 37, 44]) {
      expect(isShopRoundAfter(round)).toBe(true);
    }
  });

  /**
   * ★★ "不计入回合数" 是最容易写错的一条：
   * 只要有人在商店结束时 `state.round++`，整局的野怪节奏、成长曲线、
   * 连胜连败就全错位一格 —— 而且错得很隐蔽（只是"该出野怪的那回合没出"）。
   */
  it('★★ 打完第 9 回合进商店，回合号照常 +1 到 10（商店不占回合数）', () => {
    const state = fresh();
    state.round = 9;
    state.phase = 'result';
    advanceRound(state, true, new Set(), 0);
    expect(state.round).toBe(10);
    expect(state.phase).toBe('shop');
    expect(state.shopRound).not.toBeNull();
  });
});

// ============================================================
//  价目表
// ============================================================

describe('价目表', () => {
  it('★ 买价：普通 8 / 进阶 16 / 转职 12', () => {
    expect(SHOP_BUY_PRICE).toEqual({ normal: 8, advanced: 16, traitRelic: 12 });
  });

  it('★★ 卖价 = 买价的一半：普通 4 / 进阶 8 / 转职 6', () => {
    expect(SHOP_SELL_PRICE).toEqual({ normal: 4, advanced: 8, traitRelic: 6 });
    for (const key of ['normal', 'advanced', 'traitRelic'] as const) {
      expect(SHOP_SELL_PRICE[key]).toBe(SHOP_BUY_PRICE[key] / 2);
    }
  });

  it('★★ 刷新 4 / 8 / 12 / 16，第 4 次起**封顶** 16（不会无限涨）', () => {
    expect(rerollPriceOf(0)).toBe(4);
    expect(rerollPriceOf(1)).toBe(8);
    expect(rerollPriceOf(2)).toBe(12);
    expect(rerollPriceOf(3)).toBe(16);
    expect(rerollPriceOf(4)).toBe(16);
    expect(rerollPriceOf(50)).toBe(16);
  });

  it('★ 按稀有度定价（普通 / 进阶 / 转职各走各的价）', () => {
    expect(sellPriceOfItem(SOME_NORMAL)).toBe(SHOP_SELL_PRICE.normal);
    expect(sellPriceOfItem(SOME_ADVANCED)).toBe(SHOP_SELL_PRICE.advanced);
    expect(sellPriceOfItem(SOME_RELIC)).toBe(SHOP_SELL_PRICE.traitRelic);
  });
});

// ============================================================
//  货架
// ============================================================

describe('货架生成', () => {
  it('★★ 8 格：4 普通 + 2 进阶 + 1 干员 + 1 转职，**顺序固定**', () => {
    const slots = rollShopRoundSlots(5, () => 7, () => 99);
    expect(slots).toHaveLength(SHOP_SLOT_LIMITS.normal + SHOP_SLOT_LIMITS.advanced + 2);
    expect(slots.map((slot) => slot.kind)).toEqual([
      'normal',
      'normal',
      'normal',
      'normal',
      'advanced',
      'advanced',
      'operator',
      'traitRelic',
    ]);
  });

  /**
   * ★★ 用户口径「进阶藏品槽位（**不包含转职藏品**）」。
   * 转职藏品自己单独占一格（而且更便宜），塞进进阶池的话
   * 玩家会看到"同样是进阶，一个 16 一个 12"，像定价错了。
   */
  it('★★ 进阶池**不含**转职藏品（18 件 itm_relic_* 都被排除）', () => {
    const relicIds = new Set(Object.values(RELIC_ITEM_OF_TRAIT));
    expect(relicIds.size).toBeGreaterThan(0);
    for (const item of SHOP_POOLS.advanced) {
      expect(relicIds.has(item.id)).toBe(false);
    }
    // 转职池正好就是那 18 件
    expect(SHOP_POOLS.traitRelic.map((item) => item.id).sort()).toEqual([...relicIds].sort());
  });

  it('★ 同一批货架里**不重复**（抽过的不回池）', () => {
    // 用一个递增的随机源，保证每次取的下标都不一样
    let n = 0;
    const slots = rollShopRoundSlots(5, () => n++, () => 99);
    const itemIds = slots.filter(isItemSlot).map((slot) => slot.itemId);
    expect(new Set(itemIds).size).toBe(itemIds.length);
  });

  it('★ 藏品位的价格跟着档位走', () => {
    const slots = rollShopRoundSlots(5, () => 3, () => 99);
    for (const slot of slots) {
      if (slot.kind === 'operator') continue;
      expect(slot.price).toBe(SHOP_BUY_PRICE[slot.kind]);
    }
  });

  /**
   * ★★ 用户口径「出现的卡牌**直接是 2 星**，价格为 2 星卡牌相应价值」。
   * 2 星 = 3 张 1 星 ⇒ 价格 = 3 × 费用。写成"费用"的话等于白送 2 张。
   */
  it('★★ 干员位：2 星、价格 = 3 × 费用', () => {
    const slots = rollShopRoundSlots(5, () => 11, () => 99);
    const operator = slots.find((slot) => slot.kind === 'operator')!;
    expect(operator.star).toBe(OPERATOR_SLOT_STAR);
    const cost = UNIT_DEFS[operator.defId!]!.cost;
    expect(operator.price).toBe(cost * OPERATOR_SLOT_COPIES);
  });

  /**
   * ★★ 用户口径「不会出现牌库已经不够的牌」。
   * 全库都不够 3 张时宁可**空着这一格**，也不卖一张印出来的卡 ——
   * 那会让同一只干员的总张数超过牌库，8 人联机时就是"凭空多出一只三星"。
   */
  it('★★ 牌库不够 3 张 → 干员位空着（绝不超发）', () => {
    const slots = rollShopRoundSlots(5, () => 5, () => 0);
    const operator = slots.find((slot) => slot.kind === 'operator')!;
    expect(operator.defId).toBeUndefined();
    expect(operator.sold).toBe(true);
    expect(operator.price).toBe(0);
  });

  it('★ 只剩某个费用档够 3 张时，就只从那个档里出（不会掷到空档变"无货"）', () => {
    // 只放行 op01（1 费）
    const slots = rollShopRoundSlots(1, () => 1, (defId) => (defId === 'op01' ? 9 : 0));
    const operator = slots.find((slot) => slot.kind === 'operator')!;
    expect(operator.defId).toBe('op01');
    expect(operator.price).toBe(UNIT_DEFS['op01']!.cost * OPERATOR_SLOT_COPIES);
  });
});

// ============================================================
//  阶段 / 倒计时
// ============================================================

describe('商店回合的阶段与倒计时', () => {
  it('★ 开张：默认打开、购买页、90 秒、8 格货架', () => {
    const state = fresh();
    enterShopRound(state);
    expect(state.phase).toBe('shop');
    expect(state.shopRound).toMatchObject({ open: true, mode: 'buy', secondsLeft: SHOP_ROUND_SECONDS });
    expect(state.shopRound!.slots).toHaveLength(8);
    expect(SHOP_ROUND_SECONDS).toBe(90);
  });

  it('★ 弹窗可自由开关', () => {
    const state = fresh();
    enterShopRound(state);
    toggleShopRoundOpen(state);
    expect(state.shopRound!.open).toBe(false);
    toggleShopRoundOpen(state);
    expect(state.shopRound!.open).toBe(true);
  });

  it('★ 买 / 卖 页签可切', () => {
    const state = fresh();
    enterShopRound(state);
    setShopRoundMode(state, 'sell');
    expect(state.shopRound!.mode).toBe('sell');
    setShopRoundMode(state, 'buy');
    expect(state.shopRound!.mode).toBe('buy');
  });

  /**
   * ★★ `enterPrepPhase` 存在的理由（也是这一条在守的东西）：
   * 单机 `nextRound` 和联机 `gameStarted` 都会在 `advanceRound` 之后
   * 习惯性地写 `state.phase = 'prep'` —— 一写就把刚开的商店**当场抹掉**，
   * 表现是"打完野怪什么都没发生"。所以那条赋值必须走这个 helper。
   */
  it('★★ 商店还开着时，enterPrepPhase **不**把它抹回 prep', () => {
    const state = fresh();
    enterShopRound(state);
    enterPrepPhase(state);
    expect(state.phase).toBe('shop');
    // 商店结束后就正常回 prep 了
    state.shopRound = null;
    enterPrepPhase(state);
    expect(state.phase).toBe('prep');
  });

  it('★ 倒计时到点自动收摊，回到布阵', () => {
    const state = fresh();
    enterShopRound(state);
    expect(tickShopRound(state, 30)).toBe(null);
    expect(state.phase).toBe('shop');
    expect(tickShopRound(state, 60)).toBe('timed-out');
    expect(state.phase).toBe('prep');
    expect(state.shopRound).toBeNull();
  });

  /**
   * ★★ 联机里服务器**不知道**本地开着商店，到点就直接开下一场战斗
   * （客户端 phase 被顶成 battle）。这时候必须收摊：
   * 不收的话 `state.shopRound` 永远留着，90 秒倒计时还在后台偷偷跑，
   * 下一次再进商店就会叠上第二份。
   */
  it('★★ 被别的事顶掉（联机开下一场）→ 收摊，且报的是 interrupted（不弹"打烊"）', () => {
    const state = fresh();
    enterShopRound(state);
    state.phase = 'battle';
    expect(tickShopRound(state, 0)).toBe('interrupted');
    expect(state.shopRound).toBeNull();
  });

  /**
   * ★★ 用户口径「买完就能走」—— 提前收摊。
   * 联机里它只关**我自己**这张商店（服务端那 90 秒是全房间同步的阶段），
   * 所以这里断言的是"本地收摊、阶段回 prep"，而不是"服务端的阶段变了"。
   */
  it('★★ 点「结束商店」能提前收摊（不用干等剩下的秒数）', () => {
    const state = fresh();
    enterShopRound(state);
    expect(state.phase).toBe('shop');
    closeShopRound(state);
    expect(state.shopRound).toBeNull();
    expect(state.phase).toBe('prep');
    // 收摊之后买卖都要停掉（不能"关了弹窗还能买"）
    expect(buyShopRoundSlot(state, 0).ok).toBe(false);
  });

  it('★ 没开商店时点收摊什么都不做（不会误把布阵抹掉）', () => {
    const state = fresh();
    state.phase = 'prep';
    closeShopRound(state);
    expect(state.phase).toBe('prep');
    expect(state.shopRound).toBeNull();
  });

  /**
   * ★ 倒计时是**每帧**推进的（`tickShopRound` 由主循环每帧调）。
   * 曾经把秒数只写在 `renderAll()` 里（那只在事件发生时跑）⇒
   * 用户报的 bug「商店开关按钮上的倒计时不动」。
   */
  it('★ 倒计时按**帧**推进（0.5 秒 × 60 帧 = 30 秒），不是按事件', () => {
    const state = fresh();
    enterShopRound(state);
    for (let i = 0; i < 60; i++) tickShopRound(state, 0.5);
    expect(state.shopRound!.secondsLeft).toBeCloseTo(SHOP_ROUND_SECONDS - 30, 5);
  });

  /**
   * ★★ 联机：本地**不许**自己往下数（秒数以服务端推的为准）。
   * 传 0 的时候倒计时必须一动不动 —— 但"被打断就收摊"那道闸门照样生效。
   */
  it('★★ 联机（步长 0）：倒计时不动，但被打断照样收摊', () => {
    const state = fresh();
    enterShopRound(state);
    for (let i = 0; i < 200; i++) expect(tickShopRound(state, 0)).toBe(null);
    expect(state.shopRound!.secondsLeft).toBe(SHOP_ROUND_SECONDS);
    state.phase = 'battle';
    expect(tickShopRound(state, 0)).toBe('interrupted');
  });

  it('★ 没有商店时 tick 什么都不做', () => {
    const state = fresh();
    expect(tickShopRound(state, 1)).toBe(null);
    expect(state.phase).toBe('prep');
  });
});

// ============================================================
//  买
// ============================================================

describe('买', () => {
  it('★ 买一件普通藏品：扣 8 金、进藏品栏、这一格标成已售', () => {
    const state = fresh(20);
    enterShopRound(state);
    const index = state.shopRound!.slots.findIndex((slot) => slot.kind === 'normal');
    const itemId = state.shopRound!.slots[index]!.itemId!;

    expect(buyShopRoundSlot(state, index).ok).toBe(true);
    expect(state.economy.gold).toBe(20 - SHOP_BUY_PRICE.normal);
    expect(state.shopRound!.slots[index]!.sold).toBe(true);
    // 真的进了藏品栏（a 或 b 的存放区）
    const zones = [...state.items.aSlots, ...state.items.bSlots];
    expect(zones).toContain(itemId);
  });

  it('★ 钱不够买不了，且**不扣钱**、不进包', () => {
    const state = fresh(3);
    enterShopRound(state);
    const index = state.shopRound!.slots.findIndex((slot) => slot.kind === 'normal');
    const result = buyShopRoundSlot(state, index);
    expect(result.ok).toBe(false);
    expect(state.economy.gold).toBe(3);
    expect(state.shopRound!.slots[index]!.sold).toBe(false);
  });

  it('★ 同一格不能买两次', () => {
    const state = fresh(99);
    enterShopRound(state);
    const index = state.shopRound!.slots.findIndex((slot) => slot.kind === 'normal');
    expect(buyShopRoundSlot(state, index).ok).toBe(true);
    expect(buyShopRoundSlot(state, index).ok).toBe(false);
  });

  /**
   * ★★ 干员位 = 一次买 3 张、直接合成 2 星进备战席。
   * 这一条最容易写错成"塞 3 张一星"：那样备战席会被瞬间塞满 3 格，
   * 玩家买一张卡就把席子顶爆。
   */
  it('★★ 买干员位：备战席多**一个** 2 星棋子（不是 3 个 1 星）', () => {
    const state = fresh(99);
    enterShopRound(state);
    const index = state.shopRound!.slots.findIndex(
      (slot) => slot.kind === 'operator' && slot.defId,
    );
    const slot = state.shopRound!.slots[index]!;
    const before = state.economy.bench.length;

    expect(buyShopRoundSlot(state, index).ok).toBe(true);
    expect(state.economy.bench.length).toBe(before + 1);
    const bought = state.economy.bench[state.economy.bench.length - 1]!;
    expect(bought.defId).toBe(slot.defId);
    expect(bought.star).toBe(OPERATOR_SLOT_STAR);
    expect(state.economy.gold).toBe(99 - slot.price);
  });

  it('★ 不在商店回合买不了', () => {
    const state = fresh(99);
    expect(buyShopRoundSlot(state, 0).ok).toBe(false);
  });

  /**
   * ★★ 刷新次数**只增不减**：买走两格再刷新不能降价。
   * 否则玩家可以靠"买空再刷"绕过涨价，4 金无限刷。
   */
  it('★★ 刷新 4 → 8 → 12 → 16（次数只增不减）', () => {
    const state = fresh(200);
    enterShopRound(state);
    expect(shopRoundRerollPrice(state)).toBe(4);
    rerollShopRound(state);
    expect(state.economy.gold).toBe(200 - 4);
    expect(shopRoundRerollPrice(state)).toBe(8);
    rerollShopRound(state);
    expect(shopRoundRerollPrice(state)).toBe(12);
    rerollShopRound(state);
    expect(shopRoundRerollPrice(state)).toBe(16);
    expect(state.economy.gold).toBe(200 - (4 + 8 + 12));
  });

  it('★ 钱不够刷新不了，且不扣钱、不加次数', () => {
    const state = fresh(1);
    enterShopRound(state);
    expect(rerollShopRound(state).ok).toBe(false);
    expect(state.economy.gold).toBe(1);
    expect(state.shopRound!.rerolls).toBe(0);
  });

  it('★ 刷新之后货架还是 8 格（不会因为洗牌洗少了）', () => {
    const state = fresh(99);
    enterShopRound(state);
    rerollShopRound(state);
    expect(state.shopRound!.slots).toHaveLength(8);
  });
});

// ============================================================
//  卖
// ============================================================

describe('卖', () => {
  it('★★ 只列**没装备**的藏品（a / b 存放区）', () => {
    const state = fresh();
    enterShopRound(state);
    addItem(state, SOME_NORMAL);
    addItem(state, SOME_ADVANCED);
    const listed = sellableShopRoundItems(state).map((entry) => entry.itemId);
    expect(listed).toContain(SOME_NORMAL);
    expect(listed).toContain(SOME_ADVANCED);
    // 全部来自存放区，没有一个来自装备位
    for (const entry of sellableShopRoundItems(state)) {
      expect(entry.zone === 'a' || entry.zone === 'b').toBe(true);
    }
  });

  /**
   * ★★ 用户口径「**不包括已经装备的藏品**」。
   * 装进 bequip 的那一件正在全队生效，卖了等于凭空抽掉一条加成 ——
   * 而且界面上它还在效果栏里显示着，玩家会对不上账。
   */
  it('★★ 装备中的共享藏品（bequip）不在可卖列表里', () => {
    const state = fresh();
    enterShopRound(state);
    /*
      ★ 只有 B 类（共享）藏品能进共享装备位；slot 是数据里的 'A' / 'B'。
      ★ 还要**排除"装上即销毁"的那几件**（人事部铜印之类）——
        它们装上之后本体就没了，测出来的"不在列表里"是销毁造成的，
        不是"装备中不能卖"造成的，这条断言就假了。
    */
    const sharedItem = [...SHOP_POOLS.advanced, ...SHOP_POOLS.normal].find(
      (item) => item.slot === 'B' && !isConsumedOnEquip(item),
    );
    expect(sharedItem).toBeTruthy();

    addItem(state, sharedItem!.id);
    const entry = sellableShopRoundItems(state).find((item) => item.itemId === sharedItem!.id)!;
    expect(entry.zone).toBe('b');

    // 装进共享装备位
    expect(equipSharedItem(state, entry.index, 0).ok).toBe(true);
    expect(state.items.bEquip[0]).toBe(sharedItem!.id);

    /*
      装上去之后：它**不在** a / b 存放区了（搬到 bequip 了），
      所以可卖列表里既不该有它、也不该出现 bequip 里的任何一格。
    */
    const after = sellableShopRoundItems(state);
    expect(after.map((item) => item.itemId)).not.toContain(sharedItem!.id);
    for (const item of after) expect(item.zone).not.toBe('bequip');
  });

  it('★ 卖掉：按价给钱、藏品从栏里消失', () => {
    const state = fresh(0);
    enterShopRound(state);
    addItem(state, SOME_NORMAL);
    const entry = sellableShopRoundItems(state).find((item) => item.itemId === SOME_NORMAL)!;

    expect(sellShopRoundItem(state, entry.zone, entry.index).ok).toBe(true);
    expect(state.economy.gold).toBe(SHOP_SELL_PRICE.normal);
    expect([...state.items.aSlots, ...state.items.bSlots]).not.toContain(SOME_NORMAL);
  });

  it('★ 转职藏品按 6 金卖', () => {
    const state = fresh(0);
    enterShopRound(state);
    addItem(state, SOME_RELIC);
    const entry = sellableShopRoundItems(state).find((item) => item.itemId === SOME_RELIC)!;
    expect(entry.price).toBe(SHOP_SELL_PRICE.traitRelic);
    expect(sellShopRoundItem(state, entry.zone, entry.index).ok).toBe(true);
    expect(state.economy.gold).toBe(SHOP_SELL_PRICE.traitRelic);
  });

  it('★ 空格子卖不了', () => {
    const state = fresh();
    enterShopRound(state);
    const empty = [...state.items.aSlots].findIndex((slot) => !slot);
    expect(sellShopRoundItem(state, 'a', empty).ok).toBe(false);
    expect(state.economy.gold).toBe(999);
  });

  it('★ 不在商店回合卖不了', () => {
    const state = fresh();
    addItem(state, SOME_NORMAL);
    const entry = sellableShopRoundItems(state)[0]!;
    expect(sellShopRoundItem(state, entry.zone, entry.index).ok).toBe(false);
  });
});

// ============================================================
//  数据自检（别让池子悄悄变空）
// ============================================================

describe('池子自检', () => {
  it('★ 三个池子都**够铺满**对应格数（不然货架会出现空格）', () => {
    expect(SHOP_POOLS.normal.length).toBeGreaterThanOrEqual(SHOP_SLOT_LIMITS.normal);
    expect(SHOP_POOLS.advanced.length).toBeGreaterThanOrEqual(SHOP_SLOT_LIMITS.advanced);
    expect(SHOP_POOLS.traitRelic.length).toBeGreaterThanOrEqual(SHOP_SLOT_LIMITS.traitRelic);
  });

  it('★ 池子里每一件都在 ITEM_DEFS 里（不然界面只能画个 ?）', () => {
    for (const item of [...SHOP_POOLS.normal, ...SHOP_POOLS.advanced, ...SHOP_POOLS.traitRelic]) {
      expect(ITEM_DEFS[item.id]).toBeTruthy();
    }
  });
});

/**
 * ★★ 0.2（用户 2026-10-17）：失落之钥的出场规则
 *   「改为只能出现在本局的第一次商店；购买后该玩家不能再次刷出和获得」。
 *
 * 这里钉两件事：
 *   1. 不给 `allowLostKey` 时**永远**刷不出来（"默认不出"是最安全的默认值）；
 *   2. 第一次商店允许、第二次商店起不允许；买过（`permanent.lostKey`）之后一律不允许。
 */
describe('★★ 失落之钥：只在第一次商店出现、买过就再也不出', () => {
  const LOST_KEY = 'itm_lost_key';
  const hasLostKey = (slots: ReturnType<typeof rollShopRoundSlots>): boolean =>
    slots.some((slot) => slot.kind === 'advanced' && slot.itemId === LOST_KEY);

  it('★ 默认（不传 allowLostKey）：300 次货架一次都不出', () => {
    for (let i = 0; i < 300; i++) {
      expect(hasLostKey(rollShopRoundSlots(9, () => i * 7919 + 1, () => 99))).toBe(false);
    }
  });

  it('★ 显式 allowLostKey：能刷出来（说明池子里确实有它，不是被永久删了）', () => {
    let seen = 0;
    for (let i = 0; i < 400; i++) {
      if (hasLostKey(rollShopRoundSlots(9, () => i * 104729 + 1, () => 99, { allowLostKey: true }))) seen++;
    }
    expect(seen).toBeGreaterThan(0);
  });

  it('★ enterShopRound：第一次 firstOfGame=true、第二次 false（计数也在走）', () => {
    const state = createGameState(2026);
    state.economy.level = 9;
    enterShopRound(state);
    expect(state.shopRound!.firstOfGame, '本局第一次商店').toBe(true);
    expect(state.shopRoundCount).toBe(1);
    closeShopRound(state);
    enterShopRound(state);
    expect(state.shopRound!.firstOfGame, '第二次商店就不是"第一次"了').toBe(false);
    expect(state.shopRoundCount).toBe(2);
  });

  it('★ 重连兜底：回合已经过了 9（本地计数被重置成 0）也不当成"第一次商店"', () => {
    const state = createGameState(2026);
    state.round = 16;
    state.shopRoundCount = 0; // 模拟"重连重建了 state"
    enterShopRound(state);
    expect(state.shopRound!.firstOfGame, '回合都到 16 了，第一次商店早过了').toBe(false);
  });

  it('★ 买过之后：第一次商店里反复刷新也刷不出来', () => {
    const state = createGameState(2026);
    state.economy.level = 9;
    state.items.permanent.lostKey = true; // 已经买过
    enterShopRound(state);
    state.economy.gold = 999_999;
    let seen = hasLostKey(state.shopRound!.slots);
    for (let i = 0; i < 80; i++) {
      rerollShopRound(state);
      seen = seen || hasLostKey(state.shopRound!.slots);
    }
    expect(seen, '"不能再次刷出"：80 次刷新都不该出现').toBe(false);
  });

  it('★ 第一次商店期间刷新：仍然允许出现（只是"过了第一次商店"才彻底没有）', () => {
    const state = createGameState(2026);
    state.economy.level = 9;
    enterShopRound(state);
    state.economy.gold = 999_999;
    let seen = hasLostKey(state.shopRound!.slots);
    for (let i = 0; i < 80 && !seen; i++) {
      rerollShopRound(state);
      seen = hasLostKey(state.shopRound!.slots);
    }
    expect(seen, '第一次商店内该有机会刷到').toBe(true);
  });
});

/**
 * ★★ 0.2（用户 2026-10-17）：「降低变形同构体在商店刷出来的概率，大概降 40%」
 *
 * 落法是**权重**（默认 100，它 60），所以这里量的是"出现率"：
 *   等概率时：2 个进阶位 / 16 件 ⇒ 每次商店至少见到它 ≈ 12.5%
 *   降 40% 后：≈ 7.5%（不是 7.5% 就说明权重没生效 / 手滑改成删除了）
 */
describe('★★ 变形同构体：商店出现率降约 40%', () => {
  /** 确定性 LCG（测试里不能用 Math.random，否则结论不可复现） */
  function lcg(seed: number): () => number {
    let value = seed >>> 0;
    return () => {
      value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
      return value;
    };
  }

  it('权重表：变形同构体 60、其余 100（40% = 60/100）', () => {
    expect(shopItemWeightOf('itm_morph_relic')).toBe(60);
    expect(shopItemWeightOf('itm_old_fan')).toBe(100);
    expect(shopItemWeightOf('不存在的藏品')).toBe(100);
  });

  it('★ 实测出现率明显低于等概率（约 12.5% -> 7.5%）', () => {
    const random = lcg(20261017);
    const SHOPS = 4000;
    let seen = 0;
    for (let i = 0; i < SHOPS; i++) {
      const slots = rollShopRoundSlots(9, random, () => 99);
      if (slots.some((slot) => slot.kind === 'advanced' && slot.itemId === 'itm_morph_relic')) seen++;
    }
    const rate = seen / SHOPS;
    /*
      等概率的参照值：进阶位 2 个 / 池子 N 件（默认货架不会出失落之钥，记得减 1）
      ⇒ 每次商店至少见到它的概率 ≈ 2 / N。
      权重 60（其余 100）之后应该落在它的 0.4~0.85 倍之间（= 降 15%~60%，目标 -40%）。
    */
    const poolSize = SHOP_POOLS.advanced.filter((item) => item.id !== 'itm_lost_key').length;
    const uniform = Math.min(1, 2 / poolSize);
    expect(rate, '该比等概率低').toBeLessThan(uniform * 0.85);
    expect(rate, '也不能低到像被删掉了').toBeGreaterThan(uniform * 0.4);
  });
});

// ============================================================
//  ★★ 0.2.1：淘汰之后商店整块关闭（用户报的严重 bug）
// ============================================================

describe('★★ 淘汰的玩家不能用商店', () => {
  /*
    【用户口径（2026-10-17）】「淘汰后的人也能使用商店，修改为淘汰的人不能使用商店，
    商店不会对淘汰的人开放」。

    【为什么会漏】
    淘汰时服务端已经把他的牌**全部还回共享牌库**（`Room.returnCardsToPool`）。
    0.1.1 起 `main.ts` 有一个 `eliminatedMe`，但它只用于隐藏**常规商店那一排按钮**；
    0.2 新增的「商店回合」（`#shop-round-overlay`）是另一套界面，读不到那个变量 ——
    于是淘汰的人照样能开弹窗、买 2 星干员、卖藏品。
    他再买 = 同一张牌被卖给第二个人 ⇒ 牌库超发。

    【修法】状态位搬进 `GameState.meEliminated`，判据收成一个
    `shopBlockedByElimination()`；**所有**商店入口（常规 5 格 / 刷新 / 锁定 /
    买经验 / 卖棋子 / 商店回合的买·卖·刷新·切页·开关）都过它。
    这一组就是逐个入口钉一遍。
  */

  it('判据本身：meEliminated = true 时商店回合对我不可用', () => {
    const state = fresh();
    enterShopRound(state);
    expect(shopRoundActive(state), '全局事实：商店回合开着').toBe(true);
    expect(shopRoundUsable(state), '我还活着 -> 能进').toBe(true);

    state.meEliminated = true;
    expect(shopRoundActive(state), '全局事实不因我被淘汰而改变').toBe(true);
    expect(shopRoundUsable(state), '★ 但对我关闭').toBe(false);
    expect(shopBlockedByElimination(state)?.message).toContain('你已被淘汰');
  });

  it('商店回合：买 / 刷新 / 卖藏品 全被拒绝，且不扣钱不减货', () => {
    const state = fresh();
    enterShopRound(state);
    addItem(state, SOME_NORMAL);
    const sellEntry = sellableShopRoundItems(state).find((item) => item.itemId === SOME_NORMAL)!;
    state.meEliminated = true;

    const gold = state.economy.gold;
    const slotsBefore = JSON.stringify(state.shopRound!.slots);

    for (const index of [0, 1, 2, 3, 4, 5, 6, 7]) {
      const result = buyShopRoundSlot(state, index);
      expect(result.ok, `第 ${index} 格买不进去`).toBe(false);
      expect(result.message).toContain('你已被淘汰');
    }
    const reroll = rerollShopRound(state);
    expect(reroll.ok).toBe(false);
    expect(reroll.message).toContain('你已被淘汰');

    const sold = sellShopRoundItem(state, sellEntry.zone, sellEntry.index);
    expect(sold.ok).toBe(false);
    expect(sold.message).toContain('你已被淘汰');

    expect(state.economy.gold, '一分钱都不该动').toBe(gold);
    expect(JSON.stringify(state.shopRound!.slots), '货架一个字节都不该变').toBe(slotsBefore);
    expect(sellableShopRoundItems(state).some((item) => item.itemId === SOME_NORMAL), '藏品还在').toBe(true);
  });

  it('商店回合：弹窗打不开、页签切不了', () => {
    const state = fresh();
    enterShopRound(state);
    state.shopRound!.open = false;
    state.meEliminated = true;

    toggleShopRoundOpen(state);
    expect(state.shopRound!.open, '淘汰的人打不开弹窗').toBe(false);

    setShopRoundMode(state, 'sell');
    expect(state.shopRound!.mode, '也切不了页签').toBe('buy');
  });

  it('常规商店：刷新 / 锁定 / 买经验 / 买棋子 / 卖棋子 全被拒绝', () => {
    const state = fresh();
    state.meEliminated = true;
    const gold = state.economy.gold;
    const shopBefore = JSON.stringify(state.economy.shop);
    const lockBefore = state.economy.shopLocked;

    for (const [name, result] of [
      ['刷新', doRefreshShop(state)],
      ['锁定', doToggleShopLock(state)],
      ['买经验', doBuyXp(state)],
      ['买棋子', doBuyShopSlot(state, 0)],
      ['卖棋子', doSellBench(state, 1)],
    ] as const) {
      expect(result.ok, `${name}必须失败`).toBe(false);
      expect(result.message, `${name}的提示要说清原因`).toContain('你已被淘汰');
    }
    expect(state.economy.gold, '金币不能动').toBe(gold);
    expect(JSON.stringify(state.economy.shop), '货架不能变').toBe(shopBefore);
    expect(state.economy.shopLocked, '连锁定状态都不能翻').toBe(lockBefore);
  });

  it('负对照：没被淘汰时同样的调用都能过（不是把功能整个关掉了）', () => {
    const state = fresh();
    enterShopRound(state);
    expect(buyShopRoundSlot(state, 0).ok, '活着就能买').toBe(true);
    expect(rerollShopRound(state).ok, '活着就能刷新').toBe(true);
    expect(doRefreshShop(state).ok, '活着就能刷常规商店').toBe(true);
    expect(doBuyXp(state).ok, '活着就能买经验').toBe(true);
  });

  it('新的一局会把 meEliminated 复位（否则出局的人永远"死着"）', () => {
    const state = createGameState(20261017);
    expect(state.meEliminated, '开局默认活着').toBe(false);
    state.meEliminated = true;
    // 重建状态（= 开新的一局）后自然复位
    expect(createGameState(20261017).meEliminated).toBe(false);
  });
});

describe('★★ 0.2.1 界面层：淘汰闸门只允许一处', () => {
  const mainSrc = readFileSync(fileURLToPath(new URL('../src/main.ts', import.meta.url)), 'utf8');

  it('renderShopRound 必须读 shopRoundUsable（不是 shopRoundActive）', () => {
    /*
      这是那个 bug 的**准确位置**：0.2 的商店回合弹窗原来只判
      `shopRoundActive`（"这一回合的商店开着没有"），和"我能不能进"是两件事。
    */
    const start = mainSrc.indexOf('function renderShopRound(');
    expect(start, 'renderShopRound 要存在').toBeGreaterThan(-1);
    const fn = mainSrc.slice(start, mainSrc.indexOf('/** 购买页', start));
    expect(fn, '要读含淘汰判据的 shopRoundUsable').toContain('shopRoundUsable(state)');
    expect(fn, '不许再用只看阶段的 shopRoundActive').not.toContain('shopRoundActive(state)');
  });

  it('main.ts 不许再自己存一份"我被淘汰了"（唯一状态位在 state 上）', () => {
    expect(mainSrc, '模块变量已删').not.toContain('let eliminatedMe');
    expect(mainSrc, '一律读 state.meEliminated').toContain('state.meEliminated');
  });

  it('"能不能操作自己的东西"只有 spectateOrEliminated 一个实现', () => {
    expect(mainSrc, '判据函数要存在').toContain('function spectateOrEliminated(');
    // 三处消费：隐藏商店按钮 / 键盘快捷键（被 CSS 藏起来照样能 .click()）/ 画布拖动
    expect(
      [...mainSrc.matchAll(/spectateOrEliminated\(\)/g)].length,
      '至少被三处读取',
    ).toBeGreaterThanOrEqual(3);
    expect(
      [...mainSrc.matchAll(/viewingPlayerId !== null \|\| state\.meEliminated/g)].length,
      '这两个条件只能出现在 spectateOrEliminated 里（一处实现）',
    ).toBe(1);
  });
});
