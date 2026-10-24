/**
 * ============================================================
 *  ★★ 0.3.2 盟约「阿米娅 · 不容拒绝」：升变的装备链路
 * ============================================================
 *
 * 规则（用户口径）：
 *   · 升变**靠专属藏品触发**，装到指定形态的阿米娅身上 → 换成另一个棋子；
 *   · 星级**保留**；升到炉芯终曲要求 **3 星**；
 *   · 羁绊不变（`defId` 换掉之后自动按新形态的羁绊算）。
 *
 * 这里钉的是"装备那一刻到底发生了什么"：
 *   1. 成功升变：`defId` 变了、星级还在、身上的装备还在、证被消耗；
 *   2. 条件不满足时**拒绝且不消耗**（证还在栏里）—— 这条最容易写错成"先吞证再判断"。
 */
import { describe, expect, it } from 'vitest';
import { AMIYA_FORM_IDS } from '../../../packages/shared/src/index.js';
import { createGameState, equipItemToUnit, type GameState } from '../src/game/index.js';

/** 造一个"场上只有阿米娅"的局面 */
function withAmiya(star: number): GameState {
  const state = createGameState(7);
  state.placements = [
    { uid: 101, defId: 'op07', star, cell: { col: 2, row: 4 }, items: [], itemLayers: [] },
  ];
  return state;
}

describe('★ 升变：装上专属藏品就换形态', () => {
  it('★★ 普通阿米娅 + 青色怒火之证 → 变成「阿米娅·青色怒火」，证被消耗', () => {
    const state = withAmiya(1);
    state.items.aSlots[0] = 'itm_amiya_blue_cert';

    const result = equipItemToUnit(state, 0, 101);
    expect(result.ok, result.message).toBe(true);
    expect(state.placements[0]!.defId).toBe(AMIYA_FORM_IDS.blue);
    expect(state.items.aSlots[0], '证应该被消耗掉').toBeNull();
    expect(result.message).toContain('升变');
  });

  it('★ 星级保留：3 星阿米娅升变之后还是 3 星', () => {
    const state = withAmiya(3);
    state.items.aSlots[0] = 'itm_amiya_mercy_cert';
    equipItemToUnit(state, 0, 101);
    expect(state.placements[0]!.defId).toBe(AMIYA_FORM_IDS.mercy);
    expect(state.placements[0]!.star).toBe(3);
  });

  it('★ 身上的装备跟着走（升变不洗装备）', () => {
    const state = withAmiya(1);
    state.placements[0]!.items = ['itm_solvent'];
    state.placements[0]!.itemLayers = [0];
    state.items.aSlots[0] = 'itm_amiya_blue_cert';

    equipItemToUnit(state, 0, 101);
    expect(state.placements[0]!.defId).toBe(AMIYA_FORM_IDS.blue);
    expect(state.placements[0]!.items, '原来那件藏品还在').toEqual(['itm_solvent']);
  });

  it('★★ 3 星的青色怒火 + 终曲之证 → 变成炉芯终曲', () => {
    const state = withAmiya(3);
    state.placements[0]!.defId = AMIYA_FORM_IDS.blue;
    state.placements[0]!.items = [];
    state.items.aSlots[0] = 'itm_amiya_core_cert';

    const result = equipItemToUnit(state, 0, 101);
    expect(result.ok, result.message).toBe(true);
    expect(state.placements[0]!.defId).toBe(AMIYA_FORM_IDS.core);
    expect(state.placements[0]!.star).toBe(3);
  });

  it('★★ 不到 3 星：终曲之证**拒绝并且不消耗**', () => {
    const state = withAmiya(2);
    state.placements[0]!.defId = AMIYA_FORM_IDS.mercy;
    state.placements[0]!.items = [];
    state.items.aSlots[0] = 'itm_amiya_core_cert';

    const result = equipItemToUnit(state, 0, 101);
    expect(result.ok).toBe(false);
    expect(result.message).toContain('3 星');
    expect(state.items.aSlots[0], '★ 拒绝时证不能没').toBe('itm_amiya_core_cert');
    expect(state.placements[0]!.defId, '形态也不该变').toBe(AMIYA_FORM_IDS.mercy);
  });

  it('★★ 不能一步跳到终态：普通阿米娅装终曲之证会被拒', () => {
    const state = withAmiya(3);
    state.items.aSlots[0] = 'itm_amiya_core_cert';

    const result = equipItemToUnit(state, 0, 101);
    expect(result.ok).toBe(false);
    expect(state.items.aSlots[0]).toBe('itm_amiya_core_cert');
    expect(state.placements[0]!.defId).toBe('op07');
  });

  it('★ 不是阿米娅的棋子装不上（比如给 op08 装青怒证）', () => {
    const state = createGameState(7);
    state.placements = [
      { uid: 102, defId: 'op08', star: 1, cell: { col: 3, row: 4 }, items: [], itemLayers: [] },
    ];
    state.items.aSlots[0] = 'itm_amiya_blue_cert';

    const result = equipItemToUnit(state, 0, 102);
    expect(result.ok).toBe(false);
    expect(state.items.aSlots[0]).toBe('itm_amiya_blue_cert');
    expect(state.placements[0]!.defId).toBe('op08');
  });

  it('★ 备战席上的阿米娅也能升变（不是只在场上才行）', () => {
    const state = createGameState(7);
    state.placements = [];
    state.economy.bench = [{ uid: 201, defId: 'op07', star: 1, items: [], itemLayers: [] }];
    state.items.aSlots[0] = 'itm_amiya_blue_cert';

    const result = equipItemToUnit(state, 0, 201);
    expect(result.ok, result.message).toBe(true);
    expect(state.economy.bench[0]!.defId).toBe(AMIYA_FORM_IDS.blue);
  });
});
