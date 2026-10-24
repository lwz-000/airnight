#!/usr/bin/env node
/**
 * ============================================================
 *  抓官方「个人头像」（玩家头像）并生成前端用的清单
 * ============================================================
 *
 * 【素材来源】`fexli/ArknightsResource` 的 `avatar/DEFAULT/`（社区维护的官方资源镜像，
 * 和 chibi / 立绘 / 藏品图标同一个仓库）。命名规则与 PRTS「个人头像一览」一致：
 *   avatar_def_NN        默认头像（15）
 *   avatar_dyn_XXX       动态头像（8）
 *   avatar_special_XXX   特殊获取（~89）
 *   avatar_activity_XXX  活动头像（~69，按活动代号）
 *
 * 【为什么要给前端生成一个 TS 清单？】
 * 头像墙要在**同步渲染**里画出 200 多个格子。如果改成运行时 `fetch('index.json')`，
 * 就得处理"还没加载完 / 加载失败"两种状态（主界面一闪而过的空墙很难看）。
 * 生成一份 `apps/web/src/player-avatars.ts` 之后，清单是**编译期常量**，
 * 和干员数据表一样随 bundle 走，零网络、零时序问题。
 *
 * 用法：
 *   node scripts/fetch-player-avatars.mjs            # 只补缺的
 *   node scripts/fetch-player-avatars.mjs --force    # 全部重下
 *   node scripts/fetch-player-avatars.mjs --list     # 只打印清单，不下载
 */
import { existsSync, mkdirSync, writeFileSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = 'fexli/ArknightsResource';
const REMOTE_DIR = 'avatar/DEFAULT';
const OUT_DIR = join(ROOT, 'apps/web/public/assets/player-avatars');
const TS_OUT = join(ROOT, 'apps/web/src/player-avatars.ts');

const FORCE = process.argv.includes('--force');
const LIST_ONLY = process.argv.includes('--list');

const RAW = `https://raw.githubusercontent.com/${REPO}/main`;
const JSDELIVR = `https://cdn.jsdelivr.net/gh/${REPO}@main`;
/** ★ 直连经常被挡（返回 000），这两层加速镜像实测能通 —— 和 fetch-chibi.ts 同一套 */
const GH_PROXIES = ['https://ghproxy.net/', 'https://gh-proxy.com/'];

/** 同一个文件的候选源：直连 → jsDelivr → 两个加速镜像 */
function sourcesOf(relPath) {
  const direct = `${RAW}/${relPath}`;
  return [direct, `${JSDELIVR}/${relPath}`, ...GH_PROXIES.map((proxy) => `${proxy}${direct}`)];
}

/**
 * 分类前缀 → 中文组名。
 * ★ 顺序就是界面上"分段按钮"的顺序：默认在最前（人人可用），活动最多放最后。
 */
const GROUPS = [
  { key: 'def', label: '默认', re: /^avatar_def_/ },
  { key: 'dyn', label: '动态', re: /^avatar_dyn_/ },
  { key: 'special', label: '纪念', re: /^avatar_special_/ },
  { key: 'activity', label: '活动', re: /^avatar_activity_/ },
];

function groupOf(fileName) {
  const hit = GROUPS.find((group) => group.re.test(fileName));
  return hit ? hit.key : 'other';
}

/** 显示名：`avatar_def_01` → `默认 01`（PRTS 上也只有编号，没有逐个起名） */
function labelOf(fileName) {
  const base = fileName.replace(/\.png$/i, '').replace(/^avatar_/, '');
  const group = GROUPS.find((item) => item.re.test(fileName));
  const tail = base.slice((group?.key.length ?? 0) + 1);
  return group ? `${group.label} ${tail}` : base;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJson(url) {
  const res = await fetch(url, { headers: { Accept: 'application/vnd.github+json' } });
  if (!res.ok) throw new Error(`列表请求失败 ${res.status} ${url}`);
  return res.json();
}

/** 下载一个文件（多源兜底），返回字节数 */
async function download(name) {
  const relPath = `${REMOTE_DIR}/${name}`;
  for (const url of sourcesOf(relPath)) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      // PNG 头校验：被镜像站塞一段 HTML 错误页时要能识别出来
      if (buf.length < 100 || buf[0] !== 0x89 || buf[1] !== 0x50) continue;
      writeFileSync(join(OUT_DIR, name), buf);
      return buf.length;
    } catch {
      // 换下一个源
    }
  }
  return 0;
}

const list = await fetchJson(`https://api.github.com/repos/${REPO}/contents/${REMOTE_DIR}?per_page=1000`);
const names = list
  .filter((entry) => entry.type === 'file' && /^avatar_.+\.png$/i.test(entry.name))
  .map((entry) => entry.name)
  .sort();

console.log(`远端 ${names.length} 张官方个人头像`);
if (LIST_ONLY) {
  for (const group of GROUPS) {
    const inGroup = names.filter((name) => groupOf(name) === group.key);
    console.log(`  ${group.label}：${inGroup.length}`);
  }
  process.exit(0);
}

mkdirSync(OUT_DIR, { recursive: true });

let downloaded = 0;
let skipped = 0;
const failed = [];
const CONCURRENCY = 6;
let cursor = 0;

async function worker() {
  while (cursor < names.length) {
    const name = names[cursor++];
    const target = join(OUT_DIR, name);
    if (!FORCE && existsSync(target) && statSync(target).size > 100) {
      skipped++;
      continue;
    }
    const size = await download(name);
    if (size > 0) {
      downloaded++;
      if (downloaded % 20 === 0) console.log(`  已下载 ${downloaded}…（最近 ${name}，${(size / 1024).toFixed(0)} KB）`);
    } else {
      failed.push(name);
    }
    await sleep(30);
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

const present = names.filter((name) => existsSync(join(OUT_DIR, name)));
console.log(`下载完成：新下 ${downloaded}、跳过 ${skipped}、失败 ${failed.length}`);
if (failed.length > 0) console.log('失败清单：', failed.join(', '));

/*
  生成前端清单。
  `id` 用 `pa:` 前缀 —— 和干员的 `opNN` 一眼能分开，服务端白名单也按这个前缀放行。
*/
const entries = present
  .map((fileName) => ({
    id: `pa:${fileName.replace(/\.png$/i, '')}`,
    file: fileName,
    label: labelOf(fileName),
    group: groupOf(fileName),
  }))
  .sort((a, b) => a.group.localeCompare(b.group) || a.file.localeCompare(b.file));

const groupCounts = Object.fromEntries(
  GROUPS.map((group) => [group.key, entries.filter((entry) => entry.group === group.key).length]),
);

const ts = `/**
 * ★★ 官方「个人头像」（玩家头像）清单 —— **由脚本生成，不要手改**。
 *
 * 生成：\`node scripts/fetch-player-avatars.mjs\`
 * 素材：\`public/assets/player-avatars/<file>\`（来源 fexli/ArknightsResource 的 avatar/DEFAULT）
 * 分类与命名和 PRTS「个人头像一览」一致：默认 / 动态 / 纪念（特殊获取）/ 活动。
 *
 * ★ 为什么是编译期常量而不是运行时拉 json？
 *   头像墙要同步画出两百多个格子，异步清单会带来"先空一下"的闪烁。
 */
export interface PlayerAvatar {
  /** 头像 id（\`pa:\` 前缀 + 文件名去后缀），存进 localStorage / 上报给服务器 */
  id: string;
  /** 文件名（\`assets/player-avatars/\` 下） */
  file: string;
  /** 显示名（PRTS 上也只有编号，所以是"默认 03 / 活动 OF / 纪念 91"这种） */
  label: string;
  /** 分组键，和 \`PLAYER_AVATAR_GROUPS\` 对得上 */
  group: string;
}

export const PLAYER_AVATAR_GROUPS = ${JSON.stringify(
  GROUPS.map((group) => ({ key: group.key, label: group.label, count: groupCounts[group.key] ?? 0 })),
  null,
 2)} as const;

export const PLAYER_AVATARS: readonly PlayerAvatar[] = ${JSON.stringify(entries, null, 2)};

/** 某个 id 是不是官方个人头像 */
export function isPlayerAvatarId(id: string | undefined | null): boolean {
  if (!id || !id.startsWith('pa:')) return false;
  return PLAYER_AVATARS.some((avatar) => avatar.id === id);
}

/** 按 id 取头像信息（找不到返回 undefined） */
export function playerAvatarOf(id: string | undefined | null): PlayerAvatar | undefined {
  if (!id) return undefined;
  return PLAYER_AVATARS.find((avatar) => avatar.id === id);
}
`;

writeFileSync(TS_OUT, ts, 'utf8');
console.log(`已生成 ${TS_OUT}（${entries.length} 条，分组：${JSON.stringify(groupCounts)}）`);
