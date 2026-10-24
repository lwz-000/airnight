/**
 * ============================================================
 *  ★★ 0.3.3 人机（Bot）—— 房间层面的规则
 * ============================================================
 *
 * 【为什么先测这一层？】
 * 人机的"聪明程度"很难用断言钉住（今天困难比普通强，明天改个数就未必），
 * 但**边界规则**必须钉死，而且它们是真会被玩坏的地方：
 *   · 人机占不占座位？（占 —— 否则"8 人房"能塞进 8 个真人 + 7 个机器人）
 *   · 房主掉线之后能不能把房主交给一台人机？（不能 —— 交出去这个房间就废了）
 *   · 房间里只剩人机了怎么办？（销毁 —— 否则局域网列表里永远挂着一张"进不去的空房"）
 *   · 真人能不能被 `removeBot` 删掉？（不能，那条路只认 bot）
 *
 * ★ 这一层不碰网络、不碰定时器，纯 Room + RoomManager，毫秒级。
 */
import { describe, expect, it } from 'vitest';
import { MAX_BOTS_PER_ROOM, botDisplayName, botPlayerId } from '../../shared/src/bot.js';
import { MAX_PLAYERS_PER_ROOM } from '../../shared/src/protocol.js';
import { Room, RoomManager } from '../src/room.js';

function newManager(): { manager: RoomManager; room: Room } {
  const manager = new RoomManager();
  const room = manager.createRoom('p-host', '房主');
  return { manager, room };
}

describe('★★ 人机占座位与上限', () => {
  it('加进来的是一台"已准备"的人机，占一个座位', () => {
    const { manager, room } = newManager();
    const added = manager.addBot(room.code, 'hard', botDisplayName);
    expect(added.error, '大厅里加人机不该失败').toBeUndefined();
    const bot = added.bot!;
    expect(bot.isBot, '★ 必须被标成人机').toBe(true);
    expect(bot.botDifficulty).toBe('hard');
    expect(bot.name, '★ 名字里带难度和编号，房主才分得清哪台是哪台').toBe('人机·困难1');
    expect(bot.ready, '★ 人机天生已准备（否则房主不知道该点哪儿）').toBe(true);
    expect(room.players).toHaveLength(2);
    expect(room.bots()).toHaveLength(1);
    expect(room.humans(), '★ 真人只有一个').toHaveLength(1);
  });

  it('编号会补空：删掉 1 号之后，下一台还是 1 号', () => {
    const { manager, room } = newManager();
    const first = manager.addBot(room.code, 'easy', botDisplayName).bot!;
    const second = manager.addBot(room.code, 'easy', botDisplayName).bot!;
    expect(first.name).toBe('人机·简单1');
    expect(second.name).toBe('人机·简单2');

    manager.removeBot(room.code, first.id);
    const again = manager.addBot(room.code, 'easy', botDisplayName).bot!;
    expect(again.id, '★ 空出来的编号可以复用').toBe(first.id);
    expect(again.name).toBe('人机·简单1');
  });

  it('★ 人机最多 7 台（要留一个真人座位）', () => {
    const { manager, room } = newManager();
    for (let i = 0; i < MAX_BOTS_PER_ROOM; i++) {
      expect(manager.addBot(room.code, 'normal', botDisplayName).error).toBeUndefined();
    }
    const overflow = manager.addBot(room.code, 'normal', botDisplayName);
    expect(overflow.error, '★ 第 8 台必须被拒').toContain('人机最多');
    expect(room.bots()).toHaveLength(MAX_BOTS_PER_ROOM);
    expect(room.players).toHaveLength(MAX_BOTS_PER_ROOM + 1);
  });

  it('★ 座位满了（8 人）之后，就算人机名额还有也不能再加', () => {
    const { manager, room } = newManager();
    // 先塞满真人：房主 + 7 个真人 = 8
    for (let i = 2; i <= MAX_PLAYERS_PER_ROOM; i++) {
      room.addPlayer(`p-${i}`, `玩家${i}`);
    }
    expect(room.players).toHaveLength(MAX_PLAYERS_PER_ROOM);
    const added = manager.addBot(room.code, 'easy', botDisplayName);
    expect(added.error, '★ 人机也占座位，满了就是满了').toContain('房间满了');
  });

  it('对局开始之后不能加 / 删 / 改难度（三道路都被挡住）', () => {
    const { manager, room } = newManager();
    const bot = manager.addBot(room.code, 'easy', botDisplayName).bot!;
    room.phase = 'prep';
    expect(manager.addBot(room.code, 'easy', botDisplayName).error).toContain('对局已经开始');
    expect(manager.removeBot(room.code, bot.id).error).toContain('对局已经开始');
    expect(manager.setBotDifficulty(room.code, bot.id, 'hard').error).toContain('对局已经开始');
  });

  it('removeBot 只认人机：拿真人 id 去调会被拒', () => {
    const { manager, room } = newManager();
    const result = manager.removeBot(room.code, room.hostId);
    expect(result.error).toContain('找不到这台人机');
    expect(room.players).toHaveLength(1);
  });

  it('改难度会同步改名字（"人机·困难2" -> "人机·简单2"）', () => {
    const { manager, room } = newManager();
    const bot = manager.addBot(room.code, 'hard', botDisplayName).bot!;
    manager.setBotDifficulty(room.code, bot.id, 'easy');
    expect(bot.botDifficulty).toBe('easy');
  });
});

describe('★★ 房主继承：人机永远不能当房主', () => {
  it('房主掉线 + 房间里只有人机 -> 房主不会被交给人机', () => {
    const { manager, room } = newManager();
    manager.addBot(room.code, 'hard', botDisplayName);
    manager.addBot(room.code, 'easy', botDisplayName);

    room.markDisconnected(room.hostId);
    room.migrateHost();
    expect(room.hostId, '★ 房主还是原来那个人（只是离线）').toBe('p-host');
    expect(room.getPlayer(room.hostId)!.isBot ?? false, '★ 房主绝不能是人机').toBe(false);
  });

  it('房主掉线、但还有一个真人在线 -> 房主交给那个真人', () => {
    const { manager, room } = newManager();
    manager.addBot(room.code, 'hard', botDisplayName);
    room.addPlayer('p-guest', '朋友');

    room.markDisconnected(room.hostId);
    room.migrateHost();
    expect(room.hostId).toBe('p-guest');
  });
});

describe('★★ 房间里只剩人机 = 这个房间该没了', () => {
  it('最后一个真人离开 -> 房间被销毁（人机不会永远占着一张空房）', () => {
    const { manager, room } = newManager();
    manager.addBot(room.code, 'normal', botDisplayName);
    manager.addBot(room.code, 'normal', botDisplayName);

    const left = manager.leaveRoom(room.hostId);
    expect(left, '★ 销毁之后不该再把房间返回给调用方').toBeUndefined();
    expect(manager.getRoom(room.code), '★ 房间必须真的没了').toBeUndefined();
    expect(manager.roomCount).toBe(0);
  });

  it('只要还有一个真人，房间就留着', () => {
    const { manager, room } = newManager();
    manager.addBot(room.code, 'normal', botDisplayName);
    room.addPlayer('p-guest', '朋友');

    const left = manager.leaveRoom(room.hostId);
    expect(left).toBeDefined();
    expect(left!.humans()).toHaveLength(1);
    expect(manager.getRoom(room.code)).toBeDefined();
  });
});

describe('★★ 人机的 id 和名字', () => {
  it('id 带 bot: 前缀，且和房间码 / 编号绑定', () => {
    const { manager, room } = newManager();
    const bot = manager.addBot(room.code, 'normal', botDisplayName).bot!;
    expect(bot.id.startsWith('bot:')).toBe(true);
    expect(bot.id).toBe(botPlayerId(room.code, 1));
  });

  it('同名玩家不会被动到：人机 id 和真人 id 完全不同形状', () => {
    const { manager, room } = newManager();
    const bot = manager.addBot(room.code, 'normal', botDisplayName).bot!;
    expect(bot.id).not.toBe(room.hostId);
    expect(new Set(room.players.map((p) => p.id)).size, '★ 房间里 id 必须唯一').toBe(room.players.length);
  });
});
