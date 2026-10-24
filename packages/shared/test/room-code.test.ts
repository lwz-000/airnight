/**
 * ============================================================
 *  房间号（6 位）—— 必须是**真的随机**
 * ============================================================
 *
 * 【这一条为什么值得单独钉一个测试？】
 * 因为房间号"看起来随机"和"真的随机"很难用眼睛分辨，而这里踩过一个
 * **非常明显**的坑：房间号是"固定种子 1 的线性同余发生器取最低 5 位"算出来的，
 * 结果是每次开服的前几个房间号**一模一样**：
 *
 *     GAAAAA / A2AAAA / AAAAAA / AAAA2A / AAAAA2 / AA2AAA
 *
 * 六个字符里五个是 A，朋友看了一眼就会以为"这房间号是不是写死的"。
 * 根因有两条，缺一不可：
 *   1. 取模运算用的是随机源的**低位**（LCG 低位周期极短，≤32）；
 *   2. 种子写死，所以每次开服序列都从头开始。
 * 所以下面的测试盯的是这两条：
 *   · **每一位**都要能用满整个字母表（不是只在少数几个字符里打转）；
 *   · 不同的房间管理器实例（= 不同次开服）拿到的码不同。
 */
import { describe, expect, it } from 'vitest';
import {
  CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  generateRoomCode,
  isDullRoomCode,
  isValidRoomCode,
} from '../src/index.js';

/** 一个"确定性但分布良好"的伪随机源（mulberry32）—— 测试里不能用 Math.random */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('★ 房间号生成', () => {
  it('长度是 6，且只由"不会看错"的字符组成', () => {
    const rng = mulberry32(1);
    for (let i = 0; i < 200; i++) {
      const code = generateRoomCode(rng);
      expect(code).toHaveLength(ROOM_CODE_LENGTH);
      for (const char of code) expect(CODE_ALPHABET.includes(char), `${code} 含非法字符 ${char}`).toBe(true);
      expect(code, '不该出现 0/O/1/I 这种容易念错的').not.toMatch(/[0O1I]/);
    }
  });

  it('random() 的取值两端要对得上（0 -> 第一个字符，接近 1 -> 最后一个）', () => {
    expect(generateRoomCode(() => 0)).toBe(CODE_ALPHABET[0]!.repeat(ROOM_CODE_LENGTH));
    expect(generateRoomCode(() => 0.9999999)).toBe(
      CODE_ALPHABET[CODE_ALPHABET.length - 1]!.repeat(ROOM_CODE_LENGTH),
    );
    // 越界也不能崩（调用方给 1.0 或负数时夹住）
    expect(generateRoomCode(() => 1.5)).toHaveLength(ROOM_CODE_LENGTH);
    expect(generateRoomCode(() => -3)).toHaveLength(ROOM_CODE_LENGTH);
  });

  it('★ 每一位都能用满整个字母表（老 bug 是"六个字符里五个 A"）', () => {
    const rng = mulberry32(20261011);
    const perPosition: Array<Set<string>> = Array.from({ length: ROOM_CODE_LENGTH }, () => new Set<string>());
    const all = new Set<string>();
    for (let i = 0; i < 4000; i++) {
      const code = generateRoomCode(rng);
      for (let p = 0; p < ROOM_CODE_LENGTH; p++) {
        perPosition[p]!.add(code[p]!);
        all.add(code[p]!);
      }
    }
    for (let p = 0; p < ROOM_CODE_LENGTH; p++) {
      expect(perPosition[p]!.size, `第 ${p + 1} 位只出现了 ${perPosition[p]!.size} 种字符`).toBeGreaterThanOrEqual(
        CODE_ALPHABET.length - 2,
      );
    }
    expect(all.size, '整体应该覆盖整个字母表').toBe(CODE_ALPHABET.length);
  });

  it('★ 同样的输入序列要给同样的结果（可复现：方便以后写录像/测试）', () => {
    const a = Array.from({ length: 5 }, (_, i) => generateRoomCode(mulberry32(7 + i * 13)));
    const b = Array.from({ length: 5 }, (_, i) => generateRoomCode(mulberry32(7 + i * 13)));
    expect(a).toEqual(b);
    expect(new Set(a).size, '五个不同种子不该撞出一堆同一个码').toBeGreaterThan(3);
  });

  it('太假的码会被拦下来（AAAAAA / ABABAB 这类重掷）', () => {
    expect(isDullRoomCode('AAAAAA')).toBe(true);
    expect(isDullRoomCode('A7AAA9'), '连续三个 A').toBe(true);
    expect(isDullRoomCode('ABABAB'), '只有两种字符').toBe(true);
    expect(isDullRoomCode('A7K2M9')).toBe(false);
    expect(isDullRoomCode('A7K2M8'), '两个 8 不算连续重复').toBe(false);
  });

  it('合法性校验：位数不对 / 含易混字符都算非法', () => {
    expect(isValidRoomCode('A7K2M9')).toBe(true);
    expect(isValidRoomCode('A7K2M')).toBe(false);
    expect(isValidRoomCode('A7K2M90')).toBe(false);
    expect(isValidRoomCode('A7K2M0'), '0 不在字母表里').toBe(false);
    expect(isValidRoomCode('a7k2m9'), '小写不算合法（界面会先转大写）').toBe(false);
  });
});
