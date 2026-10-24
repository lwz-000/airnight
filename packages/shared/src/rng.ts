/**
 * 确定性随机数发生器（PRNG）。
 *
 * 【为什么不能用 Math.random()？】
 * 因为它每次结果都不同，而且不可复现。自走棋的联机方式是：
 *   服务器只广播一个「随机种子」（一个数字），每台客户端用这个种子跑出一模一样的战斗过程。
 * 所以随机数必须由我们自己生成，并且保证「同一个种子 => 同一串随机数」。
 *
 * 这里用的是 mulberry32：代码只有几行，速度很快，分布也够用。
 * 全程使用整数位运算（>>> | &），不涉及任何小数，所以跨平台绝对一致。
 */

export interface Rng {
  /** 返回 [0, 1) 之间的随机整数，放大 FIX 倍（即 0 到 999） */
  nextFix(): number;
  /** 返回 [0, maxExclusive) 的随机整数 */
  nextInt(maxExclusive: number): number;
  /** 以 bp 概率返回 true。例如 chanceBp = 2500 表示 25% 概率命中 */
  chance(chanceBp: number): boolean;
  /** 当前内部状态，用于存档 / 校验 */
  readonly state: number;
}

/**
 * 创建一个确定性随机数发生器。
 * @param seed 任意 32 位整数种子。服务器生成后广播给所有客户端。
 */
export function createRng(seed: number): Rng {
  // 把种子混洗一下，避免传 0/1/2 这类小种子时开头几个数质量差
  let s = (seed | 0) >>> 0;
  s = (s + 0x9e3779b9) >>> 0;
  s = (s ^ (s >>> 16)) >>> 0;
  s = Math.imul(s, 0x21f0aaad) >>> 0;
  s = (s ^ (s >>> 15)) >>> 0;

  const nextRaw = (): number => {
    // mulberry32 主体：只用整数位运算，结果稳定
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1) >>> 0;
    t = (t ^ (t + Math.imul(t ^ (t >>> 7), t | 61))) >>> 0;
    return (t ^ (t >>> 14)) >>> 0;
  };

  return {
    nextFix(): number {
      // 取 0..999：用 1000 去模，保证落在 FIX 精度内
      return nextRaw() % 1000;
    },
    nextInt(maxExclusive: number): number {
      if (maxExclusive <= 0) return 0;
      return nextRaw() % maxExclusive;
    },
    chance(chanceBp: number): boolean {
      if (chanceBp <= 0) return false;
      if (chanceBp >= 10000) return true;
      return nextRaw() % 10000 < chanceBp;
    },
    get state(): number {
      return s;
    },
  };
}

/**
 * 从字符串生成一个稳定的 32 位种子。
 * 用途：把「房间码 + 回合数」变成种子，这样同一回合所有玩家跑出的战斗必然相同。
 */
export function seedFromString(text: string): number {
  let h = 2166136261 >>> 0; // FNV-1a 偏移基数
  for (let i = 0; i < text.length; i++) {
    h = (h ^ text.charCodeAt(i)) >>> 0;
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}
