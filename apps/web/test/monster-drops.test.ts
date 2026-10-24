/**
 * ★ 0.0.3：野怪回合的**击杀掉落**（接进经济结算的那一段）。
 *
 * 掉落表本身在 shared 里测（drop-table.test.ts），"数击杀"也在那边测
 * （killedDefIds）；这里只钉**接线**：
 *   · 按**每一只被打倒的野怪**各掷一次（不是"赢了就按整波掷"）；
 *   · 一只都没打死就不掉；非野怪回合不掉；
 *   · 掉的东西真的进了藏品栏（而不是只算了没入账）；
 *   · 同一个种子掷出同一套结果（存档/重放不会变）。
 *
 * 【为什么这里专门写"没有击杀就不掉"？】
 * 上一版是 `won === true` 才掷，而单机那条路取 `won` 的时机在
 * `currentResult` 被清掉**之后** —— `won` 恒为 null，玩家连着几局
 * 1、2 回合一件藏品都拿不到。现在改成"按击杀"，并把"数击杀"的时机
 * 钉在 main.ts 里（在清 currentResult 之前）。
 */
import { describe, expect, it } from 'vitest';
import {
  addItem,
  createGameState,
  equipSharedItem,
  grantMonsterRoundDrops,
  killDropLines,
  monsterDropGoldBp,
  switchMode,
} from '../src/game/index.js';
import { ITEM_DEFS, monsterWaveForRound } from '../../../packages/shared/src/index.js';

function freshState() {
  // 测试模式：无限金币，不干扰经济断言
  return switchMode(createGameState()).next;
}

/** 第 round 回合整波都被打倒（波次里每只各一条击杀记录） */
function wholeWaveKills(round: number): { defId: string; tick: number }[] {
  return monsterWaveForRound(round).map((unit, i) => ({ defId: unit.defId, tick: 20 + i * 10 }));
}

describe('★ 野怪掉落：接线', () => {
  it('第 1 回合（野怪回合）打死两只小怪 -> 掷两次；第 3 回合不掉（那回合没有野怪）', () => {
    const state = freshState();
    const kills = wholeWaveKills(1);
    expect(kills.length).toBe(2);
    const drop = grantMonsterRoundDrops(state, 1, 20261011, kills);
    expect(drop.kills).toHaveLength(2);
    expect(drop.items.length + (drop.gold > 0 ? 1 : 0)).toBeGreaterThan(0);
    // 非野怪回合：就算传了击杀也不算（野怪只在野怪回合出现）
    expect(grantMonsterRoundDrops(state, 3, 20261011, kills)).toEqual({ items: [], gold: 0, lost: 0, kills: [] });
  });

  it('★ 一只都没打死 -> 什么都不掉（这是"按击杀"的核心）', () => {
    const state = freshState();
    const before = state.economy.gold;
    expect(grantMonsterRoundDrops(state, 1, 20261011, [])).toEqual({ items: [], gold: 0, lost: 0, kills: [] });
    expect(state.economy.gold).toBe(before);
  });

  it('★ 只打死一部分 -> 只按打死的那几只掷', () => {
    const state = freshState();
    const kills = wholeWaveKills(2).slice(0, 1); // 第 2 回合 3 只小怪，只打死 1 只
    const drop = grantMonsterRoundDrops(state, 2, 99, kills);
    expect(drop.kills).toHaveLength(1);
    expect(drop.kills[0]!.defId).toBe(kills[0]!.defId);
  });

  it('掉出来的藏品真的进了藏品栏', () => {
    const state = freshState();
    const before = state.items.aSlots.filter(Boolean).length + state.items.bSlots.filter(Boolean).length;
    const drop = grantMonsterRoundDrops(state, 1, 777, wholeWaveKills(1));
    const after = state.items.aSlots.filter(Boolean).length + state.items.bSlots.filter(Boolean).length;
    expect(after - before).toBe(drop.items.length - drop.lost);
    for (const id of drop.items) expect(ITEM_DEFS[id]).toBeDefined();
  });

  it('★ 同一回合 + 同一击杀 + 同一种子 -> 同一套掉落（可复现）', () => {
    const a = grantMonsterRoundDrops(freshState(), 1, 42, wholeWaveKills(1));
    const b = grantMonsterRoundDrops(freshState(), 1, 42, wholeWaveKills(1));
    expect(b).toEqual(a);
  });

  it('Boss 回合掉得比小怪回合多（档位越高越肥）', () => {
    const minion = grantMonsterRoundDrops(freshState(), 1, 9, wholeWaveKills(1));
    const boss = grantMonsterRoundDrops(freshState(), 51, 9, wholeWaveKills(51));
    expect(boss.items.length).toBeGreaterThanOrEqual(minion.items.length);
    expect(boss.items.length).toBeGreaterThanOrEqual(2);
  });

  it('★ 日志文案：每一只都写一行（包括"没有掉落"）', () => {
    const drop = grantMonsterRoundDrops(freshState(), 2, 5, wholeWaveKills(2));
    const lines = killDropLines(drop);
    expect(lines).toHaveLength(3);
    for (const line of lines) expect(line).toMatch(/^击杀 /);
    // 至少有一行说清楚掉了什么（藏品或金币）
    expect(lines.some((line) => line.includes('掉落'))).toBe(true);
  });
});


// ============================================================
//  ★ 0.1.1 藏品二版：骑士长枪专业版（野怪回合掉落金币 +50%）
// ============================================================

describe('★ 骑士长枪专业版：只加成"野怪掉落的那部分金币"', () => {
  /** 装上一件共享藏品（骑士长枪没有 onEquip，会真的待在共享装备位里） */
  function equipKnightLance(state: ReturnType<typeof freshState>): void {
    expect(addItem(state, 'itm_knight_lance_pro').ok).toBe(true);
    const slot = state.items.bSlots.indexOf('itm_knight_lance_pro');
    expect(equipSharedItem(state, slot, 0).ok).toBe(true);
  }

  it('装上去就有 5000bp（+50%）的加成', () => {
    const plain = freshState();
    const withItem = freshState();
    equipKnightLance(withItem);
    expect(monsterDropGoldBp(plain)).toBe(0);
    expect(monsterDropGoldBp(withItem)).toBe(5000);
  });

  it('★ 掉金币的那些怪：2 金 -> 3 金、4 金 -> 6 金（向下取整）', () => {
    // 找一个"小怪真的掉了金币"的种子（45% 概率，扫一下就有）
    const kills = [{ defId: 'mn_slime', tick: 30 }];
    let seed = 0;
    let plainGold = 0;
    for (let i = 0; i < 200; i++) {
      const probe = grantMonsterRoundDrops(freshState(), 1, i, kills);
      if (probe.gold > 0) {
        seed = i;
        plainGold = probe.gold;
        break;
      }
    }
    expect(plainGold, '该扫到一个掉金币的种子').toBeGreaterThan(0);

    const withItem = freshState();
    equipKnightLance(withItem);
    const boosted = grantMonsterRoundDrops(withItem, 1, seed, kills);
    // 与同一件藏品没装时的对比：用另一个只差"没装"的状态跑同一个种子
    const plain = grantMonsterRoundDrops(freshState(), 1, seed, kills);
    expect(plain.gold).toBe(plainGold);
    expect(boosted.gold).toBe(Math.floor((plainGold * 15000) / 10000));
    expect(boosted.gold, '+50% 必须是"更多金币"').toBeGreaterThan(plainGold);
  });

  it('没掉金币的怪不受影响（加成只乘掉落的那一部分）', () => {
    // 小怪掉金币时**不会**再掉藏品；这里反过来找一个"没掉金"的种子
    const kills = [{ defId: 'mn_slime', tick: 30 }];
    let seed = -1;
    for (let i = 0; i < 200; i++) {
      if (grantMonsterRoundDrops(freshState(), 1, i, kills).gold === 0) {
        seed = i;
        break;
      }
    }
    expect(seed, '该扫到一个不掉金币的种子').toBeGreaterThanOrEqual(0);
    const withItem = freshState();
    equipKnightLance(withItem);
    expect(grantMonsterRoundDrops(withItem, 1, seed, kills).gold).toBe(0);
  });
});
