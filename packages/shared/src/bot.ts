/**
 * ============================================================
 *  人机（Bot）—— 难度定义 + 身份判据
 * ============================================================
 *
 * 【为什么难度定义要放在 shared，而不是服务端自己写一份？】
 * 因为**三处都要用到同一份 id**：
 *   · 服务端：裁决"这个难度存不存在"、按难度选决策参数；
 *   · 客户端：大厅里画难度选择器、玩家列表上标"人机 · 困难"；
 *   · 协议：这条消息带的 `difficulty` 字段。
 * 三处各写一份字面量 `'easy' | 'normal' | 'hard'`，迟早会有一处写成 `'hard '` 或者
 * 少加一档 —— 而且那时候的症状是"按钮点了没反应"，很难查到是字符串对不上。
 *
 * ★ 用户口径：**简单 / 普通 / 困难**三档。
 */

export const BOT_DIFFICULTIES = ['easy', 'normal', 'hard'] as const;
export type BotDifficulty = (typeof BOT_DIFFICULTIES)[number];

/** 默认档位（房主点「添加人机」时不选就是这个） */
export const DEFAULT_BOT_DIFFICULTY: BotDifficulty = 'normal';

export function isBotDifficulty(value: unknown): value is BotDifficulty {
  return typeof value === 'string' && (BOT_DIFFICULTIES as readonly string[]).includes(value);
}

/**
 * 夹一次难度：认不出就回默认。
 *
 * ★ 服务端**不能**因为一个乱填的值就把整条消息丢掉 ——
 *   那会让房主的界面停在"点了没反应"，而这本来是个无害的字段。
 */
export function clampBotDifficulty(value: unknown): BotDifficulty {
  return isBotDifficulty(value) ? value : DEFAULT_BOT_DIFFICULTY;
}

/** 界面文案（大厅里的选择器和玩家列表都用这一份） */
export const BOT_DIFFICULTY_INFO: Record<BotDifficulty, { label: string; short: string; hint: string }> = {
  easy: {
    label: '简单',
    short: '简',
    hint: '有钱就买、不挑不攒；很少升级，不刷新商店，摆位也比较随意。',
  },
  normal: {
    label: '普通',
    short: '普',
    hint: '会按等级节奏买经验、会凑同名升星、会挑羁绊；钱多时会刷新一次。',
  },
  hard: {
    label: '困难',
    short: '难',
    hint: '盯着羁绊成套去拿、会卖掉多余的、按射程前后排布阵，攒够钱就找核心。',
  },
};

export function botDifficultyLabel(difficulty: BotDifficulty): string {
  return BOT_DIFFICULTY_INFO[difficulty]?.label ?? BOT_DIFFICULTY_INFO[DEFAULT_BOT_DIFFICULTY].label;
}

/**
 * 人机 id 的前缀。
 *
 * ★ 真人 id 是 `p<计数器>-<时间戳36进制>`（见服务端 newPlayerId），
 *   绝不会以 `bot:` 开头 —— 所以这个前缀可以当"是不是人机"的**唯一判据**。
 * ★ 用 `:` 而不是 `-`：`-` 在 id 里到处都是，撞上的概率不为零；
 *   `:` 在房间码、玩家 id 里都不出现。
 */
export const BOT_ID_PREFIX = 'bot:';

export function botPlayerId(roomCode: string, index: number): string {
  return `${BOT_ID_PREFIX}${roomCode}:${index}`;
}

export function isBotPlayerId(id: string): boolean {
  return typeof id === 'string' && id.startsWith(BOT_ID_PREFIX);
}

/**
 * 人机的显示名。
 *
 * 【为什么带编号？】房间里同时放 3 个「人机·普通」的话，
 * 房主在大厅里根本分不清要删哪一个、要改哪一个的难度。
 *
 * ★ 长度控制在 8 个字以内（和玩家昵称的上限一致，界面上不会撑坏布局）。
 */
export function botDisplayName(difficulty: BotDifficulty, index: number): string {
  return `人机·${botDifficultyLabel(difficulty)}${index}`;
}

/**
 * 大厅里最多放几台人机。
 *
 * 【为什么不直接用「房间上限 8」？】因为 8 个座位全被占满时，
 * 房主自己想踢掉一台再换别的人都得先腾位置 —— 但这个上限真正的理由是
 * **对局至少要留一个真人**：全人机的房间没人看、也永远打不完"观战"那一套。
 * 所以取 7（8 座 - 1 个真人）。
 */
export const MAX_BOTS_PER_ROOM = 7;
