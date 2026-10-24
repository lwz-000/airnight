/**
 * ============================================================
 *  轮流对战（轮转赛制）的配对规则
 * ============================================================
 *
 * 【为什么这个测试特别值钱？】
 * 配对规则是**纯函数**：给它一串人和一个回合号，它告诉谁打谁。
 * 不用起服务器、不用等 30 秒准备阶段、不用真的打一场 ——
 * 毫秒级就能把"是不是每个人都碰过面""有没有人被连着轮空两次"验完。
 *
 * 而如果用端到端测试去验，一轮 4 个人要跑 21 秒以上，还只能验一个片段。
 */
import { describe, expect, it } from 'vitest';
import { roundRobinPairings } from '../src/room.js';

/** 用数字当玩家，断言起来最直观：1 号、2 号、3 号…… */
function pairsToText(pairs: Array<[number, number]>): string[] {
  return pairs.map(([a, b]) => [a, b].sort((x, y) => x - y).join('v')).sort();
}

describe('★ 轮流对战：4 个人', () => {
  const players = [1, 2, 3, 4];

  it('第 1 回合是 1v2、3v4（相邻的先打，最直观）', () => {
    const { pairs, bye } = roundRobinPairings(players, 1);
    expect(pairsToText(pairs)).toEqual(['1v2', '3v4']);
    expect(bye, '偶数个人不该有人轮空').toBeNull();
  });

  it('第 2 回合是 1v3、2v4（和你说的一致）', () => {
    const { pairs } = roundRobinPairings(players, 2);
    expect(pairsToText(pairs)).toEqual(['1v3', '2v4']);
  });

  it('第 3 回合是 1v4、2v3（和你说的一致）', () => {
    const { pairs } = roundRobinPairings(players, 3);
    expect(pairsToText(pairs)).toEqual(['1v4', '2v3']);
  });

  it('一轮（3 回合）下来，每两个人恰好打过一次', () => {
    const seen: string[] = [];
    for (let round = 1; round <= 3; round++) {
      seen.push(...pairsToText(roundRobinPairings(players, round).pairs));
    }
    // C(4,2) = 6 种组合，一种不多一种不少
    expect(seen.sort()).toEqual(['1v2', '1v3', '1v4', '2v3', '2v4', '3v4']);
  });

  it('第 4 回合开始新一轮（循环）', () => {
    expect(pairsToText(roundRobinPairings(players, 4).pairs)).toEqual(
      pairsToText(roundRobinPairings(players, 1).pairs),
    );
  });
});

describe('★ 轮流对战：6 个人', () => {
  const players = [1, 2, 3, 4, 5, 6];

  it('第 1 回合是 1v2、3v4、5v6', () => {
    const { pairs } = roundRobinPairings(players, 1);
    expect(pairsToText(pairs)).toEqual(['1v2', '3v4', '5v6']);
  });

  it('一轮（5 回合）下来，15 种组合恰好各出现一次', () => {
    const seen: string[] = [];
    for (let round = 1; round <= 5; round++) {
      const { pairs, bye } = roundRobinPairings(players, round);
      expect(bye, '偶数个人不该有人轮空').toBeNull();
      seen.push(...pairsToText(pairs));
    }
    const expected: string[] = [];
    for (let a = 1; a <= 6; a++) {
      for (let b = a + 1; b <= 6; b++) expected.push(`${a}v${b}`);
    }
    expect(seen.sort()).toEqual(expected.sort());
  });

  it('没有人会连着两回合碰到同一个人', () => {
    for (let round = 1; round <= 5; round++) {
      const { pairs } = roundRobinPairings(players, round);
      for (const [a, b] of pairs) expect(a).not.toBe(b);
      // 同一回合一个人不能出现在两场里
      const flat = pairs.flat();
      expect(new Set(flat).size, `第 ${round} 回合有人被排了两场`).toBe(flat.length);
    }
  });
});

describe('★ 轮流对战：奇数个人（每回合恰好一人轮空）', () => {
  it('3 个人：3 个回合，每人恰好轮空一次', () => {
    const byes: number[] = [];
    const seen: string[] = [];
    for (let round = 1; round <= 3; round++) {
      const { pairs, bye } = roundRobinPairings([1, 2, 3], round);
      expect(pairs.length).toBe(1);
      expect(bye).not.toBeNull();
      byes.push(bye!);
      seen.push(...pairsToText(pairs));
    }
    expect(byes.slice().sort()).toEqual([1, 2, 3]);
    expect(seen.sort()).toEqual(['1v2', '1v3', '2v3']);
  });

  it('5 个人：5 个回合，每人恰好轮空一次，10 种组合各出现一次', () => {
    const byes: number[] = [];
    const seen: string[] = [];
    for (let round = 1; round <= 5; round++) {
      const { pairs, bye } = roundRobinPairings([1, 2, 3, 4, 5], round);
      expect(pairs.length).toBe(2);
      byes.push(bye!);
      seen.push(...pairsToText(pairs));
    }
    expect(byes.slice().sort()).toEqual([1, 2, 3, 4, 5]);
    const expected: string[] = [];
    for (let a = 1; a <= 5; a++) {
      for (let b = a + 1; b <= 5; b++) expected.push(`${a}v${b}`);
    }
    expect(seen.sort()).toEqual(expected.sort());
  });

  it('7 个人：每回合 3 场 + 1 人轮空', () => {
    const { pairs, bye } = roundRobinPairings([1, 2, 3, 4, 5, 6, 7], 1);
    expect(pairs.length).toBe(3);
    expect(bye).not.toBeNull();
  });
});

describe('轮流对战：边界情况', () => {
  it('0 个人不报错', () => {
    expect(roundRobinPairings([], 1)).toEqual({ pairs: [], bye: null });
  });

  it('1 个人直接轮空', () => {
    const result = roundRobinPairings(['独苗'], 1);
    expect(result.pairs).toEqual([]);
    expect(result.bye).toBe('独苗');
  });

  it('2 个人每回合都是他俩打（没有别人可打）', () => {
    for (const round of [1, 2, 3]) {
      const { pairs, bye } = roundRobinPairings(['A', 'B'], round);
      expect(pairs).toEqual([['A', 'B']]);
      expect(bye).toBeNull();
    }
  });

  it('同一批人同一回合，结果永远一样（可复现，不靠随机）', () => {
    const a = roundRobinPairings([1, 2, 3, 4, 5], 3);
    const b = roundRobinPairings([1, 2, 3, 4, 5], 3);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('极端回合号也不会炸（负数/0/极大）', () => {
    for (const round of [0, -5, 999999]) {
      const { pairs } = roundRobinPairings([1, 2, 3, 4], round);
      expect(pairs.length).toBe(2);
    }
  });

  it('人少了之后（有人被淘汰）仍然能正常配对', () => {
    // 模拟 6 个人打到只剩 3 个
    const { pairs, bye } = roundRobinPairings([2, 4, 6], 1);
    expect(pairs.length).toBe(1);
    expect(bye).not.toBeNull();
  });
});
