/**
 * 生成便携版 `app/launch.mjs`。
 *
 * 【为什么不直接 bundle scripts/launch.ts？】
 * 因为 launch.ts 是**开发用**启动器：它会先检查 node_modules、再跑一次 vite build、
 * 然后从 `apps/web/dist` 发页面。便携包里没有 node_modules、也早就不该再 build，
 * 页面在 `web/`。所以这里做三处"打包期改写"，而不是另抄一份启动器
 * （另抄一份 = 同一件事两处实现，以后改一处就漏一处）：
 *   1. 去掉「检查依赖」和「跑 vite build」两步；
 *   2. 页面目录 `apps/web/dist` → `web`；
 *   3. `../packages/server/src/main.js` → `./airnight-server.mjs`（外部文件，不打进来）。
 *
 * 用法：node scripts/build-portable-launch.mjs <输出文件>
 */
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outFile = process.argv[2];
if (!outFile) throw new Error('用法：node scripts/build-portable-launch.mjs <输出文件>');

/** 精确替换（找不到就直接报错，免得"静默没改成"） */
function replaceOnce(text, from, to, label) {
  if (!text.includes(from)) throw new Error(`改写失败（找不到锚点）：${label}`);
  return text.replace(from, to);
}

// ---------- 1. launch.ts -> launch-portable.ts ----------
let launch = readFileSync(join(repoRoot, 'scripts', 'launch.ts'), 'utf8');

launch = replaceOnce(
  launch,
  `  if (
    !existsSync(join(repoRoot, 'node_modules', 'vite')) ||
    !existsSync(join(repoRoot, 'node_modules', 'tsx'))
  ) {
    throw new FriendlyError(
      '还没装依赖（找不到 node_modules）。\\n' +
        '  先在项目文件夹里执行一次：\\n' +
        \`      \${C.cyan}node scripts\\\\pnpm.mjs install\${C.reset}\`,
    );
  }`,
  '  // ★ 便携包：依赖已内置，不做检查',
  '去掉依赖检查',
);

const buildStepStart = launch.indexOf('  if (!SKIP_BUILD) {');
// ★ 必须找**外层**的那个 `  }`：内层是 4 空格的 `    }`，用 "\n  }\n" 才不会误伤
const buildStepEnd = launch.indexOf('\n  }\n', launch.indexOf("'  修好之后重新双击启动即可。',"));
if (buildStepStart < 0 || buildStepEnd < 0) throw new Error('改写失败（找不到打包那一步）');
launch =
  launch.slice(0, buildStepStart) +
  '  // ★ 便携包：页面已经打包好，不再跑 vite build\n' +
  launch.slice(buildStepEnd + '\n  }\n'.length);

launch = replaceOnce(
  launch,
  `  const distIndex = join(repoRoot, 'apps', 'web', 'dist', 'index.html');`,
  `  const distIndex = join(repoRoot, 'web', 'index.html');`,
  '页面目录改 web/',
);
launch = replaceOnce(
  launch,
  `  const { startServer } = await import('../packages/server/src/main.js');
  const { createCombinedServer } = await import('./serve-static.mjs');`,
  `  const { startServer } = await import('./airnight-server.mjs');
  const { createCombinedServer } = await import('./serve-static-portable.mjs');`,
  '服务端改成同目录的 bundle',
);
const launchTmp = join(repoRoot, 'scripts', 'launch-portable.ts');
writeFileSync(launchTmp, launch, 'utf8');

// ---------- 2. serve-static.mjs -> serve-static-portable.mjs ----------
let stat = readFileSync(join(repoRoot, 'scripts', 'serve-static.mjs'), 'utf8');
stat = replaceOnce(
  stat,
  `const defaultDistDir = join(repoRoot, 'apps', 'web', 'dist');`,
  `const defaultDistDir = join(repoRoot, 'web');`,
  '静态目录改 web/',
);
/*
  ★★ 必须关掉 serve-static 的"直接运行就自己起服务器"分支。
  它被**打进 app/launch.mjs 里了**，于是 `import.meta.url` 就是 launch.mjs 自己，
  `process.argv[1]` 也是它 —— 判据恒成立，这一块会在 launch 之前先跑一遍：
  先占住 5173，然后 launch 自己的 listen 撞 EADDRINUSE，
  表现为"双击启动器永远报端口被占用"。
*/
stat = replaceOnce(
  stat,
  `const isDirectRun = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));`,
  `const isDirectRun = false;`,
  '关掉静态服务的直跑分支',
);
const statTmp = join(repoRoot, 'scripts', 'serve-static-portable.mjs');
writeFileSync(statTmp, stat, 'utf8');

// ---------- 3. esbuild ----------
const BANNER =
  'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);';
const esbuild = join(repoRoot, 'node_modules', 'esbuild', 'bin', 'esbuild');
const res = spawnSync(
  process.execPath,
  [
    esbuild,
    launchTmp,
    '--bundle',
    '--platform=node',
    '--format=esm',
    '--target=node18',
    `--outfile=${outFile}`,
    `--banner:js=${BANNER}`,
    '--external:./airnight-server.mjs',
  ],
  { cwd: repoRoot, stdio: 'inherit' },
);
unlinkSync(launchTmp);
unlinkSync(statTmp);
if (res.status !== 0) throw new Error('esbuild 打包失败');
console.log(`ok -> ${outFile}`);
