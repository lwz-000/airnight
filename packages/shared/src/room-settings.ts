/**
 * ============================================================
 *  ★★ 0.3 房间设置：房主可以在"还没开局"时 DIY 这一局的规则
 * ============================================================
 *
 * 【设计的三条硬规矩】
 *
 * 1. **默认值 = 现在的行为**。全部默认值都直接取现成的那几个常量
 *    （`START_GOLD` / `INCOME_BASE` / `PREP_SECONDS` / 血量 100 …），
 *    所以"房主没动过设置"这一局和 0.2 的手感**一个字节都不差**。
 *
 * 2. **唯一真相在服务端**。这份数据存在 `Room.settings`，由服务端下发；
 *    客户端只是照着画。反过来（客户端自己读常量）会出现两个后果：
 *    · 改本地就能改规则 —— 和反作弊要堵的是同一类洞；
 *    · 别人看到的是 A 规则、你看到的是 B 规则，联机直接对不上。
 *
 * 3. **夹范围只有一处**（`clampRoomSettings`）。房主可以发任意 JSON 上来，
 *    服务端一律过这一道 —— UI 上的 min/max 只是提示，不是防线。
 */

import { INCOME_BASE, START_GOLD } from './economy.js';
import { PREP_SECONDS } from './protocol.js';

export interface RoomSettings {
  /** 开局血量（每人在开打那一刻的血量） */
  startHp: number;
  /** 开局金币（第一回合手上的钱） */
  startGold: number;
  /** 要不要「商店回合」（0.2 那个野怪回合之后的 90 秒限时商店） */
  shopRound: boolean;
  /**
   * ★★ 0.3：**开局要不要走盟约选秀**。
   *
   * 关掉 = 房主点开始直接进第一回合（和 0.2 一样）。
   * 默认开 —— 用户口径是"多人模式开局前选盟约"。
   */
  covenants: boolean;
  /**
   * 羁绊功能开关。
   *
   * ★ 0.3 只**留接口**：这一项还没接进内核（`computeTraitBonuses` 那条链还没读它），
   * 界面上也**先不显示**。等羁绊真的能关掉的那一版再放出来 ——
   * 先摆一个"点了没反应"的开关比不摆更糟。
   */
  traits: boolean;
  /** 每回合布阵时长（秒）；第 1~3 回合**固定** 30 秒，见 `prepSecondsForRound` */
  prepSeconds: number;
  /** 每回合的基础收入（现在固定 10 金的那一项） */
  incomeBase: number;
}

/**
 * 数值范围。
 *
 * 【为什么金币/血量的上限给到 10 万？】
 * 用户口径就是"DIY 到底"—— 这本来就是个给朋友局玩的沙盒开关，
 * 想开一局"十万血互殴"没有理由拦。真正会出事的是**没有上限**（整数溢出、
 * 界面数字撑破布局），所以给一个足够大但确定的边界即可。
 *
 * ★ 唯一下限比较讲究的是 `incomeBase` 的 0：等于"完全不发基础收入"，
 *   这局只能靠利息和战利品过日子 —— 是有意思的玩法，所以允许。
 */
export const ROOM_SETTINGS_LIMITS = {
  startHp: { min: 10, max: 100000 },
  startGold: { min: 1, max: 100000 },
  prepSeconds: { min: 10, max: 500 },
  incomeBase: { min: 0, max: 100 },
} as const;

/** 开一间新房时的默认设置（= 0.2 的行为） */
export const DEFAULT_ROOM_SETTINGS: RoomSettings = {
  startHp: 100,
  startGold: START_GOLD,
  shopRound: true,
  covenants: true,
  traits: true,
  prepSeconds: PREP_SECONDS,
  incomeBase: INCOME_BASE,
};

/** 把任意输入夹成一份合法设置（**唯一**的夹取实现） */
export function clampRoomSettings(raw: unknown): RoomSettings {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof RoomSettings, unknown>>;
  const int = (value: unknown, limit: { min: number; max: number }, fallback: number): number => {
    const number = Math.round(Number(value));
    if (!Number.isFinite(number)) return fallback;
    return Math.min(limit.max, Math.max(limit.min, number));
  };
  const bool = (value: unknown, fallback: boolean): boolean =>
    typeof value === 'boolean' ? value : fallback;

  return {
    startHp: int(source.startHp, ROOM_SETTINGS_LIMITS.startHp, DEFAULT_ROOM_SETTINGS.startHp),
    startGold: int(source.startGold, ROOM_SETTINGS_LIMITS.startGold, DEFAULT_ROOM_SETTINGS.startGold),
    shopRound: bool(source.shopRound, DEFAULT_ROOM_SETTINGS.shopRound),
    covenants: bool(source.covenants, DEFAULT_ROOM_SETTINGS.covenants),
    traits: bool(source.traits, DEFAULT_ROOM_SETTINGS.traits),
    prepSeconds: int(
      source.prepSeconds,
      ROOM_SETTINGS_LIMITS.prepSeconds,
      DEFAULT_ROOM_SETTINGS.prepSeconds,
    ),
    incomeBase: int(source.incomeBase, ROOM_SETTINGS_LIMITS.incomeBase, DEFAULT_ROOM_SETTINGS.incomeBase),
  };
}

/** 这份设置是不是"全是默认值"（界面上用来标「自定义」徽章） */
export function isDefaultRoomSettings(settings: RoomSettings): boolean {
  return (Object.keys(DEFAULT_ROOM_SETTINGS) as Array<keyof RoomSettings>).every(
    (key) => settings[key] === DEFAULT_ROOM_SETTINGS[key],
  );
}

/** 一份可以直接拼进文案的"这一局改了什么"（没改就返回空数组） */
export function roomSettingsSummary(settings: RoomSettings): string[] {
  const out: string[] = [];
  if (settings.startHp !== DEFAULT_ROOM_SETTINGS.startHp) out.push(`开局血量 ${settings.startHp}`);
  if (settings.startGold !== DEFAULT_ROOM_SETTINGS.startGold) out.push(`开局金币 ${settings.startGold}`);
  if (settings.incomeBase !== DEFAULT_ROOM_SETTINGS.incomeBase) out.push(`每回合收入 ${settings.incomeBase}`);
  if (settings.prepSeconds !== DEFAULT_ROOM_SETTINGS.prepSeconds) out.push(`布阵 ${settings.prepSeconds} 秒`);
  if (!settings.shopRound) out.push('关闭商店回合');
  if (!settings.covenants) out.push('关闭盟约');
  return out;
}
