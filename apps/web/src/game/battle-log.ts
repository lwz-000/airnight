/**
 * 战斗日志 + 我方伤害统计（纯函数，不碰 DOM）。
 *
 * 【为什么单独一个文件？】
 * 这两件事以前写在 main.ts 里，和界面代码混在一起，结果：
 *  - 测试没法测（要启动整个客户端 + WebGL 才能跑一行逻辑）
 *  - 拖动进度条回放时，日志和统计各写一套重建代码，很容易只改一边
 * 现在它们都是纯函数：给「事件数组 + 我是哪一队」就出结果，
 * 所以能直接写单元测试，也能保证「日志和统计用的是同一套规则」。
 *
 * 【为什么统计要按"我方"过滤？】
 * 玩家只关心自己的棋子。所以：
 *  - 统计表里只有我方干员的条目（敌方的伤害算在"我方承受"里）
 *  - 日志只记我方打出的伤害、我方承受的伤害，以及我方相关的技能/治疗/阵亡
 * 敌方互殴不显示 —— 那和我方没关系，只会让日志变吵。
 *
 * 【"我方"是哪一队？】
 * 单机永远是 0。联机由服务器分配，可能是 1。
 * 所以 each 函数都要求传入 myTeam，而不是在内部猜 —— 猜错的话
 * 统计会全部落在对面身上（这就是之前的一个 bug）。
 */

// 下面两个是"本地也要用"的（格式化日志行），所以既 import 进来、又 export 出去
import { TRAIT_DEFS, formatDamage, isMyUnit, type BattleEvent } from '@airnight/shared';

/*
  ============================================================
  ★ 0.1.1：战斗统计（伤害 / 治疗 / 承伤）已经搬到
  `packages/shared/src/battle-stats.ts`
  ============================================================
  【为什么要搬？】
  因为**服务端也要用它**：联机对局结算页要展示"每位玩家本局伤害最高的干员
  及其伤害量"，而整局的权威战斗日志只有服务器手里有（客户端只拿到自己那几场）。
  整局累计必须由服务器算，否则每个人看到的"最高伤害"都不一样。

  而统计规则**只允许有一份实现**，所以整块搬去共享层，
  这里只是把它们**再导出去** —— 界面上原有的 import 一行都不用改。
*/
export {
  applyEventToStats,
  damageByUnit,
  formatDamage,
  isMyUnit,
  sortedStats,
  statsUpTo,
  teamOfUnitId,
  unitIdOf,
  type StatsMap,
  type UnitBattleStats,
} from '@airnight/shared';

/** 一行日志（已经和界面无关，只是文字 + 颜色分类） */
export interface LogLine {
  text: string;
  css: string;
}

/** 带时间戳的日志行（渲染成一行时要用 tick 做前缀） */
export interface TimedLogLine extends LogLine {
  /** 事件发生在第几 tick */
  tick: number;
}

/**
 * 从零生成到某个 tick 为止的日志行。
 *
 * 返回 cursor（= 处理到第几条事件），调用方可以接着往后增量追加。
 */
export function linesUpTo(
  log: readonly BattleEvent[],
  names: Record<number, string>,
  myTeam: 0 | 1,
  uptoTick: number,
): { lines: TimedLogLine[]; cursor: number } {
  const lines: TimedLogLine[] = [];
  let cursor = 0;
  for (const event of log) {
    if (event.t > uptoTick) break;
    cursor++;
    const line = formatEvent(event, names, myTeam);
    if (line) lines.push({ ...line, tick: event.t });
  }
  return { lines, cursor };
}

// ------------------------------------------------------------
// 羁绊日志（第 6 条需求）
// ------------------------------------------------------------

/**
 * 一条"实时进度"：某个羁绊的计数攒到哪儿了。
 *
 * 注意：拉特兰的计数在 0.0.2 已经改成**全队共享**（谁打一下都往同一个数上加），
 * 所以同一时间每个羁绊其实只有一条有效进度；这里仍然保留 unitId 字段，
 * 只是为了兼容"进度事件由谁触发"这个信息（界面上的 topProgress 会取最大的一条）。
 */
export interface TraitProgressRow {
  traitId: string;
  unitId: number;
  /** 距离下次发动已累计的次数（发动后归零） */
  value: number;
  /** 需要攒到多少次 */
  target: number;
}

/** 一条"谁在吃加成"：罗德岛的「生命值最高的干员攻击力提升」 */
export interface TraitCarrierRow {
  traitId: string;
  unitId: number;
  /** 加成的万分比（5000 = +50%） */
  bonusBp: number;
}

/** 羁绊日志的全部状态（实时进度 + 当前持有者 + 已经写下来的日志行） */
export interface TraitLogState {
  progress: TraitProgressRow[];
  carrier: TraitCarrierRow[];
  lines: TimedLogLine[];
}

export function emptyTraitLog(): TraitLogState {
  return { progress: [], carrier: [], lines: [] };
}

/** 羁绊 id -> 中文名（查不到就原样返回，至少不会显示成空白） */
export function traitNameOf(traitId: string): string {
  return TRAIT_DEFS[traitId]?.name ?? traitId;
}

/**
 * 这个羁绊的「实时进度」是不是**全队共享**的（目前只有拉特兰）。
 *
 * 【为什么界面要区分？】
 * 罗德岛那种"谁在吃加成"的进度，干员名字本身就是信息；
 * 拉特兰的计数是全队共享的，progress 事件里的 unitId 只是
 * "**最后一下恰好是谁打的**" —— 把名字显示出来反而误导玩家
 * （看起来像"只有这个干员在攒计数"，换个人打名字就变了）。
 *
 * 0.0.2 追加需求：拉特兰这一行**不显示干员名字，只显示累计记数**。
 * 判断依据用数据表（这一档有没有 attackCountNuke 机制），
 * 以后再加"全队共享计数"类的羁绊，这里自动跟着对，不用改界面。
 */
export function isTeamSharedProgress(traitId: string): boolean {
  const def = TRAIT_DEFS[traitId];
  return (
    !!def &&
    def.tiers.some((tier) => tier.mechanics?.some((mechanic) => mechanic.kind === 'attackCountNuke') === true)
  );
}

/**
 * 把一条事件并进羁绊日志。
 *
 * 【为什么这么在意"要不要往日志里写一行"？】
 * `progress` 事件是**每次攻击**都有的（拉特兰每个棋子都记一条），
 * 一场战斗几百上千条。要是每条都写一行日志，日志会被刷爆 ——
 * 所以 progress 只更新"实时进度条"，不写日志行。
 * 真正值得写一行的只有两件事：效果**发动**了、以及吃加成的人**换了**。
 */
export function applyTraitEvent(
  state: TraitLogState,
  event: BattleEvent,
  names: Record<number, string>,
  myTeam: 0 | 1,
): void {
  if (event.type !== 'trait') return;
  // 敌方羁绊不显示（和战斗日志同一个规则：只关心自己的棋子）
  if (!isMyUnit(event.unitId, myTeam)) return;

  const name = (id: number): string => names[id] ?? `#${id}`;
  const trait = traitNameOf(event.traitId);

  if (event.kind === 'progress') {
    const row = state.progress.find((item) => item.traitId === event.traitId && item.unitId === event.unitId);
    if (row) {
      row.value = event.value;
      row.target = event.target ?? row.target;
    } else {
      state.progress.push({
        traitId: event.traitId,
        unitId: event.unitId,
        value: event.value,
        target: event.target ?? 1,
      });
    }
    return;
  }

  if (event.kind === 'trigger') {
    /*
      ★ 只写羁绊名，不带干员名（0.0.2 追加需求）。

      【为什么不写发动者？】
      拉特兰的齐射是**全队共用的计数**攒满才触发的 —— 谁是"发动者"纯属偶然：
      这一发是恰好在攒满那一刻出手的那个人打出的，但伤害来自**全部拉特兰**的攻击力总和。
      把那个人名写进日志反而是误导（会被读成"是他一个人打出来的"）。
      所以只留羁绊名，把这一发**实际造成的伤害总和**报出来，信息量更实在。
    */
    state.lines.push({
      text: `★羁绊  ${trait} 发动！本次共造成 ${formatDamage(event.value)} 伤害`,
      css: 'log-trait-trigger',
      tick: event.t,
    });
    // 发动即清零：引擎里的计数已经归零了，界面也要跟着归零
    for (const row of state.progress) {
      if (row.traitId === event.traitId) row.value = 0;
    }
    return;
  }

  // carrier：吃加成的人（可能是开局指派，也可能是持有者阵亡后的继承）
  const before = state.carrier.find((item) => item.traitId === event.traitId);
  if (before && before.unitId === event.unitId) {
    before.bonusBp = event.value;
    return;
  }
  state.carrier = state.carrier.filter((item) => item.traitId !== event.traitId);
  state.carrier.push({ traitId: event.traitId, unitId: event.unitId, bonusBp: event.value });
  state.lines.push({
    text: `${before ? '羁绊继承' : '羁绊'}  ${trait} 的加成 → ${name(event.unitId)}（+${(event.value / 100).toFixed(0)}% 攻击力）`,
    css: 'log-trait-carrier',
    tick: event.t,
  });
}

/** 从零重建到某个 tick 为止的羁绊日志（拖进度条回放时用，和战斗日志同一套做法） */
export function traitLogUpTo(
  log: readonly BattleEvent[],
  names: Record<number, string>,
  myTeam: 0 | 1,
  uptoTick: number,
): { state: TraitLogState; cursor: number } {
  const state = emptyTraitLog();
  let cursor = 0;
  for (const event of log) {
    if (event.t > uptoTick) break;
    cursor++;
    applyTraitEvent(state, event, names, myTeam);
  }
  return { state, cursor };
}

/**
 * 每个羁绊只留"攒得最快的那一个棋子"。
 *
 * 【为什么不把 8 个拉特兰干员的进度都列出来？】
 * 侧栏本来就不宽，8 行进度条会把战斗日志挤没了。
 * 玩家真正想知道的是"我这边最快的那发还有几下" ——
 * 那才是下一次齐射什么时候来的答案。
 */
export function topProgress(rows: readonly TraitProgressRow[]): TraitProgressRow[] {
  const best = new Map<string, TraitProgressRow>();
  for (const row of rows) {
    const current = best.get(row.traitId);
    // 平局按 unitId 小的，保证每次渲染顺序一致（数字不会跳）
    if (!current || row.value > current.value || (row.value === current.value && row.unitId < current.unitId)) {
      best.set(row.traitId, row);
    }
  }
  return [...best.values()].sort((a, b) => a.traitId.localeCompare(b.traitId));
}

// ------------------------------------------------------------
// 日志文案
// ------------------------------------------------------------

/**
 * 把一条事件转成日志行（我方视角）。
 *
 * 规则：
 *  - 我方造成的伤害 → 橙色（log-dealt）
 *  - 我方承受的伤害 → 蓝色（log-taken）
 *  - 我方治疗/护盾/增益 → 绿色（log-heal）
 *  - 我方技能 → 紫色（log-cast）
 *  - 阵亡 / 击杀 → 红色加粗（log-kill）
 *  - 敌方互殴 → 不显示（返回 null）
 * 普攻太密集（每 0.x 秒一次 × 双方十几个棋子）会被刷屏，所以只记法术伤害和致命一击。
 */
export function formatEvent(
  event: BattleEvent,
  names: Record<number, string>,
  myTeam: 0 | 1,
): LogLine | null {
  const name = (id: number): string => names[id] ?? `#${id}`;
  const isOurs = (id: number): boolean => isMyUnit(id, myTeam);

  switch (event.type) {
    case 'cast':
      /*
        ★ 0.2.1：羁绊/系统级施法（拉特兰齐射）**不写这一行**。
        它不是哪个棋子放了技能 —— 谁"发动"纯属偶然（全队共用的计数攒满了），
        写"XX 释放技能"会误导。那一发本来就有 `trait.trigger` 那条
        「★羁绊  拉特兰 发动！本次共造成 N 伤害」，信息量足够。
      */
      if (event.traitCast) return null;
      // 技能只记我方的，敌方放技能太吵
      if (!isOurs(event.unitId)) return null;
      return { text: `★技能  ${name(event.unitId)} 释放技能`, css: 'log-cast' };

    case 'damage': {
      /*
        ★ 只记技能（法术）伤害（你报的第 13 条）。
        【为什么连"致命一击"的普攻也不显示了？】
        普攻每 0.x 秒就有一发，双方十几个棋子叠在一起会把日志刷爆 ——
        打字都还没看清就滚走了。而"谁杀了谁"这件事由下面的 `death` 事件
        单独记（而且写的是"☠我方阵亡 xxx（剩 N 个）"，比一行伤害更清楚）。
        所以普攻伤害（含致命的那一下）一律不单独占一行，
        日志里留下的就是技能、治疗、护盾、增益、控制、阵亡这些"值得看"的信息。
      */
      if (event.attackType !== 'spell') return null;

      const absorbed = event.absorbed;
      const shieldNote = absorbed > 0 ? `（护盾挡 ${formatDamage(absorbed)}）` : '';

      // 我方打出的伤害
      if (isOurs(event.sourceId)) {
        return {
          text:
            `${event.lethal ? '☠击杀' : '造成'}  ${name(event.sourceId)} → ${name(event.targetId)} ` +
            `${formatDamage(event.amount + absorbed)}${shieldNote}`,
          css: event.lethal ? 'log-kill' : 'log-dealt',
        };
      }

      // 敌方打我方 —— 换成「我方承受」的视角来记
      if (isOurs(event.targetId)) {
        return {
          text:
            `${event.lethal ? '☠阵亡' : '承受'}  ${name(event.targetId)} ← ${name(event.sourceId)} ` +
            `${formatDamage(event.amount + absorbed)}${shieldNote}`,
          css: event.lethal ? 'log-kill' : 'log-taken',
        };
      }

      // 敌方之间互殴：和我方没关系，不显示
      return null;
    }

    case 'heal':
      // 只看我方参与的治疗
      if (!isOurs(event.targetId)) return null;
      return {
        text: `治疗  ${name(event.sourceId)} → ${name(event.targetId)} +${formatDamage(event.amount)}`,
        css: 'log-heal',
      };

    case 'shield':
      if (!isOurs(event.targetId)) return null;
      return { text: `护盾  ${name(event.targetId)} +${formatDamage(event.amount)}`, css: 'log-heal' };

    case 'status':
      // 控制效果：我方被控 或 我方控住别人，都值得记
      if (isOurs(event.targetId)) return { text: `被眩晕  ${name(event.targetId)}`, css: 'log-taken' };
      return { text: `眩晕  ${name(event.targetId)}`, css: 'log-cast' };

    case 'buff':
      if (!isOurs(event.targetId)) return null;
      return {
        text:
          `增益  ${name(event.targetId)} ` +
          `${event.stat === 'attackSpeed' ? '攻速' : '攻击力'} +${(event.bonusBp / 100).toFixed(0)}%`,
        css: 'log-heal',
      };

    case 'death':
      // 我方阵亡要显眼，敌方阵亡也值得记（说明我方打赢了）
      return isOurs(event.unitId)
        ? { text: `☠我方阵亡  ${name(event.unitId)}（剩 ${event.remaining} 个）`, css: 'log-kill' }
        : { text: `敌方阵亡  ${name(event.unitId)}（剩 ${event.remaining} 个）`, css: 'log-dealt' };

    case 'end': {
      // 注意不能写死 winner === 0 就是"我方获胜"：联机时我可能在队伍 1
      const text = event.winner === null ? '平局' : event.winner === myTeam ? '★我方获胜' : '☠我方落败';
      return { text: `结束  ${text}`, css: 'log-end' };
    }

    default:
      return null;
  }
}
