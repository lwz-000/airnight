/**
 * ============================================================
 *  ★★ 0.3.3：「我在这局有座位」的小索引（按 **服务器地址 + 房间号**）
 * ============================================================
 *
 * 【它解决什么？】
 * 用户口径："掉了线也可以进已开局的房间"。
 * 技术上这条早就通了（`resume` 令牌换座位，对局宽限期 5 分钟），
 * 真正缺的是**入口**：掉了线的人回到主界面，只能靠"断线重连恢复"那颗按钮
 * —— 而那颗按钮认的是**本机最后一次**的会话（`machine-session.ts` 是单槽的：
 * `session.serverUrl === url` 才算数）。于是：
 *   · 你去朋友 A 家玩过，又去朋友 B 家玩过，A 家那一局的凭据被覆盖了；
 *   · 局域网房间列表里明明看得见 A 家那间"进行中 · 第 7 回合"，
 *     但你手上没有凭据，只能干看着。
 *
 * 所以这里单独维护一张**小表**（最多 5 条）：`地址 + 房间号 → 令牌`。
 * 它只服务于"房间里还有我的座位吗"这一个判断，**不碰** `machine-session` 那套
 * "一台机器只能算一个玩家"的占用逻辑（那是另一件事，改它会把接管/互踢搞乱）。
 *
 * 【为什么不干脆把 machine-session 改成多槽？】
 * 因为那个单槽是有意义的：它表达的是"**本机现在正在玩的是哪一局**"
 * （另一个标签页要据此知道"这台机器已经被占用"）。多槽化会让它失去这个含义。
 * 而"我曾经在哪几局里"是另一个问题，答案本来就该是多个。
 */

const STORAGE_KEY = 'airnight.resume.index.v1';

/** 最多记几条。5 条足够覆盖"今晚换了几个朋友家"，再多就是无意义的隐私负担 */
export const RESUME_INDEX_MAX = 5;

/**
 * 超过这个岁数的记录直接丢掉（12 小时）。
 * 服务器一重启令牌就全作废了（会话表在内存里），留太久只会让人点了报 `BAD_TOKEN`。
 */
const MAX_AGE_MS = 12 * 60 * 60 * 1000;

export interface ResumeTarget {
  /** 服务器地址，形如 `ws://192.168.1.5:8787`（和 `net.url` 同一口径） */
  url: string;
  /** 房间号（大写） */
  code: string;
  /** 重连令牌（`welcome` 里下发的那个） */
  token: string;
  /** 记下来的时刻（用于淘汰最旧的） */
  at: number;
}

/** 地址归一化：末尾斜杠、大小写（`ws://` 里主机名不分大小写）都抹平 */
function normalizeUrl(url: string): string {
  return url.trim().replace(/\/+$/, '').toLowerCase();
}

function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}

function readAll(): ResumeTarget[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const now = Date.now();
    const out: ResumeTarget[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue;
      const entry = item as Partial<ResumeTarget>;
      if (typeof entry.url !== 'string' || !entry.url) continue;
      if (typeof entry.code !== 'string' || !entry.code) continue;
      if (typeof entry.token !== 'string' || !entry.token) continue;
      const at = Number(entry.at);
      if (!Number.isFinite(at) || now - at > MAX_AGE_MS) continue;
      out.push({ url: normalizeUrl(entry.url), code: normalizeCode(entry.code), token: entry.token, at });
    }
    return out;
  } catch {
    // 隐私模式 / 存储被清 —— 没有索引就只是少了"回到对局"的入口，不影响任何别的功能
    return [];
  }
}

function writeAll(list: ResumeTarget[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, RESUME_INDEX_MAX)));
  } catch {
    /* 写不进去就算了 */
  }
}

/**
 * 记下"我在这台服务器的这个房间里有一局"。
 *
 * ★ 同一个 `地址 + 房间号` 再来一次就**原地更新**（换令牌 / 刷新时间），
 *   而不是新插一条 —— 否则一个晚上反复重连会把 5 个位置全占满，
 *   真·换了两台机器就记不住了。
 */
export function rememberResumeTarget(input: { url: string; code: string; token: string }): void {
  if (!input.url || !input.code || !input.token) return;
  const url = normalizeUrl(input.url);
  const code = normalizeCode(input.code);
  const rest = readAll().filter((entry) => !(entry.url === url && entry.code === code));
  // 最近的排前面（读的时候直接取第一条就行）
  writeAll([{ url, code, token: input.token, at: Date.now() }, ...rest]);
}

/** 查某个房间的令牌；没有（或已过期）返回空串 */
export function findResumeTarget(url: string, code: string): string {
  const wantedUrl = normalizeUrl(url);
  const wantedCode = normalizeCode(code);
  return (
    readAll().find((entry) => entry.url === wantedUrl && entry.code === wantedCode)?.token ?? ''
  );
}

/** 令牌被服务器判无效时把它删掉（留着只会让玩家反复点、反复失败） */
export function forgetResumeTarget(url: string, code: string): void {
  const wantedUrl = normalizeUrl(url);
  const wantedCode = normalizeCode(code);
  const rest = readAll().filter((entry) => !(entry.url === wantedUrl && entry.code === wantedCode));
  writeAll(rest);
}

/** 所有还记着的目标（调试 / 测试用；界面不直接读它） */
export function resumeTargets(): ResumeTarget[] {
  return readAll();
}
