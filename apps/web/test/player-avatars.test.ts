/**
 * ============================================================
 *  ★★ 0.3.2：官方「个人头像」清单的自检
 * ============================================================
 *
 * 清单是 `scripts/fetch-player-avatars.mjs` 生成的（`apps/web/src/player-avatars.ts`），
 * 素材在 `apps/web/public/assets/player-avatars/`。
 *
 * 【为什么要单独测？】
 * 这类"下载 + 生成清单"的东西最容易出现**两半对不上**：
 *   · 清单说有 203 张，实际只下下来 180 张 ⇒ 头像墙上出现一片空白格子；
 *   · 清单里的 id 重复 / 文件名写错 ⇒ 点了没反应、或者预览框空着；
 *   · 分组键和 `PLAYER_AVATAR_GROUPS` 对不上 ⇒ 那一整组**永远不会显示**（静默）。
 * 这三条都不会报错，只会"看起来怪怪的"，所以用测试钉住。
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  PLAYER_AVATARS,
  PLAYER_AVATAR_GROUPS,
  isPlayerAvatarId,
  playerAvatarOf,
} from '../src/player-avatars.js';

const ASSET_DIR = fileURLToPath(new URL('../public/assets/player-avatars/', import.meta.url));

describe('★ 官方个人头像清单', () => {
  it('数量与分组：默认 15 / 动态 10 / 纪念 89 / 活动 89（共 203）', () => {
    expect(PLAYER_AVATARS).toHaveLength(203);
    const counts = Object.fromEntries(
      PLAYER_AVATAR_GROUPS.map((group) => [
        group.key,
        PLAYER_AVATARS.filter((avatar) => avatar.group === group.key).length,
      ]),
    );
    expect(counts).toEqual({ def: 15, dyn: 10, special: 89, activity: 89 });
    // 清单里每个分组键都必须在 GROUPS 里（不然那一组永远不显示）
    for (const avatar of PLAYER_AVATARS) {
      expect(PLAYER_AVATAR_GROUPS.some((group) => group.key === avatar.group)).toBe(true);
    }
  });

  it('id 唯一、都以 pa: 开头', () => {
    const ids = PLAYER_AVATARS.map((avatar) => avatar.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id.startsWith('pa:avatar_')).toBe(true);
  });

  it('★★ 清单里的每一张，磁盘上真的有图（缺一张墙上就一个空框）', () => {
    const missing = PLAYER_AVATARS.filter((avatar) => !existsSync(join(ASSET_DIR, avatar.file)));
    expect(missing.map((avatar) => avatar.file), '缺文件就跑 node scripts/fetch-player-avatars.mjs').toEqual([]);
  });

  it('查表：认识的 id 拿得到信息，不认识的一律 undefined（不要崩）', () => {
    const first = PLAYER_AVATARS[0]!;
    expect(playerAvatarOf(first.id)?.file).toBe(first.file);
    expect(isPlayerAvatarId(first.id)).toBe(true);
    expect(isPlayerAvatarId('pa:avatar_no_such')).toBe(false);
    expect(isPlayerAvatarId('op01')).toBe(false);
    expect(playerAvatarOf(undefined)).toBeUndefined();
  });
});
