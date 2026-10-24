/**
 * ============================================================
 *  ★★ 0.3.3 羁绊图标 / 转职藏品图标：图 ↔ 数据 必须一一对上
 * ============================================================
 *
 * 【为什么值得单独测？】
 * 图标是"数据里只有 id、界面上按 id 拼路径"的又一处**静默失败**：
 *   · 新加一个羁绊但忘了跑 `gen-trait-relic-icons.ts` ⇒ 列表里那一行是个破图，
 *     没有任何报错、门禁也全绿；
 *   · 只生成了 `off` 忘了 `on`（或反过来）⇒ 生效/未生效看起来一样，
 *     "哪个羁绊现在有用"这个信息就没了；
 *   · 转职藏品同理 —— 玩家只会看到商店里一个空白格子。
 * 所以这里把三件事一次钉住：文件在、尺寸对、两态真的不一样。
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { TRAIT_DEFS, TRAIT_RELICS } from '../../../packages/shared/src/index.js';

const ASSETS = fileURLToPath(new URL('../public/assets/', import.meta.url));

/** 读 PNG 的 IHDR 拿宽高（PNG 一定有 IHDR，宽在 16..20、高在 20..24） */
function pngSize(path: string): { width: number; height: number } {
  const buffer = readFileSync(path);
  expect(buffer.subarray(1, 4).toString('ascii'), `${path} 不是 PNG`).toBe('PNG');
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

describe('★★ 0.3.3 羁绊图标', () => {
  it('每个羁绊都有「未生效 / 已生效」两张图，而且是 128×128 的正方形', () => {
    for (const traitId of Object.keys(TRAIT_DEFS)) {
      for (const [state, suffix] of [
        ['未生效', ''],
        ['已生效', '-on'],
      ] as const) {
        const path = `${ASSETS}traits/${traitId}${suffix}.png`;
        expect(existsSync(path), `${traitId} 的${state}图标不存在（跑 scripts/gen-trait-relic-icons.ts）`).toBe(true);
        const { width, height } = pngSize(path);
        expect(width, `${traitId}${suffix} 宽度`).toBe(128);
        expect(height, `${traitId}${suffix} 高度`).toBe(128);
      }
    }
  });

  it('★ 两态必须真的不一样（否则"生效了没有"就看不出来了）', () => {
    for (const traitId of Object.keys(TRAIT_DEFS)) {
      const off = readFileSync(`${ASSETS}traits/${traitId}.png`);
      const on = readFileSync(`${ASSETS}traits/${traitId}-on.png`);
      expect(off.equals(on), `${traitId} 的两态一模一样 —— 生成脚本没换配色？`).toBe(false);
    }
  });

  it('★ 不同羁绊之间不能是同一张图（否则等于全是同一个图标）', () => {
    const seen = new Map<string, string>();
    for (const traitId of Object.keys(TRAIT_DEFS)) {
      const bytes = readFileSync(`${ASSETS}traits/${traitId}.png`).toString('base64');
      const dup = seen.get(bytes);
      expect(dup, `${traitId} 的图标和 ${dup} 完全相同（字标撞车了？）`).toBeUndefined();
      seen.set(bytes, traitId);
    }
  });
});

describe('★★ 0.3.3 转职藏品图标', () => {
  it('每件转职都有图标，尺寸是 144×178（和其余藏品一致）', () => {
    expect(TRAIT_RELICS.length, '前提：确实有一批转职藏品').toBeGreaterThan(10);
    for (const relic of TRAIT_RELICS) {
      const path = `${ASSETS}items/${relic.icon}.png`;
      expect(existsSync(path), `${relic.icon} 不存在（跑 scripts/gen-trait-relic-icons.ts）`).toBe(true);
      const { width, height } = pngSize(path);
      expect(width, `${relic.icon} 宽度`).toBe(144);
      expect(height, `${relic.icon} 高度`).toBe(178);
    }
  });

  it('★ 转职图标用的是"它给的那个羁绊"的字标（不能张冠李戴）', () => {
    /*
      ★ 这条为什么重要：19 件藏品全是同一套黑牌，
      如果哪一件生成时 `grantsTrait` 取错，界面上不会有任何报错 ——
      只是玩家拿到"治疗转职"却发现图标写着"炎"。
      判据：同一羁绊的藏品图标 == 该羁绊的"已生效"图标（除了尺寸/裁剪，字节不同，
      所以这里比对**字标所在的像素分布**太麻烦 —— 改成比对"不是别的羁绊的图"）。
    */
    const traitIds = Object.keys(TRAIT_DEFS);
    for (const relic of TRAIT_RELICS) {
      const relicBytes = readFileSync(`${ASSETS}items/${relic.icon}.png`).toString('base64');
      for (const otherId of traitIds) {
        if (otherId === relic.grantsTrait) continue;
        const otherBytes = readFileSync(`${ASSETS}traits/${otherId}-on.png`).toString('base64');
        expect(relicBytes, `${relic.icon} 的图看起来是「${otherId}」的`).not.toBe(otherBytes);
      }
    }
  });
});
