/**
 * ============================================================
 *  玩家昵称：清洗 / 长度规则 / 重名判定（**唯一实现**）
 * ============================================================
 *
 * 【为什么放在 shared 而不是服务端？】
 * 判据只有一个（服务端），但客户端也要在"点确定之前"先拦一下 ——
 * 不然玩家填完名字、点了进房、等一个来回才被告知"这名字有人用了"。
 * 两边各写一套必然漂移（以前客户端就写着"长度和字符由服务端统一清洗"，
 * 结果服务端一改客户端完全不知道）。所以规则提到 shared，
 * 服务端用它做**裁决**，客户端用它做**即时提示**。
 *
 * 【规则的来历（0.3 用户口径）】
 *   · 长度 **2~8 个字符**（按"字"算，不是按字节，也不是按 UTF-16 码元）
 *   · 只能使用：汉字 / 字母 / 数字 / 常用符号
 *   · 同一个房间里**不允许重名**
 */

/** 昵称最短几个字 */
export const NAME_MIN_LENGTH = 2;
/** 昵称最长几个字 */
export const NAME_MAX_LENGTH = 8;

/**
 * 允许的字符白名单。
 *
 * 【为什么用白名单而不是黑名单？】
 * 黑名单永远漏 —— 控制字符、零宽字符、双向覆盖符（U+202E 那种能把后面文字倒着显示的）、
 * 各种同形异义字，一个一个补是补不完的。白名单的漏法只有一种：
 * "某个正经字符没进来"，症状是玩家想用却打不出，能立刻被发现。
 *
 * 收进来的符号都是昵称里真会用的：下划线、连字符、中点、点、井号、@、叹号、问号、
 * 加号、等号、波浪号。方括号/尖括号**故意不收** —— 它们最容易伪造出"[系统]"这类假标签。
 */
const ALLOWED_CHAR = /[\p{Script=Han}A-Za-z0-9_\-·.#@!?+=~]/u;

/**
 * 把玩家填的名字洗成"能存的样子"。
 *
 * 顺序很重要：
 *   1. `normalize('NFKC')` —— 全角字母/数字先压回半角（`Ａlice` → `Alice`）。
 *      不压的话，同一个名字用全角打一遍就能绕过重名检查。
 *   2. 逐字符过滤白名单。
 *   3. 按**码点**截到 8 个字（`[...s]` 才不会把代理对劈成两半）。
 *
 * @returns 洗完之后的名字；可能为空串（调用方要用 `playerNameError` 判一下）
 */
export function sanitizePlayerName(raw: unknown): string {
  const text = String(raw ?? '').normalize('NFKC');
  let kept = '';
  for (const ch of text) {
    if (ALLOWED_CHAR.test(ch)) kept += ch;
  }
  return [...kept].slice(0, NAME_MAX_LENGTH).join('');
}

/** 昵称有几个"字"（按 Unicode 码点算，中文 1 个字、emoji 1 个字） */
export function playerNameLength(name: string): number {
  return [...name].length;
}

/**
 * 这个昵称合不合法？不合法返回给玩家看的话，合法返回 null。
 *
 * 文案直接面向玩家，所以写成人话而不是错误码。
 */
export function playerNameError(name: string): string | null {
  const length = playerNameLength(name);
  if (length === 0) return '昵称不能是空的';
  if (length < NAME_MIN_LENGTH) return `昵称至少要 ${NAME_MIN_LENGTH} 个字`;
  if (length > NAME_MAX_LENGTH) return `昵称最多 ${NAME_MAX_LENGTH} 个字`;
  return null;
}

/**
 * 比"重名"用的归一化键。
 *
 * 【为什么不能直接比字符串？】
 *   · 大小写：`Alice` 和 `alice` 在玩家眼里就是同一个人
 *   · 全角半角：`Ａlice` 和 `Alice`（NFKC 归一）
 *   · 空白：虽然白名单不放空格，但历史昵称里可能有，去掉更保险
 *
 * ★ 展 示 名 用原文，只有"比"的时候才用这个键 —— 别把归一化后的名字显示给玩家。
 */
export function playerNameKey(name: string): string {
  return String(name ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, '');
}

/**
 * 这个房间里有没有人已经叫这个名字了？（重名判定的**唯一实现**）
 *
 * @param exceptPlayerId 改自己名字时要排除自己，否则"不改名点确定"会被自己挡住
 */
export function nameTakenIn(
  players: readonly { id: string; name: string }[],
  name: string,
  exceptPlayerId?: string,
): boolean {
  const key = playerNameKey(name);
  if (key.length === 0) return false;
  for (const player of players) {
    if (exceptPlayerId !== undefined && player.id === exceptPlayerId) continue;
    if (playerNameKey(player.name) === key) return true;
  }
  return false;
}
