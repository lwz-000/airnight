/**
 * ============================================================
 *  ★ 0.2.1 迷迭香「战术装置砸击」—— 轨迹与"一次只砸一个"
 * ============================================================
 *
 * 【为什么这些要单测？】
 * 这条特效没有注册表可以查（它不是一个 id 对应一串 PNG），
 * 全靠 `rosmon-slam-fx.ts` 里的几个纯函数算。算错了不会报错，
 * 只会表现成"装置从地底下钻出来""砸到了隔壁格""一次落下来四件"。
 *
 * ★★ 用户口径（2026-10-18，两版）：
 *   ①「还是在平飞，让特效生成在敌方单位上方，然后落向敌人消失」
 *   ②「装置是按从右侧出现，可能还是视角原因，稍微调一下」
 *   ⇒ 高度必须是真·垂直落下；**屏幕上的水平位置必须钉死在目标那一列**
 *     （纯世界垂直做不到 —— 斜视下高处会往外飘，见 `slamPathAt`）。
 *     所以这里最硬的断言是"投影到屏幕上，两帧的 x 相差不到 1px"，
 *     而不是"世界 x 相等"（后者是错的那条）。
 * ★ 用户口径：「装置是砸一个，而不是砸四个」⇒ `shouldSpawnSlam()` 钉死。
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PerspectiveCamera, Vector3 } from 'three';
import {
  MAX_LIVE_ROSMON_SLAM,
  ROSMON_GEAR_PATH,
  ROSMON_SLAM_DEDUPE_SECONDS,
  ROSMON_SLAM_FX,
  SLAM_END_Y,
  SLAM_SMOKE_FX,
  SLAM_TOP_Y,
  shouldSpawnSlam,
  slamHeightAt,
  slamOpacityAt,
  slamPathAt,
  slamScaleAt,
  slamSpinAt,
  slamWorldSize,
  type SlamView,
} from '../src/three/rosmon-slam-fx.js';
import { placeBoardCamera } from '../src/three/board.js';
import { UNIT_DEFS } from '../../../packages/shared/src/index.js';

/** 落点随便取一个非原点、两个轴都非零的位置，能抓出"把 x/z 写反"这类错 */
const LANDING = { x: 2.5, y: SLAM_END_Y, z: -1.5 };

/**
 * 一台**真·棋盘相机**（和游戏里同一个俯角/朝向），再摘成纯数据。
 * ★ 不自己抄一份俯角：`placeBoardCamera` 一改，这里自动跟着变。
 */
function boardView(panX = 0, panZ = 0, distance = 15.66): { view: SlamView; camera: PerspectiveCamera } {
  const camera = new PerspectiveCamera(38, 900 / 640, 0.1, 400);
  placeBoardCamera(camera, distance, panX, panZ);
  const position = camera.getWorldPosition(new Vector3());
  const forward = camera.getWorldDirection(new Vector3());
  return {
    camera,
    view: {
      position: { x: position.x, y: position.y, z: position.z },
      forward: { x: forward.x, y: forward.y, z: forward.z },
    },
  };
}

/** 世界点 → 屏幕像素（900×640 视口） */
function toScreen(camera: PerspectiveCamera, at: { x: number; y: number; z: number }): { x: number; y: number } {
  const ndc = new Vector3(at.x, at.y, at.z).project(camera);
  return { x: (ndc.x * 0.5 + 0.5) * 900, y: (-ndc.y * 0.5 + 0.5) * 640 };
}

describe('★ 迷迭香装置砸击：数据接线', () => {
  it('op18 走专属通道，而且不走炮弹那套', () => {
    expect(UNIT_DEFS['op18']!.tracerFx).toBe(ROSMON_SLAM_FX);
    expect(UNIT_DEFS['op18']!.combatFx, '落点表现由砸击自己收尾，不叠炮弹爆炸').toBeUndefined();
  });

  it('同屏上限是有限值（不能让 sprite 无限堆）', () => {
    expect(MAX_LIVE_ROSMON_SLAM).toBeGreaterThan(0);
    expect(MAX_LIVE_ROSMON_SLAM).toBeLessThanOrEqual(16);
  });

  it('落地烟用的是注册表里已有的序列帧（别写一个不存在的 id）', () => {
    expect(SLAM_SMOKE_FX).toBe('cannon_smoke_gray');
  });
});

describe('★ 一次只砸一个（用户口径）', () => {
  it('普通一发：落', () => {
    expect(shouldSpawnSlam({ hitIndex: 0, sinceLastSpawn: 99 })).toBe(true);
    expect(shouldSpawnSlam({ sinceLastSpawn: 99 }), '不写 hitIndex 也要落').toBe(true);
  });

  it('连击的第 2/3 段不再落第二件', () => {
    expect(shouldSpawnSlam({ hitIndex: 1, sinceLastSpawn: 99 })).toBe(false);
    expect(shouldSpawnSlam({ hitIndex: 2, sinceLastSpawn: 99 })).toBe(false);
  });

  it('同一次出手打到多个目标时，时间窗内只落一件', () => {
    const justSpawned = ROSMON_SLAM_DEDUPE_SECONDS / 2;
    expect(shouldSpawnSlam({ hitIndex: 0, sinceLastSpawn: justSpawned }), '离上一次太近').toBe(false);
    expect(
      shouldSpawnSlam({ hitIndex: 0, sinceLastSpawn: ROSMON_SLAM_DEDUPE_SECONDS }),
      '刚好过了窗口就该落',
    ).toBe(true);
  });

  it('第一次出手（没有上一次）一定落', () => {
    expect(shouldSpawnSlam({ hitIndex: 0, sinceLastSpawn: Infinity })).toBe(true);
  });
});

describe('★ 轨迹：目标正上方垂直砸下（不许平飞）', () => {
  it('不传相机时退化成"世界垂直"：水平位置钉死在落点', () => {
    for (let t = 0; t <= 1.0001; t += 0.02) {
      const at = slamPathAt(LANDING, t);
      expect(at.x, `t=${t.toFixed(2)} 横着挪了`).toBeCloseTo(LANDING.x, 9);
      expect(at.z, `t=${t.toFixed(2)} 横着挪了`).toBeCloseTo(LANDING.z, 9);
    }
  });

  it('起点在头顶、终点贴地', () => {
    expect(slamPathAt(LANDING, 0).y).toBeCloseTo(SLAM_TOP_Y, 6);
    expect(slamPathAt(LANDING, 1).y).toBeCloseTo(SLAM_END_Y, 6);
    expect(SLAM_TOP_Y, '必须真的在头顶上方，不能只抬半格').toBeGreaterThan(2);
  });

  it('高度单调下降（不会忽高忽低）', () => {
    let prev = slamPathAt(LANDING, 0).y;
    for (let t = 0.02; t <= 1.0001; t += 0.02) {
      const y = slamPathAt(LANDING, t).y;
      expect(y, `t=${t.toFixed(2)} 应该比前一帧低`).toBeLessThanOrEqual(prev + 1e-9);
      prev = y;
    }
  });

  it('末段明显比开头快（是"砸"下去，不是坐电梯）', () => {
    const head = slamHeightAt(0) - slamHeightAt(0.1);
    const tail = slamHeightAt(0.9) - slamHeightAt(1);
    expect(tail).toBeGreaterThan(head * 3);
  });

  it('永远不会砸穿地面', () => {
    for (let t = 0; t <= 1.0001; t += 0.02) {
      expect(slamPathAt(LANDING, t).y, `t=${t.toFixed(2)} 沉到地下了`).toBeGreaterThan(0);
    }
  });

  it('越界进度会被夹住（浮点误差不该把它甩到天外）', () => {
    expect(slamPathAt(LANDING, -3).y).toBeCloseTo(SLAM_TOP_Y, 6);
    expect(slamPathAt(LANDING, 9).y).toBeCloseTo(SLAM_END_Y, 6);
    expect(slamPathAt(LANDING, Number.NaN).y).toBeCloseTo(SLAM_TOP_Y, 6);
  });
});

describe('★★ 视角补偿：屏幕上必须跟目标同一列（用户口径②）', () => {
  it('"纯世界垂直"确实会飘 —— 先证明这条断言不是白写的', () => {
    const { camera } = boardView(0, 0);
    const target = toScreen(camera, LANDING);
    const naive = toScreen(camera, { x: LANDING.x, y: SLAM_TOP_Y, z: LANDING.z });
    // 目标离画面中线 2.5 格时，飘移已经肉眼可见（真机上更容易被读成"从右边飞进来"）
    expect(Math.abs(naive.x - target.x), '不做补偿应该差出好几像素').toBeGreaterThan(4);
  });

  it('补偿后：全程投影 x 与落点重合（亚像素级）', () => {
    // 换几组相机（正对 / 大幅平移 / 拉近）都要成立
    for (const [panX, panZ, distance] of [
      [0, 0, 15.66],
      [-3, 2, 15.66],
      [4.5, -4, 11],
    ] as const) {
      const { camera, view } = boardView(panX, panZ, distance);
      const target = toScreen(camera, LANDING);
      for (let t = 0; t <= 1.0001; t += 0.05) {
        const at = slamPathAt(LANDING, t, view);
        const px = toScreen(camera, at);
        expect(Math.abs(px.x - target.x), `pan(${panX},${panZ}) dist=${distance} t=${t.toFixed(2)} 横向飘了`).toBeLessThan(0.5);
      }
    }
  });

  it('屏幕上要**真的在往下掉**（不是原地放大）', () => {
    const { camera, view } = boardView(0, 0);
    let prev = toScreen(camera, slamPathAt(LANDING, 0, view)).y;
    for (let t = 0.05; t <= 1.0001; t += 0.05) {
      const y = toScreen(camera, slamPathAt(LANDING, t, view)).y;
      expect(y, `t=${t.toFixed(2)} 屏幕上往回跳了`).toBeGreaterThanOrEqual(prev - 1e-6);
      prev = y;
    }
    const travel = prev - toScreen(camera, slamPathAt(LANDING, 0, view)).y;
    // 棋盘相机是 78° 俯视，纯世界垂直只能落下 30 来像素；抬到 3.0 之后够半格
    expect(travel, '落程太短会读成"在原地放大"').toBeGreaterThan(28);
  });

  it('落点这一帧必须精确回到落点本身（补偿不能改落点）', () => {
    const { view } = boardView(-2, 3);
    const at = slamPathAt(LANDING, 1, view);
    expect(at.x).toBeCloseTo(LANDING.x, 9);
    expect(at.z).toBeCloseTo(LANDING.z, 9);
    expect(at.y).toBeCloseTo(SLAM_END_Y, 9);
  });

  it('相机退化（视线深度算不出来）时退回世界垂直，不把装置甩出去', () => {
    const at = slamPathAt(LANDING, 0, { position: { x: 0, y: 0.5, z: 0.5 }, forward: { x: 0, y: 1, z: 0 } });
    expect(at.x).toBeCloseTo(LANDING.x, 9);
    expect(at.z).toBeCloseTo(LANDING.z, 9);
  });
});

describe('★ 曲线：旋转 / 缩放 / 透明度', () => {
  it('出现时基本正立，越落越斜，落地是斜插（不是立着停住）', () => {
    expect(slamSpinAt(0)).toBeLessThan(0);
    expect(Math.abs(slamSpinAt(0))).toBeLessThan(0.2);
    expect(slamSpinAt(1), '落地要斜着插下去').toBeLessThan(-0.3);
    // 幅度上限：Sprite 的旋转是屏幕平面内的，转过 60° 就开始像风车
    for (let t = 0; t <= 1.0001; t += 0.01) {
      expect(Math.abs(slamSpinAt(t)), `t=${t.toFixed(2)} 转太多了`).toBeLessThan(Math.PI / 3);
    }
  });

  it('缩放全程严格大于 0（Sprite 拿到 0 会直接闪没）', () => {
    for (let t = 0; t <= 1.0001; t += 0.01) {
      expect(slamScaleAt(t), `t=${t.toFixed(2)}`).toBeGreaterThan(0.05);
    }
  });

  it('越落越大（从高处下来，应该越来越"近"）', () => {
    expect(slamScaleAt(1)).toBeGreaterThan(slamScaleAt(0));
    expect(slamScaleAt(1), '落地那一下要比初始大').toBeGreaterThan(1);
  });

  it('淡入淡出都对得上：首帧透明、中段不透明、收尾归零（"落向敌人消失"）', () => {
    expect(slamOpacityAt(0)).toBe(0);
    expect(slamOpacityAt(0.5)).toBe(1);
    // 1 - (1-0.9)/0.1 在浮点下是 2.2e-16，不是精确 0 —— 按"看不见"判就够
    expect(slamOpacityAt(1)).toBeLessThan(1e-6);
  });
});

describe('★ 素材', () => {
  it('装置贴图在磁盘上，是**单件**板（细长），不是四件的组合', () => {
    const path = fileURLToPath(new URL(`../public/assets/${ROSMON_GEAR_PATH}`, import.meta.url));
    expect(existsSync(path), `缺图：${ROSMON_GEAR_PATH}`).toBe(true);
    const buf = readFileSync(path);
    expect(buf.subarray(1, 4).toString('ascii')).toBe('PNG');
    const width = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);
    expect(width, '缩到 256 宽').toBe(256);
    /*
      ★ 用户口径：「图上是 4 个装置，只抠最右面单独那个」。
      单件 `F_Weapon_2` 是 188×462（接近 1:2.4 的细长板），
      四件组合是 556×477（接近正方形）。这条断言就是防止哪天又退回组合图。
    */
    expect(height / width, '必须是细长板，组合图是接近 1:1 的').toBeGreaterThan(2);
  });

  it('世界里的大小接近一格高（太大会盖住邻居）', () => {
    const size = slamWorldSize();
    expect(size.height).toBeGreaterThan(0.8);
    expect(size.height).toBeLessThan(1.5);
    expect(size.width, '细长板：宽只有高的三分之一多一点').toBeCloseTo(size.height * (256 / 666), 6);
    expect(size.width).toBeLessThan(0.7);
  });
});
