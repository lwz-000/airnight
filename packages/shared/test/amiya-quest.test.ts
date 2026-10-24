/**
 * ============================================================
 *  ★★ 0.3.2 阿米娅升变任务：度量与文案
 * ============================================================
 *
 * 这一组守三件事（都是"错了也不会报错"的那种）：
 *   1. 伤害必须**按家族归并** —— 她这一场可能是本体，也可能已经升变，
 *      只查 `op07` 会漏掉升变之后的输出（表现为"升变完伤害就不涨了"）；
 *   2. 两段的达成判据（含"三星形态 + 10 级 + 伤害"三条都要到）；
 *   3. 进度条的百分比**封顶 100**（伤害会超目标，进度条不能画过头）。
 */
import { describe, expect, it } from 'vitest';
import {
  AMIYA_CERT_IDS,
  AMIYA_CERT_ORDER,
  AMIYA_CERT_SLOTS,
  AMIYA_COVENANT_ID,
  AMIYA_FORM_IDS,
  AMIYA_QUEST_BATTLES,
  AMIYA_QUEST_DAMAGE,
  AMIYA_QUEST_LEVEL,
  AMIYA_QUEST_STAR,
  AMIYA_QUEST_WINS,
  ITEM_DEFS,
  amiyaDamageFromLog,
  amiyaQuestStage1Done,
  amiyaQuestStage2Done,
  amiyaQuestView,
  createAmiyaQuestProgress,
  type BattleEvent,
} from '../src/index.js';

/*
  ★★ 战斗日志里的伤害是**定点数**（FIX=1000）—— 和血量、护甲同一套内部单位。
  所以这里写 100000 才是"面板 100 伤害"。任务阈值 25000 也是面板值，
  `amiyaDamageFromLog` 负责除回面板单位（曾经漏了这步：真实 26 点就能"完成 25000"）。
*/
function sampleLog(): BattleEvent[] {
  return [
    { type: 'spawn', t: 0, unitId: 1, team: 0, defId: 'op07', star: 2 },
    { type: 'spawn', t: 0, unitId: 2, team: 0, defId: AMIYA_FORM_IDS.blue, star: 3 },
    // 阿米娅本体打 100（面板）
    { type: 'damage', t: 10, sourceId: 1, targetId: 1001, amount: 100_000, absorbed: 0 },
    // 青色怒火打 250（面板）
    { type: 'damage', t: 11, sourceId: 2, targetId: 1001, amount: 250_000, absorbed: 0 },
    // 别人打 999（不能算到阿米娅头上）
    { type: 'spawn', t: 0, unitId: 3, team: 0, defId: 'op01', star: 1 },
    { type: 'damage', t: 12, sourceId: 3, targetId: 1001, amount: 999_000, absorbed: 0 },
  ] as unknown as BattleEvent[];
}

describe('★ 升变任务：常量与证', () => {
  it('任务只对「不容拒绝」这一条盟约生效', () => {
    expect(AMIYA_COVENANT_ID).toBe('cv_amiya');
  });

  it('两段的阈值就是用户定的那组数', () => {
    expect(AMIYA_QUEST_BATTLES).toBe(5);
    expect(AMIYA_QUEST_WINS).toBe(3);
    expect(AMIYA_QUEST_STAR).toBe(3);
    expect(AMIYA_QUEST_LEVEL).toBe(10);
    expect(AMIYA_QUEST_DAMAGE).toBe(150000);
  });

  it('★ 三张证在藏品表里都存在，而且固定顺序 = 3 格', () => {
    expect(AMIYA_CERT_SLOTS).toBe(3);
    expect(AMIYA_CERT_ORDER).toEqual([
      AMIYA_CERT_IDS.blue,
      AMIYA_CERT_IDS.mercy,
      AMIYA_CERT_IDS.core,
    ]);
    for (const id of AMIYA_CERT_ORDER) {
      const item = ITEM_DEFS[id];
      expect(item, `藏品表里没有 ${id}`).toBeDefined();
      expect(item!.covenantOnly, `${id} 必须是盟约专属`).toBe(true);
      expect(item!.onEquip?.ascend, `${id} 必须能升变`).toBeDefined();
    }
  });
});

describe('★ 伤害统计：必须按家族归并，并且换算成面板单位', () => {
  it('本体 + 升变形态都算她的输出，别人打的不算', () => {
    expect(amiyaDamageFromLog(sampleLog(), 0)).toBe(350);
  });

  it('★★ 定点数必须除回面板值（FIX=1000）—— 否则阈值会变成 1/1000', () => {
    // 一条"面板 12000"的伤害 = 日志里 12_000_000
    const log = [
      { type: 'spawn', t: 0, unitId: 1, team: 0, defId: 'op07', star: 1 },
      { type: 'damage', t: 5, sourceId: 1, targetId: 1001, amount: 12_000_000, absorbed: 0 },
    ] as unknown as BattleEvent[];
    expect(amiyaDamageFromLog(log, 0), '12_000_000 定点 = 12000 面板').toBe(12000);
  });

  it('★ 换算后要取整（进度条只显示整数，别留小数）', () => {
    const log = [
      { type: 'spawn', t: 0, unitId: 1, team: 0, defId: 'op07', star: 1 },
      { type: 'damage', t: 5, sourceId: 1, targetId: 1001, amount: 1234, absorbed: 0 },
    ] as unknown as BattleEvent[];
    // 1234 定点 = 1.234 面板 -> 1
    expect(amiyaDamageFromLog(log, 0)).toBe(1);
  });

  it('★ 换成对面视角就是 0（那是"我"造成的伤害，不是敌人的）', () => {
    expect(amiyaDamageFromLog(sampleLog(), 1)).toBe(0);
  });

  it('空日志 = 0，不抛异常', () => {
    expect(amiyaDamageFromLog([], 0)).toBe(0);
  });
});

describe('★ 达成判据', () => {
  it('第一阶段：参战 5 场 + 赢 3 场，缺一不可', () => {
    const base = createAmiyaQuestProgress();
    expect(amiyaQuestStage1Done(base)).toBe(false);
    // 打了 5 场但只赢 2 场 -> 不行
    expect(amiyaQuestStage1Done({ ...base, battles: 5, wins: 2 })).toBe(false);
    // 赢了 3 场但只打 4 场 -> 也不行（"赢的场次"是参战的子集，数量上过不去）
    expect(amiyaQuestStage1Done({ ...base, battles: 4, wins: 3 })).toBe(false);
    expect(amiyaQuestStage1Done({ ...base, battles: 5, wins: 3 })).toBe(true);
  });

  it('第二阶段：三星 + 10 级 + 25000 伤害，三条都要到', () => {
    const base = { ...createAmiyaQuestProgress(), damage: AMIYA_QUEST_DAMAGE };
    expect(amiyaQuestStage2Done(base, 2, 10)).toBe(false); // 星级不够
    expect(amiyaQuestStage2Done(base, 3, 9)).toBe(false); // 等级不够
    expect(amiyaQuestStage2Done({ ...base, damage: 24999 }, 3, 10)).toBe(false); // 伤害不够
    expect(amiyaQuestStage2Done(base, 3, 10)).toBe(true);
  });
});

describe('★ 进度条：只画当前阶段', () => {
  it('★★ 第一阶段只显示「参战 / 胜场」两行（不再把第二阶段一起摊开）', () => {
    const view = amiyaQuestView(createAmiyaQuestProgress(), 0, 1);
    expect(view.lines).toHaveLength(2);
    expect(view.lines.map((line) => line.label.split(' ')[0])).toEqual(['参战', '胜场']);
    expect(view.title).toContain('第一阶段');
  });

  it('★★ 拿到证（stage1 = claimed）之后才换成「星级 / 等级 / 伤害」三行', () => {
    const progress = { ...createAmiyaQuestProgress(), stage1: 'claimed' as const };
    const view = amiyaQuestView(progress, 1, 5);
    expect(view.lines).toHaveLength(3);
    expect(view.lines.map((line) => line.label.split(' ')[0])).toEqual(['阿米娅', '等级', '伤害']);
    expect(view.title).toContain('第二阶段');
  });

  it('★ 大数字用「万」显示（"10 万"比"100.0k"直观）', () => {
    const progress = {
      ...createAmiyaQuestProgress(),
      stage1: 'claimed' as const,
      damage: 12345,
    };
    const view = amiyaQuestView(progress, 1, 5);
    const damageLine = view.lines.find((line) => line.label.startsWith('伤害'))!;
    expect(damageLine.label).toContain('1.2 万');
    expect(damageLine.label).toContain('15 万');
    expect(damageLine.label).not.toContain('k');
  });

  it('百分比封顶 100（伤害会超过目标，条不能画过头）', () => {
    const progress = {
      ...createAmiyaQuestProgress(),
      stage1: 'claimed' as const,
      damage: AMIYA_QUEST_DAMAGE * 3,
    };
    const view = amiyaQuestView(progress, 3, 10);
    const damageLine = view.lines.find((line) => line.label.startsWith('伤害'))!;
    expect(damageLine.percent).toBe(100);
    expect(damageLine.done).toBe(true);
  });

  it('两段都发完之后 allDone = true（界面可以把这块收起来）', () => {
    const progress = {
      ...createAmiyaQuestProgress(),
      stage1: 'claimed' as const,
      stage2: 'claimed' as const,
    };
    expect(amiyaQuestView(progress, 3, 10).allDone).toBe(true);
  });
});
