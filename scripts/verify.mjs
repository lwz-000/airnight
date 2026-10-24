#!/usr/bin/env node
/**
 * 一键验证：类型检查 + 单元测试 + 战斗演示。
 *
 * 每次改完代码（尤其是改数值表和技能）都跑一下这个：
 *   node scripts/verify.mjs
 *
 * 它会依次做三件事：
 *   1. TypeScript 类型检查  —— 找出「代码写错了」这类问题
 *   2. 单元测试            —— 确认「同一个种子必然打出同一场战斗」没被破坏
 *   3. 跑一场战斗并打印战报  —— 让你用眼睛确认战斗过程是否合理
 *
 * 【为什么要有这个脚本？】
 * 因为你改数值表的时候很容易引入「确定性 bug」（比如不小心用到了随机、
 * 或者依赖了对象属性的顺序）。这类 bug 不会报错，但会让联机对战不同步，
 * 而且极难排查。这个脚本就是专门防它的。
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');

const COLORS = {
  reset: '\u001b[0m',
  dim: '\u001b[2m',
  green: '\u001b[32m',
  red: '\u001b[31m',
  cyan: '\u001b[36m',
  yellow: '\u001b[33m',
};

function banner(text) {
  console.log(`\n${COLORS.cyan}${'='.repeat(64)}${COLORS.reset}`);
  console.log(`${COLORS.cyan}  ${text}${COLORS.reset}`);
  console.log(`${COLORS.cyan}${'='.repeat(64)}${COLORS.reset}`);
}

const steps = [];

// ---------- 步骤 1：类型检查 ----------
banner('步骤 1 / 4   类型检查（TypeScript）');
const tscBin = join(repoRoot, 'node_modules', 'typescript', 'bin', 'tsc');
if (!existsSync(tscBin)) {
  console.log(`${COLORS.yellow}跳过：还没安装依赖。先运行  node scripts/pnpm.mjs install${COLORS.reset}`);
  process.exit(1);
}
const tsc = spawnSync(process.execPath, [tscBin, '--noEmit', '-p', 'tsconfig.json'], {
  cwd: repoRoot,
  stdio: 'inherit',
});
if (tsc.status !== 0) {
  console.log(`\n${COLORS.red}类型检查失败。上面的报错指出了具体文件和行号。${COLORS.reset}`);
  process.exit(1);
}
console.log(`${COLORS.green}类型检查通过。${COLORS.reset}`);

// ---------- 步骤 2：数据表检查 ----------
banner('步骤 2 / 4   棋子数据表检查');
const tsxBin = join(repoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
if (!existsSync(tsxBin)) {
  console.log(`${COLORS.yellow}跳过：找不到 tsx。请运行  node scripts/pnpm.mjs install${COLORS.reset}`);
} else {
  const check = spawnSync(process.execPath, [tsxBin, 'scripts/check-data.ts'], {
    cwd: repoRoot,
    stdio: 'inherit',
  });
  if (check.status !== 0) {
    console.log(`\n${COLORS.red}数据表有「必须修」的错误。${COLORS.reset}`);
    console.log('上面的报告里每条都写了：哪个棋子、哪个字段、为什么错、怎么改。');
    console.log('改完 packages/shared/src/unit-data.ts 再跑一次本脚本。');
    process.exit(1);
  }
  console.log(`${COLORS.green}数据表检查通过。${COLORS.reset}`);
}

// ---------- 步骤 3：单元测试 ----------
banner('步骤 3 / 4   单元测试（确定性 / 战斗规则 / 联机 / 客户端）');
const vitestBin = join(repoRoot, 'node_modules', 'vitest', 'vitest.mjs');
if (!existsSync(vitestBin)) {
  console.log(`${COLORS.red}找不到 vitest，请先运行  node scripts/pnpm.mjs install${COLORS.reset}`);
  process.exit(1);
}
const vitest = spawnSync(process.execPath, [vitestBin, 'run', '--config', 'config/vitest.config.ts'], {
  cwd: repoRoot,
  stdio: 'inherit',
});
if (vitest.status !== 0) {
  console.log(`\n${COLORS.red}测试失败。${COLORS.reset}`);
  console.log('最常见的原因：改了战斗逻辑后，同一颗种子跑出了不同结果（确定性被破坏）。');
  console.log('如果不是这个问题，看上面的具体断言失败信息。');
  process.exit(1);
}
console.log(`${COLORS.green}全部测试通过。${COLORS.reset}`);

// ---------- 步骤 4：战斗演示 ----------
banner('步骤 4 / 4   战斗演示（跑一场，打两位数的场次统计）');
if (!existsSync(tsxBin)) {
  console.log(`${COLORS.yellow}跳过：找不到 tsx。${COLORS.reset}`);
  process.exit(0);
}
const demo = spawnSync(
  process.execPath,
  [tsxBin, 'packages/sim-cli/src/main.ts', '--seed', '20250101', '--stats', '--best-of', '30'],
  { cwd: repoRoot, stdio: 'inherit' },
);
if (demo.status !== 0) {
  console.log(`\n${COLORS.red}战斗演示运行失败。${COLORS.reset}`);
  process.exit(1);
}

banner('全部通过');
console.log(`${COLORS.green}内核状态良好。${COLORS.reset}`);
console.log('');
console.log('下一步可以做的事：');
console.log('  · 改数值：编辑 packages/shared/src/unit-data.ts，然后重跑本脚本');
console.log('  · 单看数据表：node scripts/pnpm.mjs check');
console.log('  · 看单场：node scripts/pnpm.mjs sim -- --seed 123 --stats --board');
console.log('  · 调平衡：node scripts/pnpm.mjs sim -- --best-of 200 --quiet');
console.log('  · 和朋友联机：node scripts/pnpm.mjs server 然后 node scripts/pnpm.mjs web');
console.log('');
