/**
 * ============================================================
 *  胜负与血量：**赢的人不掉血、输的人一定掉血**
 * ============================================================
 *
 * 【为什么单独钉这一条？】
 * 用户报的是"输了不扣血 / 赢了扣血又断连胜（小概率）"。
 * 客户端那边的根因已经修了（结算不许读"屏幕上那一场"，见
 * `apps/web/src/game/battle-outcome.ts`），但服务端这条账也必须自己成立 ——
 * 否则客户端再怎么修，血量还是错的。
 *
 * 这里把 `applyBattleResult` / `applyGhostResult` 的四种组合（0 胜 / 1 胜 / 平局 /
 * 我站哪边）全部钉一遍，并顺带核对：
 *   · `hpAfter` 里必须有**双方**的血量（客户端全靠它刷新血条）；
 *   · 平局两边都不掉血、也都不记胜负；
 *   · 影子对战只动"轮空的那个人"，被复制的那位一个字都不变。
 */
import { describe, expect, it } from 'vitest';
import { Room, type RoomPlayer } from '../src/room.js';
import { damageForRound } from '../../shared/src/index.js';

/** 造一个两人房间（p1 是房主） */
function twoPlayers(): { room: Room; p1: RoomPlayer; p2: RoomPlayer } {
  const room = new Room('HPTEST', 'p1', '甲');
  const p2 = room.addPlayer('p2', '乙', 'pa:avatar_1') ?? room.players.find((p) => p.id === 'p2')!;
  const p1 = room.players[0]!;
  p1.hp = 100;
  p2.hp = 100;
  room.round = 1;
  return { room, p1, p2 };
}

describe('★ 胜负结算：赢的人不掉血，输的人一定掉血', () => {
  it('队伍 0 赢：p1 血量不变且记一胜，p2 掉这一回合的血且记一负', () => {
    const { room, p1, p2 } = twoPlayers();
    const damage = damageForRound(1);
    const hpAfter = room.applyBattleResult(0, p1.id, p2.id);

    expect(p1.hp, '★ 赢的人不该掉血').toBe(100);
    expect(p2.hp, '★ 输的人必须掉血').toBe(100 - damage);
    expect(p1.wins).toBe(1);
    expect(p1.losses).toBe(0);
    expect(p2.wins).toBe(0);
    expect(p2.losses).toBe(1);
    expect(hpAfter[p1.id], 'hpAfter 必须带赢家（客户端血条要用）').toBe(100);
    expect(hpAfter[p2.id]).toBe(100 - damage);
  });

  it('队伍 1 赢：反过来 —— p2 不掉血，p1 掉血', () => {
    const { room, p1, p2 } = twoPlayers();
    const damage = damageForRound(1);
    room.applyBattleResult(1, p1.id, p2.id);

    expect(p2.hp).toBe(100);
    expect(p1.hp).toBe(100 - damage);
    expect(p2.wins).toBe(1);
    expect(p1.losses).toBe(1);
  });

  it('平局：两边都不掉血、也都不记胜负（连胜连败保持原样）', () => {
    const { room, p1, p2 } = twoPlayers();
    p1.hp = 80;
    p2.hp = 70;
    const hpAfter = room.applyBattleResult(null, p1.id, p2.id);

    expect(p1.hp).toBe(80);
    expect(p2.hp).toBe(70);
    expect(p1.wins + p1.losses).toBe(0);
    expect(p2.wins + p2.losses).toBe(0);
    expect(hpAfter[p1.id]).toBe(80);
    expect(hpAfter[p2.id]).toBe(70);
  });

  it('血量不会扣成负数（扣到 0 为止）', () => {
    const { room, p1, p2 } = twoPlayers();
    p2.hp = 1;
    room.applyBattleResult(0, p1.id, p2.id);
    expect(p2.hp).toBe(0);
  });

  it('★ 无论谁在左边，赢的那一方血量都不变（8 回合逐回合核对）', () => {
    for (let round = 1; round <= 8; round++) {
      for (const winner of [0, 1] as const) {
        const { room, p1, p2 } = twoPlayers();
        room.round = round;
        const damage = damageForRound(round);
        room.applyBattleResult(winner, p1.id, p2.id);
        const winnerPlayer = winner === 0 ? p1 : p2;
        const loserPlayer = winner === 0 ? p2 : p1;
        expect(winnerPlayer.hp, `第 ${round} 回合：赢家不该掉血`).toBe(100);
        expect(loserPlayer.hp, `第 ${round} 回合：输家该掉 ${damage}`).toBe(100 - damage);
      }
    }
  });

  it('掉血公式各处同源：第 1/5/6/10/11 回合是 3/3/6/6/9', () => {
    expect([1, 5, 6, 10, 11].map((round) => damageForRound(round))).toEqual([3, 3, 6, 6, 9]);
  });
});

describe('★ 影子对战（轮空）：只动轮空者', () => {
  it('轮空者赢了：不掉血，记一胜', () => {
    const { room, p1, p2 } = twoPlayers();
    room.applyGhostResult(0, p1.id);
    expect(p1.hp).toBe(100);
    expect(p1.wins).toBe(1);
    expect(p2.hp, '被复制的人毫发无损').toBe(100);
    expect(p2.wins + p2.losses).toBe(0);
  });

  it('轮空者输了：掉血、记一负；被复制的人依然不变', () => {
    const { room, p1, p2 } = twoPlayers();
    const damage = damageForRound(1);
    room.applyGhostResult(1, p1.id);
    expect(p1.hp).toBe(100 - damage);
    expect(p1.losses).toBe(1);
    expect(p2.hp).toBe(100);
  });

  it('影子对战平局：不掉血、不记胜负', () => {
    const { room, p1 } = twoPlayers();
    room.applyGhostResult(null, p1.id);
    expect(p1.hp).toBe(100);
    expect(p1.wins + p1.losses).toBe(0);
  });
});
