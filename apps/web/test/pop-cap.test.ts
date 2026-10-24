/**
 * ============================================================
 *  ★ 0.3 bug 回归：人口上限必须**含藏品加成**
 * ============================================================
 *
 * 【用户报的现象】装了「地形图」（+1 人口）之后，顶栏的人口显示不对 ——
 * 明明能多摆一个，界面还写着原来的上限。
 *
 * 【根因】顶栏读的是 `levelInfo(state).populationCap`，那份来自 shared 的
 * `levelSummary`，**只算等级、不含藏品**；而"能不能落子"走的是 `popCap(state)`。
 * 两套账 → 显示和实际对不上。
 *
 * 这个文件钉住三件事：
 *   1. `popCap` = 等级上限 + 藏品加成；
 *   2. **两件同款共享藏品要累加**（+1+1 = +2），不能只算一件；
 *   3. `levelSummary` 那份保持"只看等级"的语义（它给升级提示用，别去污染它）。
 */
import { describe, expect, it } from 'vitest';
import {
  ITEM_DEFS,
  createGameState,
  levelInfo,
  popCap,
  populationCap,
  type GameState,
} from '../src/game/index.js';

/** 地形图：共享装备位上挂一件 +1 人口 */
const MAP = 'itm_terrain_map';

function withMaps(count: number): GameState {
  const state = createGameState(7);
  for (let i = 0; i < count; i++) state.items.bEquip[i] = MAP;
  return state;
}

describe('★ 0.3 人口上限（含藏品）', () => {
  it('前提：地形图确实是 +1 人口的共享藏品', () => {
    expect(ITEM_DEFS[MAP]?.onEquip?.popCap).toBe(1);
  });

  it('什么都没装时，popCap == 等级上限', () => {
    const state = createGameState(7);
    expect(popCap(state)).toBe(populationCap(state.economy.level));
  });

  it('装一件 +1；装两件 +2（同款要累加，不能只算一件）', () => {
    const levelCap = populationCap(createGameState(7).economy.level);
    expect(popCap(withMaps(1)), '一件地形图').toBe(levelCap + 1);
    expect(popCap(withMaps(2)), '两件同款地形图要 +2').toBe(levelCap + 2);
  });

  it('★ 顶栏该读的是 popCap，不是 levelInfo().populationCap', () => {
    const state = withMaps(2);
    // 这两个数**不相等**才是对的 —— 一旦相等，说明又有人把显示退回"只看等级"了
    expect(levelInfo(state).populationCap, 'levelSummary 只看等级').toBe(
      populationCap(state.economy.level),
    );
    expect(popCap(state)).not.toBe(levelInfo(state).populationCap);
  });
});
