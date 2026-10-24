/**
 * 战斗日志 + 我方伤害统计的单元测试。
 *
 * 【为什么这些测试很重要？】
 * 这块代码有两个"改错了也看不出来"的性质：
 *  1. **视角**：日志和统计都要站在「我方」看。联机时我可能被分到队伍 1，
 *     如果哪里写死了队伍 0，界面上就会显示对面的数据 —— 而且看起来"有数据"，
 *     不会报错，只有仔细看名字才发现是别人的棋子。
 *  2. **回放一致性**：拖动进度条会重建日志和统计。
 *     重建的结果必须和「一帧一帧播过去」的结果完全一样，
 *     否则往前往回拖几下，数字就飘了。
 * 这两点都没有类型保护，只能靠测试钉住。
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  applyEventToStats,
  formatDamage,
  formatEvent as formatEventView,
  isMyUnit,
  linesUpTo,
  sortedStats,
  statsUpTo,
  teamOfUnitId,
  unitIdOf,
  type StatsMap,
} from '../src/game/battle-log.js';
import type { AttackType, BattleEvent } from '@airnight/shared';

const NAMES: Record<number, string> = {
  1: '推进之王',
  2: '能天使',
  1001: '敌·霜星',
  1002: '敌·W',
};

/** 生成一条 spawn 事件（队伍从 id 推出来，和内核规则一致） */
function spawn(unitId: number, t = 0): BattleEvent {
  const team = teamOfUnitId(unitId);
  return {
    type: 'spawn',
    t,
    unitId,
    team,
    defId: `op${unitId}`,
    star: 1,
    cell: { col: 0, row: 0 },
    maxHp: 100_000,
  };
}

function damage(
  t: number,
  sourceId: number,
  targetId: number,
  amount: number,
  extra: { absorbed?: number; lethal?: boolean; attackType?: AttackType } = {},
): BattleEvent {
  return {
    type: 'damage',
    t,
    sourceId,
    targetId,
    amount,
    damageType: 'physical',
    attackType: extra.attackType ?? 'spell',
    absorbed: extra.absorbed ?? 0,
    hpAfter: 50_000,
    lethal: extra.lethal ?? false,
  };
}

/** 一场小战斗：我方 1、2 号 vs 敌方 1001、1002 */
function smallLog(): BattleEvent[] {
  return [
    spawn(1),
    spawn(2),
    spawn(1001),
    spawn(1002),
    damage(5, 1, 1001, 3000),
    damage(6, 1001, 1, 1000),
    damage(7, 2, 1002, 2000, { lethal: true }),
    { type: 'heal', t: 8, sourceId: 2, targetId: 1, amount: 500, hpAfter: 99_000 },
    // 敌方互殴：不该出现在日志里，也不该进统计
    damage(9, 1001, 1002, 700),
    { type: 'death', t: 10, unitId: 1002, team: 1, remaining: 1 },
    { type: 'end', t: 11, winner: 0, reason: 'eliminated', hpBpTeam0: 90_000, hpBpTeam1: 0 },
  ];
}

describe('单位 id 规则', () => {
  it('id 和「队伍 + 下标」能互相推出', () => {
    expect(unitIdOf(0, 0)).toBe(1);
    expect(unitIdOf(0, 4)).toBe(5);
    expect(unitIdOf(1, 0)).toBe(1001);
    expect(unitIdOf(1, 4)).toBe(1005);
    for (const team of [0, 1] as const) {
      for (let i = 0; i < 10; i++) {
        expect(teamOfUnitId(unitIdOf(team, i))).toBe(team);
      }
    }
  });

  it('isMyUnit 跟着 myTeam 走', () => {
    expect(isMyUnit(1, 0)).toBe(true);
    expect(isMyUnit(1001, 0)).toBe(false);
    expect(isMyUnit(1001, 1)).toBe(true);
    expect(isMyUnit(1, 1)).toBe(false);
  });

  it('伤害数字：内部是千分之一，上万才缩写', () => {
    expect(formatDamage(0)).toBe('0');
    expect(formatDamage(1500)).toBe('2'); // 1.5 四舍五入
    expect(formatDamage(123_400)).toBe('123');
    expect(formatDamage(12_340_000)).toBe('12.3k');
  });
});

describe('伤害统计', () => {
  it('只有我方干员会进统计表（名单来自 spawn 事件）', () => {
    const stats = statsUpTo(smallLog(), 0, 999);
    expect([...stats.keys()].sort((a, b) => a - b)).toEqual([1, 2]);
    expect(stats.get(1)?.defId).toBe('op1');
    expect(stats.get(1001)).toBeUndefined();
  });

  it('造成/承受的伤害都算上被护盾吸收的部分', () => {
    const log: BattleEvent[] = [spawn(1), spawn(1001), damage(3, 1, 1001, 1000, { absorbed: 400 })];
    const stats = statsUpTo(log, 0, 99);
    expect(stats.get(1)?.dealt).toBe(1400);
    expect(stats.get(1)?.taken).toBe(0);
  });

  it('治疗记在治疗者头上，不是被治疗者', () => {
    const stats = statsUpTo(smallLog(), 0, 999);
    expect(stats.get(2)?.healed).toBe(500);
    expect(stats.get(1)?.healed).toBe(0);
  });

  it('阵亡会被标记（显示时淡出）', () => {
    const stats = statsUpTo(smallLog(), 0, 999);
    // 1002 是敌方，所以这个阵亡标记落不到我方头上
    expect(stats.get(1)?.dead).toBe(false);

    const withOurDeath: BattleEvent[] = [
      spawn(1),
      { type: 'death', t: 5, unitId: 1, team: 0, remaining: 0 },
    ];
    expect(statsUpTo(withOurDeath, 0, 99).get(1)?.dead).toBe(true);
  });

  it('统计只算到指定 tick 为止', () => {
    const log = smallLog();
    const early = statsUpTo(log, 0, 5);
    expect(early.get(1)?.dealt).toBe(3000);
    expect(early.get(1)?.taken).toBe(0); // tick 6 的挨打还没发生

    const mid = statsUpTo(log, 0, 6);
    expect(mid.get(1)?.taken).toBe(1000);
  });

  it('★ 被分到队伍 1 时，统计的是队伍 1 的干员', () => {
    const stats = statsUpTo(smallLog(), 1, 999);
    expect([...stats.keys()].sort((a, b) => a - b)).toEqual([1001, 1002]);
    // 1001 打了 1000（打我方 1 号）+ 700（打死自己队友 1002）= 1700，
    // 挨了 3000（被 1 号打）；1002 挨了 2000（被 2 号打）+ 700（被队友 1001 打）
    expect(stats.get(1001)?.dealt).toBe(1700);
    expect(stats.get(1001)?.taken).toBe(3000);
    expect(stats.get(1002)?.taken).toBe(2700);
  });

  it('★ 重建（statsUpTo）和一帧帧累加的结果必须完全一致', () => {
    const log = smallLog();
    for (let tick = 0; tick <= 11; tick++) {
      const rebuilt = statsUpTo(log, 0, tick);

      const incremental: StatsMap = new Map();
      for (const event of log) {
        if (event.t > tick) break;
        applyEventToStats(incremental, event, 0);
      }

      expect(sortedStats(rebuilt)).toEqual(sortedStats(incremental));
    }
  });

  it('重复喂同一个 spawn 不会覆盖掉已有统计', () => {
    const stats: StatsMap = new Map();
    applyEventToStats(stats, spawn(1), 0);
    applyEventToStats(stats, damage(1, 1, 1001, 800), 0);
    applyEventToStats(stats, spawn(1), 0); // 又遇到一次出生事件
    expect(stats.get(1)?.dealt).toBe(800);
    expect(stats.size).toBe(1);
  });

  it('显示顺序：输出高的在前，输出相同比承受伤害', () => {
    const log: BattleEvent[] = [
      spawn(1),
      spawn(2),
      spawn(1001),
      damage(1, 1, 1001, 100),
      damage(2, 2, 1001, 500),
      damage(3, 1001, 1, 900), // 1 号挨打多，但输出低
    ];
    expect(sortedStats(statsUpTo(log, 0, 99)).map((r) => r.unitId)).toEqual([2, 1]);
  });
});

describe('日志文案（我方视角）', () => {
  it('只记法术伤害，普攻（连致命一击）都不刷屏', () => {
    expect(formatEventView(damage(1, 1, 1001, 500, { attackType: 'attack' }), NAMES, 0)).toBeNull();
    expect(
      formatEventView(damage(1, 1, 1001, 500, { attackType: 'spell' }), NAMES, 0),
    ).not.toBeNull();
    /*
      0.0.2 需求第 13 条：战斗日志里**删掉普通攻击造成的伤害**，只显示技能等重要信息。
      所以连"这一下打死人了"的普攻也不再单独占一行 ——
      击杀本身仍然会由 die 事件写进日志，不会漏掉结果。
    */
    expect(
      formatEventView(damage(1, 1, 1001, 500, { attackType: 'attack', lethal: true }), NAMES, 0),
    ).toBeNull();
  });

  it('我方打出的伤害用暖色（log-dealt），带护盾说明', () => {
    const line = formatEventView(damage(5, 1, 1001, 1000, { absorbed: 300 }), NAMES, 0);
    expect(line?.css).toBe('log-dealt');
    expect(line?.text).toContain('造成');
    expect(line?.text).toContain('推进之王');
    expect(line?.text).toContain('敌·霜星');
    expect(line?.text).toContain('护盾挡');
    expect(line?.text).toContain('1'); // 1000 + 300 = 1300，取整显示 "1"
  });

  it('我方承受的伤害用冷色（log-taken），箭头方向反过来', () => {
    const line = formatEventView(damage(6, 1001, 1, 1000), NAMES, 0);
    expect(line?.css).toBe('log-taken');
    expect(line?.text).toContain('承受');
    expect(line?.text).toContain('←');
  });

  it('敌方互殴不显示（和我方没关系）', () => {
    expect(formatEventView(damage(9, 1001, 1002, 700), NAMES, 0)).toBeNull();
  });

  it('★ 队伍 1 视角：同一份日志里"我方"变成 1001/1002', () => {
    const dealt = formatEventView(damage(6, 1001, 1, 1000), NAMES, 1);
    expect(dealt?.css).toBe('log-dealt');
    expect(dealt?.text).toContain('敌·霜星');

    const taken = formatEventView(damage(5, 1, 1001, 3000), NAMES, 1);
    expect(taken?.css).toBe('log-taken');
    expect(taken?.text).toContain('推进之王');

    // 队伍 1 内部的互殴：站在队伍 0 看不显示，站在队伍 1 看就是"我方打的"
    const inner = formatEventView(damage(9, 1001, 1002, 700), NAMES, 1);
    expect(inner?.css).toBe('log-dealt');
  });

  it('敌方放技能不显示，我方放技能才显示', () => {
    expect(formatEventView({ type: 'cast', t: 1, unitId: 1001, skillId: 's' }, NAMES, 0)).toBeNull();
    const mine = formatEventView({ type: 'cast', t: 1, unitId: 1, skillId: 's' }, NAMES, 0);
    expect(mine?.css).toBe('log-cast');
  });

  it('★ 羁绊级施法（拉特兰齐射）不写"XX 释放技能"—— 它不是哪个棋子开的技能', () => {
    /*
      ★ 齐射借用了 `cast` 这个通道上报，但"发动者"只是第 30 下恰好出手的那个人，
      伤害来自全部拉特兰。写成"XX 释放技能"会让人以为他有主动技能。
      那一发本来就有 `trait.trigger` 那条「★羁绊 拉特兰 发动！…」。
    */
    expect(
      formatEventView(
        { type: 'cast', t: 1, unitId: 1, skillId: 'trait_laterano_volley', traitCast: true, boardFx: 'laterano_volley' },
        NAMES,
        0,
      ),
    ).toBeNull();
  });

  it('控制、治疗、护盾、增益只记我方相关的', () => {
    expect(
      formatEventView(
        { type: 'status', t: 1, sourceId: 1001, targetId: 1, status: 'stun', durationTicks: 20 },
        NAMES,
        0,
      )?.css,
    ).toBe('log-taken');
    expect(
      formatEventView(
        { type: 'status', t: 1, sourceId: 1, targetId: 1001, status: 'stun', durationTicks: 20 },
        NAMES,
        0,
      )?.css,
    ).toBe('log-cast');
    // 敌方被控：显示，因为那是我方打出来的效果
    expect(
      formatEventView(
        { type: 'status', t: 1, sourceId: 1002, targetId: 1001, status: 'stun', durationTicks: 20 },
        NAMES,
        0,
      )?.css,
    ).toBe('log-cast');

    expect(
      formatEventView(
        { type: 'heal', t: 1, sourceId: 1, targetId: 1001, amount: 100, hpAfter: 1 },
        NAMES,
        0,
      ),
    ).toBeNull();
    expect(
      formatEventView(
        { type: 'shield', t: 1, sourceId: 1, targetId: 1001, amount: 100, durationTicks: 20 },
        NAMES,
        0,
      ),
    ).toBeNull();
    expect(
      formatEventView(
        {
          type: 'buff',
          t: 1,
          sourceId: 1,
          targetId: 1001,
          stat: 'attackSpeed',
          bonusBp: 3000,
          durationTicks: 20,
        },
        NAMES,
        0,
      ),
    ).toBeNull();

    const buff = formatEventView(
      {
        type: 'buff',
        t: 1,
        sourceId: 1,
        targetId: 1,
        stat: 'attackSpeed',
        bonusBp: 3000,
        durationTicks: 20,
      },
      NAMES,
      0,
    );
    expect(buff?.text).toContain('攻速');
    expect(buff?.text).toContain('30%');
  });

  it('阵亡分敌我', () => {
    const ours = formatEventView({ type: 'death', t: 10, unitId: 1, team: 0, remaining: 0 }, NAMES, 0);
    expect(ours?.text).toContain('我方阵亡');
    expect(ours?.css).toBe('log-kill');

    const theirs = formatEventView(
      { type: 'death', t: 10, unitId: 1002, team: 1, remaining: 1 },
      NAMES,
      0,
    );
    expect(theirs?.text).toContain('敌方阵亡');
  });

  it('★ 结算文案按"我方"判胜负，不是写死队伍 0', () => {
    const end: BattleEvent = {
      type: 'end',
      t: 11,
      winner: 1,
      reason: 'eliminated',
      hpBpTeam0: 0,
      hpBpTeam1: 50_000,
    };
    // 我是队伍 0 -> 输了
    expect(formatEventView(end, NAMES, 0)?.text).toContain('我方落败');
    // 我是队伍 1 -> 赢了
    expect(formatEventView(end, NAMES, 1)?.text).toContain('我方获胜');

    const draw: BattleEvent = { ...end, winner: null };
    expect(formatEventView(draw, NAMES, 0)?.text).toContain('平局');
  });

  it('未知名字不会崩，退回 #id', () => {
    const line = formatEventView(damage(1, 7, 1001, 100), {}, 0);
    expect(line?.text).toContain('#7');
  });
});

describe('日志行生成', () => {
  it('★ 日志用到的每个颜色 class 都在 styles.css 里有定义', () => {
    // 以前出现过「代码里写了 log-dealt，但 CSS 里没这个类」的 bug：
    // 日志照常显示，只是没有颜色 —— 不报错，肉眼很难发现。
    const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

    const used = new Set<string>();
    // 我方视角和敌方视角各跑一遍，确保两边的 class 都覆盖到
    for (const myTeam of [0, 1] as const) {
      for (const event of smallLog()) {
        const line = formatEventView(event, NAMES, myTeam);
        if (line) used.add(line.css);
      }
    }
    expect(used.size).toBeGreaterThan(3);
    for (const cls of used) {
      expect(css, `styles.css 缺少 .${cls}`).toContain(`.${cls}`);
    }
  });

  it('cursor 记的是"处理到第几条事件"，不是"显示了几行"', () => {
    const log = smallLog();
    const { lines, cursor } = linesUpTo(log, NAMES, 0, 999);
    expect(cursor).toBe(log.length);
    // 有些事件不显示（敌方互殴、普攻），所以行数少于事件数
    expect(lines.length).toBeLessThan(log.length);
    expect(lines.every((l) => typeof l.tick === 'number')).toBe(true);
  });

  it('只处理到指定 tick，并且 cursor 停在正确位置', () => {
    const log = smallLog();
    const { lines, cursor } = linesUpTo(log, NAMES, 0, 6);
    expect(cursor).toBe(6); // 4 条 spawn + tick 5、tick 6 两条伤害
    expect(lines.every((l) => l.tick <= 6)).toBe(true);
  });

  it('★ 增量追加和重建得到的行完全一样（拖动进度条不会丢行/重复行）', () => {
    const log = smallLog();
    for (let tick = 0; tick <= 11; tick++) {
      const { lines } = linesUpTo(log, NAMES, 0, tick);

      // 模拟"边播边追加"
      const incremental: string[] = [];
      for (const event of log) {
        if (event.t > tick) break;
        const line = formatEventView(event, NAMES, 0);
        if (line) incremental.push(`${event.t}|${line.css}|${line.text}`);
      }
      expect(lines.map((l) => `${l.tick}|${l.css}|${l.text}`)).toEqual(incremental);
    }
  });
});
