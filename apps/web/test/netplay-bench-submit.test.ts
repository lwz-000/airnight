/**
 * ============================================================
 *  ★ 0.1.1：上报给服务器的阵容里必须带上**备战席**
 * ============================================================
 *
 * 【为什么这一条值得单独钉住？】
 * 服务器以前对备战席一无所知（客户端只发场上的棋子），于是两件事办不到：
 *   · **观战**：点别人看他棋盘时，看不到他手里还攒着什么；
 *   · **淘汰回库**：出局的人手上那些牌还不回去，剩下的人永远抽不到。
 *
 * 而"上报"这条路最容易出的错是**漏字段**（这个项目在 items 上踩过一次：
 * 手拼的 `{defId, star, cell}` 漏了 items，联机里藏品全体失效且完全静默）。
 * 所以这里不测界面，只钉"发出去的这份数据长什么样"。
 *
 * ★ 还有一条容易忽略的：**备战席空着也必须上报空数组**。
 *   否则玩家卖掉最后一张时，服务器手里还是那份旧的，
 *   淘汰回库会凭空多还几张牌（牌库凭空变多，比少几张更难查）。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
// 格子数走 shared 的规格常量（别在测试里写死 10）
import { ITEM_A_SLOTS, ITEM_B_SLOTS } from '../../../packages/shared/src/index.js';
import {
  addItem,
  applySubmittedTeam,
  createGameState,
  grantModifierUnit,
  poolCopiesOfUnit,
  toSubmittedTeam,
} from '../src/game/state.js';

/** 造一个"测试模式"的状态（修改器发的棋子带 free 标记，正好用来验证张数换算） */
function testState(seed = 1) {
  const state = createGameState(seed);
  state.testMode = true;
  return state;
}

describe('★ 0.1.1：阵容上报里的备战席', () => {
  it('备战席里的棋子会随阵容一起报上去，并带上"占牌库几张"', () => {
    const state = testState();
    expect(grantModifierUnit(state, 'op01', 1).ok).toBe(true);
    const benchUnit = state.economy.bench[0]!;

    const submitted = toSubmittedTeam(state);
    expect(submitted.bench, '备战席要出现在上报数据里').toBeDefined();
    expect(submitted.bench).toHaveLength(state.economy.bench.length);
    expect(submitted.bench![0]).toEqual({
      defId: benchUnit.defId,
      star: benchUnit.star,
      // 张数走的是全项目唯一那处换算，测试不自己算
      copies: poolCopiesOfUnit(benchUnit),
    });
  });

  it('备战席空着也要报一个空数组（否则卖光之后服务器还留着旧的）', () => {
    const submitted = toSubmittedTeam(testState(2));
    expect(submitted.bench).toEqual([]);
  });

  it('白送的棋子占 0 张 —— 淘汰回库时不会凭空多还牌', () => {
    const state = testState(3);
    grantModifierUnit(state, 'op01', 1);
    const unit = state.economy.bench[0]!;
    expect(unit.free, '修改器发的棋子应该是白送的').toBe(true);
    expect(toSubmittedTeam(state).bench![0]!.copies).toBe(0);
  });

  it('★ 源码级防回归：备战席由 toSubmittedTeam 统一上报，别在联机代码里手拼第二份', () => {
    // 手拼一份的下场就是"以后加字段只补了一边"（items 那次就是这么漏的）
    const mainSrc = readFileSync(fileURLToPath(new URL('../src/main.ts', import.meta.url)), 'utf8');
    expect(mainSrc, '联机上报告走 toSubmittedTeam 这一个入口').toContain('toSubmittedTeam(state)');
    expect(mainSrc, '不许在 main.ts 里手拼 units/bench 上报').not.toMatch(/submitTeam\(\s*\{\s*units:/);
  });
});

/**
 * ============================================================
 *  ★ 0.1.4：上报里必须带上**藏品栏本体**（库存里还没装的那些）
 * ============================================================
 *
 * 【它修的 bug】"断线重连之后，没装载的藏品全消失了"
 *
 * `SubmittedTeam` 原来只带得出"装着的"那几件：
 *   · `units[].items`  —— 穿在干员身上的 A 类；
 *   · `sharedItems`    —— 共享装备位里的 B 类；
 *   · `itemState.growth` —— 成长**层数**。
 * 而**库存栏**（`aSlots` 10 格 / `bSlots` 5 格，"攒着还没装"的那些）没上报。
 * 刷新页面重连时 `applySubmittedTeam` 会重建本地状态，藏品栏按空来建 ——
 * 成长层数还在、东西没了，玩家一睁眼发现自己辛苦攒的藏品消失。
 *
 * 这一组钉住"报得出去、装得回来"，以及"空栏也要报"
 * （和备战席空数组同一个道理：不报的话会把已经用掉的藏品变回来）。
 */
describe('★ 0.1.4：阵容上报里的藏品栏（重连不丢未装载藏品）', () => {
  /** 一个 A 类 + 一个 B 类，分别落进两个库存栏 */
  function withStoredItems(seed: number) {
    const state = testState(seed);
    expect(addItem(state, 'itm_solvent').ok, 'itm_solvent 是 A 类').toBe(true);
    expect(addItem(state, 'itm_treasure_ring').ok, 'itm_treasure_ring 是 B 类').toBe(true);
    return state;
  }

  it('库存里的藏品会随阵容一起上报', () => {
    const submitted = toSubmittedTeam(withStoredItems(11));
    expect(submitted.itemState?.bag?.a, 'A 类库存要上报').toContain('itm_solvent');
    expect(submitted.itemState?.bag?.b, 'B 类库存要上报').toContain('itm_treasure_ring');
  });

  it('★ 断线重连（刷新页面）之后，没装载的藏品必须还在', () => {
    const before = withStoredItems(12);
    const submitted = toSubmittedTeam(before);

    // 模拟"刷新页面"：本地状态全新，藏品栏一定是空的（这就是 bug 的起点）
    const after = createGameState(12);
    expect(after.items.aSlots.every((slot) => slot === null), '新 state 的库存栏是空的').toBe(true);

    applySubmittedTeam(after, submitted);

    expect(after.items.aSlots, 'A 类库存要按格子原样装回来').toEqual(before.items.aSlots);
    expect(after.items.bSlots, 'B 类库存要按格子原样装回来').toEqual(before.items.bSlots);
  });

  it('空库存栏也要上报 —— 否则重连会把已经用掉的藏品变回来', () => {
    const submitted = toSubmittedTeam(testState(13));
    expect(submitted.itemState?.bag, '空栏也要有 bag（和备战席空数组同一个道理）').toBeDefined();
    expect(submitted.itemState!.bag!.a?.every((slot) => slot === null)).toBe(true);
    expect(submitted.itemState!.bag!.b?.every((slot) => slot === null)).toBe(true);
  });

  it('永久效果（失落之钥）与"第几回合拿到"也一起恢复', () => {
    const before = withStoredItems(14);
    before.items.permanent = { lostKey: true, lostKeyPaid: true };
    const submitted = toSubmittedTeam(before);

    const after = createGameState(14);
    applySubmittedTeam(after, submitted);

    expect(after.items.permanent.lostKey, '失落之钥的永久效果不能丢').toBe(true);
    expect(after.items.permanent.lostKeyPaid, '十级奖励发过没有也要恢复（否则会再发一次 50 金）').toBe(true);
  });

  it('服务器发回来的数据不干净时逐格校验（只认真实藏品 id）', () => {
    const state = createGameState(15);
    applySubmittedTeam(state, {
      units: [],
      itemState: {
        bag: {
          a: ['itm_solvent', '不存在的藏品', null],
          b: ['itm_treasure_ring'],
          // 格子数故意给少/给多都要能夹平
          gainedRound: { itm_solvent: 3, 不存在的藏品: 9 },
        },
      },
    });
    expect(state.items.aSlots[0]).toBe('itm_solvent');
    expect(state.items.aSlots, '不认识的 id 必须当空格').not.toContain('不存在的藏品');
    expect(state.items.aSlots.length, '格子数按本版本规格补齐/截断').toBe(ITEM_A_SLOTS);
    expect(state.items.bSlots.length).toBe(ITEM_B_SLOTS);
    expect(state.items.bSlots[0]).toBe('itm_treasure_ring');
    expect(state.items.gainedRound['itm_solvent']).toBe(3);
    expect(Object.keys(state.items.gainedRound), '不认识的藏品不记回合').toEqual(['itm_solvent']);
  });

  it('★ 源码级防回归：服务端提交白名单必须放行 itemState 里的 bag', () => {
    // 这个项目的"漏字段"事故已经发生过两次（items、bench）——
    // 服务端那个 submitTeam 处理器是**手挑字段**的写法，漏一个就被静默丢掉。
    const serverSrc = readFileSync(
      fileURLToPath(new URL('../../../packages/server/src/main.ts', import.meta.url)),
      'utf8',
    );
    expect(serverSrc, 'itemState 必须原样透传给房间').toContain('itemState: sanitizeItemState(message.itemState)');
    expect(serverSrc, 'sanitizeItemState 必须把 bag 一起带回去，不能只留 growth/unequipped').toContain(
      'sanitizeItemBag',
    );
  });
});
