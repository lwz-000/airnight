/**
 * 羁绊详情日志（你报的第 6 条）的**界面侧纯函数**测试。
 *
 * 内核负责把「进度 / 发动 / 谁在吃加成」记成事件（见 packages/shared/test/trait-log.test.ts），
 * 这里测的是界面怎么把这些事件变成"实时进度条 + 几行日志"：
 *   · 拉特兰：实时显示攒到第几次，发动时写一行
 *   · 罗德岛：实时显示谁在吃加成，换人时写一行
 *   · 敌方的羁绊不进日志（和战斗日志同一条规则：只关心自己的棋子）
 */
import { describe, expect, it } from 'vitest';
import {
  applyTraitEvent,
  emptyTraitLog,
  isTeamSharedProgress,
  topProgress,
  traitLogUpTo,
  traitNameOf,
} from '../src/game/index.js';
import type { BattleEvent } from '@airnight/shared';

const NAMES: Record<number, string> = { 1: '我方A', 2: '我方B', 1001: '敌方A' };

function ev(partial: Record<string, unknown>): BattleEvent {
  return { t: 0, ...partial } as BattleEvent;
}

const progress = (t: number, unitId: number, value: number, target = 30) =>
  ev({ type: 'trait', t, traitId: 'laterano', unitId, kind: 'progress', value, target });
const trigger = (t: number, unitId: number) =>
  ev({ type: 'trait', t, traitId: 'laterano', unitId, kind: 'trigger', value: 12, target: 30 });
const carrier = (t: number, unitId: number, bonusBp = 5000) =>
  ev({ type: 'trait', t, traitId: 'rhodes', unitId, kind: 'carrier', value: bonusBp });

describe('★ 羁绊日志：拉特兰的实时进度', () => {
  it('进度事件只更新进度，不会往日志里刷行（不然一次普攻一行，日志会被刷爆）', () => {
    const log = [progress(1, 1, 1), progress(2, 1, 2), progress(3, 1, 3)];
    const { state } = traitLogUpTo(log, NAMES, 0, 999);
    expect(state.progress).toHaveLength(1);
    expect(state.progress[0]).toMatchObject({ unitId: 1, value: 3, target: 30 });
    expect(state.lines, '进度本身不该写日志行').toHaveLength(0);
  });

  it('★ 发动时写一行，并把进度清零（引擎那边已经重新开始数了）', () => {
    const log = [progress(1, 1, 29), progress(2, 1, 30), trigger(2, 1), progress(3, 1, 1)];
    const { state } = traitLogUpTo(log, NAMES, 0, 999);
    expect(state.lines).toHaveLength(1);
    expect(state.lines[0]!.text).toContain('拉特兰');
    /*
      ★ 0.0.2 追加需求第 5 条：羁绊日志里**不再显示干员名字**。
      理由是那会误导 —— 齐射的伤害来自"全部拉特兰干员的攻击力总和"，
      而"发动者"只是恰好在攒满那一刻出手的那个人。
      取而代之的是这一发**实际造成的伤害总和**（引擎累加 dealDamage 的返回值）。
    */
    expect(state.lines[0]!.text, '不该再出现干员名字').not.toContain('我方A');
    expect(state.lines[0]!.text).toContain('伤害');
    expect(state.lines[0]!.text).toContain('发动');
    expect(state.lines[0]!.tick).toBe(2);
    expect(state.lines[0]!.css).toBe('log-trait-trigger');
    expect(state.progress[0]!.value, '发动之后进度要归零重数').toBe(1);
  });

  it('★ 发动那一行会报出"本次造成的伤害总和"（value 就是总和，不是每人的伤害）', () => {
    const log = [ev({ type: 'trait', t: 2, traitId: 'laterano', unitId: 1, kind: 'trigger', value: 34500, target: 10 })];
    const { state } = traitLogUpTo(log, NAMES, 0, 999);
    // 34500 / 1000 = 34.5 -> 四舍五入成 35
    expect(state.lines[0]!.text).toContain('35');
  });

  it('同一羁绊只显示一条进度（全队共享计数后更是如此）', () => {
    /*
      注意：0.0.2 第 8 条之后拉特兰是**全队共享**计数，
      真实内核不会出现"同一个羁绊好几个不同 value"的情况。
      这里仍然喂两条不同的 value，是为了钉住 topProgress 的兜底行为 ——
      万一以后又出现多来源的进度事件，界面也只显示一条、不会把侧栏撑爆。
    */
    const log = [progress(1, 1, 5), progress(2, 2, 9), progress(3, 1, 6)];
    const { state } = traitLogUpTo(log, NAMES, 0, 999);
    expect(state.progress).toHaveLength(2);
    const top = topProgress(state.progress);
    expect(top).toHaveLength(1);
    expect(top[0]!.unitId, '应该显示攒得最多的那条').toBe(2);
    expect(top[0]!.value).toBe(9);
  });
});

describe('★ 羁绊日志：罗德岛"谁在吃加成"', () => {
  it('★ 第一次指派写一行，同一个人再次指派不重复写', () => {
    const log = [carrier(0, 1), carrier(5, 1)];
    const { state } = traitLogUpTo(log, NAMES, 0, 999);
    expect(state.carrier).toEqual([{ traitId: 'rhodes', unitId: 1, bonusBp: 5000 }]);
    expect(state.lines, '同一个人不该刷两行').toHaveLength(1);
    expect(state.lines[0]!.text).toContain('我方A');
    expect(state.lines[0]!.text).toContain('+50%');
  });

  it('★ 加成换人（阵亡继承）时再写一行，并说明是继承来的', () => {
    const log = [carrier(0, 1), carrier(120, 2)];
    const { state } = traitLogUpTo(log, NAMES, 0, 999);
    expect(state.carrier).toEqual([{ traitId: 'rhodes', unitId: 2, bonusBp: 5000 }]);
    expect(state.lines).toHaveLength(2);
    expect(state.lines[1]!.text).toContain('继承');
    expect(state.lines[1]!.text).toContain('我方B');
    expect(state.lines[1]!.tick).toBe(120);
  });
});

describe('★ 羁绊日志的通用规则', () => {
  it('敌方的羁绊不进日志（和战斗日志一样，只关心自己的棋子）', () => {
    const log = [progress(1, 1001, 10), trigger(2, 1001), carrier(0, 1001)];
    const { state } = traitLogUpTo(log, NAMES, 0, 999);
    expect(state.progress).toHaveLength(0);
    expect(state.carrier).toHaveLength(0);
    expect(state.lines).toHaveLength(0);
  });

  it('拖进度条回放到一半时，只看得到那一刻之前发生的事', () => {
    const log = [progress(10, 1, 5), trigger(20, 1), progress(30, 1, 3)];
    const { state, cursor } = traitLogUpTo(log, NAMES, 0, 10);
    expect(state.progress[0]!.value).toBe(5);
    expect(state.lines, '还没发动').toHaveLength(0);
    expect(cursor, '游标要指到第一条没处理的事件上').toBe(1);
  });

  it('除了 trait 事件以外的任何事件都被忽略', () => {
    const state = emptyTraitLog();
    applyTraitEvent(state, ev({ type: 'damage', sourceId: 1, targetId: 1001, amount: 1, damageType: 'physical', attackType: 'attack', absorbed: 0, hpAfter: 0, lethal: false }), NAMES, 0);
    applyTraitEvent(state, ev({ type: 'spawn', unitId: 1, team: 0, defId: 'op01', star: 1, cell: { col: 0, row: 0 }, maxHp: 1 }), NAMES, 0);
    expect(state.progress).toHaveLength(0);
    expect(state.lines).toHaveLength(0);
  });

  it('traitNameOf 给出中文名（界面标题用它，不写死在界面里）', () => {
    expect(traitNameOf('laterano')).toBe('拉特兰');
    expect(traitNameOf('rhodes')).toBe('罗德岛');
    // 查不到就原样返回，至少不是空白
    expect(traitNameOf('not_a_trait')).toBe('not_a_trait');
  });

  it('★ 拉特兰的进度是"全队共享"，界面上不该带干员名字（0.0.2 追加需求）', () => {
    // 判定来自数据表（这一档有没有 attackCountNuke 机制），以后加同类羁绊自动跟上
    expect(isTeamSharedProgress('laterano')).toBe(true);
    // 罗德岛是"谁在吃加成"，名字本身就是信息，不能一起藏掉
    expect(isTeamSharedProgress('rhodes')).toBe(false);
    // 查不到的羁绊按"不共享"处理（显示名字是最不坏的选择）
    expect(isTeamSharedProgress('not_a_trait')).toBe(false);
  });
});
