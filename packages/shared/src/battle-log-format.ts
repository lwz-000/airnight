import { BOARD_H, BOARD_W, BP, CELL_EMPTY, FIX, TICKS_PER_SECOND } from './constants.js';
import { cellIndex, getUnit } from './field.js';
import type { BattleResult, BattleState, UnitDefTable } from './types.js';

/** 把 FIX 数值转成给人看的字符串，例如 550500 -> "550.5" */
export function formatFix(value: number): string {
  const negative = value < 0;
  const abs = Math.abs(value);
  const whole = Math.floor(abs / FIX);
  const frac = abs % FIX;
  const text = frac === 0 ? `${whole}` : `${whole}.${String(frac).padStart(3, '0')}`;
  return negative ? `-${text}` : text;
}

/**
 * 把战斗结果渲染成终端里能读的战报。
 *
 * 这份输出的价值：它是「确定性」最直观的证据。
 * 同一个种子跑两次，输出的文字必须一模一样，一个字都不能差。
 */
export function renderBattleText(result: BattleResult, defs: UnitDefTable, names?: Record<number, string>): string {
  const lines: string[] = [];
  const label = (unitId: number): string => names?.[unitId] ?? `#${unitId}`;
  const pad = (tick: number): string => String(tick).padStart(4, ' ');
  const unitName = (defId: string): string => defs[defId]?.name ?? defId;

  for (const event of result.log) {
    switch (event.type) {
      case 'spawn':
        lines.push(
          `[${pad(event.t)}] 登场  ${label(event.unitId)} ${unitName(event.defId)} ${event.star}星 ` +
            `@(${event.cell.col},${event.cell.row}) HP=${formatFix(event.maxHp)}`,
        );
        break;

      case 'attack':
        // 普攻太密集，默认不打印。想看的话把下面这行的注释去掉
        // lines.push(`[${pad(event.t)}] 挥击  ${label(event.unitId)} -> ${label(event.targetId)}`);
        break;

      case 'cast':
        lines.push(`[${pad(event.t)}] ★技能 ${label(event.unitId)} 释放【${unitName(event.skillId.replace(/_/g, '')) || event.skillId}】`);
        break;

      case 'damage':
        // 只打印技能（法术）伤害 —— 普攻太密集，致命那一下由 death 事件另行呈现
        if (event.attackType === 'spell') {
          lines.push(
            `[${pad(event.t)}] 伤害  ${label(event.sourceId)} -> ${label(event.targetId)} ` +
              `-${formatFix(event.amount)} (${event.damageType}) 剩余HP=${formatFix(event.hpAfter)}` +
              `${event.lethal ? '  ☠致命' : ''}`,
          );
        }
        break;

      case 'heal':
        lines.push(`[${pad(event.t)}] 治疗  ${label(event.sourceId)} -> ${label(event.targetId)} +${formatFix(event.amount)} HP=${formatFix(event.hpAfter)}`);
        break;

      case 'shield':
        lines.push(`[${pad(event.t)}] 护盾  ${label(event.targetId)} +${formatFix(event.amount)}（${event.durationTicks} tick）`);
        break;

      case 'status':
        lines.push(`[${pad(event.t)}] 眩晕  ${label(event.targetId)}（${event.durationTicks} tick）`);
        break;

      case 'buff':
        lines.push(
          `[${pad(event.t)}] 增益  ${label(event.targetId)} ${event.stat === 'attackSpeed' ? '攻速' : '攻击力'} ` +
            `+${(event.bonusBp / 100).toFixed(0)}%（${event.durationTicks} tick）`,
        );
        break;

      case 'death':
        lines.push(`[${pad(event.t)}] 阵亡  ${label(event.unitId)}（队伍${event.team} 还剩 ${event.remaining} 个）`);
        break;

      case 'end':
        lines.push('');
        lines.push(`=== 战斗结束：${result.winner === null ? '平局' : `队伍 ${result.winner} 获胜`}（${event.reason === 'timeout' ? '超时判定' : '全歼'}）`);
        lines.push(`    用时 ${result.ticks} tick = ${(result.ticks / TICKS_PER_SECOND).toFixed(1)} 秒`);
        lines.push(`    剩余血量  队伍0 = ${(event.hpBpTeam0 / 100).toFixed(1)}%   队伍1 = ${(event.hpBpTeam1 / 100).toFixed(1)}%`);
        lines.push(`    校验和 0x${result.checksum.toString(16).toUpperCase()}`);
        break;
    }
  }
  return lines.join('\n');
}

/**
 * 棋盘 ASCII 可视化 —— 在终端里检查站位用。
 *
 * A = 队伍0（左半边），B = 队伍1（右半边），后面的数字是星级，. = 空格。
 *
 * 注意：列数是从 BOARD_W 算出来的，不要写死。
 * 棋盘尺寸是可配置的（每方 ARENA_W × ARENA_H），写死一个数字就会在改尺寸时错位。
 */
export function renderBoard(state: BattleState): string {
  const rows: string[] = [];

  // 表头：每 10 列标一个刻度（十位），下一行标个位
  let header = '    ';
  for (let col = 0; col < BOARD_W; col++) {
    header += (col % 10 === 0 ? String(Math.floor(col / 10)) : ' ').padStart(3);
  }
  rows.push(header);

  let ruler = '    ';
  for (let col = 0; col < BOARD_W; col++) {
    ruler += String(col % 10).padStart(3);
  }
  rows.push(ruler);

  rows.push('    ' + '---'.repeat(BOARD_W));

  for (let row = 0; row < BOARD_H; row++) {
    let line = String(row).padStart(3) + ' ';
    for (let col = 0; col < BOARD_W; col++) {
      const id = state.cellToUnit[cellIndex(col, row)];
      if (id === CELL_EMPTY) {
        line += '  .';
      } else {
        const unit = getUnit(state, id);
        line += (unit ? `${unit.team === 0 ? 'A' : 'B'}${unit.star}` : '??').padStart(3);
      }
    }
    if (row === 0) line += '     ← 队伍0 半场（左）| 队伍1 半场（右）→';
    rows.push(line);
  }
  return rows.join('\n');
}

/**
 * 战斗统计：谁打了多少输出。
 * 平衡性调数值时最有用的表 —— 你会立刻看出「哪个棋子是废物、哪个超模」。
 */
export function renderBattleStats(result: BattleResult, defs: UnitDefTable, names?: Record<number, string>): string {
  const dealt = new Map<number, number>();
  const taken = new Map<number, number>();
  const healed = new Map<number, number>();
  const damageType = new Map<number, { physical: number; magic: number; true: number }>();

  for (const event of result.log) {
    if (event.type === 'damage') {
      dealt.set(event.sourceId, (dealt.get(event.sourceId) ?? 0) + event.amount);
      taken.set(event.targetId, (taken.get(event.targetId) ?? 0) + event.amount + event.absorbed);
      const bucket = damageType.get(event.sourceId) ?? { physical: 0, magic: 0, true: 0 };
      bucket[event.damageType] += event.amount;
      damageType.set(event.sourceId, bucket);
    }
    if (event.type === 'heal') {
      healed.set(event.sourceId, (healed.get(event.sourceId) ?? 0) + event.amount);
    }
  }

  const rows: string[] = [];
  rows.push('棋子                    输出      承伤      治疗      物理      魔法');
  rows.push('-'.repeat(76));
  const ids = [...dealt.keys(), ...taken.keys()].filter((id) => id > 0);
  const unique = [...new Set(ids)].sort((a, b) => a - b);
  for (const id of unique) {
    const label = (names?.[id] ?? `#${id}`).padEnd(20, ' ');
    const d = formatFix(dealt.get(id) ?? 0).padStart(8);
    const t = formatFix(taken.get(id) ?? 0).padStart(8);
    const h = formatFix(healed.get(id) ?? 0).padStart(8);
    const bucket = damageType.get(id) ?? { physical: 0, magic: 0, true: 0 };
    const p = formatFix(bucket.physical).padStart(8);
    const m = formatFix(bucket.magic).padStart(8);
    rows.push(`${label}${d}  ${t}  ${h}  ${p}  ${m}`);
  }
  return rows.join('\n');
}

/** 剩余血量百分比（bp -> 人类可读） */
export function formatBp(value: number): string {
  return `${(value / 100).toFixed(1)}%`;
}

export { BP };
