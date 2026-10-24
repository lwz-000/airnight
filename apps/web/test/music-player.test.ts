/**
 * ============================================================
 *  背景音乐播放器
 * ============================================================
 *
 * 【为什么值得写测试？】
 * "下一首该放哪个"看着简单，其实边界特别多：
 *   · 列表循环 vs 单曲循环 vs 不循环，到列表尽头行为各不相同
 *   · 随机播放要按乱序表走，还不能重复到同一首
 *   · **手动点「下一首」和自动播完换歌，在单曲循环下行为不一样**
 *     （手动必须真的换歌，否则按了没反应；自动必须重放同一首）
 * 这些组合有十几种，靠手点根本点不全，点漏了就是"随机播放偶尔卡住"
 * 这种没人能复现的 bug。
 *
 * 所以下面把纯逻辑（stepIndex / shuffledOrder / formatTime）和
 * 播放器的状态机分开测 —— 音频元素用假的，不碰真实播放。
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  REPEAT_LABEL,
  createMusicPlayer,
  defaultTrackIndex,
  formatTime,
  nextRepeatMode,
  shuffledOrder,
  stepIndex,
  trackUrl,
  type MusicTrack,
  type RepeatMode,
} from '../src/audio/music-player.js';

// ---------------------------------------------------------------- 纯逻辑

describe('纯逻辑：随机顺序 shuffledOrder', () => {
  it('是 0..n-1 的一个排列（不重不漏）', () => {
    const order = shuffledOrder(50);
    expect([...order].sort((a, b) => a - b)).toEqual(Array.from({ length: 50 }, (_, i) => i));
  });

  it('同一个种子给出同一个顺序（可复现）', () => {
    let seed = 0.42;
    const rng = () => {
      seed = (seed * 9301 + 49297) % 233280 / 233280;
      return seed;
    };
    const a = shuffledOrder(20, rng);
    seed = 0.42;
    const b = shuffledOrder(20, rng);
    expect(a).toEqual(b);
  });

  it('0 首和 1 首都不会崩', () => {
    expect(shuffledOrder(0)).toEqual([]);
    expect(shuffledOrder(1)).toEqual([0]);
  });
});

describe('纯逻辑：下一首/上一首 stepIndex', () => {
  const base = { order: [] as number[], shuffle: false, repeat: 'all' as RepeatMode, auto: false };

  it('上一首/下一首就是 ±1', () => {
    expect(stepIndex(3, 1, 10, base)).toBe(4);
    expect(stepIndex(3, -1, 10, base)).toBe(2);
  });

  it('列表循环：从最后一首往下一首回到第一首', () => {
    expect(stepIndex(9, 1, 10, base)).toBe(0);
    expect(stepIndex(0, -1, 10, base)).toBe(9);
  });

  it('不循环：走到尽头返回 null（该停下了）', () => {
    const off = { ...base, repeat: 'off' as RepeatMode };
    expect(stepIndex(9, 1, 10, off)).toBeNull();
    expect(stepIndex(0, -1, 10, off)).toBeNull();
  });

  it('★ 单曲循环：自动播完重放同一首，但手动按「下一首」要真的换歌', () => {
    const one = { ...base, repeat: 'one' as RepeatMode };
    expect(stepIndex(4, 1, 10, { ...one, auto: true })).toBe(4);
    // 手动 —— 如果这里返回 4，玩家会觉得按钮坏了
    expect(stepIndex(4, 1, 10, { ...one, auto: false })).toBe(5);
  });

  it('单曲循环 + 手动「上一首」也是真的往回走', () => {
    const one = { ...base, repeat: 'one' as RepeatMode };
    expect(stepIndex(4, -1, 10, one)).toBe(3);
  });

  it('随机播放：按乱序表走，不是按下标 ±1', () => {
    const order = [7, 2, 9, 0, 5, 1, 8, 3, 6, 4];
    const sh = { order, shuffle: true, repeat: 'all' as RepeatMode, auto: false };
    expect(stepIndex(7, 1, 10, sh)).toBe(2); // order[0] -> order[1]
    expect(stepIndex(2, 1, 10, sh)).toBe(9);
    expect(stepIndex(7, -1, 10, sh)).toBe(4); // 绕回表尾 order[9]
    expect(stepIndex(4, 1, 10, sh)).toBe(7); // 表尾 -> 表头
  });

  it('随机 + 不循环：乱序表走到尽头也停下', () => {
    const order = [1, 0];
    expect(stepIndex(0, 1, 2, { order, shuffle: true, repeat: 'off', auto: false })).toBeNull();
  });

  it('随机播放但乱序表长度对不上时退回顺序播放（防御性）', () => {
    expect(stepIndex(1, 1, 5, { order: [3, 1], shuffle: true, repeat: 'all', auto: false })).toBe(2);
  });

  it('0 首 / 还没开始时不会算出非法下标', () => {
    expect(stepIndex(-1, 1, 10, base)).toBe(0);
    expect(stepIndex(0, 1, 0, base)).toBeNull();
  });
});

describe('纯逻辑：杂项', () => {
  it('formatTime 按 m:ss 显示，超过一小时带小时', () => {
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(-5)).toBe('0:00');
    expect(formatTime(59)).toBe('0:59');
    expect(formatTime(60)).toBe('1:00');
    expect(formatTime(208)).toBe('3:28');
    expect(formatTime(3661)).toBe('1:01:01');
  });

  it('trackUrl 把相对路径拼到基址后面，两种基址都对', () => {
    expect(trackUrl('./', 'music/t001.mp3')).toBe('./music/t001.mp3');
    expect(trackUrl('/', 'music/t001.mp3')).toBe('/music/t001.mp3');
    expect(trackUrl('./', '')).toBe('');
  });

  it('循环模式三档轮换：不循环 → 列表 → 单曲 → 不循环', () => {
    expect(nextRepeatMode('off')).toBe('all');
    expect(nextRepeatMode('all')).toBe('one');
    expect(nextRepeatMode('one')).toBe('off');
    expect(Object.keys(REPEAT_LABEL)).toEqual(['off', 'all', 'one']);
  });
});

// ---------------------------------------------------------------- 播放器状态机

/** 假音频元素：只实现播放器真正用到的那几个成员 */
class FakeAudio {
  src = '';
  volume = 1;
  currentTime = 0;
  paused = true;
  playCalls = 0;
  /** 设成 'reject' 就模拟"浏览器拦下自动播放" */
  playBehaviour: 'ok' | 'reject' = 'ok';
  private listeners = new Map<string, Set<() => void>>();

  addEventListener(type: string, fn: () => void): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
  }

  removeEventListener(type: string, fn: () => void): void {
    this.listeners.get(type)?.delete(fn);
  }

  dispatch(type: string): void {
    for (const fn of this.listeners.get(type) ?? []) fn();
  }

  play(): Promise<void> {
    this.playCalls++;
    if (this.playBehaviour === 'reject') return Promise.reject(new Error('NotAllowedError'));
    this.paused = false;
    this.dispatch('play');
    return Promise.resolve();
  }

  pause(): void {
    this.paused = true;
    this.dispatch('pause');
  }

  /** 模拟"这一首播完了" */
  finish(): void {
    this.currentTime = 0;
    this.paused = true;
    this.dispatch('ended');
  }
}

const TRACKS: MusicTrack[] = [
  { file: 'music/t001.mp3', title: '第一首', album: '专辑A', duration: 100 },
  { file: 'music/t002.mp3', title: '第二首', album: '专辑A', duration: 200 },
  { file: 'music/t003.mp3', title: '第三首', album: '专辑B', duration: 300 },
];

function makeStorage() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
  };
}

function makePlayer(
  overrides: { tracks?: MusicTrack[]; playBehaviour?: 'ok' | 'reject'; defaultTrack?: string } = {},
) {
  const audio = new FakeAudio();
  if (overrides.playBehaviour) audio.playBehaviour = overrides.playBehaviour;
  const storage = makeStorage();
  const gestureTarget = new EventTarget();
  const fetchImpl = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ tracks: overrides.tracks ?? TRACKS }),
  })) as unknown as typeof fetch;

  const player = createMusicPlayer({
    audio: audio as unknown as HTMLAudioElement,
    base: './',
    storage,
    fetchImpl,
    gestureTarget,
    defaultTrack: overrides.defaultTrack,
    rng: () => 0.5,
  });
  return { player, audio, storage, gestureTarget };
}

describe('播放器：加载索引', () => {
  it('load() 之后曲目就绪，并停在第 0 首（不自动开声）', async () => {
    const { player, audio } = makePlayer();
    expect(player.getSnapshot().loading).toBe(true);
    await player.load();
    const s = player.getSnapshot();
    expect(s.count).toBe(3);
    expect(s.current).toBe(0);
    expect(s.playing).toBe(false);
    expect(s.error).toBeNull();
    // 关键：加载时**不**调 play()，否则一定触发浏览器的自动播放拦截
    expect(audio.playCalls).toBe(0);
    expect(audio.src).toBe('./music/t001.mp3');
  });
  it('索引 404 时给出错误但不会抛异常', async () => {
    const audio = new FakeAudio();
    const player = createMusicPlayer({
      audio: audio as unknown as HTMLAudioElement,
      base: './',
      storage: null,
      gestureTarget: new EventTarget(),
      fetchImpl: (async () => ({ ok: false, status: 404, json: async () => ({}) })) as unknown as typeof fetch,
    });
    await player.load();
    const s = player.getSnapshot();
    expect(s.count).toBe(0);
    expect(s.loading).toBe(false);
    expect(s.error).toContain('404');
  });

  it('索引里一首都没有也算正常情况（这次构建没带音乐）', async () => {
    const { player } = makePlayer({ tracks: [] });
    await player.load();
    expect(player.getSnapshot().count).toBe(0);
    expect(player.getSnapshot().error).toBe('没有曲目');
  });
});

describe('★ 首次进游戏的默认曲目', () => {
  it('defaultTrackIndex 优先精确匹配曲名', () => {
    expect(defaultTrackIndex(TRACKS, '第二首')).toBe(1);
  });

  it('精确匹配不到时用"包含"兜底（曲名可能带副标题/空格）', () => {
    const tracks: MusicTrack[] = [
      { file: 'music/t001.mp3', title: 'Intro', album: 'A', duration: 1 },
      { file: 'music/t002.mp3', title: '生命流 (Live)', album: 'B', duration: 1 },
    ];
    expect(defaultTrackIndex(tracks, '生命流')).toBe(1);
  });

  it('找不到就退回第 0 首；空列表返回 -1', () => {
    expect(defaultTrackIndex(TRACKS, '根本没有这首')).toBe(0);
    expect(defaultTrackIndex(TRACKS, undefined)).toBe(0);
    expect(defaultTrackIndex([], '生命流')).toBe(-1);
  });

  it('没有本地记录 → 选默认曲目，并且默认就"想播"（等第一次用户手势）', async () => {
    const tracks: MusicTrack[] = [
      { file: 'music/t001.mp3', title: '别的歌', album: 'A', duration: 1 },
      { file: 'music/t002.mp3', title: '生命流', album: '明日方舟OST1', duration: 196 },
    ];
    const { player, audio } = makePlayer({ tracks, defaultTrack: '生命流' });
    await player.load();
    expect(player.getSnapshot().current).toBe(1);
    expect(audio.src).toBe('./music/t002.mp3');
    // 依然不主动 play() —— 交给第一次点击时续上
    expect(audio.playCalls).toBe(0);
  });

  it('★ 默认音量是 5%（用户口径：背景音乐只当"陪着玩"，别盖住提示音）', async () => {
    /*
      ★ 这条为什么要钉？因为 5% 写在 `DEFAULTS.volume` 里，
      玩家一拖音量条就把 0.05 覆盖进 localStorage 了 ——
      以后再想"确认默认值是不是真的改了"，只能靠这条断言。
      （0.3.3 之前是 60%，太吵；改了别的音量逻辑别顺手把它改回去。）
    */
    const tracks: MusicTrack[] = [
      { file: 'music/t001.mp3', title: '别的歌', album: 'A', duration: 1 },
      { file: 'music/t002.mp3', title: '生命流', album: '明日方舟OST1', duration: 196 },
    ];
    const { player, audio } = makePlayer({ tracks, defaultTrack: '生命流' });
    await player.load();
    expect(player.getSnapshot().volume).toBeCloseTo(0.05, 5);
    // 音频元素上也要真的按 5% 设过去（不然界面显示 5%、耳朵听到 60%）
    expect(audio.volume).toBeCloseTo(0.05, 5);
  });

  it('本地存过偏好时以玩家的选择为准，默认曲目不覆盖它', async () => {
    const tracks: MusicTrack[] = [
      { file: 'music/t001.mp3', title: '别的歌', album: 'A', duration: 1 },
      { file: 'music/t002.mp3', title: '生命流', album: '明日方舟OST1', duration: 196 },
    ];
    const storage = makeStorage();
    storage.setItem('airnight.music.v1', JSON.stringify({ current: 0, playing: false, volume: 0.5 }));

    const player = createMusicPlayer({
      audio: new FakeAudio() as unknown as HTMLAudioElement,
      base: './',
      storage,
      gestureTarget: new EventTarget(),
      defaultTrack: '生命流',
      fetchImpl: (async () => ({ ok: true, status: 200, json: async () => ({ tracks }) })) as unknown as typeof fetch,
    });
    await player.load();
    expect(player.getSnapshot().current).toBe(0);
  });
});

describe('播放器：播放控制', () => {
  it('play() 会真的调用 audio.play() 并进入播放态', async () => {
    const { player, audio } = makePlayer();
    await player.load();
    player.play();
    await Promise.resolve();
    expect(audio.playCalls).toBe(1);
    expect(player.getSnapshot().playing).toBe(true);
  });

  it('toggle() 在播放中变成暂停，再点回来继续', async () => {
    const { player, audio } = makePlayer();
    await player.load();
    player.play();
    await Promise.resolve();
    player.toggle();
    expect(audio.paused).toBe(true);
    expect(player.getSnapshot().playing).toBe(false);
    player.toggle();
    await Promise.resolve();
    expect(audio.paused).toBe(false);
  });

  it('选曲 / 下一首 / 上一首会换 src', async () => {
    const { player, audio } = makePlayer();
    await player.load();
    player.select(2);
    await Promise.resolve();
    expect(audio.src).toBe('./music/t003.mp3');

    player.next();
    await Promise.resolve();
    expect(audio.src).toBe('./music/t001.mp3'); // 列表循环回到第一首

    player.prev();
    await Promise.resolve();
    expect(audio.src).toBe('./music/t003.mp3');
  });

  it('★ 单曲循环：自动播完停在原曲（把进度拨回 0），手动下一首才换歌', async () => {
    const { player, audio } = makePlayer();
    await player.load();
    player.select(1);
    player.cycleRepeat(); // all -> one
    expect(player.getSnapshot().repeat).toBe('one');

    audio.currentTime = 199;
    player.next(); // 手动：必须换歌
    await Promise.resolve();
    expect(audio.src).toBe('./music/t003.mp3');

    player.select(1);
    audio.currentTime = 199;
    audio.finish(); // 自动播完
    await Promise.resolve();
    expect(audio.src).toBe('./music/t002.mp3');
    expect(audio.currentTime).toBe(0);
    expect(player.getSnapshot().playing).toBe(true);
  });

  it('不循环时最后一首播完就停下来（playing=false）', async () => {
    const { player, audio } = makePlayer();
    await player.load();
    player.select(2);
    player.cycleRepeat(); // all -> one
    player.cycleRepeat(); // one -> off
    expect(player.getSnapshot().repeat).toBe('off');

    audio.finish();
    await Promise.resolve();
    expect(player.getSnapshot().playing).toBe(false);
  });

  it('★ play() 的回调比「播完」晚落地时，不能把 playing 又翻回 true', async () => {
    // 这个竞态是真的会发生的：audio.play() 返回 Promise，
    // 如果挂着的那个回调在"歌已经播完停下"之后才 resolve，
    // 天真写法会把状态改回"正在播放" —— 表现就是按钮亮着但没声音。
    const { player, audio } = makePlayer();
    await player.load();
    player.select(2);
    player.cycleRepeat(); // all -> one
    player.cycleRepeat(); // one -> off

    let releasePlay: () => void = () => {};
    audio.play = () => {
      audio.playCalls++;
      return new Promise<void>((resolve) => {
        releasePlay = resolve;
      });
    };

    player.select(2); // 这一次 play() 悬在半空
    audio.finish(); // 播完 → 到列表尽头 → 停下
    await Promise.resolve();
    expect(player.getSnapshot().playing).toBe(false);

    releasePlay(); // 迟到的成功回调
    await Promise.resolve();
    await Promise.resolve();
    expect(player.getSnapshot().playing).toBe(false);
  });

  it('随机播放不会一直停在原地（多次下一首覆盖到全部曲目）', async () => {
    const { player } = makePlayer({ tracks: TRACKS });
    await player.load();
    player.toggleShuffle();
    expect(player.getSnapshot().shuffle).toBe(true);
    const visited = new Set<number>();
    for (let i = 0; i < 30; i++) {
      visited.add(player.getSnapshot().current);
      player.next();
    }
    expect(visited.size).toBe(TRACKS.length);
  });

  it('音量与静音：音量归零等价于静音，取消静音后音量回来', async () => {
    const { player, audio } = makePlayer();
    await player.load();
    player.setVolume(0);
    expect(audio.volume).toBe(0);
    player.toggleMute(); // 取消静音（vol 仍是 0 → 声音还是 0，但 muted 取反了）
    player.setVolume(0.8);
    expect(player.getSnapshot().muted).toBe(false);
    expect(audio.volume).toBeCloseTo(0.8);
    player.toggleMute();
    expect(audio.volume).toBe(0);
  });

  it('★ 随机与循环互斥：开随机自动关循环，开循环自动关随机', async () => {
    const { player } = makePlayer();
    await player.load();
    // 初始是列表循环 + 不随机
    expect(player.getSnapshot().repeat).toBe('all');
    expect(player.getSnapshot().shuffle).toBe(false);

    // 开随机 → 循环被关掉
    player.toggleShuffle();
    expect(player.getSnapshot().shuffle).toBe(true);
    expect(player.getSnapshot().repeat).toBe('off');

    // 开循环 → 随机被关掉
    player.cycleRepeat(); // off -> all
    expect(player.getSnapshot().repeat).toBe('all');
    expect(player.getSnapshot().shuffle).toBe(false);

    // 关掉循环不该把随机又打开（玩家没点它）
    player.cycleRepeat(); // all -> one
    player.cycleRepeat(); // one -> off
    expect(player.getSnapshot().repeat).toBe('off');
    expect(player.getSnapshot().shuffle).toBe(false);
  });

  it('★ 旧存档里"随机和循环同时开着"会被归一化（那时候还没这条规则）', async () => {
    const storage = makeStorage();
    storage.setItem(
      'airnight.music.v1',
      JSON.stringify({ shuffle: true, repeat: 'all', volume: 0.5, current: 1, playing: false }),
    );
    const player = createMusicPlayer({
      audio: new FakeAudio() as unknown as HTMLAudioElement,
      base: './',
      storage,
      gestureTarget: new EventTarget(),
      fetchImpl: (async () => ({ ok: true, status: 200, json: async () => ({ tracks: TRACKS }) })) as unknown as typeof fetch,
    });
    await player.load();
    expect(player.getSnapshot().shuffle).toBe(true);
    expect(player.getSnapshot().repeat).toBe('off');
  });
});

describe('播放器：自动播放被拦与状态持久化', () => {
  it('★ 被浏览器拦下时标记 blocked，并在第一个用户手势后接着放', async () => {
    const { player, audio, gestureTarget } = makePlayer({ playBehaviour: 'reject' });
    await player.load();
    player.play();
    await Promise.resolve();
    await Promise.resolve();

    expect(player.getSnapshot().blocked).toBe(true);
    expect(player.getSnapshot().playing).toBe(false);

    // 玩家点了一下页面 —— 播放器应该自己续上
    audio.playBehaviour = 'ok';
    gestureTarget.dispatchEvent(new Event('pointerdown'));
    await Promise.resolve();
    await Promise.resolve();
    expect(player.getSnapshot().blocked).toBe(false);
    expect(player.getSnapshot().playing).toBe(true);
  });

  it('音量/随机/当前曲目会写进 storage，重开能读回来', async () => {
    const { player, storage } = makePlayer();
    await player.load();
    player.setVolume(0.25);
    player.toggleShuffle(); // 随机开着 → 循环必然是 off（两者互斥）
    player.select(2);
    await Promise.resolve();

    const saved = JSON.parse(storage.map.get('airnight.music.v1')!);
    expect(saved.volume).toBeCloseTo(0.25);
    expect(saved.shuffle).toBe(true);
    expect(saved.repeat).toBe('off');
    expect(saved.current).toBe(2);

    // 用同一份 storage 新建一个播放器 —— 设置应该还在
    const audio2 = new FakeAudio();
    const player2 = createMusicPlayer({
      audio: audio2 as unknown as HTMLAudioElement,
      base: './',
      storage,
      gestureTarget: new EventTarget(),
      fetchImpl: (async () => ({ ok: true, status: 200, json: async () => ({ tracks: TRACKS }) })) as unknown as typeof fetch,
    });
    await player2.load();
    const s2 = player2.getSnapshot();
    expect(s2.volume).toBeCloseTo(0.25);
    expect(s2.shuffle).toBe(true);
    expect(s2.repeat).toBe('off');
    expect(s2.current).toBe(2);
  });

  it('循环模式也会被记住（关掉随机之后单独测，两者不能同时存）', async () => {
    const { player, storage } = makePlayer();
    await player.load();
    player.cycleRepeat(); // all -> one
    expect(player.getSnapshot().repeat).toBe('one');
    await Promise.resolve();
    expect(JSON.parse(storage.map.get('airnight.music.v1')!).repeat).toBe('one');
  });

  it('dispose() 之后 audio 上不再有事件监听（不泄漏）', async () => {
    const { player, audio } = makePlayer();
    await player.load();
    player.dispose();
    // 摘掉监听之后，再触发事件也不该改动播放器状态
    audio.dispatch('play');
    audio.dispatch('pause');
    expect(player.getSnapshot().count).toBe(3);
  });
});

// ---------------------------------------------------------------- 真实素材

describe('真实曲目索引 tracks.json', () => {
  const musicDir = fileURLToPath(new URL('../public/music/', import.meta.url));
  const indexPath = `${musicDir}tracks.json`;
  const hasAssets = existsSync(indexPath);
  const index = hasAssets
    ? (JSON.parse(readFileSync(indexPath, 'utf8')) as { count: number; tracks: MusicTrack[] })
    : { count: 0, tracks: [] };

  it.skipIf(!hasAssets)('每条索引都指向一个真实存在的 mp3，且都在 music/ 目录下', () => {
    const missing = index.tracks.filter((t) => !existsSync(`${musicDir}${t.file.replace(/^music\//, '')}`));
    expect(missing.map((t) => t.file)).toEqual([]);
    expect(index.tracks.filter((t) => !t.file.startsWith('music/'))).toEqual([]);
  });

  it.skipIf(!hasAssets)('count 与 tracks 长度一致，且没有重复文件', () => {
    expect(index.count).toBe(index.tracks.length);
    expect(new Set(index.tracks.map((t) => t.file)).size).toBe(index.tracks.length);
  });

  it.skipIf(!hasAssets)('每首都解析出了时长（转码时从 ffmpeg 输出里读的）', () => {
    const zero = index.tracks.filter((t) => !t.duration).map((t) => t.file);
    expect(zero).toEqual([]);
  });

  it.skipIf(!hasAssets)('文件名是纯 ASCII（中文名进 URL 要转义，容易出编码问题）', () => {
    const bad = index.tracks.filter((t) => !/^music\/t\d{3}\.mp3$/.test(t.file)).map((t) => t.file);
    expect(bad).toEqual([]);
  });

  it.skipIf(!hasAssets)('★ 默认曲目《生命流》确实在索引里（改过曲名/重导过音乐就会在这里失败）', () => {
    expect(defaultTrackIndex(index.tracks, '生命流')).toBeGreaterThanOrEqual(0);
    const hit = index.tracks[defaultTrackIndex(index.tracks, '生命流')];
    expect(hit?.title).toBe('生命流');
  });
});
