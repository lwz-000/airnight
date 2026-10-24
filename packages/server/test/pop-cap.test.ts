/**
 * ============================================================
 *  ★★ 0.3.2：服务端的人口上限 —— 满级 + 地形图必须能摆 11 个
 * ============================================================
 *
 * 【用户报的 bug】
 * 多人模式里，满级（10 人口）再装一件「地形图」（+1 人口）应该能摆 11 个，
 * 但服务端把第 11 个当"超编"扔了 —— 客户端摆 11 个、服务端只有 10 个，
 * 两边**各算各的战斗**，结果自然不一样（这也是"平行世界"的一大来源）。
 *
 * 【根因】服务端那道兜底用的是 `MAX_POPULATION = MAX_LEVEL`（=10），
 * 而真正的规则在客户端：`popCap(state)` = 等级 + 藏品加成。
 *
 * 【现在】兜底放宽到 `MAX_LEVEL + ITEM_B_EQUIP_SLOTS`：
 * 地形图是 **B 类（共享）** 藏品，最多占满共享装备位（4 格）⇒ 理论最大 14 人口。
 * 它仍然只是"拦住畸形/作弊请求"的兜底，不是游戏规则本身。
 */
import { describe, expect, it } from 'vitest';
import {
  BOARD_H,
  ITEM_B_EQUIP_SLOTS,
  MAX_LEVEL,
  TEAM_0_MAX_COL,
  UNIT_DEFS,
  type UnitPlacement,
} from '../../shared/src/index.js';

// ★ 导入 main.ts 之前必须按死自启动（否则会真的起一个 8787 服务器）
process.env.AIRNIGHT_NO_AUTOSTART = '1';
const { MAX_POPULATION, repairPlacements } = await import('../src/main.js');

/** 一个 1 费干员（任何一张都行，只要 id 认得出） */
const CHEAP = Object.keys(UNIT_DEFS).find((id) => {
  const def = UNIT_DEFS[id]!;
  return def.cost === 1 && !def.monsterOnly && !def.summonOnly && !def.noCard;
})!;

/** 摆 n 个棋子（每格一个，从左到右、从上到下） */
function board(n: number): UnitPlacement[] {
  const out: UnitPlacement[] = [];
  for (let row = 0; row < BOARD_H && out.length < n; row++) {
    for (let col = 0; col <= TEAM_0_MAX_COL && out.length < n; col++) {
      out.push({ defId: CHEAP, star: 1, cell: { col, row } });
    }
  }
  return out;
}

describe('★ 服务端人口兜底：必须容得下"满级 + 地形图"', () => {
  it('★★ 兜底值 ≥ 满级 + 共享装备位（地形图最多 +4）', () => {
    expect(MAX_POPULATION).toBeGreaterThanOrEqual(MAX_LEVEL + ITEM_B_EQUIP_SLOTS);
    // 11 人口（满级 + 一件地形图）是合法阵容，绝不能被裁掉
    expect(MAX_POPULATION).toBeGreaterThanOrEqual(11);
  });

  it('★★ 11 个棋子：一个都不丢（用户报的那一局）', () => {
    const { units, dropped } = repairPlacements(board(11));
    expect(dropped, `不该有任何棋子被丢掉：${JSON.stringify(dropped)}`).toHaveLength(0);
    expect(units).toHaveLength(11);
  });

  it('★ 14 个（满级 + 四件地形图）也放行', () => {
    const { units, dropped } = repairPlacements(board(14));
    expect(dropped).toHaveLength(0);
    expect(units).toHaveLength(14);
  });

  it('★ 兜底仍然有效：15 个以上会被裁到上限（拦住畸形/作弊请求）', () => {
    const { units, dropped } = repairPlacements(board(16));
    expect(units).toHaveLength(MAX_POPULATION);
    expect(dropped.length).toBe(16 - MAX_POPULATION);
    expect(dropped[0]!.reason).toContain('超过人口上限');
  });

  it('★ 各格子的棋子仍然原样保留（藏品字段不能被重构造掉）', () => {
    const withItem: UnitPlacement[] = [
      { defId: CHEAP, star: 2, cell: { col: 0, row: 0 }, items: ['itm_terrain_map'] },
    ];
    const { units } = repairPlacements(withItem);
    expect(units).toHaveLength(1);
    expect((units[0] as { items?: string[] }).items).toEqual(['itm_terrain_map']);
    expect(units[0]!.star).toBe(2);
  });
});
