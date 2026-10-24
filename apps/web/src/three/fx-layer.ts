import { Group } from 'three';

/**
 * ★★ 0.2.1 **特效层**：战斗里所有"演出"对象都挂在这一层下面。
 *
 * ============================================================
 *  【它存在的唯一理由：让特效不再吃掉鼠标点击】
 * ============================================================
 *
 * 【问题】
 *   战斗中点棋子看实时属性，是往演出层那棵树里打一条射线
 *   （`board.pickIn(x, y, replay.root)`），命中谁就问它是哪一号单位。
 *   而特效（刀光 / 弹道 / 贴图特效 / 飘字 / 范围框…）**和棋子住在同一个 root 下**，
 *   又都带 `depthTest:false`、画在棋子前面 —— 于是射线先撞到特效，
 *   拿到的对象反查不出单位 ⇒ "点了棋子，面板却关掉了"（你报的那条）。
 *
 * 【做法：整层退出拾取，而不是每个特效各自记一遍】
 *   three 的 `Raycaster` 在遍历场景时有这么一句：
 *     `const result = object.raycast(raycaster, intersects);`
 *     `if (result === false) propagate = false;`
 *   也就是说 **`raycast()` 返回 false 连孩子都不再往下问**。
 *   所以只要这一层的 `raycast` 返回 false，往里加任何新特效都自动不吃点击 ——
 *   以后新增特效**不需要记得额外写一行**，漏一次就复发的隐患从根上没了。
 *
 * 【为什么不用 `layers`？】
 *   图层要逐个 `traverse` 去设，而且得保证拾取相机的 `layers` 一直没被人改过；
 *   这里直接让这一层"不参与"，和调用方的图层配置彻底无关。
 */
export function createFxLayer(): Group {
  const layer = new Group();
  // 调试探针/截图里能一眼认出这一层
  layer.name = 'fx-layer';
  layer.raycast = () => false;
  return layer;
}
