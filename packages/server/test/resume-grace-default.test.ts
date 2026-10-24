/**
 * ============================================================
 *  ★ 0.1.4：断线后"座位保留多久"的**默认值**
 * ============================================================
 *
 * 【为什么要单独钉住这两个数？】
 * 它们决定"玩家关掉浏览器、再重新进游戏，还回不回得来"，而且**改坏了完全静默**：
 * 调短了不会有任何报错，只会表现成"重连有概率失败"，很难联想到是宽限期。
 *
 * 这条是用户明确提过的要求：
 *   · **大厅 3 分钟** —— 和他/她在房间里看到的那个暂停倒计时（3:00）一致，
 *     30 秒实在太短：实测"关掉浏览器 → 双击启动游戏.cmd → 等页面加载完"
 *     轻松超过 30 秒，于是刚回到页面座位就已经被清掉了。
 *   · **对局 5 分钟** —— 必须大于一个完整回合（60 秒布阵 + 最多 164 秒战斗兜底）。
 *
 * ★ 测的是**默认值**：故意不设 `AIRNIGHT_RESUME_GRACE_MS`
 *   （那个环境变量是给 `resume-grace.test.ts` 把宽限期压到毫秒级用的）。
 * ★ 必须在 import 之前设好 `AIRNIGHT_NO_AUTOSTART`，否则一 import 就把服务器起起来了。
 */
import { describe, expect, it } from 'vitest';

process.env.AIRNIGHT_NO_AUTOSTART = '1';
delete process.env.AIRNIGHT_RESUME_GRACE_MS;
const { RESUME_GRACE_LOBBY_MS, RESUME_GRACE_MATCH_MS } = await import('../src/main.js');

describe('★ 0.1.4：断线后座位保留多久（默认值）', () => {
  it('大厅保留 3 分钟 —— 和房间内那个暂停倒计时（3:00）同一个数量级', () => {
    expect(RESUME_GRACE_LOBBY_MS, '大厅宽限期太短 = 关个浏览器回来座位就没了').toBe(3 * 60 * 1000);
  });

  it('对局保留 5 分钟 —— 必须大于一个完整回合（60 秒布阵 + 战斗兜底）', () => {
    expect(RESUME_GRACE_MATCH_MS).toBe(5 * 60 * 1000);
    expect(RESUME_GRACE_MATCH_MS, '对局比大厅还短的话，打到一半掉线必回不来').toBeGreaterThan(
      RESUME_GRACE_LOBBY_MS,
    );
  });
});
