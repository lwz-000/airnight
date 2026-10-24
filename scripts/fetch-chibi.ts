#!/usr/bin/env node
/**
 * ============================================================
 *  抓取官方 Q 版小人的 Spine 原始素材（构建期用，不进游戏包）
 * ============================================================
 *
 * 用法：
 *   node scripts/fetch-chibi.ts
 *   node scripts/fetch-chibi.ts --only op07,op21      # 只抓两个（调试用）
 *   node scripts/fetch-chibi.ts --only mn_slime       # 野怪也行
 *
 * 【★ 0.0.3 新增：野怪（敌人）小人也从这条路走】
 *   干员：fexli/ArknightsResource 的 spine/<charId>/<charId>/Front/<charId>.*
 *   野怪：isHarryh/Ark-Models 的 models_enemies/<key>/enemy_<key>.*
 *         （key = charId 去掉 enemy_ 前缀，例如 1007_slime）
 *   野怪的 atlas 是**预乘 alpha 的贴图却没写 pma**，所以这里会补一行 `pma: true`，
 *   不补的话渲染出来一圈黑边（见 fixEnemyAtlas）。
 *
 * 【★ 0.1.1 藏品二版：第三类源 —— prts.wiki 的官方 Spine CDN】
 *   装置（`trap_*`）和"归在敌人一览里、但阵营是我方的机械"这两个社区库里都没有，
 *   只有 wiki 的 CDN 上有，见 WIKI_SPINE_URLS 的说明。
 *
 * 【镜像】raw.githubusercontent.com / cdn.jsdelivr.net 在部分网络下直接连不上（实测返回 000），
 * 所以每个文件都会依次尝试：直连 RAW → jsDelivr → **GitHub 加速镜像**（见 GH_PROXIES），
 * 谁通用谁。★ 0.2 抓 MujicaAve 五人时前两个源同时被挡，就是靠最后一层救回来的 ——
 * 素材本来就在仓库里，纯粹是网络问题，别急着断定"镜像还没更新"。
 *
 * 【素材来源】
 * `fexli/ArknightsResource` —— 社区维护的官方资源镜像。
 * 每个干员的 Q 版小人三个文件：
 *   spine/<charId>/<charId>/Front/<charId>.skel   二进制骨骼动画
 *   spine/<charId>/<charId>/Front/<charId>.atlas  图集索引
 *   spine/<charId>/<charId>/Front/<charId>.png    图集贴图
 * 实测阿米娅的骨架版本是 3.8.99，pixi-spine 的 runtime-3.8 能吃下。
 *
 * 【为什么抓到一个不进包的目录里？】
 * 因为这个目录里的东西**一个都不该出现在游戏包里**：
 *   · .skel 是官方的骨骼数据
 *   · 真正要发出去的是**渲染好的 PNG 序列帧**（下一步 scripts/render-chibi.mjs 产）
 * 这样游戏包里既没有 Spine 运行时、也没有骨骼数据，
 * 只有和现有的 stand/ 半身像同性质的静态图。
 *
 * 【授权姿态】
 * 这些素材版权属于鹰角网络 / 悠星。本项目是非盈利同人，
 * 仓库里不含素材本体、只含这个抓取脚本；权利人要求即删。
 * 详见 docs/同人使用与版权说明.md。
 */

import { mkdir, writeFile, stat, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { UNIT_DEFS } from '../packages/shared/src/index.js';

const repoRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const cacheDir = join(repoRoot, '.chibi-cache');
const spineDir = join(cacheDir, 'spine');
const vendorDir = join(cacheDir, 'vendor');
const indexFile = join(cacheDir, 'index.json');

/**
 * 下载源。
 *
 * 【为什么要两个？】
 * `raw.githubusercontent.com` 是最原始的地址，但在部分网络下会被拦（实测 curl 000）。
 * jsDelivr 是同一份仓库的 CDN 镜像，内容一致、国内可直连。
 * 每个文件都按顺序试，谁通用谁 —— 不写死一个源，换网络也不用改代码。
 */
const RAW = 'https://raw.githubusercontent.com';
const JSDELIVR = 'https://cdn.jsdelivr.net/gh';

/** 干员 / 召唤物的骨架仓库 */
const OPERATOR_REPO = 'fexli/ArknightsResource';
/** 野怪（敌人战斗小人）的骨架仓库 */
const ENEMY_REPO = 'isHarryh/Ark-Models';

/** 干员的远程路径前缀（拼在仓库名后面） */
const SPINE_DIR = 'spine';
/** 野怪的远程路径前缀 */
const ENEMY_DIR = 'models_enemies';

/**
 * ★ 少数素材在仓库里的**路径形状**和干员不一样（0.0.2 追加需求第 6 条）。
 *
 * 【干员的标准形状】
 *   spine/<charId>/<charId>/Front/<charId>.{skel,atlas,png}
 *
 * 【召唤物为什么不一样？】
 *   prts.wiki 上给召唤物标的是一个 token 模型 id（例如维娜的金狮子是
 *   token_10040_siege2_vlion），而镜像仓库里它多一层"皮肤"目录：
 *   spine/<tokenId>/<tokenId>_<皮肤>_<编号>/Front/<tokenId>_<皮肤>_<编号>.<ext>
 *   所以光有 tokenId 拼不出可下载的地址，得把**叶子名**也写出来。
 *
 * 值 = "去掉 SPINE_BASE 之后的那段路径"。
 * 本地仍然按干员那套统一布局存（.chibi-cache/spine/<charId>/<charId>.<ext>），
 * 因为 render-chibi 渲染页就是按 `/spine/<charId>/<charId>.skel` 取的。
 */
const REMOTE_OVERRIDES: Record<string, string> = {
  // 维娜·维多利亚的召唤物「黄金盟誓」（游戏里显示成金色狮子）
  summon_lion: 'token_10040_siege2_vlion/token_10040_siege2_vlion_epoque_50/Front/token_10040_siege2_vlion_epoque_50',
  /*
    ★ 0.2：维什戴尔的召唤物「魂灵之影」（Shadow of Revenant）。
    官方骨架 id 是 `token_10035_wisdel_wward`（prts 的「魂灵之影」条目可查），
    和上面那只狮子一样，镜像里**只有皮肤版本**（`_game_9` / `_sale_14`），没有默认那套。
    选了 `_game_9`：配色（黑/暗红）和默认皮肤的维什戴尔最接近。
  */
  summon_shadow: 'token_10035_wisdel_wward/token_10035_wisdel_wward_game_9/Front/token_10035_wisdel_wward_game_9',
  /*
    ★ 彩蛋棋子「维维美·绝对主角」用的是维什戴尔皮肤「绝对主角」的小人。
    皮肤在素材库里的形状和召唤物一样，多一层"皮肤名"目录：
      spine/<charId>/<charId>_<皮肤>/Front/<charId>_<皮肤>
    这里皮肤标识是 `game_9`（对应 skinId `char_1035_wisdel@game#9`）——
    直接按干员那套 `<charId>/<charId>/Front/<charId>` 拼会 404。
  */
  egg_mvm: 'char_1035_wisdel/char_1035_wisdel_game_9/Front/char_1035_wisdel_game_9',
};

/**
 * ★ 0.1.1 藏品二版：**第三类素材源** —— prts.wiki 自己的官方 Spine CDN。
 *
 * 【为什么还需要第三个源？】
 * 前面两个社区镜像只覆盖了两类东西：
 *   · fexli/ArknightsResource —— 干员 + 干员的召唤物（`token_*`）。实测 518 个条目，
 *     **一个 `trap_*` 都没有**。
 *   · isHarryh/Ark-Models —— 野怪（`models_enemies/`）。实测 2063 个目录，
 *     同样**一个 `trap_*` 都没有**（方舟的"装置"是 3D 预制体，社区没做小人的镜像）。
 * 而藏品二版新增的两个召唤物恰好都不是这两类：
 *   · 假人 → 装置「掩体」`trap_083_bunker`
 *   · 炎佑 → 卫戍协议：盟约里的**我方机械**（图鉴归在"敌人一览"里，但阵营是我方）
 * 它们的 Spine 只在 prts.wiki 的 CDN 上，而且两边**路径形状还不一样**：
 *   char_spine/<charId>/defaultskin/spine/<charId>     ← 装置（多一层 defaultskin/spine）
 *   enemy_spine/<charId>/<charId>                      ← 敌人 / 我方机械
 * 拼不出来，所以这里**整条地址写死**（值是去掉扩展名后的完整 URL）。
 *
 * 想再加一个：去 https://prts.wiki/w/<条目名>/spine 看那段 JSON 的
 * `prefix` + `skin.默认.战斗.file`，拼起来就是。
 */
const WIKI_SPINE_URLS: Record<string, string> = {
  summon_dummy: 'https://torappu.prts.wiki/assets/char_spine/trap_083_bunker/defaultskin/spine/trap_083_bunker',
  summon_yanyou: 'https://torappu.prts.wiki/assets/enemy_spine/enemy_9012_acloon/enemy_9012_acloon',
};

/** 构建期要用的两个前端库，也顺手抓到缓存里（无头页面要用） */
const VENDOR = [
  {
    file: 'pixi.min.js',
    url: 'https://cdn.jsdelivr.net/npm/pixi.js@7.4.2/dist/pixi.min.js',
  },
  {
    file: 'pixi-spine.js',
    url: 'https://cdn.jsdelivr.net/npm/pixi-spine@4.0.6/dist/pixi-spine.js',
  },
];

const EXTENSIONS = ['skel', 'atlas', 'png'];

/** 同时最多跑几个下载 */
const CONCURRENCY = 6;

const args = process.argv.slice(2);
const onlyArg = args.find((a) => a.startsWith('--only'));
const only = onlyArg
  ? (onlyArg.includes('=') ? onlyArg.split('=')[1] : args[args.indexOf(onlyArg) + 1]).split(',')
  : null;

function log(msg) {
  process.stdout.write(msg + '\n');
}

/**
 * 带重试的下载；已经存在的文件直接跳过。
 *
 * ★ 0.0.3：`urls` 可以是**一组**地址（RAW + jsDelivr 镜像），依次尝试。
 * 组里任何一个成功就算成功；全失败才算这个文件抓不到。
 */
async function download(urls, dest, { retries = 2 } = {}) {
  const list = Array.isArray(urls) ? urls : [urls];
  if (existsSync(dest)) {
    const s = await stat(dest).catch(() => null);
    if (s && s.size > 0) return { skipped: true, bytes: s.size };
  }
  let lastErr = null;
  for (const url of list) {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const res = await fetch(url, { redirect: 'follow' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = Buffer.from(await res.arrayBuffer());
        await mkdir(dirname(dest), { recursive: true });
        await writeFile(dest, buf);
        return { skipped: false, bytes: buf.length };
      } catch (err) {
        lastErr = err;
        // 第一次失败就先等一下，第二次大概率是网络抖动
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
      }
    }
  }
  throw lastErr ?? new Error('下载失败');
}

/**
 * ★ 0.2（第二次）：GitHub 加速镜像。
 *
 * 【为什么又加一层？】
 * 抓 Ave Mujica 那五位时 `raw.githubusercontent.com` 和 `cdn.jsdelivr.net` **同时**
 * 返回 000（连不上，不是 404）—— 素材其实早就在仓库里了，纯粹是被网络挡住。
 * 这两个镜像是"反向代理 raw 地址"的转发站（`<镜像>/https://raw.githubusercontent.com/...`），
 * 实测国内可直连、内容一致。
 *
 * ★ 只是**兜底**，排在最后：能直连时还是走官方源（镜像站会限速、也可能哪天关站）。
 * ★ 顺序别随意调 —— 前面的源不稳时，多等几轮重试很慢。
 */
const GH_PROXIES = ['https://ghproxy.net/', 'https://gh-proxy.com/'];

/**
 * 同一个仓库路径的所有源（按"尽量直连、实在不行走镜像"排序）。
 */
function bothSources(repo: string, path: string): string[] {
  const direct = [`${RAW}/${repo}/main/${path}`, `${JSDELIVR}/${repo}@main/${path}`];
  // 镜像只转发 raw 地址（jsDelivr 有自己的加速节点，不用再包一层）
  return [...direct, ...GH_PROXIES.map((proxy) => `${proxy}${direct[0]}`)];
}

/** 干员骨架的远程路径（和以前完全一致：<charId>/<charId>/Front/<charId>） */
function operatorRemotePath(charId: string, defId: string): string {
  const rel = REMOTE_OVERRIDES[defId] ?? `${charId}/${charId}/Front/${charId}`;
  return `${SPINE_DIR}/${rel}`;
}

/**
 * 野怪骨架的远程路径。
 *
 * 目录名是 charId **去掉 enemy_ 前缀**（仓库里就是 `models_enemies/1007_slime/`），
 * 文件名才是完整的 `enemy_1007_slime.atlas` —— 这个不一致的坑记一下，
 * 按干员那套形状拼会 404。
 */
function enemyRemotePath(charId: string): string {
  const key = charId.replace(/^enemy_/, '');
  return `${ENEMY_DIR}/${key}/${charId}`;
}

/**
 * ★ Ark-Models 的敌人图集：贴图是**预乘 alpha**，但 atlas 里没写 `pma: true`。
 * 不补的话 pixi-spine 会按"非预乘"去混合，边缘出现一圈黑边（缩放后特别明显）。
 * 这里在头部（`size:` 那一行后面）插一行进去，幂等 —— 已经有 pma 就什么都不做。
 */
async function fixEnemyAtlas(atlasPath: string): Promise<boolean> {
  let text: string;
  try {
    text = await readFile(atlasPath, 'utf8');
  } catch {
    return false;
  }
  if (/^\s*pma\s*:/m.test(text)) return false;
  const lines = text.split(/\r?\n/);
  const idx = lines.findIndex((line) => /^\s*size\s*:/.test(line));
  if (idx < 0) return false;
  lines.splice(idx + 1, 0, 'pma: true');
  await writeFile(atlasPath, lines.join('\n'), 'utf8');
  return true;
}

/** 简单的并发闸门 */
async function pool(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return results;
}

async function main() {
  log('============================================================');
  log('  抓取官方 Q 版小人素材（构建期用，不会进游戏包）');
  log('============================================================');
  log(`缓存目录：${cacheDir}`);
  log('');

  await mkdir(spineDir, { recursive: true });
  await mkdir(vendorDir, { recursive: true });

  // ---------- 1. 前端库 ----------
  log('[1/2] 前端库（无头页面渲染用）');
  for (const v of VENDOR) {
    try {
      const r = await download(v.url, join(vendorDir, v.file));
      log(`  ${r.skipped ? '已有' : '下载'} ${v.file}  ${(r.bytes / 1024).toFixed(0)} KB`);
    } catch (err) {
      log(`  ✗ ${v.file} 失败：${err.message}`);
      log('    这个拿不到就没法渲染，请检查网络后重跑。');
      process.exit(1);
    }
  }
  log('');

  // ---------- 2. 干员 + 召唤物的骨架 ----------
  /*
    ★ 名单来自 UNIT_DEFS（凡是声明了 charId 的棋子都要抓），不再只看干员表。
    这样召唤物（维娜的金色狮子）会自动被带上，以后再加也不用改脚本。
  */
  interface Entry {
    /** 本地目录名 / 游戏里的素材键 */
    defId: string;
    /** 官方骨架 id */
    charId: string;
    /** 去哪个仓库拿 */
    repo: string;
    /** 去掉仓库名之后的远程路径（不含扩展名） */
    remote: string;
    /** 要不要给 atlas 补 `pma: true`（敌人的图集是预乘 alpha 但没写） */
    pma: boolean;
    /**
     * ★ 0.1.1 藏品二版：走 prts.wiki CDN 的那两个（装置 / 我方机械）。
     * 有它就**完全不看 repo/remote**，直接用整条 URL（见 WIKI_SPINE_URLS）。
     */
    wikiBase?: string;
  }

  const entries: Entry[] = [];
  for (const def of Object.values(UNIT_DEFS)) {
    if (!def.charId) continue;
    if (only && !only.includes(def.id)) continue;
    /*
      ★ 第三类源优先判断：装置 / 我方机械 在社区库里**根本不存在**，
      按 charId 前缀（trap_ / enemy_）猜也猜不对（炎佑的 charId 是 enemy_ 开头
      但它不在 Ark-Models 里），所以名单写成显式的。
    */
    const wikiBase = WIKI_SPINE_URLS[def.id];
    if (wikiBase) {
      entries.push({ defId: def.id, charId: def.charId, repo: '', remote: '', pma: false, wikiBase });
      continue;
    }
    /*
      ★ 素材在哪个仓库是**按 charId 前缀**分的，不是按 "它是不是野怪" 分的：
        · 干员 / 召唤物 → fexli/ArknightsResource（`spine/<charId>/...`）
        · `enemy_*`     → isHarryh/Ark-Models（`models_enemies/<去掉前缀>/...`）
      早先这里写的是 `def.monsterOnly === true`，只是**野怪恰好都带 enemy_ 前缀**，
      于是"升变终态"这种「我方棋子 + 敌人骨架」（`op_amiya_core` 用集成战略 Boss
      `enemy_2092_skzamy`）会去干员仓库找一个不存在的路径，报 404。
      现在按前缀判断，两类都回到正确的仓库。
      （炎佑 `summon_yanyou` 的 charId 也是 enemy_ 开头，但它在
        `WIKI_SPINE_URLS` 里显式点名，走的是上面那条 continue，不受影响。）
    */
    const enemy = def.monsterOnly === true || def.charId.startsWith('enemy_');
    entries.push({
      defId: def.id,
      charId: def.charId,
      repo: enemy ? ENEMY_REPO : OPERATOR_REPO,
      remote: enemy ? enemyRemotePath(def.charId) : operatorRemotePath(def.charId, def.id),
      pma: enemy,
    });

    /*
      ★ 二阶段形态（只有部分野怪有）：**单独抓一套**，渲染到 `<defId>_2/`。
      游戏里这只野怪"重生"之后就换这套模型（见 combat-math 的 applyReborn）。
      两个 Boss 的二阶段在素材库里就是本体那套文件（2097/2099 目录里装的
      其实是 enemy_2082_skzdd / enemy_2089_skzjkl），所以它们的 reborn
      没有写 enemyId —— 也就不会在这里多抓一份重复的。
    */
    if (def.reborn?.enemyId) {
      entries.push({
        defId: `${def.id}_2`,
        charId: def.reborn.enemyId,
        repo: ENEMY_REPO,
        remote: enemyRemotePath(def.reborn.enemyId),
        pma: true,
      });
    }
  }

  const enemyCount = entries.filter((e) => e.pma).length;
  log(
    `[2/2] 小人 Spine 素材：${entries.length} 个（干员 + 有骨架的召唤物 + ${enemyCount} 套野怪/二阶段）`,
  );
  log('');

  let done = 0;
  let bytes = 0;
  const ok = {};
  const failed = [];

  await pool(entries, CONCURRENCY, async (entry) => {
    const { defId, charId, repo, remote, pma, wikiBase } = entry;
    const remoteDir = remote.slice(0, remote.lastIndexOf('/'));
    const local = join(spineDir, charId);
    /*
      ★ 取 URL 的唯一入口（两条语义分别对应"整条地址"和"仓库内相对路径"）。
      【为什么收成两个小函数？】下面"主文件"和"多页图集的其余贴图"两处都要取 URL，
      各写一遍条件判断的话，新加一类源一定会漏掉其中一处（漏的那处表现为
      "只下了第一页贴图，pixi-spine 报 atlas 加载失败"，排查方向还容易被带偏）。
    */
    const urlsForMain = (ext: string): string[] =>
      wikiBase
        ? [`${wikiBase}.${ext}`]
        : bothSources(repo, `${remote}.${ext}`);
    const urlsForPage = (page: string): string[] =>
      wikiBase
        ? [`${wikiBase.slice(0, wikiBase.lastIndexOf('/') + 1)}${page}`]
        : bothSources(repo, `${remoteDir}/${page}`);
    try {
      let size = 0;
      for (const ext of EXTENSIONS) {
        const r = await download(urlsForMain(ext), join(local, `${charId}.${ext}`));
        size += r.bytes;
      }
      // 敌人的图集要补 pma（幂等，已经有了就什么都不做）
      if (pma) await fixEnemyAtlas(join(local, `${charId}.atlas`));

      /*
        ★ 补下载「多页图集」的其余贴图。
        【为什么需要这一步？】一个 Spine 图集可以有**多个贴图页**，
        超出第一页的部分会被写进 `<charId>2.png`、`<charId>3.png`…
        （atlas 文件里每页的第一行就是它要的图片名）。
        如果只下 `<charId>.png`，pixi-spine 会报
        "Failed to load ...atlas / most likely your texture failed to load" ——
        报错里说的是 atlas，真正缺的其实是第二张 png，很容易带偏排查方向。
        （凯尔希·思衡托 char_1052_kalts2 就是这种：它有 char_1052_kalts22.png）
      */
      const atlasPath = join(local, `${charId}.atlas`);
      const pages = new Set<string>([`${charId}.png`]);
      try {
        const atlasText = await readFile(atlasPath, 'utf8');
        for (const line of atlasText.split(/\r?\n/)) {
          // 图集里"页"的标记就是一行裸的图片名（没有前导空格）
          if (/^\S+\.png\s*$/.test(line)) pages.add(line.trim());
        }
      } catch {
        // 读不到就按单页处理，不影响主流程
      }
      for (const page of pages) {
        if (page === `${charId}.png`) continue;
        const r = await download(urlsForPage(page), join(local, page));
        size += r.bytes;
      }

      ok[defId] = charId;
      bytes += size;
      done++;
      log(`  ✓ ${defId} ${charId}  ${(size / 1024).toFixed(0)} KB  (${done}/${entries.length})`);
    } catch (err) {
      failed.push([defId, charId, err.message]);
      log(`  ✗ ${defId} ${charId}  ${err.message}  —— 它会继续用半身像/色块占位`);
    }
  });

  /*
    ★ 合并进已有索引，而不是直接覆盖。
    【为什么？】`--only op46` 这种局部抓取如果覆盖掉 index.json，
    下一步 render-chibi 就只认识 op46 了 —— 其余 48 个小人全部"消失"，
    而且症状是"小人没了，但素材明明还在"，非常难查。
  */
  let merged: Record<string, string> = {};
  try {
    merged = JSON.parse(await readFile(indexFile, 'utf8'));
  } catch {
    merged = {};
  }
  Object.assign(merged, ok);
  await writeFile(indexFile, JSON.stringify(merged, null, 2) + '\n', 'utf8');

  log('');
  log('------------------------------------------------------------');
  log(`成功 ${Object.keys(ok).length} 个，失败 ${failed.length} 个，共 ${(bytes / 1048576).toFixed(1)} MB`);
  log(`索引写到 ${indexFile}`);
  if (failed.length) {
    log('');
    log('没抓到的棋子（游戏里会自动回退到半身像/色块，不影响可玩性）：');
    for (const [defId, charId, msg] of failed) log(`  ${defId} ${charId}  ${msg}`);
  }
  log('');
  log('下一步：  node scripts/render-chibi.mjs');
  log('  它会用无头浏览器把每个小人的 Idle/Attack/Skill/Die 逐帧渲染成');
  log('  apps/web/public/assets/chibi/ 下的横向序列帧 PNG。');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
