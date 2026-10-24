/**
 * ★ 0.3.4 图鉴 + 组队器 —— 纯逻辑层的回归测试。
 *
 * 【这一组守住什么】
 *   ① 图鉴的分类**互斥且穷尽**（55 个棋子 / 89 件藏品，一件不多一件不少、也不重复）；
 *   ② 组队器的增删语义（点一下进、再点一下出、不重复、满 15 格不再放）；
 *   ③ 激活羁绊走的是**和左侧羁绊面板同一个函数**，不是这里另写一遍判档；
 *   ④ 「提醒购买」是**仅本局**的开关：默认关、没落盘、换一局清计划但保留开关。
 *
 * 【★ 为什么分类数量要钉死】
 * 转职藏品那 19 件在数据里是靠 `grantsTrait` 区分的、本身也是 A 类 ——
 * 一旦有人改成"按 slot 分组"，它们会**同时出现在转职组和穿戴组里**，
 * 玩家看到的是"同一件藏品列了两遍"。这组测试就是那条改法的刹车。
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { ITEM_DEFS, TRAIT_DEFS, UNIT_DEFS } from '../../../packages/shared/src/index.js';
import {
  TEAM_PLAN_SLOTS,
  clearTeamPlan,
  clearTeamPlanSlot,
  codexItemGroups,
  codexUnitGroups,
  codexUnits,
  planTraitRows,
  remindBuyMarkOf,
  resetTeamPlanForNewGame,
  setTeamPlanRemindBuy,
  teamPlanCount,
  teamPlanRemindBuy,
  teamPlanSlots,
  toggleTeamPlanUnit,
} from '../src/game/codex.js';

/** 每个用例都从"空计划 + 开关关闭"开始（模块状态在用例之间是共享的） */
beforeEach(() => {
  clearTeamPlan();
  setTeamPlanRemindBuy(false);
});

describe('图鉴：棋子按费用分 5 组', () => {
  it('一共 55 名干员，正好分 5 档', () => {
    const groups = codexUnitGroups();
    expect(groups).toHaveLength(5);
    expect(groups.map((g) => g.cost)).toEqual([1, 2, 3, 4, 5]);
    const all = groups.flatMap((g) => g.units);
    expect(all).toHaveLength(55);
    expect(codexUnits()).toHaveLength(55);
  });

  it('分组互斥且穷尽：每组的费用都对得上，没有一件出现两次', () => {
    const groups = codexUnitGroups();
    const ids = new Set<string>();
    for (const group of groups) {
      for (const def of group.units) {
        expect(def.cost, `${def.id} 的费用应等于它所在的组`).toBe(group.cost);
        expect(ids.has(def.id), `${def.id} 重复出现在图鉴里`).toBe(false);
        ids.add(def.id);
      }
    }
    expect(ids.size).toBe(55);
  });

  it('不收录野怪 / 召唤物 / 升变形态 / 彩蛋', () => {
    const ids = new Set(codexUnits().map((d) => d.id));
    expect([...ids].every((id) => /^op\d{1,3}$/.test(id))).toBe(true);
    expect(ids.has('egg_mvm')).toBe(false);
    for (const def of Object.values(UNIT_DEFS)) {
      if (def.monsterOnly || def.summonOnly || def.ascendOnly) expect(ids.has(def.id)).toBe(false);
    }
  });
});

describe('图鉴：藏品按用途分 3 组', () => {
  it('一共 89 件，19 转职 + 40 穿戴 + 30 共享', () => {
    const groups = codexItemGroups();
    expect(groups.map((g) => g.kind)).toEqual(['relic', 'wear', 'share']);
    const byKind = Object.fromEntries(groups.map((g) => [g.kind, g.items.length]));
    expect(byKind.relic).toBe(19);
    expect(byKind.wear).toBe(40);
    expect(byKind.share).toBe(30);
    expect(groups.flatMap((g) => g.items)).toHaveLength(89);
  });

  it('三组互斥且穷尽：转职那 19 件不会同时混进「穿戴」组', () => {
    const groups = codexItemGroups();
    const seen = new Set<string>();
    for (const group of groups) {
      for (const item of group.items) {
        expect(seen.has(item.id), `${item.id} 重复出现在图鉴里`).toBe(false);
        seen.add(item.id);
        if (group.kind === 'relic') expect(item.grantsTrait).toBeTruthy();
        if (group.kind === 'wear') expect(item.slot).toBe('A');
        if (group.kind === 'share') expect(item.slot).toBe('B');
      }
    }
    // 和 ITEM_DEFS 全量对得上（89 件一件不少）
    expect(seen.size).toBe(Object.keys(ITEM_DEFS).length);
  });
});

describe('组队器：15 个栏位', () => {
  it('固定 15 个栏位，一开始全是空的', () => {
    expect(TEAM_PLAN_SLOTS).toBe(15);
    expect(teamPlanSlots()).toHaveLength(15);
    expect(teamPlanCount()).toBe(0);
    expect(teamPlanSlots().every((s) => s === null)).toBe(true);
  });

  it('点一下放进第一个空位，再点一下移出；同一个干员只占一格', () => {
    toggleTeamPlanUnit('op01');
    expect(teamPlanCount()).toBe(1);
    expect(teamPlanSlots()[0]).toBe('op01');

    toggleTeamPlanUnit('op02');
    expect(teamPlanSlots()[1]).toBe('op02');

    // 重复放同一个：先塞一个空位，再点两次（放进 + 移出）
    toggleTeamPlanUnit('op01');
    expect(teamPlanCount()).toBe(1); // 已被移出，只剩 op02
    expect(teamPlanSlots()[0]).toBeNull();
  });

  it('放满 15 格之后不再往里塞（不越界、不丢人）', () => {
    const ids = codexUnits().slice(0, 20).map((d) => d.id);
    expect(ids.length).toBeGreaterThan(TEAM_PLAN_SLOTS);
    for (const id of ids) toggleTeamPlanUnit(id);
    expect(teamPlanCount()).toBe(TEAM_PLAN_SLOTS);
    expect(teamPlanSlots().every((s) => s !== null)).toBe(true);
  });

  it('clearTeamPlanSlot 只清指定那一格', () => {
    toggleTeamPlanUnit('op01');
    toggleTeamPlanUnit('op02');
    clearTeamPlanSlot(0);
    expect(teamPlanSlots()[0]).toBeNull();
    expect(teamPlanSlots()[1]).toBe('op02');
  });

  it('换一局清掉计划，但「提醒购买」开关留在玩家拨的状态', () => {
    toggleTeamPlanUnit('op01');
    setTeamPlanRemindBuy(true);
    resetTeamPlanForNewGame();
    expect(teamPlanCount()).toBe(0);
    expect(teamPlanRemindBuy()).toBe(true);
  });
});

describe('组队器：激活的羁绊', () => {
  it('没有棋子时一行都没有', () => {
    expect(planTraitRows()).toHaveLength(0);
  });

  it('凑够人数后该羁绊变成「已生效」，走的是和羁绊面板同一套判档', () => {
    // 挑一个「持有者够多、且带恰好 N 名条件的领导人那种要排除」的羁绊
    const owners = new Map<string, string[]>();
    for (const def of codexUnits()) {
      for (const trait of def.traits) owners.set(trait, [...(owners.get(trait) ?? []), def.id]);
    }
    const hasSolo = (traitId: string): boolean =>
      (TRAIT_DEFS[traitId]?.tiers ?? []).some((tier) =>
        (tier.mechanics ?? []).some((m) => m.kind === 'soloRequires'),
      );
    const picked = [...owners.entries()].find(([traitId, ids]) => {
      const def = TRAIT_DEFS[traitId];
      if (!def || hasSolo(traitId)) return false;
      return ids.length >= (def.tiers[0]?.count ?? Number.POSITIVE_INFINITY);
    });
    expect(picked, '数据表里应该存在至少一个"能凑齐第一档"的羁绊').toBeTruthy();

    const [traitId, ids] = picked!;
    const need = TRAIT_DEFS[traitId]!.tiers[0]!.count;

    // 先只放 need-1 个：不该生效
    for (let i = 0; i < need - 1; i++) toggleTeamPlanUnit(ids[i]!);
    const before = planTraitRows().find((r) => r.traitId === traitId);
    if (need > 1) expect(before?.activeAt ?? null).toBeNull();

    // 补齐：生效
    toggleTeamPlanUnit(ids[need - 1]!);
    const after = planTraitRows().find((r) => r.traitId === traitId)!;
    expect(after.count).toBe(need);
    expect(after.activeAt).toBe(need);
  });

  it('同一个干员放两份也只算一个成员（和 countTraits 同口径）', () => {
    const def = codexUnits().find((d) => d.traits.length > 0)!;
    toggleTeamPlanUnit(def.id);
    const one = planTraitRows().find((r) => r.traitId === def.traits[0])!;
    expect(one.count).toBe(1);

    // 移出再移入，仍然是 1 —— 不存在"放两次算两个"的路径
    toggleTeamPlanUnit(def.id);
    toggleTeamPlanUnit(def.id);
    expect(planTraitRows().find((r) => r.traitId === def.traits[0])!.count).toBe(1);
  });
});

describe('提醒购买（仅本局）', () => {
  it('默认关闭；打开后只有"计划里的"棋子才打角标', () => {
    expect(teamPlanRemindBuy()).toBe(false);
    toggleTeamPlanUnit('op01');
    expect(remindBuyMarkOf('op01')).toBe(false); // 开关没开 => 不打

    setTeamPlanRemindBuy(true);
    expect(remindBuyMarkOf('op01')).toBe(true);
    expect(remindBuyMarkOf('op02')).toBe(false); // 没在计划里 => 不打

    toggleTeamPlanUnit('op01'); // 移出计划
    expect(remindBuyMarkOf('op01')).toBe(false);
  });
});

describe('★ 0.3.4 复发防线（都是实地踩出来的）', () => {
  it('图鉴浮层必须挂在 body 上，不能写在 #main-menu 里面', () => {
    /*
      【为什么这条必须有】
      图鉴原来写在 `#main-menu` 里。`.menu-overlay` 是 `display:none` 的对局状态，
      一进对局 `#main-menu` 整个不显示 ⇒ 图鉴跟着消失。
      实测 `#codex-overlay.getBoundingClientRect()` 是 **0×0**，
      玩家点了「图鉴」什么都不会发生 —— 这就是当时报的那个 bug。
      而且 `.menu-overlay` 带 `backdrop-filter`，会给 `position:fixed` 的后代
      另建包含块，`inset:0` 也不再等于视口。
    */
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    const at = html.indexOf('id="codex-overlay"');
    expect(at, 'index.html 里找不到 #codex-overlay').toBeGreaterThan(-1);

    // 往前数标签配对：从 #codex-overlay 之前最后一个未闭合的 .menu-overlay 算起
    const before = html.slice(0, at);
    const openCount = (before.match(/<(div|section|main|aside|header|footer)\b[^>]*>/g) ?? []).length;
    const closeCount = (before.match(/<\/(div|section|main|aside|header|footer)>/g) ?? []).length;
    expect(openCount, '标签不配对，先修 index.html').toBeGreaterThanOrEqual(closeCount);

    // 直接判：它不在 #main-menu 到 #lobby-overlay 这一段之间
    const menuStart = html.indexOf('id="main-menu"');
    const menuEnd = html.indexOf('id="lobby-overlay"');
    expect(menuStart).toBeGreaterThan(-1);
    expect(menuEnd).toBeGreaterThan(menuStart);
    expect(at > menuStart && at < menuEnd, '#codex-overlay 又被塞回 #main-menu 里了').toBe(false);
  });

  it('图鉴开着的时候，游戏快捷键必须被挡住（按 D 不能真的花钱）', () => {
    /*
      实测：开着图鉴按 D，toast 弹出「刷新商店（-2 金）」—— 钱真没了。
      这几个键走的是 `el.btnXxx.click()`，不是"按钮被挡住就点不到"。
    */
    const src = readFileSync(fileURLToPath(new URL('../src/main.ts', import.meta.url)), 'utf8');
    const handlerAt = src.lastIndexOf("window.addEventListener('keydown'");
    expect(handlerAt).toBeGreaterThan(-1);
    // 取最后一个 keydown 处理器（游戏快捷键那个）往里找闸门
    const tail = src.slice(handlerAt, handlerAt + 900);
    expect(tail, '游戏快捷键处理器里必须有"图鉴开着就直接返回"的闸门').toContain(
      "el.codexOverlay.classList.contains('hidden')",
    );
  });

  it('组队器 15 个栏位的坐标两两不同（第 11 格不能和第 1 格落在同一格）', () => {
    /*
      原来写的是 `row: i % 10`，于是 i=0 和 i=10 都是 (0,0)。
      羁绊按"不同干员"计数，暂时看不出问题 —— 但这是颗定时炸弹：
      以后任何按坐标去重 / 按"周围几格"算的机制都会在这里漏人。
      这条直接盯源码写法（`planPlacements` 是私有的，故意不为了测试而导出）。
    */
    const src = readFileSync(fileURLToPath(new URL('../src/game/codex.ts', import.meta.url)), 'utf8');
    expect(src, '栏位坐标又写成 `row: i % 10` 了（第 11 格会和第 1 格重合）').not.toContain('row: i % 10');
    expect(src).toContain('col: i % 10');
    expect(src).toContain('row: Math.floor(i / 10)');
  });

  it('「龙」羁绊的档位说明里不许再出现错别字「羔」', () => {
    const dragon = TRAIT_DEFS['dragon'];
    expect(dragon).toBeTruthy();
    for (const tier of dragon!.tiers) {
      expect(tier.desc ?? '', '又写成「龙羔绊」了').not.toContain('羔');
    }
    // 顺手扫全表：这个字不该出现在任何羁绊文案里
    for (const [id, def] of Object.entries(TRAIT_DEFS)) {
      for (const tier of def.tiers) {
        expect(tier.desc ?? '', `${id} 的档位说明里有错别字「羔」`).not.toContain('羔');
      }
    }
  });
});
