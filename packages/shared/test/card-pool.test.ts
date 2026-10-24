/**
 * 牌库（每张牌的固定张数）测试。
 *
 * 【为什么这组测试重要？】
 * 牌库是"抢牌"机制的地基，而它有三个**很容易写错但不会报错**的地方：
 *   1. **星级权重**：二星占 3 张、三星占 9 张。按"个数"算的话，
 *      合成之后牌库会凭空多出两张，"抢牌"就白抢了。
 *   2. **抽干的牌不能再出现**：如果刷新商店时忘了过滤，
 *      玩家会看到一张买不了的牌，点了报错 —— 显示和实际不一致。
 *   3. **整个费用档抽干时的兜底**：不能硬塞一个别的费用的棋子，
 *      那样"商店概率表"这个核心数值就失去意义了。
 */

import { describe, expect, it } from 'vitest';
import {
  UNIT_DEFS,
  buyShopSlot,
  copiesHeld,
  copiesOf,
  copiesPerCard,
  createEconomy,
  freeFlagFor,
  mergeBench,
  pickRecruit,
  poolCopiesOf,
  poolSizeOf,
  remainingOf,
  remainingPool,
  rollShop,
  unitIdsByCost,
  // ★ 0.3.2：牌库名单统一取"能买到的棋子"这一份
  playableDefs,
} from '../src/index.js';

/** 造一个确定性随机源 */
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

const COST_1 = unitIdsByCost(1)[0]!;
const COST_5 = unitIdsByCost(5)[0]!;

describe('每张牌的张数（你给的数值）', () => {
  it('1费27 / 2费22 / 3费18 / 4费14 / 5费10', () => {
    expect(copiesPerCard(1)).toBe(27);
    expect(copiesPerCard(2)).toBe(22);
    expect(copiesPerCard(3)).toBe(18);
    expect(copiesPerCard(4)).toBe(14);
    expect(copiesPerCard(5)).toBe(10);
  });

  it('费用越界时按最近的档处理，不会崩', () => {
    expect(copiesPerCard(0)).toBe(27);
    expect(copiesPerCard(9)).toBe(10);
  });

  it('★ 星级权重：1星占 1 张、2星占 3 张、3星占 9 张', () => {
    expect(copiesOf(1)).toBe(1);
    expect(copiesOf(2)).toBe(3);
    expect(copiesOf(3)).toBe(9);
  });

  it('★ 合成不会让牌库凭空变多', () => {
    // 三个一星 = 一个二星，占用的张数必须一样
    const threeOnes = copiesHeld([
      { defId: COST_1, star: 1 },
      { defId: COST_1, star: 1 },
      { defId: COST_1, star: 1 },
    ]);
    const oneTwo = copiesHeld([{ defId: COST_1, star: 2 }]);
    expect(threeOnes.get(COST_1)).toBe(oneTwo.get(COST_1));
  });
});

describe('剩余张数', () => {
  it('什么都没拿时，剩余 = 总张数', () => {
    expect(remainingOf([], COST_1)).toBe(poolSizeOf(COST_1));
  });

  it('拿了几个就少几张（按星级权重）', () => {
    const total = poolSizeOf(COST_1);
    expect(remainingOf([{ defId: COST_1, star: 1 }], COST_1)).toBe(total - 1);
    expect(remainingOf([{ defId: COST_1, star: 2 }], COST_1)).toBe(total - 3);
    expect(remainingOf([{ defId: COST_1, star: 3 }], COST_1)).toBe(total - 9);
  });

  it('★ 拿满之后剩余是 0，不会变成负数', () => {
    const total = poolSizeOf(COST_5);
    // 三星 = 9 张，5 费总共 10 张
    const taken = [{ defId: COST_5, star: 3 }];
    expect(remainingOf(taken, COST_5)).toBe(Math.max(0, total - 9));
    // 再硬塞一个（理论上不会发生，但也不能算出负数）
    expect(remainingOf([...taken, { defId: COST_5, star: 3 }], COST_5)).toBe(0);
  });

  it('★ 每个棋子都有自己的一条剩余记录（召唤物不在牌库里）', () => {
    const remaining = remainingPool([{ defId: COST_1, star: 1 }]);
    /*
      牌库里只有"能买到的"棋子 —— 召唤物（迷迭香的柱子、维娜的金狮子、望的棋子）
      是技能生成出来的，没有牌库记录。所以这里不能拿 UNIT_DEFS 的总数来比。
    */
    /*
      0.0.3：野怪也不进牌库（monsterOnly），和召唤物一起排除。
      ★ 0.3.2：升变形态（ascendOnly）同样不在牌库里 —— 它们只能由「不容拒绝」的
        升变之证产生，进了牌库就等于"能直接买到终态"。
      ⇒ 判据统一用 `playableDefs()`（唯一实现），别在这儿手写一份过滤，
        否则每加一类"非卖品"就要记得到处补。
    */
    const playable = playableDefs();
    expect(remaining.size).toBe(playable.length);
    expect(remaining.get(COST_1)).toBe(poolSizeOf(COST_1) - 1);
    // 别的 1 费棋子不受影响
    const other = unitIdsByCost(1)[1]!;
    expect(remaining.get(other)).toBe(poolSizeOf(other));
  });
});

describe('商店抽卡受牌库限制', () => {
  it('不传牌库就是无限（老行为，方便调试）', () => {
    const slots = rollShop(9, makeRng(), UNIT_DEFS);
    expect(slots).toHaveLength(5);
    for (const slot of slots) expect(slot.defId).not.toBe('');
  });

  it('★ 抽干的棋子不会再出现在商店里', () => {
    // 把 1 费的所有棋子都抽干，然后只留 2 费以上 —— 商店里不该出现 1 费
    const remaining = remainingPool([]);
    for (const id of unitIdsByCost(1)) remaining.set(id, 0);

    const random = makeRng(999);
    for (let i = 0; i < 50; i++) {
      const slots = rollShop(3, random, UNIT_DEFS, { remaining });
      for (const slot of slots) {
        if (slot.defId === '') continue;
        expect(UNIT_DEFS[slot.defId]!.cost, '1 费已经抽干了，不该再出现').not.toBe(1);
      }
    }
  });

  it('★ 整个牌库抽干时给空格子，而不是抛错或硬塞', () => {
    const remaining = remainingPool([]);
    for (const id of Object.keys(UNIT_DEFS)) remaining.set(id, 0);

    const slots = rollShop(5, makeRng(), UNIT_DEFS, { remaining });
    expect(slots).toHaveLength(5);
    for (const slot of slots) {
      expect(slot.defId).toBe('');
      expect(slot.sold).toBe(true);
    }
  });

  it('★ 低费档抽干后概率重新分配，而不是硬塞低费', () => {
    const remaining = remainingPool([]);
    for (const cost of [1, 2, 3, 4]) {
      for (const id of unitIdsByCost(cost)) remaining.set(id, 0);
    }
    // 只剩 5 费
    const slots = rollShop(10, makeRng(7), UNIT_DEFS, { remaining });
    for (const slot of slots) {
      expect(UNIT_DEFS[slot.defId]!.cost).toBe(5);
    }
  });
});

describe('买牌受牌库限制', () => {
  it('★ 牌库没货时买不了，并给出明确原因', () => {
    const econom = createEconomy(makeRng());
    econom.gold = 9999;
    const remaining = remainingPool([]);
    remaining.set(COST_1, 0);

    // 把商店第一格换成那张没货的牌
    econom.shop[0] = { defId: COST_1, cost: UNIT_DEFS[COST_1]!.cost, sold: false };

    let uid = 100;
    const result = buyShopSlot(econom, 0, () => ++uid, UNIT_DEFS, { remaining });
    expect(result.ok).toBe(false);
    expect(result.message).toContain('拿完');
    // 关键：失败时不能扣钱、不能给棋子
    expect(econom.gold).toBe(9999);
    expect(econom.bench).toHaveLength(0);
  });

  it('有货时正常买到', () => {
    const econom = createEconomy(makeRng());
    econom.gold = 9999;
    econom.shop[0] = { defId: COST_1, cost: UNIT_DEFS[COST_1]!.cost, sold: false };
    let uid = 200;
    const result = buyShopSlot(econom, 0, () => ++uid, UNIT_DEFS, { remaining: remainingPool([]) });
    expect(result.ok).toBe(true);
    expect(econom.bench).toHaveLength(1);
  });
});

/*
  ★★ 用户报的 bug：拿「博士投影 / 拟态物质」复制或升星之后，牌库数字**弹回满**。

  【根因】以前 `free` 是个布尔"整只不占牌库"，而且合成时**只要三个里有一个白送，
  合出来的整只也算白送**。于是 7 张同名干员只要碰上道具就会连锁洗白：
  3★ 那只变成 free → 牌库从 3 张直接回到 10 张。
  【修法】`free` 改成按**张数**记（true = 0 张 / 数字 = 只占这么多张），
  合成时三个的张数**相加**。道具只免掉它真正多给的那几张。
*/
describe('★ 道具多给的份数：free 按张记（不是"整只白送"）', () => {
  it('换算表：默认按星级；true = 0 张；数字 = 只占这么多张', () => {
    expect(poolCopiesOf({ star: 1 })).toBe(1);
    expect(poolCopiesOf({ star: 2 })).toBe(3);
    expect(poolCopiesOf({ star: 3 })).toBe(9);

    expect(poolCopiesOf({ star: 1, free: true }), '整只白送 = 一张都不占').toBe(0);
    expect(poolCopiesOf({ star: 2, free: 1 }), '博士投影升过星的 2★ 只占 1 张').toBe(1);
    expect(poolCopiesOf({ star: 3, free: 7 }), '按张记就写 7').toBe(7);
    expect(poolCopiesOf({ star: 1, free: 99 }), '不能超过该星级的上限').toBe(1);
    expect(poolCopiesOf({ star: 2, free: 0 }), '0 张也算不占').toBe(0);
  });

  it('freeFlagFor：占满写 undefined、占 0 写 true、中间写数字', () => {
    expect(freeFlagFor(2, 3)).toBeUndefined();
    expect(freeFlagFor(2, 9)).toBeUndefined();
    expect(freeFlagFor(2, 0)).toBe(true);
    expect(freeFlagFor(2, 2)).toBe(2);
    expect(freeFlagFor(1, 1)).toBeUndefined();
  });

  it('★ 复制出来的那一只不占牌库，也不会把同名的 7 张一起免掉', () => {
    const units = [
      ...Array.from({ length: 7 }, () => ({ defId: COST_5, star: 1 })),
      { defId: COST_5, star: 1, free: true }, // 拟态物质复制出来的
    ];
    expect(copiesHeld(units).get(COST_5), '占用的还是那 7 张').toBe(7);
  });

  it('★ 合成：三个里有一个白送，合出来的只免掉那 1 张（不是整只）', () => {
    const econom = createEconomy(makeRng());
    let uid = 0;
    econom.bench = [
      { uid: ++uid, defId: COST_5, star: 1 },
      { uid: ++uid, defId: COST_5, star: 1 },
      { uid: ++uid, defId: COST_5, star: 1, free: true },
    ];
    mergeBench(econom, () => ++uid);

    expect(econom.bench).toHaveLength(1);
    const merged = econom.bench[0]!;
    expect(merged.star).toBe(2);
    expect(merged.free, '2★ 只占 2 张（1+1+0）').toBe(2);
    expect(poolCopiesOf(merged)).toBe(2);
  });

  it('★ 合成：三只都是白送的，合出来仍然是"一张不占"', () => {
    const econom = createEconomy(makeRng());
    let uid = 0;
    econom.bench = [
      { uid: ++uid, defId: COST_5, star: 1, free: true },
      { uid: ++uid, defId: COST_5, star: 1, free: true },
      { uid: ++uid, defId: COST_5, star: 1, free: true },
    ];
    mergeBench(econom, () => ++uid);
    expect(econom.bench[0]!.free, '全白送 => 仍然白送').toBe(true);
    expect(poolCopiesOf(econom.bench[0]!)).toBe(0);
  });
});

// ============================================================
//  ★ 0.1.1 藏品二版：随机招募（人事部铜印 / 博士银印）
// ============================================================

describe('★ pickRecruit：从牌库招募（单机本地 / 服务端共用同一份规则）', () => {
  /** 造一份候选（只要 id + cost） */
  const cands = [
    { id: 'a', cost: 1 },
    { id: 'b', cost: 2 },
    { id: 'c', cost: 3 },
  ];

  it('只在"牌库还有货"的干员里挑', () => {
    const stock: Record<string, number> = { a: 0, b: 0, c: 5 };
    const picked = pickRecruit(cands, (id) => stock[id] ?? 0, () => 0);
    expect(picked).toEqual({ defId: 'c', cost: 3 });
  });

  it('★ 牌库全空 -> 招不到人，按"本该抽到的那名"的花费给金币', () => {
    const picked = pickRecruit(cands, () => 0, () => 1); // 下标 1 => b（2 费）
    expect(picked).toEqual({ defId: null, gold: 2 });
  });

  it('没有候选（数据缺失）-> 既不给人也给钱，不炸', () => {
    expect(pickRecruit([], () => 0, () => 0)).toEqual({ defId: null, gold: 0 });
  });

  it('★ 抽到的永远是"有货的"那一个（一批种子全跑一遍）', () => {
    const stock: Record<string, number> = { a: 0, b: 3, c: 0 };
    for (let seed = 0; seed < 50; seed++) {
      const picked = pickRecruit(cands, (id) => stock[id] ?? 0, (n) => seed % n);
      expect(picked).toEqual({ defId: 'b', cost: 2 });
    }
  });

  it('候选里那些"牌库还有货"的会被均匀抽到（不是永远同一个）', () => {
    const stock: Record<string, number> = { a: 1, b: 1, c: 1 };
    const seen = new Set<string>();
    for (let seed = 0; seed < 30; seed++) {
      const picked = pickRecruit(cands, (id) => stock[id] ?? 0, (n) => seed % n);
      if (picked.defId) seen.add(picked.defId);
    }
    expect([...seen].sort()).toEqual(['a', 'b', 'c']);
  });
});
