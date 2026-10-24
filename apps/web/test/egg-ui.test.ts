/**
 * ============================================================
 *  ★ 彩蛋棋子「维维美·绝对主角」的界面约定（源码级断言）
 * ============================================================
 *
 * 【为什么是"读源码"而不是"跑起来看"？】
 *   1. 「商店卡是炫彩的」最终落在 CSS 上 —— 而 jsdom **不做布局也不解析渐变**，
 *      断言 `getComputedStyle` 拿不到 border-image / background-clip 的效果。
 *   2. 「不写进概率面板」是一条**否定**约定（"这里不许出现彩蛋"），
 *      代码里没有的东西没法用运行时断言证明，只能盯源码。
 *   3. 这几条都是"以后有人顺手改坏就会静默失效"的地方 —— 正是源码断言最划算的场景。
 *
 * 真正跑起来的验证交给 e2e（scripts/ui-e2e-003.mjs）和实机截图。
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const mainSource = readFileSync(fileURLToPath(new URL('../src/main.ts', import.meta.url)), 'utf8');
const stateSource = readFileSync(fileURLToPath(new URL('../src/game/state.ts', import.meta.url)), 'utf8');
const css = readFileSync(fileURLToPath(new URL('../src/styles.css', import.meta.url)), 'utf8');

/** 截出某个函数的源码体（从函数名到第一个顶格 `}`） */
function bodyOf(source: string, marker: string): string {
  const at = source.indexOf(marker);
  expect(at, `源码里找不到 ${marker}`).toBeGreaterThanOrEqual(0);
  const rest = source.slice(at);
  const end = rest.indexOf('\n}');
  return end > 0 ? rest.slice(0, end) : rest;
}

describe('★ 彩蛋棋子：商店卡炫彩', () => {
  it('商店卡会带上 `egg` class，并用"两层 background"做出渐变描边', () => {
    expect(mainSource, '商店卡该按 noStar 加上 egg class').toContain("isEgg ? ' egg' : ''");
    expect(css, 'CSS 里要有 .shop-slot.egg 规则').toMatch(/\.shop-slot\.egg\s*\{/);
    // 渐变描边的关键：一层填内部（padding-box）、一层填边框（border-box）
    expect(css, '渐变描边靠 background-clip 两层实现').toContain(
      'background-clip: padding-box, border-box',
    );
    // 内联的稀有度色必须让位，否则会盖住 CSS 的渐变
    expect(mainSource).toContain("card.style.borderColor = 'transparent'");
  });

  it('立绘底和费用角标也是浅蓝紫（"干员背景卡面同样"）', () => {
    expect(css, '立绘底该有 egg 版').toMatch(/\.shop-portrait-box\.egg\s*\{/);
    expect(css, '费用角标该有 egg 版').toMatch(/\.shop-cost-badge\.egg\s*\{/);
  });

  it('不显示"可升星 / 差几个合成"那套提示（它没有星级机制）', () => {
    expect(mainSource, '彩蛋分支要直接输出空字符串').toMatch(/isEgg\s*\n?\s*\?\s*''/);
    expect(mainSource, '升星判断要排除彩蛋').toContain('const willMerge = !isEgg && owned >= 2;');
  });

  it('备战席用「彩蛋」标签代替星星', () => {
    expect(mainSource, '备战席要有 noStar 分支').toContain('def?.noStar');
    expect(mainSource).toContain('彩蛋棋子没有星级机制');
    expect(css, '那个标签也要有样式').toMatch(/\.bench-star-strip\.egg\s*\{/);
  });
});

describe('★ 彩蛋棋子：概率面板不许标注它', () => {
  it('shopOddsText 的函数体里不出现彩蛋（用户要求"不进行标注在概率显示上"）', () => {
    const body = bodyOf(stateSource, 'export function shopOddsText');
    expect(body).not.toContain('EGG');
    expect(body).not.toContain('egg');
    expect(body).not.toContain('彩蛋');
    expect(body).not.toContain('维维美');
  });
});

describe('★ 彩蛋棋子：可以佩戴装备（但升星 / 复制类除外）', () => {
  it('装备落点的排除条件是「野怪」和「升星/复制类藏品」，不是把彩蛋整个排除', () => {
    const body = bodyOf(mainSource, 'function itemDropAllowed');
    // 野怪不能穿装备 —— 这条没变
    expect(body).toContain('monsterOnly');
    /*
      ★ 0.1.1 改过这条规则（原来这里断言的是"body 里不许出现 noStar"）：
      用户要求「维维美·绝对主角」**永久屏蔽**拟态物质 / 博士投影这一类的
      （升星 / 复制 / 变身高一费）藏品。
      所以 noStar 现在**必须**出现，但只能和 `isUnitTransformingItem` 成对出现 ——
      光是一个 noStar 就说明有人把彩蛋整个排除在装备之外了，那才是回归。
    */
    expect(body, '彩蛋只该被"改造本体"那一类藏品挡住').toContain('noStar && isUnitTransformingItem');
  });
});
