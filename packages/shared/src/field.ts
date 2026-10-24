import { BOARD_H, BOARD_W, CELL_EMPTY, MELEE_RANGE, TEAM_0_MAX_COL, TEAM_1_MIN_COL } from './constants.js';
import type { BattleState, Cell, MoveStyle, SplashShape } from './types.js';

/**
 * 棋盘工具。
 *
 * 【为什么不用 A* 寻路？】
 * 自走棋的棋盘不大（默认每方 10×5，全场 20×5 = 100 格），
 * 而且棋子只需要「往最近的敌人挪一步」，不需要绕远路找最优路径。
 * 所以用最简单的「贪心走法」：在所有空格子里，挑一个让它离目标更近的格子。
 * 这既够用，又保证了确定性（同样的局面，永远走出同样的那一步）。
 */

/** 把二维坐标压成一维下标，方便用数组存棋盘 */
export function cellIndex(col: number, row: number): number {
  return row * BOARD_W + col;
}

/** 一维下标还原成二维坐标 */
export function indexToCell(index: number): Cell {
  return { col: index % BOARD_W, row: Math.floor(index / BOARD_W) };
}

/** 坐标是否在棋盘内 */
export function isInside(col: number, row: number): boolean {
  return col >= 0 && col < BOARD_W && row >= 0 && row < BOARD_H;
}

/**
 * 格距。度量方式**跟着移动方式走**：
 *
 *   `orthogonal`（默认，只能上下左右走）→ **曼哈顿距离** = |Δ列| + |Δ行|
 *       走 4 步只能靠近 4 格，所以距离就该这么算。
 *       斜前方那格的距离是 2，不是 1 —— 也就是说**砍不到斜前方的人**，
 *       必须真的绕过去。这和《明日方舟》里地面单位只能打四方向是一致的。
 *
 *   `any`（八方向，留给"飞行/传送/斜走"这类技能）→ **切比雪夫距离** = max(|Δ列|, |Δ行|)
 *       斜着一步也算 1 格。
 *
 * 【为什么必须和移动方式绑定？】
 * 如果移动只能走四方向、距离却按八方向算，就会出现一个很怪的状态：
 * 棋子斜着站在敌人旁边，判定"已经在攻击距离内"，于是永远不动、隔着斜角互砍。
 * 玩家看到的是"这一步明明走不过去，它却在打人"。
 */
export function cellDistance(a: Cell, b: Cell, style: MoveStyle = 'orthogonal'): number {
  const dc = Math.abs(a.col - b.col);
  const dr = Math.abs(a.row - b.row);
  return style === 'any' ? Math.max(dc, dr) : dc + dr;
}

/** 取棋子的移动方式（没写就是四方向） */
export function moveStyleOf(unit: { moveStyle?: MoveStyle }): MoveStyle {
  return unit.moveStyle ?? 'orthogonal';
}

/**
 * 「范围/半径」类判定用的距离：**切比雪夫距离**（横竖取大的那个）。
 *
 * ============================================================
 *  ★ 射程用 cellDistance，范围用这个 —— 两者不能混
 * ============================================================
 *
 * 这两件事看起来像，其实是不同的东西：
 *
 *   · **射程**（"够不够得着"）必须跟着移动方式走。
 *     四方向移动的棋子，斜前方那格是走不过去的，射程也该算 2 格 ——
 *     否则会出现"斜着站着就能砍到人、但一步也走不过去"的怪现象。
 *     所以射程判定用 `cellDistance(..., moveStyleOf(unit))`。
 *
 *   · **范围**（"技能扫到哪一片"）是画在棋盘上的一个方块，
 *     跟棋子怎么走路没关系。"周围 8 格""3×3""5×5"说的都是方块，
 *     **斜角那 4 格当然算在内**。
 *
 * 【这里踩过一个很隐蔽的坑】
 * 原来"方形范围"的判断写成了两条一起用：
 * `|Δ列| ≤ r 且 |Δ行| ≤ r 且 cellDistance(曼哈顿) ≤ r`。
 * 对四方向移动的棋子，最后那条会把**斜角格排除掉** ——
 * 于是"炮手溅射 3×3"实际只打到一个十字（5 格），斜角 4 格永远打不到。
 * 伤害数字照常跳，只是偏低一点，**几乎不可能从结果上看出来**。
 * 我是在加"范围白框"的时候才发现的：白框框住了 9 格，
 * 但日志里只有 5 格掉血，两边对不上。
 *
 * 现在范围一律用这一个函数，方框和实际生效的范围**天然一致**。
 */
export function withinRadius(a: Cell, b: Cell, radius: number): boolean {
  return Math.abs(a.col - b.col) <= radius && Math.abs(a.row - b.row) <= radius;
}

/**
 * 判断一个格子是否落在"以 center 为中心、半径 radius"的范围内。
 *
 * 三种形状（都是你表格里的说法）：
 *   · square 3×3 / 5×5（"周围8格"）
 *   · cross  上下左右 4 格（"周围4格"）
 *   · line   从施法者朝目标方向推出去的一条线（陈"前方3格"）
 *
 * ★ 0.2：从 `skills.ts` 搬到这里 —— 它纯粹是棋盘几何，不碰伤害。
 * 搬家的原因：`combat-math`（破盾爆炸）也要用它，而 `combat-math`
 * 不能反过来依赖 `skills`；放在 `field` 这个共同下层就没有环。
 */
export function withinShape(
  casterCell: { col: number; row: number },
  center: { col: number; row: number },
  cell: { col: number; row: number },
  radius: number,
  shape: SplashShape,
  style: 'orthogonal' | 'any',
): boolean {
  void style; // 范围判定不看移动方式（见上面 withinRadius 的说明）
  if (shape === 'line') {
    const dc = center.col - casterCell.col;
    const dr = center.row - casterCell.row;
    const sc = dc === 0 ? 0 : dc > 0 ? 1 : -1;
    const sr = dr === 0 ? 0 : dr > 0 ? 1 : -1;
    const tc = cell.col - casterCell.col;
    const tr = cell.row - casterCell.row;
    // 必须在同一条直线上（横向、纵向或斜向）
    if (sc !== 0 && sr !== 0 ? tc * sr !== tr * sc : sc === 0 ? tc !== 0 : tr !== 0) return false;
    return Math.max(Math.abs(tc), Math.abs(tr)) <= radius;
  }
  /*
    ★ 0.3.2 **矩形**（阿米娅·慈悲愿景"自身格 + 前方 3 格、往旁边各延伸 1 格"）：
    以施法者为起点，朝目标方向铺 `radius + 1` 格深、横向 3 格宽。

    · 主方向取"离目标更远的那个轴"（和 line 的直觉一致：打正右方就是横着铺）；
    · 横向 ±1 格 —— 描述里的"往旁边延伸一格"就是这个；
    · `depth >= 0` 保证**不往背后打**（这就是"不能斜着释放"的实际含义：
      斜着的目标会被归到横/纵某一个轴，范围只朝那一侧铺）。
  */
  if (shape === 'rect') {
    const dc = center.col - casterCell.col;
    const dr = center.row - casterCell.row;
    const horizontal = Math.abs(dc) >= Math.abs(dr);
    const tc = cell.col - casterCell.col;
    const tr = cell.row - casterCell.row;
    const depth = horizontal ? tc * (dc >= 0 ? 1 : -1) : tr * (dr >= 0 ? 1 : -1);
    const width = horizontal ? tr : tc;
    return depth >= 0 && depth <= radius && Math.abs(width) <= 1;
  }
  if (shape === 'cross') {
    return Math.abs(cell.col - center.col) + Math.abs(cell.row - center.row) <= radius;
  }
  /*
    ★ 0.1.3 星形：3×3 方块 **并上** 上下左右各 2 格的十字
    （锏的「对周围 8 格加前后左右 2 格处」）。
    两个判定是"或"的关系 —— 取并集，所以距离 1 的那 4 格只会被算**一次**
    （如果拆成两次范围伤害去叠，它们会被打两遍，次数就和描述对不上了）。
  */
  if (shape === 'star') {
    if (withinRadius(center, cell, 1)) return true;
    const dc = Math.abs(cell.col - center.col);
    const dr = Math.abs(cell.row - center.row);
    return (dc === 0 && dr <= 2) || (dr === 0 && dc <= 2);
  }
  /*
    方形：用 withinRadius（切比雪夫），**不能**再叠一条曼哈顿距离。
    叠了的话斜角那 4 格会被排除掉，"3×3"实际只打到一个十字。
  */
  return withinRadius(center, cell, radius);
}

/**
 * 相邻格子的偏移量。**顺序固定**，因为"多个格子一样近时先看谁"会影响走位，
 * 顺序一变，同样的局面就会走出不同的路 —— 联机时两边就分叉了。
 *
 * 四方向用「上、左、右、下」（行优先）：
 *     □
 *   □ ■ □
 *     □
 * 八方向用「上排左→右、中排左→右、下排左→右」。
 */
const ORTHOGONAL_OFFSETS: ReadonlyArray<{ dc: number; dr: number }> = [
  { dc: 0, dr: -1 },
  { dc: -1, dr: 0 },
  { dc: 1, dr: 0 },
  { dc: 0, dr: 1 },
];

const ANY_OFFSETS: ReadonlyArray<{ dc: number; dr: number }> = [
  { dc: -1, dr: -1 },
  { dc: 0, dr: -1 },
  { dc: 1, dr: -1 },
  { dc: -1, dr: 0 },
  { dc: 1, dr: 0 },
  { dc: -1, dr: 1 },
  { dc: 0, dr: 1 },
  { dc: 1, dr: 1 },
];

/** 某个移动方式下，能走到的相邻格子（按固定顺序） */
export function neighborsOf(center: Cell, style: MoveStyle = 'orthogonal'): Cell[] {
  const offsets = style === 'any' ? ANY_OFFSETS : ORTHOGONAL_OFFSETS;
  const out: Cell[] = [];
  for (const { dc, dr } of offsets) {
    const col = center.col + dc;
    const row = center.row + dr;
    if (!isInside(col, row)) continue;
    out.push({ col, row });
  }
  return out;
}

/**
 * ★ 从 from 出发、**绕过所有占位棋子**能走多远（BFS 距离表）。
 *
 * 【为什么需要"可达性"？】（你报的第 4 条）
 * `cellDistance` 是"几何距离"，它不管路上有没有人。
 * 但索敌要的是"我能不能走过去打到它"—— 那是**路径可达性**。
 * 后排近战被自己人堵死时，几何上最近的敌人可能一步都走不到，
 * 而远处的敌人反而绕得过去。这个函数就是给"换目标"提供依据的：
 * dist[某格] = 从起点走到那一格最少要几步（-1 = 走不到）。
 *
 * 【为什么是"不能穿人"？】
 * 因为棋子移动就是不能穿过其他棋子（见 findStepToward 的贪心）。
 * 目标自己站的那一格也标记为"不可走"，因为我们已经站不进去了；
 * 调用方要的是"贴着它"的格子，那些自然会算出来。
 *
 * 结果同样只依赖确定性输入（固定邻居顺序 + 先进先出队列），
 * 所以联机两边算出来必然一致。
 */
export function bfsDistances(state: BattleState, from: Cell, style: MoveStyle): Int32Array {
  const dist = new Int32Array(BOARD_W * BOARD_H).fill(-1);
  const start = from.row * BOARD_W + from.col;
  dist[start] = 0;
  const queue: number[] = [start];
  let head = 0;
  while (head < queue.length) {
    const current = queue[head++]!;
    const col = current % BOARD_W;
    const row = (current - col) / BOARD_W;
    const step = dist[current]! + 1;
    for (const next of neighborsOf({ col, row }, style)) {
      const key = next.row * BOARD_W + next.col;
      if (dist[key] !== -1) continue;
      if (state.cellToUnit[key] !== CELL_EMPTY) continue; // 有人占着，走不过去
      dist[key] = step;
      queue.push(key);
    }
  }
  return dist;
}

/**
 * 判断某个队伍的棋子可以摆在哪。
 *
 * 两方是**左右**对峙的：
 *   队伍 0 在左半边，占列 0 .. TEAM_0_MAX_COL
 *   队伍 1 在右半边，占列 TEAM_1_MIN_COL .. BOARD_W-1
 * 所以这里判断的是 col 的范围。
 */
export function isValidPlacement(team: 0 | 1, cell: Cell): boolean {
  if (!isInside(cell.col, cell.row)) return false;
  if (team === 0) return cell.col <= TEAM_0_MAX_COL;
  return cell.col >= TEAM_1_MIN_COL;
}

/** 查询某格上站着哪个棋子，返回 unitId 或 CELL_EMPTY */
export function unitAt(state: BattleState, cell: Cell): number {
  if (!isInside(cell.col, cell.row)) return CELL_EMPTY;
  return state.cellToUnit[cellIndex(cell.col, cell.row)];
}

/** 把棋子从棋盘占用表上移除 */
export function clearCell(state: BattleState, cell: Cell): void {
  if (!isInside(cell.col, cell.row)) return;
  state.cellToUnit[cellIndex(cell.col, cell.row)] = CELL_EMPTY;
}

/** 把棋子登记到棋盘占用表上 */
export function occupyCell(state: BattleState, cell: Cell, unitId: number): void {
  state.cellToUnit[cellIndex(cell.col, cell.row)] = unitId;
}

/** 两个格子是不是同一格 */
function sameCell(a: Cell, b: Cell): boolean {
  return a.col === b.col && a.row === b.row;
}

/**
 * 决定棋子下一步该走到哪个格子。
 *
 * 做法：看自己能走到的相邻空格（四方向 = 上下左右），挑一个「离目标最近」的。
 * 如果有多个格子一样近，就选顺序上最靠前的那个 —— 这一步很重要！
 * 随机选的话，两台电脑可能走出不同的路，战斗结果就分叉了。
 *
 * @returns 目标格；如果无处可走（被围住了）返回 null
 */
export function findStepToward(
  state: BattleState,
  from: Cell,
  toward: Cell,
  style: MoveStyle = 'orthogonal',
  avoid?: Cell | null,
): Cell | null {
  const base = cellDistance(from, toward, style);
  const closer: Cell[] = [];
  for (const candidate of neighborsOf(from, style)) {
    if (unitAt(state, candidate) !== CELL_EMPTY) continue; // 有人占了
    if (cellDistance(candidate, toward, style) < base) closer.push(candidate);
  }

  if (closer.length > 0) {
    /*
      ★ 「同样近的格子有多个时，别挑刚走过来的那一格」（你报的第 4 条）。
      【为什么这是必要的？】
      多个方向一样近时，原逻辑永远取"邻居顺序上最靠前"的那个。
      如果那个格子正好是**上一步的来路**，棋子就会 A -> B -> A -> B 地
      来回摆动 —— 每一步都"变近了"（相对上一格），合起来却原地转圈。
      所以同距离的候选里优先挑**不是来路**的那个。
      只在"确实有并列选项"时才生效，而且筛选保持原有顺序，
      所以走位结果依旧是完全确定的。
    */
    let min = Number.MAX_SAFE_INTEGER;
    for (const candidate of closer) {
      min = Math.min(min, cellDistance(candidate, toward, style));
    }
    const tied = closer.filter((candidate) => cellDistance(candidate, toward, style) === min);
    const picked = avoid ? (tied.find((candidate) => !sameCell(candidate, avoid)) ?? tied[0]!) : tied[0]!;
    return picked;
  }

  /*
    ★ 贪心走不动了 -> 退化成一次 BFS 绕路。
    【为什么需要这一层？】
    上面那一段是"只看一步"：四个相邻格子里有没有**严格更近**的。
    如果两个方向都被占住（贴脸的敌人、或者自己被自己人夹在中间），
    它就一步都迈不出去 —— 而且会**永远**迈不出去，因为下一 tick 局面一模一样。
    表现出来就是"这个棋子站着不动、也不打人"。

    最典型的触发方式是瞬移类技能：赤刃明霄陈 3 星 / 耀骑士临光 3 星
    会直接落进敌人堆里，落地就被三面包夹，那个 +1000% 的攻击力一次都打不出来。
    （你报的第 8 条。）

    【为什么不干脆把贪心换成 BFS？】
    因为贪心是**现在**的行为，全项目的战斗结果都按它算过（含各种测试里的期望值）。
    只在贪心失败时才走 BFS，正常走位就一个字节都不会变。
    BFS 的结果同样是确定的：固定邻居顺序 + 先进先出队列。
  */
  return findDetourStep(state, from, toward, style);
}

/**
 * 贪心失败时的兜底：BFS 找一条能绕开人群的最短路，返回**第一步**。
 *
 * 终点不是"目标站的格子"（那格被目标自己占着），而是"任何一个贴着目标的格子"。
 */
function findDetourStep(state: BattleState, from: Cell, toward: Cell, style: MoveStyle): Cell | null {
  const indexOf = (cell: Cell): number => cell.row * BOARD_W + cell.col;
  const reached = (cell: Cell): boolean => cellDistance(cell, toward, style) <= MELEE_RANGE;
  if (reached(from)) return null;

  // firstStep[i] = 从起点走到格子 i 的第一步（起点自己的第一步就是邻居本身）
  const firstStep = new Map<number, Cell>();
  const seen = new Set<number>([indexOf(from)]);
  const queue: Cell[] = [from];

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const next of neighborsOf(current, style)) {
      const key = indexOf(next);
      if (seen.has(key)) continue;
      // 目标自己站的那一格可以当作终点（虽然"有人占着"）
      const isTargetCell = next.col === toward.col && next.row === toward.row;
      if (!isTargetCell && unitAt(state, next) !== CELL_EMPTY) continue;
      seen.add(key);
      const step = current === from ? next : firstStep.get(indexOf(current))!;
      if (reached(next)) return step;
      firstStep.set(key, step);
      queue.push(next);
    }
  }
  return null;
}

/**
 * 找出离 from 最近的敌方棋子。
 * 平局时（距离相同）返回 id 较小的那个，保证确定性。
 */
export function findNearestEnemy(
  state: BattleState,
  from: UnitLookup,
  origin: Cell,
  style: MoveStyle = 'orthogonal',
): number {
  let best = CELL_EMPTY;
  let bestDistance = Number.MAX_SAFE_INTEGER;
  for (const unit of state.units) {
    if (unit.dead) continue;
    if (unit.team === from.team) continue; // 只找敌人
    const distance = cellDistance(origin, unit.cell, style);
    // 严格小于才替换 => 距离相同时，保留先遍历到的（id 更小）
    if (distance < bestDistance) {
      bestDistance = distance;
      best = unit.id;
    }
  }
  return best;
}

/** 只需要知道 id / team 这几项，避免函数签名依赖整个 UnitState */export interface UnitLookup {
  id: number;
  team: 0 | 1;
  moveStyle?: MoveStyle;
}

/** 按 id 取棋子。因为 units 数组按 id 升序，可以用下标直查，速度快且确定 */
export function getUnit(state: BattleState, unitId: number): import('./types.js').UnitState | undefined {
  if (unitId < 0) return undefined;
  const unit = state.units[unitId - state.units[0]!.id];
  if (!unit || unit.id !== unitId) {
    // 兜底：id 不连续时退化为线性查找
    return state.units.find((u) => u.id === unitId);
  }
  return unit;
}

/** 某个队伍还活着几个棋子 */
export function aliveCount(state: BattleState, team: 0 | 1): number {
  let n = 0;
  for (const unit of state.units) {
    if (!unit.dead && unit.team === team) n++;
  }
  return n;
}

/** 某个队伍的剩余总血量，单位 FIX */
export function totalHp(state: BattleState, team: 0 | 1): number {
  let hp = 0;
  for (const unit of state.units) {
    if (!unit.dead && unit.team === team) hp += Math.max(0, unit.hp);
  }
  return hp;
}

/** 某个队伍的血量上限总和，单位 FIX */
export function totalMaxHp(state: BattleState, team: 0 | 1): number {
  let hp = 0;
  for (const unit of state.units) {
    if (unit.team === team) hp += unit.maxHp;
  }
  return hp;
}

// ============================================================
// ★ 0.0.3：布阵站位（单机对手 / 野怪波次共用）
// ============================================================

/**
 * 把一批单位摆到某一半场：**近战靠前、远程靠后，行号往中间靠**。
 *
 * 【为什么要统一到一个函数？】
 * 单机对手（`enemy-lineup.ts`）和野怪波次（`monster-data.ts`）都要排站位。
 * 两边各写一份的话，改手感时必然漏掉一边（这个项目踩过很多次）。
 *
 * 【规则】
 *   1. 按射程分两拨：射程 ≤1 的算近战，>1 的算远程；近战占**靠近中线**的列，
 *      远程占**靠后**的列（对手在右半场时：中线是第 5 列，后排是第 9 列）。
 *   2. 行号从**中间**往两边排（4,5,3,6,2,7,…），不再从最上面一行开始 ——
 *      以前所有敌人都挤在竞技场上方，看着像"贴边站"。
 *   3. 同一拨的人**轮流**分配到它那几列上（一列一个、回来再放第二个），
 *      这样人少时也不会排成一条竖线。
 *
 * @param team 这批单位属于哪一队（0 = 左半场，1 = 右半场）
 * @param ranges 每个单位的射程（顺序要和返回的数组一一对应）
 * @returns 和 `ranges` **同序**的格子数组（调用方不用重新对齐）
 */
export function formationCells(team: 0 | 1, ranges: readonly number[]): Cell[] {
  const cells: Cell[] = new Array(ranges.length);
  if (ranges.length === 0) return cells;

  // 列顺序：靠中线的在前。队伍 0 的中线在右（col 4 靠 5），队伍 1 的在左（col 5）
  const cols: number[] = [];
  if (team === 0) {
    for (let col = TEAM_0_MAX_COL; col >= 0; col--) cols.push(col);
  } else {
    for (let col = TEAM_1_MIN_COL; col < BOARD_W; col++) cols.push(col);
  }

  // 行顺序：从中间往两边（10 行时是 4,5,3,6,2,7,1,8,0,9）
  const rows: number[] = [];
  const lo = Math.floor((BOARD_H - 1) / 2);
  const hi = Math.ceil((BOARD_H - 1) / 2);
  for (let k = 0; k < BOARD_H; k++) {
    const a = lo - k;
    const b = hi + k;
    if (a >= 0) rows.push(a);
    if (b < BOARD_H && b !== a) rows.push(b);
  }
  const rowSlots = rows;

  const index = ranges.map((_, i) => i);
  const melee = index.filter((i) => ranges[i]! <= MELEE_RANGE);
  const ranged = index.filter((i) => ranges[i]! > MELEE_RANGE);

  /*
    分列：非空的那一拨至少占 1 列；按人数分，一列最多按 BOARD_H 个人。
    例：5 个近战 + 5 个远程 -> 近战 3 列、远程 2 列（人数多的那拨多占）。
  */
  const total = ranges.length;
  let meleeCols = 0;
  if (melee.length > 0 && ranged.length > 0) {
    meleeCols = Math.max(1, Math.min(cols.length - 1, Math.round((melee.length / total) * cols.length) || 1));
  } else if (melee.length > 0) {
    meleeCols = cols.length;
  }
  const rangedCols = cols.length - meleeCols;

  const meleeCells = cols.slice(0, meleeCols);
  const rangedCells = cols.slice(meleeCols, meleeCols + rangedCols);

  /** 把一组人轮流铺到给定的列上（一列一个，逐个往下走） */
  const layOut = (group: readonly number[], useCols: readonly number[]): void => {
    group.forEach((unitIndex, n) => {
      const col = useCols[n % useCols.length]!;
      const row = rowSlots[Math.floor(n / useCols.length) % rowSlots.length]!;
      cells[unitIndex] = { col, row };
    });
  };

  layOut(melee, meleeCells.length > 0 ? meleeCells : rangedCells);
  layOut(ranged, rangedCells.length > 0 ? rangedCells : meleeCells);
  return cells;
}
