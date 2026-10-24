/**
 * ★ 0.1.2：本机对局会话 —— 断线重连令牌的「机器级」存放点。
 *
 * ============================================================
 *  它解决什么？
 * ============================================================
 * 令牌原来存在 `sessionStorage` 里，是**标签页级**的：
 *   · 关掉标签页（甚至关掉整个浏览器）→ 令牌就没了 → 再也回不到对局；
 *   · 而"不小心关了浏览器"恰恰是最常见的掉线。
 *
 * 现在改由**本地进程**保管（`/__airnight/session`，见 `scripts/serve-static.mjs`）：
 *   · 关浏览器不丢 —— 重开还是同一个玩家，还在原来那一局；
 *   · 一台机器只有一份 —— 天然就是"一台机器一个玩家"。
 *
 * ============================================================
 *  占用（谁在玩）怎么算？
 * ============================================================
 * 进房的那个标签页会**认领**占用，并每 5 秒跳一次心跳；
 * 心跳停 20 秒就当成"人走了"（标签页/浏览器关了），别的标签页可以自动接管。
 * 占用还活着时，新开的标签页只会看到"本机正在对局中"，
 * 要不要**接管**由玩家自己点 —— 绝不默默把座位抢走。
 *
 * ============================================================
 *  接口够不着怎么办？
 * ============================================================
 * 如果页面不是由**自己**的进程提供的（例如走隧道、点房主发的链接进来），
 * `/__airnight/session` 会 404。这时退回老路子（`sessionStorage`），
 * 行为跟 0.1.1 完全一样：同一个浏览器内有效，关浏览器就丢。
 */

const ROUTE = '/__airnight/session';
/** 本标签页的随机 id（标签页级：刷新还在，新开标签页是新的） */
const TAB_KEY = 'airnight.tab';
/** 进程接口够不着时的退路（0.1.1 的老路径） */
const FALLBACK_KEY = 'airnight.resume';
/** 心跳间隔（毫秒） */
const HEARTBEAT_MS = 5000;
/** 单次请求超时：进程就在本机，超过这个时间基本说明它不在了 */
const REQUEST_TIMEOUT_MS = 1500;
/**
 * ★ 0.1.4：启动时那次探测的超时与重试次数。
 *
 * ============================================================
 *  【它修的 bug："重开浏览器有时既不弹接管提示、也不回座"】
 * ============================================================
 * 启动流程整个依赖 `initMachineSession()` 那**一次** GET：
 * 拿不到就 `available = false` + `session = null`
 * ⇒ 主界面既不弹浮层、也不自动回座，而且**一句话都不说**（玩家只会觉得"点了没反应"）。
 *
 * 而这一次 GET 恰好最容易被自己挤掉：页面刚加载时浏览器会并发去抓
 * `web/` 下那几百个素材（音乐、小人序列帧…），同一个进程还要同时伺候它们，
 * 1.5 秒的超时经常不够用 —— 于是表现为"有时候能回座、有时候完全没反应"。
 *
 * 所以启动这次探测放宽超时并**重试几次**（指数退避，总共最多 ~7 秒）。
 * 注意只放宽**启动这一次**：心跳和存取会话仍然用 1.5 秒，那几条是热路径不能拖。
 */
const BOOT_TIMEOUT_MS = 4000;
const BOOT_ATTEMPTS = 3;
const BOOT_RETRY_DELAY_MS = 600;

export interface MachineSession {
  /** 令牌绑定的服务器地址：换了服务器旧令牌没有意义 */
  serverUrl: string;
  /** 服务器发的重连凭据（只发本人） */
  token: string;
  /** 房间号（只是给界面显示用的，不参与判断） */
  roomCode: string;
}

interface StoredFallback {
  url: string;
  token: string;
}

/** 接口可用（页面确实由本机进程提供） */
let available = false;
let session: MachineSession | null = null;
let ownerTab = '';
let ownerAlive = false;
let myTab = '';
let heartbeatTimer = 0;
let takenOverHandler: (() => void) | null = null;

function safeSessionStorage(): Storage | null {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    // 隐私模式 / 被禁用
    return null;
  }
}

/** 本标签页的 id（懒生成，之后一直复用） */
function tabId(): string {
  if (myTab) return myTab;
  const store = safeSessionStorage();
  let id = '';
  try {
    id = store?.getItem(TAB_KEY) ?? '';
  } catch {
    id = '';
  }
  if (!id) {
    id = `${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
    try {
      store?.setItem(TAB_KEY, id);
    } catch {
      // 忽略
    }
  }
  myTab = id;
  return id;
}

function normalizeSession(raw: unknown): MachineSession | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  const token = typeof value.token === 'string' ? value.token : '';
  if (!token) return null;
  return {
    serverUrl: typeof value.serverUrl === 'string' ? value.serverUrl : '',
    token,
    roomCode: typeof value.roomCode === 'string' ? value.roomCode : '',
  };
}

/** 请求本机进程的会话接口；任何失败（404 / 超时 / 非 JSON）都返回 null */
async function request(method: string, body?: unknown): Promise<Record<string, unknown> | null> {
  if (typeof fetch !== 'function') return null;
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS) : 0;
  try {
    const response = await fetch(ROUTE, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller?.signal ?? undefined,
      cache: 'no-store',
    });
    if (!response.ok) return null;
    const parsed: unknown = await response.json();
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  } finally {
    if (timer) window.clearTimeout(timer);
  }
}

// ============================================================
// 退路：进程接口够不着时走 sessionStorage（0.1.1 的行为）
// ============================================================

function readFallback(url: string): string {
  try {
    const raw = safeSessionStorage()?.getItem(FALLBACK_KEY);
    if (!raw) return '';
    const parsed = JSON.parse(raw) as StoredFallback;
    return parsed.url === url && typeof parsed.token === 'string' ? parsed.token : '';
  } catch {
    return '';
  }
}

/**
 * ★ 0.1.4：把 `sessionStorage` 里那份退路**当成一个会话**读出来。
 *
 * 【为什么需要它？】
 * 接口够不着（走隧道点房主链接）以及"启动那次探测最终也没问到"这两种情况下，
 * 以前 `session` 直接是 null ⇒ 主界面连"本机可能有一局没打完"都不知道，
 * 那颗「回到对局」按钮不会出现、断线重连恢复也无从谈起。
 * 而 `sessionStorage` 里其实还躺着 `{url, token}` —— 同一个浏览器会话内它一直都在，
 * 足够用来发起一次 resume。房间号退路里没存，留空即可（它只供界面显示）。
 */
function readFallbackSession(): MachineSession | null {
  try {
    const raw = safeSessionStorage()?.getItem(FALLBACK_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredFallback;
    if (!parsed || typeof parsed.token !== 'string' || !parsed.token) return null;
    return {
      serverUrl: typeof parsed.url === 'string' ? parsed.url : '',
      token: parsed.token,
      roomCode: '',
    };
  } catch {
    return null;
  }
}

function writeFallback(next: MachineSession): void {
  try {
    safeSessionStorage()?.setItem(
      FALLBACK_KEY,
      JSON.stringify({ url: next.serverUrl, token: next.token } satisfies StoredFallback),
    );
  } catch {
    // 忽略
  }
}

function clearFallback(): void {
  try {
    safeSessionStorage()?.removeItem(FALLBACK_KEY);
  } catch {
    // 忽略
  }
}

// ============================================================
// 对外接口
// ============================================================

/**
 * ★ 0.1.4：启动时的**探测**请求 —— 和 `request` 的区别是它分得清两种失败：
 *
 *   · `missing: true`  —— 接口本身不存在（404/405）。这是"页面不由本机进程提供"
 *      （走隧道、点房主发的链接进来）的正常情况，**重试没有意义**，直接退回退路；
 *   · `missing: false, data: null` —— 这次没问到（超时 / 网络抖 / 进程忙）。
 *     这种才值得重试 —— 也就是上面说的"被自己加载素材挤掉"的那种。
 *
 * 【为什么必须分开？】不分开的话，走隧道的人每次启动都要白等三次超时（十几秒），
 * 而本该重试的"进程忙"又只有一次机会。
 */
async function probeSession(
  timeoutMs: number,
): Promise<{ missing: boolean; data: Record<string, unknown> | null }> {
  if (typeof fetch !== 'function') return { missing: true, data: null };
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? window.setTimeout(() => controller.abort(), timeoutMs) : 0;
  try {
    const response = await fetch(ROUTE, {
      method: 'GET',
      signal: controller?.signal ?? undefined,
      cache: 'no-store',
    });
    if (response.status === 404 || response.status === 405) return { missing: true, data: null };
    if (!response.ok) return { missing: false, data: null };
    const parsed: unknown = await response.json();
    return {
      missing: false,
      data: parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null,
    };
  } catch {
    return { missing: false, data: null };
  } finally {
    if (timer) window.clearTimeout(timer);
  }
}

/** 把进程回的那份 `{session, owner, ownerAlive}` 落到模块状态（探测与刷新共用） */
function applySnapshot(result: Record<string, unknown>): void {
  session = normalizeSession(result['session']);
  ownerTab = typeof result['owner'] === 'string' ? result['owner'] : '';
  ownerAlive = result['ownerAlive'] === true;
}

/**
 * 启动时调用一次：探测接口、读回本机会话。
 * ★ 要在第一次 `net.connect()` **之前** await 完，否则读不到令牌。
 *
 * ★ 0.1.4：这里不再"一次拿不到就放弃"（见 BOOT_TIMEOUT_MS 的说明）。
 */
export async function initMachineSession(): Promise<void> {
  for (let attempt = 0; attempt < BOOT_ATTEMPTS; attempt++) {
    const { missing, data } = await probeSession(BOOT_TIMEOUT_MS);
    if (missing) {
      // 接口不存在：走隧道那类玩法，别再试了
      available = false;
      session = readFallbackSession();
      return;
    }
    if (data) {
      available = true;
      applySnapshot(data);
      return;
    }
    if (attempt < BOOT_ATTEMPTS - 1) {
      await new Promise<void>((resolve) => window.setTimeout(resolve, BOOT_RETRY_DELAY_MS));
    }
  }
  /*
    三次都没问到：**降级**而不是放弃 ——
    进程那张牌打不出来，至少把 sessionStorage 里那份读出来，
    让主界面还能显示「回到对局」、让「断线重连恢复」还有东西可以试。
  */
  available = false;
  session = readFallbackSession();
}

/** 本机进程的会话接口可用吗（不可用时一切退回 sessionStorage） */
export function machineSessionAvailable(): boolean {
  return available;
}

/**
 * 重新问一次进程"现在是什么状态"。
 * 界面在"点创建/加入房间之前"调它 —— 因为别的标签页可能刚刚退出，
 * 缓存下来的"本机忙"会过时。
 */
export async function refreshMachineSession(): Promise<void> {
  if (!available) return;
  const result = await request('GET');
  if (result === null) return;
  applySnapshot(result);
}

export function getMachineSession(): MachineSession | null {
  return session;
}

/**
 * 本机是否正被**别的标签页**占用着对局。
 * 界面用它决定：是自动重连回去，还是弹"本机正在对局中"。
 */
export function machineBusy(): boolean {
  return available && ownerAlive && ownerTab !== '' && ownerTab !== tabId();
}

/** 当前占用者是不是我自己 */
export function machineOwnerIsMe(): boolean {
  return available && ownerTab !== '' && ownerTab === tabId();
}

/**
 * 读本机令牌（`NetplayClient` 在连上之后用它决定发不发 `resume`）。
 * 进程接口可用时读机器级那份；不可用时退回 sessionStorage。
 */
export function readMachineToken(url: string): string {
  if (!available) return readFallback(url);
  return session && session.serverUrl === url ? session.token : '';
}

/** 存会话并**认领**占用（进房成功时调） */
export function saveMachineSession(next: MachineSession): void {
  session = { ...next };
  ownerTab = tabId();
  ownerAlive = true;
  if (!available) {
    writeFallback(next);
    return;
  }
  void request('POST', { tab: tabId(), session: next });
}

/**
 * 清掉会话（**主动**离开房间时调）。
 * ★ 如果占用已经被别人接管了，这里**不能**删 —— 那会把别人正在用的会话抹掉。
 */
export function clearMachineSession(): void {
  stopOwnershipHeartbeat();
  clearFallback();
  /*
    ★ 0.1.4：占用是**别人**的时候，一个字节都不许动 —— **包括内存里那份**。

    以前这里先写 `session = null` 再判断 `takenOver` 早退，于是"本机另一个标签页
    正在玩"时也会把内存里的会话抹掉：`getMachineSession()` 变 null、
    `net.canResume` 又是 false ⇒ 主界面那颗「回到对局」和加入房间页的
    「断线重连恢复」双双失效 —— 明明本机还有一局在跑，玩家却看不到任何入口。
    顺序反过来（先判断、再动状态）就没有这个问题。
  */
  const takenOver = available && ownerTab !== '' && ownerTab !== tabId();
  if (takenOver) return;
  session = null;
  ownerTab = '';
  ownerAlive = false;
  if (available) void request('POST', { clear: true });
}

/**
 * 接管：把占用抢过来（会话本身不动，别人那边会在下一次心跳发现）。
 * ★ 必须显式带 `claim` —— 只带 tab 那是**心跳**，进程不会让它抢别人的占用
 * （否则被接管的那一方下一次心跳就把自己认领回来了，两边永远互相抢）。
 */
export function claimMachineSession(): void {
  ownerTab = tabId();
  ownerAlive = true;
  if (available) void request('POST', { tab: tabId(), claim: true });
}

/**
 * 开始心跳（自己是对局的主持者时调）。
 * 一旦发现占用被换成别人，就调用 `onTakenOver`（界面据此退出对局并提示）。
 */
export function startOwnershipHeartbeat(onTakenOver: () => void): void {
  takenOverHandler = onTakenOver;
  if (!available) return;
  stopOwnershipHeartbeat();
  heartbeatTimer = window.setInterval(() => {
    void request('POST', { tab: tabId() }).then((result) => {
      if (!result) return; // 进程暂时没回应：不管它（网络层有自己的重连）
      if (typeof result.owner === 'string') {
        ownerTab = result.owner;
        ownerAlive = true;
      }
      if (ownerTab !== '' && ownerTab !== tabId()) {
        stopOwnershipHeartbeat();
        takenOverHandler?.();
      }
    });
  }, HEARTBEAT_MS);
}

export function stopOwnershipHeartbeat(): void {
  if (heartbeatTimer) {
    window.clearInterval(heartbeatTimer);
    heartbeatTimer = 0;
  }
}

/** 仅供测试：把模块状态复位 */
export function __resetMachineSessionForTest(): void {
  available = false;
  session = null;
  ownerTab = '';
  ownerAlive = false;
  myTab = '';
  stopOwnershipHeartbeat();
  takenOverHandler = null;
}
