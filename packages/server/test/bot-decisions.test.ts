/**
 * ============================================================
 *  ★★ 0.3.3 人机：决策质量（藏品 / 摆位去重 / 刷新找升星）
 * ============================================================
 *
 * 【为什么单独立一个文件？】
 * 用户报的三个问题里，有两个是**同一类 bug**：
 *   · 「困难不会装备藏品」—— `tryEquip()` **写了，但一整局都没走到**；
 *   · 「放的牌大部分是重复的」—— 摆位复用了"买牌"的评分，而这两件事
 *     对"同名"的偏好恰恰是**相反**的。
 * 这两个都不是"跑不通"，而是"跑得通、结果是错的"，端到端测试看不见：
 *   对局照样能打完、服务器不报错、测试全绿。
 *
 * 所以这里用两条钉子把它钉死：
 *   ① **源码级**：断言决策链的顺序（防止"装藏品"又被挤到预算吃不到的地方）；
 *   ② **行为级**：直接喂一份 state 给大脑，断言它**真的**把藏品装上去了、
 *      场上**不会**同时站两只同名。
 * 大脑的内部 state 是私有的 —— 这里用一个显式声明的 `BrainInternals` 转型拿，
 * 不为了测试去改动生产代码的可见性（生产代码一改，这类 bug 又回来了）。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BENCH_SLOTS, UNIT_DEFS, familyKeyOf, type ClientMessage } from '../../shared/src/index.js';
import { placeBenchUnitAt, type GameState } from '../../../apps/web/src/game/state.js';
import type { ShopRoundSlot } from '../../../apps/web/src/game/shop-round.js';
import { BotBrain } from '../src/bot.js';

/** 只暴露这个用例需要摸到的私有成员（刻意不改动 bot.ts 的可见性） */
interface BrainInternals {
  state: GameState;
  tryEquip(): boolean;
  tryPlace(): boolean;
  tryReroll(): boolean;
  tryShopRound(): boolean;
  trySell(): boolean;
  onGameStarted(round: number, phase?: string): void;
}

type Difficulty = 'easy' | 'normal' | 'hard';

function makeBrain(difficulty: Difficulty) {
  const sent: ClientMessage[] = [];
  const brain = new BotBrain({
    playerId: 'bot:ROOM01:1',
    roomCode: 'ROOM01',
    difficulty,
    speed: 0, // 这里不等它自己走拍子，全部手动点
    send: (message) => {
      sent.push(message);
    },
  });
  return { brain, sent, inner: brain as unknown as BrainInternals };
}

/** 往备战席塞一只棋子并直接摆到指定格子（绕过买牌，省掉牌库/金币的干扰） */
function putOnBoard(state: GameState, defId: string, star: number, col: number, row: number): number {
  const uid = 9000 + state.placements.length + state.economy.bench.length;
  state.economy.bench.push({ uid, defId, star });
  const result = placeBenchUnitAt(state, uid, { col, row });
  expect(result.ok, `摆 ${defId} 到 (${col},${row}) 失败：${result.message}`).toBe(true);
  return uid;
}

function putOnBench(state: GameState, defId: string, star: number): number {
  const uid = 9000 + state.placements.length + state.economy.bench.length;
  state.economy.bench.push({ uid, defId, star });
  return uid;
}

/** 场上某一族棋子的数量（和羁绊数人头同一口径） */
function boardFamilyCount(state: GameState, defId: string): number {
  const key = familyKeyOf(defId);
  return state.placements.filter((p) => familyKeyOf(p.defId) === key).length;
}

const BOT_SRC_PATH = new URL('../src/bot.ts', import.meta.url);

describe('★★ 源码级：装藏品必须排在花钱之前', () => {
  /*
    ★★ 这是"困难不会装备藏品"的**直接根因**，必须钉住。
    一个回合的动作预算（`maxActions`）是有限的，而「买牌 → 刷新 → 再买」
    这条链可以轻松把预算吃光。装备只要排在后面，就一整局都轮不到 ——
    代码是对的、测试也是绿的、游戏里却永远看不到藏品被装上。
  */
  it('★ tick() 的决策链里 tryEquip 必须排在 tryBuy 之前', () => {
    const src = readFileSync(BOT_SRC_PATH, 'utf8');
    const head = src.indexOf('const didSomething =');
    expect(head, '★ 找不到决策链（tick 被重写了？这条测试也要跟着改）').toBeGreaterThan(-1);
    const chain = src.slice(head, head + 400);
    const equipAt = chain.indexOf('tryEquip');
    const buyAt = chain.indexOf('tryBuy');
    expect(equipAt, '★ tryEquip 被移出决策链了').toBeGreaterThan(-1);
    expect(buyAt, '★ tryBuy 被移出决策链了').toBeGreaterThan(-1);
    expect(
      equipAt,
      '★★ 装藏品不能排在买牌后面 —— 预算会被"买/刷新"吃光，一整局都轮不到装备',
    ).toBeLessThan(buyAt);
  });
});

describe('★★ 人机：困难档会使用藏品', () => {
  it('★★ 困难档把穿戴藏品（A 类）装到场上干员身上', () => {
    const { brain, inner } = makeBrain('hard');
    const state = inner.state;
    putOnBoard(state, 'op03', 1, 0, 0);

    state.items.aSlots[0] = 'itm_bulwark';
    expect(inner.tryEquip()).toBe(true);

    expect(state.items.aSlots[0], '装上去之后存放栏那一格必须清空').toBeNull();
    expect(state.placements[0]?.items ?? []).toContain('itm_bulwark');
    brain.dispose();
  });

  it('★★ 困难档把共享藏品（B 类）塞进共享装备位', () => {
    const { brain, inner } = makeBrain('hard');
    const state = inner.state;
    state.items.bSlots[0] = 'itm_terrain_map';
    expect(inner.tryEquip()).toBe(true);
    expect(state.items.bEquip).toContain('itm_terrain_map');
    expect(state.items.bSlots[0]).toBeNull();
    brain.dispose();
  });

  it('藏品装完就没了，不会重复装同一件', () => {
    const { brain, inner } = makeBrain('hard');
    const state = inner.state;
    putOnBoard(state, 'op03', 1, 0, 0);
    state.items.aSlots[0] = 'itm_bulwark';
    expect(inner.tryEquip()).toBe(true);
    // 库里已经空了：再试一次不能凭空变出第二件
    expect(inner.tryEquip()).toBe(false);
    brain.dispose();
  });

  it('★ 场上还没人时装备备战席：开局第一回合的藏品不会白等到第二回合', () => {
    const { brain, inner } = makeBrain('hard');
    const state = inner.state;
    putOnBench(state, 'op03', 1);
    state.items.aSlots[0] = 'itm_bulwark';
    expect(inner.tryEquip()).toBe(true);
    expect(state.economy.bench[0]?.items ?? []).toContain('itm_bulwark');
    brain.dispose();
  });

  it('★ 普通 / 简单档不用藏品（这是三档难度的区别，不是 bug）', () => {
    for (const difficulty of ['easy', 'normal'] as const) {
      const { brain, inner } = makeBrain(difficulty);
      const state = inner.state;
      putOnBoard(state, 'op03', 1, 0, 0);
      state.items.aSlots[0] = 'itm_bulwark';
      expect(inner.tryEquip(), `${difficulty} 档不该用藏品`).toBe(false);
      expect(state.items.aSlots[0]).toBe('itm_bulwark');
      expect(state.placements[0]?.items ?? []).toHaveLength(0);
      brain.dispose();
    }
  });
});

describe('★★ 人机：上场不摆重复', () => {
  /*
    ★★ 用户报的「放的牌大部分是重复的」。
    买牌时同名是**加分**（3 张 1 星才能合 2 星），
    但上场时同名是**减分**：羁绊按"不同干员"数人头，
    场上摆两只同名只多一个会挨打的单位，对羁绊零贡献。
  */
  it('★★ 场上已经有一只了，备战席上的同名不会跟着上去', () => {
    const { brain, inner } = makeBrain('hard');
    const state = inner.state;
    state.economy.level = 6; // 人口放开，排除"摆不下"这种假阴性

    // 场上先站一只古米
    putOnBoard(state, 'op03', 2, 0, 0);
    // 备战席：一只同名 + 两只别的
    const dupUid = putOnBench(state, 'op03', 1);
    putOnBench(state, 'op11', 1);
    putOnBench(state, 'op09', 1);

    for (let i = 0; i < 6; i++) inner.tryPlace();

    expect(boardFamilyCount(state, 'op03'), '★ 场上不能同时站两只古米').toBe(1);
    expect(
      state.economy.bench.some((unit) => unit.uid === dupUid),
      '★ 那只同名应该留在备战席上等着合成，而不是被摆上去',
    ).toBe(true);
    brain.dispose();
  });

  it('★ 场上不同名之间该上还是会上（不是"摆位整体卡住"的假阳性）', () => {
    const { brain, inner } = makeBrain('hard');
    const state = inner.state;
    state.economy.level = 6;
    putOnBench(state, 'op03', 2);
    putOnBench(state, 'op11', 2);
    putOnBench(state, 'op09', 2);

    let placed = 0;
    for (let i = 0; i < 5; i++) if (inner.tryPlace()) placed++;
    expect(placed, '★ 三只不同的牌一只都摆不上去 = 摆位逻辑坏了').toBeGreaterThan(0);
    expect(state.placements.length).toBeGreaterThan(0);
    brain.dispose();
  });
});

describe('★★ 人机：困难档会逛商店回合（坎诺特）', () => {
  /*
    ★★ 商店回合是这个游戏**藏品的主要来源**（野怪掉落只是零头）。
    完全跳过它 = 一整局只拿得到一两件藏品 ——
    "会不会用藏品"在玩家眼里就等于没发生过。
  */
  function openShelf(state: GameState, slots: Array<Partial<ShopRoundSlot>>): void {
    state.phase = 'shop';
    state.shopRound = {
      open: true,
      mode: 'buy',
      secondsLeft: 60,
      rerolls: 0,
      firstOfGame: true,
      slots: slots.map((slot) => ({
        kind: 'normal',
        price: 5,
        sold: false,
        ...slot,
      })) as ShopRoundSlot[],
    };
  }

  it('★★ 货架上的藏品会被买下来（进自己的藏品栏）', () => {
    const { brain, inner } = makeBrain('hard');
    const state = inner.state;
    state.economy.gold = 40;
    openShelf(state, [{ kind: 'normal', itemId: 'itm_bulwark', price: 5 }]);

    expect(inner.tryShopRound()).toBe(true);
    expect(state.shopRound!.slots[0]!.sold, '买走的那一格要标记卖掉').toBe(true);
    expect(state.economy.gold).toBe(35);
    const stashed = [...state.items.aSlots, ...state.items.bSlots].filter(Boolean);
    expect(stashed).toContain('itm_bulwark');
    brain.dispose();
  });

  it('★★ 干员位走服务器：发 buyCard(count: 3)，回执落到货架那一格', () => {
    const { brain, inner, sent } = makeBrain('hard');
    const state = inner.state;
    state.economy.gold = 40;
    openShelf(state, [{ kind: 'operator', defId: 'op03', star: 2, price: 20 }]);

    expect(inner.tryShopRound()).toBe(true);
    const buy = sent.find((m) => m.t === 'buyCard');
    expect(buy, '★ 2 星干员要从共享牌库扣，必须问服务器').toBeTruthy();
    expect(buy).toMatchObject({ defId: 'op03', count: 3 });

    // 服务器批准 -> 2 星棋子落地（和客户端同一个 applyApprovedShopRoundOperator）
    brain.onServerMessage({ t: 'buyResult', ok: true, defId: 'op03' } as never);
    expect(state.economy.bench.some((u) => u.defId === 'op03' && u.star === 2)).toBe(true);
    brain.dispose();
  });

  it('★★ 服务器拒了之后不会一直重试同一格（否则一回合的动作预算全烧在这上面）', () => {
    const { brain, inner, sent } = makeBrain('hard');
    const state = inner.state;
    state.economy.gold = 40;
    openShelf(state, [{ kind: 'operator', defId: 'op03', star: 2, price: 20 }]);

    expect(inner.tryShopRound(), '第一次要敢问').toBe(true);
    const asked = sent.filter((m) => m.t === 'buyCard').length;
    expect(asked).toBe(1);
    // 服务器拒了（多半是这张牌刚被别人抢走）
    brain.onServerMessage({ t: 'buyResult', ok: false, defId: 'op03' } as never);
    expect(inner.tryShopRound(), '★ 被拒过的一格这一回合不能再惦记').toBe(false);
    expect(sent.filter((m) => m.t === 'buyCard').length).toBe(asked);
    brain.dispose();
  });

  it('★★ 备战席放不下就不问服务器（问了就先扣 3 张，落不了地等于牌凭空消失）', () => {
    const { brain, inner, sent } = makeBrain('hard');
    const state = inner.state;
    state.economy.gold = 40;
    // 备战席塞满（9 格；用不同干员，避免凑成三只自动合成）
    const fillers = ['op01', 'op02', 'op04', 'op05', 'op06', 'op07', 'op08', 'op09', 'op10'];
    for (let i = 0; i < BENCH_SLOTS; i++) putOnBench(state, fillers[i % fillers.length]!, 1);
    expect(state.economy.bench.length).toBe(BENCH_SLOTS);
    openShelf(state, [{ kind: 'operator', defId: 'op03', star: 2, price: 20 }]);
    expect(inner.tryShopRound()).toBe(false);
    expect(sent.filter((m) => m.t === 'buyCard'), '★ 放不下就一个字都别发').toHaveLength(0);
    brain.dispose();
  });

  it('★ 服务器拒了不会留下一个永远卡住的等待（还能转去买别的东西）', () => {
    const { brain, inner } = makeBrain('hard');
    const state = inner.state;
    state.economy.gold = 40;
    openShelf(state, [
      { kind: 'operator', defId: 'op03', star: 2, price: 20 },
      { kind: 'normal', itemId: 'itm_bulwark', price: 5 },
    ]);

    // 先挑分数更高的 2 星干员位
    expect(inner.tryShopRound()).toBe(true);
    brain.onServerMessage({ t: 'buyResult', ok: false, defId: 'op03' } as never);
    /*
      被拒之后：pending 必须清掉（否则永远卡在"等回执"），
      但**不应该**回头再问同一格 —— 转去买得起的那一件藏品。
    */
    expect(inner.tryShopRound()).toBe(true);
    expect(state.shopRound!.slots[0]!.sold, '★ 被拒过的那一格不该再买').toBe(false);
    expect(state.shopRound!.slots[1]!.sold).toBe(true);
    expect([...state.items.aSlots, ...state.items.bSlots].filter(Boolean)).toContain('itm_bulwark');
    brain.dispose();
  });

  it('★ 买不起就不买（不能把金币买成负数）', () => {
    const { brain, inner } = makeBrain('hard');
    const state = inner.state;
    state.economy.gold = 2;
    openShelf(state, [{ kind: 'normal', itemId: 'itm_bulwark', price: 5 }]);
    expect(inner.tryShopRound()).toBe(false);
    expect(state.economy.gold).toBe(2);
    brain.dispose();
  });

  /*
    ★★ 0.3.31 设计更正：**商店回合不是难度轴**。
    它是第 2/4/6 回合自动进入的**对局阶段**，真人玩家谁都躲不掉。
    人机跳过它 ⇒ 连货架上那件 2 星干员都拿不到，跟真人对局根本不是一回事
    （用户报的"AI 不会使用商店回合"就是这条）。
    难度差保留在"买什么"上：只有 traitAware 档会按阵容挑转职（见 `traitRelicScore`）。
  */
  it('★★ 三档人机会都会逛商店回合（这是阶段，不是特权）', () => {
    for (const difficulty of ['easy', 'normal', 'hard'] as const) {
      const { brain, inner } = makeBrain(difficulty);
      const state = inner.state;
      state.economy.gold = 40;
      openShelf(state, [{ kind: 'normal', itemId: 'itm_bulwark', price: 5 }]);
      expect(inner.tryShopRound(), `${difficulty} 档也该逛商店回合`).toBe(true);
      brain.dispose();
    }
  });
});

describe('★★ 人机：有对子时会主动刷新找升星', () => {
  /*
    ★★ 用户报的「卡牌升星率很低」。
    只看"钱够多才刷新"的话，一局下来几乎攒不到那么多钱 ——
    于是一辈子都是 1 星。所以还要有一条：**手上有对子**就去找第三张。
  */
  it('★★ 手上有对子 + 钱够 -> 困难档会刷新商店', () => {
    const { brain, inner } = makeBrain('hard');
    const state = inner.state;
    state.economy.level = 5;
    /*
      ★ 金币刻意压在 `rerollFloor`（困难档 20）**以下**：
      这样"会刷新"这件事只能由"手上有对子"这条理由解释，
      否则上面那条用例会被"钱多"兜住 —— 钱多那条本来就有，
      光测它等于什么都没测。
    */
    state.economy.gold = 13;
    // 两只同名 = 差一张就能升星
    putOnBench(state, 'op03', 1);
    putOnBench(state, 'op03', 1);
    // 货架清空（没有"值得买的"挡在前面）
    for (const slot of state.economy.shop) slot.sold = true;

    const before = state.economy.shop.map((slot) => slot.defId).join('|');
    expect(inner.tryReroll()).toBe(true);
    const after = state.economy.shop.map((slot) => slot.defId).join('|');
    expect(after).not.toBe(before);
    brain.dispose();
  });

  it('★ 手上没有对子又不富裕 -> 不刷新（刷新要有理由）', () => {
    const { brain, inner } = makeBrain('hard');
    const state = inner.state;
    state.economy.gold = 3;
    putOnBench(state, 'op03', 1);
    for (const slot of state.economy.shop) slot.sold = true;
    expect(inner.tryReroll()).toBe(false);
    brain.dispose();
  });
});

/*
  ★★★ 0.3.31（用户报"AI 不会使用商店回合 / 买卖牌不合理 / 后期不买五费"）
  ============================================================
  【为什么这三条必须单独立钉子】
  它们都**不会报错**：对局照样推进、服务器不崩、粒数测试全绿 ——
  但人机在玩家眼里就是"傻"。
*/
describe('★★ 0.3.31 人机：商店回合不能错位', () => {
  it('★★ 进 advanceRound 前要把 round 退回"刚打完的那一回合"', () => {
    /*
      服务端广播的 `gameStarted.round` 已经是**新**回合号，
      而 `advanceRound` 内部按 `state.round` 判"这一回合之后要不要开商店"，判完再 +1。
      以前直接 `= this.round`，等于把判据抬高了一格 ⇒ 人机开商店比服务端早一回合，
      真到商店那回合手上还是上一回合的旧货架。用户报的"不会用商店回合"就是这条链。
    */
    const { inner } = makeBrain('hard');
    // 直接开一局（第 1 回合），然后模拟服务端推进到第 2 回合
    inner.onGameStarted(1, 'prep');
    inner.onGameStarted(2, 'prep');
    expect(inner.state.round, '★ 人机的回合号必须和服务端一致，不能多 1').toBe(2);
  });

  it('★★ 服务端说开商店 -> 人机进 shop 阶段；说不开 -> 收摊', () => {
    const { inner } = makeBrain('hard');
    inner.onGameStarted(1, 'prep');

    // 服务端：第 2 回合先开商店（真实节奏不由这里管，这里只验"听服务端的"）
    inner.onGameStarted(2, 'shop');
    expect(inner.state.phase, '要进 shop 阶段').toBe('shop');
    expect(inner.state.shopRound, '要有货架').toBeTruthy();
    const shelfRound = inner.state.round;

    // 服务端：第 3 回合直接布阵 -> 上一份货架必须收掉
    inner.onGameStarted(3, 'prep');
    expect(inner.state.phase).toBe('prep');
    expect(inner.state.shopRound, '★ 非商店回合不许挂着旧货架（会盖住下一份）').toBeNull();
    expect(inner.state.round).toBe(3);
    expect(inner.state.round).toBeGreaterThan(shelfRound);
  });

  it('★ 商店回合里真的会花钱买东西（不是只站着看）', () => {
    const { brain, inner } = makeBrain('hard');
    inner.onGameStarted(1, 'prep');
    inner.onGameStarted(2, 'shop');
    const state = inner.state;
    state.economy.gold = 120;
    state.economy.level = 8;

    const goldBefore = state.economy.gold;
    const itemsBefore = [...state.items.aSlots, ...state.items.bSlots].filter(Boolean).length;
    const benchBefore = state.economy.bench.length;

    /*
      ★★ 走**真实闭环**：`tryShopRound` 发 `buyCard` 之后会挂起等回执
      （货架上的 2 星干员要服务端批，因为要从共享牌库里扣 3 张）。
      所以这里必须把 `buyResult` 喂回去，否则它一直卡在 pending，
      表现就是"什么都没买" —— 但不是它的锅。
    */
    let acted = 0;
    for (let i = 0; i < 20; i++) {
      const did = inner.tryShopRound();
      if (!did) break;
      acted++;
      const pending = (inner as unknown as { pendingShopIndex: number | null }).pendingShopIndex;
      if (pending !== null) {
        const slot = state.shopRound!.slots[pending]!;
        // 服务端批准 = 扣 3 张牌库后回一条 ok
        brain.onServerMessage({ t: 'buyResult', ok: true, defId: slot.defId ?? '' } as never);
      }
    }
    expect(acted, '至少动过手').toBeGreaterThan(0);
    const itemsAfter = [...state.items.aSlots, ...state.items.bSlots].filter(Boolean).length;
    expect(
      itemsAfter > itemsBefore || state.economy.gold < goldBefore || state.economy.bench.length > benchBefore,
      '★ 金币要变少 / 藏品要变多 —— 一样都没有 = 它什么都没买',
    ).toBe(true);
  });
});

describe('★★ 0.3.31 人机：卖垃圾 + 买五费', () => {
  it('★ 备战席塞满 1~2 费杂鱼 -> 会真的卖掉几张（不再整局背着）', () => {
    const { inner } = makeBrain('hard');
    const state = inner.state;
    state.phase = 'prep';
    state.round = 14;
    state.economy.gold = 50;
    state.economy.level = 8;
    const junk = Object.values(UNIT_DEFS).filter(
      (def) => def.cost <= 2 && !def.summonOnly && !def.monsterOnly && !def.ascendOnly,
    );
    let uid = 700000;
    for (let i = 0; i < BENCH_SLOTS; i++) {
      state.economy.bench.push({ uid: uid++, defId: junk[i % junk.length]!.id, star: 1 });
    }
    let sold = 0;
    for (let i = 0; i < 12; i++) {
      const before = state.economy.bench.length;
      const did = inner.trySell();
      if (state.economy.bench.length < before) sold++;
      if (!did) break;
    }
    expect(sold, '★ 一堆没用的牌必须清掉一些').toBeGreaterThan(0);
    expect(state.economy.bench.length, '清完不能再满').toBeLessThan(BENCH_SLOTS);
  });

  it('★ 能升星的（手上有对子）不许卖', () => {
    const { inner } = makeBrain('hard');
    const state = inner.state;
    state.phase = 'prep';
    state.round = 14;
    state.economy.gold = 50;
    state.economy.level = 8;
    const cheap = Object.values(UNIT_DEFS).find(
      (def) => def.cost === 1 && !def.summonOnly && !def.monsterOnly && !def.ascendOnly,
    )!;
    // 同一个干员塞 3 张（会自动合成，所以这里只塞 2 张 1 星 = 对子）
    state.economy.bench.push({ uid: 810001, defId: cheap.id, star: 1 });
    state.economy.bench.push({ uid: 810002, defId: cheap.id, star: 1 });
    // 再塞几张垃圾把备战席撑到 5 张以上，逼它进入"考虑清理"的区间
    const junk = Object.values(UNIT_DEFS).filter(
      (def) => def.cost <= 2 && def.id !== cheap.id && !def.summonOnly && !def.monsterOnly && !def.ascendOnly,
    );
    for (let i = 0; i < 6; i++) state.economy.bench.push({ uid: 820000 + i, defId: junk[i % junk.length]!.id, star: 1 });

    for (let i = 0; i < 10; i++) {
      if (!inner.trySell()) break;
    }
    expect(
      state.economy.bench.filter((u) => u.defId === cheap.id).length,
      '★ 对子被卖掉 = 前面投入的两张全废',
    ).toBe(2);
  });

  it('★ 中后期商店里同时有 5 费和 1 费 -> 选 5 费', () => {
    const { inner } = makeBrain('hard');
    const state = inner.state;
    state.phase = 'prep';
    state.round = 15;
    state.economy.gold = 60;
    state.economy.level = 9;
    const five = Object.values(UNIT_DEFS).find(
      (def) => def.cost === 5 && !def.summonOnly && !def.monsterOnly && !def.ascendOnly,
    )!.id;
    const one = Object.values(UNIT_DEFS).find(
      (def) => def.cost === 1 && !def.summonOnly && !def.monsterOnly && !def.ascendOnly,
    )!.id;
    state.economy.shop = [
      { defId: five, cost: 5, sold: false },
      { defId: one, cost: 1, sold: false },
      { defId: null, cost: 0, sold: true },
      { defId: null, cost: 0, sold: true },
      { defId: null, cost: 0, sold: true },
    ] as typeof state.economy.shop;
    const pick = (inner as unknown as { bestShopOffer(): { index: number } | null }).bestShopOffer();
    expect(pick, '该买点什么').toBeTruthy();
    expect(state.economy.shop[pick!.index]!.defId, '★ 后期该优先买五费').toBe(five);
  });
});
