/**
 * ============================================================
 *  ★ 0.3.4 新手教程
 * ============================================================
 * 用户口径：第一次打开弹一次 → 能翻页 → 角落一颗小按钮随时再看。
 *
 * 这一组守三件事：
 *   ① 第一次才自动弹（打过标记就不弹），关掉会留下标记；
 *   ② 翻页夹在 [0, 末页] 之间 —— 越界不能变成空白页；
 *   ③ 内容真的讲了"经济 / 藏品"这两块（用户点名要的），而且每页都有标题和正文。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  BUY_XP_COST,
  INTEREST_PER_10_GOLD,
  MAX_INTEREST,
  REFRESH_COST,
  damageForRound,
  lossStreakBonus,
  sellPriceOf,
} from '../../../packages/shared/src/index.js';
import {
  TUTORIAL_PAGES,
  TUTORIAL_SEEN_KEY,
  clampTutorialPage,
  markTutorialSeen,
  shouldAutoOpenTutorial,
  tutorialPageCount,
} from '../src/game/tutorial.js';

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
      clear: () => store.clear(),
    },
  });
});

describe('第一次打开才自动弹', () => {
  it('没看过 -> 弹；看过 -> 不弹', () => {
    expect(shouldAutoOpenTutorial(), '第一次该弹').toBe(true);
    markTutorialSeen();
    expect(shouldAutoOpenTutorial(), '看过了就别再烦人').toBe(false);
    expect(store.get(TUTORIAL_SEEN_KEY)).toBe('1');
  });

  it('localStorage 被禁用 -> 不弹（每次都弹比不弹更烦）', () => {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: undefined });
    expect(shouldAutoOpenTutorial()).toBe(false);
    // 也不许抛
    expect(() => markTutorialSeen()).not.toThrow();
  });
});

describe('翻页', () => {
  it('至少 5 页，而且越界会夹在边界上（不会翻出空白页）', () => {
    const total = tutorialPageCount();
    expect(total).toBeGreaterThanOrEqual(5);
    expect(clampTutorialPage(-3)).toBe(0);
    expect(clampTutorialPage(999)).toBe(total - 1);
    expect(clampTutorialPage(1)).toBe(1);
    expect(clampTutorialPage(Number.NaN)).toBe(0);
  });
});

describe('内容', () => {
  it('每页都有标题 / 副标题 / 正文', () => {
    for (const page of TUTORIAL_PAGES) {
      expect(page.title.length, '缺标题').toBeGreaterThan(0);
      expect(page.sub.length, '缺副标题').toBeGreaterThan(0);
      expect(page.html.length, `${page.title} 正文太短`).toBeGreaterThan(80);
    }
  });

  it('★ 用户点名要讲的经济 / 藏品 / 羁绊 都在里面', () => {
    const all = TUTORIAL_PAGES.map((page) => `${page.title}${page.sub}${page.html}`).join('\n');
    for (const word of ['金币', '利息', '刷新', '经验', '藏品', '共享装备位', '羁绊', '升星']) {
      expect(all, `教程里没提到「${word}」`).toContain(word);
    }
  });

  it('封面到结尾的标题不重复（一眼能看出在翻页）', () => {
    const titles = TUTORIAL_PAGES.map((page) => page.title);
    expect(new Set(titles).size).toBe(titles.length);
  });
});

/*
  ★★★ 0.3.4 追加：教程里的**数字必须来自规则本身**（用户报「掉血机制不对」）。
  ============================================================
  【为什么这类测试很值】
  教程是"照着写"的，最容易凭印象编 —— 当时那版就写成了
  「按对方剩下的棋子扣血」，而真实规则是 `damageForRound()`：**按回合数固定扣**。
  玩家照着错的玩，比没有教程还糟。
  所以这里把规则函数真跑一遍，再要求文案里出现那些数字。
*/
describe('教程里的规则必须和代码一致（防凭印象写）', () => {
  const allText = TUTORIAL_PAGES.map((page) => `${page.title}${page.sub}${page.html}`).join('\n');

  it('★ 掉血：按回合数固定扣，不是按对面剩几个棋子', () => {
    // 真实规则：第 1~5 回合 3 点、6~10 回合 6 点、11~15 回合 9 点
    expect(damageForRound(1)).toBe(3);
    expect(damageForRound(5)).toBe(3);
    expect(damageForRound(6)).toBe(6);
    expect(damageForRound(11)).toBe(9);

    expect(allText, '教程必须写明"输了扣血"这件事').toContain('扣');
    expect(allText, '要写出第一档 3 点').toContain('3');
    expect(allText, '要写出"每 5 个回合多扣一档"的规则').toContain('5 个回合');
    expect(allText, '要写出高档位的数字（6 / 9）').toMatch(/6~10|11~15/);
    expect(allText, '★ 不能再写"按对方剩下的棋子扣血"这种错话').not.toContain('剩下的棋子扣');
  });

  it('★ 卖棋子：原价返还（1 星不折价），不是"比原价低"', () => {
    // 真实规则：sellPriceOf(cost, star) = cost × 3^(star-1)
    expect(sellPriceOf(3, 1)).toBe(3);
    expect(sellPriceOf(3, 2)).toBe(9);
    expect(sellPriceOf(3, 3)).toBe(27);

    expect(allText, '要写"原价返还"').toContain('原价');
    expect(allText, '★ 不能再写"返还一部分 / 比原价低"').not.toContain('比原价低');
  });

  it('★ 利息与连败档位：跟着常量走', () => {
    expect(INTEREST_PER_10_GOLD).toBe(1);
    expect(MAX_INTEREST).toBe(5);
    expect(lossStreakBonus(-2)).toBe(2);
    expect(lossStreakBonus(-4)).toBe(5);

    expect(allText, '利息要写"每 10 金 1 点"').toContain('10');
    expect(allText, '利息上限 5 要写出来').toContain(`最多 ${MAX_INTEREST}`);
    expect(allText, '连败 2 场给多少要写出来').toContain('连败 2 场 +2');
  });

  it('刷新 / 买经验 的价格和常量一致', () => {
    expect(REFRESH_COST).toBe(2);
    expect(BUY_XP_COST).toBe(4);
    expect(allText).toContain(`<b>${REFRESH_COST} 金</b>`);
    expect(allText).toContain(`<b>${BUY_XP_COST} 金</b>`);
  });
});
