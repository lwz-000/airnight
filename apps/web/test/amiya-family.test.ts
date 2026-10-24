/**
 * ============================================================
 *  ★★ 0.3.2 阿米娅「家族」：牌库共用 + 升星互通
 * ============================================================
 *
 * 用户口径（原话）：
 *   「他们都属于阿米娅，升变阿米娅后也会占阿米娅牌库，
 *     而且升星也是互通的，比如手里现在有一个 1 星阿米娅青色怒火，
 *     买 2 张一费阿米娅，依旧可以升级为 2 星阿米娅青色怒火，其他同理。」
 *
 * 这一组就是钉这两件事 —— 它们**出错时都不会报错**，只会表现成
 * "牌库越用越少 / 凑齐了却不合成"，靠肉眼很难发现：
 *   1. 牌库记账（`copiesHeld` / 服务端 `returnToPool`）必须认**家族 key**；
 *   2. 合成（`mergeAllUnits` / `mergeBench`）必须**跨形态**分组，
 *      并且保留组里最靠后的那个形态。
 */
import { describe, expect, it } from 'vitest';
import {
  AMIYA_BASE_ID,
  AMIYA_FORM_IDS,
  ascendRankOf,
  copiesHeld,
  copiesOf,
  familyKeyOf,
  mergeBench,
  poolSizeOf,
  remainingPool,
  sellBenchUnit,
} from '../../../packages/shared/src/index.js';
import { countOwned, countOwnedCopies, createGameState, doSellBench, mergeAllUnits } from '../src/game/state.js';

const BASE = AMIYA_BASE_ID; // op07，1 费，唯一的可购买形态
const BLUE = AMIYA_FORM_IDS.blue;
const MERCY = AMIYA_FORM_IDS.mercy;
const CORE = AMIYA_FORM_IDS.core;

let nextUidSeq = 9000;
const freshUid = (): number => nextUidSeq++;

/** 造一个空局，然后手动往备战席里塞棋子 */
function benchState(units: Array<{ defId: string; star?: number; free?: boolean | number }>) {
  const state = createGameState(1);
  state.economy.bench = [];
  state.placements = [];
  for (const unit of units) {
    state.economy.bench.push({
      uid: freshUid(),
      defId: unit.defId,
      star: unit.star ?? 1,
      ...(unit.free === undefined ? {} : { free: unit.free }),
    });
  }
  return state;
}

describe('★ 家族 key：谁和谁是同一只棋子', () => {
  it('三个形态都归到基础阿米娅名下，其它棋子原样返回', () => {
    for (const id of [BLUE, MERCY, CORE]) {
      expect(familyKeyOf(id), `${id} 应归到 ${BASE}`).toBe(BASE);
    }
    expect(familyKeyOf(BASE)).toBe(BASE);
    expect(familyKeyOf('op01')).toBe('op01');
    expect(familyKeyOf('mn_tytus')).toBe('mn_tytus');
  });

  it('形态在链上的位置：基础 0 / 中间形态 1 / 终态 2', () => {
    expect(ascendRankOf(BASE)).toBe(0);
    expect(ascendRankOf(BLUE)).toBe(1);
    expect(ascendRankOf(MERCY)).toBe(1);
    expect(ascendRankOf(CORE)).toBe(2);
    expect(ascendRankOf(undefined)).toBe(0);
  });
});

describe('★ 牌库：升变之后继续占阿米娅的份数', () => {
  it('3 星青色怒火占阿米娅 9 张（不是"形态自己一份"）', () => {
    const held = copiesHeld([{ defId: BLUE, star: 3 }]);
    expect(held.get(BASE), '9 张都要记在阿米娅名下').toBe(copiesOf(3));
    expect(held.has(BLUE), '不能记到形态自己名下（那份池子根本不存在）').toBe(false);
  });

  it('★★ 牌库剩余数会跟着减少 —— 以前这里会"白多出 9 张阿米娅"', () => {
    const total = poolSizeOf(BASE);
    const before = remainingPool([]).get(BASE)!;
    const after = remainingPool([{ defId: BLUE, star: 3 }]).get(BASE)!;
    expect(before).toBe(total);
    expect(after, '升变占的份数必须体现在阿米娅的剩余数上').toBe(Math.max(0, total - copiesOf(3)));
  });

  it('基础棋子和形态混在一起时按张相加', () => {
    const held = copiesHeld([
      { defId: BASE, star: 1 }, // 1 张
      { defId: MERCY, star: 2 }, // 3 张
    ]);
    expect(held.get(BASE)).toBe(1 + copiesOf(2));
  });
});

describe('★ 升星互通：形态 + 基础棋子凑够三个就升', () => {
  it('★★ 用户那条原话：1 星青色怒火 + 2 张 1 费阿米娅 = 2 星青色怒火', () => {
    const state = benchState([{ defId: BLUE }, { defId: BASE }, { defId: BASE }]);
    const reports = mergeAllUnits(state);

    expect(reports).toHaveLength(1);
    expect(reports[0]!.defId, '★ 必须保留形态，不能退回基础阿米娅').toBe(BLUE);
    expect(reports[0]!.star).toBe(2);
    expect(reports[0]!.onBoard).toBe(false);
    expect(state.economy.bench).toHaveLength(1);
    expect(state.economy.bench[0]!.defId).toBe(BLUE);
    expect(state.economy.bench[0]!.star).toBe(2);
  });

  it('慈悲愿景同理（另一种中间形态）', () => {
    const state = benchState([{ defId: MERCY }, { defId: BASE }, { defId: BASE }]);
    const reports = mergeAllUnits(state);
    expect(reports[0]!.defId).toBe(MERCY);
    expect(reports[0]!.star).toBe(2);
  });

  it('★★ 棋盘上那一只也算数，合成结果留在**原来的格子**（形态不丢）', () => {
    const state = benchState([{ defId: BASE }, { defId: BASE }]);
    state.placements = [{ uid: freshUid(), defId: BLUE, star: 1, cell: { col: 3, row: 7 } }];

    const reports = mergeAllUnits(state);
    expect(reports).toHaveLength(1);
    expect(reports[0]!.onBoard, '被吃掉的有一个在场上 -> 结果落在场上').toBe(true);
    expect(reports[0]!.defId).toBe(BLUE);
    expect(state.placements).toHaveLength(1);
    expect(state.placements[0]!.defId).toBe(BLUE);
    expect(state.placements[0]!.star).toBe(2);
    expect(state.placements[0]!.cell, '位置必须还是原来那一格').toEqual({ col: 3, row: 7 });
    expect(state.economy.bench).toHaveLength(0);
  });

  it('同类里混着两个形态时保留**更靠后**的那个（终态 > 中间形态）', () => {
    const state = benchState([{ defId: CORE }, { defId: BLUE }, { defId: BASE }]);
    const reports = mergeAllUnits(state);
    expect(reports[0]!.defId).toBe(CORE);
  });

  it('★ 全是基础阿米娅时行为完全不变（不能因为这次改动把老规则带歪）', () => {
    const state = benchState([{ defId: BASE }, { defId: BASE }, { defId: BASE }]);
    const reports = mergeAllUnits(state);
    expect(reports[0]!.defId).toBe(BASE);
    expect(reports[0]!.star).toBe(2);
  });

  it('★ 不是同一家族的两个棋子不能合（回归保护）', () => {
    // 青色怒火 + 慈悲愿景 + 基础阿米娅：三个都在阿米娅家族里，所以**能**合；
    // 但 op01 + op02 + op07 这种不同家族的一个都不该动
    const state = benchState([{ defId: 'op01' }, { defId: 'op02' }, { defId: BASE }]);
    expect(mergeAllUnits(state)).toHaveLength(0);
    expect(state.economy.bench).toHaveLength(3);
  });

  it('共享版 mergeBench 也认家族（它是测试与被别处复用的旧入口）', () => {
    const economy = benchState([{ defId: BLUE }, { defId: BASE }, { defId: BASE }]).economy;
    const reports = mergeBench(economy, freshUid);
    expect(reports).toHaveLength(1);
    expect(reports[0]!.defId).toBe(BLUE);
    expect(economy.bench).toHaveLength(1);
  });
});

describe('★ 卡面数字：升变过也要算"已拥有"', () => {
  it('countOwned / countOwnedCopies 把形态算进基础棋子的名额', () => {
    const state = benchState([{ defId: BASE }, { defId: BASE }]);
    state.placements = [{ uid: freshUid(), defId: BLUE, star: 1, cell: { col: 0, row: 0 } }];

    expect(countOwned(state, BASE), '买第三张时商店要提示"可升星"').toBe(3);
    expect(countOwned(state, BASE, 1)).toBe(3);
    expect(countOwnedCopies(state, BASE)).toBe(3);
    // 反向：问形态的时候也把基础棋子算进来（同一条家族）
    expect(countOwned(state, BLUE)).toBe(3);
  });
});

describe('★★ 0.3.2 升变形态不能出售（测试模式例外）', () => {
  it('三个形态都卖不掉，棋子还在备战席、金币不变', () => {
    for (const defId of [BLUE, MERCY, CORE]) {
      const state = benchState([{ defId }]);
      const goldBefore = state.economy.gold;
      const result = doSellBench(state, state.economy.bench[0]!.uid);
      expect(result.ok, `${defId} 不该能卖`).toBe(false);
      expect(result.message).toContain('不能出售');
      expect(state.economy.bench, '棋子必须还在').toHaveLength(1);
      expect(state.economy.gold).toBe(goldBefore);
    }
  });

  it('★ 普通棋子照旧能卖（别把限制放得太宽）', () => {
    const state = benchState([{ defId: BASE }]);
    const goldBefore = state.economy.gold;
    const result = doSellBench(state, state.economy.bench[0]!.uid);
    expect(result.ok).toBe(true);
    expect(state.economy.bench).toHaveLength(0);
    expect(state.economy.gold).toBeGreaterThan(goldBefore);
  });

  it('★★ 测试模式放行（用户口径：限制只做在单机正常对局和多人模式里）', () => {
    const state = benchState([{ defId: BLUE }]);
    state.testMode = true;
    const result = doSellBench(state, state.economy.bench[0]!.uid);
    expect(result.ok).toBe(true);
    expect(state.economy.bench).toHaveLength(0);
  });

  it('内核 `sellBenchUnit` 默认也是拦的（任何调用点都绕不过去）', () => {
    const state = benchState([{ defId: CORE }]);
    const denied = sellBenchUnit(state.economy, state.economy.bench[0]!.uid);
    expect(denied.ok).toBe(false);
    // 显式放行才行（客户端唯一入口传的是 state.testMode）
    const allowed = sellBenchUnit(state.economy, state.economy.bench[0]!.uid, undefined, 0, {
      allowAscendForm: true,
    });
    expect(allowed.ok).toBe(true);
  });
});
