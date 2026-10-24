/**
 * ============================================================
 *  背景音乐播放器
 * ============================================================
 *
 * 【为什么单独一个模块，而不是塞进 main.ts？】
 * main.ts 已经 4000 多行了。而且"下一首该放哪个"是**纯逻辑** ——
 * 只要能把它和 DOM / Audio 元素分开，就可以用普通单元测试钉死
 * （单曲循环、列表循环、不循环、随机播放的边界情况特别多，
 * 靠手动点是点不全的）。
 *
 * 所以这个文件只做两件事：
 *   1. 纯函数：`shuffledOrder` / `stepIndex` / `formatTime` —— 可单测
 *   2. `createMusicPlayer()`：把这些逻辑接到一个 <audio> 上，
 *      并用 `subscribe` 把状态变化推给 UI（UI 在 main.ts 里搭）
 *
 * 【音乐从哪来？】
 * `apps/web/public/music/` —— 由 `scripts/import-music.mjs` 生成：
 *   t001.mp3 … tNNN.mp3   音频本体
 *   tracks.json           曲目索引（曲名 / 专辑 / 时长 / 文件）
 * public/ 会被 vite 原样拷进 dist/，所以**发给朋友时音乐是跟着走的**，
 * 对方不需要额外装任何东西。
 */

/** 一首曲子。字段来自 tracks.json */
export interface MusicTrack {
  /** 相对站点根目录的路径，例如 'music/t001.mp3' */
  file: string;
  title: string;
  /** 专辑名（源目录的第一层目录名）；没有就是空串 */
  album: string;
  /** 秒；解析不到时是 0 */
  duration: number;
}

/** 循环模式：不循环 / 列表循环 / 单曲循环 */
export type RepeatMode = 'off' | 'all' | 'one';

/** 播放器对外暴露的状态快照 —— UI 完全按它来画 */
export interface MusicSnapshot {
  tracks: MusicTrack[];
  /** 当前曲目下标；-1 = 一首都没在放 */
  current: number;
  playing: boolean;
  shuffle: boolean;
  repeat: RepeatMode;
  /** 0~1 */
  volume: number;
  muted: boolean;
  /**
   * 浏览器把自动播放拦下来了（还没等到用户手势）。
   * UI 应该显示"点一下开始播放"，而不是假装在放。
   */
  blocked: boolean;
  /** 索引还在加载 */
  loading: boolean;
  /** 加载失败的原因；null = 正常。'这次构建没有带音乐' 也是走这里 */
  error: string | null;
  /** 有几首曲子（UI 可以据此决定要不要显示整个面板） */
  count: number;
}

const STORAGE_KEY = 'airnight.music.v1';

interface Persisted {
  volume: number;
  muted: boolean;
  shuffle: boolean;
  repeat: RepeatMode;
  /** 上次在放的曲目下标 —— 重开游戏能接着放 */
  current: number;
  playing: boolean;
}

const DEFAULTS: Persisted = {
  /*
    ★ 0.3.3：默认音量 60% → **5%**（用户口径）。
    背景音乐是"陪着玩"的，不该盖住战斗音效和提示；想听大自己拖音量条，
    拖过一次就记在 localStorage 里，下次不会再被这条默认值盖回去。
  */
  volume: 0.05,
  muted: false,
  shuffle: false,
  repeat: 'all',
  current: -1,
  /**
   * 默认就"想放着"。
   *
   * 浏览器不允许没有用户手势就出声，所以这里不是真的自动播放 ——
   * 播放器会在**玩家的第一次点击/按键**时接着放（见 armGesture）。
   * 效果就是"进游戏点一下就有音乐"，而且不会违反自动播放策略。
   */
  playing: true,
};

// ================================================================
//  纯逻辑（这部分不带任何 DOM / Audio 依赖）
// ================================================================

/**
 * 生成随机播放顺序（Fisher–Yates）。
 *
 * `rng` 可注入：测试里传一个固定序列就能得到确定的顺序，
 * 生产环境用 Math.random。
 */
export function shuffledOrder(count: number, rng: () => number = Math.random): number[] {
  const order = Array.from({ length: Math.max(0, count) }, (_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const a = order[i]!;
    order[i] = order[j]!;
    order[j] = a;
  }
  return order;
}

export interface StepOptions {
  /** 随机播放用的顺序表（长度等于曲目数才有效） */
  order: number[];
  shuffle: boolean;
  repeat: RepeatMode;
  /**
   * 是不是"自动播完换下一首"。
   * 手动点「下一首」时，即使开着单曲循环也要真的换歌 ——
   * 否则按了没反应，玩家会以为按钮坏了。
   */
  auto: boolean;
}

/**
 * 算下一首 / 上一首的下标。
 *
 * 返回 `null` = 该停下来了（不循环 + 已经到列表尽头）。
 * 这是整个播放器最容易写错的地方，所以单独抽出来测。
 */
export function stepIndex(
  current: number,
  dir: 1 | -1,
  count: number,
  opts: StepOptions,
): number | null {
  if (count <= 0) return null;
  if (current < 0) return 0;

  // 自动播完 + 单曲循环 → 还是这一首（不是"跳走"，要重头再放）
  if (opts.auto && dir === 1 && opts.repeat === 'one') return current;

  if (opts.shuffle && opts.order.length === count) {
    const pos = opts.order.indexOf(current);
    if (pos < 0) return opts.order[0] ?? 0;
    const nextPos = pos + dir;
    if (nextPos < 0) return opts.repeat === 'off' ? null : (opts.order[count - 1] ?? 0);
    if (nextPos >= count) return opts.repeat === 'off' ? null : (opts.order[0] ?? 0);
    return opts.order[nextPos] ?? 0;
  }

  const next = current + dir;
  if (next < 0) return opts.repeat === 'off' ? null : count - 1;
  if (next >= count) return opts.repeat === 'off' ? null : 0;
  return next;
}

/** 秒 → `m:ss`（超过一小时显示 `h:mm:ss`） */
export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * 把 `music/t001.mp3` 拼成能直接喂给 `<audio src>` 的地址。
 *
 * `base` 取 `import.meta.env.BASE_URL`（本项目是 './'，见 vite.config.ts 的 base），
 * 这样打包产物放在根目录或子目录都能正确找到音乐。
 */
export function trackUrl(base: string, file: string): string {
  if (!file) return '';
  const prefix = base.endsWith('/') ? base : `${base}/`;
  return `${prefix}${file}`;
}

/** repeat 的三档轮换：不循环 → 列表循环 → 单曲循环 → 不循环 */
export function nextRepeatMode(mode: RepeatMode): RepeatMode {
  return mode === 'off' ? 'all' : mode === 'all' ? 'one' : 'off';
}

/**
 * 首选曲目的下标。
 *
 * 第一次进游戏（还没存过任何偏好）时放哪一首。
 * 现在是《生命流》（明日方舟 OST1）—— 想换的话改 main.ts 里传的
 * `defaultTrack`，**不要去改索引文件**（那是脚本生成的，下次导入就没了）。
 *
 * 匹配顺序：曲名完全相同 → 曲名/专辑包含 → 退回第 0 首。
 * 用"包含"兜底是因为曲名里可能带空格或副标题，写死容易对不上。
 */
export function defaultTrackIndex(tracks: MusicTrack[], wanted: string | undefined): number {
  if (tracks.length === 0) return -1;
  if (wanted) {
    const exact = tracks.findIndex((t) => t.title === wanted);
    if (exact >= 0) return exact;
    const loose = tracks.findIndex((t) => t.title.includes(wanted) || t.album.includes(wanted));
    if (loose >= 0) return loose;
  }
  return 0;
}

export const REPEAT_LABEL: Record<RepeatMode, string> = {
  off: '不循环',
  all: '列表循环',
  one: '单曲循环',
};

// ================================================================
//  播放器
// ================================================================

export interface MusicPlayerOptions {
  audio: HTMLAudioElement;
  /** 站点基址，一般是 import.meta.env.BASE_URL */
  base: string;
  /** 索引文件（相对站点根），默认 music/tracks.json */
  indexFile?: string;
  /**
   * 第一次进游戏（还没有任何本地记录）时默认放哪一首。
   * 传曲名即可，例如 '生命流'。找不到就退回第 0 首。
   */
  defaultTrack?: string;
  /** 可注入的存储，便于测试；默认 localStorage，传 null 表示不持久化 */
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
  fetchImpl?: typeof fetch;
  rng?: () => number;
  /** 自动播放被拦时用来"等一个用户手势"的宿主，默认 document */
  gestureTarget?: EventTarget;
}

export interface MusicPlayer {
  getSnapshot(): MusicSnapshot;
  subscribe(listener: (snapshot: MusicSnapshot) => void): () => void;
  /** 拉取 tracks.json；启动时调一次 */
  load(): Promise<void>;
  play(index?: number): void;
  pause(): void;
  toggle(): void;
  next(): void;
  prev(): void;
  /** 手动选曲（下拉框） */
  select(index: number): void;
  setShuffle(on: boolean): void;
  toggleShuffle(): void;
  cycleRepeat(): void;
  setVolume(value: number): void;
  toggleMute(): void;
  /** 把 <audio> 上挂的事件全部摘掉 */
  dispose(): void;
}

function readPersisted(storage: MusicPlayerOptions['storage']): Persisted {
  if (!storage) return { ...DEFAULTS };
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const p = JSON.parse(raw) as Partial<Persisted>;
    const shuffle = !!p.shuffle;
    const repeat = p.repeat === 'off' || p.repeat === 'all' || p.repeat === 'one' ? p.repeat : DEFAULTS.repeat;
    return {
      volume: typeof p.volume === 'number' ? Math.min(1, Math.max(0, p.volume)) : DEFAULTS.volume,
      muted: !!p.muted,
      shuffle,
      // 随机与循环互斥：旧存档里可能两个都开着（那时候还没这条规则），读回来时归一化
      repeat: shuffle ? 'off' : repeat,
      current: typeof p.current === 'number' ? p.current : DEFAULTS.current,
      playing: !!p.playing,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function createMusicPlayer(options: MusicPlayerOptions): MusicPlayer {
  const audioEl = options.audio;
  const base = options.base;
  const indexFile = options.indexFile ?? 'music/tracks.json';
  const storage =
    options.storage === undefined ? ((globalThis as { localStorage?: Storage }).localStorage ?? null) : options.storage;
  const doFetch = options.fetchImpl ?? globalThis.fetch?.bind(globalThis);
  const rng = options.rng ?? Math.random;
  const gestureTarget = options.gestureTarget ?? globalThis.document;

  const saved = readPersisted(storage);

  let tracks: MusicTrack[] = [];
  let current = -1;
  let playing = false;
  let shuffle = saved.shuffle;
  let repeat = saved.repeat;
  let volume = saved.volume;
  let muted = saved.muted;
  let blocked = false;
  let loading = true;
  let error: string | null = null;
  let order: number[] = [];

  const listeners = new Set<(s: MusicSnapshot) => void>();

  function snapshot(): MusicSnapshot {
    return {
      tracks,
      current,
      playing,
      shuffle,
      repeat,
      volume,
      muted,
      blocked,
      loading,
      error,
      count: tracks.length,
    };
  }

  function emit(): void {
    const s = snapshot();
    for (const listener of listeners) listener(s);
  }

  function persist(): void {
    if (!storage) return;
    try {
      const payload: Persisted = { volume, muted, shuffle, repeat, current, playing };
      storage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      /* 存不了不影响播放 */
    }
  }

  const absoluteHref = (url: string): string => {
    try {
      return new URL(url, globalThis.location?.href ?? 'http://localhost/').href;
    } catch {
      return url;
    }
  };

  // ---- 自动播放策略：没有用户手势之前 play() 一定被拒 ----

  /**
   * ★ 每次"想播放"都领一个序号。
   *
   * 为什么需要？`audio.play()` 返回的是 Promise，它的回调是**异步**的。
   * 如果这期间状态又变了（这一首刚好播完、或者玩家按了暂停），
   * 晚到的成功回调会把 `playing` 又翻回 true ——
   * 表现就是"歌已经停了，按钮还显示在播放"。
   * 拿到序号对不上就直接丢弃这个回调。
   */
  let playSeq = 0;

  /** 让所有还没落地的 play() 回调作废 */
  function invalidatePendingPlay(): void {
    playSeq++;
  }

  let gestureHandler: (() => void) | null = null;

  function disarmGesture(): void {
    if (!gestureHandler || !gestureTarget) return;
    gestureTarget.removeEventListener('pointerdown', gestureHandler, { capture: true });
    gestureTarget.removeEventListener('keydown', gestureHandler, { capture: true });
    gestureHandler = null;
  }

  function armGesture(): void {
    if (gestureHandler || !gestureTarget) return;
    const handler = (): void => {
      audioEl.volume = muted ? 0 : volume;
      const seq = playSeq;
      void Promise.resolve(audioEl.play()).then(
        () => {
          if (seq !== playSeq) return;
          blocked = false;
          playing = true;
          persist();
          emit();
          disarmGesture();
        },
        () => {
          if (seq !== playSeq) return;
          /* 还是不行就等下一次手势 */
        },
      );
    };
    gestureHandler = handler;
    gestureTarget.addEventListener('pointerdown', handler, { once: true, capture: true });
    gestureTarget.addEventListener('keydown', handler, { once: true, capture: true });
  }

  /**
   * 把 <audio> 指向当前曲目。
   *
   * `restart` 用来处理"同一首歌要重头再放"（单曲循环、点同一首）：
   * 这时 src 没变，直接赋值浏览器未必会重载，所以显式把进度拨回 0。
   */
  function applyCurrent(autoplay: boolean, restart = false): void {
    const track = tracks[current];
    const url = trackUrl(base, track?.file ?? '');
    if (!url) return;

    if (audioEl.src !== absoluteHref(url)) {
      audioEl.src = url;
    } else if (restart) {
      audioEl.currentTime = 0;
    }
    audioEl.volume = muted ? 0 : volume;
    if (!autoplay) return;

    const seq = ++playSeq;
    void Promise.resolve(audioEl.play()).then(
      () => {
        if (seq !== playSeq) return; // 这期间状态变了，忽略
        blocked = false;
        playing = true;
        persist();
        emit();
        disarmGesture();
      },
      () => {
        if (seq !== playSeq) return;
        // 被自动播放策略拦了 —— 记住这件事，等第一个用户手势
        blocked = true;
        playing = false;
        emit();
        armGesture();
      },
    );
  }

  function start(index: number): void {
    if (tracks.length === 0) return;
    current = Math.min(Math.max(index, 0), tracks.length - 1);
    playing = true;
    applyCurrent(true, true);
    emit();
  }

  /**
   * 暂停。
   *
   * 除了调 `audio.pause()`，这里还**自己把 playing 置 false 并广播** ——
   * 不能只等 <audio> 的 `pause` 事件回写状态：那个事件是异步的，
   * 而且某些环境下（比如 jsdom、或元素还没真正开始加载）
   * 压根不会触发，结果是"声音停了但按钮还显示在播放"。
   * 事件回调里再设一次同样的值是无害的。
   */
  function doPause(): void {
    invalidatePendingPlay();
    audioEl.pause();
    if (playing) {
      playing = false;
      persist();
      emit();
    }
  }

  const onEnded = (): void => {
    const nextIdx = stepIndex(current, 1, tracks.length, { order, shuffle, repeat, auto: true });
    if (nextIdx === null) {
      // 到尽头了 —— 顺便作废可能还挂着的 play() 回调，
      // 否则它晚一步 resolve 会把 playing 又翻回 true（"停了但按钮还亮着"）
      invalidatePendingPlay();
      playing = false;
      persist();
      emit();
      return;
    }
    // 先算出"是不是同一首"再改 current —— 单曲循环时 nextIdx 等于 current，
    // 这时 src 没变，必须显式把进度拨回 0，否则播完就停住了
    const sameTrack = nextIdx === current;
    current = nextIdx;
    applyCurrent(true, sameTrack);
    persist();
    emit();
  };
  const onPlay = (): void => {
    playing = true;
    blocked = false;
    persist();
    emit();
  };
  const onPause = (): void => {
    playing = false;
    persist();
    emit();
  };
  const onError = (): void => {
    // 单首坏掉不该让播放器卡死 —— 直接跳下一首
    if (tracks.length > 1) onEnded();
  };

  audioEl.addEventListener('ended', onEnded);
  audioEl.addEventListener('play', onPlay);
  audioEl.addEventListener('pause', onPause);
  audioEl.addEventListener('error', onError);

  // 先把音量/静音同步到 audio 元素（<audio> 自己不会读 localStorage）
  audioEl.volume = muted ? 0 : volume;

  return {
    getSnapshot: snapshot,

    subscribe(listener) {
      listeners.add(listener);
      listener(snapshot());
      return () => {
        listeners.delete(listener);
      };
    },

    async load() {
      loading = true;
      error = null;
      emit();
      try {
        if (!doFetch) throw new Error('当前环境没有 fetch');
        const response = await doFetch(trackUrl(base, indexFile));
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = (await response.json()) as { tracks?: MusicTrack[] };
        tracks = Array.isArray(payload.tracks) ? payload.tracks.filter((t) => t && t.file) : [];
        order = shuffledOrder(tracks.length, rng);
        loading = false;

        if (tracks.length === 0) {
          error = '没有曲目';
          emit();
          return;
        }
        if (current < 0 || current >= tracks.length) {
          // 存过就沿用玩家上次听的那首；没存过才用默认曲目（《生命流》）
          const remembered = saved.current >= 0 && saved.current < tracks.length;
          current = remembered ? saved.current : defaultTrackIndex(tracks, options.defaultTrack);
        }
        // 这里**不**自动开声：自动播放大概率会被浏览器拦，
        // 交给 armGesture 在第一个手势时接着放（上次在放的话）
        applyCurrent(false);
        persist();
        emit();
        if (saved.playing) armGesture();
      } catch (err) {
        loading = false;
        tracks = [];
        error = err instanceof Error ? err.message : String(err);
        emit();
      }
    },

    play(index) {
      start(index ?? (current < 0 ? 0 : current));
    },

    pause() {
      doPause();
    },

    toggle() {
      if (playing) {
        doPause();
        return;
      }
      if (current < 0) start(0);
      else applyCurrent(true);
    },

    next() {
      const idx = stepIndex(current, 1, tracks.length, { order, shuffle, repeat, auto: false });
      if (idx === null) {
        doPause();
        return;
      }
      start(idx);
    },

    prev() {
      const idx = stepIndex(current, -1, tracks.length, { order, shuffle, repeat, auto: false });
      if (idx === null) return;
      start(idx);
    },

    select(index) {
      start(index);
    },

    setShuffle(on) {
      shuffle = on;
      /*
        ★ 随机和循环互斥（你要求的："循环播放不能和随机同时打开"）。

        打开随机就把循环关掉 —— 两个按钮代表"接下来放哪一首"的两种策略，
        同时亮着会让人分不清到底是按乱序走还是按顺序循环。
        （如果不关循环，随机 + 列表循环 = 打乱后无限放，
         界面上两个都亮，玩家没法一眼看出当前是哪种。）
      */
      if (on) repeat = 'off';
      // 重新打乱，让"刚打开随机"立刻生效
      order = shuffledOrder(tracks.length, rng);
      persist();
      emit();
    },

    toggleShuffle() {
      this.setShuffle(!shuffle);
    },

    cycleRepeat() {
      repeat = nextRepeatMode(repeat);
      // 反过来也一样：只要循环不是"不循环"，随机就必须关掉
      if (repeat !== 'off') shuffle = false;
      persist();
      emit();
    },

    setVolume(value) {
      volume = Math.min(1, Math.max(0, value));
      if (volume > 0) muted = false;
      audioEl.volume = muted ? 0 : volume;
      persist();
      emit();
    },

    toggleMute() {
      muted = !muted;
      audioEl.volume = muted ? 0 : volume;
      persist();
      emit();
    },

    dispose() {
      audioEl.removeEventListener('ended', onEnded);
      audioEl.removeEventListener('play', onPlay);
      audioEl.removeEventListener('pause', onPause);
      audioEl.removeEventListener('error', onError);
      disarmGesture();
      listeners.clear();
    },
  };
}
