/**
 * ============================================================
 *  拾取守卫：为什么"点 A 格却选中了 B 格"，以及守卫真的挡得住
 * ============================================================
 *
 * 【要防的回归】
 * 你报的"放置和选择红方时有概率鼠标偏移"。
 * 根因不是鼠标换算错了，而是**命中判定太宽**：
 *   · 小人精灵画布挂在卡片精灵**下面**（chibi.ts: `cardSprite.add(sprite)`），
 *   · 拾取时又是**递归**打整棵子树（board.ts: `intersectObjects(unitLayer.children, true)`），
 *   · 而野怪最宽的画布（`mn_jakill` 448×278）换算到世界里是 **2.58 格宽**。
 * 于是"射线第一个命中的棋子"经常是**隔壁那格**的怪 —— 看着点在空格上，却选中了旁边的怪。
 *
 * 【守卫做的事】
 * 把射线和 y = CARD_CENTER_Y 的水平面求交，落点离棋子中心横竖都不超过
 * PICK_RADIUS 才认。见 pick-geometry.ts。
 *
 * 【这个测试真正要钉住的两件事】
 *  1. 守卫能挡住"隔壁那格"（没有它，实测 10.1% 的点会拾错）。
 *  2. **PICK_RADIUS 不能太小**：卡片是斜立的 billboard，点它顶端时射线落点会
 *     越过自己的格子边界。实测最坏 0.564 格（拉到最近视角时），
 *     所以任何把 PICK_RADIUS 调回 0.5（"正好半格"）的改动都必须让测试变红 ——
 *     否则"点自己干员的脑袋"会没反应，那是比原 bug 更难受的问题。
 *
 * 相机参数取自 board.ts 的**真实**代码路径（placeBoardCamera / boardCameraDistance
 * 都是线上在用的那两个函数），不是在测试里抄一份。
 */
import { Matrix4, PerspectiveCamera, Plane, Ray, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';

import { CAMERA_GEOMETRY, boardCameraDistance, cellToWorld, placeBoardCamera } from '../src/three/board.js';
import { MAX_ZOOM_IN, cameraDistanceFor } from '../src/three/camera-view.js';
import { CARD_CENTER_Y, CARD_WORLD_SCALE } from '../src/three/card-layout.js';
import { PICK_RADIUS, pickHitsOwnCell } from '../src/three/pick-geometry.js';

const CELL_HALF = 0.5;

// ============================================================
//  1. 规则本身（纯算术）
// ============================================================
describe('★ 拾取守卫：射线落点必须在棋子自己那一格里', () => {
  it('落点正中 -> 算数', () => {
    expect(pickHitsOwnCell({ x: 3, z: 4 }, 3, 4)).toBe(true);
  });

  it('边界内侧算自己、外侧不算（边界本身是"闭"的，但浮点上别去踩那一格）', () => {
    // 正好等于 PICK_RADIUS 时是算的（<=），不过浮点上 `3 + 0.6 - 3` 会
    // 变成 0.6000000000000001，所以这里量的是"内侧一点点"和"外侧一点点"。
    const inside = PICK_RADIUS - 1e-6;
    const outside = PICK_RADIUS + 1e-6;
    expect(pickHitsOwnCell({ x: 3 + inside, z: 4 }, 3, 4)).toBe(true);
    expect(pickHitsOwnCell({ x: 3 - inside, z: 4 }, 3, 4)).toBe(true);
    expect(pickHitsOwnCell({ x: 3, z: 4 + inside }, 3, 4)).toBe(true);
    expect(pickHitsOwnCell({ x: 3, z: 4 - inside }, 3, 4)).toBe(true);
    expect(pickHitsOwnCell({ x: 3 + outside, z: 4 }, 3, 4)).toBe(false);
    expect(pickHitsOwnCell({ x: 3, z: 4 - outside }, 3, 4)).toBe(false);
  });

  it('过了边界 -> 不算', () => {
    expect(pickHitsOwnCell({ x: 3 + PICK_RADIUS + 0.01, z: 4 }, 3, 4)).toBe(false);
    expect(pickHitsOwnCell({ x: 3, z: 4 - PICK_RADIUS - 0.01 }, 3, 4)).toBe(false);
  });

  it('★ 隔壁那一格的中心必须被拒（这就是你报的偏移）', () => {
    // 隔壁一格：世界坐标差 1.0 格。没有守卫时这里会返回 true = 点 A 中 B。
    expect(pickHitsOwnCell({ x: 3 + 1, z: 4 }, 3, 4)).toBe(false);
    expect(pickHitsOwnCell({ x: 3 + 1, z: 4 + 1 }, 3, 4)).toBe(false);
    expect(pickHitsOwnCell({ x: 3 - 1, z: 4 }, 3, 4)).toBe(false);
  });

  it('射线打不到平面 -> 放行（宁可像以前一样让它打中，也不要点了没反应）', () => {
    expect(pickHitsOwnCell(null, 3, 4)).toBe(true);
  });
});

// ============================================================
//  2. 真实相机几何
// ============================================================

/**
 * 按线上同一套代码摆一台相机。
 * @param aspect 画布宽高比
 * @param zoom   1 = 默认（最远）；MAX_ZOOM_IN = 最近
 */
function realCamera(aspect: number, zoom: number): PerspectiveCamera {
  const camera = new PerspectiveCamera(CAMERA_GEOMETRY.fov, aspect, 0.1, 400);
  placeBoardCamera(camera, cameraDistanceFor(boardCameraDistance(aspect), zoom));
  return camera;
}

/** 相机右轴 / 上轴：精灵是 billboard，它的"宽"沿右轴、"高"沿上轴 */
function cameraAxes(camera: PerspectiveCamera): { right: Vector3; up: Vector3 } {
  const m = new Matrix4().copy(camera.matrixWorld);
  return {
    right: new Vector3().setFromMatrixColumn(m, 0).normalize(),
    up: new Vector3().setFromMatrixColumn(m, 1).normalize(),
  };
}

const CARD_PLANE = new Plane(new Vector3(0, 1, 0), -CARD_CENTER_Y);

/**
 * 一个"画在屏幕某处"的世界点 P：从相机穿过 P 的射线，与 y = CARD_CENTER_Y 平面求交。
 * （P 被画在哪个像素，穿过那个像素的射线就正好穿过 P —— 所以这等价于"用户点了那一点"。）
 */
function planeHitThrough(camera: PerspectiveCamera, worldPoint: Vector3): Vector3 {
  const ray = new Ray(camera.position.clone(), worldPoint.clone().sub(camera.position).normalize());
  const hit = ray.intersectPlane(CARD_PLANE, new Vector3());
  expect(hit, '射线居然没打中卡片中心高度那一层').not.toBeNull();
  return hit!;
}

/** 从棋子中心出发、沿相机右轴/上轴偏移 (ox, oy) 个"卡片半宽/半高"的那个屏幕位置 */
function pointOnSprite(camera: PerspectiveCamera, col: number, row: number, ox: number, oy: number): Vector3 {
  const { right, up } = cameraAxes(camera);
  return cellToWorld({ col, row }, CARD_CENTER_Y)
    .addScaledVector(right, ox * (CARD_WORLD_SCALE.x / 2))
    .addScaledVector(up, oy * (CARD_WORLD_SCALE.y / 2));
}

/** 合法点击（卡片四角 + 四边中点 + 正中）的**最大**落点偏移 */
function worstLegitOffset(aspect: number, zoom: number): { worst: number; where: string } {
  const camera = realCamera(aspect, zoom);
  const samples: Array<[number, number]> = [
    [0, 0],
    [-1, -1], [1, -1], [-1, 1], [1, 1],
    [-1, 0], [1, 0], [0, -1], [0, 1],
  ];

  let worst = 0;
  let where = '';
  for (let col = 0; col < 10; col += 1) {
    for (let row = 0; row < 10; row += 1) {
      const centre = cellToWorld({ col, row }, CARD_CENTER_Y);
      for (const [ox, oy] of samples) {
        const hit = planeHitThrough(camera, pointOnSprite(camera, col, row, ox, oy));
        const d = Math.max(Math.abs(hit.x - centre.x), Math.abs(hit.z - centre.z));
        if (d > worst) {
          worst = d;
          where = `格子(${col},${row}) 卡片偏移(${ox},${oy})`;
        }
      }
    }
  }
  return { worst, where };
}

describe('★ 真实相机下：点自己这张卡片上的任何位置，落点都还在自己这一格', () => {
  it('★ PICK_RADIUS 必须大于"卡片边缘的最坏落点偏移"，否则点头顶会没反应', () => {
    // 默认视角 + 拉到最近，两种极端都扫一遍所有窗口比例
    const aspects = [3, 21 / 9, 16 / 9, 4 / 3, 1, 0.75, 0.5];

    let worst = 0;
    let where = '';
    for (const aspect of aspects) {
      for (const zoom of [1, MAX_ZOOM_IN]) {
        const r = worstLegitOffset(aspect, zoom);
        if (r.worst > worst) {
          worst = r.worst;
          where = `aspect ${aspect.toFixed(2)} zoom ${zoom} · ${r.where}`;
        }
      }
    }

    // 这是"为什么不是 0.5"的硬证据：卡片边缘的落点确实会越过半格。
    expect(
      worst,
      `卡片边缘最坏落点只有 ${worst.toFixed(4)}，那 PICK_RADIUS 可以调回 0.5 了`,
    ).toBeGreaterThan(CELL_HALF);
    // 而 PICK_RADIUS 必须比它大、且留余量（否则改一点相机/卡面尺寸就翻车）
    expect(
      PICK_RADIUS,
      `PICK_RADIUS=${PICK_RADIUS} 对不上实测最坏 ${worst.toFixed(4)}（${where}）`,
    ).toBeGreaterThan(worst * 1.05);
  });

  it('★ 所有合法点击（卡片上任意位置 × 全棋盘）都被守卫接受', () => {
    for (const aspect of [16 / 9, 1, 0.6]) {
      for (const zoom of [1, MAX_ZOOM_IN]) {
        const camera = realCamera(aspect, zoom);
        for (let col = 0; col < 10; col += 1) {
          for (let row = 0; row < 10; row += 1) {
            const centre = cellToWorld({ col, row }, CARD_CENTER_Y);
            for (const ox of [-1, 0, 1]) {
              for (const oy of [-1, 0, 1]) {
                const hit = planeHitThrough(camera, pointOnSprite(camera, col, row, ox, oy));
                expect(
                  pickHitsOwnCell(hit, centre.x, centre.z),
                  `aspect ${aspect} zoom ${zoom}：点格子(${col},${row})卡片偏移(${ox},${oy})被误判为"不是这枚棋子"`,
                ).toBe(true);
              }
            }
          }
        }
      }
    }
  });

  it('落点以"点得多高"为主因，所以守卫必须用平面落点而不是命中点', () => {
    const camera = realCamera(16 / 9, 1);
    const centre = cellToWorld({ col: 5, row: 5 }, CARD_CENTER_Y);
    const { up } = cameraAxes(camera);

    const atFoot = planeHitThrough(camera, centre.clone().addScaledVector(up, -CARD_WORLD_SCALE.y / 2));
    const atHead = planeHitThrough(camera, centre.clone().addScaledVector(up, CARD_WORLD_SCALE.y / 2));
    const drift = Math.abs(atHead.z - atFoot.z);

    // 卡片本身接近 1 格高，所以"点顶端"和"点脚底"的落点天然差出将近一格 ——
    // 这正是 PICK_RADIUS 不能是 0.5 的几何原因。
    expect(drift).toBeGreaterThan(CARD_WORLD_SCALE.y * 0.8);
    expect(drift).toBeLessThan(CARD_WORLD_SCALE.y * 1.2);
  });

  it('相机几乎垂直俯视（守卫成立的前提）', () => {
    const camera = realCamera(16 / 9, 1);
    const pitchDeg = (Math.asin(Math.abs(camera.position.y) / camera.position.length()) * 180) / Math.PI;
    expect(pitchDeg, '俯角变小的话，平面落点会明显往远处飘').toBeGreaterThan(70);
  });
});

describe('★ 真实相机下：宽画布（野怪）伸到隔壁去的那部分必须被守卫挡掉', () => {
  it('最宽的野怪画布 2.58 格宽 —— 隔壁那格的中心被拒绝', () => {
    const camera = realCamera(16 / 9, 1);
    const centre = cellToWorld({ col: 5, row: 5 }, CARD_CENTER_Y);
    const { right } = cameraAxes(camera);

    const sample = (cellsFromCentre: number): boolean => {
      const p = centre.clone().addScaledVector(right, cellsFromCentre);
      const hit = planeHitThrough(camera, p);
      return pickHitsOwnCell(hit, centre.x, centre.z);
    };

    // 自己这一格内：认
    expect(sample(0)).toBe(true);
    expect(sample(PICK_RADIUS - 0.01)).toBe(true);
    // 隔壁一格（1.0 格远）：必须拒绝 —— 这是你报的 bug 的原样
    expect(sample(1.0)).toBe(false);
    // 画布最外沿（mn_jakill 448×278 -> 半宽约 1.29 格）
    expect(sample(1.29)).toBe(false);

    // 顺带钉住"画布真的比一格宽"这个前提（不然这个 bug 根本不会出现）
    const jakillWorldH = 0.98 * (278 / 170);
    const halfW = (jakillWorldH * (448 / 278)) / 2;
    expect(halfW, 'mn_jakill 画布宽度换算错了').toBeGreaterThan(1.2);
  });
});
