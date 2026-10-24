/**
 * ============================================================
 *  ★★ 0.3.1 盟约「重生疗法」：野怪回合不算"有效胜场"
 * ============================================================
 *
 * 【为什么单独测这个？】
 * 卡面写的是「每累计赢下 2 场战斗，回复 3 点生命值（**野怪回合不计入**）」。
 * 但野怪回合在服务端走的也是 `applyGhostResult` —— 和"影子对战"同一条路，
 * 于是 `wins++` 照加、回血照触发：打野怪也能凑"赢 2 场"，
 * 实际恢复速度比卡面快一大截（这类错误跑一整局都未必看得出来）。
 *
 * 现在的口径：
 *   · `wins` / `losses` 照旧记（战绩、排名要用）；
 *   · `covenantWins` 只记**真人 / 影子**那两场的胜利 —— 野怪回合传
 *     `{ countsForCovenant: false }`，不记也不回血。
 */
import { describe, expect, it } from 'vitest';
import { Room } from '../src/room.js';

/** 造一个只有房主的房间 */
function roomWithCovenant(covenantId: string): { room: Room; me: { id: string } } {
  const room = new Room('ABC123', 'p1', '甲');
  const me = room.players[0]!;
  me.covenantId = covenantId;
  me.hp = 50;
  return { room, me };
}

describe('★ 盟约「重生疗法」：野怪回合不计入', () => {
  it('★★ 野怪回合赢了：战绩 +1，但盟约账本不动、血量不涨', () => {
    const { room, me } = roomWithCovenant('cv_warfarin');
    const player = room.players[0]!;
    room.applyGhostResult(0, me.id, { countsForCovenant: false });

    expect(player.wins, '战绩照记').toBe(1);
    expect(player.covenantWins, '★ 盟约不该记这一场').toBe(0);
    expect(player.hp, '★ 不该回血').toBe(50);
  });

  it('★★ 真人/影子对战的胜利才进盟约账本：第 2 场回 3 血', () => {
    const { room, me } = roomWithCovenant('cv_warfarin');
    const player = room.players[0]!;

    // 野怪赢一场（不算）
    room.applyGhostResult(0, me.id, { countsForCovenant: false });
    // 影子对战赢一场（算：第 1 场）
    room.applyGhostResult(0, me.id);
    expect(player.covenantWins).toBe(1);
    expect(player.hp, '第 1 场不该回').toBe(50);

    // 再赢一场（第 2 场）—— 这一刻才回 3 点
    room.applyGhostResult(0, me.id);
    expect(player.covenantWins).toBe(2);
    expect(player.hp).toBe(53);
  });

  it('★ 没选这个盟约：赢了也不回血（别给别人顺手回血）', () => {
    const room = new Room('ABC124', 'p2', '乙');
    const player = room.players[0]!;
    player.hp = 50;
    room.applyGhostResult(0, 'p2');
    expect(player.hp).toBe(50);
    expect(player.covenantWins, '账本照记（以后要显示"有效胜场"也能用）').toBe(1);
  });
});
