/**
 * ============================================================
 *  ★★ 0.3.5：「再来一局」—— 打完一局把房间退回大厅
 * ============================================================
 *
 * 【它必须成立的三件事】
 *   ① 座位、房主、房间号、房间设置**都不变**（用户口径是"返回当前房间"）；
 *   ② 血量 / 战绩 / 连胜连败 / 准备状态 / 盟约 / 淘汰标记全部复位 ——
 *      只要漏一样，`canStart()` 就会判"活人不足 2 个"，房主点开始永远没反应；
 *   ③ 牌库与商店预定一起清（上一局被拿走的牌不能留到下一局）。
 */
import { describe, expect, it } from 'vitest';
import { Room } from '../src/room.js';
import { poolSizeOf } from '../../shared/src/index.js';

function matchEndedRoom(): Room {
  const room = new Room('AGAIN1', 'p1', '甲');
  room.addPlayer('p2', '乙', 'pa:avatar_1');
  const p1 = room.players[0]!;
  const p2 = room.players[1]!;

  // 一局打完之后的样子：一个冠军、一个出局
  room.phase = 'resolve';
  room.round = 12;
  p1.hp = 37;
  p1.wins = 6;
  p1.losses = 2;
  p1.level = 9;
  p1.streak = 3;
  p1.covenantId = 'cv_qiliang';
  p1.covenantWins = 4;
  p1.lastOpponentId = 'p2';
  p1.totalDamage = 123456;
  p2.hp = 0;
  p2.wins = 1;
  p2.losses = 7;
  p2.eliminatedRound = 3;
  p2.finalLineup = [{ defId: 'op01', star: 2, cell: { col: 1, row: 1 } }];
  for (const player of room.players) player.ready = true;
  // 牌库被拿走几张（上一局的占用）—— 走公开接口，别去摸私有 Map
  room.takeFromPool('op01', 3);
  room.setShopHeld('p1', ['op01', 'op03']);
  return room;
}

describe('★ 「再来一局」：房间退回大厅', () => {
  it('座位 / 房主 / 房间码 / 设置都不动', () => {
    const room = matchEndedRoom();
    const before = room.players.map((p) => p.id);
    const settings = { ...room.settings };
    room.backToLobby();
    expect(room.players.map((p) => p.id)).toEqual(before);
    expect(room.hostId).toBe('p1');
    expect(room.code).toBe('AGAIN1');
    expect(room.settings).toEqual(settings);
    expect(room.phase).toBe('lobby');
  });

  it('★★ 血量/战绩/连胜/准备/盟约/淘汰全部复位（否则 canStart 永远为假）', () => {
    const room = matchEndedRoom();
    expect(room.canStart(), '前提：上一局刚打完时是开不了新局的').toBe(false);

    room.backToLobby();

    for (const player of room.players) {
      expect(player.hp).toBe(room.settings.startHp);
      expect(player.wins).toBe(0);
      expect(player.losses).toBe(0);
      expect(player.covenantWins).toBe(0);
      expect(player.ready).toBe(false);
      expect(player.covenantId).toBeUndefined();
      expect(player.lastOpponentId).toBeNull();
      expect(player.eliminatedRound).toBeUndefined();
      expect(player.finalLineup).toBeUndefined();
      expect(player.level).toBe(1);
      expect(player.streak).toBe(0);
    }
    expect(room.canStart(), '★ 复位之后必须能再开一局').toBe(true);
  });

  it('牌库与商店预定一起清空', () => {
    const room = matchEndedRoom();
    const fullOpool = room.poolRemaining()['op01'];
    expect(fullOpool, '前提：上一局确实占用了牌库').toBeLessThan(poolSizeOf('op01'));
    expect(Object.keys(room.poolHeld()).length, '前提：商店里也占着牌').toBeGreaterThan(0);

    room.backToLobby();

    expect(room.poolRemaining()['op01'], '牌库回到满').toBe(poolSizeOf('op01'));
    expect(Object.keys(room.poolHeld()).length, '商店预定清空').toBe(0);
  });

  it('回合号回到"开局前"（下一次 startGame 会自己 +1）', () => {
    const room = matchEndedRoom();
    room.backToLobby();
    expect(room.round).toBeLessThan(1);
  });
});
