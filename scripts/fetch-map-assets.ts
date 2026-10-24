/**
 * 从 prts.wiki 下载「棋盘/背景」素材。
 *
 * 用法：
 *   node node_modules/tsx/dist/cli.mjs scripts/fetch-map-assets.ts        # 预演
 *   node node_modules/tsx/dist/cli.mjs scripts/fetch-map-assets.ts --go   # 真下载
 *
 * ============================================================
 *  为什么是这两张图？（调研结论，见下面的注释）
 * ============================================================
 * 我本来想找"明日方舟的地砖贴图"，但**prts.wiki 上没有**：
 * 我实测过 tile / 地砖 / 地块 / 方格 / 网格 / 纹理 / 贴图 / 地形 / tileset
 * 等 20 多个前缀，全部 0 命中；全站 4 万多个文件里也没有 tileset 图集。
 *
 * 但找到了两个更好的东西：
 *   1. `地图_RA-*.png` —— **俯视正交**的关卡地图，格子间距恰好 50px。
 *      这是唯一能切出"真·方舟地砖"的素材。
 *      （另一族 `<关卡> 地图.png` 有 502 张，但是斜 45° 等距视角 + 带 HUD，
 *        铺到正交棋盘上透视不匹配，所以不用。）
 *   2. `Bg_*.png` —— 43 张官方背景图，1820×1024（正好是 16:9）。
 *
 * 下载的东西：
 *   assets/backdrop.png      背景（Bg_rhodes_night：罗德岛夜间机库，橙灯 + 暗蓝）
 *   assets/tiles_atlas.png   地砖图集（运行时从里面切一块干净的地砖出来铺满棋盘）
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';

const API = 'https://prts.wiki/api.php';
const OUT_DIR = 'apps/web/public/assets';
const UA = 'AIRNIGHT-local-fan-game/0.1 (personal use with friends, not published)';

const args = process.argv.slice(2);
const shouldDownload = args.includes('--go');
const force = args.includes('--force');

/** 要下载的文件清单 */
const TARGETS: Array<{
  /** 保存成什么名字 */
  save: string;
  /** wiki 上的文件名（不含 File: 前缀） */
  title: string;
  /** 为什么选它 */
  why: string;
}> = [
  {
    save: 'backdrop.png',
    title: 'Bg_rhodes_night.png',
    why: '罗德岛夜间机库：深蓝夜色 + 橙黄工业灯光，和方舟 UI 的「橙 + 暗蓝」主色一致',
  },
  {
    save: 'tiles_atlas.png',
    title: '地图_RA-B-2_不灭.png',
    why: '俯视正交方格地图（918×618，格距 50px），可以切出真·方舟地砖',
  },
];

/** 用 imageinfo 拿一个文件的真实 URL 和尺寸 */
async function imageInfo(title: string): Promise<{ url: string; width: number; height: number } | null> {
  const query = new URLSearchParams({
    format: 'json',
    action: 'query',
    prop: 'imageinfo',
    iiprop: 'url|size|mime',
    titles: `File:${title}`,
  });
  const res = await fetch(`${API}?${query}`, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as {
    query?: { pages?: Record<string, { imageinfo?: Array<{ url: string; width: number; height: number }> }> };
  };
  const pages = data.query?.pages ?? {};
  for (const page of Object.values(pages)) {
    const info = page.imageinfo?.[0];
    if (info) return info;
  }
  return null;
}

async function main(): Promise<void> {
  console.log('查询 prts.wiki 上的文件地址…\n');

  const resolved: Array<{ save: string; url: string; width: number; height: number; why: string }> = [];
  for (const target of TARGETS) {
    try {
      const info = await imageInfo(target.title);
      if (!info) {
        console.error(`❌ 没找到「${target.title}」`);
        continue;
      }
      console.log(`✅ ${target.title}`);
      console.log(`   ${info.width}×${info.height}  ${info.url}`);
      console.log(`   选它的原因：${target.why}\n`);
      resolved.push({ save: target.save, url: info.url, width: info.width, height: info.height, why: target.why });
    } catch (error) {
      console.error(`❌ ${target.title}: ${(error as Error).message}`);
    }
    await new Promise((r) => setTimeout(r, 150));
  }

  if (!shouldDownload) {
    console.log('（这是预演。加 --go 才会真的下载文件。）');
    return;
  }

  mkdirSync(OUT_DIR, { recursive: true });
  for (const item of resolved) {
    const path = `${OUT_DIR}/${item.save}`;
    if (!force && existsSync(path)) {
      console.log(`  跳过 ${item.save}（已存在，加 --force 可覆盖）`);
      continue;
    }
    try {
      const res = await fetch(item.url, { headers: { 'User-Agent': UA } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buffer = Buffer.from(await res.arrayBuffer());
      if (buffer.byteLength < 1024) throw new Error('文件太小，可能不是图片');
      writeFileSync(path, buffer);
      console.log(`  ✓ ${item.save}  ${(buffer.byteLength / 1024).toFixed(0)} KB`);
    } catch (error) {
      console.error(`  ✗ ${item.save}: ${(error as Error).message}`);
    }
    await new Promise((r) => setTimeout(r, 150));
  }

  console.log(`\n存放位置：${OUT_DIR}/`);
  console.log('刷新页面即可看到（棋盘和背景会自动换成方舟风格）。');
}

await main();
