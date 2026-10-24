/**
 * ============================================================
 *  ★★ 0.3 盟约：客户端这一侧的四个机制
 * ============================================================
 *
 * 这几个盟约**不在战斗内核里**（除了「命结之秘」，那条在
 * `packages/shared/test/covenant-revive.test.ts`），而是改经济 / 商店 / 藏品：
 *
 *   · 变形同构（cv_shapeshifter）—— 第 4 回合送一件「变形同构体」
 *   · 猎头顾问（cv_zilan）—— 每 2 回合充能一次「特殊刷新」：必定 2 张同名
 *   · 通关奖励（cv_qiliang）—— 每累计花 50 金，从牌库随机送一张牌
 *   · 博学多通（cv_peipei）—— 升到 9 / 10 级各给一次「高费刷新」
 *
 * 【为什么这几条必须单独测？】
 * 它们全都是"**在某个时机悄悄发生**"的效果：不给提示、不影响胜负，
 * 一旦没接上，玩家只会觉得"这个盟约好像没用"，而门禁照样全绿。
 * 所以每条都要断言"真的发生了那件事"，而不是"函数被调用了"。
 */
import { describe, expect, it } from 'vitest';
import { ITEM_DEFS, UNIT_DEFS } from '../../../packages/shared/src/index.js';
import {
  advanceRound,
  buyShopRoundSlot,
  createGameState,
  doBuyShopSlot,
  doBuyXp,
  doRefreshShop,
  enterShopRound,
  isFirstShopOfGame,
  rerollShopRound,
  shopPriceOf,
  shopRoundRerollPrice,
  specialRefreshHint,
  type GameState,
} from '../src/game/state.js';

/** 一个带某个盟约的单机状态（金币给够，免得被"钱不够"挡住） */
function fresh(covenantId: string, gold = 500): GameState {
  const state = createGameState(20261020);
  state.covenantId = covenantId;
  state.economy.gold = gold;
  return state;
}

/** 藏品栏（存放区）里有没有这件 */
function hasItem(state: GameState, itemId: string): boolean {
  return [...state.items.aSlots, ...state.items.bSlots, ...state.items.bEquip].includes(itemId);
}

describe('★ 0.3 盟约「变形同构」：第 4 回合送一件装备', () => {
  it('★★ 第 3 回合打完进第 4 回合时，藏品栏里多一件「变形同构体」', () => {
    const state = fresh('cv_shapeshifter');
    state.round = 3;
    expect(hasItem(state, 'itm_morph_relic'), '一开始不该有').toBe(false);

    advanceRound(state, true, new Set(), 0);
    expect(state.round).toBe(4);
    expect(hasItem(state, 'itm_morph_relic'), '★ 第 4 回合开始时必须真的发下来').toBe(true);
  });

  it('★ 只发一次（后面每回合不再重复发）', () => {
    const state = fresh('cv_shapeshifter');
    state.round = 3;
    advanceRound(state, true, new Set(), 0);
    const before = [...state.items.aSlots, ...state.items.bSlots].filter((id) => id === 'itm_morph_relic').length;
    advanceRound(state, true, new Set(), 0);
    advanceRound(state, true, new Set(), 0);
    const after = [...state.items.aSlots, ...state.items.bSlots].filter((id) => id === 'itm_morph_relic').length;
    expect(after).toBe(before);
  });

  it('★ 没选这个盟约就不会凭空发（别把效果给所有人）', () => {
    const state = fresh('cv_golia');
    state.round = 3;
    advanceRound(state, true, new Set(), 0);
    expect(hasItem(state, 'itm_morph_relic')).toBe(false);
  });
});

describe('★ 0.3 盟约「猎头顾问」：特殊刷新必定 2 张同名', () => {
  it('★★ 充能之后刷一次：商店里出现两张同名，且充能被用掉', () => {
    const state = fresh('cv_zilan');
    state.covenant.headhunt = true;
    const result = doRefreshShop(state);
    expect(result.ok).toBe(true);
    expect(result.message).toContain('猎头顾问');

    const ids = state.economy.shop.map((slot) => slot.defId).filter(Boolean);
    const counts = new Map<string, number>();
    for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
    const maxSame = Math.max(...counts.values());
    expect(maxSame, '★ 必须有 2 张同名').toBeGreaterThanOrEqual(2);
    expect(state.covenant.headhunt, '★ 用掉之后要清空，不能一直特殊').toBe(false);
  });

  it('★ 没充能时就是普通刷新（不会有"必定 2 张"）', () => {
    const state = fresh('cv_zilan');
    expect(state.covenant.headhunt).toBe(false);
    const result = doRefreshShop(state);
    expect(result.ok).toBe(true);
    expect(result.message).not.toContain('猎头顾问');
  });

  it('★ 每 2 回合充一次（第 2、4、6 回合的回合开始）', () => {
    const state = fresh('cv_zilan');
    state.round = 1;
    advanceRound(state, true, new Set(), 0); // -> 2
    expect(state.round).toBe(2);
    expect(state.covenant.headhunt, '第 2 回合该充能').toBe(true);
    // 用掉
    state.covenant.headhunt = false;
    advanceRound(state, true, new Set(), 0); // -> 3（奇数，不充）
    expect(state.covenant.headhunt, '第 3 回合不充').toBe(false);
    advanceRound(state, true, new Set(), 0); // -> 4
    expect(state.covenant.headhunt, '第 4 回合再充').toBe(true);
  });
});

describe('★ 0.3 盟约「通关奖励」：每累计花 50 金送一张牌', () => {
  it('★★ 买经验花够 50 金之后，备战席里多了一张牌', () => {
    const state = fresh('cv_qiliang', 500);
    const benchBefore = state.economy.bench.length;
    // 买经验 4 金一次：买 13 次 = 52 金 > 50
    let granted = '';
    for (let i = 0; i < 13; i += 1) {
      const result = doBuyXp(state);
      if (result.message.includes('通关奖励')) granted = result.message;
    }
    expect(granted, '★ 累计花到 50 金那一次要给出提示').toContain('通关奖励');
    expect(state.economy.bench.length, '★ 每满 50 金要真的往备战席塞一张牌').toBeGreaterThan(benchBefore);
  });

  it('★ 累计是按"花掉的钱"算，不是按"现在有多少钱"', () => {
    const state = fresh('cv_qiliang', 500);
    state.economy.gold = 10; // 钱很少，但之前已经攒了 45
    state.covenant.spent = 45;
    doBuyXp(state); // 花 4 -> 49，还不满 50
    expect(state.covenant.spent).toBe(49);
    expect(state.economy.bench.length).toBe(0);
    // 再花 2 金刷新一次（不是买经验也行）-> 51 => 触发一次，剩 1
    state.economy.gold = 10;
    doRefreshShop(state);
    expect(state.covenant.spent).toBe(1);
  });

  it('★ 没选这个盟约就不记账（也不会送牌）', () => {
    const state = fresh('cv_golia', 500);
    for (let i = 0; i < 20; i += 1) doBuyXp(state);
    expect(state.covenant.spent).toBe(0);
    expect(state.economy.bench.length).toBe(0);
  });
});

describe('★ 0.3 盟约「博学多通」：高费刷新', () => {
  it('★★ 有充能时刷一次：至少 3 格是 5 费（不够用 4 费补）', () => {
    const state = fresh('cv_peipei');
    state.covenant.highTier = 1;
    const result = doRefreshShop(state);
    expect(result.ok).toBe(true);
    expect(result.message).toContain('博学多通');

    const highSlots = state.economy.shop.filter((slot) => slot.defId && (slot.cost === 5 || slot.cost === 4));
    expect(highSlots.length, '★ 至少 3 格是高费').toBeGreaterThanOrEqual(3);
    // 5 费应该占多数（5 费优先，4 费只是补）
    const five = state.economy.shop.filter((slot) => slot.cost === 5).length;
    expect(five).toBeGreaterThanOrEqual(1);
    expect(state.covenant.highTier, '★ 用掉一次').toBe(0);
  });

  it('★ 升到 9 / 10 级各给一次（同级不重复给）', () => {
    const state = fresh('cv_peipei', 100000);
    expect(state.covenant.highTier).toBe(0);
    // 直接改等级 + 走一次"买经验"（升级奖励在买经验那条路上查）
    state.economy.level = 9;
    doBuyXp(state);
    expect(state.covenant.highTier, '9 级给一次').toBe(1);
    doBuyXp(state);
    expect(state.covenant.highTier, '还在 9 级，不重复给').toBe(1);
    state.economy.level = 10;
    doBuyXp(state);
    expect(state.covenant.highTier, '10 级再给一次').toBe(2);
  });

  it('★ 没充能时就是普通刷新', () => {
    const state = fresh('cv_peipei');
    const result = doRefreshShop(state);
    expect(result.message).not.toContain('博学多通');
    expect(state.covenant.highTier).toBe(0);
  });
});

describe('★ 0.3.1 盟约「定向投放」（凯瑟琳）：升级送藏品', () => {
  it('★★ 升到 4 级时随机获得一件藏品', () => {
    const state = fresh('cv_kathryn', 100000);
    state.economy.level = 3;
    // 4 级起每级一件：把等级直接抬到 4，再走一次买经验（升级奖励在买经验那条路上查）
    state.economy.level = 4;
    const before = [...state.items.aSlots, ...state.items.bSlots, ...state.items.bEquip].filter(Boolean).length;
    doBuyXp(state);
    const after = [...state.items.aSlots, ...state.items.bSlots, ...state.items.bEquip].filter(Boolean).length;
    expect(after, '★ 4 级要真的发一件').toBe(before + 1);
    expect(state.covenant.kathrynLevels).toContain(4);
  });

  it('★ 同一级不重复发（连点两次买经验只给一件）', () => {
    const state = fresh('cv_kathryn', 100000);
    state.economy.level = 4;
    doBuyXp(state);
    const afterFirst = [...state.items.aSlots, ...state.items.bSlots].filter(Boolean).length;
    doBuyXp(state);
    const afterSecond = [...state.items.aSlots, ...state.items.bSlots].filter(Boolean).length;
    expect(afterSecond).toBe(afterFirst);
    expect(state.covenant.kathrynLevels.filter((level) => level === 4)).toHaveLength(1);
  });

  it('★ 3 级以前不发', () => {
    const state = fresh('cv_kathryn', 100000);
    state.economy.level = 2;
    doBuyXp(state);
    expect(state.covenant.kathrynLevels).toHaveLength(0);
  });

  it('★ 没选这个盟约就不发', () => {
    const state = fresh('cv_golia', 100000);
    state.economy.level = 5;
    doBuyXp(state);
    expect(state.covenant.kathrynLevels).toHaveLength(0);
  });
});

describe('★ 0.3.1 盟约「特别优惠」（坎诺特）：商店优惠', () => {
  it('★★ 本局第一次商店：3 次免费刷新（不扣钱、不涨价）', () => {
    const state = fresh('cv_cannot', 500);
    enterShopRound(state);
    expect(state.covenant.cannotFreeRerolls).toBe(3);
    expect(shopRoundRerollPrice(state), '免费期间按钮显示 0 金').toBe(0);

    const goldBefore = state.economy.gold;
    rerollShopRound(state);
    expect(state.economy.gold, '免费刷新不扣钱').toBe(goldBefore);
    expect(state.covenant.cannotFreeRerolls).toBe(2);
    expect(state.shopRound!.rerolls, '免费次数不推进涨价阶梯').toBe(0);
  });

  it('★ 3 次用完之后恢复 4 金（不是 16 金）', () => {
    const state = fresh('cv_cannot', 500);
    enterShopRound(state);
    for (let i = 0; i < 3; i++) rerollShopRound(state);
    expect(state.covenant.cannotFreeRerolls).toBe(0);
    expect(shopRoundRerollPrice(state)).toBe(4);
    const goldBefore = state.economy.gold;
    rerollShopRound(state);
    expect(state.economy.gold).toBe(goldBefore - 4);
  });

  it('★★ 每个商店回合第一个购买的藏品 -2 金', () => {
    const state = fresh('cv_cannot', 500);
    enterShopRound(state);
    expect(state.covenant.cannotDiscountLeft).toBe(1);
    const index = state.shopRound!.slots.findIndex((slot) => slot.kind === 'normal' && !slot.sold);
    expect(index, '商店里应该有普通藏品位').toBeGreaterThanOrEqual(0);
    const basePrice = state.shopRound!.slots[index]!.price;
    const goldBefore = state.economy.gold;
    buyShopRoundSlot(state, index);
    expect(state.economy.gold, `应该只扣 ${basePrice - 2} 金`).toBe(goldBefore - (basePrice - 2));
    expect(state.covenant.cannotDiscountLeft, '一个商店回合只能用一次').toBe(0);
  });

  it('★ 第二个藏品不再减价', () => {
    const state = fresh('cv_cannot', 500);
    enterShopRound(state);
    const first = state.shopRound!.slots.findIndex((slot) => slot.kind === 'normal' && !slot.sold);
    buyShopRoundSlot(state, first);
    const second = state.shopRound!.slots.findIndex((slot) => slot.kind === 'normal' && !slot.sold);
    const price = state.shopRound!.slots[second]!.price;
    const goldBefore = state.economy.gold;
    buyShopRoundSlot(state, second);
    expect(state.economy.gold).toBe(goldBefore - price);
  });

  it('★ 没选这个盟约：刷新照常 4 金、没有折扣', () => {
    const state = fresh('cv_golia', 500);
    enterShopRound(state);
    expect(state.covenant.cannotFreeRerolls).toBe(0);
    expect(shopRoundRerollPrice(state)).toBe(4);
    expect(state.covenant.cannotDiscountLeft).toBe(0);
  });
});

describe('★ 数据自检', () => {
  it('「变形同构体」这件藏品真的存在（不然第 4 回合会静默什么都不发）', () => {
    expect(ITEM_DEFS['itm_morph_relic']).toBeTruthy();
  });

  it('「高费刷新」要的数个 5 费干员够用（不然永远只能靠 4 费补）', () => {
    const five = Object.values(UNIT_DEFS).filter((def) => def.cost === 5 && !def.monsterOnly && !def.noCard);
    expect(five.length).toBeGreaterThanOrEqual(3);
  });
});

/**
 * ============================================================
 *  ★★ 0.3.1 回归：判据必须按"真实路径"验，不能只按"函数能跑"验
 * ============================================================
 *
 * 【为什么要补这一组？】
 * 「特别优惠」的三条老用例全是 `enterShopRound(freshState)`（round = 1），
 * 于是判据里那个 `state.round <= FIRST_SHOP_ROUND` 恒为真 —— 三条全绿。
 * 可真实对局里 `advanceRound` 是**先** `round++`（变成 10）**再** `enterShopRound`，
 * `10 <= 9` 恒假 ⇒ 免费刷新一次都发不出来（用户实机报的就是这个），
 * 连带「失落之钥」也永远刷不出来。
 *
 * 教训：涉及"第几回合"的判据，测试必须走**回合号已经 +1 的那条路**。
 */
describe('★ 0.3.1 修：「第一次商店」的判据要认"刚打完的那一回合"', () => {
  it('★★ round 已经是 10（第 9 回合结算完）时，特别优惠照样发 3 次免费刷新', () => {
    const state = fresh('cv_cannot', 500);
    state.round = 10; // ← advanceRound 里 round++ 之后的真实值
    enterShopRound(state);
    expect(state.shopRound!.firstOfGame, '第 9 回合之后开的就是本局第一次商店').toBe(true);
    expect(state.covenant.cannotFreeRerolls, '★ 免费刷新必须真的发下来').toBe(3);
    expect(shopRoundRerollPrice(state)).toBe(0);
  });

  it('★★ 走一遍真的 advanceRound（第 9 回合野怪打完）也拿得到', () => {
    const state = fresh('cv_cannot', 500);
    state.round = 9;
    advanceRound(state, true, new Set(), 0);
    expect(state.round).toBe(10);
    expect(state.shopRound, '第 9 回合之后要开商店').toBeTruthy();
    expect(state.covenant.cannotFreeRerolls).toBe(3);
    // ★ 同一个判据：失落之钥也终于能刷出来了
    expect(state.shopRound!.firstOfGame).toBe(true);
  });

  it('★ 第二次商店（round 已经 17）不再是"第一次"', () => {
    const state = fresh('cv_cannot', 500);
    state.shopRoundCount = 1; // 已经开过一次
    state.round = 17;
    enterShopRound(state);
    expect(isFirstShopOfGame(state)).toBe(false);
    expect(state.covenant.cannotFreeRerolls).toBe(0);
  });
});

describe('★ 0.3.1 修：「通关奖励」要数买干员的钱', () => {
  it('★★ 商店买干员的实付价计入累计消费（这是最常见的一笔）', () => {
    const state = fresh('cv_qiliang', 800);
    const slot = state.economy.shop[0];
    expect(slot, '开局商店应该有货').toBeTruthy();
    const def = UNIT_DEFS[slot!.defId];
    expect(def).toBeTruthy();
    const price = shopPriceOf(state, def!);
    const spentBefore = state.covenant.spent;
    const goldBefore = state.economy.gold;

    const result = doBuyShopSlot(state, 0);
    expect(result.ok).toBe(true);
    expect(state.economy.gold).toBe(goldBefore - price);
    expect(state.covenant.spent, '★ 买棋子的钱必须进盟约账本').toBe(spentBefore + price);
  });
});

describe('★ 0.3.1 特殊刷新：界面要知道哪几格是盟约给的', () => {
  it('★ 猎头顾问：刷出来的前两格被记成"特殊"', () => {
    const state = fresh('cv_zilan', 800);
    state.covenant.headhunt = true;
    expect(specialRefreshHint(state), '充能时界面要提示"下一次是特殊刷新"').toBe('必定 2 张同名');

    doRefreshShop(state);
    expect(state.covenant.specialSlots, '前两格同名').toEqual([0, 1]);
    expect(state.covenant.headhunt, '用掉了').toBe(false);
    expect(specialRefreshHint(state), '用完就不该再挂角标').toBeNull();
  });

  it('★ 没用充能的那一次刷新：标记要清空（不能一直亮着）', () => {
    const state = fresh('cv_zilan', 800);
    state.covenant.headhunt = true;
    doRefreshShop(state);
    expect(state.covenant.specialSlots).toEqual([0, 1]);
    doRefreshShop(state);
    expect(state.covenant.specialSlots, '第二次是普通刷新').toEqual([]);
  });

  it('★ 博学多通：被换成高费的格子记成"特殊"，名额扣一次', () => {
    const state = fresh('cv_peipei', 800);
    state.covenant.highTier = 1;
    expect(specialRefreshHint(state)).toBe('1 次高费刷新');

    doRefreshShop(state);
    expect(state.covenant.specialSlots.length).toBeGreaterThan(0);
    expect(state.covenant.highTier).toBe(0);
    for (const index of state.covenant.specialSlots) {
      const slot = state.economy.shop[index];
      expect(slot, '被标的格子必须真的有货').toBeTruthy();
      expect(UNIT_DEFS[slot!.defId]!.cost, '★ 特殊刷新给的是 5 费（不够用 4 费补）').toBeGreaterThanOrEqual(4);
    }
  });

  /*
    ★★ 0.3.4 修「特殊刷新的金边跑到下一回合去了」。
    用户报的是「梓兰的刷新有 bug，回合不对，而且自动刷新也在其中」：
    手动刷出特殊刷新后，回合结束的**自动刷新**整批换了牌，
    可 `specialSlots` 还留着 —— 于是下一回合开局那批普通牌也被描成特殊刷新。
    这两条同时钉住两件事：自动刷新要清标记、且**绝不消耗**充能（用户口径：只算主动刷新）。
  */
  it('★★ 回合开始的自动刷新：清掉特殊标记，但不消耗充能（梓兰）', () => {
    const state = fresh('cv_zilan', 800);
    state.round = 1;
    advanceRound(state, true, new Set(), 0); // -> 第 2 回合，充能
    expect(state.covenant.headhunt, '第 2 回合该充能').toBe(true);

    doRefreshShop(state);
    expect(state.covenant.specialSlots).toEqual([0, 1]);

    // 回合结束 -> 第 3 回合开始，商店被自动刷新（整批换牌）
    advanceRound(state, true, new Set(), 0);
    expect(state.round).toBe(3);
    expect(state.covenant.specialSlots, '★ 整批换牌了，金边必须跟着清').toEqual([]);
    expect(state.covenant.headhunt, '★ 自动刷新不算"主动刷新"，不能白白吃掉充能').toBe(false);
  });

  it('★★ 自动刷新不吃充能：攒着的那一次能留到下一回合手动用', () => {
    const state = fresh('cv_zilan', 800);
    state.round = 1;
    advanceRound(state, true, new Set(), 0); // -> 2 充能
    expect(state.covenant.headhunt).toBe(true);

    // 这个回合**不刷新**，直接打下一回合
    advanceRound(state, true, new Set(), 0); // -> 3
    advanceRound(state, true, new Set(), 0); // -> 4（再充能一次，本来就是 true）
    expect(state.covenant.headhunt, '一直没用掉，充能要留着').toBe(true);

    const result = doRefreshShop(state);
    expect(result.message, '手动刷的那一次才该触发').toContain('猎头顾问');
    expect(state.covenant.headhunt).toBe(false);
  });

  it('★★ 博学多通同样不能把标记漏到自动刷新上', () => {
    const state = fresh('cv_peipei', 800);
    state.covenant.highTier = 1;
    doRefreshShop(state);
    expect(state.covenant.specialSlots.length).toBeGreaterThan(0);

    advanceRound(state, true, new Set(), 0);
    expect(state.covenant.specialSlots, '★ 自动换牌后不许再标"特殊刷新"').toEqual([]);
    expect(state.covenant.highTier, '自动刷新不该消耗高费刷新名额').toBe(0);
  });
});
