/**
 * ============================================================
 *  ★★ 0.2.1：「统一命中时刻」—— 唯一实现
 * ============================================================
 *
 * 【为什么需要这个文件？】
 * 内核在一 tick 里连着报两条事件：
 *   ① `attack`   —— 这一下打出去了（谁打谁）；
 *   ② `damage`   —— 扣完血了（扣到多少、是不是致死）。
 * 两者是**同一 tick**，因为结算是一步算完的。但**画面上**不是：
 * 子弹 / 炮弹 / 音符 / 战术装置都要飞一段才到。
 *
 * 于是渲染层出现了三种时间：
 *   · 弹道自己 —— 在飞（对的）；
 *   · 命中贴图（序列帧）—— 早就按 `flight + stagger` 推后了（对的）；
 *   · **血条 / 受击闪白 / 程序化爆点** —— 还在 attack 当帧就发生了（错的）。
 * 用户看到的就是"敌人还没挨打，血先掉了"。5 个炮手（号炮/菲亚梅塔/维什戴尔/
 * 空爆/灰毫）+ 8 个子弹手的这个问题最明显（炮弹 3 格要飞 0.33 秒）。
 *
 * 【口径（用户选的方案 A）】
 * 出手这一瞬间该发生的（前倾、挥击、枪口、弹道飞出）**立刻**发生；
 * 命中这一瞬间该发生的（掉血、闪白、爆点、命中贴图、致死、闪避）**全部**
 * 等到「出手 + 飞行时间」再一起发生。一个数说了算 —— 就是这个文件。
 *
 * 【为什么配对不靠"再来一条事件"？】
 * 因为改内核要动校验和相关的代码路径，而这件事**纯属表现**。
 * `damage` 事件自带 `sourceId` / `targetId` / `attackType`，足够和 `attack` 配对：
 *   · `attackType === 'attack'` 的才是「普攻结算」（技能/溅射/持续伤害都是 `'spell'`）；
 *   · 同一 tick 里 attack → damage 是**成对顺序**出现的，
 *     所以"谁先推入谁先被认领"就够，不需要任何猜测。
 * ★★ 纯表现层：这个文件不产生任何战斗事件，不进校验和。
 */

import { tracerFlightSeconds } from './bolt-tracer-fx.js';
import { NOTE_FX_SECONDS, isNoteFx } from './note-fx.js';
import { ROSMON_SLAM_FX, ROSMON_SLAM_SECONDS } from './rosmon-slam-fx.js';

/**
 * 小于这个延迟就别推后了。
 *
 * 0.02 秒 = 一帧多（60fps 一帧 16.7ms）。低于它的推后**画面上看不出来**，
 * 却会多走一遍队列、多一次配对机会 ⇒ 平白增加"配错"的风险。
 */
export const IMPACT_MIN_DELAY_SECONDS = 0.02;

/**
 * 一条「还没被认领」的命中记录最多留多久。
 *
 * 正常配对只隔 0~0.7 秒（炮弹上限 0.7 秒）。留 3 秒是为了兜住
 * "有人闪避 / 免疫 / 被无敌吃掉 ⇒ `damage` 根本没发"的那些情况 ——
 * 那种攻击的命中记录会一直挂着，不清掉就会去偷下一次结算。
 */
export const IMPACT_QUEUE_MAX_AGE_SECONDS = 3;

/**
 * 「出手 → 命中」要多久（秒）—— **唯一实现**。
 *
 * @param fxId           `attack` 事件里的 `fx`（就是 `UnitDef.tracerFx` / `AttackProfile.fx`）
 * @param distanceWorld  出手点到命中点的世界距离（格 × `CELL`）
 * @returns 秒；`0` 表示"当场命中"（近战、白线、能量流）
 *
 * 【为什么按弹道 id 分派、而不是按干员？】
 * 因为"飞多久"是**弹道自己的属性**：同一种炮弹谁打都是 9 格/秒。
 * 数据里换了弹道 id，这里自动跟着变，不需要改任何一处代码。
 */
export function projectileFlightSeconds(fxId: string | undefined, distanceWorld: number): number {
  if (!fxId) return 0;
  /*
    ★ 距离先洗一遍：NaN / 负数会被 `tracerFlightSeconds` 一路算成 NaN，
    而 NaN 延迟会让"到点判断"永远为假 ⇒ 那一下的掉血**永远不播**（静默的坑）。
  */
  const distance = Number.isFinite(distanceWorld) ? Math.max(0, distanceWorld) : 0;
  /*
    音符（祥子金 / 海铃紫）：`notePathAt` 是**线性**推进的 ⇒ 末段那一帧才到，
    所以"飞完一整个 `NOTE_FX_SECONDS`"就是命中时刻。
  */
  if (isNoteFx(fxId)) return NOTE_FX_SECONDS;
  /*
    战术装置砸击（迷迭香）：整段下落就是 `ROSMON_SLAM_SECONDS`，
    落地那一帧才是命中（烟雾和爆炸也是那时才起的）。
  */
  if (fxId === ROSMON_SLAM_FX) return ROSMON_SLAM_SECONDS;
  // 子弹 / 炮弹：按"距离 ÷ 速度"算，并且有下限（贴脸也要看得见飞）和上限（别飘太久）
  return tracerFlightSeconds(fxId, distance);
}

/** 一条待认领的命中记录 */
interface ImpactRecord {
  /** 命中时刻（`replay.timeSeconds` 的坐标系） */
  at: number;
  sourceId: number;
  targetId: number;
}

/**
 * 「还没结算完的那几发」队列。
 *
 * 用法（`replay.ts` 里的唯一两处）：
 * ```ts
 * // attack 事件：这一发要飞多久？记下来
 * queue.push(now, event.unitId, event.targetId, delay);
 * // damage / death / dodge 事件：这一下是同一次出手的结算吗？
 * const at = queue.claim(now, event.sourceId, event.targetId);   // 有 ⇒ 推到 at 再播
 * ```
 *
 * ★ 为什么是 FIFO 而不是 Map<targetId, at>？
 *   因为同一个人可能在同一 tick 被**好几个人**打（满编对撞很常见），
 *   Map 会互相覆盖 ⇒ 只有最后那一发对得上，前面几发全变成"立刻掉血"。
 *   FIFO 的语义正好等于事件流本身的顺序：谁先出手谁先结算。
 */
export class ImpactQueue {
  private readonly records: ImpactRecord[] = [];
  private readonly maxAge: number;
  private readonly minDelay: number;

  constructor(maxAge = IMPACT_QUEUE_MAX_AGE_SECONDS, minDelay = IMPACT_MIN_DELAY_SECONDS) {
    this.maxAge = maxAge;
    this.minDelay = minDelay;
  }

  /**
   * 记下一次出手。
   * @returns 真正排上的延迟（秒）；`0` 表示"当场结算，什么都没排"
   */
  push(now: number, sourceId: number, targetId: number, delay: number): number {
    this.prune(now);
    // ★ 延迟太小 = 当场结算。**不要**排进队列，否则血条会晚一帧抖一下，
    //   而且这种"几乎同时"的记录是最容易被下一条结算偷走的那一批。
    if (!(delay > this.minDelay)) return 0;
    this.records.push({ at: now + delay, sourceId, targetId });
    return delay;
  }

  /**
   * 认领"这一条结算事件对应的命中时刻"。
   *
   * @returns 命中时刻；`null` 表示这不是一次"还在飞"的普攻 ⇒ 调用方立刻结算
   *
   * ★ 认领过的那条不会被第二次认领（`splice` 掉）：
   *   一次 attack 只会产生一条 `damage`，认领即消费。
   */
  claim(now: number, sourceId: number, targetId: number): number | null {
    this.prune(now);
    for (let i = 0; i < this.records.length; i++) {
      const record = this.records[i]!;
      if (record.targetId !== targetId || record.sourceId !== sourceId) continue;
      /*
        ★ 已经到点（甚至过点）的那条**不能**再用来推后：
        推后必然算出一个"过去的时间"，调用方要么当场播（等于没推后），
        要么塞进延迟队列里永远等不到。所以直接消费掉、返回 null。
      */
      const at = record.at;
      this.records.splice(i, 1);
      return at > now + this.minDelay ? at : null;
    }
    return null;
  }

  /**
   * 认领"这个人现在是不是正被一发还在飞的攻击打死"。
   *
   * `death` 事件里没有 `sourceId`（谁杀的只有上一条 `damage` 知道），
   * 所以死亡的延后必须靠"这条 damage 自己刚被推到几点"——
   * 由调用方把 `damage.lethal` 的那次认领结果记下来，这里只做查表。
   */
  pendingCount(): number {
    return this.records.length;
  }

  /** 每帧清一次过期记录（攻击被闪避/免疫吃掉时 `damage` 根本不发，那条记录会烂在队列里） */
  prune(now: number): void {
    for (let i = this.records.length - 1; i >= 0; i--) {
      if (this.records[i]!.at + this.maxAge < now) this.records.splice(i, 1);
    }
  }

  /** 重开一局 / seek 归零 */
  clear(): void {
    this.records.length = 0;
  }

  /** 测试用：现在队列里有几条（断言"该消费的消费掉了、该清的清掉了"） */
  liveCount(): number {
    return this.records.length;
  }
}
