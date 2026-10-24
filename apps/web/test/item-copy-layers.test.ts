/**
 * ============================================================
 *  ★ 0.2 用户报的三件事 —— 状态层回归
 * ============================================================
 *
 * 【一、商店回合关掉商店之后，棋盘应该是"能用的"】
 * 用户口径：商店回合期间要和布阵阶段**一样正常** —— 能上牌、能收棋、
 * 能装藏品、能卸藏品。以前这里写死 `phase === 'prep'`，于是关掉商店界面后
 * 棋盘整块"点了没反应"，玩家只能干等这 90 秒。
 *
 * 【二、同名叠层藏品要"各叠各的"】
 * 以前层数按**藏品 id** 记（`inventory.growth[itemId]`），所以两件同名藏品
 * 共享同一个层数：只涨一份、卸一件另一件也跟着跳。
 * 现在层数住在**副本**上（`items[i] ↔ itemLayers[i]`）。
 *
 * 【三、被剑锤加过价的干员，卖出要按"购买价"退】
 * 带着剑锤买 3 费干员花 5 金，卖的时候只退 3 金 —— 那 2 金凭空没了。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ITEM_DEFS,
  UNIT_DEFS,
  resolveWearerItems,
  type SkillStats,
} from '../../../packages/shared/src/index.js';
import {
  applyItemGrowthAfterBattle,
  canEditTeam,
  createGameState,
  doBuyShopSlot,
  doSellBench,
  equipItemToUnit,
  equipSharedItem,
  grantModifierItem,
  swapItemsInZone,
  grantModifierUnit,
  placeBenchUnitAt,
  recallFromBoard,
  shopPriceDelta,
  switchMode,
  unequipItemFromUnit,
  type GameState,
} from '../src/game/state.js';

/** 造一个"已经在测试模式里"的状态（修改器可用） */
function testState(seed = 20261017): GameState {
  const state = switchMode(createGameState(seed)).next;
  /*
    ★ 测试模式默认"金币无限"（每次改状态都会把金币顶满）——
    涉及买卖的用例必须关掉它，否则账永远是 999999、根本测不出加减。
  */
  state.infiniteGold = false;
  return state;
}

/** 最便宜的那个真实干员（名单会换，别写死名字） */
const CHEAP = Object.values(UNIT_DEFS)
  .filter((def) => !def.monsterOnly && !def.summonOnly && !def.noStar)
  .sort((a, b) => a.cost - b.cost)[0]!;

/**
 * 藏品栏里第一件"有货"的格子下标。
 * ★ 不能假设是 0：`addItem` 会塞进**第一个空格**，装走一件之后
 * 第二件的下标就不是 0 了（测试里踩过：传入空格 = 静默失败）。
 */
function firstSlot(list: Array<string | null>): number {
  return list.findIndex((id) => id !== null);
}

/** 一件 A 类叠层藏品（按击杀 +1 层） */
const GROWTH_A = 'itm_grudge_list';
/** 一件 B 类叠层藏品（战斗结束概率 +1 层） */
const GROWTH_B = 'itm_pebble_altar';

describe('★ 一、商店回合：关掉商店之后棋盘照样能用', () => {
  it('★ 唯一判据 canEditTeam：布阵 + 商店回合都算"能改阵容"', () => {
    expect(canEditTeam('prep')).toBe(true);
    expect(canEditTeam('shop')).toBe(true);
    // 战斗 / 结算里有一场仗正在播，改阵容会让画面和参战名单对不上 —— 仍然不许
    expect(canEditTeam('battle')).toBe(false);
    expect(canEditTeam('result')).toBe(false);
  });

  it('★ 商店回合里能上阵、能收回、能装/卸藏品（用户报的那条）', () => {
    const state = testState();
    state.phase = 'shop';
    grantModifierUnit(state, CHEAP.id, 2);
    grantModifierItem(state, GROWTH_A);

    const uid = state.economy.bench[0]!.uid;
    const placed = placeBenchUnitAt(state, uid, { col: 0, row: 0 });
    expect(placed.ok, placed.message).toBe(true);
    expect(state.placements.length).toBe(1);

    const equipped = equipItemToUnit(state, 0, uid);
    expect(equipped.ok, equipped.message).toBe(true);
    expect(state.placements[0]!.items).toEqual([GROWTH_A]);

    const off = unequipItemFromUnit(state, uid, 0);
    expect(off.ok, off.message).toBe(true);

    const recalled = recallFromBoard(state, { col: 0, row: 0 });
    expect(recalled.ok, recalled.message).toBe(true);
    expect(state.placements.length).toBe(0);
  });

  it('★ 同一批操作在战斗阶段仍然被拦住（没有顺手把限制删掉）', () => {
    const state = testState();
    state.phase = 'battle';
    grantModifierUnit(state, CHEAP.id, 2);
    const uid = state.economy.bench[0]!.uid;
    expect(placeBenchUnitAt(state, uid, { col: 0, row: 0 }).ok).toBe(false);
  });
});

describe('★ 二、同名叠层藏品：各叠各的（不再共享一份层数）', () => {
  /** 两件同名 A 类藏品，分别装到两个干员身上 */
  function twoCopiesOnTwoUnits(): GameState {
    const state = testState();
    grantModifierUnit(state, CHEAP.id, 2);
    grantModifierUnit(state, CHEAP.id, 2);
    grantModifierItem(state, GROWTH_A);
    grantModifierItem(state, GROWTH_A);
    const firstEquip = equipItemToUnit(state, firstSlot(state.items.aSlots), state.economy.bench[0]!.uid);
    const secondEquip = equipItemToUnit(state, firstSlot(state.items.aSlots), state.economy.bench[1]!.uid);
    // 装备失败会让后面的断言变得莫名其妙 —— 这里直接钉死"两件都装上去了"
    expect(firstEquip.ok, firstEquip.message).toBe(true);
    expect(secondEquip.ok, secondEquip.message).toBe(true);
    return state;
  }

  it('★★ 两件同名藏品各记一份层数：一件被卸下重置，另一件原样留着', () => {
    const state = twoCopiesOnTwoUnits();
    const first = state.economy.bench[0]!;
    const second = state.economy.bench[1]!;

    // 打 3 场、每场击倒 2 个 —— 两件都该各自涨到 6 层
    for (let i = 0; i < 3; i++) {
      applyItemGrowthAfterBattle(state, { won: true, kills: 2, round: 5 });
    }
    expect(first.itemLayers, '第一件自己叠层').toEqual([6]);
    expect(second.itemLayers, '第二件也自己叠层').toEqual([6]);

    // ★ 关键：卸下第一件（层数随这一件消失），第二件必须**一点不动**
    const off = unequipItemFromUnit(state, first.uid, 0);
    expect(off.ok, off.message).toBe(true);
    expect(first.itemLayers ?? []).toEqual([]);
    expect(second.itemLayers, '卸一件不许影响另一件').toEqual([6]);

    // 重新装上 = 从 0 层开始（设计稿："装备卸下后层数重新叠加"）
    equipItemToUnit(state, firstSlot(state.items.aSlots), first.uid);
    expect(first.itemLayers, '重新装上要从 0 层开始').toEqual([0]);
  });

  it('★ 一件藏品涨层不会把另一件的层数"顺带抬上去"', () => {
    const state = twoCopiesOnTwoUnits();
    const first = state.economy.bench[0]!;
    const second = state.economy.bench[1]!;

    applyItemGrowthAfterBattle(state, { won: true, kills: 4, round: 5 });
    expect(first.itemLayers).toEqual([4]);
    expect(second.itemLayers).toEqual([4]);

    // 只留第一件（把第二件卸下），再打一场：只有第一件涨
    unequipItemFromUnit(state, second.uid, 0);
    applyItemGrowthAfterBattle(state, { won: true, kills: 1, round: 5 });
    expect(first.itemLayers).toEqual([5]);
    expect(second.itemLayers ?? []).toEqual([]);
  });

  it('★ 共享装备位里的两件同名藏品也是各叠各的', () => {
    const state = testState();
    grantModifierItem(state, GROWTH_B);
    grantModifierItem(state, GROWTH_B);
    expect(equipSharedItem(state, firstSlot(state.items.bSlots), 0).ok).toBe(true);
    expect(equipSharedItem(state, firstSlot(state.items.bSlots), 1).ok).toBe(true);
    expect(state.items.bEquip.filter(Boolean).length, '两格都该装上').toBe(2);

    // 概率藏品没法保证涨 —— 直接给两格写不同的层数，验证它们**不会互相覆盖**
    state.items.bEquipLayers = [7, 2];
    applyItemGrowthAfterBattle(state, { won: true, kills: 0, round: 5 });
    // battle 来源是 3.25% 概率，一场基本不动；重点是两格仍然是各自独立的两个数
    expect(state.items.bEquipLayers.length).toBe(state.items.bEquip.length);
    expect(state.items.bEquipLayers[0]).toBeGreaterThanOrEqual(7);
    expect(state.items.bEquipLayers[1]).toBeGreaterThanOrEqual(2);
  });

  it('★ 共享装备位里"挪位置"，层数要跟着藏品一起走（不能留在原来的格子）', () => {
    const state = testState();
    grantModifierItem(state, GROWTH_B);
    grantModifierItem(state, 'itm_live_rose');
    equipSharedItem(state, firstSlot(state.items.bSlots), 0);
    equipSharedItem(state, firstSlot(state.items.bSlots), 1);
    state.items.bEquipLayers = [7, 0];

    const moved = swapItemsInZone(state, 'bequip', 0, 1);
    expect(moved.ok, moved.message).toBe(true);
    // 7 层那件挪到第 2 格，层数也得跟过去（数组按 4 个共享装备位对齐，空格是 0）
    expect(state.items.bEquipLayers.slice(0, 2)).toEqual([0, 7]);
  });

  it('★★ 内核按"副本"取层数 —— 两件同款传两份不同的层数，属性各按各的算', () => {
    const def = UNIT_DEFS[CHEAP.id]!;
    const zeroLayers = resolveWearerItems(def, [GROWTH_A], undefined, [0]);
    const tenLayers = resolveWearerItems(def, [GROWTH_A], undefined, [10]);

    // 每层的加成包只该按各自层数出现一次
    const findLayerPack = (effects: { statsList: SkillStats[] }) =>
      effects.statsList.find((stats) => (stats.attackDamageBp ?? 0) === 1000);
    expect(findLayerPack(zeroLayers), '0 层不该有每层加成').toBeUndefined();
    expect(findLayerPack(tenLayers), '10 层 = 每层 100bp × 10').toBeTruthy();

    // 两件同名不同层：只有 5 层那件出每层包
    const mixed = resolveWearerItems(def, [GROWTH_A, GROWTH_A], undefined, [0, 5]);
    const packs = mixed.statsList.filter((stats) => (stats['attackDamageBp'] ?? 0) === 500);
    expect(packs.length, '第二件 5 层、第一件 0 层').toBe(1);
  });
});

describe('★ 三、剑锤加过价的干员：卖出按购买价返还', () => {
  it('★★ 买的时候多付 2 金，卖的时候也多退 2 金', () => {
    const state = testState();
    state.economy.gold = 100;
    expect(ITEM_DEFS['itm_sword_hammer']).toBeTruthy();
    grantModifierItem(state, 'itm_sword_hammer');
    const on = equipSharedItem(state, firstSlot(state.items.bSlots), 0);
    expect(on.ok, on.message).toBe(true);
    expect(shopPriceDelta(state), '剑锤让购买干员 +2 花费').toBe(2);

    // 商店里放一张确定能买的牌
    state.economy.shop[0] = { defId: CHEAP.id, cost: CHEAP.cost, sold: false };
    const before = state.economy.gold;
    const bought = doBuyShopSlot(state, 0);
    expect(bought.ok, bought.message).toBe(true);
    expect(state.economy.gold, '扣的是面板价 + 2').toBe(before - CHEAP.cost - 2);

    const unit = state.economy.bench[state.economy.bench.length - 1]!;
    expect(state.paidCostDelta[unit.uid], '加价要记账').toBe(2);

    const goldBeforeSell = state.economy.gold;
    const sold = doSellBench(state, unit.uid);
    expect(sold.ok, sold.message).toBe(true);
    expect(state.economy.gold, '返还 = 面板价 + 当时多付的 2').toBe(goldBeforeSell + CHEAP.cost + 2);
    expect(state.paidCostDelta[unit.uid], '卖掉之后记账要清掉').toBeUndefined();
  });

  it('★ 三个 1 星合成 2 星：多付的 3 份要一起带到合出来的那只身上', () => {
    const state = testState();
    state.economy.gold = 200;
    grantModifierItem(state, 'itm_sword_hammer');
    equipSharedItem(state, firstSlot(state.items.bSlots), 0);

    for (let i = 0; i < 3; i++) {
      state.economy.shop[i] = { defId: CHEAP.id, cost: CHEAP.cost, sold: false };
    }
    for (let i = 0; i < 3; i++) {
      const result = doBuyShopSlot(state, i);
      expect(result.ok, result.message).toBe(true);
    }
    // 3 张同名会自动合成 1 只 2 星
    const merged = state.economy.bench.find((unit) => unit.defId === CHEAP.id && unit.star === 2);
    expect(merged, '三张 1 星应该合成了').toBeTruthy();
    expect(state.paidCostDelta[merged!.uid], '2 星 = 3 张 × 2 金加价').toBe(6);

    const goldBeforeSell = state.economy.gold;
    doSellBench(state, merged!.uid);
    expect(state.economy.gold, '2 星原价 3 份 + 3 份加价').toBe(
      goldBeforeSell + CHEAP.cost * 3 + 6,
    );
  });
});

describe('★ 四、防回归：新字段不许漏在"提交白名单"里', () => {
  /*
    【这条为什么是源码级的？】
    这个项目**踩过三次**同一个坑：`items` / `bench` / `itemState.bag` 都是在
    "服务端只挑了几个字段存下来"那一层被静默丢掉的 —— 客户端有、服务端没有，
    于是联机时的效果和单机不一样，而且**不报错**。
    `sharedItemLayers` 是 0.2 新加的第四个同类字段，所以直接钉住它出现在白名单里。

    ★ `units` 上的 `itemLayers` 不需要单独查：那一整块是**原样透传**的
      （`units = Array.isArray(message.units) ? message.units : []`），
      所以它天然跟着走 —— 只有 `sharedItemLayers` 是自己一个字段，必须手动放行。
  */
  it('★★ 服务端的 submitTeam 白名单里必须有 sharedItemLayers', () => {
    const source = readFileSync(
      new URL('../../../packages/server/src/main.ts', import.meta.url),
      'utf8',
    );
    expect(source.includes('sharedItemLayers'), '漏了这一行 = 联机里两件同款共享藏品会退回共享层数').toBe(
      true,
    );
  });

  it('★★ 服务端组阵容时要把它交给内核（否则校验和必炸）', () => {
    const source = readFileSync(
      new URL('../../../packages/server/src/room.ts', import.meta.url),
      'utf8',
    );
    expect(source.includes('sharedItemLayers')).toBe(true);
  });
});
