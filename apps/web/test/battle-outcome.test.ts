/**
 * 「我这一场」的胜负账本 —— 纯函数，专门钉死用户报的那个 bug：
 *
 *   "输了但不扣血 / 赢了却扣血又断连胜（小概率）"
 *
 * 根因是结算时读的是**屏幕上那一场**（观战会把它换成别人的战斗），
 * 所以这里把规则写成：
 *   · 账本只认"我自己那一场"；
 *   · 同一场里，服务端给的胜负优先于本地重放算出来的胜负。
 */
import { describe, expect, it } from 'vitest';
import { effectiveWinner, mergeMyBattle, teamOf, wonOf, type MyBattleRecord } from '../src/game/battle-outcome.js';

const rec = (over: Partial<MyBattleRecord> = {}): MyBattleRecord => ({
  battleId: 'B1',
  myTeam: 0,
  winner: 0,
  ...over,
});

describe('★ 「我这一场」的胜负账本', () => {
  it('新的一场整份替换（不会把上一场的服务端胜负带过来）', () => {
    const prev = rec({ battleId: 'B1', winner: 1, serverWinner: 1 });
    const next = mergeMyBattle(prev, rec({ battleId: 'B2', winner: 0 }));
    expect(next!.battleId).toBe('B2');
    expect(next!.serverWinner).toBeUndefined();
    expect(wonOf(next)).toBe(true);
  });

  it('同一场重新赋值时，先到的服务端胜负不会被冲掉', () => {
    const prev = rec({ battleId: 'B1', winner: 0, serverWinner: 1 });
    // 本地重放再次赋值（没有 serverWinner 字段）
    const next = mergeMyBattle(prev, rec({ battleId: 'B1', winner: 0 }));
    expect(next!.serverWinner).toBe(1);
    expect(effectiveWinner(next)).toBe(1);
    // 服务端说我输了 —— 那就按输算，不能因为本地重放说赢就算了
    expect(wonOf(next)).toBe(false);
  });

  it('服务端明确给平局（null）也要覆盖，别被当成"没传"', () => {
    const prev = rec({ battleId: 'B1', winner: 0, serverWinner: 0 });
    const next = mergeMyBattle(prev, rec({ battleId: 'B1', winner: 0, serverWinner: null }));
    expect(wonOf(next)).toBeNull();
  });

  it('我是队伍 1 时，winner===1 才算我赢（不能写死 winner===0）', () => {
    expect(wonOf(rec({ myTeam: 1, winner: 1 }))).toBe(true);
    expect(wonOf(rec({ myTeam: 1, winner: 0 }))).toBe(false);
    expect(wonOf(rec({ myTeam: 0, winner: 1 }))).toBe(false);
  });

  it('没有账本时 wonOf 是 null（不能当成"输"，否则连胜会被凭空清掉）', () => {
    expect(wonOf(null)).toBeNull();
    expect(effectiveWinner(null)).toBeNull();
  });

  it('battleId 为空的记录直接丢掉（保留上一份，不会被空值覆盖）', () => {
    const prev = rec({ battleId: 'B1' });
    expect(mergeMyBattle(prev, rec({ battleId: '' }))).toBe(prev);
  });

  it('teamOf：没账本时退回兜底值（单机恒 0）', () => {
    expect(teamOf(null, 0)).toBe(0);
    expect(teamOf(rec({ myTeam: 1 }), 0)).toBe(1);
  });
});
