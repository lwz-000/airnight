import type { Cell } from '../../../../packages/shared/src/index.js';

/**
 * ============================================================
 *  布阵阶段棋子的「排布计划」（纯函数）
 * ============================================================
 *
 * 【为什么单独抽出来？—— 这里踩过一个很难查的坑】
 *
 * 原来的 `syncPrepSprites()` 只做两件事：
 *   1. 有新棋子 -> 创建一个精灵
 *   2. 棋子没了 -> 删掉精灵
 * 而**已经存在的精灵，位置从来不更新**。
 *
 * 后果：
 *   · 你拖动一个棋子换位置，数据变了、**贴图还留在原地**
 *   · 两个棋子交换位置时，两边数据都变了、两个贴图都留在原地 ——
 *     于是画面上的 A 其实站在 B 的格子上
 *   · 更糟的是拾取是按"贴图在哪"算的，所以接下来你拖的会是**另一个棋子**，
 *     整个棋盘看起来就是"位置乱飞、怎么拖都不对"
 *
 * 根因不是"忘了写一行"，而是**这个函数的结构本身漏了"更新"这一种情况**：
 * 它的分支只覆盖了"增"和"删"。
 *
 * 所以现在拆成两步：
 *   `planPrepSprites()` —— 纯函数：**当前应该有哪些精灵、各自在哪**（可测试）
 *   `syncPrepSprites()` —— 把实际画面调整成计划的样子（增 / 删 / **移动**）
 * 计划是"目标状态"，同步是"让它变成目标状态"，
 * 这样就不会再漏掉某一种变化类型 —— 移动、换位、升星都只是"计划变了"。
 */

/** 一个棋子精灵应该长什么样、站在哪 */
export interface SpritePlan {
  /**
   * 棋子唯一编号（用来对应到具体那个精灵）。
   * 一般是玩家自己的正数 uid；对手棋子默认编成**负数**（见 ENEMY_UID_BASE）。
   * ★ 例外：测试模式的红方沙盒会给对手棋子传它**自己的真实 uid**（也是正数），
   *   这样它挪动/增删时不会被下标错位带偏。
   */
  uid: number;
  defId: string;
  star: number;
  /** 逻辑格子（原始坐标，不是视角坐标） */
  cell: Cell;
  /**
   * ★ 0.0.3：这个棋子身上装了几件 A 类藏品（0~2），用来画血条左边那两个小圆点。
   *
   * 【为什么计划里要带它？】
   * 和 defId / star 同一个理由：装备是**棋子外观的一部分**。
   * 计划里没有它的话，"装上藏品"这件事就永远不会被同步到画面上 ——
   * 玩家拖完藏品，装备生效了（数值真的变了），但棋子身上还是两个灰点。
   * 带上之后，diffPrepSprites 会把它当成一种**必须被处理的变化**（retooled）。
   */
  items?: number;
  /** 是不是对手的棋子（血条按敌方红色画；也不参与拾取/拖动） */
  enemy?: boolean;
}

/**
 * 对手棋子的 uid 从这里开始往下发。
 *
 * 【为什么要专门一段负数？】
 * 玩家的棋子 uid 来自 `nextUid()`，从 1 开始递增，永远是正数。
 * 对手的棋子**不在 state.placements 里**（那是玩家的阵容），
 * 所以它们需要一个自己的编号空间，才能和玩家棋子一起塞进同一张
 * `Map<uid, Sprite>` 里被统一增删改。
 * 只要不和正数撞车就行，这里取一个大一点的负基数，留足空间。
 */
export const ENEMY_UID_BASE = -100000;

/** 这个 uid 是不是对手的棋子 */
export function isEnemyUid(uid: number): boolean {
  return uid <= ENEMY_UID_BASE;
}

/** 对局阶段。和 state.ts 里的 GameState['phase'] 一致 */
export type GamePhase = 'prep' | 'battle' | 'result' | 'shop';

/**
 * 布阵棋子该不该显示。
 *
 * 【★ 为什么必须单独问一句"现在是什么阶段"？—— 这里踩过一个坑】
 * 这些精灵代表的是**玩家摆的阵容**（静止的、按格子摆好的）。
 * 战斗一开始，演出层会另外生成一套会动的棋子；
 * 如果这套静止的没被收起来，画面上就会**同一格叠着两个棋子**。
 * 因为两套一开始位置完全重合，你根本看不出来 ——
 * 直到棋子开始移动，静止的那个留在原地，才显得像"移动时留下了一个残影"。
 *
 * 具体的 bug 经过：把精灵同步放进了 `renderAll()`（为了修"升星后旧贴图不消失"），
 * 但 `renderAll()` 在战斗中也会被调用，于是每次调用都把布阵棋子**重新建了出来**。
 *
 * 教训：这不只是"记得加个 if"，而是**函数在问"该画什么"时必须知道"现在能不能画"**。
 * 所以把阶段做成 `planPrepSprites` 的必填参数 ——
 * 调用方不可能再"忘了判断阶段"，因为不传就编译不过。
 */
export function prepSpritesVisible(phase: GamePhase): boolean {
  /*
    ★★ 0.2：**商店回合也要继续画**。
    商店回合是"回合之间插入的 90 秒"，玩家在里头买东西、卖东西 ——
    棋盘上摆着什么正是他决定"要不要买这张 2 星"的依据。
    而且它是个**可关闭的弹窗**：关掉之后画面必须还是自己那个棋盘，
    如果这时候棋子凭空消失，玩家会以为阵容丢了。
    所以 `shop` 和 `prep` 一样算"布阵可见"。
  */
  return phase === 'prep' || phase === 'shop';
}

/**
 * 布阵阶段要不要画「单机人机对手」的预览？
 *
 * ============================================================
 *  ★ 为什么单独抽成一个函数？—— 这里也踩过一个 bug
 * ============================================================
 * 这个判断原来散在 `syncPrepSprites()` 里，只写了两个条件，
 * 结果**联机对局里也满足那两条**，于是每台客户端的右半场都凭空多出
 * 一队"人机对手"—— 而那是按本机 state.seed 生成的人机阵容，
 * 跟房间里真正的对手（服务器通过 battleStart 下发的）毫无关系。
 *
 * 【三个条件缺一不可】
 *   · netplay=false：人机预览是**单机专属**。联机里看别人摆了什么
 *     走「点玩家列表 -> 看他的棋盘」那条路，不该凭空造一队假的；
 *   · onGameView：大厅里 `state.phase` 也是 'prep'，但游戏还没开始；
 *   · !viewingOther：正在看别人的棋盘时，画面已经被人家的棋子占满了。
 *
 * 抽成纯函数之后，这条规则可以被毫秒级断言钉住（见 prep-sprites 的测试），
 * 不用真的开两台浏览器联机去肉眼看。
 */
export function shouldShowSoloEnemy(input: {
  netplay: boolean;
  onGameView: boolean;
  viewingOther: boolean;
}): boolean {
  return !input.netplay && input.onGameView && !input.viewingOther;
}

/**
 * 由场上的阵容算出精灵排布计划。
 *
 * 【为什么"计划"里要带 defId 和 star？】
 * 因为合成会让棋子**变成另一个东西**（1 星变 2 星）。
 * 如果计划里只有位置，同步逻辑就不知道"这个精灵的贴图该换了"，
 * 于是升级之后画面上还是 1 星的卡片。
 * 带上这两个字段，同步逻辑就能一并处理"贴图要重画"。
 *
 * 返回值按 uid 升序，保证每次算出来的顺序一致（渲染和比较都依赖这个）。
 *
 * @param options.phase 当前阶段。**不是布阵阶段就返回空计划** ——
 *   空计划意味着"所有精灵都该被移除"，同步逻辑会照做。
 * @param options.enemy 对手的棋子（0.0.2 追加需求：布阵阶段就能看到对方）。
 *   它们不在 state.placements 里，所以单独传进来，统一编成负 uid。
 */
export function planPrepSprites(
  placements: ReadonlyArray<{ uid: number; defId: string; star: number; cell: Cell; items?: string[] }>,
  options: {
    phase: GamePhase;
    enemy?: ReadonlyArray<{ uid?: number; defId: string; star: number; cell: Cell; items?: string[] }>;
  },
): SpritePlan[] {
  if (!prepSpritesVisible(options.phase)) return [];

  const mine: SpritePlan[] = placements.map((placement) => ({
    uid: placement.uid,
    defId: placement.defId,
    star: placement.star,
    cell: { col: placement.cell.col, row: placement.cell.row },
    // 圆点只看"装了几件"（见 SpritePlan.items）；具体是哪两件不影响外观
    items: placement.items?.length ?? 0,
  }));

  /*
    对手：按**阵容顺序**编号（ENEMY_UID_BASE - index）。
    用下标而不是"棋子的某种特征"做编号，是因为对手阵容每个回合都会变
    （升级、加人、换人），用下标才能让"同一个位置的棋子"保住它那个精灵，
    从而被识别成 moved/restyled 而不是"删掉重建" —— 重建会闪一下。
  */
  /*
    ★ 0.0.3：如果对手棋子自带 uid（测试模式的红方沙盒会带），就用它自己的 uid，
    而不是按下标编号 —— 这样红方挪走一只棋子时，别的棋子不会因为下标错位
    而被误判成"换人了"。没有 uid 的老调用（单机人机预览/联机预览）继续按下标编号。
  */
  const enemy: SpritePlan[] = (options.enemy ?? []).map((unit, index) => ({
    uid: unit.uid ?? ENEMY_UID_BASE - index,
    defId: unit.defId,
    star: unit.star,
    cell: { col: unit.cell.col, row: unit.cell.row },
    items: unit.items?.length ?? 0,
    enemy: true,
  }));

  return [...mine, ...enemy].sort((a, b) => a.uid - b.uid);
}

/**
 * 比较两份计划，得出该做什么。
 *
 * 【为什么要显式算出"差异"而不是在同步函数里 if-else 一堆？】
 * 因为这样"移动"这件事就变成了一个**必须被处理的动作**（`moved`），
 * 而不是一个"顺手看看位置对不对"的可选项 ——
 * 原来的 bug 就是因为位置更新是可选的（干脆没写）。
 * 而且差异是可测试的：给两份计划，断言"应该产生 1 个移动"。
 */
export interface SpriteDiff {
  /** 需要新建的 */
  created: SpritePlan[];
  /** 需要挪位置的（uid 相同但格子变了） */
  moved: SpritePlan[];
  /** 需要重画贴图的（uid 相同但棋子或星级变了） */
  restyled: SpritePlan[];
  /**
   * ★ 0.0.3：需要重画「藏品圆点」的（uid 相同但装备件数变了）。
   *
   * 【为什么不并进 restyled？】
   * 因为两者的代价完全不同：restyled 要**重建小人模型**（异步、会闪），
   * 而圆点只是换一张 3 档缓存里的小贴图。混在一起的话，
   * 装一件藏品就会白白重建一次小人 —— 玩家看到的是"拖一下就抖一下"。
   * 分开算，各自只做该做的那点事。
   */
  retooled: SpritePlan[];
  /** 需要删掉的 uid */
  removed: number[];
}

export function diffPrepSprites(
  before: ReadonlyArray<SpritePlan>,
  after: ReadonlyArray<SpritePlan>,
): SpriteDiff {
  const beforeByUid = new Map(before.map((plan) => [plan.uid, plan]));
  const afterByUid = new Map(after.map((plan) => [plan.uid, plan]));

  const diff: SpriteDiff = { created: [], moved: [], restyled: [], retooled: [], removed: [] };

  for (const plan of after) {
    const previous = beforeByUid.get(plan.uid);
    if (!previous) {
      diff.created.push(plan);
      continue;
    }
    if (previous.cell.col !== plan.cell.col || previous.cell.row !== plan.cell.row) {
      diff.moved.push(plan);
    }
    if (previous.defId !== plan.defId || previous.star !== plan.star) {
      diff.restyled.push(plan);
    }
    if ((previous.items ?? 0) !== (plan.items ?? 0)) {
      diff.retooled.push(plan);
    }
  }

  for (const plan of before) {
    if (!afterByUid.has(plan.uid)) diff.removed.push(plan.uid);
  }

  return diff;
}
