#!/usr/bin/env node
/**
 * ============================================================
 *  给「版本文件」下的分支改名（改名被 Windows 拒绝时的标准做法）
 * ============================================================
 *
 * 【为什么不能直接 mv？】
 * 在某些情况下（有进程的当前目录停在那个文件夹、或被句柄占着）
 * `mv 旧名 新名` 会直接 **Permission denied**，而且里面却完全能正常读写 ——
 * 这个报错极具误导性，会让人以为是权限/杀软问题。
 *
 * 【解法】新建目录 -> 逐个 `rename` 子项 -> 删掉空壳。
 * 子项能单独改名（它们没有被占），所以整棵树的搬迁总能成功；
 * 最后 `rmdir` 空壳，如果它仍被占着就地留一个空目录 + 说明文件。
 *
 * 用法（在分支里跑）：
 *   node scripts/rename-branch.mjs <新目录名>          # 预览
 *   node scripts/rename-branch.mjs <新目录名> --write   # 真的改
 */

import { readdirSync, renameSync, rmdirSync, mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const nextName = process.argv[2];
const WRITE = process.argv.includes('--write');
if (!nextName || nextName.startsWith('--')) {
  console.error('用法：node scripts/rename-branch.mjs <新目录名> [--write]');
  process.exit(1);
}

const from = ROOT;
const to = join(dirname(ROOT), nextName);
if (existsSync(to)) {
  console.error(`目标已存在：${to}`);
  process.exit(1);
}

const entries = readdirSync(from);
console.log(`把「${from}」改名为「${nextName}」—— 要搬 ${entries.length} 个子项`);
if (!WRITE) {
  console.log('（这是预览，加 --write 才真的改）');
  process.exit(0);
}

// ① 先试一次直接改名（能用最好，省事）
try {
  renameSync(from, to);
  console.log('✓ 直接改名成功');
  process.exit(0);
} catch {
  // ② 走"新建 + 逐个搬"
  mkdirSync(to, { recursive: true });
  let moved = 0;
  for (const name of entries) {
    renameSync(join(from, name), join(to, name));
    moved++;
  }
  console.log(`✓ 已搬 ${moved} 个子项 -> ${to}`);
  try {
    rmdirSync(from);
    console.log('✓ 空壳已删除');
  } catch {
    writeFileSync(
      join(from, '这是一次改名留下的空目录.txt'),
      `这个目录已经改名为：${nextName}\r\n（Windows 拒绝直接改名，改用"新建+逐个搬"，空壳删不掉时留下的占位）\r\n`,
      'utf8',
    );
    console.log('⚠ 空壳删不掉（被句柄占着），已放一个说明文件进去；重启后可以手动删掉它');
  }
}
