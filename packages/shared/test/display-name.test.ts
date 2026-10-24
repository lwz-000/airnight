/**
 * ============================================================
 *  ★ 0.2：对局里"单位给人看的名字" —— 野怪统一叫「野怪」
 * ============================================================
 *
 * 用户口径（2026-10-17）：「多人单人打野怪时不显示野怪具体名字，只显示野怪就好，在观战中也是」。
 *
 * 【为什么这件事值得一条测试？】
 * 名字映射有**三处**要生成：单机（main.ts）、测试沙盒（main.ts）、联机/观战（服务端）。
 * 三处各写一遍的话，最典型的漏法是"自己打看不到名字、观战能看到" ——
 * 也就是观战的人比参战的人知道得多。所以口径收在 `displayNameOf` 一处，这里钉住它。
 */
import { describe, expect, it } from 'vitest';
import { UNIT_DEFS, displayNameOf } from '../src/index.js';

describe('★ displayNameOf：野怪只显示「野怪」', () => {
  it('★ 干员显示本名', () => {
    expect(displayNameOf('op01')).toBe(UNIT_DEFS['op01']!.name);
    // 联机对面的玩家阵容也是干员 —— 照样显示本名（前缀由调用方加）
    expect(displayNameOf('op55')).toBe('丰川祥子');
  });

  it('★★ 所有野怪都显示成「野怪」（不分档位）', () => {
    const monsters = Object.values(UNIT_DEFS).filter((def) => def.monsterOnly);
    expect(monsters.length, '前提：库里得有野怪').toBeGreaterThan(10);
    for (const def of monsters) {
      expect(displayNameOf(def.id), `${def.id}（${def.name}）不该暴露名字`).toBe('野怪');
    }
    // 小怪 / Boss / 特殊援军都在里面
    expect(displayNameOf('mn_slime')).toBe('野怪');
    expect(displayNameOf('mn_gopro')).toBe('野怪');
  });

  it('★ 不认识的 id 原样返回（不写 undefined）', () => {
    expect(displayNameOf('not_a_real_id')).toBe('not_a_real_id');
  });
});
