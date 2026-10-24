/**
 * ============================================================
 *  战斗统计（按"我方队伍"过滤的伤害 / 治疗 / 承伤）
 * ============================================================
 *
 * 【这个文件原来在 apps/web 里，为什么搬到 shared？】
 * 因为它现在**服务端也要用**：
 * 联机对局结算页要展示"每位玩家本局伤害最高的干员 + 造成的伤害量"，
 * 而每场战斗的权威日志只有服务器手里有（客户端只拿到自己那几场）。
 * 整局累计必须由服务器算 —— 不然每个人看到的"最高伤害"都不一样。
 *
 * 而统计规则**只允许有一份实现**（这个项目反复踩过"抄第二份"的坑），
 * 所以整块搬过来：客户端和服务器共用同一套累加逻辑，
 * `apps/web/src/game/battle-log.ts` 只是把这里的东西再导出去。
 *
 * 这里全是纯函数：给「事件数组 + 我是哪一队」就出结果，不碰 DOM、不碰平台。
 *
 * 【为什么统计要按"我方"过滤？】
 * 玩家只关心自己的棋子。所以：
 *  - 统计表里只有我方干员的条目（敌方的伤害算在"我方承受"里）
 *  - 日志只记我方打出的伤害、我方承受的伤害，以及我方相关的技能/治疗/阵亡
 * 敌方互殴不显示 —— 那和我方没关系，只会让日志变吵。
 *
 * 【"我方"是哪一队？】
 * 单机永远是 0。联机由服务器分配，可能是 1。
 * 所以每个函数都要求传入 myTeam，而不是在内部猜 —— 猜错的话
 * 统计会全部落在对面身上（这就是之前的一个 bug）。
 */
import type { BattleEvent } from './types.js';

/** 某个干员在这一场战斗里的统计 */
export interface UnitBattleStats {
  unitId: number;
  /** 干员 id（查费用/稀有度配色用，不靠名字反查） */
  defId: string;
  /** 星级 */
  star: number;
  /** 造成的伤害（含被护盾吸收的部分） */
  dealt: number;
  /** 承受的伤害（含被护盾挡掉的部分 —— 那也是实打实挨的） */
  taken: number;
  /** 治疗量 */
  healed: number;
  /** 是否已阵亡 */
  dead: boolean;
}

/** 单位 id -> 统计 */
export type StatsMap = Map<number, UnitBattleStats>;

// ------------------------------------------------------------
// 单位 id 规则（必须和内核的 unitIdFor() 一致）
// ------------------------------------------------------------

/** 队伍 0 的 id 是 1..999，队伍 1 是 1001..1999，所以 >=1000 就是队伍 1 */
export function teamOfUnitId(unitId: number): 0 | 1 {
  return unitId >= 1000 ? 1 : 0;
}

/** 由「队伍 + 队内下标」推出单位 id */
export function unitIdOf(team: 0 | 1, index: number): number {
  return team * 1000 + index + 1;
}

/** 这个单位是不是我的 */
export function isMyUnit(unitId: number, myTeam: 0 | 1): boolean {
  return teamOfUnitId(unitId) === myTeam;
}

/**
 * 把内部数值（千分之一）转成人类可读的伤害数字。
 * 3.5 万以上有点长，所以上万就缩写成 12.3k。
 */
export function formatDamage(value: number): string {
  const n = value / 1000;
  return n >= 10000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n));
}

// ------------------------------------------------------------
// 统计
// ------------------------------------------------------------

/**
 * 把一条事件累加进统计表。
 *
 * 【关键设计：条目从 spawn 事件里"长"出来】
 * 统计表一开始是空的，遇到 spawn 就新建条目（前提是我方单位）。
 * 这样就不需要在外面手工维护"我方有哪几个棋子" ——
 * 名单直接来自战斗本身，不可能和实际战斗不一致。
 * 代价是：`stats` 必须按 tick 顺序喂事件（spawn 都在 t=0，所以天然满足）。
 */
export function applyEventToStats(stats: StatsMap, event: BattleEvent, myTeam: 0 | 1): void {
  switch (event.type) {
    case 'spawn': {
      if (event.team !== myTeam) return;
      // 同一个 unitId 只建一次（重放时可能重复遇到）
      if (!stats.has(event.unitId)) {
        stats.set(event.unitId, {
          unitId: event.unitId,
          defId: event.defId,
          star: event.star,
          dealt: 0,
          taken: 0,
          healed: 0,
          dead: false,
        });
      }
      return;
    }
    case 'damage': {
      // 我方造成的
      const source = stats.get(event.sourceId);
      if (source) source.dealt += event.amount + event.absorbed;
      // 我方承受的（含被护盾挡掉的）
      const target = stats.get(event.targetId);
      if (target) target.taken += event.amount + event.absorbed;
      return;
    }
    case 'heal': {
      // 治疗算在"谁治疗"头上，而不是"谁被治疗"
      const source = stats.get(event.sourceId);
      if (source) source.healed += event.amount;
      return;
    }
    case 'death': {
      const unit = stats.get(event.unitId);
      if (unit) unit.dead = true;
      return;
    }
    default:
      return;
  }
}

/**
 * 从零算到某个 tick 为止的统计。
 *
 * 拖动播放进度条时用它：往回拖要把"未来"的数字清掉，往前拖要把跳过的事件补上，
 * 所以直接重放一遍最稳（几千条事件也就毫秒级）。
 */
export function statsUpTo(log: readonly BattleEvent[], myTeam: 0 | 1, uptoTick: number): StatsMap {
  const stats: StatsMap = new Map();
  for (const event of log) {
    if (event.t > uptoTick) break;
    applyEventToStats(stats, event, myTeam);
  }
  return stats;
}

/**
 * 渲染顺序：输出高的排前面，输出一样就比承受伤害（坦克会靠前一点）。
 * 最后用 unitId 兜底，保证排序稳定（同样的数据每次渲染顺序一致，看起来不会跳）。
 */
export function sortedStats(stats: StatsMap): UnitBattleStats[] {
  return [...stats.values()].sort((a, b) => b.dealt - a.dealt || b.taken - a.taken || a.unitId - b.unitId);
}

/**
 * ★ 0.1.1：把一整场战斗打出的伤害**按干员 id 归并**。
 *
 * 【为什么要归并，而不是按"这一个棋子实例"？】
 * 同一位干员每回合都是新的一只（unitId 是按队内下标现发的），
 * 而结算页要回答的是"本局谁打得最多" —— 那是"维什戴尔 打了 3.2 万"，
 * 不是"第 3 个出场位打了 3.2 万"。所以按 defId 汇总，
 * 星级取见过的最高那一档（同一只换过星级也能看懂）。
 *
 * @param log  战斗日志（服务端手里的权威日志）
 * @param team 这个玩家在这一场里站哪边（0 / 1）
 * @returns defId -> { defId, star, dealt }
 */
export function damageByUnit(
  log: readonly BattleEvent[],
  team: 0 | 1,
): Map<string, { defId: string; star: number; dealt: number }> {
  const out = new Map<string, { defId: string; star: number; dealt: number }>();
  for (const stats of sortedStats(statsUpTo(log, team, Number.POSITIVE_INFINITY))) {
    if (stats.dealt <= 0) continue;
    const prev = out.get(stats.defId);
    if (prev) {
      prev.dealt += stats.dealt;
      prev.star = Math.max(prev.star, stats.star);
    } else {
      out.set(stats.defId, { defId: stats.defId, star: stats.star, dealt: stats.dealt });
    }
  }
  return out;
}


// ============================================================
//  ★ 0.1.1：从战斗日志里读"这件藏品的随机效果抽到了谁"
// ============================================================

/**
 * 「开局随机强化一名干员」这件藏品（生还者合约）在这一场**抽到了谁**。
 *
 * 【为什么要从日志里读，而不是再算一遍？】
 * 抽签发生在**战斗内核开局那一刻**，用的是战斗自己的随机源（要和联机对端一致），
 * 所以客户端**没法**在界面里重新算一次 —— 只能看日志。日志里那条 `buff` 事件
 * 带着 `itemId`（哪件藏品给的）和 `targetId`（给了谁），信息是齐的。
 *
 * @returns 被强化的 unitId；这一场还没打 / 没有这条记录时为 null
 */
export function randomAllyBuffPick(log: readonly BattleEvent[], itemId: string): number | null {
  for (const event of log) {
    if (event.type !== 'buff') continue;
    if (event.itemId !== itemId) continue;
    return event.targetId;
  }
  return null;
}

/**
 * 日志里某个 unitId 是谁、属于哪一队（取自开局 `spawn` 事件）。
 *
 * 界面要显示干员名字、还要判断"这是不是我方"（观战别人的战斗时不能拿人家的抽签
 * 往我这边显示），两样都在开局事件里。
 */
export function spawnedUnitInfo(
  log: readonly BattleEvent[],
  unitId: number,
): { defId: string; team: 0 | 1 } | null {
  for (const event of log) {
    if (event.type !== 'spawn' || event.unitId !== unitId) continue;
    return { defId: event.defId, team: event.team };
  }
  return null;
}
