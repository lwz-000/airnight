/**
 * ============================================================
 *  ★ 右键防护：浏览器鼠标手势不该误操作游戏
 * ============================================================
 *
 * 【用户报的问题】"右键的鼠标手势经常误触"。
 *
 * 根因是两层叠在一起：
 *   1. 浏览器（Edge 内置 / 手势扩展）的手势都是**按住右键画轨迹**；
 *   2. `contextmenu` 的 target 取的是**松手点** —— 画完手势时指针早跑到别处了，
 *      于是那一下落在另一个棋子上，被当成"右键卖掉 / 右键收回"。
 *
 * 这一层修的是**第 2 条**（游戏自己能控的部分）：只有"按下～松开几乎没动"
 * 才算右键单击。第 1 条（浏览器内置手势）网页代码禁不掉，只能去浏览器设置里关 ——
 * 所以这里只保证"就算手势没关，也不会误操作棋子"。
 *
 * 真机验收在 e2e（scripts/ui-e2e-003.mjs 的第 ⑦ 项，用 CDP 真按真拖）。
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const mainSource = readFileSync(fileURLToPath(new URL('../src/main.ts', import.meta.url)), 'utf8');

describe('★ 右键防护：手势拖动不误触', () => {
  it('有位移阈值：右键按下～松开之间移动超过它就不算"单击"', () => {
    expect(mainSource, '该有像素阈值常量').toContain('RIGHT_CLICK_SLOP_PX');
    // 松开时用实际位移和阈值比较（Math.hypot 算两点距离）
    expect(mainSource).toMatch(
      /Math\.hypot\(\s*event\.clientX - rightDownX,\s*event\.clientY - rightDownY,?\s*\)\s*>\s*RIGHT_CLICK_SLOP_PX/,
    );
  });

  it('右键按下时记住起点（否则没法判断移动了多远）', () => {
    expect(mainSource).toContain('rightDownX = event.clientX');
    expect(mainSource).toContain('rightDownY = event.clientY');
    expect(mainSource).toContain('rightClickArmed = true');
  });

  it('★ 两个右键动作都过"干净单击"这道闸（棋盘收回 + 备战席卖掉）', () => {
    const calls = mainSource.match(/takePlainRightClick\(\)/g) ?? [];
    // 定义处 1 次 + 两个 contextmenu 各 1 次
    expect(calls.length, `takePlainRightClick() 只出现了 ${calls.length} 次`).toBeGreaterThanOrEqual(3);
    // 棋盘那条
    expect(mainSource).toMatch(/if \(!takePlainRightClick\(\)\) return;[\s\S]{0,200}handleBoardClick\(cell, 2\)/);
    // 备战席那条：判定之后才是卖棋
    // ★ 窗口从 400 放宽到 900：0.3.2 在"干净单击"之后、卖棋之前插了
    //   「升变形态不能出售」的拦（见下面那条测试），注释把它撑长了。
    expect(mainSource).toMatch(/if \(!takePlainRightClick\(\)\) return;[\s\S]{0,900}doSellBench\(state, unit\.uid\)/);
  });

  it('★★ 0.3.2：升变形态的拦截必须排在「把牌还回共享牌库」之前', () => {
    /*
      顺序反了会出一个很隐蔽的 bug：`net.sellCard` 是**还牌给服务器**，
      先发出去再被本地拒绝，就变成"棋子还在手上、牌却已经回到池子里" ——
      白送几张牌，而且不报错。
    */
    expect(mainSource).toMatch(
      /if \(!state\.testMode && isSellLockedDefId\(unit\.defId\)\)[\s\S]{0,400}net\.sellCard\(unit\.defId/,
    );
  });

  it('"干净单击"标记是一次性的（否则一次右键会卖两个）', () => {
    expect(mainSource).toMatch(/function takePlainRightClick\(\)[\s\S]{0,200}rightClickArmed = false/);
  });

  it('全页面禁掉浏览器右键菜单，但输入框放行（那里右键粘贴有用）', () => {
    expect(mainSource).toContain('function isTextEntry');
    expect(mainSource).toContain("node.tagName === 'INPUT'");
    expect(mainSource).toContain("node.tagName === 'TEXTAREA'");
    // 全局 contextmenu 里要先放行输入框再 preventDefault
    expect(mainSource).toMatch(/'contextmenu',\s*\(event\) => \{\s*if \(isTextEntry\(event\.target\)\) return;\s*event\.preventDefault\(\);/);
  });
});
