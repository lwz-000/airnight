/**
 * ============================================================
 *  ★★ 0.3 房间设置（默认值 / 夹取 / 布阵时长 / 经济接线）
 * ============================================================
 *
 * 这一组守三件事：
 *   1. **默认值 = 现在的手感**。房主什么都不改时，开局金币 / 每回合收入 / 布阵时长
 *      必须和 0.2 一模一样 —— 否则"加了个设置功能"就顺手改了默认玩法。
 *   2. **夹取只有一处**（`clampRoomSettings`）。房主能发任意 JSON 上来，
 *      服务端一律过它；UI 上的 min/max 不是防线。
 *   3. **接线真的接上了**：前 3 回合固定 30 秒这条规则不能被自定义值冲掉。
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ROOM_SETTINGS,
  INCOME_BASE,
  PREP_SECONDS,
  ROOM_SETTINGS_LIMITS,
  START_GOLD,
  clampRoomSettings,
  createEconomy,
  isDefaultRoomSettings,
  prepSecondsForRound,
  roomSettingsSummary,
  settleRound,
} from '../src/index.js';

const makeRng = () => {
  let seed = 12345;
  return () => {
    seed = (seed * 1103515245 + 12345) >>> 0;
    return seed;
  };
};

describe('★ 0.3 房间设置：默认值就是原本的玩法', () => {
  it('血量 100 / 金币 3 / 收入 10 / 布阵 60 / 商店回合开 / 羁绊开', () => {
    expect(DEFAULT_ROOM_SETTINGS.startHp).toBe(100);
    expect(DEFAULT_ROOM_SETTINGS.startGold).toBe(START_GOLD);
    expect(DEFAULT_ROOM_SETTINGS.incomeBase).toBe(INCOME_BASE);
    expect(DEFAULT_ROOM_SETTINGS.prepSeconds).toBe(PREP_SECONDS);
    expect(DEFAULT_ROOM_SETTINGS.shopRound).toBe(true);
    // ★ 羁绊开关 0.3 只留接口，还没接进内核 —— 默认必须是 true，否则等于偷偷关掉羁绊
    expect(DEFAULT_ROOM_SETTINGS.traits).toBe(true);
  });

  it('夹一份空对象 / 乱七八糟的东西 = 默认值（不是全 0）', () => {
    expect(clampRoomSettings(undefined)).toEqual(DEFAULT_ROOM_SETTINGS);
    expect(clampRoomSettings(null)).toEqual(DEFAULT_ROOM_SETTINGS);
    expect(clampRoomSettings({})).toEqual(DEFAULT_ROOM_SETTINGS);
    expect(clampRoomSettings({ startHp: 'abc', startGold: NaN })).toEqual(DEFAULT_ROOM_SETTINGS);
    expect(isDefaultRoomSettings(clampRoomSettings({}))).toBe(true);
  });
});

describe('★ 0.3 房间设置：夹取', () => {
  it('越界一律夹到边界（不是拒绝、也不是放行）', () => {
    const low = clampRoomSettings({
      startHp: -1,
      startGold: 0,
      prepSeconds: 1,
      incomeBase: -99,
    });
    expect(low.startHp).toBe(ROOM_SETTINGS_LIMITS.startHp.min);
    expect(low.startGold).toBe(ROOM_SETTINGS_LIMITS.startGold.min);
    expect(low.prepSeconds).toBe(ROOM_SETTINGS_LIMITS.prepSeconds.min);
    expect(low.incomeBase).toBe(ROOM_SETTINGS_LIMITS.incomeBase.min);

    const high = clampRoomSettings({
      startHp: 1e9,
      startGold: 1e9,
      prepSeconds: 1e9,
      incomeBase: 1e9,
    });
    expect(high.startHp).toBe(ROOM_SETTINGS_LIMITS.startHp.max);
    expect(high.startGold).toBe(ROOM_SETTINGS_LIMITS.startGold.max);
    expect(high.prepSeconds).toBe(ROOM_SETTINGS_LIMITS.prepSeconds.max);
    expect(high.incomeBase).toBe(ROOM_SETTINGS_LIMITS.incomeBase.max);
  });

  it('小数四舍五入成整数（金币不能是 3.7 金）', () => {
    expect(clampRoomSettings({ startGold: 12.6 }).startGold).toBe(13);
    expect(clampRoomSettings({ prepSeconds: 59.5 }).prepSeconds).toBe(60);
  });

  it('布尔项只认真正的 boolean，字符串 "false" 不能把开关关掉', () => {
    expect(clampRoomSettings({ shopRound: 'false' }).shopRound).toBe(true);
    expect(clampRoomSettings({ shopRound: false }).shopRound).toBe(false);
  });

  it('文案摘要只列改过的项', () => {
    expect(roomSettingsSummary(DEFAULT_ROOM_SETTINGS)).toEqual([]);
    expect(roomSettingsSummary({ ...DEFAULT_ROOM_SETTINGS, startHp: 5000 })).toEqual(['开局血量 5000']);
    expect(roomSettingsSummary({ ...DEFAULT_ROOM_SETTINGS, shopRound: false })).toEqual(['关闭商店回合']);
  });
});

describe('★ 0.3 布阵时长：前 3 回合固定 30 秒，第 4 回合起才听房间设置', () => {
  it('不传自定义值 = 老行为（30 / 60）', () => {
    expect(prepSecondsForRound(1)).toBe(30);
    expect(prepSecondsForRound(3)).toBe(30);
    expect(prepSecondsForRound(4)).toBe(PREP_SECONDS);
  });

  it('自定义 500 秒：第 1~3 回合也不许跟着变长', () => {
    expect(prepSecondsForRound(1, 500)).toBe(30);
    expect(prepSecondsForRound(2, 500)).toBe(30);
    expect(prepSecondsForRound(3, 500)).toBe(30);
    expect(prepSecondsForRound(4, 500)).toBe(500);
  });

  it('自定义 10 秒：第 4 回合起就是 10 秒', () => {
    expect(prepSecondsForRound(4, 10)).toBe(10);
    expect(prepSecondsForRound(12, 10)).toBe(10);
  });

  it('非法值回落到默认 60（纯函数谁都能调，得自己兜住）', () => {
    expect(prepSecondsForRound(4, 0)).toBe(PREP_SECONDS);
    expect(prepSecondsForRound(4, -20)).toBe(PREP_SECONDS);
    expect(prepSecondsForRound(4, Number.NaN)).toBe(PREP_SECONDS);
  });
});

describe('★ 0.3 经济接线：开局金币 / 每回合基础收入', () => {
  it('createEconomy 不传 = 老行为（3 金起手）', () => {
    expect(createEconomy(makeRng()).gold).toBe(START_GOLD);
  });

  it('createEconomy 传 50 = 开局 50 金', () => {
    expect(createEconomy(makeRng(), undefined as never, 50).gold).toBe(50);
  });

  it('settleRound 不传 = 老行为（基础 10 + 利息）', () => {
    const economy = createEconomy(makeRng());
    economy.gold = 0;
    // 0 金币 -> 利息 0 -> 只拿基础 10
    expect(settleRound(economy, null).gold).toBe(INCOME_BASE);
  });

  it('settleRound 传 0 = 一毛基础收入都没有（只剩利息/连败等）', () => {
    const economy = createEconomy(makeRng());
    economy.gold = 0;
    economy.streak = 0;
    expect(settleRound(economy, null, 0, 0, 0, true, 0).gold).toBe(0);
    // 汇总文案里也要写 0，不能还印着"基础 10"
    expect(settleRound(economy, null, 0, 0, 0, true, 0).breakdown).toContain('基础 0');
  });

  it('settleRound 传 100 = 基础 100', () => {
    const economy = createEconomy(makeRng());
    economy.gold = 0;
    economy.streak = 0;
    expect(settleRound(economy, null, 0, 0, 0, true, 100).gold).toBe(100);
  });
});
