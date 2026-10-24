#!/usr/bin/env node
/**
 * 包装器：用 node 直接调用 pnpm，绕开 Windows PowerShell 的脚本执行策略限制。
 *
 * 【为什么需要这个？】
 * 你机器上 PowerShell 禁止运行 .ps1 脚本（Execution Policy），
 * 所以直接敲 `pnpm install` 会报「无法加载文件 pnpm.ps1」。
 * 这个脚本用 node 直接执行 pnpm 的 .mjs 入口，完全不走 PowerShell，因此不受影响。
 *
 * 用法：
 *   node scripts/pnpm.mjs install
 *   node scripts/pnpm.mjs test
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');

/** 找到全局安装的 pnpm 的 .mjs 入口 */
function findPnpm() {
  // 依次尝试几个常见位置
  const candidates = [];
  if (process.env.APPDATA) {
    candidates.push(join(process.env.APPDATA, 'npm', 'node_modules', 'pnpm', 'bin', 'pnpm.mjs'));
  }
  if (process.env.LOCALAPPDATA) {
    candidates.push(join(process.env.LOCALAPPDATA, 'pnpm', 'pnpm.mjs'));
  }
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  // 再扫一遍 AppData\Roaming\npm\node_modules 下有没有 pnpm
  const globalModules = process.env.APPDATA ? join(process.env.APPDATA, 'npm', 'node_modules') : null;
  if (globalModules && existsSync(globalModules)) {
    for (const entry of readdirSync(globalModules)) {
      const candidate = join(globalModules, entry, 'bin', 'pnpm.mjs');
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

const pnpmEntry = findPnpm();
if (!pnpmEntry) {
  console.error('找不到 pnpm。请先安装：  npm i -g pnpm');
  process.exit(1);
}

// 把 pnpm 的 store / 全局 / 缓存目录都指到项目内，
// 避免它去写用户目录（本机沙箱会拒绝）
const env = {
  ...process.env,
  PNPM_HOME: join(repoRoot, '.pnpm', 'home'),
  npm_config_store_dir: join(repoRoot, '.pnpm', 'store'),
  npm_config_cache: join(repoRoot, '.pnpm', 'cache'),
  npm_config_state_dir: join(repoRoot, '.pnpm', 'state'),
  npm_config_global_dir: join(repoRoot, '.pnpm', 'global'),
};

const result = spawnSync(process.execPath, [pnpmEntry, ...process.argv.slice(2)], {
  cwd: repoRoot,
  env,
  stdio: 'inherit',
});

process.exit(result.status ?? 1);
