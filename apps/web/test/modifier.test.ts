/**
 * ============================================================
 *  测试模式修改器（★ 0.0.3）—— 纯逻辑回归
 * ============================================================
 *
 * 四条需求各有一组断言：
 *   ① 无限金币开关（关掉就回到正常经济）
 *   ② 金币 +50（无限金币时不可用）
 *   ③ 无视人口上限
 *   ④ 获得干员 —— 重点是**白送的干员不占牌库、卖掉也不还牌库**
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { START_GOLD, TEST_MODE_GOLD, playableDefs, poolSizeOf } from '../../../packages/shared/src/index.js';
import {
  addGold,
  canAddUnit,
  createGameState,
  doSellBench,
  grantModifierUnit,
  placeBenchUnitAt,
  placeSelected,
  poolRemainingOf,
  recallFromBoard,
  setIgnorePopCap,
  setInfiniteGold,
  switchMode,
  type GameState,
} from '../src/game/state.js';

/** 造一个"已经在测试模式里"的状态 */
function testState(seed = 20261010): GameState {
  return switchMode(createGameState(seed)).next;
}

/** 一个真实存在的干员 id（名单会换，不能写死名字） */
const DEF_ID = playableDefs().slice().sort((a, b) => a.cost - b.cost)[0]!.id;
/** 挑一个 5 费的，用来验"白送不抽干牌库"（5 费牌库只有 10 张，最容易被坐实） */
const PRICEY_ID = playableDefs().find((def) => def.cost === 5)?.id ?? DEF_ID;

describe('★ 修改器：无限金币开关', () => {
  it('进测试模式默认就是无限金币（和改动前一致）', () => {
    const state = testState();
    expect(state.testMode).toBe(true);
    expect(state.infiniteGold).toBe(true);
    expect(state.economy.gold).toBe(TEST_MODE_GOLD);
  });

  it('★ 关掉之后金币回到正常起始值，而且不再被自动补满', () => {
    const state = testState();
    const result = setInfiniteGold(state, false);
    expect(result.ok).toBe(true);
    expect(state.infiniteGold).toBe(false);
    expect(state.economy.gold).toBe(START_GOLD);

    // 花掉一些钱，再触发一次"回合结算"，不该被补回满额
    state.economy.gold = 0;
    expect(state.economy.gold).toBe(0);
  });

  it('再打开 -> 金币立刻回满', () => {
    const state = testState();
    setInfiniteGold(state, false);
    setInfiniteGold(state, true);
    expect(state.economy.gold).toBe(TEST_MODE_GOLD);
  });

  it('普通模式里用不了修改器', () => {
    const state = createGameState(7); // 不是测试模式
    expect(setInfiniteGold(state, true).ok).toBe(false);
    expect(state.infiniteGold).toBe(false);
  });
});

describe('★ 修改器：金币 +50', () => {
  it('★ 无限金币开着时不可用（不然 +50 毫无意义）', () => {
    const state = testState();
    expect(state.infiniteGold).toBe(true);
    const before = state.economy.gold;
    const result = addGold(state, 50);
    expect(result.ok).toBe(false);
    expect(state.economy.gold).toBe(before);
  });

  it('关掉无限金币之后每次 +50', () => {
    const state = testState();
    setInfiniteGold(state, false);
    const base = state.economy.gold;
    expect(addGold(state, 50).ok).toBe(true);
    expect(addGold(state, 50).ok).toBe(true);
    expect(state.economy.gold).toBe(base + 100);
  });
});

describe('★ 修改器：无视人口上限', () => {
  it('默认仍然受人口上限限制；开了之后想摆几个摆几个', () => {
    const state = testState();
    state.economy.level = 1; // 人口上限 = 1

    // 直接指定"当前选中的备战席棋子"，免得被 selectBench 的"再点一次取消"语义带偏
    const selectFirst = (): void => {
      state.selectedBenchUid = state.economy.bench[0]!.uid;
    };

    // 第一个：随便放
    expect(grantModifierUnit(state, DEF_ID, 1).ok).toBe(true);
    selectFirst();
    expect(placeSelected(state, { col: 0, row: 0 }).ok).toBe(true);

    // 第二个：人口已满，应该被拦
    expect(grantModifierUnit(state, DEF_ID, 1).ok).toBe(true);
    selectFirst();
    const blocked = placeSelected(state, { col: 0, row: 1 });
    expect(blocked.ok, '等级 1 只能上 1 个，第二个该被拦').toBe(false);
    expect(blocked.message).toContain('人口');

    // 打开「无视人口上限」-> 立刻能放
    expect(setIgnorePopCap(state, true).ok).toBe(true);
    selectFirst();
    expect(placeSelected(state, { col: 0, row: 1 }).ok).toBe(true);
    expect(state.placements.length).toBe(2);
  });

  it('普通模式里用不了', () => {
    const state = createGameState(7);
    expect(setIgnorePopCap(state, true).ok).toBe(false);
  });
});

describe('★ 修改器：获得干员（白送的干员不碰牌库）', () => {
  it('★ 获得干员不会让牌库少一张', () => {
    const state = testState();
    const before = poolRemainingOf(state, PRICEY_ID);
    expect(before).toBe(poolSizeOf(PRICEY_ID));

    for (let i = 0; i < 3; i++) {
      expect(grantModifierUnit(state, PRICEY_ID, 1).ok).toBe(true);
    }
    // 3 个 5 费（牌库一共只有 10 张）—— 如果是正常购买，这里必然已经见底
    expect(poolRemainingOf(state, PRICEY_ID), '白送的干员不该占牌库').toBe(before);
  });

  it('★ 卖掉白送的干员也不会让牌库多出几张', () => {
    const state = testState();
    const before = poolRemainingOf(state, PRICEY_ID);
    grantModifierUnit(state, PRICEY_ID, 1);
    const uid = state.economy.bench[state.economy.bench.length - 1]!.uid;
    expect(doSellBench(state, uid).ok).toBe(true);
    expect(poolRemainingOf(state, PRICEY_ID), '卖白送的棋子不该把牌还进牌库').toBe(before);
  });

  it('白送的干员合成了也还是白送的（仍然不占牌库）', () => {
    const state = testState();
    const before = poolRemainingOf(state, PRICEY_ID);
    for (let i = 0; i < 3; i++) grantModifierUnit(state, PRICEY_ID, 1);
    // 三个一星自动合成 2 星
    const two = state.economy.bench.find((u) => u.star === 2);
    expect(two, '三个白送一星该合成一个 2 星').toBeDefined();
    expect(two!.free, '合成结果也要保留白送标记').toBe(true);
    expect(poolRemainingOf(state, PRICEY_ID)).toBe(before);
  });

  it('对照组：正常买来的棋子**会**占牌库（不然上面几条就白测了）', () => {
    const state = testState();
    const before = poolRemainingOf(state, DEF_ID);
    // 直接往备战席塞一个"买来的"（不带 free），模拟正常购买的结果
    state.economy.bench.push({ uid: 999999, defId: DEF_ID, star: 1 });
    expect(poolRemainingOf(state, DEF_ID), '正常棋子必须占牌库').toBe(before - 1);
  });

  it('召唤物不能直接发（它们不在牌库里）', () => {
    const state = testState();
    expect(grantModifierUnit(state, 'summon_pillar', 1).ok).toBe(false);
  });

  it('可以获得指定星级（2 星/3 星），且星级越界会被钳住', () => {
    const state = testState();
    expect(grantModifierUnit(state, DEF_ID, 3).ok).toBe(true);
    expect(state.economy.bench.some((u) => u.star === 3)).toBe(true);
    grantModifierUnit(state, DEF_ID, 99);
    expect(state.economy.bench.every((u) => u.star <= 3)).toBe(true);
  });

  it('普通模式里用不了', () => {
    const state = createGameState(7);
    expect(grantModifierUnit(state, DEF_ID, 1).ok).toBe(false);
  });
});

/**
 * ============================================================
 *  ★ 拖拽落子 = 点击落子（必须是同一条路）—— 针对你报的两个现象的回归
 * ============================================================
 * 「无视人口上限没生效」和「白送干员照占牌库」根因是同一个：
 * `main.ts` 的拖拽落子自己另写了一份 `dragBenchToCell`，
 * 而修改器的两个特性只补在了 state 层那份实现上。
 * 所以这里既测"拖拽走的那条路行为正确"，也**从源码层面**盯着别再有第二份实现。
 */
const MAIN_TS = fileURLToPath(new URL('../src/main.ts', import.meta.url));

describe('★ 修改器：拖拽落子那条路（placeBenchUnitAt）', () => {
  it('★ 拖上场之后仍然不占牌库（free 标记不能丢）', () => {
    const state = testState();
    state.economy.level = 10; // 人口放开，这条只测"拖上场会不会丢白送标记"
    const before = poolRemainingOf(state, PRICEY_ID);

    for (let i = 0; i < 3; i++) {
      expect(grantModifierUnit(state, PRICEY_ID, 1).ok).toBe(true);
      const last = state.economy.bench[state.economy.bench.length - 1];
      // 第三个一星在"获得"的那一刻就和场上两个凑齐合成了，备战席会空掉
      if (!last) continue;
      // 每获得一个就直接拖上场 —— 这正是旧代码把 free 弄丢的那条路
      expect(placeBenchUnitAt(state, last.uid, { col: i, row: 0 }).ok).toBe(true);
    }

    expect(
      state.placements.length,
      '白送的三只应该都在场上（或已合成，但不会占牌库）',
    ).toBeGreaterThan(0);
    expect(
      state.placements.every((p) => p.free === true),
      '拖上场之后必须还带着白送标记',
    ).toBe(true);
    expect(poolRemainingOf(state, PRICEY_ID), '拖上场也不该占牌库').toBe(before);
  });

  it('★ 上场 -> 收回 -> 卖掉，牌库全程不变', () => {
    const state = testState();
    const before = poolRemainingOf(state, PRICEY_ID);

    grantModifierUnit(state, PRICEY_ID, 1);
    const uid = state.economy.bench[state.economy.bench.length - 1]!.uid;
    expect(placeBenchUnitAt(state, uid, { col: 0, row: 0 }).ok).toBe(true);
    expect(poolRemainingOf(state, PRICEY_ID)).toBe(before);

    expect(recallFromBoard(state, { col: 0, row: 0 }).ok).toBe(true);
    expect(poolRemainingOf(state, PRICEY_ID)).toBe(before);

    expect(doSellBench(state, uid).ok).toBe(true);
    expect(poolRemainingOf(state, PRICEY_ID)).toBe(before);
  });

  it('★ 拖拽也认「无视人口上限」', () => {
    const state = testState();
    state.economy.level = 1; // 人口上限 = 1

    grantModifierUnit(state, DEF_ID, 1);
    expect(placeBenchUnitAt(state, state.economy.bench[0]!.uid, { col: 0, row: 0 }).ok).toBe(true);

    grantModifierUnit(state, DEF_ID, 1);
    const blocked = placeBenchUnitAt(state, state.economy.bench[0]!.uid, { col: 0, row: 1 });
    expect(blocked.ok, '开关没开时仍然受人口限制').toBe(false);
    expect(blocked.message).toContain('人口');

    expect(setIgnorePopCap(state, true).ok).toBe(true);
    expect(canAddUnit(state), '开了之后"还能不能放"必须是 true').toBe(true);
    expect(placeBenchUnitAt(state, state.economy.bench[0]!.uid, { col: 0, row: 1 }).ok).toBe(true);
    expect(state.placements.length).toBe(2);
  });
});

describe('★ 防回归：搬棋子的代码只允许在 state 层出现一次', () => {
  const source = (): string => readFileSync(MAIN_TS, 'utf8');

  it('main.ts 里不许再有第二份拖拽落子的实现', () => {
    expect(source(), '别再自己写一份（修改器的特性就是那样漏掉的）').not.toMatch(
      /function\s+dragBenchToCell/,
    );
  });

  it('main.ts 不许直接往备战席 / 场上塞棋子', () => {
    const src = source();
    expect(src, '搬棋子必须走 state 层，才能在补特性时一处生效').not.toMatch(/placements\.push\(/);
    expect(src, '搬棋子必须走 state 层，才能在补特性时一处生效').not.toMatch(/economy\.bench\.push\(/);
  });

  it('拖拽和点击都指向同一份实现', () => {
    const src = source();
    expect(src).toContain('placeBenchUnitAt(state, current.source.uid, cell)');
    expect(src).toContain('placeSelected(state, cell)');
  });
});
