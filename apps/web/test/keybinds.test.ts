/**
 * ============================================================
 *  ★ 0.3.4 自定义快捷键
 * ============================================================
 * 用户口径：设置里能改常用键，且**不能和浏览器内核冲突**。
 *
 * 这一组守三件事：
 *   ① 默认键和以前完全一样（D / F / E / 空格 / 回车）—— 老玩家不用重新学；
 *   ② 浏览器占用的键一律拒绝（Esc / Tab / F1~F12 / 修饰键 / 媒体键）；
 *   ③ 存盘坏了、或者两个动作撞了同一个键，能自己收拾干净（不能出现"两个动作抢一个键"）。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_KEYBINDS,
  KEY_ACTIONS,
  actionForKey,
  keybindLabel,
  loadKeybinds,
  reservedReason,
  resetKeybinds,
  saveKeybinds,
  setKeybind,
  type KeyAction,
} from '../src/game/keybinds.js';

/**
 * 测试环境的 localStorage：有的用例跑在 node 环境里（没有 window 就没有它），
 * 所以自己装一个最小的假货 —— 顺便让"存盘 / 读回"这两条真的被走一遍。
 */
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

describe('默认值：和旧版硬编码的键位一致', () => {
  it('刷新 D / 买经验 F / 锁定 E / 暂停 空格 / 开战 回车', () => {
    expect(DEFAULT_KEYBINDS).toEqual({
      refresh: 'KeyD',
      buyXp: 'KeyF',
      lockShop: 'KeyE',
      pause: 'Space',
      startBattle: 'Enter',
    });
  });

  it('五个动作都有名字和说明（设置面板要列出来）', () => {
    expect(KEY_ACTIONS).toHaveLength(5);
    for (const item of KEY_ACTIONS) {
      expect(item.label.length, `${item.action} 缺名字`).toBeGreaterThan(0);
      expect(item.hint.length, `${item.action} 缺说明`).toBeGreaterThan(0);
      expect(DEFAULT_KEYBINDS[item.action], `${item.action} 没有默认键`).toBeTruthy();
    }
  });
});

describe('不能和浏览器冲突', () => {
  it('Esc / Tab / F1~F12 / 修饰键 / 媒体键 一律拒绝', () => {
    for (const code of [
      'Escape',
      'Tab',
      'F1',
      'F5',
      'F11',
      'F12',
      'ControlLeft',
      'ShiftRight',
      'AltLeft',
      'MetaLeft',
      'CapsLock',
      'MediaPlayPause',
      'BrowserBack',
      'AudioVolumeUp',
    ]) {
      expect(reservedReason(code), `${code} 不该被允许`).toBeTruthy();
    }
  });

  it('字母 / 数字 / 空格 / 回车 / 方向键都能用', () => {
    for (const code of ['KeyQ', 'KeyZ', 'Digit1', 'Numpad5', 'Space', 'Enter', 'ArrowUp', 'Comma']) {
      expect(reservedReason(code), `${code} 应该能用`).toBeNull();
    }
  });

  it('设置被拒的键：原样返回，一个字段都不改', () => {
    const binds = { ...DEFAULT_KEYBINDS };
    const result = setKeybind(binds, 'refresh', 'F5');
    expect(result.ok).toBe(false);
    expect(result.message).toContain('F');
    expect(result.binds, '失败时不能改动').toBe(binds);
  });
});

describe('改键与冲突', () => {
  it('改成一个没人用的键', () => {
    const result = setKeybind({ ...DEFAULT_KEYBINDS }, 'refresh', 'KeyR');
    expect(result.ok).toBe(true);
    expect(result.binds.refresh).toBe('KeyR');
    expect(result.message).toBe('');
  });

  it('★ 撞到别的动作 = 两个互换（不是报错，也不能两个动作共用一个键）', () => {
    const result = setKeybind({ ...DEFAULT_KEYBINDS }, 'buyXp', 'KeyD');
    expect(result.ok).toBe(true);
    expect(result.binds.buyXp).toBe('KeyD');
    expect(result.binds.refresh, '刷新被挪到买经验原来的键上').toBe('KeyF');
    // 五个键依旧两两不同
    const all = Object.values(result.binds);
    expect(new Set(all).size).toBe(all.length);
  });

  it('actionForKey 能找到对应动作；没绑的返回 undefined', () => {
    const binds = { ...DEFAULT_KEYBINDS };
    expect(actionForKey(binds, 'KeyD')).toBe('refresh');
    expect(actionForKey(binds, 'Enter')).toBe('startBattle');
    expect(actionForKey(binds, 'KeyP')).toBeUndefined();
  });

  it('恢复默认', () => {
    expect(resetKeybinds()).toEqual(DEFAULT_KEYBINDS);
  });
});

describe('存盘', () => {
  it('存了能读回来', () => {
    const binds = { ...DEFAULT_KEYBINDS, refresh: 'KeyR' };
    saveKeybinds(binds);
    expect(loadKeybinds()).toEqual(binds);
  });

  it('没存过 -> 默认值', () => {
    expect(loadKeybinds()).toEqual(DEFAULT_KEYBINDS);
  });

  it('★ 存进去的键后来变成禁用键 / 两项撞车 -> 自动退回默认（不能带着坏数据启动）', () => {
    // 模拟"玩家用手改 localStorage"或"老版本允许过 F5"
    globalThis.localStorage?.setItem(
      'airnight.keybinds',
      JSON.stringify({ refresh: 'F5', buyXp: 'KeyD', lockShop: 'KeyD' } as Record<KeyAction, string>),
    );
    const binds = loadKeybinds();
    expect(binds.refresh, 'F5 是保留键 -> 退回默认 D').toBe('KeyD');
    expect(binds.lockShop, '和买经验撞车的那一项退回默认 E').toBe('KeyE');
    // 读出来永远是五项齐全、两两不同
    const all = Object.values(binds);
    expect(all).toHaveLength(5);
    expect(new Set(all).size).toBe(5);
  });

  it('JSON 坏了也不崩', () => {
    globalThis.localStorage?.setItem('airnight.keybinds', '{ 不是 json');
    expect(loadKeybinds()).toEqual(DEFAULT_KEYBINDS);
  });
});

describe('键名显示', () => {
  it('字母 / 空格 / 回车 / 方向键都有人话', () => {
    expect(keybindLabel('KeyD')).toBe('D');
    expect(keybindLabel('Digit1')).toBe('1');
    expect(keybindLabel('Space')).toBe('空格');
    expect(keybindLabel('Enter')).toBe('回车');
    expect(keybindLabel('ArrowUp')).toBe('↑');
    expect(keybindLabel('')).toBe('未设置');
  });
});
