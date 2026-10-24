/**
 * 从 prts.wiki 批量下载干员头像。
 *
 * 用法：
 *   node node_modules/tsx/dist/cli.mjs scripts/fetch-portraits.ts          # 先看匹配报告，不下载
 *   node node_modules/tsx/dist/cli.mjs scripts/fetch-portraits.ts --go     # 真的下载
 *   node node_modules/tsx/dist/cli.mjs scripts/fetch-portraits.ts --go --force  # 覆盖已有文件
 *
 * 【为什么头像文件叫「头像_XXX.png」？】
 * 这是 prts.wiki 的命名规则（MediaWiki 的 File 命名空间）。
 * 立绘是「立绘_XXX_1.png」，半身像是「半身像_XXX_1.png」，
 * 我们要的是方形头像，所以用「头像_」前缀。
 *
 * 【为什么要做模糊匹配？】
 * 因为表格里的名字不一定和 wiki 上的文件名完全一样
 * （例：表格写「克洛斯」，wiki 上是「克洛丝」）。
 * 脚本会：
 *   1. 先精确匹配
 *   2. 匹配不上就做模糊匹配（去掉皮肤后缀、去掉异格前缀）
 *   3. 还匹配不上就列出来让你确认 —— **不会瞎猜**
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { UNIT_DEFS } from '../packages/shared/src/index.js';

const API = 'https://prts.wiki/api.php';
const OUT_DIR = 'apps/web/public/assets/units';
/** 半身像放这里（棋盘上的立绘用它，比方形头像好看得多） */
const STAND_DIR = 'apps/web/public/assets/stand';
const UA = 'AIRNIGHT-local-fan-game/0.1 (personal use with friends, not published)';

const args = process.argv.slice(2);
const shouldDownload = args.includes('--go');
const force = args.includes('--force');
/**
 * 要下哪种图：
 *   avatar（默认）—— `头像_XXX.png`，180×180 方形，用于商店/备战席/信息窗口
 *   stand          —— `半身像_XXX_1.png`，180×360 竖长透明底，用于棋盘上的立绘
 *   both           —— 两个都下
 */
const kind = (args.find((a) => a.startsWith('--kind='))?.split('=')[1] ?? 'both') as
  | 'avatar'
  | 'stand'
  | 'both';

async function apiJson(params: Record<string, string>): Promise<any> {
  const url = `${API}?${new URLSearchParams({ format: 'json', ...params })}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (res.ok) return res.json();
    if (res.status === 429 || res.status >= 500) {
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
      continue;
    }
    throw new Error(`HTTP ${res.status}`);
  }
  throw new Error('重试三次都失败了');
}

/**
 * 拉取某一族的全部文件名（前缀 + 提取干员名的正则）。
 *
 * 【为什么一次拉全量，而不是逐个查询？】
 * 逐个查询要 50 次请求，而且"文件不存在"和"网络出错"很难区分。
 * 拉全量只要 2~3 次请求，还能顺便知道"wiki 上到底有哪些名字"，
 * 这样报告里可以直接告诉你"是不是拼错了"。
 */
async function listByPrefix(prefix: string, extract: RegExp): Promise<Map<string, string>> {
  const found = new Map<string, string>(); // 干员名 -> 文件 url
  let cont: string | undefined;
  let pages = 0;

  do {
    const data = await apiJson({
      action: 'query',
      list: 'allimages',
      aiprefix: prefix,
      ailimit: '500',
      aiprop: 'url',
      ...(cont ? { aicontinue: cont } : {}),
    });
    pages++;
    for (const img of data?.query?.allimages ?? []) {
      const name = String(img.name);
      const m = extract.exec(name);
      if (!m) continue;
      const operator = m[1]!;
      // 只保留"本体"（不含 _skin1 这种皮肤后缀）；皮肤优先级最低
      if (!found.has(operator) || !operator.includes('_skin')) {
        found.set(operator, img.url);
      }
    }
    cont = data?.continue?.aicontinue;
  } while (cont && pages < 10);

  return found;
}

/** 头像：`头像_阿米娅.png` */
function listAllAvatars(): Promise<Map<string, string>> {
  return listByPrefix('头像_', /^头像_(.+)\.png$/);
}

/**
 * 半身像：`半身像_阿米娅_1.png`。
 * 末尾的 `_1` 是"第 1 套"，我们只要第一套。
 */
function listAllStands(): Promise<Map<string, string>> {
  return listByPrefix('半身像_', /^半身像_(.+)_1\.png$/);
}

/** 模糊匹配：把名字里的异格前后缀去掉再试 */
function fuzzyCandidates(name: string, available: Map<string, string>): string[] {
  const out: string[] = [];
  for (const key of available.keys()) {
    if (key.includes(name) || name.includes(key)) out.push(key);
  }
  return out.sort((a, b) => Math.abs(a.length - name.length) - Math.abs(b.length - name.length));
}

/** 编辑距离（用来猜"你是不是想写…"） */
function levenshtein(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const dp: number[] = new Array(cols);
  for (let j = 0; j < cols; j++) dp[j] = j;
  for (let i = 1; i < rows; i++) {
    let prev = dp[0]!;
    dp[0] = i;
    for (let j = 1; j < cols; j++) {
      const temp = dp[j]!;
      dp[j] = Math.min(dp[j]! + 1, dp[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = temp;
    }
  }
  return dp[cols - 1]!;
}

/** 最接近的几个名字（只在本体头像里找，排除皮肤） */
function closestNames(name: string, available: Map<string, string>, limit: number): string[] {
  return [...available.keys()]
    .filter((key) => !key.includes('_skin') && !key.includes('.'))
    .map((key) => ({ key, distance: levenshtein(name, key) }))
    .filter((item) => item.distance <= Math.max(2, Math.ceil(name.length / 3)))
    .sort((a, b) => a.distance - b.distance || a.key.length - b.key.length)
    .slice(0, limit)
    .map((item) => item.key);
}

async function main(): Promise<void> {
  if (kind === 'avatar' || kind === 'both') {
    await downloadKind('头像（商店/备战席/信息窗口用）', listAllAvatars, OUT_DIR);
  }
  if (kind === 'stand' || kind === 'both') {
    await downloadKind('半身像（棋盘上的立绘用）', listAllStands, STAND_DIR);
  }
}

async function downloadKind(
  label: string,
  listFn: () => Promise<Map<string, string>>,
  outDir: string,
): Promise<void> {
  console.log(`\n${'='.repeat(52)}\n  ${label}\n${'='.repeat(52)}`);
  console.log('正在拉取 prts.wiki 的文件清单…');
  const available = await listFn();
  console.log(`wiki 上共有 ${available.size} 个\n`);

  const entries = Object.values(UNIT_DEFS).sort((a, b) => a.id.localeCompare(b.id));

  const exact: Array<{ id: string; name: string; url: string }> = [];
  const fuzzy: Array<{ id: string; name: string; url: string; matched: string }> = [];
  const missing: Array<{ id: string; name: string }> = [];

  for (const def of entries) {
    const direct = available.get(def.name);
    if (direct) {
      exact.push({ id: def.id, name: def.name, url: direct });
      continue;
    }
    const candidates = fuzzyCandidates(def.name, available).filter((c) => !c.includes('_skin'));
    if (candidates.length === 1) {
      const matched = candidates[0]!;
      fuzzy.push({ id: def.id, name: def.name, url: available.get(matched)!, matched });
      continue;
    }
    missing.push({ id: def.id, name: def.name });
  }

  console.log(`✅ 精确匹配 ${exact.length} 个`);
  if (fuzzy.length > 0) {
    console.log(`\n🔍 模糊匹配 ${fuzzy.length} 个（名字和 wiki 不完全一样，请确认）：`);
    for (const item of fuzzy) console.log(`   ${item.name}  ->  ${item.matched}`);
  }
  if (missing.length > 0) {
    console.log(`\n❌ 没找到 ${missing.length} 个（需要在表格里改成 wiki 上的正式名）：`);
    for (const item of missing) {
      console.log(`   [${item.id}] ${item.name}`);
      // 直接给出"最接近的几个名字"，省得你自己去 wiki 上翻
      for (const guess of closestNames(item.name, available, 4)) {
        console.log(`        是不是「${guess}」？`);
      }
    }
  }

  if (!shouldDownload) {
    console.log('\n（这是预演。加 --go 才会真的下载文件。）');
    return;
  }

  mkdirSync(outDir, { recursive: true });
  let ok = 0;
  let failed = 0;
  for (const item of [...exact, ...fuzzy]) {
    const path = `${outDir}/${item.id}.png`;
    if (!force && existsSync(path)) {
      ok++;
      continue;
    }
    try {
      const res = await fetch(item.url, { headers: { 'User-Agent': UA } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buffer = Buffer.from(await res.arrayBuffer());
      if (buffer.byteLength < 512) throw new Error('文件太小，可能不是图片');
      writeFileSync(path, buffer);
      ok++;
      console.log(`  ✓ ${item.id}.png  ${item.name}  (${(buffer.byteLength / 1024).toFixed(0)} KB)`);
    } catch (error) {
      failed++;
      console.error(`  ✗ ${item.id} ${item.name}: ${(error as Error).message}`);
    }
    // 对 wiki 友好一点，别一秒打几十个请求
    await new Promise((r) => setTimeout(r, 120));
  }

  console.log(`\n下载完成：成功 ${ok} 个，失败 ${failed} 个`);
  console.log(`存放位置：${outDir}/`);
  console.log(`图片会自动生效（文件名就是棋子 id，例如 op01.png）—— 刷新页面即可看到。`);
}

await main();
