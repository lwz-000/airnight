/**
 * ============================================================
 *  ★★ 0.2.1：「统一命中时刻」—— 纯计算部分
 * ============================================================
 *
 * 【这一组钉的是什么】
 * 用户报的现象是"敌人还没挨打，血先掉了"。原因不是某一处画错了，
 * 而是**同一个"命中"被三个地方各算了一次、算出三个时间**：
 *   · 弹道 —— 在飞（对）；
 *   · 命中贴图 —— 已经按 flight 推后（对）；
 *   · 血条 / 闪白 / 程序化爆点 —— 还在 attack 当帧（错）。
 * 所以这一组测两件事：
 *   ① `projectileFlightSeconds()` 是**唯一**的"这一发飞多久"；
 *   ② `ImpactQueue` 的配对不吃错人（满编对撞时同一个人会被好几个人打）。
 *
 * 【为什么配对逻辑值得单独测】
 * 它是"猜"的那一半 —— 猜错不会报错，只会表现为"某个棋子莫名晚掉血"，
 * 是那种上线之后极难复现的 bug。所以这里把边界全钉一遍。
 */
import { describe, expect, it } from 'vitest';
import {
  IMPACT_MIN_DELAY_SECONDS,
  IMPACT_QUEUE_MAX_AGE_SECONDS,
  ImpactQueue,
  projectileFlightSeconds,
} from '../src/three/hit-timing.js';
import { NOTE_FX_SECONDS } from '../src/three/note-fx.js';
import { ROSMON_SLAM_FX, ROSMON_SLAM_SECONDS } from '../src/three/rosmon-slam-fx.js';

describe('★★ 弹道飞行时间：唯一实现', () => {
  it('★ 近战 / 没写弹道 / 白线 ⇒ 0（当场命中，行为和以前完全一样）', () => {
    expect(projectileFlightSeconds(undefined, 5)).toBe(0);
    expect(projectileFlightSeconds('', 5)).toBe(0);
    expect(projectileFlightSeconds('not_a_real_fx', 5)).toBe(0);
  });

  it('★★ 音符（祥子金 / 海铃紫）飞满一整个 `NOTE_FX_SECONDS`（线性轨迹）', () => {
    expect(projectileFlightSeconds('note', 3)).toBeCloseTo(NOTE_FX_SECONDS, 6);
    expect(projectileFlightSeconds('note_purple', 3)).toBeCloseTo(NOTE_FX_SECONDS, 6);
    // 音符的时长是固定的（不是按距离算的），距离不影响它
    expect(projectileFlightSeconds('note', 0.5)).toBeCloseTo(NOTE_FX_SECONDS, 6);
    expect(projectileFlightSeconds('note', 9)).toBeCloseTo(NOTE_FX_SECONDS, 6);
  });

  it('★★ 战术装置砸击 = 整段下落时长（落地那一帧才是命中）', () => {
    expect(projectileFlightSeconds(ROSMON_SLAM_FX, 2)).toBeCloseTo(ROSMON_SLAM_SECONDS, 6);
  });

  it('★★ 子弹按"距离 ÷ 速度"算，且随距离单调变长', () => {
    const near = projectileFlightSeconds('bullet_angel', 1);
    const far = projectileFlightSeconds('bullet_angel', 5);
    expect(near).toBeGreaterThan(0);
    expect(far).toBeGreaterThan(near);
  });

  it('★★ 炮弹比子弹慢（同距离下飞得更久）', () => {
    const bullet = projectileFlightSeconds('bullet_angel', 4);
    const shell = projectileFlightSeconds('shell_red', 4);
    expect(shell).toBeGreaterThan(bullet);
  });

  it('★ 都有上限：不会出现"半秒过去血还没掉"的离谱等待', () => {
    for (const id of ['bullet_angel', 'shell_red', 'shell_yellow', 'note', ROSMON_SLAM_FX]) {
      expect(projectileFlightSeconds(id, 100), `${id} 的飞行时间没有上限`).toBeLessThan(0.8);
    }
  });

  it('★ 负数 / NaN 距离不产生负数或 NaN', () => {
    for (const distance of [-5, Number.NaN]) {
      for (const id of ['bullet_angel', 'shell_red', 'note', ROSMON_SLAM_FX]) {
        const value = projectileFlightSeconds(id, distance);
        expect(Number.isFinite(value), `${id} @ ${String(distance)}`).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe('★★ 命中配对队列', () => {
  it('★ 延迟太小的不排队（当场结算，免得血条晚一帧抖一下）', () => {
    const queue = new ImpactQueue();
    expect(queue.push(10, 1, 2, 0)).toBe(0);
    expect(queue.push(10, 1, 2, IMPACT_MIN_DELAY_SECONDS)).toBe(0);
    expect(queue.liveCount(), '不该留下任何记录').toBe(0);
  });

  it('★★ 排上了就能被"同一发"的结算认领（按 source + target 配对）', () => {
    const queue = new ImpactQueue();
    const delay = queue.push(10, 1, 2, 0.3);
    expect(delay).toBeCloseTo(0.3, 6);
    expect(queue.liveCount()).toBe(1);
    const at = queue.claim(10, 1, 2);
    expect(at).toBeCloseTo(10.3, 6);
    // 认领即消费：同一发不会产生第二条结算
    expect(queue.claim(10, 1, 2)).toBeNull();
    expect(queue.liveCount()).toBe(0);
  });

  it('★★ 别人打同一个目标不会被认走（source 不同 ⇒ 不是这一发）', () => {
    const queue = new ImpactQueue();
    queue.push(10, 1, 9, 0.3);           // 1 号打 9 号
    expect(queue.claim(10, 7, 9), '7 号没打人，不该认走 1 号那发').toBeNull();
    expect(queue.liveCount()).toBe(1);
    expect(queue.claim(10, 1, 9)).toBeCloseTo(10.3, 6);
  });

  it('★★ 同一个人被两个人同时打 ⇒ FIFO，各领各的（Map 会互相覆盖）', () => {
    const queue = new ImpactQueue();
    queue.push(10, 1, 9, 0.10);
    queue.push(10, 2, 9, 0.30);
    expect(queue.claim(10, 1, 9)).toBeCloseTo(10.1, 6);
    expect(queue.claim(10, 2, 9)).toBeCloseTo(10.3, 6);
    expect(queue.liveCount()).toBe(0);
  });

  it('★★ 已经到点的那条不再用来推后（否则算出的是"过去的时间"）', () => {
    const queue = new ImpactQueue();
    queue.push(10, 1, 2, 0.3);
    // 0.5 秒之后才来结算（比如同 tick 被别的逻辑卡了一下）
    expect(queue.claim(10.5, 1, 2), '已经过点了，应当当场播').toBeNull();
    expect(queue.liveCount(), '但那条记录要被消费掉，不能留着偷下一次').toBe(0);
  });

  it('★ 过期的记录会被清掉（攻击被闪避/免疫吃掉时 `damage` 根本不发）', () => {
    const queue = new ImpactQueue(1, IMPACT_MIN_DELAY_SECONDS);
    queue.push(10, 1, 2, 0.3);
    queue.prune(10.5);
    expect(queue.liveCount(), '还没过期，留着').toBe(1);
    queue.prune(10.3 + 1 + 0.01);
    expect(queue.liveCount(), '过期了就该清').toBe(0);
  });

  it('★ `push` 自己会顺手清过期（不需要调用方记得先 prune）', () => {
    const queue = new ImpactQueue(1, IMPACT_MIN_DELAY_SECONDS);
    queue.push(0, 1, 2, 0.3);
    queue.push(10, 3, 4, 0.3);
    expect(queue.liveCount(), '第一条（0.3）在 t=10 早该烂掉了').toBe(1);
  });

  it('★ `clear()` 之后一条不剩（重开一局 / seek 归零）', () => {
    const queue = new ImpactQueue();
    queue.push(0, 1, 2, 0.3);
    queue.push(0, 3, 4, 0.3);
    queue.clear();
    expect(queue.liveCount()).toBe(0);
    expect(queue.claim(0, 1, 2)).toBeNull();
  });

  it('★ 默认过期窗口足够长：最慢的炮弹（上限 0.7 秒）也等得到', () => {
    expect(IMPACT_QUEUE_MAX_AGE_SECONDS).toBeGreaterThan(0.8);
  });
});
