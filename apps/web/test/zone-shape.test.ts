// @vitest-environment jsdom
/**
 * ============================================================
 *  ★★ 0.2：范围白框的形状（`zoneShapeRects`）
 * ============================================================
 *
 * 【为什么单独测这个纯函数？】
 * 用户报的是"陈的技能看着像半径 3 格" —— 内核其实是**直线**（见
 * `packages/shared/test/zone-event.test.ts`），错的是**界面上那个白框**：
 * `spawnZone` 原来只特判十字，其余一律画成"以中心为圆心、半径 r 的方块"，
 * `line` 于是被画成一个 7×7 的大方框 —— 玩家照着框去摆位就全错了。
 *
 * 这段几何不依赖 three.js 场景（只算格子矩形），所以可以直接钉住
 * "**框住的格子 == 内核真正打到的格子**"，不用起浏览器截图。
 */
import { describe, expect, it } from 'vitest';
import { zoneShapeRects, type CellRect } from '../src/three/replay.js';

/** 把一个矩形覆盖到的**整格**列出来（格子 (c,w) 的正方形 = ±0.5；去重，十字的中心格会被两条都框到） */
function cellsOf(rects: CellRect[]): string[] {
  const out = new Set<string>();
  for (const rect of rects) {
    const c0 = Math.round(rect.c0 + 0.5);
    const c1 = Math.round(rect.c1 - 0.5);
    const w0 = Math.round(rect.w0 + 0.5);
    const w1 = Math.round(rect.w1 - 0.5);
    for (let c = c0; c <= c1; c++) for (let w = w0; w <= w1; w++) out.add(`${c},${w}`);
  }
  return [...out].sort();
}

describe('★ 0.2 范围白框：直线（陈"前方 3 格"）', () => {
  it('★★ 朝右：只框住 (5,4)(6,4)(7,4) —— 不是以目标为中心的大方块', () => {
    const rects = zoneShapeRects({
      cell: { col: 5, row: 4 },
      radius: 3,
      shape: 'line',
      from: { col: 4, row: 4 },
    });
    expect(rects, '横/竖方向一条长条就够，不需要拆开').toHaveLength(1);
    expect(cellsOf(rects)).toEqual(['5,4', '6,4', '7,4']);
  });

  it('朝上 / 朝左：方向跟着施法者到中心格算', () => {
    expect(
      cellsOf(
        zoneShapeRects({
          cell: { col: 4, row: 2 },
          radius: 3,
          shape: 'line',
          from: { col: 4, row: 4 },
        }),
      ),
    ).toEqual(['4,1', '4,2', '4,3']);
    expect(
      cellsOf(
        zoneShapeRects({
          cell: { col: 2, row: 4 },
          radius: 2,
          shape: 'line',
          from: { col: 4, row: 4 },
        }),
      ),
    ).toEqual(['2,4', '3,4']);
  });

  it('★ 斜向（射程够远的干员才可能）：逐格画成阶梯，框住的格子和判定完全一致', () => {
    const rects = zoneShapeRects({
      cell: { col: 2, row: 2 },
      radius: 3,
      shape: 'line',
      from: { col: 1, row: 1 },
    });
    expect(rects, '斜线要一格一格画，画成一个旋转矩形就框不住整格了').toHaveLength(3);
    expect(cellsOf(rects)).toEqual(['2,2', '3,3', '4,4']);
  });

  it('没有 from 的老数据（或者施法者已消失）退回方块，不能崩', () => {
    const rects = zoneShapeRects({ cell: { col: 5, row: 4 }, radius: 1, shape: 'line' });
    expect(cellsOf(rects)).toEqual(['4,3', '4,4', '4,5', '5,3', '5,4', '5,5', '6,3', '6,4', '6,5']);
  });

  it('中心格和施法者同格（退化）时只框住那一格', () => {
    const rects = zoneShapeRects({
      cell: { col: 4, row: 4 },
      radius: 3,
      shape: 'line',
      from: { col: 4, row: 4 },
    });
    expect(cellsOf(rects)).toEqual(['4,4']);
  });
});

describe('★ 范围白框：方块 / 十字（没被这次改动影响）', () => {
  it('方块：3×3 就是 9 格', () => {
    expect(cellsOf(zoneShapeRects({ cell: { col: 5, row: 4 }, radius: 1, shape: 'square' }))).toEqual([
      '4,3',
      '4,4',
      '4,5',
      '5,3',
      '5,4',
      '5,5',
      '6,3',
      '6,4',
      '6,5',
    ]);
  });

  it('十字："周围 4 格"要画成十字，不能画成 3×3', () => {
    const rects = zoneShapeRects({ cell: { col: 5, row: 4 }, radius: 1, shape: 'cross' });
    expect(rects, '横条 + 竖条').toHaveLength(2);
    expect(cellsOf(rects)).toEqual(['4,4', '5,3', '5,4', '5,5', '6,4']);
  });
});
