/**
 * ============================================================
 *  ★★ 0.2 MujicaAve：「fever 该不该弹窗、弹哪一档」的纯规则
 * ============================================================
 *
 * 【用户口径（原话）】
 *   「弹窗是只弹最高档，比如第三回合到了 50 点不弹，第四回合 150 点弹 100 档的；
 *     第五回合 170 点不弹；第六回合 400 点弹 300 档的；第七回合 460 点也不弹，依此类推。
 *     除非是 fever 点数下降到每档的下面，后面 fever 重新升上去才会重新弹窗。」
 *
 * 【为什么单独一个文件？】
 * 因为这条规则的唯一实现是 `shared/fever.ts` 的 `nextFeverPrompt`，
 * 而它的调用方有三处很容易各写一遍（客户端结算、界面渲染、服务端自检）。
 * 这里直接把纯函数钉死，谁改坏了这里立刻红。
 *
 * 【一句话规则】
 *  `top = 当前总额能到的最高档`；只有 `top > 上次弹过的档` 才弹，
 *  并且**无论弹不弹都把"上次弹过的档"更新成 top**（所以它会跟着总额一起往下走）。
 */
import { describe, expect, it } from 'vitest';
import {
  createFeverState,
  nextFeverPrompt,
  reachedFeverThreshold,
  sanitizeFever,
} from '../src/index.js';

/** 和 trait-data 的 mujica 一致 */
const THRESHOLDS = [100, 300, 500, 1000, 1500, 2000, 3000] as const;

describe('★ 0.2 fever：当前能到哪一档（纯计算，不记历史）', () => {
  it('没到最低档就是 null', () => {
    expect(reachedFeverThreshold(0, THRESHOLDS)).toBeNull();
    expect(reachedFeverThreshold(99, THRESHOLDS)).toBeNull();
  });

  it('越过好几档时取**最高**的那一档（低档不问）', () => {
    expect(reachedFeverThreshold(100, THRESHOLDS)).toBe(100);
    expect(reachedFeverThreshold(299, THRESHOLDS)).toBe(100);
    expect(reachedFeverThreshold(300, THRESHOLDS)).toBe(300);
    expect(reachedFeverThreshold(400, THRESHOLDS)).toBe(300);
  });

  it('超过最高档就停在最高档', () => {
    expect(reachedFeverThreshold(99999, THRESHOLDS)).toBe(3000);
  });
});

describe('★★ 0.2 fever：只弹「新跨过的最高档」', () => {
  /** 依次喂总额，返回每一步"该弹的档" */
  const run = (totals: readonly number[]): Array<number | null> => {
    let promptedTier: number | null = null;
    const out: Array<number | null> = [];
    for (const total of totals) {
      const next = nextFeverPrompt(total, THRESHOLDS, promptedTier);
      promptedTier = next.promptedTier;
      out.push(next.prompt);
    }
    return out;
  };

  it('★ 用户给的例子逐条对上：50 / 150 / 170 / 400 / 460', () => {
    expect(run([50, 150, 170, 400, 460])).toEqual([null, 100, null, 300, null]);
  });

  it('同一个档里来回涨：从头到尾只弹一次', () => {
    expect(run([100, 120, 180, 240, 299])).toEqual([100, null, null, null, null]);
  });

  it('★ 掉到某档下面再涨回来 -> 重新弹', () => {
    //  400 -> 弹 300；掉到 150（=100 档）-> 不弹但"上次弹过的档"降到 100；再回 400 -> 又弹 300
    expect(run([400, 150, 400])).toEqual([300, null, 300]);
  });

  it('★ 掉到**所有档以下**再涨回来 -> 也算重新跨过，照弹', () => {
    expect(run([300, 40, 300])).toEqual([300, null, 300]);
  });

  it('跨档可以一次跨好几档（只弹最高的那个）', () => {
    expect(run([100, 1200])).toEqual([100, 1000]);
  });

  it('promptedTier 跟着总额往下走（不是只增不减）', () => {
    let promptedTier: number | null = null;
    const step = (total: number): number | null => {
      const next = nextFeverPrompt(total, THRESHOLDS, promptedTier);
      promptedTier = next.promptedTier;
      return next.prompt;
    };
    expect(step(1600)).toBe(1500);
    expect(promptedTier).toBe(1500);
    expect(step(320)).toBeNull();
    expect(promptedTier, '掉到 300 档就记 300').toBe(300);
    expect(step(20)).toBeNull();
    expect(promptedTier, '掉到所有档以下就归 null').toBeNull();
  });

  it('空阈值表：永远不弹（也不报错）', () => {
    expect(nextFeverPrompt(99999, [], null)).toEqual({ prompt: null, promptedTier: null });
  });
});

describe('★ 0.2 fever：状态里的新字段（promptedTier）', () => {
  it('新玩家是 null（一次都没弹过）', () => {
    expect(createFeverState().promptedTier).toBeNull();
  });

  it('★ 服务端自检要认这个字段：跟着阵容上报、重连要装得回来', () => {
    // 只带 promptedTier 的对象也算"有东西"，不能被当成空壳丢掉
    // （total 给个非 0 值，否则整个对象会被判成"空壳"直接丢 —— 那是另一条规则）
    const raw = { total: 150, spent: 0, armedTicks: 0, treasures: [], prompt: null, promptedTier: 300 };
    expect(sanitizeFever(raw)?.promptedTier).toBe(300);

    // 脏值一律夹成 null（负数 / NaN / 字符串）
    for (const bad of [-5, Number.NaN, 'abc', undefined]) {
      expect(sanitizeFever({ ...raw, promptedTier: bad })?.promptedTier).toBeNull();
    }

    // 全空仍然等于没上报
    expect(
      sanitizeFever({ total: 0, spent: 0, armedTicks: 0, treasures: [], prompt: null, promptedTier: null }),
    ).toBeUndefined();
  });
});

/**
 * ★★ 0.2（用户 2026-10-17）：「fever 达到最高档位后，后面每一回合（不含野怪回合）都弹窗」。
 *
 * 原来的规则只认"跨过更高的档"—— 到了最高档就没有更高的了，于是攒满反而弹不出来，
 * 而消耗 fever 换特殊技能窗口才是这个羁绊的玩法核心。
 */
describe('★★ fever：站在最高档时每回合都弹（repeatAtMax）', () => {
  it('★ 站在最高档：连续问三次都要弹（不是只弹第一次）', () => {
    for (const total of [3000, 3000, 3200, 4000]) {
      const next = nextFeverPrompt(total, THRESHOLDS, 3000, { repeatAtMax: true });
      expect(next.prompt, `${total} 点：站在最高档，每回合都要弹`).toBe(3000);
    }
  });

  it('★ 不传 repeatAtMax：还是老规矩（只在跨过更高档时弹）', () => {
    expect(nextFeverPrompt(3000, THRESHOLDS, 3000).prompt).toBeNull();
    expect(nextFeverPrompt(3200, THRESHOLDS, 3000).prompt).toBeNull();
  });

  it('★ 没到最高档：repeatAtMax 不影响原来的"只跨新档才弹"', () => {
    // 1500 档原地涨到 1700：不弹
    expect(nextFeverPrompt(1700, THRESHOLDS, 1500, { repeatAtMax: true }).prompt).toBeNull();
    // 跨到 2000 档：弹
    expect(nextFeverPrompt(2100, THRESHOLDS, 1500, { repeatAtMax: true }).prompt).toBe(2000);
  });

  it('★ 消耗完归零之后就不弹了（重新攒到最高档再问）', () => {
    expect(nextFeverPrompt(0, THRESHOLDS, 3000, { repeatAtMax: true }).prompt).toBeNull();
    expect(nextFeverPrompt(2999, THRESHOLDS, 2000, { repeatAtMax: true }).prompt).toBeNull();
  });
});
