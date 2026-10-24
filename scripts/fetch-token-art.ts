#!/usr/bin/env node
/**
 * ============================================================
 *  下载**召唤物**的立绘（构建期用，0.0.2 追加需求第 6 条）
 * ============================================================
 *
 * 用法：
 *   node node_modules/tsx/dist/cli.mjs scripts/fetch-token-art.ts        # 预演，只报告
 *   node node_modules/tsx/dist/cli.mjs scripts/fetch-token-art.ts --go   # 真的下载
 *
 * 【为什么不复用 fetch-portraits.ts？】
 * 那个脚本是**按棋子名去匹配** wiki 文件名的（`头像_<名字>.png`），
 * 这对干员很好用，但召唤物在 wiki 上是挂在「召唤物_」这个命名空间下的，
 * 名字还带各种引号和皮肤后缀 —— 自动匹配会瞎猜。所以这里**显式写死**表，
 * 一个召唤物一条，宁可多写一行，也不要猜错图片。
 *
 * 【下载到哪】
 *   apps/web/public/assets/units/<棋子id>.png   方形头像（商店/信息窗/棋盘降级用）
 *   apps/web/public/assets/stand/<棋子id>.png   立绘（棋盘上的卡片优先用它）
 * 两份都放同一张图：召唤物在 wiki 上只有方形图，没有竖长半身像，
 * 而卡片的立绘区是"等比缩放 + 居中裁剪"，方形图放进去不会变形。
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';

const API = 'https://prts.wiki/api.php';
const UA = 'AIRNIGHT-local-fan-game/0.1 (personal use with friends, not published)';

const AVATAR_DIR = 'apps/web/public/assets/units';
const STAND_DIR = 'apps/web/public/assets/stand';

/**
 * 棋子 id -> wiki 上的文件名（不带 `头像_` 前缀、不带 `.png`）。
 *
 * 【这些名字是怎么来的？】
 * 用 prts 的搜索接口在 File 命名空间里查「召唤物」前缀列出来的，
 * 逐个核对过持有者对不对（例如 `召唤物_棋子` 的持有者是「望」）。
 * 换图片 = 改这一张表，不用动别的代码。
 */
const TOKEN_ART: Record<string, string> = {
  // 迷迭香的召唤物（游戏里叫「战术柱」）。wiki 上只有 skin2 这一版有图。
  summon_pillar: '召唤物_迷迭香的战术装备_skin2',
  // 望的召唤物（游戏里叫「棋子」）
  summon_trap: '召唤物_棋子',
  /*
    维娜·维多利亚的召唤物「黄金盟誓」（金色狮子）**不在这张表里** ——
    wiki 上它明确标了 `无头像=yes`，一张静态图都没有。
    它的画面来自官方 Spine 模型：见 scripts/fetch-chibi.ts 的 REMOTE_OVERRIDES
    和 skill-data.ts 里 summon_lion 的 charId。
  */
};

const args = process.argv.slice(2);
const shouldDownload = args.includes('--go');
const force = args.includes('--force');

async function apiJson(params: Record<string, string>): Promise<any> {
  const url = `${API}?${new URLSearchParams({ format: 'json', ...params })}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** 按文件名精确查它托管在哪（拿不到就返回 null，不猜） */
async function fileUrl(name: string): Promise<string | null> {
  // 先按最直接的写法试：头像_<名字>.png
  const candidates = [`头像_${name}.png`];
  for (const candidate of candidates) {
    const data = await apiJson({
      action: 'query',
      titles: `File:${candidate}`,
      prop: 'imageinfo',
      iiprop: 'url',
    });
    const pages = data?.query?.pages ?? {};
    for (const page of Object.values<any>(pages)) {
      const url = page?.imageinfo?.[0]?.url;
      if (url) return String(url);
    }
  }
  return null;
}

async function main(): Promise<void> {
  console.log('============================================================');
  console.log('  下载召唤物立绘（0.0.2 追加需求第 6 条）');
  console.log('============================================================\n');

  const jobs = Object.entries(TOKEN_ART);
  mkdirSync(AVATAR_DIR, { recursive: true });
  mkdirSync(STAND_DIR, { recursive: true });

  let ok = 0;
  let failed = 0;

  for (const [defId, wikiName] of jobs) {
    const avatarPath = `${AVATAR_DIR}/${defId}.png`;
    const standPath = `${STAND_DIR}/${defId}.png`;
    if (!force && existsSync(avatarPath) && existsSync(standPath)) {
      console.log(`  · ${defId} 已有，跳过`);
      ok++;
      continue;
    }

    try {
      const url = await fileUrl(wikiName);
      if (!url) throw new Error(`wiki 上找不到「头像_${wikiName}.png」`);
      if (!shouldDownload) {
        console.log(`  ? ${defId}  <-  ${wikiName}   ${url}`);
        continue;
      }

      const res = await fetch(url, { headers: { 'User-Agent': UA } });
      if (!res.ok) throw new Error(`下载失败 HTTP ${res.status}`);
      const buffer = Buffer.from(await res.arrayBuffer());
      if (buffer.byteLength < 512) throw new Error('文件太小，可能不是图片');
      // 头像和立绘放同一张：召唤物没有竖长半身像，方形图会被 cover 裁成合适比例
      writeFileSync(avatarPath, buffer);
      writeFileSync(standPath, buffer);
      ok++;
      console.log(
        `  ✓ ${defId}.png  <-  ${wikiName}  (${(buffer.byteLength / 1024).toFixed(0)} KB)`,
      );
    } catch (error) {
      failed++;
      console.error(`  ✗ ${defId}（${wikiName}）：${(error as Error).message}`);
    }
    // 对 wiki 友好一点
    await new Promise((r) => setTimeout(r, 150));
  }

  if (!shouldDownload) {
    console.log('\n（这是预演。加 --go 才会真的下载文件。）');
    return;
  }
  console.log(`\n完成：成功 ${ok} 个，失败 ${failed} 个`);
  console.log('图片会自动生效（文件名就是棋子 id）—— 刷新页面即可看到。');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
