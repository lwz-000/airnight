/**
 * ============================================================
 *  ★★ 0.3.2 盟约「阿米娅 · 不容拒绝」：升变任务
 * ============================================================
 *
 * 【玩法】选了这条盟约的玩家要"打出"两次升变资格：
 *
 *   阶段一 → 一张中间形态的证（青色怒火 / 慈悲愿景 二选一）
 *   阶段二 → 炉芯终曲之证
 *
 * 拿到证之后还要自己拖到阿米娅身上（走 `ItemOnEquip.ascend`，见 item-data.ts），
 * 所以这里的任务**只负责发证**，升变本身不在这里做。
 *
 * 【为什么任务不做成"回合一到就解锁"？】
 * 那样只是等，不是玩。下面两条都要求"阿米娅本人上场打"，玩家得为了她
 * 让出一个位置、优先给她强度，也才有了"该不该为这条线all in"的取舍。
 *
 * 【阈值为什么是这两个数？】（用户口径，2026-10-22 定）
 *   · 阶段一：参战 5 场 + 赢 3 场 —— 大约第 6~9 回合能到。1 费阿米娅本来就便宜，
 *     难的是"每场都让她上、还得赢"。
 *   · 阶段二：三星形态 + 10 级 + 累计 15 万伤害 —— 比"三星五费"再难一档。
 *     钱和运气的部分其实更松（9 张 1 费 vs 9 张 5 费），
 *     但"三星形态"买不到、只能靠买基础阿米娅凑，伤害还得真打出来。
 *
 * ★★ **野怪回合不算**（用户明确要求）：野怪是白给的战力，
 *   拿它刷任务等于"任务进度和玩法无关"。
 *
 * ★ 所有阈值和判定都只在这里写一遍 —— 进度条、弹窗、测试全都读它。
 *   改数值只改 `AMIYA_QUEST`，别去界面里改。
 */

import { AMIYA_BASE_ID, familyKeyOf } from './ascension.js';
import { damageByUnit } from './battle-stats.js';
import { FIX } from './constants.js';
import { MAX_LEVEL } from './economy.js';
import type { BattleEvent } from './types.js';

/** 阶段一：参战与胜场（野怪回合都不算） */
export const AMIYA_QUEST_BATTLES = 5;
export const AMIYA_QUEST_WINS = 3;

/**
 * 这条盟约的 id —— 任务只对**选了它**的玩家生效，进度条也只对他显示。
 * ★ 写成常量而不是在各处散落 `'cv_amiya'`，是为了"改 id 时只改一处"。
 */
export const AMIYA_COVENANT_ID = 'cv_amiya';

/**
 * 阶段二：三星形态 + 满级 + 累计伤害（野怪回合不算）
 *
 * ★ 伤害阈值的来历（2026-10-22 实测校准）：
 *   单只阿米娅的 DPS 大致是 1★56 / 2★88 / 3★142 / 青色怒火3★225 / 终曲3★798。
 *   一场按 20 秒算，升变之后每场 4.5k~16k ⇒ 累计 15 万大约要"打满二十五到三十回合"。
 *   早先定的 25000 只要四五场就满了，等于没有门槛；后来提到 10 万，
 *   实测还是偏松，2026-10-22 再提到 15 万。
 */
export const AMIYA_QUEST_STAR = 3;
export const AMIYA_QUEST_LEVEL = MAX_LEVEL;
export const AMIYA_QUEST_DAMAGE = 150000;

/**
 * 任务进度（住在 `GameState` 上）。
 *
 * `stage1` / `stage2` 是三态：
 *   · `none`    —— 还没达成；
 *   · `awaiting`—— 达成了、但还没发证（**布阵阶段**才处理，见 state 层）；
 *   · `claimed` —— 证已经发到专用栏位里了。
 */
export interface AmiyaQuestProgress {
  /** 阿米娅参战场次（野怪回合不算） */
  battles: number;
  /** 阿米娅参战且赢下的场次（野怪回合不算） */
  wins: number;
  /** 阿米娅（含三个形态）累计造成的伤害（**面板单位**，野怪回合不算） */
  damage: number;
  stage1: 'none' | 'awaiting' | 'claimed';
  stage2: 'none' | 'awaiting' | 'claimed';
}

/** 一局开始时清空 */
export function createAmiyaQuestProgress(): AmiyaQuestProgress {
  return { battles: 0, wins: 0, damage: 0, stage1: 'none', stage2: 'none' };
}

/** 阶段一达成的判据（参战场次 + 胜场都要到） */
export function amiyaQuestStage1Done(progress: AmiyaQuestProgress): boolean {
  return progress.battles >= AMIYA_QUEST_BATTLES && progress.wins >= AMIYA_QUEST_WINS;
}

/**
 * 阶段二达成的判据。
 *
 * @param star  阿米娅（任意形态）当前的**最高星级**；没上场/没有 = 0
 * @param level 玩家等级
 */
export function amiyaQuestStage2Done(
  progress: AmiyaQuestProgress,
  star: number,
  level: number,
): boolean {
  return (
    star >= AMIYA_QUEST_STAR && level >= AMIYA_QUEST_LEVEL && progress.damage >= AMIYA_QUEST_DAMAGE
  );
}

/**
 * 从一场战斗的日志里数"阿米娅打了多少伤害"。
 *
 * ★ 必须**按家族归并**：她这一场可能是 1 费本体，也可能已经是青色怒火/慈悲愿景/终曲。
 *   直接查 `op07` 会漏掉升变之后的输出（表现为"升变完伤害就不涨了"）。
 *
 * ★★ **单位换算（踩过的坑）**：战斗日志里的 `dealt` 是**定点数**（FIX=1000）——
 *   和血量、护甲同一套内部单位。而任务阈值 15 万是**面板伤害**
 *   （玩家在结算页 / 进度条上看到的那个数，见 `formatDamage` 的 `value / 1000`）。
 *   不除回面板单位的话，数字会大 1000 倍：真实打了 150 点伤害就能"完成 15 万"，
 *   进度条一开局就满。
 *
 * @param team 这个玩家在这一场站哪一队（0 / 1）
 */
export function amiyaDamageFromLog(log: readonly BattleEvent[], team: 0 | 1): number {
  let fixed = 0;
  for (const [defId, entry] of damageByUnit(log, team)) {
    if (familyKeyOf(defId) === AMIYA_BASE_ID) fixed += entry.dealt;
  }
  // 定点数 -> 面板单位（四舍五入到整数：进度条只显示整数，别留小数）
  return Math.round(fixed / FIX);
}

/** 一条进度（界面直接照着画，不要在界面里再拼文案） */
export interface AmiyaQuestLine {
  label: string;
  now: number;
  need: number;
  done: boolean;
  /**
   * ★ 百分比上限 100：`damage` 这类累计值会超过目标（打 20 万 / 要 15 万），
   * 进度条不能画到头还继续长。
   */
  percent: number;
}

export interface AmiyaQuestView {
  title: string;
  lines: AmiyaQuestLine[];
  /** 两段都发完了 —— 界面可以把整块收起来 */
  allDone: boolean;
}

const line = (label: string, now: number, need: number): AmiyaQuestLine => {
  const capped = Math.max(0, Math.min(now, need));
  return {
    label,
    now: Math.max(0, now),
    need,
    done: now >= need,
    percent: need <= 0 ? 100 : Math.round((capped / need) * 100),
  };
};

/**
 * 大数字用「万」—— 中文界面里「10 万」比「100.0k」直观得多。
 * 整数不带小数点（10 万），非整数保留一位（1.3 万）。
 */
const fmt = (value: number): string => {
  if (value < 10000) return `${value}`;
  const wan = value / 10000;
  return Number.isInteger(wan) ? `${wan} 万` : `${wan.toFixed(1)} 万`;
};

/**
 * 进度条要显示的内容。
 *
 * ★★ **只显示当前阶段**（用户口径）：一阶段还没拿到证时只画参战 / 胜场，
 *   拿到证之后才换成星级 / 等级 / 伤害。
 *   早先是一股脑全画出来 —— 玩家一进对局就看到 5 行、
 *   其中 3 行（三星 / 10 级 / 15 万伤害）当回合根本无从下手，
 *   反而看不出"我现在该干什么"。
 *
 * @param star  阿米娅（任意形态）最高星级
 * @param level 玩家等级
 */
export function amiyaQuestView(
  progress: AmiyaQuestProgress,
  star: number,
  level: number,
): AmiyaQuestView {
  const stage1Done = progress.stage1 === 'claimed';
  const lines: AmiyaQuestLine[] = [];

  if (!stage1Done) {
    // 第一阶段：只谈"参战 / 胜场"
    lines.push(
      line(`参战 ${progress.battles}/${AMIYA_QUEST_BATTLES}`, progress.battles, AMIYA_QUEST_BATTLES),
      line(`胜场 ${progress.wins}/${AMIYA_QUEST_WINS}`, progress.wins, AMIYA_QUEST_WINS),
    );
    return {
      title: '阿米娅 · 升变（第一阶段）',
      lines,
      allDone: false,
    };
  }

  // 第二阶段：只谈"三星形态 / 等级 / 伤害"
  lines.push(
    {
      label: `阿米娅 ${Math.min(star, AMIYA_QUEST_STAR)}/${AMIYA_QUEST_STAR} 星`,
      now: star,
      need: AMIYA_QUEST_STAR,
      done: star >= AMIYA_QUEST_STAR,
      percent: Math.round((Math.max(0, Math.min(star, AMIYA_QUEST_STAR)) / AMIYA_QUEST_STAR) * 100),
    },
    {
      label: `等级 ${Math.min(level, AMIYA_QUEST_LEVEL)}/${AMIYA_QUEST_LEVEL}`,
      now: level,
      need: AMIYA_QUEST_LEVEL,
      done: level >= AMIYA_QUEST_LEVEL,
      percent: Math.round(
        (Math.max(0, Math.min(level, AMIYA_QUEST_LEVEL)) / AMIYA_QUEST_LEVEL) * 100,
      ),
    },
    {
      label: `伤害 ${fmt(progress.damage)}/${fmt(AMIYA_QUEST_DAMAGE)}`,
      now: progress.damage,
      need: AMIYA_QUEST_DAMAGE,
      done: progress.damage >= AMIYA_QUEST_DAMAGE,
      percent: Math.round(
        (Math.max(0, Math.min(progress.damage, AMIYA_QUEST_DAMAGE)) / AMIYA_QUEST_DAMAGE) * 100,
      ),
    },
  );

  return {
    title: progress.stage2 === 'claimed' ? '阿米娅 · 升变（全部完成）' : '阿米娅 · 升变（第二阶段）',
    lines,
    allDone: progress.stage2 === 'claimed',
  };
}
