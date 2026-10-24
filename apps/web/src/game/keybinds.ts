/**
 * ============================================================
 *  ★ 0.3.4「自定义快捷键」
 * ============================================================
 *
 * 用户口径：设置里能改常用键，且**不能和浏览器内核冲突**。
 *
 * 【为什么存 `event.code` 而不是 `event.key`？】
 * `key` 会跟着输入法和键盘布局变（中文输入法下按 D 可能是全角，俄文布局下是 другая буква），
 * `code` 才是"物理上那个键"。玩家说的是"我按 D 刷商店"，指的就是那个位置。
 *
 * 【为什么只允许单键、不存组合键？】
 * 组合键（Ctrl/Alt/Meta + X）几乎全被浏览器/系统占着：
 *   · Ctrl+W 关标签页、Ctrl+T 新标签、Ctrl+R 刷新（游戏里刷新商店和它撞了直接废掉一局）
 *   · Alt+← 后退、Alt+Tab 切窗口
 * 收成"单键"以后，能踩到的坑只剩 F5/F11/F12/Tab/Esc 这几个 —— 见 `reservedReason()`。
 *
 * 【为什么不持久化到服务端？】
 * 这是本机的手感偏好，和这一局无关，也没必要让服务器知道。存 localStorage 就够。
 */

export type KeyAction = 'refresh' | 'buyXp' | 'lockShop' | 'pause' | 'startBattle';

/** 设置面板里按这个顺序列出来（也是给玩家看的名字） */
export const KEY_ACTIONS: ReadonlyArray<{ action: KeyAction; label: string; hint: string }> = [
  { action: 'refresh', label: '刷新商店', hint: '花 2 金换一批牌' },
  { action: 'buyXp', label: '买经验', hint: '花 4 金升级' },
  { action: 'lockShop', label: '锁定商店', hint: '回合结束不自动刷新' },
  { action: 'pause', label: '暂停 / 继续', hint: '只在战斗阶段有效' },
  { action: 'startBattle', label: '开战', hint: '只在布阵阶段有效' },
];

export const DEFAULT_KEYBINDS: Readonly<Record<KeyAction, string>> = {
  refresh: 'KeyD',
  buyXp: 'KeyF',
  lockShop: 'KeyE',
  pause: 'Space',
  startBattle: 'Enter',
};

const STORAGE_KEY = 'airnight.keybinds';

/** 键盘码 → 给玩家看的名字（只做常见键，其余原样显示） */
export function keybindLabel(code: string): string {
  if (!code) return '未设置';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `小键盘 ${code.slice(6)}`;
  const named: Record<string, string> = {
    Space: '空格',
    Enter: '回车',
    Tab: 'Tab',
    Backspace: '退格',
    ArrowUp: '↑',
    ArrowDown: '↓',
    ArrowLeft: '←',
    ArrowRight: '→',
    Comma: ',',
    Period: '.',
    Slash: '/',
    Semicolon: ';',
    Quote: "'",
    BracketLeft: '[',
    BracketRight: ']',
    Backslash: '\\',
    Minus: '-',
    Equal: '=',
    Backquote: '`',
  };
  return named[code] ?? code;
}

/**
 * 这个键**不能**拿来绑 —— 返回拒绝原因，能用就返回 null。
 *
 * 判据都是实地想过的：绑上之后玩家会遇到"按了没反应"或者"整个页面被浏览器接管"。
 */
export function reservedReason(code: string): string | null {
  if (!code) return '没识别出这个键，换一个试试';
  // 修饰键本身不能当快捷键
  if (/^(Shift|Control|Alt|Meta|CapsLock|OS)(Left|Right)?$/.test(code)) {
    return '修饰键（Ctrl / Alt / Shift）不能单独当快捷键';
  }
  if (code === 'Escape') return 'Esc 留给「关闭浮层」，不能改';
  if (code === 'Tab') return 'Tab 是浏览器的焦点切换键';
  if (code === 'ContextMenu') return '这个键被系统菜单占用';
  // F1~F12：F5 刷新页面、F11 全屏、F12 开发者工具，其余各家浏览器也常留用
  if (/^F\d{1,2}$/.test(code)) return 'F1~F12 被浏览器 / 系统占用';
  // 媒体键、浏览器功能键
  if (/^(Media|Browser|Launch|AudioVolume|Power|Sleep|WakeUp)/.test(code)) {
    return '这是系统 / 播放器功能键，浏览器不会交给网页';
  }
  return null;
}

/**
 * 从 localStorage 读；坏数据 / 缺项都退回默认值（永远返回完整的一份）。
 *
 * ★★ 三条兜底（都不是杞人忧天：玩家会手改 localStorage，老版本也可能允许过 F5）：
 *   ① 存的是保留键 -> 这一项退回它的默认键；
 *   ② 两项撞同一个键 -> 后面那一项退回默认键；
 *   ③ 连默认键都被占了（数据乱到没法救）-> **整份退回默认**。
 * 核心保证只有一句：**返回的五项一定两两不同**，否则按键会触发两个动作。
 */
export function loadKeybinds(): Record<KeyAction, string> {
  const out: Record<KeyAction, string> = { ...DEFAULT_KEYBINDS };
  let parsed: Partial<Record<KeyAction, unknown>> | null = null;
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return out;
    parsed = JSON.parse(raw) as Partial<Record<KeyAction, unknown>>;
  } catch {
    // localStorage 被禁用 / JSON 坏了 —— 用默认值，不抛
    return out;
  }
  if (!parsed || typeof parsed !== 'object') return out;

  const taken = new Set<string>();
  for (const { action } of KEY_ACTIONS) {
    const stored = parsed[action];
    const usable =
      typeof stored === 'string' && !reservedReason(stored) && !taken.has(stored) ? stored : null;
    const code = usable ?? DEFAULT_KEYBINDS[action];
    // 连默认键都被别的动作占了 —— 这份数据已经没法解释，整份退回默认
    if (taken.has(code)) return { ...DEFAULT_KEYBINDS };
    out[action] = code;
    taken.add(code);
  }
  return out;
}

export function saveKeybinds(binds: Record<KeyAction, string>): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(binds));
  } catch {
    // 隐私模式 / 配额满：存不进去就算了，本次会话仍然生效
  }
}

/**
 * 改一个键。
 *
 * ★ 撞到别的动作用的是**交换**，不是报错 —— 玩家的意图是"我要让这个动作用这个键"，
 *   把原来那个动作顺手挪到旧键上，比弹一句"已被占用"更好用。
 */
export function setKeybind(
  binds: Record<KeyAction, string>,
  action: KeyAction,
  code: string,
): { ok: boolean; binds: Record<KeyAction, string>; message: string } {
  const bad = reservedReason(code);
  if (bad) return { ok: false, binds, message: bad };

  const next: Record<KeyAction, string> = { ...binds };
  const clash = (Object.keys(next) as KeyAction[]).find((key) => key !== action && next[key] === code);
  if (clash) {
    const previous = next[action]!;
    next[clash] = previous;
    next[action] = code;
    const clashLabel = KEY_ACTIONS.find((item) => item.action === clash)?.label ?? clash;
    return {
      ok: true,
      binds: next,
      message: `${keybindLabel(code)} 原来是「${clashLabel}」的，两个已经互换`,
    };
  }
  next[action] = code;
  return { ok: true, binds: next, message: '' };
}

/** 这个按键码对应哪个动作（没绑就是 undefined） */
export function actionForKey(binds: Record<KeyAction, string>, code: string): KeyAction | undefined {
  return (Object.keys(binds) as KeyAction[]).find((action) => binds[action] === code);
}

export function resetKeybinds(): Record<KeyAction, string> {
  return { ...DEFAULT_KEYBINDS };
}
