/**
 * ============================================================
 *  ★★ 0.2.1 **特效不许吃掉鼠标点击**
 * ============================================================
 *
 * 【背景】
 *   战斗中"点棋子看实时属性"是往 `replay.root` 那棵树打射线（`board.pickIn`），
 *   命中谁就问它是哪一号单位。特效和棋子原本是**同一棵树里的兄弟**，
 *   又都带 `depthTest:false` 画在棋子前面 ⇒ 射线先撞特效 ⇒ 反查不出单位 ⇒
 *   面板不但不打开，还会被当成"点空地"给关掉（你报的那条）。
 *
 * 【守两条】
 *   1. **机制**：`createFxLayer()` 那一层（以及它下面**任意深度**的子孙）必须打不到
 *      —— 这里用真的 `THREE.Raycaster` 打一遍，不是看代码猜；
 *   2. **接线**：`replay.ts` 里特效一律加进 `fxLayer`，不许再直接加进 `root`。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Group, Mesh, MeshBasicMaterial, PlaneGeometry, Raycaster, Vector3 } from 'three';
import { createFxLayer } from '../src/three/fx-layer.js';

const replaySource = readFileSync(fileURLToPath(new URL('../src/three/replay.ts', import.meta.url)), 'utf8');

/** 一块正对 +Z 的板子（默认 PlaneGeometry 就朝 +Z，不用转） */
function board(z: number): Mesh {
  const mesh = new Mesh(new PlaneGeometry(4, 4), new MeshBasicMaterial());
  mesh.position.set(0, 0, z);
  return mesh;
}

/*
  ★ 射线故意**偏离中心**：PlaneGeometry 是两块三角形拼的，正中心那条对角线
  会同时命中两块 ⇒ 一块板子返回 2 个交点，断言就得写 2，看着像 bug。
*/
const RAY = { origin: new Vector3(0.7, -0.4, 5), dir: new Vector3(0, 0, -1) };

/** 从 z=5 朝 −Z 打一条射线，返回命中的对象 */
function shoot(root: Group): Mesh[] {
  const ray = new Raycaster(RAY.origin.clone(), RAY.dir.clone());
  return ray.intersectObjects(root.children, true).map((hit) => hit.object as Mesh);
}

describe('★ 0.2.1 特效层不参与鼠标拾取', () => {
  it('特效层里的东西打不到，同一条射线要能穿过去打到后面的棋子', () => {
    const root = new Group();
    const fx = createFxLayer();
    root.add(fx);

    const blocker = board(0); // 挡在前面的"特效"
    fx.add(blocker);
    const unit = board(-1); // 它后面的"棋子"
    root.add(unit);

    const hits = shoot(root);
    expect(hits, '特效挡在前面，但必须被射线忽略').toEqual([unit]);
  });

  it('任意深度的子孙都打不到（three 见到 raycast() 返回 false 就不再往下问）', () => {
    const root = new Group();
    const fx = createFxLayer();
    root.add(fx);

    // 故意埋三层深：只给最外层设 raycast=false 是不够的，必须靠"不再往下传播"
    const deep = new Group();
    const deeper = new Group();
    deeper.add(board(0));
    deep.add(deeper);
    fx.add(deep);

    expect(shoot(root), '三层深的特效也必须是透明的').toEqual([]);
  });

  it('对照：不加这一层，同样的板子确实会被打到（证明上面两条不是在自欺欺人）', () => {
    const root = new Group();
    root.add(board(0));
    expect(shoot(root).length, '对照组：普通对象本来是会被打到的').toBe(1);
  });

  it('这一层自己的 raycast() 返回 false', () => {
    const fx = createFxLayer();
    const ray = new Raycaster(new Vector3(0, 0, 5), new Vector3(0, 0, -1));
    expect(fx.raycast(ray, [])).toBe(false);
  });
});

describe('★ 0.2.1 接线：特效一律挂 fxLayer，不许挂 root', () => {
  it('root 下只挂两样：fxLayer 自己、棋子精灵', () => {
    const adds = [...replaySource.matchAll(/this\.root\.add\(/g)].length;
    expect(
      adds,
      '★ root.add 只允许 2 处（fxLayer + 棋子精灵）。' +
        '新增特效请加进 this.fxLayer —— 直接加 root 会让特效重新挡住"点干员看面板"',
    ).toBe(2);
    const removes = [...replaySource.matchAll(/this\.root\.remove\(/g)].length;
    expect(removes, '同理，只有棋子精灵从 root 摘').toBe(1);
  });

  it('血镰的根节点也挂在特效层下（它自己是往这个根里加东西的）', () => {
    expect(replaySource).toContain('attachLetoScytheRoot(this.fxLayer)');
    expect(replaySource).not.toContain('attachLetoScytheRoot(this.root)');
  });
});
