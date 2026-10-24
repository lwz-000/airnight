#!/usr/bin/env node
/**
 * ============================================================
 *  修复工作区软链接（改名 / 移动目录之后必跑）
 * ============================================================
 *
 * 【为什么需要它？】
 * pnpm 给 `@airnight/shared` 建的是**绝对路径**软链（junction）：
 *
 *   apps/web/node_modules/@airnight/shared -> /e/AIRNIGHT/版本文件/0.1.1测试版/packages/shared
 *
 * 一旦把分支目录改名（0.1.1测试版 -> 0.1.2测试版），这条链就指向一个
 * 不存在的路径 —— 表现为 tsx/vite/vitest 全部 MODULE_NOT_FOUND，
 * 而报错信息（"找不到 @airnight/shared"）完全看不出是软链过期。
 *
 * 【它怎么修？】
 * 扫仓库里所有 `node_modules/@airnight/*` 的软链：
 *   · 目标存在  -> 跳过
 *   · 目标不存在 -> 把目标串里的"旧根目录"换成"当前根目录"，重建链接
 *     （旧根目录 = 目标串中 `packages/shared` 之前的那一段）
 *
 * 用法：node scripts/fix-workspace-links.mjs        # 只看报告
 *      node scripts/fix-workspace-links.mjs --write # 真的修
 */

import { readdirSync, readFileSync, readlinkSync, existsSync, lstatSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WRITE = process.argv.includes('--write');

/** 递归收集仓库里的软链（只下潜到 node_modules/<scope>/<name> 这一层，别把 .pnpm 挖穿） */
function collectLinks(dir, depth = 0, out = []) {
  if (depth > 4) return out;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      out.push(full);
      continue;
    }
    if (!entry.isDirectory()) continue;
    // .pnpm / .vite 这些是缓存目录，没有我们要修的东西
    if (entry.name === '.pnpm' || entry.name === '.vite' || entry.name === '.vite-temp') continue;
    collectLinks(full, depth + 1, out);
  }
  return out;
}

/**
 * 每个 workspace 包声明了哪些 `@airnight/*` 依赖 —— 缺链接时按它重建。
 * （`@airnight/shared` -> `<root>/packages/shared`）
 */
function expectedLinks() {
  const out = [];
  for (const group of ['packages', 'apps']) {
    for (const name of readdirSync(join(ROOT, group))) {
      const dir = join(ROOT, group, name);
      let pkg;
      try {
        pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
      } catch {
        continue;
      }
      const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
      for (const dep of Object.keys(deps)) {
        const m = dep.match(/^@airnight\/(.+)$/);
        if (!m) continue;
        out.push({
          link: join(dir, 'node_modules', '@airnight', m[1]),
          target: join(ROOT, 'packages', m[1]),
        });
      }
    }
  }
  return out;
}

/**
 * 链接项**本身**在不在（不看它指向哪）。
 *
 * ★ 不能用 `existsSync`：它**跟随**链接，所以"指向旧分支的断链"会返回 false，
 * 于是下面的补链逻辑以为"这里没有链接"、去 `symlinkSync` —— 而那个名字其实还在，
 * 直接 EEXIST 把整个脚本炸掉（2026-10-14 改名 0.1.2→0.1.3 时踩到）。
 * 用 `lstatSync` 只 stat 链接自身，断链也算"在"，交给第 ② 遍按目标串修。
 */
function linkEntryExists(link) {
  try {
    lstatSync(link);
    return true;
  } catch {
    return false;
  }
}

let fixed = 0;
let ok = 0;

// ① 先补齐"整个链接都不见了"的（改名后常见）
for (const { link, target } of expectedLinks()) {
  if (linkEntryExists(link)) continue;
  if (!existsSync(target)) {
    console.log(`⚠ 目标不存在，跳过：${link} -> ${target}`);
    continue;
  }
  if (!WRITE) {
    console.log(`将补：${relative(ROOT, link)} -> ${target}`);
    fixed++;
    continue;
  }
  mkdirSync(dirname(link), { recursive: true });
  symlinkSync(target, link, 'junction');
  console.log(`✓ 已补：${relative(ROOT, link)} -> ${target}`);
  fixed++;
}
for (const link of collectLinks(join(ROOT, 'node_modules')).concat(
  collectLinks(join(ROOT, 'apps')),
  collectLinks(join(ROOT, 'packages')),
)) {
  let target;
  try {
    target = readlinkSync(link);
  } catch {
    continue;
  }
  if (existsSync(link)) {
    ok++;
    continue;
  }
  // 目标串里含包名的那一段之后就是"仓库内的相对路径"（packages/shared、packages/server…）
  const match = target.match(/^(.*?)((?:packages|apps)[\\/][^\\/]+)$/);
  const newTarget = match ? join(ROOT, match[2]) : null;
  const shown = relative(ROOT, link) || link;
  if (!newTarget || !existsSync(newTarget)) {
    console.log(`⚠ 修不了（不知道它该指向哪）：${shown} -> ${target}`);
    continue;
  }
  if (!WRITE) {
    console.log(`将修：${shown}\n     旧 -> ${target}\n     新 -> ${newTarget}`);
    fixed++;
    continue;
  }
  rmSync(link, { force: true, recursive: true });
  mkdirSync(dirname(link), { recursive: true });
  // Windows 上 junction 不需要管理员权限，跨盘/中文路径也稳
  symlinkSync(newTarget, link, 'junction');
  console.log(`✓ 已修：${shown} -> ${newTarget}`);
  fixed++;
}
console.log(`\n检查完成：正常 ${ok} 条，需修 ${fixed} 条${WRITE ? '（已写入）' : '（这是预览，加 --write 才真的改）'}`);
