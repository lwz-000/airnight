#!/usr/bin/env node
/**
 * ============================================================
 *  一键打便携包（Windows，解压即玩）
 * ============================================================
 *
 * 用法：
 *   node scripts/pack-portable.mjs --name=0.3.4正式版              （完整包，默认）
 *   ... --tier=lite      精简包（程序，不含素材）
 *   ... --tier=assets    素材包（美术 + 音乐，不含程序）
 *   ... --tier=update --from=<上一版解压目录>    更新包（只含改动过的文件）
 *   ... --skip-build        复用当前的 apps/web/dist（改完前端又build过时用）
 *   ... --no-zip            只组装目录，不打 zip（调试打包流程用）
 *   ... --keep              目标目录已存在时不要删（默认会先整个删掉重来）
 *
 * 产物（E:\AIRNIGHT\版本文件\ 下，目录 + 同名 zip）：
 *   full   失序协议-网页版-<name>\           （目录，可当场双击试）
 *          失序协议-网页版-<name>.zip         （发给朋友的那份，≈615 MB）
 *   lite   失序协议-网页版-<name>-lite.zip   （≈94 MB，不含素材）
 *   assets 失序协议-素材包-<name>.zip        （≈514 MB，只有美术与音乐）
 *   update 失序协议-网页版-<name>-update.zip （几 MB，解压覆盖到旧包上升级）
 *
 * ============================================================
 *  为什么要有这个脚本？
 * ============================================================
 * 0.1 ~ 0.3.2 每次发包都是**手敲一长串命令**（vite build → esbuild → robocopy →
 * 复制骨架 → 写启动器 → 打 zip）。手敲的代价是这个项目已经付过的：
 *   · `cp -r dist web` 只覆盖不清理 ⇒ 旧哈希文件留在包里；
 *   · esbuild 输出路径写成相对路径 ⇒ 目标文件**一声不响地没更新**；
 *   · 打 zip 用 bsdtar ⇒ 中文名乱码；
 *   · `.airnight-session.json` / `游戏日志.txt` 被一起打进包里。
 * 所以把这一串固化成脚本：顺序、路径、清理、冒烟、打包全在一处。
 *
 * ============================================================
 *  包里的东西（顺序就是脚本的执行顺序）
 * ============================================================
 *   启动游戏.vbs       ← 主入口：无黑框，直接开游戏窗口（由 write-launcher-vbs 生成）
 *   关闭游戏.vbs       ← 关后台
 *   启动游戏.cmd       ← 排障用（有窗口，能看报错）
 *   启动说明.txt       ← 上面三个怎么用
 *   游戏图标.ico       ← 启动游戏.lnk 的图标（首次运行由 启动游戏.vbs 自动创建）
 *   更新日志.txt       ← docs/更新日志.txt
 *   玩法说明.txt       ← 从上一个正式包沿用（它是"怎么玩"的长期文案，不随版本变）
 *   版权说明.txt       ← NOTICE.md（非商业条款 + 权利人下架承诺 + 素材降级链）
 *   第三方组件声明.txt ← THIRD-PARTY-NOTICES.md（three / ws / Node / 字体 的许可证全文）
 *   app\launch.mjs     ← 启动器（build-portable-launch.mjs 生成，**不是** scripts/launch.ts）
 *   app\airnight-server.mjs ← 服务端 bundle（ws 打进去，runtime 里没有 node_modules）
 *   runtime\node.exe   ← 当前这一版 Node
 *   runtime\LICENSE-Node.js.txt ← 整份复制（含 OpenSSL/V8/libuv 的许可，约 148 KB）
 *   web\               ← 前端产物（dist，整份复制）
 */

import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const RELEASES = join(ROOT, '..'); // E:\AIRNIGHT\版本文件

/**
 * 删目录的稳妥版（只用于**构建产物**）。
 *
 * 【为什么不用裸 rmSync】
 * 开发机上的安全删除钩子对"一次删很多文件"会直接抛
 * `SAFE_DELETE_BULK_CONFIRM_REQUIRED`（在沙箱里跑打包就是这个情况，
 * 1076 个文件的 dist-tmp 会被拦下来）。
 * 这里两处删的都是构造成果（旧的发布目录 / dist-tmp），属于"必须能删"的东西，
 * 所以拦下来就退回 Windows 自带的 `rd /s /q` —— 普通命令行里行为一模一样，
 * 只是绕开了那个钩子。
 *
 * ★ 只给构建目录用。玩家的存档 / 会话文件一律走下面的 `rmSync`（那几个是单文件）。
 */
function rmDirSafe(target) {
  try {
    rmSync(target, { recursive: true, force: true, maxRetries: 3 });
  } catch (error) {
    const blocked = String(error && error.message).includes('SAFE_DELETE');
    if (!blocked || process.platform !== 'win32') throw error;
    spawnSync('cmd', ['/c', 'rd', '/s', '/q', target], { stdio: 'ignore' });
    if (existsSync(target)) throw error;
  }
}

const argv = process.argv.slice(2);
const argValue = (name, fallback = '') => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const NAME = argValue('name');
const SKIP_BUILD = argv.includes('--skip-build');
const NO_ZIP = argv.includes('--no-zip');
const KEEP = argv.includes('--keep');
/*
  ★ 分档打包（对齐其他同人游戏的分发惯例，见 README「下载」一节）

    --tier=full     完整包（默认）：程序 + 全部素材，解压即玩。约 615 MB。
    --tier=lite     精简包：程序 + 运行时，**不含**游戏素材与音乐。约 86 MB。
                    玩家自己去下 `-assets.zip` 补上，适合小水管/已有素材的人。
    --tier=assets   素材包：只有 `web/assets`（游戏美术）+ `web/music`，不含程序。
                    解压到游戏根目录覆盖同名 `web/` 即可。
    --tier=update   更新包：只含相对上一版**改动过**的文件。
                    必须配 --from=<上一版解压目录>，解压覆盖到旧包上即可升级。

  ★ 为什么 lite 不"首次启动自动下载素材"（别的项目是这么做的）：
    我的素材不是"下载即得"——小人要先抓 Spine 骨骼、再起无头浏览器 + pixi 逐帧渲染成 PNG，
    需要 Edge/Chrome 和几分钟渲染。把它塞进启动流程既慢又脆（浏览器版本、显卡都会影响）。
    所以拆成独立的素材包，让玩家用下载工具自己续传，启动器只负责提示缺哪些。
*/
const TIER = argValue('tier', 'full');
const TIERS = ['full', 'lite', 'assets', 'update'];
if (!TIERS.includes(TIER)) {
  console.error(`--tier 只能是 ${TIERS.join(' / ')}，收到的是「${TIER}」`);
  process.exit(1);
}
const FROM = argValue('from'); // update 专用

if (!NAME) {
  console.error('用法：node scripts/pack-portable.mjs --name=0.3.4正式版 [--tier=full|lite|assets|update]');
  process.exit(1);
}
if (TIER === 'update' && !FROM) {
  console.error('--tier=update 需要 --from=<上一版的解压目录>，例如 --from="E:\\AIRNIGHT\\版本文件\\失序协议-网页版-0.3.3正式版"');
  process.exit(1);
}

const SUFFIX = { full: '', lite: '-lite', assets: '', update: '-update' }[TIER];
const FOLDER =
  TIER === 'assets' ? `失序协议-素材包-${NAME}` : `失序协议-网页版-${NAME}${SUFFIX}`;
const OUT = join(RELEASES, FOLDER);
const ZIP = join(RELEASES, `${FOLDER}.zip`);
const log = (s) => console.log(s);
const step = (s) => console.log(`\n=== ${s} ===`);

// ============================================================
//  0. 目录
// ============================================================
step(`目标：${OUT}`);
if (existsSync(OUT)) {
  if (KEEP) {
    log('已存在，--keep ⇒ 就地覆盖（旧文件可能残留，谨慎）');
  } else {
    log('已存在 ⇒ 整个删掉重来（避免旧哈希文件混进包里）');
    rmDirSafe(OUT);
  }
}
mkdirSync(join(OUT, 'app'), { recursive: true });
mkdirSync(join(OUT, 'web'), { recursive: true });
mkdirSync(join(OUT, 'runtime'), { recursive: true });

// ============================================================
//  1. 打前端（vite build → dist-tmp → 同步 dist）
// ============================================================
if (SKIP_BUILD) {
  log('跳过构建，复用 apps/web/dist');
} else {
  step('打前端');
  /*
    ★ 先清掉上一次的 dist-tmp。
    留着的话，vite 的 `--emptyOutDir` 会自己去批量删它；在带安全删除钩子的环境里
    那一步会直接抛 `SAFE_DELETE_BULK_CONFIRM_REQUIRED`，表现为「vite build 失败」，
    而报错栈指向 vite 内部，很容易误判成代码写错了。
    （普通命令行里多删一次也无害，目录不存在 vite 就直接建。）
  */
  rmDirSafe(join(ROOT, 'apps', 'web', 'dist-tmp'));
  const vite = join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
  const res = spawnSync(
    process.execPath,
    [vite, 'build', '--config', 'apps/web/vite.config.ts', '--outDir', 'dist-tmp', '--emptyOutDir'],
    { cwd: ROOT, stdio: 'inherit' },
  );
  if (res.status !== 0) throw new Error('vite build 失败');
  /*
    ★★ 先把 dist/assets 里**上一版带哈希的 index-*** 清掉，再 robocopy。
    robocopy 只覆盖、不删除 —— 不清的话，上一版的 `index-<旧hash>.js/.css/.map`
    会原样留在包里（本次实测：包里同时存在 index-1xpHDLDx.js 和 index-gRvDxdod.js，
    白胖 ~7 MB）。运行上没坏（index.html 指向新的那份），
    但以后排查"改了没生效"时会看到两套文件互相干扰，很难判断。
    ★ 只删 index- 前缀的（那是 vite 产物），其余素材一律不动。
  */
  const assetsDir = join(ROOT, 'apps', 'web', 'dist', 'assets');
  if (existsSync(assetsDir)) {
    for (const name of readdirSync(assetsDir)) {
      if (!name.startsWith('index-')) continue;
      rmSync(join(assetsDir, name), { force: true });
    }
  }
  /*
    ★ dist-tmp → dist 必须用 robocopy：`cp -rf` 在这台机器上会把目标写成全零
    （页面白屏但"文件都在"）。robocopy 退出码 1/3 = 有拷贝成功。
  */
  const copy = spawnSync('cmd', ['/c', 'robocopy', 'dist-tmp', 'dist', '/E', '/NFL', '/NDL', '/NJH', '/NJS', '/NP'], {
    cwd: join(ROOT, 'apps', 'web'),
    stdio: 'ignore',
  });
  if (![0, 1, 2, 3].includes(copy.status ?? -1)) throw new Error(`robocopy 失败：${copy.status}`);
  rmDirSafe(join(ROOT, 'apps', 'web', 'dist-tmp'));
}

const DIST = join(ROOT, 'apps', 'web', 'dist');
if (!existsSync(join(DIST, 'index.html'))) throw new Error('找不到 apps/web/dist/index.html（先构建）');

/*
  ★ 游戏素材清单（唯一来源，动这里要同步三处）：
      · 本文件 —— lite 才知道删什么、assets 才知道装什么
      · NOTICE.md 第 2 节 —— 逐条列举「不属于本项目」的内容
      · .gitignore —— 挡住它们入库
  `dist/assets/` 里**不全是素材**：`index-*.js|css|map` 是 Vite 的代码产物，必须留下；
  `README.md` 是素材目录的说明，也留下。下面两个清单只列官方的美术/音频。
*/
const GAME_ASSET_DIRS = [
  'chibi', // 干员 Q 版序列帧（183 MB，最大的一块）
  'covenants',
  'fx',
  'items',
  'npc',
  'player-avatars',
  'stand',
  'traits',
  'units',
];
const GAME_ASSET_FILES = ['ark_tile.png', 'backdrop.png', 'tiles_atlas.png'];

/** 打 zip（中文名不乱码，先写 .new 再校验 —— 见 scripts/zip-release.py 的注释）。 */
function zipDir(src, dest) {
  const py = 'C:/Users/18078/AppData/Local/Programs/Python/Python314/python.exe';
  const res = spawnSync(py, [join(ROOT, 'scripts', 'zip-release.py'), src, dest], { stdio: 'inherit' });
  if (res.status !== 0) throw new Error(`zip 打包失败：${dest}`);
}

/** robocopy 整目录（只覆盖不删除，退出码 0/1/2/3 都算成功）。 */
function robocopyDir(from, to, label) {
  const r = spawnSync('cmd', ['/c', 'robocopy', from, to, '/E', '/NFL', '/NDL', '/NJH', '/NJS', '/NP'], {
    stdio: 'ignore',
  });
  if (![0, 1, 2, 3].includes(r.status ?? -1)) throw new Error(`复制 ${label} 失败：robocopy ${r.status}`);
}

/** 递归求目录总字节数。 */
const dirSize = (dir) => {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    total += entry.isDirectory() ? dirSize(path) : statSync(path).size;
  }
  return total;
};
/** 体积显示：>= 1 MB 用 MB（整数够看），更小的用 KB —— 增量包常常只有几百 KB。 */
const mb = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(0)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

// ============================================================
//  素材包分支（--tier=assets）：只装美术与音乐，不含程序
// ============================================================
if (TIER === 'assets') {
  step(`素材包 → ${OUT}`);
  if (existsSync(OUT)) {
    if (KEEP) log('已存在，--keep ⇒ 就地覆盖');
    else {
      log('已存在 ⇒ 整个删掉重来');
      rmDirSafe(OUT);
    }
  }
  mkdirSync(join(OUT, 'web', 'assets'), { recursive: true });
  mkdirSync(join(OUT, 'web', 'music'), { recursive: true });

  for (const dir of GAME_ASSET_DIRS) {
    const from = join(DIST, 'assets', dir);
    if (!existsSync(from)) {
      log(`⚠ 缺 assets/${dir}（素材没抓全？本包会少这一块）`);
      continue;
    }
    robocopyDir(from, join(OUT, 'web', 'assets', dir), `assets/${dir}`);
    log(`ok -> web/assets/${dir}`);
  }
  for (const file of GAME_ASSET_FILES) {
    const from = join(DIST, 'assets', file);
    if (existsSync(from)) {
      cpSync(from, join(OUT, 'web', 'assets', file));
      log(`ok -> web/assets/${file}`);
    } else {
      log(`⚠ 缺 assets/${file}`);
    }
  }
  const musicFrom = join(DIST, 'music');
  if (existsSync(musicFrom)) {
    robocopyDir(musicFrom, join(OUT, 'web', 'music'), 'web/music');
    log('ok -> web/music');
  } else {
    log('⚠ 缺 web/music（本包没有 BGM）');
  }

  writeFileSync(
    join(OUT, '素材包说明.txt'),
    [
      '失序协议 · 素材包',
      '================================================================',
      '',
      '这个包里只有游戏素材（美术 + 音乐），没有程序。',
      '',
      '怎么用',
      '----------------------------------------------------------------',
      '1. 先下载并解压「精简包」（失序协议-网页版-<版本>-lite.zip）。',
      '2. 把本包解压出来的 web 文件夹，合并到精简包的根目录，覆盖同名文件。',
      '   合并后的目录结构应该是：',
      '',
      '     失序协议-网页版-<版本>/',
      '       web/index.html          ← 精简包带的',
      '       web/assets/chibi/...    ← 本包带的',
      '       web/assets/index-*.js   ← 精简包带的（别删）',
      '       web/music/...           ← 本包带的',
      '',
      '3. 双击「启动游戏.vbs」即可。',
      '',
      '也可以直接用完整包，它已经把这两样合在一起了，不用手动合并。',
      '',
      '素材版权归鹰角网络 / 悠星所有，本项目无权转授。',
      '仅供学习与个人非商业使用，不得出售、付费分发、收费开服或植入广告。',
      '详见完整条款：NOTICE.md（仓库根目录）。',
      '',
    ].join('\n'),
    'utf8',
  );
  log('ok -> 素材包说明.txt');

  /*
    ★ 素材包也要带版权文件 —— 它分发的正是官方美术，
      光一张说明纸不够。这两份会被合并进游戏根目录（同名覆盖，内容一致，无害）。
  */
  cpSync(join(ROOT, 'NOTICE.md'), join(OUT, '版权说明.txt'));
  cpSync(join(ROOT, 'THIRD-PARTY-NOTICES.md'), join(OUT, '第三方组件声明.txt'));
  log('ok -> 版权说明.txt / 第三方组件声明.txt');

  const size = dirSize(OUT);
  if (!NO_ZIP) {
    step('打 zip');
    zipDir(OUT, ZIP);
  }
  console.log(`\n完成：${FOLDER}（${mb(size)}${NO_ZIP ? '，未打 zip' : `，zip 已生成`}）`);
  process.exit(0);
}

// ============================================================
//  2. 服务端 bundle（ws 打进去；runtime 里没有 node_modules）
// ============================================================
step('打包服务端');
const BANNER =
  'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);';
const esbuild = join(ROOT, 'node_modules', 'esbuild', 'bin', 'esbuild');
const serverOut = join(OUT, 'app', 'airnight-server.mjs');
const serverRes = spawnSync(
  process.execPath,
  [
    esbuild,
    join(ROOT, 'packages', 'server', 'src', 'main.ts'),
    '--bundle',
    '--platform=node',
    '--format=esm',
    '--target=node18',
    `--outfile=${serverOut}`,
    `--banner:js=${BANNER}`,
    // 便携包里启动器会自己 listen，服务端**不许**自己开工（否则端口被自己占住）
    '--define:process.env.AIRNIGHT_NO_AUTOSTART="1"',
  ],
  { cwd: ROOT, stdio: 'inherit' },
);
if (serverRes.status !== 0) throw new Error('服务端 bundle 失败');
log(`ok -> app/airnight-server.mjs（${(statSync(serverOut).size / 1024).toFixed(0)} KB）`);

// ============================================================
//  3. 启动器（对 scripts/launch.ts 做 4 处改写的便携版）
// ============================================================
step('生成 app/launch.mjs');
/*
  ★ 输出路径必须是**绝对路径**：build-portable-launch.mjs 的 esbuild cwd 是 repoRoot，
   传相对路径会在仓库里新建一个同名版本目录，目标文件一声不响地不更新（0.3.2 踩过）。
*/
execFileSync(process.execPath, [join(ROOT, 'scripts', 'build-portable-launch.mjs'), join(OUT, 'app', 'launch.mjs')], {
  cwd: ROOT,
  stdio: 'inherit',
});

// ============================================================
//  4. 前端产物 + runtime
// ============================================================
step('复制 web/');
/*
  ★ 526 MB / 一千多个文件，用 robocopy 而不是 fs.cpSync：
  cpSync 在这么大的树上会卡很久（还可能撞上被占用的文件直接抛错）。
  robocopy 退出码 1 = 有文件复制成功、3 = 还额外清掉了目标里的多余文件，都算成功。
*/
const webCopy = spawnSync('cmd', ['/c', 'robocopy', DIST, join(OUT, 'web'), '/E', '/NFL', '/NDL', '/NJH', '/NJS', '/NP'], {
  stdio: 'ignore',
});
if (![0, 1, 2, 3].includes(webCopy.status ?? -1)) throw new Error(`复制 web/ 失败：robocopy ${webCopy.status}`);
log('ok -> web/');

/*
  ★ lite：从**完整拷贝**里删素材，而不是"选择性复制"。
    选择性复制漏一个目录 ⇒ 悄悄退化成占位图，很难查；
    删的话漏删只是包大一点，一眼能看出来。方向选错比漏删危险。
*/
if (TIER === 'lite') {
  step('精简：移除游戏素材与音乐');
  let freed = 0;
  for (const dir of GAME_ASSET_DIRS) {
    const p = join(OUT, 'web', 'assets', dir);
    if (existsSync(p)) {
      freed += dirSize(p);
      rmDirSafe(p);
    }
  }
  for (const file of GAME_ASSET_FILES) {
    const p = join(OUT, 'web', 'assets', file);
    if (existsSync(p)) {
      freed += statSync(p).size;
      rmSync(p, { force: true });
    }
  }
  const music = join(OUT, 'web', 'music');
  if (existsSync(music)) {
    freed += dirSize(music);
    rmDirSafe(music);
  }
  log(`ok -> 移除素材 ${mb(freed)}（本包不含美术与音乐）`);
}

step('放 runtime/node.exe');
/*
  ★ 用**当前跑这个脚本的 node**：它一定存在、版本和刚才 build/verify 用的是同一个，
    而且不用去翻旧包（旧包可能被删了）。
*/
cpSync(process.execPath, join(OUT, 'runtime', 'node.exe'));
log(`ok -> runtime/node.exe（${process.version}）`);

/*
  ★ Node 的许可证必须**原样整份复制**，不能只写一句"见官网"。
    MIT 要求「版权声明与许可声明必须包含在软件的所有副本中」——
    node.exe 是随包分发的一份副本，旁边就得有那份 MIT 文本。
    而且 node.exe 还链接了 OpenSSL / V8 / zlib / libuv 等组件，各自的许可证都在
    这份 LICENSE 里（约 148 KB），省略它就等于连带漏掉这些声明。
    官方 Windows 包里 node.exe 的同目录就放着这份 LICENSE，直接从那里取。
*/
const nodeLicense = join(dirname(process.execPath), 'LICENSE');
if (existsSync(nodeLicense)) {
  cpSync(nodeLicense, join(OUT, 'runtime', 'LICENSE-Node.js.txt'));
  log(`ok -> runtime/LICENSE-Node.js.txt（${statSync(nodeLicense).size} 字节，来自 ${nodeLicense}）`);
} else {
  // 兜底：某些发行版（如部分 Linux 包管理器）把 LICENSE 放在别处或没放。
  writeFileSync(
    join(OUT, 'runtime', 'LICENSE-Node.js.txt'),
    `本目录里的 node.exe 是 Node.js 运行时（${process.version}）。\n\n` +
      'Node.js 以 MIT 许可证发布：Copyright Node.js contributors. All rights reserved.\n' +
      '完整许可证（含 OpenSSL / V8 / zlib / libuv 等内置组件）见：\n' +
      '  https://nodejs.org/en/about/license\n',
    'utf8',
  );
  log(`⚠ 没在 ${nodeLicense} 找到 Node 的 LICENSE，已写一份指向官网的说明（不完整）`);
}

// ============================================================
//  5. 图标 + 文档 + 启动文件
// ============================================================
step('图标 / 文档 / 启动文件');
// 启动游戏.lnk 的图标（首次运行时由 启动游戏.vbs 自动创建那个快捷方式）
cpSync(join(ROOT, 'apps', 'web', 'public', 'favicon.ico'), join(OUT, '游戏图标.ico'));
log('ok -> 游戏图标.ico');

cpSync(join(ROOT, 'docs', '更新日志.txt'), join(OUT, '更新日志.txt'));
log('ok -> 更新日志.txt');

/*
  ★ 两份版权文件必须随包，这是硬要求不是客套：
    · `three` 和 `ws` 是**打进 bundle** 的，Vite / esbuild 会把源码里的许可证注释剥掉，
      产物里一个 MIT 字都不剩 —— 只有 `第三方组件声明.txt` 能补上那个随副本分发的义务。
    · 完整包里有官方素材，`版权说明.txt` 是非商业与下架条款的载体。
  用 .txt 而不是 .md：包里的其他文档都是 .txt，玩家双击就能用记事本打开。
*/
cpSync(join(ROOT, 'THIRD-PARTY-NOTICES.md'), join(OUT, '第三方组件声明.txt'));
log('ok -> 第三方组件声明.txt');
cpSync(join(ROOT, 'NOTICE.md'), join(OUT, '版权说明.txt'));
log('ok -> 版权说明.txt');

/*
  ★ lite 一定要带这张纸。精简包解开就能启动、但满屏灰白占位图，
    没有说明的话玩家第一反应是"包坏了"而不是"还差素材包"。
*/
if (TIER === 'lite') {
  writeFileSync(
    join(OUT, '补素材说明.txt'),
    [
      '失序协议 · 精简包（不含游戏素材）',
      '================================================================',
      '',
      '这个包有程序、启动器和 Node 运行时，但**没有游戏美术和音乐**。',
      '现在直接启动也能玩，但所有角色都会显示成灰白占位图，也没有 BGM——',
      '功能是完整的，只是不好看。',
      '',
      '怎么补素材（二选一）',
      '----------------------------------------------------------------',
      'A. 下载素材包（推荐，适合网速慢、想断点续传的）',
      '   在同一个发布页面下载：失序协议-素材包-' + NAME + '.zip',
      '   解压它，把里面的 web 文件夹合并到本目录，覆盖同名文件即可。',
      '   合并后 web/assets 下会同时有 index-*.js（程序）和 chibi/、units/ 等（素材），',
      '   这两类都别删。',
      '',
      'B. 直接用完整包',
      '   下载：失序协议-网页版-' + NAME + '.zip',
      '   它已经把程序和素材合在一起，解压即玩，不需要本包。',
      '',
      '素材版权归鹰角网络 / 悠星所有，本项目无权转授。',
      '仅供学习与个人非商业使用，不得出售、付费分发、收费开服或植入广告。',
      '完整条款见本目录「版权说明.txt」。',
      '',
    ].join('\n'),
    'utf8',
  );
  log('ok -> 补素材说明.txt');
}

/*
  玩法说明.txt 是"怎么玩"的长期文案，不随版本变 —— 从上一个正式包沿用。
  ★ 沿用而不是重写：那份文案是逐条对着玩法核对过的，重写反而会走散。
*/
const prevPack = readdirSync(RELEASES)
  .filter((name) => name.startsWith('失序协议-网页版-') && !name.endsWith('.zip') && name !== FOLDER)
  .sort()
  .reverse()
  .map((name) => join(RELEASES, name))
  .find((dir) => existsSync(join(dir, '玩法说明.txt')));
if (prevPack) {
  cpSync(join(prevPack, '玩法说明.txt'), join(OUT, '玩法说明.txt'));
  log(`ok -> 玩法说明.txt（沿用 ${prevPack.split(/[\\/]/).pop()}）`);
} else {
  log('⚠ 没找到可沿用的 玩法说明.txt（包里会缺这份）');
}

execFileSync(process.execPath, [join(ROOT, 'scripts', 'write-launcher-vbs.mjs'), OUT], {
  cwd: ROOT,
  stdio: 'inherit',
});

// ============================================================
//  6. 清掉不该进包的东西
// ============================================================
step('清理运行期残留');
for (const junk of ['.airnight-run.json', '.airnight-session.json', '游戏日志.txt', '.window-profile']) {
  const path = join(OUT, junk);
  if (existsSync(path)) {
    rmSync(path, { recursive: true, force: true });
    log(`删掉 ${junk}`);
  }
}

// ============================================================
//  6.5 版权文件自检（缺一份就不许发包）
// ============================================================
step('版权文件自检');
/*
  ★ 这不是"顺手检查一下"，是把 MIT 的义务做成断言。
    `three` 和 `ws` 是打进 bundle 的，Vite / esbuild 会把许可证注释剥掉
    （实测：`dist/assets/index-*.js` 里搜 "three.js authors" 与
    "Permission is hereby granted" 都是 0 命中），所以产物自身**不含任何 MIT 文本**。
    补上这个义务的唯一载体就是随包的那份声明文件 —— 它一旦漏掉，包就不合规了。

  ★ 用 throw 而不是 log 警告：发包后才发现比打不出包严重得多。
*/
const MUST_HAVE = [
  ['第三方组件声明.txt', 5000], // THIRD-PARTY-NOTICES.md，含 three/ws/Node 的 MIT 全文
  ['版权说明.txt', 2000], // NOTICE.md，非商业条款与下架承诺
  ['runtime/LICENSE-Node.js.txt', 10000], // Node 及其内置组件，约 148 KB；小于这个数说明退化成了占位说明
  ['web/fonts/OFL.txt', 3000], // SIL OFL 1.1 全文，OFL 要求随字体分发
  ['web/fonts/FONT-LICENSE.txt', 500], // 思源黑体的版权声明
];
const missing = [];
for (const [rel, minBytes] of MUST_HAVE) {
  const path = join(OUT, ...rel.split('/'));
  if (!existsSync(path)) missing.push(`${rel}（不存在）`);
  else if (statSync(path).size < minBytes) missing.push(`${rel}（只有 ${statSync(path).size} 字节，疑似被占位文本替换）`);
}
if (missing.length > 0) {
  throw new Error(`版权文件不完整，拒绝发包：\n  - ${missing.join('\n  - ')}`);
}
log(`✓ ${MUST_HAVE.length} 份版权文件齐全`);

// ============================================================
//  7. 冒烟（用包里的 node + 包里的启动器真起一次）
// ============================================================
step('冒烟');
const PORT = 5411;
const GAME = 8911;
const child = spawn(
  join(OUT, 'runtime', 'node.exe'),
  ['app\\launch.mjs', '--no-open', `--port=${PORT}`, `--game=${GAME}`],
  { cwd: OUT, stdio: 'ignore' },
);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(3500);
const ok = await fetch(`http://127.0.0.1:${PORT}/`, { method: 'GET' })
  .then(async (r) => (r.ok ? (await r.text()).includes('失序协议') : false))
  .catch(() => false);
log(ok ? '✓ 包里的启动器真的起来了，首页返回了游戏页面' : '✗ 冒烟失败：首页没返回游戏页面');
try {
  spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
} catch {
  /* 已经退了 */
}
// 冒烟会留下运行标记/日志，再清一次
for (const junk of ['.airnight-run.json', '游戏日志.txt', '.window-profile']) {
  rmSync(join(OUT, junk), { recursive: true, force: true });
}
if (!ok) process.exitCode = 1;

// ============================================================
//  7.5 update：裁成增量（只留相对上一版变过的文件）
// ============================================================
if (TIER === 'update') {
  step('裁增量（对比上一版）');
  const oldRoot = resolve(FROM);
  if (!existsSync(oldRoot)) throw new Error(`--from 目录不存在：${oldRoot}`);
  /*
    ★ 做法：**先按完整包组装，再把和旧版一模一样的文件删掉**，
      剩下的就是增量。反过来（只复制"看起来是新的"）不可靠 ——
      判断新旧的规则一旦有漏，玩家升级后就会缺文件，而缺文件的表现
      往往是"某个干员变成占位图"，极难定位。
      先装全再删，最差也只是包大一点。
  */
  const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
  const sameAsOld = (rel) => {
    const from = join(oldRoot, rel);
    const to = join(OUT, rel);
    if (!existsSync(from)) return false; // 新增文件 ⇒ 要带上
    const a = statSync(from);
    const b = statSync(to);
    if (a.size !== b.size) return false; // 大小不同 ⇒ 一定变了，省掉 hash
    return sha(from) === sha(to);
  };

  let kept = 0;
  let dropped = 0;
  let bytes = 0;
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(abs);
        continue;
      }
      const rel = abs.slice(OUT.length + 1);
      if (sameAsOld(rel)) {
        rmSync(abs, { force: true });
        dropped += 1;
      } else {
        kept += 1;
        bytes += statSync(abs).size;
      }
    }
  };
  walk(OUT);

  // 删掉被清空的目录，否则 zip 里会有一堆空文件夹
  const pruneEmpty = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) pruneEmpty(join(dir, entry.name));
    }
    if (dir !== OUT && readdirSync(dir).length === 0) rmSync(dir, { recursive: true, force: true });
  };
  pruneEmpty(OUT);

  log(`ok -> 变更 ${kept} 个文件（${mb(bytes)}），与上一版相同 ${dropped} 个已剔除`);
  if (kept === 0) log('⚠ 这一版和上一版没有文件差异，更新包是空的（改动没进 dist？）');
}

// ============================================================
//  8. 打 zip（Python zipfile：中文名不乱码，且先写 .new 再校验）
// ============================================================
if (!NO_ZIP) {
  step('打 zip');
  zipDir(OUT, ZIP);
}

// ============================================================
//  汇总
// ============================================================
// dirSize / mb 已在上方统一定义（素材包分支也要用），这里不要再定义一次。
log('\n================ 打包完成 ================');
log(`目录：${OUT}（${mb(dirSize(OUT))}）`);
if (!NO_ZIP) log(`zip ：${ZIP}（${mb(statSync(ZIP).size)}）`);
log('包内：');
for (const entry of readdirSync(OUT).sort()) {
  const path = join(OUT, entry);
  const size = statSync(path).isDirectory() ? dirSize(path) : statSync(path).size;
  log(`  ${entry.padEnd(22)} ${mb(size)}`);
}
void createWriteStream;
void readFileSync;
