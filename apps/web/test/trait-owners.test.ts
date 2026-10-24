/**
 * ============================================================
 *  ★★ 0.3.2 羁绊详情「哪些棋子带这个标签」
 * ============================================================
 *
 * 用户口径（两条都在这张名单上）：
 *   ① 「阿米娅的升变形态同时上场只能生效一个羁绊，**在羁绊列表里只显示阿米娅**」
 *      —— 名单里不能再出现「阿米娅·青色怒火 / 慈悲愿景 / 炉芯终曲」这三条。
 *   ② 「把**炎的炎佑显示**删了」
 *      —— 炎佑是天师锦囊召唤的**召唤物**，数据上带 `yan` 标签，
 *        以前会出现在「大炎」的名单里，看起来像"还能再凑一个人"。
 *
 * ★ 为什么单独抽成 `traitOwnersOf()` 再测？
 *   这段以前是 main.ts 里的内联过滤，只能靠 jsdom 把整个界面搭起来才测得到，
 *   实际结果就是"没人测"。抽成纯函数之后，规则错了这里立刻红。
 */
import { describe, expect, it } from 'vitest';
import { traitOwnersOf } from '../src/game/trait-owners.js';
import {
  AMIYA_BASE_ID,
  AMIYA_FORM_IDS,
  UNIT_DEFS,
  familyKeyOf,
} from '../../../packages/shared/src/index.js';

describe('★★ 名单：召唤物 / 野怪不参与羁绊构建', () => {
  it('「大炎」的名单里没有炎佑（也不该有任何召唤物 / 野怪）', () => {
    const owners = traitOwnersOf('yan', []);
    expect(owners.length, '大炎应该还是有正经干员的').toBeGreaterThan(0);
    expect(owners.map((o) => o.def.name)).not.toContain('炎佑');
    expect(owners.some((o) => o.def.id.startsWith('summon_'))).toBe(false);
    expect(owners.some((o) => o.def.monsterOnly === true)).toBe(false);
  });

  it('所有羁绊的名单里都不出现召唤物 / 野怪', () => {
    const traitIds = new Set<string>();
    for (const def of Object.values(UNIT_DEFS)) {
      if (def.summonOnly === true || def.monsterOnly === true) {
        for (const trait of def.traits) traitIds.add(trait);
      }
    }
    expect(traitIds.size, '数据里至少得有一个带标签的召唤物（炎佑）').toBeGreaterThan(0);
    for (const traitId of traitIds) {
      const owners = traitOwnersOf(traitId, []);
      for (const owner of owners) {
        expect(owner.def.summonOnly, `${traitId} 名单里混进了召唤物 ${owner.def.id}`).not.toBe(true);
        expect(owner.def.monsterOnly, `${traitId} 名单里混进了野怪 ${owner.def.id}`).not.toBe(true);
      }
    }
  });
});

describe('★★ 名单：阿米娅家族只显示一条「阿米娅」', () => {
  it('法术（arts）名单里阿米娅家族只有一条，名字就是「阿米娅」', () => {
    const owners = traitOwnersOf('arts', []);
    const family = owners.filter((o) => familyKeyOf(o.def.id) === AMIYA_BASE_ID);
    expect(family).toHaveLength(1);
    expect(family[0]!.def.id).toBe(AMIYA_BASE_ID);
    expect(family[0]!.def.name).toBe('阿米娅');
    // 三个形态一个都不许单列
    for (const id of [AMIYA_FORM_IDS.blue, AMIYA_FORM_IDS.mercy, AMIYA_FORM_IDS.core]) {
      expect(owners.some((o) => o.def.id === id), `${id} 不该单独出现`).toBe(false);
    }
  });

  it('罗德岛 / 领导人这两条也一样（三个形态都带这三个标签）', () => {
    for (const traitId of ['rhodes', 'leader', 'arts']) {
      const owners = traitOwnersOf(traitId, []);
      const familyCount = owners.filter((o) => familyKeyOf(o.def.id) === AMIYA_BASE_ID).length;
      expect(familyCount, `${traitId} 里阿米娅应该只有一条`).toBe(1);
    }
  });

  it('★ 场上站的是形态时，这一条仍然打"场"标记（按家族判，不按 defId）', () => {
    const owners = traitOwnersOf('arts', [AMIYA_FORM_IDS.mercy]);
    const amiya = owners.find((o) => familyKeyOf(o.def.id) === AMIYA_BASE_ID);
    expect(amiya?.onField).toBe(true);
    // 且它排在最前面（"已在场上"优先）
    expect(owners[0]?.def.id).toBe(AMIYA_BASE_ID);
  });

  it('场上没有阿米娅时，这一条不带"场"标记', () => {
    const owners = traitOwnersOf('arts', []);
    const amiya = owners.find((o) => familyKeyOf(o.def.id) === AMIYA_BASE_ID);
    expect(amiya?.onField).toBe(false);
  });
});

describe('名单：基本秩序', () => {
  it('名单里每一条都真的带这个标签', () => {
    for (const traitId of ['yan', 'arts', 'rhodes', 'swordsman']) {
      for (const owner of traitOwnersOf(traitId, [])) {
        expect(owner.def.traits, `${owner.def.id} 不带 ${traitId}`).toContain(traitId);
      }
    }
  });

  it('排序：在场上 → 便宜 → 名字（同一档内不乱跳）', () => {
    const owners = traitOwnersOf('arts', [AMIYA_FORM_IDS.core]);
    for (let i = 1; i < owners.length; i++) {
      const prev = owners[i - 1]!;
      const cur = owners[i]!;
      // 先上场的排前面
      if (prev.onField !== cur.onField) expect(prev.onField).toBe(true);
      // 同档内费用不降
      if (prev.onField === cur.onField) expect(prev.def.cost).toBeLessThanOrEqual(cur.def.cost);
    }
  });
});
