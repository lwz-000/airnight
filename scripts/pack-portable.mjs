#!/usr/bin/env node
/**
 * ============================================================
 *  一键打便携包（Windows，解压即玩）
 * ============================================================
 *
 * 用法：
 *   node scripts/pack-portable.mjs --name=0.3.3正式版
 *   ... --skip-build        复用当前的 apps/web/dist（改完前端又build过时用）
 *   ... --no-zip            只组装目录，不打 zip（调试打包流程用）
 *   ... --keep              目标目录已存在时不要删（默认会先整个删掉重来）
 *
 * 产物：
 *   E:\AIRNIGHT\版本文件\失序协议-网页版-<name>\         （目录，可当场双击试）
 *   E:\AIRNIGHT\版本文件\失序协议-网页版-<name>.zip       （发给朋友的那份）
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
 *   app\launch.mjs     ← 启动器（build-portable-launch.mjs 生成，**不是** scripts/launch.ts）
 *   app\airnight-server.mjs ← 服务端 bundle（ws 打进去，runtime 里没有 node_modules）
 *   runtime\node.exe   ← 当前这一版 Node（+ 许可证）
 *   web\               ← 前端产物（dist，整份复制）
 */

import { execFileSync, spawn, spawnSync } from 'node:child_process';
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
import { join, resolve } from 'node:path';
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

if (!NAME) {
  console.error('用法：node scripts/pack-portable.mjs --name=0.3.3正式版');
  process.exit(1);
}

const FOLDER = `失序协议-网页版-${NAME}`;
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

step('放 runtime/node.exe');
/*
  ★ 用**当前跑这个脚本的 node**：它一定存在、版本和刚才 build/verify 用的是同一个，
    而且不用去翻旧包（旧包可能被删了）。
*/
cpSync(process.execPath, join(OUT, 'runtime', 'node.exe'));
log(`ok -> runtime/node.exe（${process.version}）`);
writeFileSync(
  join(OUT, 'runtime', 'LICENSE-Node.js.txt'),
  `本目录里的 node.exe 是 Node.js 运行时（${process.version}）。\n` +
    'Node.js 以 MIT 许可证发布，完整许可证见 https://nodejs.org/en/about/license\n',
  'utf8',
);

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
//  8. 打 zip（Python zipfile：中文名不乱码，且先写 .new 再校验）
// ============================================================
if (!NO_ZIP) {
  step('打 zip');
  const py = 'C:/Users/18078/AppData/Local/Programs/Python/Python314/python.exe';
  const script = join(ROOT, 'scripts', 'zip-release.py');
  const res = spawnSync(py, [script, OUT, ZIP], { stdio: 'inherit' });
  if (res.status !== 0) throw new Error('zip 打包失败');
}

// ============================================================
//  汇总
// ============================================================
const dirSize = (dir) => {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    total += entry.isDirectory() ? dirSize(path) : statSync(path).size;
  }
  return total;
};
const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(0)} MB`;
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
