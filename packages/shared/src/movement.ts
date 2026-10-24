import { BOARD_W, CELL_EMPTY, MELEE_RANGE, MOVE_COOLDOWN_TICKS, TICKS_PER_SECOND } from './constants.js';
import { bfsDistances, cellDistance, findStepToward, getUnit, isInside, moveStyleOf, withinRadius } from './field.js';
import { collectMods, effectiveRange } from './mods.js';
import type { BattleState, Cell, UnitState } from './types.js';

/** 攻击间隔（tick）= 常量 / 攻速，向上取整 */
export function attackInterval(attackSpeed: number): number {
  const speed = Math.max(1, attackSpeed);
  return Math.max(1, Math.ceil(24000 / speed));
}

/**
 * 清点「还有谁活着」。返回的数组顺序固定为「按 id 升序」。
 *
 * 【为什么必须固定顺序？】
 * 这是全项目最容易踩的坑：如果你写 `Object.keys()` 或者遍历一个 Set/Map，
 * JS 引擎不保证顺序一致（尤其是数字和字符串混用的 key），
 * 于是两台电脑处理棋子的先后顺序不同 —— 战斗结果就分叉了。
 * 所以内核里所有「遍历所有棋子」的地方，都走这个函数。
 */
export function unitOrder(state: BattleState): UnitState[] {
  const list: UnitState[] = [];
  for (const unit of state.units) {
    if (!unit.dead) list.push(unit);
  }
  return list;
}

/**
 * 这个棋子是"飞行单位"吗（身上有 airborne 机制）。
 *
 * 机制是开战时从羁绊解析出来挂在棋子上的 —— 见 types.ts 的 TraitMechanic。
 */
export function airborneRuleOf(
  unit: UnitState,
): { immuneToRangeAtMost: number } | null {
  const mechanics = unit.trait?.mechanics ?? [];
  for (const mechanic of mechanics) {
    if (mechanic.kind === 'airborne') return { immuneToRangeAtMost: mechanic.immuneToRangeAtMost };
  }
  return null;
}

/**
 * 攻击者**能不能**把防守者当目标。
 *
 * 【规则一：飞行单位打不到】
 * 你的设计是「攻击距离为 1 的敌方单位无法攻击飞行单位」。
 * 这里用的是**当前射程**（含羁绊的炮手 +2、技能的 +N 格），
 * 不是数据表里的基础射程 —— 按基础值判断的话，
 * "被加成成远程的单位"会被误判成近战。
 *
 * 【规则二：隐匿（原「隐秘」）】
 * 予愿安洁莉娜 3 星、凯尔希 3 星、深池伙友影刃精英写着"技能期间进入隐匿"。
 * 它和飞行**不是一回事**，要分开理解：
 *   · 飞行是"这一下**够不着**"（射程不够），所以**技能照样打得到**；
 *   · 隐匿是"你**根本选不中我**"，所以从候选名单里就划掉。
 *
 * 【作用范围：只挡"普通攻击"，不挡技能】
 * 你的原文是"无法**攻击**"，所以技能（法术、范围、单体指向）依然可以生效 ——
 * 这也让"用技能处理飞行 / 隐匿单位"成为一个有意义的应对手段。
 * 所以这个函数只在"普通攻击选目标"的地方调用。
 *
 * ★ 0.1.4：隐匿的完整口径（你的新规则）——
 *   「不会成为棋子的锁敌目标（也不会走向有隐匿的单位），但会被 AOE 技能伤害到」。
 *   三句话分别落在三个地方，改任何一个都要一起看：
 *     ① 不被锁敌 → 这里（`canTargetUnit` → `selectTarget`）；
 *     ② 不被走向 → `nearestApproachTarget`（只为走路而选目标的那个兜底）；
 *     ③ 会被 AOE 打到 → 范围伤害（`rules.ts` 的 splash / zone）**不经过**本函数，
 *        它是直接遍历范围内单位的 —— 所以这条是"天然成立"，
 *        有测试钉住（`packages/shared/test/stealth.test.ts`）。
 */
/**
 * ★★ 0.2（用户口径 2）：**嘲讽的作用半径** —— 所有嘲讽一律只影响周围 2 格。
 *
 * 【为什么写死一个常量，而不是继续用数据里的 `radius`？】
 * 用户的原话是"**全部**嘲讽效果只能对周围 2 个棋子生效" —— 这是一条**全局规则**，
 * 不是某一只单位的数值。`selectTarget` 里再夹一次上限（`Math.min`），
 * 所以数据里即使还写着 3 也只按 2 算；三条 `taunt` 数据也都已经改成 2，
 * 免得"数据说 3、实际按 2"这种两套账。
 *
 * ★ 半径按**方形**算（切比雪夫，`withinRadius`）——
 * 和"周围 N 格"的全局口径一致（曼哈顿会让斜角那 4 格白给）。
 */
export const TAUNT_RADIUS = 2;

export function canTargetUnit(state: BattleState, attacker: UnitState, defender: UnitState): boolean {
  if (isUntargetable(state, defender)) return false;
  /*
    ★★ 0.2（用户口径 3）：「射程为 1 的干员**最后**索敌飞行干员，在有其他单位时不管飞行单位」。
    ⇒ 飞行**不再是"完全打不到"**，而是"排到最后" —— 所以这里只要求"射程 > 0"，
      真正的优先级在 `selectTarget` 里（`airborneLastResortOnly` + 兜底那一档）。
    ★ 「完全打不到」那条老规则换成"最后打"之后，症状从"近战站着不动"
      变成"没人可打时才去打飞行" —— 用户要的就是这个手感。
  */
  return effectiveRange(state, attacker) > 0;
}

/**
 * ★★ 0.2：这个目标是不是"**只能最后打**"的（飞行单位 + 攻击者的射程够不着它）。
 *
 * 判据 = 目标有 `airborne` 机制、且攻击者的**当前**射程 ≤ 它的免疫阈值。
 *   · 射程 1 的近战打 `immuneToRangeAtMost: 1` 的飞行单位 → true（只有没别人打时才会选它）
 *   · 射程 3 的远程打同一只 → false（正常参与索敌）
 * ★ 用"加成之后的射程"（`effectiveRange`）：炮手羁绊给 +2 射程之后，
 *   一个本来够不着的近战就该能正常打飞行了 —— 和数据里那条 `airborne` 同一个口径。
 */
export function airborneLastResortOnly(
  state: BattleState,
  attacker: UnitState,
  defender: UnitState,
): boolean {
  const rule = airborneRuleOf(defender);
  if (!rule) return false;
  return effectiveRange(state, attacker) <= rule.immuneToRangeAtMost;
}

/**
 * 这个棋子现在能不能被选中。
 *
 * 两类情况走这里：
 *   · **隐匿**（予愿安洁莉娜 3 星、凯尔希 3 星、深池伙友影刃精英）—— 见 `canTargetUnit` 的说明；
 *   · **已死 / 倒地等复活**（后者是 Boss 二阶段，否则敌人会对着 0 血一直挥拳）。
 *
 * ★ 判据只有这一处：`selectTarget`（普攻锁敌）和 `nearestApproachTarget`（只为走路选目标）
 *   都调它 —— 这样"不被锁敌"和"不被走向"永远不会走散。
 */
export function isUntargetable(state: BattleState, unit: UnitState): boolean {
  if (unit.dead) return true;
  // ★ 0.0.3：倒地等复活的 Boss 不能被选中（否则敌人会对着 0 血一直挥拳）
  if (unit.downedUntilTick !== undefined) return true;
  return collectMods(state, unit).untargetable;
}

/**
 * 给一个棋子选目标。优先级**从上到下**（平局选 id 小的，保证确定性）：
 *
 *   1. 「优先攻击 X」类效果（`mods.preferLowestHp` 等）——
 *      ★★ 0.2（用户口径 6）：**高于嘲讽**。写了"优先攻击血量最低"的棋子
 *      不该被一个嘲讽单位拉走（那等于这条索敌效果白写了）。
 *   2. **嘲讽**（迷迭香的柱子 / 游击队盾卫 / 维娜的金狮子……）
 *      ★★ 0.2（用户口径 2）：**所有嘲讽一律只影响周围 2 格**（`TAUNT_RADIUS`）。
 *      以前"不写半径 = 全场"，一个柱子能把全地图的仇恨都吸走。
 *   3. 最近的敌人。
 *   4. ★★ 0.2（用户口径 3）：**飞行单位兜底** —— 射程够不着飞行的那些棋子
 *      （典型是射程 1 的近战）只有在"没别人可打"的时候才会去打它。
 *
 * 【为什么把飞行塞在最后一档，而不是像以前那样"直接不可选中"？】
 * 用户口径：「射程为 1 的干员**最后**索敌飞行干员，在有其他单位时不管飞行单位」。
 * 老做法是"完全打不到"，于是近战面对一只飞行的残血怪只能站着干等；
 * 新做法是"没人可打时才打它"，既保留"近战打飞行很吃亏"的手感，
 * 又不会出现"全场没人能收尾、战斗拖到超时"。
 */
export function selectTarget(state: BattleState, unit: UnitState, mods?: { preferLowestHp?: boolean }): number {
  const style = moveStyleOf(unit);

  /*
    ---- 1) 「优先攻击 X」类效果（用户口径 6：高于嘲讽）----
  */
  if (mods?.preferLowestHp) {
    let bestId = CELL_EMPTY;
    let bestHp = Number.MAX_SAFE_INTEGER;
    for (const other of state.units) {
      if (other.dead || other.team === unit.team) continue;
      if (!canTargetUnit(state, unit, other)) continue;
      if (airborneLastResortOnly(state, unit, other)) continue; // 飞行仍然排最后
      if (other.hp < bestHp) {
        bestHp = other.hp;
        bestId = other.id;
      }
    }
    if (bestId !== CELL_EMPTY) return bestId;
  }

  /*
    ---- 2) 嘲讽（最近的一个，且只在半径内）----
    ★ 半径固定按 `TAUNT_RADIUS`（2 格）**并且再夹一次上限**：
      数据里写 3 也只按 2 算 —— 用户口径是"全部嘲讽只能 2 格"。
  */
  let tauntId = CELL_EMPTY;
  let tauntDistance = Number.MAX_SAFE_INTEGER;
  for (const other of state.units) {
    /*
      ★ 0.2：若叶睦的锁血被动期间**临时带嘲讽**（数据里没有 `taunt`，靠
      `statuses['defyDeathUntil']` 记到哪一 tick）。两个来源都算"在嘲讽"。
    */
    const defyTaunt = (other.statuses['defyDeathUntil'] ?? 0) > state.tick;
    if (other.dead || other.team === unit.team || (!other.taunt && !defyTaunt)) continue;
    if (!canTargetUnit(state, unit, other)) continue;
    if (airborneLastResortOnly(state, unit, other)) continue;
    const radius = Math.min(TAUNT_RADIUS, other.tauntRadius ?? TAUNT_RADIUS);
    if (!withinRadius(unit.cell, other.cell, radius)) continue;
    const distance = cellDistance(unit.cell, other.cell, style);
    if (distance < tauntDistance) {
      tauntDistance = distance;
      tauntId = other.id;
    }
  }
  if (tauntId !== CELL_EMPTY) return tauntId;

  /*
    ---- 3) 最近的敌人 / 4) 飞行兜底 ----
    一趟遍历同时算两个答案：普通目标里最近的，以及"只能最后打"的目标里最近的。
    普通目标一旦找到就直接用；一个都没有时才退到飞行那一个。
  */
  let bestId = CELL_EMPTY;
  let bestDistance = Number.MAX_SAFE_INTEGER;
  /*
    ★★ 0.2：**低存在感**（八幡海铃）。语义是"敌方攻击范围内若有两名可选目标，
    则优先索敌另外一个" ⇒ 有普通目标时，低存在感的人**完全排到最后**
    （等同"只有它一个人时才打它"）。
    ★ 判据走 `collectMods`：这个效果是她的被动，可能被限时包覆盖，不能读死数据。
  */
  let lowId = CELL_EMPTY;
  let lowDistance = Number.MAX_SAFE_INTEGER;
  let fallbackId = CELL_EMPTY;
  let fallbackDistance = Number.MAX_SAFE_INTEGER;
  for (const other of state.units) {
    if (other.dead || other.team === unit.team) continue;
    if (!canTargetUnit(state, unit, other)) continue;
    const distance = cellDistance(unit.cell, other.cell, style);
    if (airborneLastResortOnly(state, unit, other)) {
      if (distance < fallbackDistance) {
        fallbackDistance = distance;
        fallbackId = other.id;
      }
      continue;
    }
    if (collectMods(state, other).lowPresence) {
      if (distance < lowDistance) {
        lowDistance = distance;
        lowId = other.id;
      }
      continue;
    }
    if (distance < bestDistance) {
      bestDistance = distance;
      bestId = other.id;
    }
  }
  if (bestId !== CELL_EMPTY) return bestId;
  if (lowId !== CELL_EMPTY) return lowId;
  return fallbackId;
}

/**
 * 最近的敌人 —— **忽略"射程打不到"，但不忽略"隐匿"**。只用来走路。
 *
 * ============================================================
 *  【它和 selectTarget 的分工】
 * ============================================================
 * `selectTarget` 是"能打谁"（会被 `canTargetUnit` 筛掉飞行 / 隐匿 / 倒地），
 * 这个函数是"打不到的时候朝谁走"，两个筛选口径**故意不一样**：
 *
 *   · **忽略射程免疫** —— 当年你报的「1 攻击距离的单位锁不到飞行单位会挂机」：
 *     近战选目标会跳过飞行单位（正确），但如果敌方**全是飞行单位**，
 *     `selectTarget` 一个都选不出来，原代码就 `nextActionTick = tick + 1; return;`
 *     —— 原地罚站到死。打不到飞行是设计（飞行羁绊的效果），不能改；
 *     但"站着不动"不是设计，是没写。所以给它一个**只用来走路**的目标：
 *     打不到你，我也要走到你脚下。视觉上不再像卡住，也让"被飞行队白嫖"
 *     这件事在棋盘上看得见（玩家能明白该补远程）。
 *
 *   · **不忽略隐匿**（★ 0.1.4 新增）—— 你的新规则写得很明确：
 *     「也不会**走向**有隐匿的单位」。所以隐匿单位要在这里也筛掉，
 *     否则会出现"打不到它、却一路朝它走过去"这种和规则相反的表现。
 *
 * ★ 顺带把"已死 / 倒地等复活"也一起筛掉（走 `isUntargetable`）：
 *   朝一具尸体或一个正在倒地的 Boss 走没有任何意义，
 *   而旧版本只看了 `other.dead`，没看 `downedUntilTick`。
 */
export function nearestApproachTarget(state: BattleState, unit: UnitState): number {
  const style = moveStyleOf(unit);
  let bestId = CELL_EMPTY;
  let bestDistance = Number.MAX_SAFE_INTEGER;
  for (const other of state.units) {
    if (other.team === unit.team) continue;
    // ★ 隐匿 / 已死 / 倒地等复活 —— 都不走向（和"不被锁敌"同一个判据）
    if (isUntargetable(state, other)) continue;
    const distance = cellDistance(unit.cell, other.cell, style);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestId = other.id;
    }
  }
  return bestId;
}

/**
 * 尝试向目标移动一格。
 * @returns 是否真的移动了
 */
export function tryMoveToward(state: BattleState, unit: UnitState, target: UnitState): boolean {
  if (unit.statuses['stun'] && unit.statuses['stun']! > 0) return false;
  if (unit.moveCooldown > 0) return false;

  const style = moveStyleOf(unit);

  // 已经在攻击距离内（贴脸）就不用动了
  if (cellDistance(unit.cell, target.cell, style) <= MELEE_RANGE) return false;

  const from = { col: unit.cell.col, row: unit.cell.row };
  const best = findStepToward(state, from, target.cell, style, unit.prevCell ?? null);
  if (!best) {
    // 想走但一步都迈不出去 —— 记一笔。连续几次之后上层会换一个"走得到"的目标
    // （见 rules.ts actUnit 与 SelectReachableTarget 的说明）
    unit.blockedTicks++;
    return false;
  }

  // 从旧格子摘掉，登记到新格子
  state.cellToUnit[from.row * BOARD_W + from.col] = CELL_EMPTY;
  state.cellToUnit[best.row * BOARD_W + best.col] = unit.id;
  unit.cell = best;
  unit.moveCooldown = MOVE_COOLDOWN_TICKS;
  unit.blockedTicks = 0; // 走成了，清掉"卡住"计数
  unit.prevCell = from; // 记下来，避免下一步原地走回去

  state.log.push({ type: 'move', t: state.tick, unitId: unit.id, from, to: { col: best.col, row: best.row } });
  return true;
}

/**
 * ★ 换一个"**真的走得到**"的敌人来打（你报的第 4 条）。
 *
 * 【和 selectTarget 的区别】
 *   selectTarget        —— 按**几何格距**挑最近的（这是原来的规则，保留）
 *   本函数              —— 按**路径长度**挑绕得过去的
 *
 * 【为什么要分开？】
 * 因为"最近"和"能打到"是两件事。正常对局里两者一致，
 * 只有在被队友堵住的时候才会分叉 —— 而正是那种时候棋子会罚站。
 * 所以本函数只在"连续挪不动"时才被调用（见 rules.ts），
 * 正常走位一点都不会变，战斗结果也就不会被大面积改写。
 *
 * 【怎么算"走得到"？】
 * 一次 BFS 拿到全场可达距离表，然后对每个敌人求
 * "站到能打到它的某一格，最少要几步"。0 步 = 现在就能打；
 * 全是 -1 = 谁也够不着（那就返回 -1，让上层维持原目标）。
 */
export function selectReachableTarget(state: BattleState, unit: UnitState): number {
  const style = moveStyleOf(unit);
  const reach = effectiveRange(state, unit);
  const dist = bfsDistances(state, unit.cell, style);

  let bestId = CELL_EMPTY;
  let bestCost = Number.MAX_SAFE_INTEGER;
  for (const other of state.units) {
    if (other.dead || other.team === unit.team) continue;
    if (!canTargetUnit(state, unit, other)) continue;

    let cost = Number.MAX_SAFE_INTEGER;
    // 扫"打得到它"的每一格（以它为中心、边距 = 射程的方框）
    for (let row = other.cell.row - reach; row <= other.cell.row + reach; row++) {
      for (let col = other.cell.col - reach; col <= other.cell.col + reach; col++) {
        if (!isInside(col, row)) continue;
        if (cellDistance({ col, row }, other.cell, style) > reach) continue;
        const d = dist[row * BOARD_W + col]!;
        if (d >= 0 && d < cost) cost = d;
      }
    }
    // 严格更小才替换 => 距离相同时保留先遍历到的（id 更小），保证确定性
    if (cost < bestCost) {
      bestCost = cost;
      bestId = other.id;
    }
  }
  return bestId;
}

/** 结算状态效果的倒计时：每 tick 减 1，归零则移除 */
export function tickStatuses(state: BattleState, unit: UnitState): void {
  /*
    ★ 0.2：`shield` **不在这里**了 —— 护盾现在有四种状态（剩余时长 / 剩余量 /
    衰减速度 / 护盾期间不许回技力），还有"破了要补一层再炸一下"的后续，
    全部交给 `combat-math.ts` 的 `tickShield`。同一条规则只允许一处实现。
  */
  // 固定顺序处理状态，避免对象 key 顺序问题
  for (const key of ['stun', 'attackSpeedBuff', 'attackDamageBuff']) {
    const value = unit.statuses[key];
    if (value === undefined || value <= 0) continue;
    const next = value - 1;
    if (next <= 0) {
      delete unit.statuses[key];
      if (key === 'attackSpeedBuff') delete unit.statuses['attackSpeedBonusBp'];
      if (key === 'attackDamageBuff') delete unit.statuses['attackDamageBonusBp'];
    } else {
      unit.statuses[key] = next;
    }
  }
}

/**
 * 把某个空格附近的「可行走格子」找出来 —— 供需要位移的技能使用。
 * 目前技能没有位移效果，这里留个口子，后面加「突进/击退」时直接用。
 */
export function freeCellsAround(state: BattleState, center: Cell, radius: number): Cell[] {
  const out: Cell[] = [];
  for (let row = center.row - radius; row <= center.row + radius; row++) {
    for (let col = center.col - radius; col <= center.col + radius; col++) {
      if (!isInside(col, row)) continue;
      if (state.cellToUnit[row * BOARD_W + col] !== CELL_EMPTY) continue;
      out.push({ col, row });
    }
  }
  return out;
}

export { getUnit };
