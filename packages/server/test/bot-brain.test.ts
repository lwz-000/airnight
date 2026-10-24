/**
 * ============================================================
 *  ★★ 0.3.3 人机大脑 —— 单机层面的"该什么时候说话"
 * ============================================================
 *
 * 【为什么还要这一层？端到端不是已经跑通了吗？】
 * 端到端只证明了"能打下去"，但有些行为在完整对局里**很难触发**：
 *   · 盟约选秀（要等 30 秒、还要恰好轮到它）；
 *   · 有人掉线 -> 暂停 -> 人机要不要投票（要人为制造掉线）。
 * 这两条恰恰是最容易写错的（"轮到我了我没反应" / "掉线的人被秒淘汰"）。
 *
 * 所以这里直接喂 `ServerMessage` 给大脑，断言它**发出去的那条消息**。
 * 它和大厅/对局里用的是同一份 `onServerMessage`，所以这里通了，线上就通。
 */
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_ROOM_SETTINGS } from '../../shared/src/room-settings.js';
import { COVENANTS } from '../../shared/src/covenant-data.js';
import type { ClientMessage, RoomView, ServerMessage } from '../../shared/src/protocol.js';
import { BotBrain } from '../src/bot.js';

const ME = 'bot:ROOM01:1';

function makeBrain(difficulty: 'easy' | 'normal' | 'hard') {
  const sent: ClientMessage[] = [];
  const brain = new BotBrain({
    playerId: ME,
    roomCode: 'ROOM01',
    difficulty,
    // 不限速：这里只验"发不发"，不验节奏
    speed: 0.001,
    send: (message) => {
      sent.push(message);
    },
  });
  return { brain, sent };
}

/** 造一份房间视图（只填这个用例关心的字段） */
function roomView(overrides: Partial<RoomView> = {}): RoomView {
  return {
    code: 'ROOM01',
    hostId: 'p-host',
    phase: 'lobby',
    round: 0,
    prepSecondsLeft: 0,
    settings: DEFAULT_ROOM_SETTINGS,
    players: [
      {
        id: 'p-host',
        name: '房主',
        avatarId: '',
        ready: true,
        connected: true,
        hp: 100,
        level: 1,
        streak: 0,
        submitted: false,
        round: 0,
        wins: 0,
        losses: 0,
      },
      {
        id: ME,
        name: '人机·普通1',
        avatarId: '',
        ready: false,
        connected: true,
        hp: 100,
        level: 1,
        streak: 0,
        submitted: false,
        round: 0,
        wins: 0,
        losses: 0,
        isBot: true,
        botDifficulty: 'normal',
      },
    ],
    ...overrides,
  } as RoomView;
}

function feed(brain: BotBrain, message: ServerMessage): void {
  brain.onServerMessage(message);
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe('★★ 人机：大厅里自动准备', () => {
  it('自己还没准备时会发 setReady（否则房主永远开不了局）', async () => {
    const { brain, sent } = makeBrain('normal');
    feed(brain, { t: 'room', room: roomView() });
    await sleep(10);
    expect(sent.filter((m) => m.t === 'setReady')).toHaveLength(1);
    expect(sent.find((m) => m.t === 'setReady')).toMatchObject({ ready: true });
    // 已经准备了就不该反复发（每秒一次房间广播，会刷屏）
    sent.length = 0;
    const ready = roomView();
    ready.players[1]!.ready = true;
    feed(brain, { t: 'room', room: ready });
    await sleep(10);
    expect(sent.filter((m) => m.t === 'setReady')).toHaveLength(0);
    brain.dispose();
  });
});

describe('★★ 人机：盟约选秀', () => {
  const draftRoom = (currentPlayerId: string) =>
    roomView({
      phase: 'covenant',
      covenant: { currentPlayerId, secondsLeft: 20, remaining: 1, total: 2 },
    });

  it('★★ 轮到自己就自己选（不会干等到 30 秒超时）', async () => {
    const { brain, sent } = makeBrain('normal');
    feed(brain, { t: 'room', room: draftRoom(ME) });
    await sleep(30);
    const picks = sent.filter((m) => m.t === 'pickCovenant');
    expect(picks, '★ 轮到人机时必须发 pickCovenant').toHaveLength(1);
    expect(picks[0]!.covenantId).toBeTruthy();
    brain.dispose();
  });

  it('没轮到自己就不吭声（否则会被服务端回一串"还没轮到你选"）', async () => {
    const { brain, sent } = makeBrain('normal');
    feed(brain, { t: 'room', room: draftRoom('p-host') });
    await sleep(30);
    expect(sent.filter((m) => m.t === 'pickCovenant')).toHaveLength(0);
    brain.dispose();
  });

  it('同一次轮次只发一条（房间广播一秒一条，不能一秒选一次）', async () => {
    const { brain, sent } = makeBrain('normal');
    for (let i = 0; i < 5; i++) feed(brain, { t: 'room', room: draftRoom(ME) });
    await sleep(30);
    expect(sent.filter((m) => m.t === 'pickCovenant')).toHaveLength(1);
    brain.dispose();
  });

  it('★ 困难档按偏好顺序挑；被别人选走的会跳过去', async () => {
    const first = makeBrain('hard');
    feed(first.brain, { t: 'room', room: draftRoom(ME) });
    await sleep(30);
    const preferred = first.sent.find((m) => m.t === 'pickCovenant');
    expect(preferred, '困难档要选出来一个').toBeTruthy();

    // 把第一个偏好让给别人 -> 它应该换下一个，而不是硬发同一个
    const takenRoom = draftRoom(ME);
    takenRoom.players[0]!.covenantId = (preferred as { covenantId: string }).covenantId;
    const second = makeBrain('hard');
    feed(second.brain, { t: 'room', room: takenRoom });
    await sleep(30);
    const next = second.sent.find((m) => m.t === 'pickCovenant');
    expect(next).toBeTruthy();
    expect((next as { covenantId: string }).covenantId).not.toBe(
      (preferred as { covenantId: string }).covenantId,
    );
    // 而且必须是一个真的存在的盟约
    expect(COVENANTS.some((covenant) => covenant.id === (next as { covenantId: string }).covenantId)).toBe(
      true,
    );

    first.brain.dispose();
    second.brain.dispose();
  });
});

describe('★★ 人机：有人掉线时的暂停投票', () => {
  it('★ 不会立刻投（要给掉线的人留时间回来）', async () => {
    vi.useFakeTimers();
    try {
      const { brain, sent } = makeBrain('normal');
      feed(brain, { t: 'room', room: roomView({ phase: 'prep', paused: true }) });
      // 一秒内不该有票（否则谁网络抖一下就当场淘汰）
      vi.advanceTimersByTime(1000);
      expect(sent.filter((m) => m.t === 'pauseVote')).toHaveLength(0);
      brain.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('★ 等够了就投（否则"需要 N 票"永远缺人机那几票）', async () => {
    vi.useFakeTimers();
    try {
      const { brain, sent } = makeBrain('normal');
      feed(brain, { t: 'room', room: roomView({ phase: 'prep', paused: true }) });
      vi.advanceTimersByTime(26_000);
      expect(sent.filter((m) => m.t === 'pauseVote')).toHaveLength(1);
      brain.dispose();
    } finally {
      vi.useRealTimers();
    }
  });
});
