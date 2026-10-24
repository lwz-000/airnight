/**
 * 羁绊详情里"每个干员显示自己拥有的羁绊"（你报的第 1 条）。
 *
 * 【为什么这条需要测试？】
 * 因为看羁绊详情时玩家其实在做决策："再上一个谁就能凑到下一档？"
 * 只显示干员名字的话，还得挨个点开才知道他还有什么标签 ——
 * 而真正有用的信息恰恰是"他还能顺便帮我凑哪个羁绊"。
 * 所以每个干员名下必须列出**他自己的全部羁绊**，当前在看的那个高亮。
 *
 * 【怎么测？】
 * 这段渲染代码在 main.ts 里、依赖真实 DOM 和 3D 场景（jsdom 里点不到棋盘），
 * 所以分两层：
 *   1. 数据层：每个干员的标签都能查到中文名（不然只会显示一个 op01 这样的 id）
 *   2. 接线层：main.ts 里确实遍历了 unit.traits 并生成 .detail-unit-trait 标签，
 *      而且当前羁绊会高亮（只断言"可观察的接线"，和 dom-ui.test.ts 里的做法一致）
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TRAIT_DEFS, UNIT_DEFS } from '../../../packages/shared/src/index.js';

const mainSource = readFileSync(fileURLToPath(new URL('../src/main.ts', import.meta.url)), 'utf8');
const css = readFileSync(fileURLToPath(new URL('../src/styles.css', import.meta.url)), 'utf8');

describe('★ 羁绊详情：干员自己拥有哪些羁绊', () => {
  it('每个干员的每个标签都能查到羁绊名（否则界面上只会显示一个内部 id）', () => {
    for (const def of Object.values(UNIT_DEFS)) {
      // 召唤物和野怪都**故意**没有羁绊（不入牌库、不吃羁绊），跳过
      // ★ 彩蛋棋子（维维美·绝对主角）同样故意"没有任何羁绊"，一并跳过
      if (def.summonOnly || def.monsterOnly || def.noStar) continue;
      expect(def.traits.length, `${def.name} 一个羁绊都没有？`).toBeGreaterThan(0);
      for (const traitId of def.traits) {
        expect(TRAIT_DEFS[traitId], `${def.name} 的羁绊 ${traitId} 在羁绊表里不存在`).toBeDefined();
        expect(TRAIT_DEFS[traitId]!.name.length).toBeGreaterThan(0);
      }
    }
  });

  it('★ 羁绊详情里的干员条目会列出他自己的全部羁绊', () => {
    const body = /function openTraitDetail\(traitId: string\): void \{([\s\S]*?)\n\}/.exec(mainSource);
    expect(body, '找不到 openTraitDetail 函数').not.toBeNull();
    const code = body![1]!;
    expect(code, '必须遍历干员自己的 traits').toMatch(/for \(const id of unit\.traits\)/);
    expect(code, '每个羁绊都要生成一个标签').toContain('detail-unit-trait');
    // 当前正在看的那个羁绊要高亮，其余用暗色 —— 一眼分得清主次
    expect(code, '当前羁绊要有 current 标记').toContain("' current'");
    // 点标签能跳到那个羁绊的详情（顺着羁绊链看下去很顺手）
    expect(code, '标签要能点').toContain('openTraitDetail(id)');
  });

  it('标签的样式存在（没有样式的话会挤成一团看不清）', () => {
    expect(css).toContain('.detail-unit-traits');
    expect(css).toContain('.detail-unit-trait');
    expect(css, '当前羁绊的高亮样式').toContain('.detail-unit-trait.current');
  });
});
