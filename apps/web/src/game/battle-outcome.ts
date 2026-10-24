/**
 * ============================================================
 *  "我这一场"的胜负账本
 * ============================================================
 *
 * 【它修的是什么 bug（用户报的）】
 *   "输了但不扣血 / 赢了却扣血断连胜，小概率"
 *
 * 【根因】
 *   回合结算（`settleNetplayRound`）读的是两个模块级变量：
 *     · `currentResult` —— **此刻屏幕上那一场**战斗的结果
 *     · `myTeam`        —— **此刻屏幕上那一场**里我站哪边
 *   而这两个东西会被"观战"改掉：
 *     · 战斗打完之后点别人的对局看 → `currentResult` 变成**别人的**战斗；
 *     · `showBattle` 里 `myTeam = team1PlayerId === me ? 1 : 0`，
 *       看别人的对局时我两边都不是 ⇒ `myTeam` 被算成 0。
 *   于是"这一回合我赢了没有"变成了"**别人那一场**左边赢没赢"：
 *     · 别人那场左边赢了 → 我明明输了也记一胜（连胜不断、血量不动）；
 *     · 别人那场左边输了 → 我明明赢了也记一负（断连胜 + 按输结算）。
 *   概率低只是因为"你正好在回合切换那一刻还在看别人的战斗"。
 *
 * 【做法】
 *   自己那一场打完的那一刻，把**它自己的**结果存成一份独立的账本，
 *   之后所有"上一场怎么样"的问题都只问这份账本，再也不读屏幕上的东西。
 *   账本里也记下服务端发来的胜负（血量与战绩的权威口径），
 *   两边一旦不一致，以服务端为准。
 *
 * 这个模块刻意做成**纯函数**：不碰 DOM、不碰网络，好写单测把它钉死。
 */

/** 结算用的"我这一场"账本 */
export interface MyBattleRecord {
  /** 这一场的 id（单机/沙盒用 'solo'） */
  battleId: string;
  /** 我在这场比赛里是队伍 0 还是 1 */
  myTeam: 0 | 1;
  /** 本地重放算出来的胜者（0 / 1 / null = 平局） */
  winner: 0 | 1 | null;
  /**
   * 服务端对同一场给出的胜者。
   * 有它就以它为准 —— 血量、淘汰、连胜全是服务端算的，
   * 客户端自己再判一次只会多一套口径。
   */
  serverWinner?: 0 | 1 | null;
}

/**
 * 记下"我这一场"。
 *
 * 【合并规则（三条，都很关键）】
 *   ① 新的一场（battleId 不同）→ 整份替换，别把上一场的服务端胜负带过来；
 *   ② 同一场、这次没带 `serverWinner` → **保留旧的**（本地重放会重新赋值，
 *      不能把先到的服务端结论冲掉）；
 *   ③ 同一场、这次带了 `serverWinner` → 覆盖它。
 *
 * @param prev 之前那份（可以是 null）
 * @param next 这次要记的
 * @returns 合并后的账本；`battleId` 为空则视为无效，返回 null
 */
export function mergeMyBattle(
  prev: MyBattleRecord | null,
  next: MyBattleRecord,
): MyBattleRecord | null {
  if (!next.battleId) return prev;
  if (prev && prev.battleId === next.battleId) {
    return {
      ...next,
      // ② 没带就保留 —— `'serverWinner' in next` 才能区分"没传"和"传了 null（平局）"
      serverWinner: 'serverWinner' in next && next.serverWinner !== undefined
        ? next.serverWinner
        : prev.serverWinner,
    };
  }
  return { ...next };
}

/** 这一场最终算谁赢（服务端优先） */
export function effectiveWinner(record: MyBattleRecord | null): 0 | 1 | null {
  if (!record) return null;
  const winner = record.serverWinner !== undefined ? record.serverWinner : record.winner;
  return winner;
}

/**
 * 我赢了没有。
 *
 * @returns true 赢 / false 输 / null 平局或没有账本（**null 不等于输**，
 *          连胜/连败结算遇到 null 是"这一回合不算"，不能当成失败）
 */
export function wonOf(record: MyBattleRecord | null): boolean | null {
  const winner = effectiveWinner(record);
  if (winner === null || winner === undefined) return null;
  return winner === record!.myTeam;
}

/**
 * 这一场的胜者是不是**我这一队**（给 `survivorsOfTeam` / `battleGoldOf` 这类
 * 需要"我站哪边"的统计用）。
 *
 * 没有账本就退回调用方给的兜底值 —— 单机永远是 0。
 */
export function teamOf(record: MyBattleRecord | null, fallback: 0 | 1 = 0): 0 | 1 {
  return record ? record.myTeam : fallback;
}
