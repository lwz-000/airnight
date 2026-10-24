/**
 * ============================================================
 *  藏品（装备）★ 0.0.3 —— 状态层回归
 * ============================================================
 *
 * 这份测试盯的是"用户给的界面规格"背后的**规则**，而不是界面本身：
 *   ① 三种格子：A 栏 10 格 / B 栏 5 格 / 共享装备位 4 格
 *   ② A 类拖到干员身上，每人最多 2 件
 *   ③ B 类拖到共享装备位，装满就交换；「立刻销毁」类当场结算不占位
 *   ④ 删除区：三种格子都能删
 *   ⑤ **只有在 A 栏有空格时**才能卸下（用户明确要求）
 *   ⑥ 装备跟着棋子走：上场 / 收回 / 合成 / 卖掉都不该丢
 *   ⑦ 派生数值：人口上限（地形图）、每回合收入（至宝指环 / 幸运硬币）、失落之钥
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  BENCH_SLOTS,
  ITEM_A_SLOTS,
  ITEM_B_EQUIP_SLOTS,
  ITEM_B_SLOTS,
  ITEM_DEFS,
  ITEM_PER_UNIT,
  ITEM_SLOT_LABEL,
  MAX_LEVEL,
  resolveSharedItems,
  // ★ 0.1.1：彩蛋角色屏蔽"升星/复制/变身"类藏品 —— 判据在 shared，测试直接用同一个
  EGG_UNIT_ID,
  isUnitTransformingItem,
  ITEM_SLOT_SHORT,
  RELIC_ITEM_OF_TRAIT,
  TRAIT_DEFS,
  UNIT_DEFS,
  morphCandidatesOf,
  battleGoldOf,
  itemEffectLines,
  itemEffectSummary,
  pickRecruit,
  playableDefs,
  poolCopiesOf,
  poolSizeOf,
  xpNeededForLevel,
  // ★ 0.3.2：盟约专属藏品必须被池子过滤掉
  NORMAL_ITEMS,
  ADVANCED_ITEMS,
  itemsOf,
  // ★ 0.3.31：玩家血量上限的唯一口径
  playerMaxHp,
  type BattleEvent,
} from '../../../packages/shared/src/index.js';
import {
  addItem,
  advanceRound,
  createGameState,
  currentTraits,
  deleteItem,
  doBuyShopSlot,
  doBuyXp,
  doSellBench,
  equipItemToUnit,
  equipSharedItem,
  grantModifierItem,
  grantModifierUnit,
  placeBenchUnitAt,
  // ★ 商店「已拥有 N」按张数折算
  countOwnedCopies,
  poolCopiesOfUnit,
  poolRemainingOf,
  popCap,
  recallFromBoard,
  toTeamSetup,
  toSubmittedTeam,
  unequipItemFromUnit,
  unequipSharedItem,
  // ★ 0.0.3 需求 4：同栏拖动 = 互换位置
  swapItemsInZone,
  switchMode,
  // ★ 0.1.1 藏品二版
  activeItemEffects,
  activeTraitCountOf,
  activeTraitIdsOf,
  applyItemGrowthAfterBattle,
  applyRecruitResult,
  enemiesKilledBy,
  expireUnsocketedItems,
  extraTraitsOf,
  itemGrowthGold,
  setNetPoolView,
  shopPriceDelta,
  shopPriceOf,
  traitRelicsOf,
  type GameState,
} from '../src/game/state.js';
import { countItems, zoneLabel } from '../src/game/items.js';

/** 造一个"已经在测试模式里"的状态（修改器可用） */
function testState(seed = 20261011): GameState {
  return switchMode(createGameState(seed)).next;
}

/** 名单会换，所以不能写死名字：取最便宜的那个真实干员 */
const DEF_ID = playableDefs().slice().sort((a, b) => a.cost - b.cost)[0]!.id;

/** 所有"装上去会留在身上"的 A 类藏品（排除立刻销毁的三件道具） */
const WORN_A_ITEMS = Object.values(ITEM_DEFS)
  .filter((item) => item.slot === 'A' && item.onEquip?.consume !== true)
  .map((item) => item.id);

/** 往备战席塞一个干员并返回它的 uid */
function grantOne(state: GameState, star = 1): number {
  state.economy.level = 10; // 别被人口拦住（这一堆用例都不测人口）
  expect(grantModifierUnit(state, DEF_ID, star).ok).toBe(true);
  return state.economy.bench[state.economy.bench.length - 1]!.uid;
}

// ============================================================
//  ① 三种格子的容量
// ============================================================

describe('★ 藏品栏结构', () => {
  it('A 类 10 格 / B 类 5 格 / 共享装备位 4 格（和界面规格一致）', () => {
    const state = createGameState(1);
    expect(state.items.aSlots.length).toBe(ITEM_A_SLOTS);
    expect(state.items.bSlots.length).toBe(ITEM_B_SLOTS);
    expect(state.items.bEquip.length).toBe(ITEM_B_EQUIP_SLOTS);
    expect(ITEM_A_SLOTS).toBe(10);
    expect(ITEM_B_SLOTS).toBe(5);
    expect(ITEM_B_EQUIP_SLOTS).toBe(4);
    expect(ITEM_PER_UNIT).toBe(2);
  });

  it('A 类进 A 栏、B 类进 B 栏（不会串栏）', () => {
    const state = createGameState(2);
    expect(addItem(state, 'itm_solvent').ok).toBe(true); // A 类
    expect(addItem(state, 'itm_treasure_ring').ok).toBe(true); // B 类
    expect(state.items.aSlots[0]).toBe('itm_solvent');
    expect(state.items.bSlots[0]).toBe('itm_treasure_ring');
    expect(state.items.bEquip.every((slot) => slot === null)).toBe(true);
  });

  it('A 栏满了就装不下了（不会挤掉别人的格子）', () => {
    const state = createGameState(3);
    const ids = WORN_A_ITEMS.slice(0, ITEM_A_SLOTS);
    for (const itemId of ids) expect(addItem(state, itemId).ok).toBe(true);
    const overflow = addItem(state, WORN_A_ITEMS[ITEM_A_SLOTS]!);
    expect(overflow.ok).toBe(false);
    expect(overflow.message).toContain('满了');
    expect(state.items.aSlots).toEqual(ids);
  });
});

// ============================================================
//  ② A 类：拖到干员身上，每人 2 件
// ============================================================

describe('★ A 类藏品：装在干员身上（每人 2 件）', () => {
  it('装备后从藏品栏消失、挂到干员身上', () => {
    const state = testState();
    const uid = grantOne(state);
    expect(addItem(state, 'itm_solvent').ok).toBe(true);
    expect(equipItemToUnit(state, 0, uid).ok).toBe(true);
    expect(state.items.aSlots[0]).toBeNull();
    expect(state.economy.bench.find((unit) => unit.uid === uid)!.items).toEqual(['itm_solvent']);
  });

  it('★ 第三件装不上去（每人最多 2 件）', () => {
    const state = testState();
    const uid = grantOne(state);
    for (const itemId of WORN_A_ITEMS.slice(0, 3)) addItem(state, itemId);

    expect(equipItemToUnit(state, 0, uid).ok).toBe(true);
    expect(equipItemToUnit(state, 1, uid).ok).toBe(true);
    const third = equipItemToUnit(state, 2, uid);
    expect(third.ok).toBe(false);
    expect(third.message).toContain(`${ITEM_PER_UNIT} 件`);
    // 装不上就**不能**把藏品吞掉
    expect(state.items.aSlots[2]).toBe(WORN_A_ITEMS[2]);
  });

  it('空格子拖上去没反应（不会报奇怪的错）', () => {
    const state = testState();
    const uid = grantOne(state);
    expect(equipItemToUnit(state, 0, uid).ok).toBe(false);
  });

  it('共享藏品拖到干员身上会被挡住（并告诉他该拖到哪）', () => {
    const state = testState();
    const uid = grantOne(state);
    expect(addItem(state, 'itm_treasure_ring').ok).toBe(true);
    const result = equipItemToUnit(state, 0, uid);
    expect(result.ok).toBe(false);
    expect(state.items.aSlots[0]).toBeNull();
    expect(state.economy.bench.find((unit) => unit.uid === uid)!.items).toBeUndefined();
  });

  it('★ 野怪不能穿戴装备（拖到野怪身上会被挡住）', () => {
    const state = testState();
    // 发一只野怪进备战席（和「获得干员」同一条路，所以这是唯一的野怪来源）
    expect(grantModifierUnit(state, 'mn_slime').ok).toBe(true);
    const uid = state.economy.bench[state.economy.bench.length - 1]!.uid;
    expect(addItem(state, 'itm_solvent').ok).toBe(true);

    const result = equipItemToUnit(state, 0, uid);
    expect(result.ok).toBe(false);
    expect(result.message).toContain('野怪');
    // 藏品没被吞、野怪身上也没多出东西
    expect(state.items.aSlots[0]).toBe('itm_solvent');
    expect(state.economy.bench.find((unit) => unit.uid === uid)!.items).toBeUndefined();
  });

  it('★ 有星级条件的藏品装错星级会被挡住（博士投影只能给 1 星）', () => {
    const state = testState();
    const uid = grantOne(state, 2); // 2 星
    expect(grantModifierItem(state, 'itm_doctor_projection').ok).toBe(true);

    const result = equipItemToUnit(state, 0, uid);
    expect(result.ok).toBe(false);
    expect(result.message).toContain('1~1 星');
    // ★ 关键：装失败了就不能"先结算再发现不行"（那样会白拿效果）
    expect(state.items.aSlots[0]).toBe('itm_doctor_projection');
    expect(state.economy.bench.find((unit) => unit.uid === uid)!.star).toBe(2);
  });

  it('博士投影：1 星干员装上升 2 星，并立刻销毁', () => {
    const state = testState();
    const uid = grantOne(state, 1);
    expect(grantModifierItem(state, 'itm_doctor_projection').ok).toBe(true);
    expect(equipItemToUnit(state, 0, uid).ok).toBe(true);
    expect(state.items.aSlots[0], '立刻销毁类不占格子').toBeNull();
    expect(state.economy.bench.find((unit) => unit.uid === uid)!.star).toBe(2);
  });

  it('★ 立刻销毁类**不占**装备位（消耗品不该挤掉两个装备格）', () => {
    const state = testState();
    const uid = grantOne(state, 1);
    // 先正常装两件
    for (const itemId of WORN_A_ITEMS.slice(0, 2)) addItem(state, itemId);
    expect(equipItemToUnit(state, 0, uid).ok).toBe(true);
    expect(equipItemToUnit(state, 1, uid).ok).toBe(true);
    expect(state.economy.bench.find((unit) => unit.uid === uid)!.items).toHaveLength(2);

    // 第三件是消耗品（突变细胞）—— 该能装
    // 注意：装完前两件之后 A 栏又空出来了，所以新藏品的格子下标要现查
    expect(grantModifierItem(state, 'itm_mutant_cell').ok).toBe(true);
    const slot = state.items.aSlots.indexOf('itm_mutant_cell');
    expect(slot, '它应该被放进 A 栏').toBeGreaterThanOrEqual(0);

    expect(equipItemToUnit(state, slot, uid).ok).toBe(true);
    expect(state.items.aSlots[slot]).toBeNull();
    expect(state.economy.bench.find((unit) => unit.uid === uid)!.items).toHaveLength(2);
  });

  it('拟态物质：复制一只同款一星干员，且**不占牌库**', () => {
    const state = testState();
    const uid = grantOne(state, 1);
    expect(grantModifierItem(state, 'itm_mimic_mass').ok).toBe(true);
    expect(equipItemToUnit(state, 0, uid).ok).toBe(true);

    const mine = state.economy.bench.filter((unit) => unit.defId === DEF_ID);
    expect(mine).toHaveLength(2);
    const clone = mine.find((unit) => unit.uid !== uid)!;
    expect(clone.star).toBe(1);
    expect(clone.free, '复制出来的干员不计入牌库').toBe(true);
    expect(state.items.aSlots[0], '用掉了就销毁').toBeNull();
  });

  it('★ 拟态物质在备战席满时会**先被拦住**（不会先销毁再发现放不下）', () => {
    const state = testState();
    const uid = grantOne(state, 1);
    // 把剩下 8 格填满（都用 3 星，免得被合成吃掉）
    while (state.economy.bench.length < 9) {
      state.economy.bench.push({ uid: 900000 + state.economy.bench.length, defId: DEF_ID, star: 3, free: true });
    }
    expect(grantModifierItem(state, 'itm_mimic_mass').ok).toBe(true);
    const result = equipItemToUnit(state, 0, uid);
    expect(result.ok).toBe(false);
    expect(result.message).toContain('备战席满');
    expect(state.items.aSlots[0], '被拦住就绝不能销毁').toBe('itm_mimic_mass');
  });

  it('突变细胞：变成同星级、高一费的干员（不会变成野怪）', () => {
    const state = testState();
    const uid = grantOne(state, 2);
    const before = playableDefs().find((def) => def.id === DEF_ID)!.cost;
    expect(grantModifierItem(state, 'itm_mutant_cell').ok).toBe(true);
    expect(equipItemToUnit(state, 0, uid).ok).toBe(true);

    const after = state.economy.bench.find((unit) => unit.uid === uid)!;
    expect(after.defId).not.toBe(DEF_ID);
    expect(after.star).toBe(2);
    const target = playableDefs().find((def) => def.id === after.defId);
    expect(target, '变成的必须是可玩干员（不是野怪 / 召唤物）').toBeDefined();
    expect(target!.cost).toBe(Math.min(5, before + 1));
  });
});

// ============================================================
//  ③ 卸下：只有在 A 栏有空格时才可以（用户明确要求）
// ============================================================

describe('★ 卸下 A 类藏品', () => {
  it('正常卸下：回到 A 栏第一个空格', () => {
    const state = testState();
    const uid = grantOne(state);
    addItem(state, 'itm_solvent');
    equipItemToUnit(state, 0, uid);
    expect(unequipItemFromUnit(state, uid, 0).ok).toBe(true);
    expect(state.items.aSlots[0]).toBe('itm_solvent');
    expect(state.economy.bench.find((unit) => unit.uid === uid)!.items).toBeUndefined();
  });

  it('★ A 栏满了就卸不下来（藏品总得有地方去）', () => {
    const state = testState();
    const uid = grantOne(state);
    addItem(state, 'itm_solvent');
    equipItemToUnit(state, 0, uid); // A 栏空出来一格

    // 把 10 格全填满
    const ids = WORN_A_ITEMS.slice(1, ITEM_A_SLOTS + 1);
    for (const itemId of ids) expect(addItem(state, itemId).ok).toBe(true);
    expect(countItems(state.items.aSlots)).toBe(ITEM_A_SLOTS);

    const result = unequipItemFromUnit(state, uid, 0);
    expect(result.ok).toBe(false);
    expect(result.message).toContain('穿戴藏品栏满了');
    expect(state.economy.bench.find((unit) => unit.uid === uid)!.items).toEqual(['itm_solvent']);
  });

  it('空装备位卸不下来', () => {
    const state = testState();
    const uid = grantOne(state);
    expect(unequipItemFromUnit(state, uid, 0).ok).toBe(false);
  });
});

// ============================================================
//  ④ B 类：共享装备位（4 格），装满就交换
// ============================================================

describe('★ B 类藏品：共享装备位', () => {
  it('装上去之后生效；来源格空出来', () => {
    const state = createGameState(4);
    addItem(state, 'itm_treasure_ring');
    expect(equipSharedItem(state, 0, 0).ok).toBe(true);
    expect(state.items.bEquip[0]).toBe('itm_treasure_ring');
    expect(state.items.bSlots[0]).toBeNull();
  });

  it('目标格有人就交换（和棋盘 / 备战席同一套语义）', () => {
    const state = createGameState(5);
    addItem(state, 'itm_treasure_ring');
    addItem(state, 'itm_medkit');
    expect(equipSharedItem(state, 0, 0).ok).toBe(true);
    expect(equipSharedItem(state, 1, 0).ok).toBe(true);
    expect(state.items.bEquip[0]).toBe('itm_medkit');
    expect(state.items.bSlots[1], '被换下来的回到来源格').toBe('itm_treasure_ring');
  });

  it('★「立刻销毁」类：当场结算，不占共享装备位', () => {
    const state = createGameState(6);
    const beforeGold = state.economy.gold;
    addItem(state, 'itm_old_coin'); // 古旧残币：销毁 + 10 金
    expect(equipSharedItem(state, 0, 0).ok).toBe(true);
    expect(state.economy.gold).toBe(beforeGold + 10);
    expect(state.items.bSlots[0]).toBeNull();
    expect(state.items.bEquip[0], '一次性道具不该占着共享位').toBeNull();
  });

  it('热水壶：+5 血 +5 金', () => {
    const state = createGameState(7);
    const gold = state.economy.gold;
    const hp = state.economy.hp;
    // ★ 先掉一点血 —— 满血时回血会被上限夹掉（见下面那条测试）
    state.economy.hp = hp - 20;
    addItem(state, 'itm_kettle');
    expect(equipSharedItem(state, 0, 0).ok).toBe(true);
    expect(state.economy.gold).toBe(gold + 5);
    expect(state.economy.hp).toBe(hp - 20 + 5);
  });

  /*
    ★★ 0.3.31（用户报"回血藏品有时候还是不生效，也可能是碰 100 壁了"）：
    以前藏品回血是 `hp += n`，**不夹上限** —— 单机里数字能涨到 105、130，
    联机里服务端一夹、下一次广播又被覆盖回来 ⇒ 玩家看到的是"装了完全没反应"。
    现在收敛到 `applyPlayerHeal` 一处，两边同一个口径：
      · 上限之内 ⇒ 正常回
      · 已经满血 ⇒ 回 0，并且提示写"血量已满"（不再谎报 +15）
      · 纯回血藏品满血时**直接拦下不销毁**（热水壶还给金币，所以放行）
  */
  it('★★ 满血时回血不会突破上限（和联机服务端同一个口径）', () => {
    const state = createGameState(7);
    const cap = playerMaxHp(state.economy.startHp, state.covenantId);
    state.economy.hp = cap;
    addItem(state, 'itm_kettle');
    expect(equipSharedItem(state, 0, 0).ok, '热水壶还带金币，满血也该能用').toBe(true);
    expect(state.economy.gold).toBeGreaterThan(0);
    expect(state.economy.hp, '满血时不该再往上叠').toBe(cap);
  });

  it('卸下共享藏品：回到 B 栏；B 栏满了就卸不下来', () => {
    const state = createGameState(8);
    addItem(state, 'itm_treasure_ring');
    equipSharedItem(state, 0, 0);
    expect(unequipSharedItem(state, 0).ok).toBe(true);
    expect(state.items.bSlots[0]).toBe('itm_treasure_ring');

    // 再装回去，然后把 B 栏 5 格填满 -> 卸不下来
    equipSharedItem(state, 0, 0);
    const fillers = Object.values(ITEM_DEFS).filter((item) => item.slot === 'B').map((item) => item.id);
    for (const itemId of fillers.slice(0, ITEM_B_SLOTS)) addItem(state, itemId);
    expect(countItems(state.items.bSlots)).toBe(ITEM_B_SLOTS);
    const blocked = unequipSharedItem(state, 0);
    expect(blocked.ok).toBe(false);
    expect(blocked.message).toContain('共享藏品栏满了');
  });
});

// ============================================================
//  ⑤ 删除区
// ============================================================

describe('★ 删除藏品', () => {
  it('三种格子都能删；空格子删不动', () => {
    const state = createGameState(9);
    addItem(state, 'itm_solvent'); // A 栏
    addItem(state, 'itm_treasure_ring'); // B 栏
    state.items.bEquip[0] = 'itm_medkit'; // 直接摆一个到共享格（模拟已装备）

    expect(deleteItem(state, 'a', 0).ok).toBe(true);
    expect(state.items.aSlots[0]).toBeNull();
    expect(deleteItem(state, 'b', 0).ok).toBe(true);
    expect(deleteItem(state, 'bequip', 0).ok).toBe(true);
    expect(state.items.bEquip[0]).toBeNull();

    expect(deleteItem(state, 'a', 0).ok).toBe(false);
    expect(deleteItem(state, 'b', 0).ok).toBe(false);
    expect(deleteItem(state, 'bequip', 0).ok).toBe(false);
  });

  it('★ 删掉装着的共享藏品，人口上限要跟着还回去（不能永久多 1 人口）', () => {
    const state = createGameState(10);
    state.economy.level = 3;
    expect(popCap(state)).toBe(3);
    addItem(state, 'itm_terrain_map');
    equipSharedItem(state, 0, 0);
    expect(popCap(state), '地形图 +1 人口').toBe(4);
    deleteItem(state, 'bequip', 0);
    expect(popCap(state), '删掉之后必须还回去').toBe(3);
  });
});

// ============================================================
//  ⑥ 装备跟着棋子走
// ============================================================

describe('★ 装备跟着棋子走（不能凭空消失）', () => {
  it('上场 -> 收回：装备一直在', () => {
    const state = testState();
    const uid = grantOne(state);
    addItem(state, 'itm_solvent');
    equipItemToUnit(state, 0, uid);

    expect(placeBenchUnitAt(state, uid, { col: 0, row: 0 }).ok).toBe(true);
    expect(state.placements.find((p) => p.uid === uid)!.items).toEqual(['itm_solvent']);

    expect(recallFromBoard(state, { col: 0, row: 0 }).ok).toBe(true);
    expect(state.economy.bench.find((unit) => unit.uid === uid)!.items).toEqual(['itm_solvent']);
  });

  it('★ 卖掉带装备的干员：装备退回藏品栏，不会跟着消失', () => {
    const state = testState();
    const uid = grantOne(state);
    addItem(state, 'itm_solvent');
    equipItemToUnit(state, 0, uid);
    expect(state.items.aSlots[0]).toBeNull();

    expect(doSellBench(state, uid).ok).toBe(true);
    expect(state.items.aSlots[0]).toBe('itm_solvent');
  });

  it('★ 三个一星合成 2 星：装备跟到 2 星身上', () => {
    const state = testState();
    const uid = grantOne(state);

    for (const itemId of WORN_A_ITEMS.slice(0, 2)) addItem(state, itemId);
    expect(equipItemToUnit(state, 0, uid).ok).toBe(true);
    expect(equipItemToUnit(state, 1, uid).ok).toBe(true);

    grantModifierUnit(state, DEF_ID, 1);
    grantModifierUnit(state, DEF_ID, 1); // 三合一

    const two = state.economy.bench.find((unit) => unit.star === 2);
    expect(two, '三个一星该合成 2 星').toBeDefined();
    expect(two!.items).toEqual(WORN_A_ITEMS.slice(0, 2));
  });

  it('★ 合成带不下的装备退回藏品栏（不静默丢弃）', () => {
    const state = testState();
    const equipped: string[] = [];
    for (let i = 0; i < 2; i++) {
      const uid = grantOne(state);
      for (let k = 0; k < 2; k++) {
        const itemId = WORN_A_ITEMS[equipped.length]!;
        equipped.push(itemId);
        addItem(state, itemId);
        expect(equipItemToUnit(state, 0, uid).ok).toBe(true);
      }
    }
    expect(countItems(state.items.aSlots), '4 件全在棋子身上').toBe(0);

    grantModifierUnit(state, DEF_ID, 1); // 第三个 -> 合成

    const two = state.economy.bench.find((unit) => unit.star === 2);
    expect(two, '该合成 2 星').toBeDefined();
    expect(two!.items, '最多带走 2 件').toEqual(equipped.slice(0, 2));
    expect(countItems(state.items.aSlots), '多出来的 2 件必须退回藏品栏').toBe(2);
  });
});

// ============================================================
//  ⑦ 送进战斗内核的那一份（toTeamSetup）
//  ⑦-b 联机提交的那一份（toSubmittedTeam）—— 它和 ⑦ 共用同一个构造点，不能再分家
// ============================================================

describe('★ toTeamSetup：藏品要真的传到内核', () => {
  it('干员的 A 类走 units[].items，共享的走 sharedItems，外加玩家金币/血量', () => {
    const state = testState();
    const uid = grantOne(state);
    addItem(state, 'itm_solvent');
    equipItemToUnit(state, 0, uid);
    expect(placeBenchUnitAt(state, uid, { col: 0, row: 0 }).ok).toBe(true);

    addItem(state, 'itm_treasure_ring');
    equipSharedItem(state, 0, 0);

    const setup = toTeamSetup(state);
    expect(setup.units[0]!.items).toEqual(['itm_solvent']);
    expect(setup.sharedItems).toEqual(['itm_treasure_ring']);
    expect(setup.playerContext).toEqual({ gold: state.economy.gold, hp: state.economy.hp });
  });

  it('没装藏品时不留下空数组（保持给内核的载荷干净）', () => {
    const state = testState();
    const uid = grantOne(state);
    expect(placeBenchUnitAt(state, uid, { col: 0, row: 0 }).ok).toBe(true);
    const setup = toTeamSetup(state);
    expect(setup.units[0]!.items).toBeUndefined();
    expect(setup.sharedItems).toBeUndefined();
  });
});

/**
 * ★ 联机提交的那份载荷（`submitTeam` 发出去的就是它）。
 *
 * 【为什么单独钉一遍？】
 * 因为它曾经是**在别处手抄的一份 `{defId, star, cell}`**，漏了 items ——
 * 于是联机时 A 类藏品效果全丢，而且完全静默（界面照样显示"已装备"）。
 * 现在它和单机的 `toTeamSetup` 共用同一个构造点（`toTeamSetup` 内部就是
 * 调 `toSubmittedTeam` 再补上解析结果），所以这份测试盯的是"两边不能再分家"。
 */
describe('★ toSubmittedTeam：发给服务器的那份必须带着装备', () => {
  it('干员身上的 A 类藏品 / 共享藏品 / 玩家金币血量三样都在', () => {
    const state = testState();
    const uid = grantOne(state);
    addItem(state, 'itm_solvent');
    equipItemToUnit(state, 0, uid);
    expect(placeBenchUnitAt(state, uid, { col: 0, row: 0 }).ok).toBe(true);

    addItem(state, 'itm_terrain_map');
    equipSharedItem(state, 0, 0);

    const submitted = toSubmittedTeam(state);
    expect(submitted.units[0]!.items).toEqual(['itm_solvent']);
    expect(submitted.sharedItems).toEqual(['itm_terrain_map']);
    expect(submitted.playerContext).toEqual({ gold: state.economy.gold, hp: state.economy.hp });
  });

  it('★ 和 toTeamSetup 的这三个字段逐字一致（分家就在这里分）', () => {
    const state = testState();
    const uid = grantOne(state);
    addItem(state, 'itm_dual_arm');
    equipItemToUnit(state, 0, uid);
    expect(placeBenchUnitAt(state, uid, { col: 1, row: 1 }).ok).toBe(true);
    addItem(state, 'itm_gin_cup');
    equipSharedItem(state, 0, 0);

    const submitted = toSubmittedTeam(state);
    const setup = toTeamSetup(state);
    expect(setup.units).toEqual(submitted.units);
    expect(setup.sharedItems).toEqual(submitted.sharedItems);
    expect(setup.playerContext).toEqual(submitted.playerContext);
  });

  it('没装藏品时不留下空数组（服务端只看有没有，不看长度）', () => {
    const state = testState();
    const uid = grantOne(state);
    expect(placeBenchUnitAt(state, uid, { col: 0, row: 0 }).ok).toBe(true);
    const submitted = toSubmittedTeam(state);
    expect(submitted.units[0]!.items).toBeUndefined();
    expect(submitted.sharedItems).toBeUndefined();
  });

  it('棋子全收回备战席（空阵容）时也不炸', () => {
    const state = testState();
    const submitted = toSubmittedTeam(state);
    expect(submitted.units).toEqual([]);
    expect(submitted.sharedItems).toBeUndefined();
  });
});

// ============================================================
//  ⑧ 派生数值：每回合收入 / 失落之钥
// ============================================================

describe('★ 每回合收入（至宝指环 / 幸运硬币）', () => {
  /** 装一件共享藏品后跑一次回合结算，返回比"没装"多拿了几金 */
  function extraGold(itemId: string, won: boolean): number {
    const plain = createGameState(1234);
    const equipped = createGameState(1234);
    addItem(equipped, itemId);
    expect(equipSharedItem(equipped, 0, 0).ok).toBe(true);
    return advanceRound(equipped, won).gold - advanceRound(plain, won).gold;
  }

  it('至宝指环：每回合 +1 金', () => {
    expect(extraGold('itm_treasure_ring', true)).toBe(1);
  });

  it('幸运硬币：输了才 +1 金（赢了没有）', () => {
    expect(extraGold('itm_lucky_coin', false)).toBe(1);
    expect(extraGold('itm_lucky_coin', true)).toBe(0);
  });
});

/**
 * ★ 战利品（战斗中掉的、不确定的部分）。
 *
 * 【为什么和上面那两条分开？】
 * 上面那两条是"回合开始前就能算出来的固定收入"（`itemRoundGold`）。
 * 而铳骑之威击杀掉金 / 黄沙罗盘阵亡掉金是**战斗中掷骰子**决定的，
 * 内核算完记成 `gold` 事件，客户端播完战斗照事件数一遍再发给结算。
 * 数错了不会报错，只会"每局悄悄多发/少发几金"，所以值得单独钉。
 */
describe('★ 战斗中掉的战利品（铳骑之威 / 黄沙罗盘）', () => {
  /** 造几条 gold 事件（只带 battleGoldOf 关心的字段，其余用不上） */
  const goldEvent = (team: 0 | 1, amount: number) =>
    ({ type: 'gold', t: 0, team, amount, sourceId: 1, reason: 'kill' }) as BattleEvent;

  it('只数"我这一队"的（写死队伍 0 的话，被分到队伍 1 的人永远拿不到）', () => {
    const log = [goldEvent(0, 1), goldEvent(1, 2), goldEvent(1, 3), goldEvent(0, 4)];
    expect(battleGoldOf(log, 0)).toBe(5);
    expect(battleGoldOf(log, 1)).toBe(5);
  });

  it('别的类型的事件不掺和（death / damage 里也有 team 字段）', () => {
    const log = [
      { type: 'death', t: 0, unitId: 1, team: 1, remaining: 0 },
      { type: 'damage', t: 0, unitId: 1, targetId: 2, team: 0, amount: 999 },
      goldEvent(0, 2),
    ] as BattleEvent[];
    expect(battleGoldOf(log, 0)).toBe(2);
    expect(battleGoldOf(log, 1)).toBe(0);
  });

  it('没有掉金事件时是 0（没装那两件藏品就是这条路）', () => {
    expect(battleGoldOf([], 0)).toBe(0);
  });

  it('★ advanceRound 会把战利品加进金币，并在结算文案里单列（不和"每回合收入"混）', () => {
    const plain = createGameState(4242);
    const looted = createGameState(4242);
    const base = advanceRound(plain, true).gold;
    const withLoot = advanceRound(looted, true, undefined, 7);
    expect(withLoot.gold).toBe(base + 7);
    expect(withLoot.breakdown).toContain('战利品 7');
  });
});

describe('★ 失落之钥（本局永久效果）', () => {
  /** 开一局非测试模式（要真的花钱买经验），并把钥匙装上 */
  function withKey(): GameState {
    const state = createGameState(77);
    state.economy.gold = 500;
    addItem(state, 'itm_lost_key');
    expect(equipSharedItem(state, 0, 0).ok).toBe(true);
    expect(state.items.permanent.lostKey).toBe(true);
    return state;
  }

  it('花金币买经验时额外 +1 经验', () => {
    const state = withKey();
    state.economy.level = 3;
    state.economy.xp = 0;
    const gold = state.economy.gold;
    expect(doBuyXp(state).ok).toBe(true);
    // 买 4 点 + 失落之钥 1 点 = 5 点（等级 3 需要 6 点，所以升不上去）
    expect(state.economy.xp).toBe(5);
    expect(state.economy.gold).toBe(gold - 4);
    expect(xpNeededForLevel(3)).toBeGreaterThan(5);
  });

  it('★ 到达十级时一次性给 50 金（只给一次）', () => {
    const state = withKey();
    state.economy.level = 9;
    state.economy.xp = xpNeededForLevel(9) - 1; // 差 1 点就满级
    const gold = state.economy.gold;
    expect(doBuyXp(state).ok).toBe(true);
    expect(state.economy.level).toBe(10);
    expect(state.items.permanent.lostKeyPaid).toBe(true);
    // 花了 4 金买经验，拿到 50 金奖励
    expect(state.economy.gold).toBe(gold - 4 + 50);

    // 再买一次不会重复发
    state.economy.gold = 500;
    doBuyXp(state);
    expect(state.economy.gold).toBe(500);
  });

  it('★ 靠"每回合白送经验"升到十级也能拿到 50 金（不能只接一条路）', () => {
    const state = withKey();
    state.economy.level = 10; // 直接就是满级（模拟"刚好这一回合靠白送经验到十级"）
    const gold = state.economy.gold;
    advanceRound(state, true);
    expect(state.items.permanent.lostKeyPaid).toBe(true);
    expect(state.economy.gold).toBeGreaterThan(gold + 50);
  });
});

// ============================================================
//  ⑨ 图标名（和"素材文件"的契约）
// ============================================================

/**
 * 图标是从 prts.wiki 抓下来的 PNG，放在 apps/web/public/assets/items/<icon>.png，
 * 由 apps/web/src/three/assets.ts 的 itemIconPath() 直接拼进 URL。
 *
 * 【为什么值得单独写测试？】
 * 这张表是"代码 / 素材 / 抓图脚本（scripts/fetch-item-icons.ts）"三方共用的**唯一契约**：
 *   · icon 写空了    → 请求 /assets/items/.png，控制台 404，界面退化成色块
 *   · icon 撞车      → 两件藏品显示同一张图，而且要抓图时第二个会被当成"已下载"跳过
 *   · icon 带斜杠/空格/中文 → URL 拼出来是坏的（Vite 也不会帮你转义）
 * 三条都是"改数据时手滑一下就中"的坑，所以在数据层钉死。
 */
describe('★ 藏品图标名（素材文件名契约）', () => {
  const items = Object.values(ITEM_DEFS);

  it('每件都有 icon，且是安全的文件名（不含路径分隔符 / 空格 / 非 ASCII）', () => {
    for (const item of items) {
      expect(item.icon, `${item.id} 没写 icon`).toBeTruthy();
      expect(item.icon, `${item.id} 的 icon「${item.icon}」不是安全文件名`).toMatch(/^[a-z0-9_]+$/);
    }
  });

  it('★ icon 两两不重复（撞车会让两件藏品显示同一张图，还会让抓图脚本漏抓）', () => {
    const seen = new Map<string, string>();
    for (const item of items) {
      const prev = seen.get(item.icon);
      expect(prev, `icon「${item.icon}」被 ${prev} 和 ${item.id} 同时用了`).toBeUndefined();
      seen.set(item.icon, item.id);
    }
  });

  it('id 也两两不重复（ITEM_DEFS 的 key 就是 id，重复会静默吞掉一件）', () => {
    for (const item of items) {
      expect(ITEM_DEFS[item.id]).toBe(item);
    }
  });

  it('分档数对得上设计稿（一版 36 + 二版 30 + 转职 19 + 变形 1 + 盟约专属 3 = 89；普通 28 / 进阶 61，A 类 59 / B 类 30）', () => {
    /*
      ★ 0.1.1 藏品二版：从《藏品二版.txt》又录了 30 件（普通 8 + 进阶 22）。
      ★ 0.1.3 转职体系：16 件转职藏品 + 1 件变形同构体，全是「进阶 · 穿戴」。
      ★ 0.2 MujicaAve：羁绊表多了一个阵营 ⇒ 转职藏品**自动**多一件（17 件），
        进阶 55 -> 56、A 类 53 -> 54，总数 83 -> 84。
      ★ 0.2 不屈：羁绊表再加一个 ⇒ 转职藏品自动多一件（18 件），
        进阶 56 -> 57、A 类 54 -> 55，总数 84 -> 85。
      ★ 0.3 近卫：羁绊表再加一个（剑豪保留）⇒ 转职自动多一件（19 件），
        进阶 57 -> 58、A 类 55 -> 56，总数 85 -> 86。
      ★ 0.3.2 阿米娅「不容拒绝」：3 件升变之证（青色怒火 / 慈悲愿景 / 炉芯终曲），
        全是「进阶 · 穿戴（A 类）」且 `covenantOnly: true` ⇒ 不进商店 / 掉落 / 招募池，
        所以下面的池子断言不变，只有 ITEM_DEFS 总数 +3（进阶 61、A 类 59）。
      ★ 这个数字变化很好核对："加一个羁绊 = 自动多一件转职藏品"。
      这条断言的价值就在于"每加/删一件都必须显式改这里"——
      数字对不上时先回去核 data 表，而不是顺手把断言改掉。
    */
    expect(items.length).toBe(89);
    expect(items.filter((i) => i.rarity === 'normal').length).toBe(28);
    expect(items.filter((i) => i.rarity === 'advanced').length).toBe(61);
    expect(items.filter((i) => i.slot === 'A').length).toBe(59);
    expect(items.filter((i) => i.slot === 'B').length).toBe(30);
  });

  /**
   * ★ 0.3.2 阿米娅升变之证：用户明确要求「这些藏品不能出现在野怪掉落物中，不能出现在商店中」。
   * 实现手段是 `ItemDef.covenantOnly` —— 池子由 `itemsOf()` / `NORMAL_ITEMS` / `ADVANCED_ITEMS`
   * 统一过滤。**只加字段不过滤 = 白加**（用户照样能在商店刷到），所以这里把"过滤"钉死。
   */
  it('★ 盟约专属藏品（covenantOnly）不进任何抽取池，且每件都真的写了升变', () => {
    const covenantOnly = Object.values(ITEM_DEFS).filter((i) => i.covenantOnly === true);
    expect(covenantOnly.map((i) => i.id).sort()).toEqual(
      ['itm_amiya_blue_cert', 'itm_amiya_core_cert', 'itm_amiya_mercy_cert'].sort(),
    );
    for (const item of covenantOnly) {
      expect(NORMAL_ITEMS.some((i) => i.id === item.id), `${item.id} 漏进了普通池`).toBe(false);
      expect(ADVANCED_ITEMS.some((i) => i.id === item.id), `${item.id} 漏进了进阶池`).toBe(false);
      expect(
        itemsOf(item.rarity, item.slot).some((i) => i.id === item.id),
        `${item.id} 漏进了 itemsOf`,
      ).toBe(false);
      expect(item.onEquip?.ascend, `${item.id} 没写升变`).toBeTruthy();
    }
  });
});

// ============================================================
//  ★ 0.2：图标"谁最后跑谁赢" —— 占位图不许盖掉官方图
// ============================================================

/**
 * 【这条 bug 的完整剧情】（用户报："变形重构体的贴图出问题了，应该是用官方的
 *  贴图，之前记得添加过，为什么还是显示的占位贴图"）
 *
 *   1. `fetch-item-icons.ts` 里**早就登记**了 `itm_morph_relic`（卫戍协议的官方道具）；
 *   2. 但 `gen-trait-relic-icons.ts` 末尾又给它画了一张「深紫底 + 变形两个字」的占位图；
 *   3. 两个脚本写的是**同一个文件**，谁最后跑谁赢 ⇒ 用户看到的一直是占位图。
 *
 * 光"再跑一次抓取"是治不好的（下次有人重跑生成脚本又会盖回去），
 * 所以这里用源码级断言把**归属**钉死：占位脚本只许画"转职藏品"，
 * 有官方美术的那件归抓取脚本管。
 */
describe('★ 0.2 藏品图标归属：占位脚本不许碰有官方美术的藏品', () => {
  const read = (rel: string): string =>
    readFileSync(new URL(`../../../scripts/${rel}`, import.meta.url), 'utf8');

  /**
   * 去掉注释后再判断 —— 文件头那段"以前为什么有它"的历史说明要保留，
   * 只有**真的会执行**的字符串才算数。
   */
  const codeOnly = (source: string): string =>
    source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('★ gen-trait-relic-icons.ts 不再生成变形同构体（否则会盖掉官方图标）', () => {
    const code = codeOnly(read('gen-trait-relic-icons.ts'));
    expect(code.includes('itm_morph_relic'), '占位脚本里还留着它 = 跑一次就把官方图盖掉').toBe(
      false,
    );
  });

  it('★ fetch-item-icons.ts 里仍然登记着它（官方美术的唯一来源）', () => {
    const source = read('fetch-item-icons.ts');
    expect(source.includes("itm_morph_relic: '变形同构体'")).toBe(true);
  });

  it('★★ 通例：占位脚本画的每一件，都必须是有 grantsTrait 的转职藏品', () => {
    /*
      判据不写死 id —— 代码里出现的 `itm_xxx` 字符串，只要不是转职藏品就报错。
      这样以后谁再想"顺手给某件藏品画个占位图"，会当场被这条挡下来：
      要画可以，先确认它没有官方来源。
    */
    const code = codeOnly(read('gen-trait-relic-icons.ts'));
    const used = new Set(code.match(/itm_[a-z0-9_]+/g) ?? []);
    for (const id of used) {
      const item = ITEM_DEFS[id];
      if (!item) continue; // 注释里提到的历史 id
      expect(item.grantsTrait, `${id} 不是转职藏品，占位图会和官方图标抢同一个文件`).toBeTruthy();
    }
  });
});

// ============================================================
//  ⑩ 话术：玩家看到的字里不许出现「A 类 / B 类」
// ============================================================

/**
 * 【需求原文】"A 类 B 类只是为了区分，在游玩的显示上要显示为穿戴藏品和共享藏品"。
 *
 * 所以 A / B 是**内部代号**（= `item.slot` 的值），玩家一个字都不该看到。
 * 玩家能看到的字只有三处来源，全在这份测试里点名：
 *   1. `ITEM_SLOT_SHORT` —— 格子 tooltip 的标题、干员详情页的小括号、拖动预览上的徽章
 *   2. `ITEM_SLOT_LABEL` —— 导出数值总表的「类型」列
 *   3. `zoneLabel()`      —— 三条栏目的名字，toast 里到处在用
 * 以后有人手滑在别处直接拼 `item.slot` 进文案，这三条会先红。
 */
describe('★ 话术：只说「穿戴藏品 / 共享藏品」，不说「A 类 / B 类」', () => {
  /** 出现这个就是没改干净 */
  const FORBIDDEN = /[AB] 类/;

  it('ITEM_SLOT_SHORT / ITEM_SLOT_LABEL 里没有 A 类 / B 类', () => {
    for (const [slot, text] of Object.entries({ ...ITEM_SLOT_SHORT, ...ITEM_SLOT_LABEL })) {
      expect(text, `slot ${slot} 的文案「${text}」还带着代号`).not.toMatch(FORBIDDEN);
    }
    expect(ITEM_SLOT_SHORT.A).toBe('穿戴藏品');
    expect(ITEM_SLOT_SHORT.B).toBe('共享藏品');
  });

  it('三条栏目的名字里没有 A 类 / B 类', () => {
    for (const zone of ['a', 'b', 'bequip'] as const) {
      const label = zoneLabel(zone);
      expect(label, `${zone} 栏的文案「${label}」还带着代号`).not.toMatch(FORBIDDEN);
    }
    expect(zoneLabel('a')).toBe('穿戴藏品栏');
    expect(zoneLabel('b')).toBe('共享藏品栏');
    expect(zoneLabel('bequip')).toBe('共享装备位');
  });

  /*
    ★ 用户报的 bug：**有的藏品提示框是"竖着"的**（一个字一行）。
    根因是 `item-text.ts` 里 `lines.push(...renderItemMechanics(item.teamMechanics))` ——
    `renderItemMechanics` 返回的是**一个字符串**，`...` 把它摊成了单个字符，
    于是每件 B 类（共享藏品）的 tooltip 都变成一根竖条。
  */
  it('★ 每件藏品的效果行都是"一句话"，不能被摊成单字', () => {
    for (const item of Object.values(ITEM_DEFS)) {
      const lines = itemEffectLines(item, (id) => id);
      expect(lines.length, `${item.id} 的效果行数异常多（像是被逐字摊开了）`).toBeLessThan(6);
      for (const line of lines) {
        expect(line.length, `${item.id} 里有一行短得可疑："${line}"`).toBeGreaterThan(1);
        expect(line, `${item.id} 的效果行里出现了换行符`).not.toContain('\n');
      }
    }
  });

  it('★ 共享藏品（B 类）的队伍级机制也要有说明，不能丢', () => {
    const shared = Object.values(ITEM_DEFS).filter((item) => item.slot === 'B' && (item.teamMechanics?.length ?? 0) > 0);
    expect(shared.length, '至少该有几件是队伍级机制的').toBeGreaterThan(0);
    for (const item of shared) {
      const lines = itemEffectLines(item, (id) => id);
      expect(lines.length, `${item.id} 的队伍级机制没渲染出说明`).toBeGreaterThan(0);
    }
  });

  it('★ 36 件藏品的 tooltip 全文（标题 + 效果 + 摘要）里都没有 A 类 / B 类', () => {
    for (const item of Object.values(ITEM_DEFS)) {
      const head = `${item.name}（${ITEM_SLOT_SHORT[item.slot]}）`;
      const text = [head, ...itemEffectLines(item), itemEffectSummary(item), item.desc].join('\n');
      expect(text, `${item.id} 的说明里出现了代号`).not.toMatch(FORBIDDEN);
    }
  });
});

/*
  ★★ 用户报的 bug：「博士投影 / 拟态物质」复制或升星之后，牌库数字弹回满。

  【现场】手里 7 张维什戴尔（5 费、牌库 10 张 → 界面显示"还剩 3"），
  用博士投影复制出两只之后，界面又显示 10 张。
  【根因】道具给的"不占牌库"以前是**整只白送**的布尔标记，还会**顺着合成传染**：
  7 张里只要有一只被标成白送，连锁合成之后整只 3★ 都不占牌库，牌库自然回到满。
  【正确口径】道具只免掉它真正多给的那几张，复制/升星**不该动摇牌库**。
*/
describe('★ 牌库账目：复制 / 升星类藏品不该动摇牌库', () => {
  /** 直接往备战席塞 N 张"买来的"一星（free 不设 = 正常占牌库） */
  function giveBought(state: GameState, n: number): void {
    state.economy.bench = [];
    for (let i = 0; i < n; i++) {
      state.economy.bench.push({ uid: 900000 + i, defId: DEF_ID, star: 1 });
    }
  }

  it('拟态物质：复制一只之后，牌库一张都不该变', () => {
    const state = testState();
    const poolSize = poolSizeOf(DEF_ID);
    giveBought(state, 7);
    const before = poolRemainingOf(state, DEF_ID);
    expect(before, '7 张 1 星 = 占 7 张').toBe(poolSize - 7);

    expect(grantModifierItem(state, 'itm_mimic_mass').ok).toBe(true);
    expect(equipItemToUnit(state, state.items.aSlots.indexOf('itm_mimic_mass'), 900000).ok).toBe(true);

    expect(poolRemainingOf(state, DEF_ID), '复制出来的那只不占牌库，别的照旧').toBe(before);
  });

  it('★ 博士投影：升星之后牌库也不该变（用户报的就是这一件）', () => {
    const state = testState();
    const poolSize = poolSizeOf(DEF_ID);
    giveBought(state, 7);
    const before = poolRemainingOf(state, DEF_ID);
    expect(before).toBe(poolSize - 7);

    expect(grantModifierItem(state, 'itm_doctor_projection').ok).toBe(true);
    const uid = state.economy.bench[0]!.uid;
    expect(equipItemToUnit(state, state.items.aSlots.indexOf('itm_doctor_projection'), uid).ok).toBe(true);

    expect(poolRemainingOf(state, DEF_ID), '升到 2 星、连带合成之后，占的还是那 7 张').toBe(before);
  });

  it('★ 复制出来的那只卖掉落，牌库也不会凭空变多', () => {
    const state = testState();
    const poolSize = poolSizeOf(DEF_ID);
    // 只放 1 张：加上复制出来的那只也才 2 只，不会触发合成，能干净地盯这一只
    giveBought(state, 1);
    const before = poolRemainingOf(state, DEF_ID);
    expect(before).toBe(poolSize - 1);

    expect(grantModifierItem(state, 'itm_mimic_mass').ok).toBe(true);
    expect(equipItemToUnit(state, state.items.aSlots.indexOf('itm_mimic_mass'), 900000).ok).toBe(true);
    expect(poolRemainingOf(state, DEF_ID), '复制不影响牌库').toBe(before);

    const clone = state.economy.bench.find((unit) => unit.free === true);
    expect(clone, '复制出来的那只应该在备战席上').toBeDefined();
    expect(poolCopiesOfUnit(clone!), '它一张都不占').toBe(0);
    expect(doSellBench(state, clone!.uid).ok).toBe(true);
    expect(poolRemainingOf(state, DEF_ID), '卖它不该让牌库变多').toBe(before);

    // 对照：卖掉"买来的"那只会正常还回 1 张
    const bought = state.economy.bench.find((unit) => unit.uid === 900000)!;
    expect(poolCopiesOfUnit(bought)).toBe(1);
    expect(doSellBench(state, bought.uid).ok).toBe(true);
    expect(poolRemainingOf(state, DEF_ID), '买来的那只卖掉要还牌').toBe(poolSize);
  });
});

/**
 * ============================================================
 *  ★ 商店卡面右上角「已拥有 N」= 按张数折算
 * ============================================================
 * 用户口径：1 星算 1 张、2 星算 3 张、3 星算 9 张，备战席 + 场上都算。
 * 它和「牌库还剩 M 张」互补（N + M = 这只棋子的总张数）。
 */
describe('★ 已拥有张数（商店角标）', () => {
  it('★ 走真实的"发牌 + 合成"路径：1 星 1 张、2 星 3 张、3 星 9 张', () => {
    const state = testState();
    expect(countOwnedCopies(state, DEF_ID), '什么都没有时是 0').toBe(0);

    expect(grantModifierUnit(state, DEF_ID).ok).toBe(true);
    expect(countOwnedCopies(state, DEF_ID)).toBe(1);

    // 再发两个 -> 三个 1 星自动合成一只 2 星
    expect(grantModifierUnit(state, DEF_ID).ok).toBe(true);
    expect(grantModifierUnit(state, DEF_ID).ok).toBe(true);
    expect(state.economy.bench.map((unit) => unit.star), '三个 1 星该合成').toEqual([2]);
    expect(countOwnedCopies(state, DEF_ID), '2 星 = 3 张').toBe(3);

    // 一路发到 3 星：一共吃掉 9 张
    for (let i = 0; i < 6; i++) expect(grantModifierUnit(state, DEF_ID).ok).toBe(true);
    expect(state.economy.bench.map((unit) => unit.star), '九个 1 星该合成一只 3 星').toEqual([3]);
    expect(countOwnedCopies(state, DEF_ID), '3 星 = 9 张').toBe(9);
  });

  it('混合星级要加起来（1 星 + 2 星 + 3 星 = 13 张）', () => {
    const state = testState();
    state.economy.bench.push({ uid: 900001, defId: DEF_ID, star: 1 });
    expect(countOwnedCopies(state, DEF_ID)).toBe(1);

    state.economy.bench.push({ uid: 900002, defId: DEF_ID, star: 2 });
    expect(countOwnedCopies(state, DEF_ID), '1 + 3').toBe(4);

    state.economy.bench.push({ uid: 900003, defId: DEF_ID, star: 3 });
    expect(countOwnedCopies(state, DEF_ID), '1 + 3 + 9').toBe(13);
  });

  it('★ 场上的也算（和合成、牌库账目同一个口径）', () => {
    const state = testState();
    // 先往备战席塞一只（uid 要和下面上场时用的一致）
    state.economy.bench.push({ uid: 900010, defId: DEF_ID, star: 1 });
    expect(placeBenchUnitAt(state, 900010, { col: 0, row: 0 }).ok).toBe(true);
    // 手动把它变成 2 星（走正常路径要买 6 个，这里直接构造）
    state.placements[0]!.star = 2;
    expect(state.economy.bench.length, '已经上场了').toBe(0);
    expect(countOwnedCopies(state, DEF_ID), '场上的 2 星算 3 张').toBe(3);
  });

  it('★ 别的干员不算进来（只数同名）', () => {
    const state = testState();
    const other = playableDefs()
      .filter((def) => def.id !== DEF_ID)
      .sort((a, b) => a.cost - b.cost)[0]!.id;
    state.economy.bench.push({ uid: 900020, defId: other, star: 2 });
    expect(countOwnedCopies(state, DEF_ID), '异名干员一张都不算').toBe(0);
  });

  it('★ 折算口径和"牌库剩余"互补：已拥有 + 剩余 = 总张数', () => {
    const state = testState();
    const poolSize = poolSizeOf(DEF_ID);
    // 塞 1 张 1 星 = 正常占牌库 1 张的那种
    state.economy.bench.push({ uid: 900030, defId: DEF_ID, star: 1 });
    expect(countOwnedCopies(state, DEF_ID)).toBe(1);
    expect(countOwnedCopies(state, DEF_ID) + poolRemainingOf(state, DEF_ID)).toBe(poolSize);
  });
});
/**
 * ============================================================
 *  ★ 0.0.3 需求 4：装备栏里的装备可以拖动互换位置
 * ============================================================
 * 界面那一层做的是"同栏内拖动 -> swapItemsInZone"（点击装卸那条路没变）。
 * 这里盯的是**状态层**的语义，因为"换位置"最容易出的事故是：
 *   · 把"互换"写成"装备一次" -> 立刻销毁类藏品凭空消失
 *   · 换着换着丢了一件（两边都写同一个值 / 忘处理目标是空格）
 *   · 顺手触发了 onEquip（+金币 / 复制干员），玩家白赚
 */
describe('★ 同栏内拖动互换位置', () => {
  /** 往 A 栏塞两件"装上去会留在身上"的藏品，返回它们的 id */
  function twoWearables(state: GameState): [string, string] {
    const [a, b] = WORN_A_ITEMS.slice(0, 2) as [string, string];
    expect(addItem(state, a).ok).toBe(true);
    expect(addItem(state, b).ok).toBe(true);
    return [a, b];
  }

  it('同一栏里的两件互换：位置对调，一件都不丢', () => {
    const state = testState();
    const [a, b] = twoWearables(state);
    const i0 = state.items.aSlots.indexOf(a);
    const i1 = state.items.aSlots.indexOf(b);
    expect(i0).toBeGreaterThanOrEqual(0);
    expect(i1).toBeGreaterThanOrEqual(0);

    const result = swapItemsInZone(state, 'a', i0, i1);
    expect(result.ok).toBe(true);
    expect(state.items.aSlots[i1]).toBe(a);
    expect(state.items.aSlots[i0]).toBe(b);
    expect(countItems(state.items.aSlots), '总数不变').toBe(2);
  });

  it('拖到空格子 = 挪过去（不是"和空气交换"，也不是凭空复制）', () => {
    const state = testState();
    const [a] = twoWearables(state);
    const list = state.items.aSlots;
    const from = list.indexOf(a);
    // 找一个空格子
    const to = list.findIndex((value) => value === null);
    expect(to).toBeGreaterThanOrEqual(0);

    expect(swapItemsInZone(state, 'a', from, to).ok).toBe(true);
    expect(state.items.aSlots[to]).toBe(a);
    expect(state.items.aSlots[from]).toBeNull();
    expect(countItems(state.items.aSlots), '总数不变').toBe(2);
  });

  it('三栏都支持互换（穿戴 10 / 共享 5 / 共享装备位 4）', () => {
    const state = testState();
    // ① 穿戴栏：塞两件 A 类
    const [a, b] = twoWearables(state);
    const ai0 = state.items.aSlots.indexOf(a);
    const ai1 = state.items.aSlots.indexOf(b);
    expect(swapItemsInZone(state, 'a', ai0, ai1).ok).toBe(true);
    expect(state.items.aSlots[ai1]).toBe(a);

    // ② 共享装备位：把两件 B 类装进去，再互换
    /*
      ★ 必须挑"装上去会留在装备位上"的 B 类 ——
      「立刻销毁」类（古旧残币这类）装上就没了，根本不会占格，
      拿它们做互换测试只会看到"两格都是空的"。
    */
    const bItems = Object.values(ITEM_DEFS)
      .filter((item) => item.slot === 'B' && item.onEquip?.consume !== true)
      .map((item) => item.id);
    expect(bItems.length).toBeGreaterThanOrEqual(2);
    for (const id of bItems.slice(0, 2)) expect(addItem(state, id).ok).toBe(true);
    expect(equipSharedItem(state, state.items.bSlots.indexOf(bItems[0]!), 0).ok).toBe(true);
    expect(equipSharedItem(state, state.items.bSlots.indexOf(bItems[1]!), 1).ok).toBe(true);
    expect(state.items.bEquip[0]).toBe(bItems[0]);
    expect(state.items.bEquip[1]).toBe(bItems[1]);

    expect(swapItemsInZone(state, 'bequip', 0, 1).ok).toBe(true);
    expect(state.items.bEquip[0], '共享装备位的顺序（界面上就是生效顺序）').toBe(bItems[1]);
    expect(state.items.bEquip[1]).toBe(bItems[0]);

    // ③ 共享藏品存放栏：装完剩下的那件和空格子互换
    const left = state.items.bSlots.findIndex((value) => value !== null);
    if (left >= 0) {
      const empty = state.items.bSlots.findIndex((value) => value === null);
      if (empty >= 0) {
        expect(swapItemsInZone(state, 'b', left, empty).ok).toBe(true);
        expect(state.items.bSlots[empty]).not.toBeNull();
        expect(state.items.bSlots[left]).toBeNull();
      }
    }
  });

  it('原地 / 越界 / 起点是空的：都是 ok=false，且一个格子都不动', () => {
    const state = testState();
    const [a] = twoWearables(state);
    const snapshot = [...state.items.aSlots];

    expect(swapItemsInZone(state, 'a', 0, 0).ok, '拖回自己那一格').toBe(false);
    expect(swapItemsInZone(state, 'a', 0, ITEM_A_SLOTS).ok, '越界').toBe(false);
    expect(swapItemsInZone(state, 'a', -1, 0).ok, '负数下标').toBe(false);
    // 找一个空格子当起点
    const empty = snapshot.findIndex((value) => value === null);
    if (empty >= 0) expect(swapItemsInZone(state, 'a', empty, state.items.aSlots.indexOf(a)).ok).toBe(false);

    expect(state.items.aSlots).toEqual(snapshot);
  });

  it('★ 互换 ≠ 装备：立刻销毁类藏品换个位置不会被消耗，也不触发 onEquip', () => {
    const state = testState();
    expect(addItem(state, 'itm_mimic_mass').ok).toBe(true);
    const benchBefore = state.economy.bench.length;
    const goldBefore = state.economy.gold;
    const hpBefore = state.economy.hp;

    const from = state.items.aSlots.indexOf('itm_mimic_mass');
    expect(from).toBeGreaterThanOrEqual(0);
    const result = swapItemsInZone(state, 'a', from, from + 1);
    expect(result.ok).toBe(true);

    expect(state.items.aSlots.includes('itm_mimic_mass'), '藏品还在（没被消耗）').toBe(true);
    expect(state.economy.bench.length, '没复制出干员').toBe(benchBefore);
    expect(state.economy.gold, '没白送金币').toBe(goldBefore);
    expect(state.economy.hp, '没白送血量').toBe(hpBefore);
  });
});

// ============================================================
//  ★ 0.1.1：彩蛋角色永久屏蔽「升星 / 复制 / 变身」类藏品
// ============================================================
/**
 * 【用户的原话】「维维美·绝对主角」不能使用【拟态物质】【博士投影】；
 * 并且之后新增任何具备升星、棋子复制效果的藏品，都不能对这个角色生效，永久屏蔽。
 *
 * 【为什么测"效果类别"而不是测那两个 id？】
 * 因为要求里明说了"之后新增任何……" —— 写死 id 的实现早晚会漏。
 * 所以下面既测那三件（拟态物质 / 博士投影 / 突变细胞），
 * 也直接测"判据本身"：凡是 `onEquip.prep.kind` 属于这三类的都算。
 */
describe('★ 0.1.1：彩蛋角色永久屏蔽升星 / 复制类藏品', () => {
  /** 把彩蛋发到备战席，返回它的 uid */
  function grantEgg(state: GameState): number {
    state.economy.level = 10;
    expect(grantModifierUnit(state, EGG_UNIT_ID, 1).ok).toBe(true);
    const egg = state.economy.bench.find((u) => u.defId === EGG_UNIT_ID);
    expect(egg, '彩蛋应该在备战席上').toBeDefined();
    return egg!.uid;
  }

  /** 把一件 A 类藏品放进藏品栏，返回它的格子下标 */
  function putItem(state: GameState, itemId: string): number {
    expect(addItem(state, itemId).ok).toBe(true);
    return state.items.aSlots.findIndex((id) => id === itemId);
  }

  it('拟态物质 / 博士投影 / 突变细胞 对他全部无效，而且**不会白扣一件藏品**', () => {
    const state = testState(11);
    const eggUid = grantEgg(state);
    const benchBefore = state.economy.bench.length;

    for (const itemId of ['itm_mimic_mass', 'itm_doctor_projection', 'itm_mutant_cell']) {
      const slot = putItem(state, itemId);
      expect(slot, `${itemId} 应该进得了藏品栏`).toBeGreaterThanOrEqual(0);

      const result = equipItemToUnit(state, slot, eggUid);
      expect(result.ok, `${itemId} 不该能装到彩蛋身上`).toBe(false);
      expect(result.message, '提示要说清是"对他无效"').toContain('无效');
      // ★ 关键：失败时藏品必须还在栏里 —— 否则就是"白扣一件"
      expect(state.items.aSlots[slot], `${itemId} 失败后必须还在栏里`).toBe(itemId);
    }

    expect(state.economy.bench.length, '没有复制出多余的干员').toBe(benchBefore);
    expect(state.economy.bench.find((u) => u.uid === eggUid)!.star, '星级没有被改').toBe(1);
  });

  it('普通藏品照旧能给他穿（没有把彩蛋整个排除在装备之外）', () => {
    const state = testState(12);
    const eggUid = grantEgg(state);
    // 挑一件"装上去会留在身上"的普通 A 类藏品
    const normal = WORN_A_ITEMS.find((id) => !isUnitTransformingItem(ITEM_DEFS[id]!));
    expect(normal, '应该找得到一件普通 A 类藏品').toBeDefined();

    const slot = putItem(state, normal!);
    const result = equipItemToUnit(state, slot, eggUid);
    expect(result.ok, `${normal} 应该能装到彩蛋身上`).toBe(true);
    expect(state.economy.bench.find((u) => u.uid === eggUid)!.items ?? []).toContain(normal);
  });

  it('普通干员照旧能吃这三件（规则只针对彩蛋）', () => {
    /*
      ★ 每件用一个**全新状态**：拟态物质会复制一只同款、三个一星就当场合成两星，
      留着同一个状态往下测的话，博士投影（要求 1 星）就会因为"已经两星了"而失败 ——
      那是测试自己造出来的假失败。
    */
    let seed = 13;
    for (const itemId of ['itm_mimic_mass', 'itm_doctor_projection', 'itm_mutant_cell']) {
      const state = testState(seed++);
      state.economy.bench = [];
      const uid = grantOne(state);
      const slot = putItem(state, itemId);
      const result = equipItemToUnit(state, slot, uid);
      expect(result.ok, `${itemId} 对普通干员应该照旧可用：${result.message}`).toBe(true);
    }
  });

  it('判据按**效果类别**走：以后新加的同类藏品会自动被挡住', () => {
    // 直接把三件"改造本体"的和几件其它效果的对一遍，确认判据不是写死 id
    expect(isUnitTransformingItem(ITEM_DEFS['itm_mimic_mass']!)).toBe(true); // 复制一只
    expect(isUnitTransformingItem(ITEM_DEFS['itm_doctor_projection']!)).toBe(true); // 升星
    expect(isUnitTransformingItem(ITEM_DEFS['itm_mutant_cell']!)).toBe(true); // 变身高一费
    for (const item of Object.values(ITEM_DEFS)) {
      const kind = item.onEquip?.prep?.kind;
      if (!kind) continue;
      const expected = kind === 'upgradeStar' || kind === 'cloneOneStar' || kind === 'transformCostUp';
      expect(isUnitTransformingItem(item), `${item.id}（${kind}）的判定不对`).toBe(expected);
    }
  });
});

// ============================================================
//  ★ 0.1.1 藏品二版（30 件）—— 客户端侧的规则
// ============================================================
//
// 【这一段盯什么？】
// 二版藏品里有一半是"不在战斗内核里"的东西：商店价格、备战席招募、
// 效果栏的数据源、跨回合叠层。它们的共同点是**失效了也不报错**：
// 价格显示 +2 但扣钱还是原价、招募了但藏品没销毁、叠层永远停在 0……
// 这些只有单独钉住才拦得住。

describe('★ 剑锤：往后买干员 +2 金（显示价与扣钱必须是同一个数）', () => {
  it('装载后价格 +2；只是躺在存放栏里不算', () => {
    const state = createGameState(101);
    const def = playableDefs().find((item) => item.cost >= 2)!;
    expect(shopPriceDelta(state)).toBe(0);
    expect(shopPriceOf(state, def)).toBe(def.cost);

    expect(addItem(state, 'itm_sword_hammer').ok, '先放进存放栏').toBe(true);
    expect(shopPriceDelta(state), '躺着不算"装载"').toBe(0);

    const slot = state.items.bSlots.indexOf('itm_sword_hammer');
    expect(equipSharedItem(state, slot, 0).ok).toBe(true);
    expect(shopPriceDelta(state)).toBe(2);
    expect(shopPriceOf(state, def)).toBe(def.cost + 2);
  });

  it('★ 真的照这个数扣钱（买一手看看，不能"显示 1 金、扣 3 金"）', () => {
    const state = createGameState(102);
    state.phase = 'prep';
    state.economy.gold = 50;
    addItem(state, 'itm_sword_hammer');
    const slot = state.items.bSlots.indexOf('itm_sword_hammer');
    equipSharedItem(state, slot, 0);

    // 直接指定第一格是某个确定的 1 费干员（不走 rollShop，免得受等级概率影响）
    const cheap = playableDefs().find((item) => item.cost === 1)!;
    state.economy.shop[0] = { defId: cheap.id, cost: cheap.cost, sold: false };
    expect(shopPriceOf(state, cheap), '面板 1 金 + 剑锤 2 金').toBe(3);

    const before = state.economy.gold;
    const result = doBuyShopSlot(state, 0);
    expect(result.ok, result.message).toBe(true);
    expect(before - state.economy.gold, '扣的就是 3 金').toBe(3);
  });
});

describe('★ 二版一次性道具：随机招募（人事部铜印 / 博士银印）', () => {
  it('人事部铜印：备战席多一名 1~3 费干员，**占牌库 1 张**，藏品当场销毁', () => {
    const state = createGameState(103);
    state.economy.level = 10;
    const before = state.economy.bench.length;
    addItem(state, 'itm_hr_bronze_seal');
    const slot = state.items.bSlots.indexOf('itm_hr_bronze_seal');
    expect(equipSharedItem(state, slot, 0).ok).toBe(true);

    expect(state.economy.bench.length, '多了一名').toBe(before + 1);
    const added = state.economy.bench[state.economy.bench.length - 1]!;
    const def = UNIT_DEFS[added.defId]!;
    expect(def.cost).toBeGreaterThanOrEqual(1);
    expect(def.cost).toBeLessThanOrEqual(3);
    /*
      ★ 0.1.1 新口径（用户要求）：招募到的干员**真的从牌库拿**，所以不标 free ——
      1★ 占 1 张，卖掉会还回去。（以前是 free:true 白送、不占牌库。）
    */
    expect(added.free, '不再标 free —— 招募来的要占牌库').toBeUndefined();
    expect(poolCopiesOfUnit(added), '1★ 占 1 张').toBe(1);
    expect(state.items.bSlots[slot], '一次性道具当场销毁').toBeNull();
    expect(state.items.bEquip[0], '不占共享装备位').toBeNull();
  });

  it('博士银印：抽的是 4~5 费', () => {
    const state = createGameState(104);
    state.economy.level = 10;
    addItem(state, 'itm_doc_silver_seal');
    const slot = state.items.bSlots.indexOf('itm_doc_silver_seal');
    expect(equipSharedItem(state, slot, 0).ok).toBe(true);

    const added = state.economy.bench[state.economy.bench.length - 1]!;
    const def = UNIT_DEFS[added.defId]!;
    expect(def.cost).toBeGreaterThanOrEqual(4);
    expect(def.cost).toBeLessThanOrEqual(5);
  });

  it('★ 牌库抽干了就改发金币（按"本该抽到的那名"的花费）', () => {
    const state = createGameState(107);
    state.economy.level = 10;
    // 服务器报回来的牌库里，1~3 费全空（用网库视图模拟）
    const empty: Record<string, number> = {};
    for (const def of playableDefs()) empty[def.id] = def.cost <= 3 ? 0 : 99;
    setNetPoolView(empty, null, 'me');
    try {
      const goldBefore = state.economy.gold;
      const benchBefore = state.economy.bench.length;
      addItem(state, 'itm_hr_bronze_seal');
      const slot = state.items.bSlots.indexOf('itm_hr_bronze_seal');
      const result = equipSharedItem(state, slot, 0);

      expect(result.ok, '道具照样消耗掉').toBe(true);
      expect(state.economy.bench.length, '招不到人就不该进备战席').toBe(benchBefore);
      const gained = state.economy.gold - goldBefore;
      expect(gained, `补偿 ${gained} 金`).toBeGreaterThanOrEqual(1);
      expect(gained, '补偿不该超过该区间最高费').toBeLessThanOrEqual(3);
    } finally {
      // 模块级的网库视图是全局状态 —— 用完必须清掉，否则影响后面的用例
      setNetPoolView(null);
    }
  });

  it('★ 备战席满了就不让用（不能白扔一件藏品）', () => {
    const state = createGameState(105);
    state.economy.level = 10;
    // 直接塞满（不经过 grantModifierUnit，免得三个同款当场合成又腾出位置）
    while (state.economy.bench.length < BENCH_SLOTS) {
      state.economy.bench.push({ uid: 90000 + state.economy.bench.length, defId: DEF_ID, star: 1 });
    }

    addItem(state, 'itm_hr_bronze_seal');
    const slot = state.items.bSlots.indexOf('itm_hr_bronze_seal');
    const result = equipSharedItem(state, slot, 0);
    expect(result.ok).toBe(false);
    expect(result.message).toContain('备战席满');
    expect(state.items.bSlots[slot], '藏品还在（没被销毁）').toBe('itm_hr_bronze_seal');
  });

  /*
    ★ 联机：牌库是 8 个人共享的，"扣牌"必须服务器裁决 ——
    所以上面那个"接上仲裁者"的分支必须真的只有一处落地（applyRecruitResult）。
  */
  it('★ 联机时把申请交给服务器，本地不抽（结果回来再落地）', () => {
    const state = createGameState(108);
    state.economy.level = 10;
    const requests: Array<{ minCost: number; maxCost: number; seed: number }> = [];
    state.recruitRequest = (req) => requests.push(req);

    addItem(state, 'itm_doc_silver_seal');
    const slot = state.items.bSlots.indexOf('itm_doc_silver_seal');
    const benchBefore = state.economy.bench.length;
    const result = equipSharedItem(state, slot, 0);

    expect(result.ok).toBe(true);
    expect(result.message, '要告诉玩家在等服务器').toContain('服务器');
    expect(state.items.bSlots[slot], '道具当场销毁（不等回执）').toBeNull();
    expect(state.economy.bench.length, '本地不许自己塞人').toBe(benchBefore);
    expect(requests).toHaveLength(1);
    expect(requests[0]!.minCost).toBe(4);
    expect(requests[0]!.maxCost).toBe(5);

    // 回执到了 -> 走同一处落地
    const message = applyRecruitResult(state, requests.length > 0 ? 'op01' : 'op01', 0);
    expect(message).toContain('招募到');
    expect(state.economy.bench.length).toBe(benchBefore + 1);
    expect(state.economy.bench[state.economy.bench.length - 1]!.free, '招募来的占牌库').toBeUndefined();
    // 牌库空了那条回执 -> 改发金币
    const goldBefore = state.economy.gold;
    const goldMessage = applyRecruitResult(state, null, 4);
    expect(state.economy.gold - goldBefore).toBe(4);
    expect(goldMessage).toContain('金币');
  });
});

describe('★ 「共享藏品效果」栏的数据源（activeItemEffects）', () => {
  it('只收"共享装备位里的"（A 类挂在干员身上，不归这一栏）', () => {
    const state = createGameState(106);
    addItem(state, 'itm_live_rose');
    const slot = state.items.bSlots.indexOf('itm_live_rose');
    equipSharedItem(state, slot, 0);

    const list = activeItemEffects(state);
    expect(list.map((entry) => entry.item.id)).toEqual(['itm_live_rose']);
    expect(list[0]!.lines.length, '效果全文要能显示').toBeGreaterThan(0);
    expect(list[0]!.permanent).toBeFalsy();
  });

  it('★ 实时数值：成长类按当前层数算（圆石祭坛 3 层 → 攻击 / 护甲 / 魔抗 +15%）', () => {
    const state = createGameState(109);
    addItem(state, 'itm_pebble_altar');
    const slot = state.items.bSlots.indexOf('itm_pebble_altar');
    equipSharedItem(state, slot, 0);
    // ★ 0.2：层数逐副本记（bEquipLayers 和 bEquip 同下标）
    state.items.bEquipLayers[state.items.bEquip.indexOf('itm_pebble_altar')] = 3;

    const entry = activeItemEffects(state).find((e) => e.item.id === 'itm_pebble_altar')!;
    expect(entry.layers, '层数标签照旧').toBe(3);
    expect(entry.values.join(' · '), '要给的是"现在吃到多少"').toContain('攻击力 +15%');
    expect(entry.values.join(' · '), '不许贴内部写法').not.toMatch(/tick|active=|修正包|=/);
  });

  it('★ 实时数值：金币门槛会跟着当前金币变（金酒之杯）', () => {
    const state = createGameState(110);
    addItem(state, 'itm_gin_cup');
    const slot = state.items.bSlots.indexOf('itm_gin_cup');
    equipSharedItem(state, slot, 0);

    state.economy.gold = 20;
    const low = activeItemEffects(state).find((e) => e.item.id === 'itm_gin_cup')!;
    expect(low.values.join('')).toContain('攻速 +12%');

    state.economy.gold = 100;
    const high = activeItemEffects(state).find((e) => e.item.id === 'itm_gin_cup')!;
    expect(high.values.join('')).toContain('攻速 +60%');
  });

  it('★ 失落之钥：本体早就销毁了，但永久效果一直列着', () => {
    const state = createGameState(107);
    addItem(state, 'itm_lost_key');
    const slot = state.items.bSlots.indexOf('itm_lost_key');
    expect(equipSharedItem(state, slot, 0).ok).toBe(true);
    expect(state.items.bEquip.every((entry) => entry === null), '不占装备位').toBe(true);

    const entry = activeItemEffects(state).find((item) => item.item.id === 'itm_lost_key');
    expect(entry, '永久效果必须还在').toBeDefined();
    expect(entry!.permanent).toBe(true);
  });

  it('★ 会叠层的共享藏品要把层数带出来（黑流树海笔记）', () => {
    const state = createGameState(108);
    addItem(state, 'itm_blackflow_notes');
    const slot = state.items.bSlots.indexOf('itm_blackflow_notes');
    equipSharedItem(state, slot, 0);

    expect(activeItemEffects(state)[0]!.layers, '0 层不显示（那是噪声）').toBeUndefined();
    // ★ 0.2：层数改成逐副本记（bEquipLayers 和 bEquip 同下标）
    state.items.bEquipLayers[state.items.bEquip.indexOf('itm_blackflow_notes')] = 5;
    expect(activeItemEffects(state)[0]!.layers).toBe(5);
  });
});

describe('★ 跨回合成长：什么时候 +1、什么时候清零', () => {
  /** 把一件 A 类藏品装到备战席上第一个干员身上 */
  function wear(state: GameState, itemId: string): number {
    state.economy.level = 10;
    expect(addItem(state, itemId).ok).toBe(true);
    const uid = grantOne(state);
    const slot = state.items.aSlots.indexOf(itemId);
    expect(equipItemToUnit(state, slot, uid).ok).toBe(true);
    return uid;
  }

  /**
   * ★ 0.2：层数现在记在**这一件副本**上（`unit.itemLayers[i]`），
   * 不再是一张 `growth[itemId]` 全局表 —— 所以断言要读"这个干员身上第几件"。
   * 同名藏品各叠各的（见 item-copy-layers.test.ts）。
   */
  function layersOf(state: GameState, uid: number, index = 0): number {
    const unit =
      state.economy.bench.find((entry) => entry.uid === uid) ??
      state.placements.find((entry) => entry.uid === uid);
    return unit?.itemLayers?.[index] ?? 0;
  }

  it('★ 佣兵的饰物：每赢一场 +1 层，卸下清零', () => {
    const state = testState(109);
    const uid = wear(state, 'itm_mercenary_trinket');

    applyItemGrowthAfterBattle(state, { won: true, kills: 0, round: 2 });
    applyItemGrowthAfterBattle(state, { won: true, kills: 0, round: 3 });
    expect(layersOf(state, uid)).toBe(2);

    expect(unequipItemFromUnit(state, uid, 0).ok).toBe(true);
    expect(layersOf(state, uid), '卸下即重置').toBe(0);
  });

  it('★ 仇名录：击倒几名就 +几层；野怪回合不算（设计稿写明的）', () => {
    const state = testState(110);

    const uid = wear(state, 'itm_grudge_list');
    applyItemGrowthAfterBattle(state, { won: true, kills: 3, round: 3 });
    expect(layersOf(state, uid)).toBe(3);

    // 第 9 回合是野怪回合（isMonsterRound：r===1 或 (r-2)%7===0）
    applyItemGrowthAfterBattle(state, { won: true, kills: 5, round: 9 });
    expect(layersOf(state, uid), '野怪回合不加').toBe(3);
  });

  it('★ 黑流树海笔记：不管输赢，每过一回合就 +1 层', () => {
    const state = createGameState(111);
    addItem(state, 'itm_blackflow_notes');
    const slot = state.items.bSlots.indexOf('itm_blackflow_notes');
    equipSharedItem(state, slot, 0);

    const bIndex = state.items.bEquip.indexOf('itm_blackflow_notes');
    applyItemGrowthAfterBattle(state, { won: false, kills: 0, round: 3 });
    expect(state.items.bEquipLayers[bIndex]).toBe(1);
    applyItemGrowthAfterBattle(state, { won: true, kills: 2, round: 4 });
    expect(state.items.bEquipLayers[bIndex]).toBe(2);
  });

  it('★ 黑流树海笔记的额外金币：层数不够就是 0（输了也没有）', () => {
    const state = createGameState(112);
    addItem(state, 'itm_blackflow_notes');
    const slot = state.items.bSlots.indexOf('itm_blackflow_notes');
    equipSharedItem(state, slot, 0);

    const bIndex = state.items.bEquip.indexOf('itm_blackflow_notes');
    expect(itemGrowthGold(state, true), '0 层').toBe(0);
    state.items.bEquipLayers[bIndex] = 4; // 每 5 层算一步 -> 还是 0 步
    expect(itemGrowthGold(state, true)).toBe(0);
    expect(itemGrowthGold(state, false), '输了不给').toBe(0);
  });
});

describe('★ 剑锤：拿到后 2 回合还没装载就自动销毁', () => {
  it('★ 到期就没了；提前装载则不再计时', () => {
    const state = createGameState(113);
    expect(addItem(state, 'itm_sword_hammer').ok).toBe(true);
    expect(state.items.gainedRound['itm_sword_hammer'], 'addItem 会记下获得时的回合').toBeDefined();

    // 拿到手的那一回合：还没到期
    expect(expireUnsocketedItems(state, state.round)).toHaveLength(0);
    // 过 2 回合：销毁
    const destroyed = expireUnsocketedItems(state, state.round + 2);
    expect(destroyed).toContain(ITEM_DEFS['itm_sword_hammer']!.name);
    expect(state.items.bSlots.includes('itm_sword_hammer'), '栏里已经没了').toBe(false);

    // 另一份：装载之后就永远不会被这条规则收走
    const loaded = createGameState(114);
    addItem(loaded, 'itm_sword_hammer');
    const slot = loaded.items.bSlots.indexOf('itm_sword_hammer');
    equipSharedItem(loaded, slot, 0);
    expect(expireUnsocketedItems(loaded, loaded.round + 9)).toHaveLength(0);
  });
});

describe('★ 击杀数口径：野怪不算（仇名录 / 百战磨练 那条线）', () => {
  it('★ 同一个日志里，野怪击杀不计入"击倒敌人"', () => {
    const normal = playableDefs()[0]!.id;
    const monster = Object.values(UNIT_DEFS).find((def) => def.monsterOnly === true)!.id;

    const log = [
      { type: 'spawn', t: 0, unitId: 1, team: 1, defId: normal, star: 1, cell: { col: 0, row: 0 }, maxHp: 100 },
      { type: 'spawn', t: 0, unitId: 2, team: 1, defId: monster, star: 1, cell: { col: 0, row: 1 }, maxHp: 100 },
      { type: 'death', t: 10, unitId: 1, team: 1, remaining: 1 },
      { type: 'death', t: 20, unitId: 2, team: 1, remaining: 0 },
    ] as unknown as BattleEvent[];

    expect(enemiesKilledBy(log, 0), '只算那个非野怪的').toBe(1);
  });
});

// ============================================================
//  ★ 0.1.3 转职体系：转职藏品 + 变形同构体
// ============================================================
//
// 【这一组盯什么？】
// "谁能装转职""变形同构体变出什么"这两条规则**只存在于客户端**
// （内核只认"这枚棋子有这几个标签"）。所以"标签有没有被正确推导出来、
// 有没有跟着阵容上报"必须在这里钉住 —— 否则内核那边数出来的人数就是错的。

describe('★ 0.1.3 转职藏品：给干员挂一个羁绊', () => {
  /** 一个有 ≥2 个"可转羁绊"的干员（变形同构体那组也要用） */
  const defWithTraits = playableDefs().find(
    (def) => def.traits.filter((trait) => RELIC_ITEM_OF_TRAIT[trait]).length >= 2,
  )!;

  /** 往备战席发一个指定干员，返回 uid */
  function grantDef(state: GameState, defId: string): number {
    state.economy.level = 10;
    expect(grantModifierUnit(state, defId, 1).ok).toBe(true);
    return state.economy.bench[state.economy.bench.length - 1]!.uid;
  }

  it('★ 装上去这名干员就多了一个羁绊，而且会跟着阵容上报（内核靠它数人数）', () => {
    const state = testState(201);
    const uid = grantDef(state, defWithTraits.id);
    // 挑一个他**本来没有**的羁绊
    const borrowed = Object.keys(RELIC_ITEM_OF_TRAIT).find((t) => !defWithTraits.traits.includes(t))!;
    const relicId = RELIC_ITEM_OF_TRAIT[borrowed]!;

    expect(addItem(state, relicId).ok).toBe(true);
    expect(equipItemToUnit(state, state.items.aSlots.indexOf(relicId), uid).ok).toBe(true);

    const unit = state.economy.bench.find((u) => u.uid === uid)!;
    expect(extraTraitsOf(unit)).toEqual([borrowed]);
    expect(traitRelicsOf(unit)).toEqual([relicId]);

    // ★ 放上场之后，上报的阵容里必须带 extraTraits（观战 / 重连 / 内核都读它）
    expect(placeBenchUnitAt(state, uid, { col: 0, row: 1 }).ok).toBe(true);
    expect(toSubmittedTeam(state).units[0]!.extraTraits).toEqual([borrowed]);
    expect(toTeamSetup(state).units[0]!.extraTraits).toEqual([borrowed]);
  });

  it('★ 界面上的羁绊面板也要看到转职（currentTraits 不能丢 extraTraits）', () => {
    /*
      ★ 这条是玩家报的 bug 的回归测试：「转职装上了，界面上羁绊却没生效」。
      根因是 `currentTraits()` 里手挑 defId/star/cell 重建 placement，
      把新加的 extraTraits 静默丢掉了 —— 内核那边（走 toTeamSetup）其实是对的，
      所以光测战斗是测不出来的，必须单独钉界面这一路。
    */
    const state = testState(207);
    const uid = grantDef(state, defWithTraits.id);
    const borrowed = Object.keys(RELIC_ITEM_OF_TRAIT).find((t) => !defWithTraits.traits.includes(t))!;
    const countOf = (): number =>
      currentTraits(state).find((t) => t.traitId === borrowed)?.count ?? 0;

    const before = countOf();
    addItem(state, RELIC_ITEM_OF_TRAIT[borrowed]!);
    equipItemToUnit(state, state.items.aSlots.indexOf(RELIC_ITEM_OF_TRAIT[borrowed]!), uid);
    expect(placeBenchUnitAt(state, uid, { col: 0, row: 1 }).ok).toBe(true);

    expect(countOf(), `界面上【${TRAIT_DEFS[borrowed]!.name}】的人数要算上他`).toBe(before + 1);
  });

  it('★ 卸下之后标签就没了（每次现推，不留残留状态）', () => {
    const state = testState(202);
    const uid = grantDef(state, defWithTraits.id);
    const borrowed = Object.keys(RELIC_ITEM_OF_TRAIT).find((t) => !defWithTraits.traits.includes(t))!;
    const relicId = RELIC_ITEM_OF_TRAIT[borrowed]!;
    addItem(state, relicId);
    equipItemToUnit(state, state.items.aSlots.indexOf(relicId), uid);
    expect(extraTraitsOf(state.economy.bench.find((u) => u.uid === uid)!)).toEqual([borrowed]);

    expect(unequipItemFromUnit(state, uid, 0).ok).toBe(true);
    expect(extraTraitsOf(state.economy.bench.find((u) => u.uid === uid)!), '卸下即失效').toEqual([]);
  });

  it('★ 本来就属于这个羁绊的干员装不上（星熊装不了大炎 / 重装转职）', () => {
    const state = testState(203);
    const uid = grantDef(state, defWithTraits.id);
    const ownTrait = defWithTraits.traits.find((t) => RELIC_ITEM_OF_TRAIT[t])!;
    const relicId = RELIC_ITEM_OF_TRAIT[ownTrait]!;

    addItem(state, relicId);
    const slot = state.items.aSlots.indexOf(relicId);
    const result = equipItemToUnit(state, slot, uid);
    expect(result.ok).toBe(false);
    expect(result.message).toContain('本来就是');
    expect(state.items.aSlots[slot], '★ 拒绝时不能把藏品吞掉').toBe(relicId);
    expect(extraTraitsOf(state.economy.bench.find((u) => u.uid === uid)!)).toEqual([]);
  });
});

describe('★ 0.1.3 变形同构体', () => {
  const defWithTraits = playableDefs().find(
    (def) => def.traits.filter((trait) => RELIC_ITEM_OF_TRAIT[trait]).length >= 2,
  )!;

  function grantDef(state: GameState, defId: string): number {
    state.economy.level = 10;
    expect(grantModifierUnit(state, defId, 1).ok).toBe(true);
    return state.economy.bench[state.economy.bench.length - 1]!.uid;
  }

  it('★ 用掉之后自己销毁，并按羁绊产出一件转职进「穿戴藏品存放栏」', () => {
    const state = testState(204);
    const uid = grantDef(state, defWithTraits.id);
    addItem(state, 'itm_morph_relic');
    const slot = state.items.aSlots.indexOf('itm_morph_relic');

    const result = equipItemToUnit(state, slot, uid);
    expect(result.ok, result.message).toBe(true);
    expect(result.message).toContain('变形成了');

    // ① 自己没了
    expect(state.items.aSlots.includes('itm_morph_relic'), '装备后立刻销毁').toBe(false);
    // ② 产出的转职在**存放栏**里（不是直接装上 —— 用户口径）
    const produced = state.items.aSlots
      .filter((id): id is string => Boolean(id))
      .find((id) => id.startsWith('itm_relic_'));
    expect(produced, '应该产出一件转职藏品').toBeDefined();
    // ③ 而且必须是这名干员**本来就有**的羁绊里的一个
    const producedTrait = ITEM_DEFS[produced!]!.grantsTrait!;
    expect(defWithTraits.traits, '只能是他自己的羁绊').toContain(producedTrait);
    expect(morphCandidatesOf(defWithTraits), '必须落在候选集里').toContain(produced!);
    // ④ 干员身上不该自动多出标签
    expect(extraTraitsOf(state.economy.bench.find((u) => u.uid === uid)!)).toEqual([]);
  });

  it('★ 身上已经有转职的干员用不了（拒绝，而且不消耗变形同构体）', () => {
    const state = testState(205);
    const uid = grantDef(state, defWithTraits.id);
    const borrowed = Object.keys(RELIC_ITEM_OF_TRAIT).find((t) => !defWithTraits.traits.includes(t))!;
    const relicId = RELIC_ITEM_OF_TRAIT[borrowed]!;
    addItem(state, relicId);
    equipItemToUnit(state, state.items.aSlots.indexOf(relicId), uid);

    addItem(state, 'itm_morph_relic');
    const slot = state.items.aSlots.indexOf('itm_morph_relic');
    const result = equipItemToUnit(state, slot, uid);
    expect(result.ok).toBe(false);
    expect(result.message).toContain('已经有');
    expect(state.items.aSlots[slot], '★ 不能白扔一件进阶藏品').toBe('itm_morph_relic');
  });

  it('★ 没有可转羁绊的干员用不了（拒绝，不消耗）', () => {
    /*
      挑一个"羁绊全是没有转职的那种"（龙 / 领导人）。
      找不到就跳过 —— 干员名单会变，写死一个 id 迟早会红。
    */
    const hopeless = playableDefs().find(
      (def) => def.traits.length > 0 && def.traits.every((trait) => !RELIC_ITEM_OF_TRAIT[trait]),
    );
    if (!hopeless) return;

    const state = testState(206);
    const uid = grantDef(state, hopeless.id);
    addItem(state, 'itm_morph_relic');
    const slot = state.items.aSlots.indexOf('itm_morph_relic');
    const result = equipItemToUnit(state, slot, uid);
    expect(result.ok).toBe(false);
    expect(state.items.aSlots[slot], '不能白扔').toBe('itm_morph_relic');
  });
});

// ============================================================
//  ★★ 0.2（用户 2026-10-17）：两条藏品相关的修正
// ============================================================

describe('★★ 老蒲扇：只算"激活的"羁绊（用户 2026-10-17）', () => {
  /** 找几个带某个标签的真实干员 */
  const opsWith = (trait: string, n: number): string[] =>
    playableDefs()
      .filter((def) => def.traits.includes(trait))
      .slice(0, n)
      .map((def) => def.id);

  function put(state: GameState, defIds: readonly string[]): void {
    state.placements = defIds.map((defId, index) => ({
      uid: 10_000 + index,
      defId,
      star: 1,
      cell: { col: 1 + (index % 4), row: 1 + Math.floor(index / 4) },
    })) as unknown as GameState['placements'];
  }

  it('★ 有人带了标签但人数不够 -> 不算一个"激活的羁绊"', () => {
    const state = createGameState(2026);
    // 3 个萨卡兹（萨卡兹 2 人档就激活）+ 1 个拉特兰（拉特兰要 3 人，未激活）
    put(state, [...opsWith('sarkaz', 3), ...opsWith('laterano', 1)]);

    const ids = activeTraitIdsOf(state);
    expect(ids, '只有萨卡兹凑够了档位').toContain('sarkaz');
    expect(ids, '拉特兰只有 1 个人，不该算').not.toContain('laterano');
    expect(activeTraitCountOf(state), '激活数 = 1').toBe(1);
  });

  it('★★ 提示里的"已激活 N 个羁绊" = 实战里老蒲扇真的给几层', () => {
    const state = createGameState(2026);
    put(state, [...opsWith('sarkaz', 3), ...opsWith('laterano', 1)]);
    const count = activeTraitCountOf(state);

    // 和开战同一个入口：resolveSharedItems（每层 +10% 攻击力）
    const shared = resolveSharedItems(['itm_old_fan'], toSubmittedTeam(state).units, UNIT_DEFS, {
      gold: 0,
      hp: 100,
    });
    const bonus = shared.teamBonuses
      .filter((item) => item.effect === 'attackDamageBp')
      .reduce((sum, item) => sum + item.value, 0);

    expect(bonus, '实战里每层 +1000bp（10%）').toBe(count * 1000);
  });

  it('★ 转职藏品凑出来的羁绊也要算进去（extraTraits）', () => {
    const state = createGameState(2026);
    const mujicaRelic = RELIC_ITEM_OF_TRAIT['mujica']!;
    // 3 件 MujicaAve 转职（3 档就激活）
    state.placements = ['op01', 'op02', 'op03'].map((defId, index) => ({
      uid: 20_000 + index,
      defId,
      star: 1,
      cell: { col: 1 + index, row: 1 },
      items: [mujicaRelic],
      extraTraits: ['mujica'],
    })) as unknown as GameState['placements'];

    expect(activeTraitIdsOf(state)).toContain('mujica');
  });
});

describe('★★ 失落之钥：10 级才装上也要拿到 50 金（用户 2026-10-17）', () => {
  it('★ 满级 + 装上失落之钥 -> 立刻 +50 金（且只发一次）', () => {
    // ★ 用**非测试模式**的状态：测试模式的「无限金币」会在收尾时把金币补回固定值，
    //   那样根本量不出 "+50"（这不是被测代码的问题，是测量环境的问题）。
    const state = createGameState(2026);
    state.economy.level = MAX_LEVEL;
    expect(addItem(state, 'itm_lost_key').ok, '失落之钥该进共享藏品栏').toBe(true);
    const before = state.economy.gold;

    expect(equipSharedItem(state, 0, 0).ok, '装上（装备位 1）').toBe(true);
    expect(state.items.permanent.lostKey, '记下本局永久效果').toBe(true);
    expect(state.economy.gold - before, '十级装备也要拿到满级奖励').toBe(50);

    // 再装一次（模拟第二把 / 重复触发）不会重复发钱
    const afterFirst = state.economy.gold;
    addItem(state, 'itm_lost_key');
    equipSharedItem(state, 0, 1);
    expect(state.economy.gold).toBe(afterFirst);
  });

  it('★ 没到十级装：不发钱，等升到十级那一刻才发', () => {
    const state = createGameState(2026);
    state.economy.level = 9;
    addItem(state, 'itm_lost_key');
    const before = state.economy.gold;
    equipSharedItem(state, 0, 0);
    expect(state.economy.gold, '九级不该发').toBe(before);
    expect(state.items.permanent.lostKeyPaid).toBe(false);
  });
});
