#!/usr/bin/env node
/**
 * ============================================================
 *  抓取藏品（装备）图标（构建期用，产物进 apps/web/public/assets/items/）
 * ============================================================
 *
 * 用法：
 *   node node_modules/tsx/dist/cli.mjs scripts/fetch-item-icons.ts
 *   node node_modules/tsx/dist/cli.mjs scripts/fetch-item-icons.ts --only=itm_solvent,itm_old_fan
 *   node node_modules/tsx/dist/cli.mjs scripts/fetch-item-icons.ts --force    # 已存在也重下
 *   node node_modules/tsx/dist/cli.mjs scripts/fetch-item-icons.ts --check    # 只体检，不下载
 *
 * ------------------------------------------------------------------
 * 【为什么图标有两套来源？】
 *
 * 藏品表（packages/shared/src/item-data.ts）里的东西，其实抄自《明日方舟》**两个不同的系统**：
 *
 *   · A 类「可穿戴藏品」—— 全部来自**卫戍协议**（Stationary Security Service）。
 *     它的图标在 prts.wiki 上是普通文件：`卫戍协议 道具 <名字>.png`，
 *     直链形如 https://media.prts.wiki/<hash>/卫戍协议_道具_<名字>.png，
 *     hash 会随文件版本变，所以这里**用 API 现查**，不写死。
 *
 *   · B 类「共享藏品」—— 来自**集成战略**（Roguelike）的收藏品。
 *     收藏品的图标不在 wiki 的文件区，而在官方 CDN：
 *       https://torappu.prts.wiki/assets/roguelike_topic_itempic/<iconId>.png
 *     iconId 是形如 `rogue_6_relic_legacy_28` 的语义 id，**wiki 条目的 `|iconId=` 字段就是它**。
 *     （「幸运硬币」是个例外：它在卫戍协议里也有同名道具，走上面那条路。）
 *
 * 所以下面把藏品拆成两张表：SFS_ICONS（按 wiki 文件名查直链）和 RELIC_ICONS（直接拼 CDN）。
 *
 * ------------------------------------------------------------------
 * 【设计稿的名字和官方对不上，以官方为准】
 * 藏品.txt 是手写的，有几处和游戏里的正式名差一个字。抓图标时按**官方名**去要，
 * 否则查不到文件（下面的注释逐条标了）。这不是"改设定"，只是图标该配哪张图的问题：
 *
 *   itm_yan_blade    设计稿「炎国短刃」→ 官方「炎国短刀」
 *   itm_blast_shield 设计稿「防爆盾」  → 官方「防暴盾」
 *   itm_arcane_array 设计稿「奥数法阵」→ 官方只有「口袋法阵」（卫戍协议里唯一一个"法阵"道具）
 *   itm_old_coin     设计稿「古旧残币」→ 官方「古旧钱币」（描述：生锈的古代钱币…，语义完全对得上）
 *   itm_fate_mask    设计稿「奇缘面具」→ 官方「奇渊面具」
 *   itm_emperor_gun  设计稿「皇帝的新枪」→ 官方「国王的新枪」
 *
 * ------------------------------------------------------------------
 * 【产物】
 *   apps/web/public/assets/items/<item.icon>.png
 *   文件名 = ITEM_DEFS[].icon（不是 item.id，也不是中文名）——
 *   apps/web/src/three/assets.ts 的 itemIconPath() 就是按这个拼的，改一边就得改另一边。
 *
 * 【缺图不会崩】
 * 没抓到的那几张不影响玩：apps/web/src/main.ts 的 buildItemIcon() 会退回
 * 「首字 + 稀有度色」的色块。想补齐就再跑一次本脚本（已存在的会跳过）。
 *
 * 【授权姿态】
 * 素材版权属于鹰角网络 / 悠星。本项目是非盈利同人，
 * 仓库里不含素材本体（apps/web/public/assets/.gitignore 已忽略 *.png）、只含这个抓取脚本；
 * 权利人要求即删。详见 docs/同人使用与版权说明.md。
 */

import { mkdir, writeFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ITEM_DEFS } from '../packages/shared/src/index.js';

const repoRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
/** 产物目录：对应网址上的 /assets/items/ */
const destDir = join(repoRoot, 'apps/web/public/assets/items');

/** prts.wiki 的 MediaWiki API（查卫戍协议道具的直链用） */
const API = 'https://prts.wiki/api.php';
/** 集成战略收藏品图标的官方 CDN 前缀 */
const RELIC_CDN = 'https://torappu.prts.wiki/assets/roguelike_topic_itempic';

/** 同时最多跑几个下载 */
const CONCURRENCY = 6;

const args = process.argv.slice(2);
const force = args.includes('--force');
const checkOnly = args.includes('--check');
const onlyArg = args.find((a) => a.startsWith('--only'));
const only = onlyArg
  ? (onlyArg.includes('=') ? onlyArg.split('=')[1] : args[args.indexOf(onlyArg) + 1]).split(',').filter(Boolean)
  : null;

function log(msg: string): void {
  process.stdout.write(msg + '\n');
}

/**
 * 卫戍协议道具图标。
 * key = 藏品 id（ITEM_DEFS 的 key），value = **wiki 上的官方道具名**。
 *
 * 用 API `titles=File:卫戍协议 道具 <名字>.png&prop=imageinfo&iiprop=url` 换直链。
 * 一批最多 20 个标题（MediaWiki 的 titles 上限是 50，这里留点余量）。
 */
const SFS_ICONS: Record<string, string> = {
  itm_solvent: '源石溶剂',
  itm_yan_blade: '炎国短刀',
  itm_bulwark: '坚守盾牌',
  itm_goliath_helm: '歌利亚头盔',
  itm_arcane_array: '口袋法阵',
  itm_dormant_spawn: '休眠子裔',
  itm_accelerator: '有限加速器',
  itm_blast_shield: '防暴盾',
  itm_m3_cocoon: 'M3茧甲',
  itm_raid_grenade: '突袭手雷',
  itm_ration: '迅捷作战粮',
  itm_lucky_coin: '幸运硬币',
  itm_dual_arm: '双模机械臂',
  itm_mimic_mass: '拟态物质',
  itm_doctor_projection: '博士投影',
  itm_mutant_cell: '突变细胞',
  itm_pegasus_helm: '天马之盔',
  itm_rider_might: '铳骑之威',
  itm_sand_compass: '黄沙罗盘',
  itm_knight_oath: '骑士戒律',
  /*
    ★ 0.1.3：「变形同构体」**也是卫戍协议：盟约里的正经装备**（不是我们自己编的）——
    游戏里的效果是「携带者获得额外盟约（由另一件携带装备而定）」，
    也就是"配合另一个道具决定转成哪个阵营"，我们的转职体系正是照它来的。
    所以它用官方贴图，而不是程序生成的占位图。
  */
  itm_morph_relic: '变形同构体',
};

/**
 * 集成战略收藏品图标。
 * key = 藏品 id，value = 官方 iconId（取自 wiki 条目的 `|iconId=`，见文件头说明）。
 *
 * 想换/补一张：去 https://prts.wiki/w/<官方名> 看 `{{收藏品/common|iconId=...}}` 那一行。
 */
const RELIC_ICONS: Record<string, string> = {
  itm_terrain_map: 'rogue_6_relic_legacy_28',
  itm_old_coin: 'rogue_5_relic_legacy_110',
  itm_kettle: 'rogue_6_relic_legacy_1',
  itm_fate_mask: 'rogue_4_relic_legacy_60',
  itm_emperor_favor: 'rogue_6_relic_legacy_15',
  itm_silver_fork: 'rogue_6_relic_legacy_19',
  itm_medkit: 'rogue_6_relic_legacy_89',
  itm_pill: 'rogue_6_relic_legacy_53',
  itm_flawless_jade: 'rogue_5_relic_legacy_111',
  itm_treasure_ring: 'rogue_6_relic_legacy_59',
  itm_blood_bed: 'rogue_6_relic_legacy_109',
  itm_lost_key: 'rogue_6_relic_legacy_93',
  itm_rosemary_embrace: 'rogue_6_relic_legacy_86',
  itm_old_fan: 'rogue_4_relic_legacy_142',
  itm_gin_cup: 'rogue_6_relic_legacy_60',
  itm_emperor_gun: 'rogue_5_relic_return_23',

  /*
    ---------------- 二版 · 30 件（全部来自集成战略）----------------
    iconId 同样是去条目 wikitext 里读 `|iconId=` 得到的（见文件头说明）。
    这批都没有"设计稿名 ≠ 官方名"的问题，唯一一处要提的是最后一条：
      itm_riot_bunker 设计稿写成「支援防暴桩」，官方条目就叫这个名字，
      但它是**水月与深蓝之树的战术道具**（`rogue_2_active_tool_5`）而不是收藏品 ——
      iconId 前缀不一样，走的还是同一个 CDN，不用特殊处理。
  */
  itm_hr_bronze_seal: 'rogue_6_relic_legacy_132',
  itm_riot_bunker: 'rogue_2_active_tool_5',
  itm_bloody_dictionary: 'rogue_6_relic_fight_12',
  itm_dancer_bracelet: 'rogue_6_relic_legacy_130',
  itm_designer_ruler: 'rogue_6_relic_legacy_128',
  itm_mage_slayer: 'rogue_6_relic_legacy_129',
  itm_gaul_check: 'rogue_6_relic_legacy_98',
  itm_live_rose: 'rogue_6_relic_legacy_81',
  itm_doc_silver_seal: 'rogue_6_relic_legacy_133',
  itm_grudge_list: 'rogue_6_relic_artifact_7',
  itm_blackflow_notes: 'rogue_6_relic_cargo_14',
  itm_sad_red: 'rogue_6_relic_cargo_2',
  itm_mercenary_trinket: 'rogue_6_relic_legacy_136',
  itm_fist_three_questions: 'rogue_6_relic_legacy_125',
  itm_pebble_altar: 'rogue_6_relic_legacy_103',
  itm_celestial_pouch: 'rogue_6_relic_fight_20',
  itm_spicy_cocoa: 'rogue_6_relic_fight_14',
  itm_painkiller: 'rogue_6_relic_fight_15',
  itm_sword_hammer: 'rogue_6_relic_legacy_142',
  itm_horn_ang: 'rogue_6_relic_legacy_131',
  itm_blaze_saw: 'rogue_6_relic_legacy_123',
  itm_scout_scope: 'rogue_6_relic_legacy_122',
  itm_stimulant: 'rogue_6_relic_legacy_102',
  itm_econ_reform: 'rogue_6_relic_legacy_99',
  itm_surge_meal: 'rogue_6_relic_legacy_83',
  itm_survivor_contract: 'rogue_5_relic_return_7',
  itm_demon_king_banner: 'rogue_5_relic_return_28',
  itm_cangtong: 'rogue_5_relic_richg_7',
  itm_home_stirfry: 'rogue_5_relic_explore_3',
  itm_knight_lance_pro: 'rogue_5_relic_legacy_31',
};

/** 一个待下载项：藏品 id + 最终的本地文件名 + 一个"怎么拿"的描述 */
interface IconJob {
  id: string;
  /** 本地文件名（不含目录），= ITEM_DEFS[].icon */
  file: string;
  kind: 'sfs' | 'relic';
  /** sfs = wiki 上的官方道具名；relic = 官方 iconId */
  key: string;
  /** 已经解析出来的直链（sfs 的跑完 API 才有） */
  url?: string;
}

/**
 * 带重试的下载；已经存在的文件直接跳过（除非 --force）。
 *
 * 和 scripts/fetch-chibi.ts 的同名函数是一个路子：本地非空文件 = 已下载，不重复拉。
 * 图标很小（10~60 KB），所以重试间隔比小人那套短。
 */
async function download(
  url: string,
  dest: string,
  { retries = 2 }: { retries?: number } = {},
): Promise<{ skipped: boolean; bytes: number }> {
  if (!force && existsSync(dest)) {
    const s = await stat(dest).catch(() => null);
    if (s && s.size > 0) return { skipped: true, bytes: s.size };
  }
  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        redirect: 'follow',
        headers: { 'User-Agent': 'AIRNIGHT-item-icon-fetch/1.0 (build tool)' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      // 内容嗅探：CDN 出错时会返回一个 HTML 错误页，别把 html 存成 .png
      if (!isPng(buf)) throw new Error(`不是 PNG（前 8 字节：${buf.subarray(0, 8).toString('hex')}）`);
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, buf);
      return { skipped: false, bytes: buf.length };
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
  }
  throw lastErr ?? new Error('下载失败');
}

/** PNG 魔数：89 50 4E 47 0D 0A 1A 0A */
function isPng(buf: Buffer): boolean {
  return (
    buf.length > 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  );
}

/** 简单的并发闸门（和 fetch-chibi.ts 一样） */
async function pool<T, R>(items: T[], limit: number, worker: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return results;
}

interface ApiPage {
  title?: string;
  missing?: string;
  imageinfo?: Array<{ url?: string; width?: number; height?: number }>;
}

/**
 * 去掉命名空间前缀，只留文件名。
 *
 * ★ 为什么不能直接比对完整标题？
 * 请求时写的是 `File:卫戍协议 道具 X.png`，但 prts.wiki 是中文站，
 * 返回的标题里 `File:` 会被规范化成中文命名空间 `文件:` —— 直接 `===` 一个都匹配不上。
 * 只比「冒号后面的那段」就两种写法都能吃。
 */
function leafName(title: string): string {
  const i = title.indexOf(':');
  return i >= 0 ? title.slice(i + 1) : title;
}

/** 批量把「卫戍协议 道具 X.png」换成 media.prts.wiki 直链 */
async function resolveSfsUrls(jobs: IconJob[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (let i = 0; i < jobs.length; i += 20) {
    const batch = jobs.slice(i, i + 20);
    // 叶子名 → job，用来把返回的一坨 pages 认回来
    const byLeaf = new Map(batch.map((j) => [`卫戍协议 道具 ${j.key}.png`, j]));
    const titles = batch.map((j) => `File:卫戍协议 道具 ${j.key}.png`);
    const params = new URLSearchParams({
      format: 'json',
      action: 'query',
      titles: titles.join('|'),
      prop: 'imageinfo',
      iiprop: 'url|size',
    });
    const res = await fetch(`${API}?${params}`, {
      headers: { 'User-Agent': 'AIRNIGHT-item-icon-fetch/1.0 (build tool)' },
    });
    if (!res.ok) throw new Error(`prts.wiki API HTTP ${res.status}`);
    const json = (await res.json()) as { query?: { pages?: Record<string, ApiPage> } };
    for (const page of Object.values(json.query?.pages ?? {})) {
      if (!page.title || page.missing !== undefined) continue;
      const job = byLeaf.get(leafName(page.title));
      if (job && page.imageinfo?.[0]?.url) out.set(job.id, page.imageinfo[0].url);
    }
  }
  return out;
}

async function main(): Promise<void> {
  log('============================================================');
  log('  抓取藏品（装备）图标');
  log('============================================================');
  log(`产物目录：${destDir}`);
  log('');

  // ---------- 0. 体检：两张表要正好覆盖 ITEM_DEFS ----------
  // 「全表取样」的坑在这个项目里踩过（见 packages 里 playableDefs 的由来）：
  // 以后新增一件藏品却忘了登记图标，这里要**当场报错**，别让它悄悄变成色块。
  const allItems = Object.values(ITEM_DEFS);
  const known = new Set([...Object.keys(SFS_ICONS), ...Object.keys(RELIC_ICONS)]);
  /*
    ★ 0.1.3：**转职藏品**放行 —— 它们的图标是程序生成的占位图
    （纯色底 + 羁绊首字，见 `scripts/gen-trait-relic-icons.ts`），本来就不从网上抓。
    判据用 `grantsTrait`（效果类别），不写死那 16 个 id —— 以后往羁绊表里加羁绊、
    自动多出一件转职时，不会因为忘了改这里而误报。
    等有正式美术了，把它们登记进 RELIC_ICONS 再把这条豁免删掉。
  */
  const generatedIcons = new Set(allItems.filter((it) => it.grantsTrait !== undefined).map((it) => it.id));
  const missing = allItems.filter((it) => !known.has(it.id) && !generatedIcons.has(it.id));
  const extra = [...known].filter((id) => !(id in ITEM_DEFS));
  if (missing.length > 0) {
    log(`✗ 有 ${missing.length} 件藏品没登记图标来源，先去 item-data.ts 核一下 id：`);
    for (const it of missing) log(`    · ${it.id}  ${it.name}`);
    process.exitCode = 1;
    return;
  }
  if (extra.length > 0) {
    log(`⚠ 下面这些 id 在 item-data.ts 里已经不存在了，建议从本脚本删掉：`);
    for (const id of extra) log(`    · ${id}`);
    log('');
  }

  // ---------- 1. 组装待下载清单 ----------
  let jobs: IconJob[] = allItems.map((it) => {
    if (it.id in SFS_ICONS) {
      return { id: it.id, file: it.icon, kind: 'sfs' as const, key: SFS_ICONS[it.id] };
    }
    return { id: it.id, file: it.icon, kind: 'relic' as const, key: RELIC_ICONS[it.id] };
  });
  if (only) {
    jobs = jobs.filter((j) => only.includes(j.id) || only.includes(j.file));
    log(`（--only）只处理 ${jobs.length} 件：${jobs.map((j) => j.id).join(', ')}`);
  }

  // ---------- 2. 体检模式 ----------
  if (checkOnly) {
    log('[--check] 只看本地有没有图，不下载：');
    let have = 0;
    for (const job of jobs) {
      const dest = join(destDir, `${job.file}.png`);
      const ok = existsSync(dest);
      if (ok) have++;
      log(`  ${ok ? '✓' : '✗'} ${job.id.padEnd(22)} → items/${job.file}.png`);
    }
    log('');
    log(`本地已有 ${have} / ${jobs.length} 张。`);
    log(have === jobs.length ? '全部齐了。' : '缺的跑一遍不带 --check 的即可补齐。');
    return;
  }

  // ---------- 3. 解析卫戍协议那 20 张的直链 ----------
  const sfsJobs = jobs.filter((j) => j.kind === 'sfs');
  if (sfsJobs.length > 0) {
    log(`[1/2] 向 prts.wiki 查 ${sfsJobs.length} 张卫戍协议道具的直链…`);
    const urls = await resolveSfsUrls(sfsJobs);
    let unresolved = 0;
    for (const job of sfsJobs) {
      job.url = urls.get(job.id);
      if (!job.url) {
        unresolved++;
        log(`  ✗ ${job.id}（卫戍协议 道具 ${job.key}.png）在 wiki 上找不到`);
      }
    }
    log(`  ${sfsJobs.length - unresolved} / ${sfsJobs.length} 解析成功`);
  }

  // ---------- 4. 下载 ----------
  log('');
  log(`[2/2] 下载 ${jobs.length} 张到 items/（已存在的跳过）`);
  let ok = 0;
  let skipped = 0;
  let failed = 0;
  let bytes = 0;
  const failures: string[] = [];

  await pool(jobs, CONCURRENCY, async (job) => {
    const dest = join(destDir, `${job.file}.png`);
    const url = job.kind === 'relic' ? `${RELIC_CDN}/${job.key}.png` : job.url;
    if (!url) {
      failed++;
      failures.push(`${job.file}（没有直链）`);
      return;
    }
    try {
      const r = await download(url, dest);
      if (r.skipped) {
        skipped++;
        log(`  · ${job.file.padEnd(22)} 已存在，跳过`);
      } else {
        ok++;
        bytes += r.bytes;
        log(`  ✓ ${job.file.padEnd(22)} ${(r.bytes / 1024).toFixed(1)} KB`);
      }
    } catch (err) {
      failed++;
      const msg = err instanceof Error ? err.message : String(err);
      failures.push(`${job.file}（${msg}）`);
      log(`  ✗ ${job.file.padEnd(22)} ${msg}`);
    }
  });

  // ---------- 5. 汇总 ----------
  log('');
  log('------------------------------------------------------------');
  log(`新下载 ${ok} 张 · 跳过 ${skipped} 张 · 失败 ${failed} 张 · 共 ${(bytes / 1024 / 1024).toFixed(2)} MB`);
  log(`位置：${destDir}`);
  if (failures.length > 0) {
    log('');
    log('下面这些没拿到（游戏里会退回"首字 + 稀有度色"的色块，不影响运行）：');
    for (const f of failures) log(`  · ${f}`);
    process.exitCode = 1;
  } else {
    log('全部就绪。刷新页面即可看到图标。');
  }
}

await main();
