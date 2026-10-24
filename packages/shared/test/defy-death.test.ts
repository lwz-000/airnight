/**
 * ============================================================
 *  ★★ 0.2 若叶睦的被动「多首野兽」—— 一次性锁血
 * ============================================================
 *
 * 【用户口径（原话）】「仅一次，当自身受到致命伤害时，锁定 1 点生命值，
 * 无法攻击，无法移动，获得嘲讽效果，持续 5s/7s/10s
 * （此被动不受复活效果影响，复活后此被动不会刷新）」。
 *
 * 【用户后来报的 bug（2026-10-17）】「若叶睦的被动没有成功生效」。
 * 根因：引擎只锁了 1 点血 + 不能攻击/移动 + 嘲讽，**没有 `cannotDie`**。
 * 而嘲讽会把敌人全拉过来打她 —— 1 点血在"同一次攻击的第二段"（连击 / 溅射 /
 * 同一 tick 的第二个敌人）就会被扣光，当场死掉。窗口 5~10 秒连一帧都撑不到，
 * 玩家看到的就是"被动没生效"。
 *
 * 这一组测试钉住三件事：
 *   1. 致命伤害触发锁血（1 点血、不算死、不能攻击/移动、带嘲讽）；
 *   2. ★ **窗口内再挨致命伤害也不会死**（这是修的那一条）；
 *   3. 窗口结束后才会真的死（不是永久无敌）。
 */
import { describe, expect, it } from 'vitest';
import {
  TICKS_PER_SECOND,
  UNIT_DEFS,
  collectMods,
  createBattle,
  dealDamage,
  step,
  type BattleState,
  type UnitState,
} from '../src/index.js';

const MORITS = 'op51';
/** 致命一击的量级（远超任何真实血量，用来直接触发"致死豁免"那条路） */
const LETHAL = 999_999_999;

function board(): { state: BattleState; me: UnitState; foe: UnitState } {
  const state = createBattle(
    UNIT_DEFS,
    [
      {
        team: 0,
        units: [{ defId: MORITS, star: 1, cell: { col: 4, row: 4 } }],
        playerContext: { gold: 0, hp: 100 },
      },
      {
        // 靶子：血厚、几乎不攻击 —— 这样"什么时候挨打"完全由测试自己决定
        team: 1,
        units: [
          {
            defId: 'mn_duholy',
            star: 3,
            cell: { col: 5, row: 4 },
            statOverride: { hp: 100_000_000, armor: 0, magicResist: 0, attackSpeed: 0.01 },
          },
        ],
        playerContext: { gold: 0, hp: 100 },
      },
    ],
    20261017,
  );
  return {
    state,
    me: state.units.find((unit) => unit.team === 0)!,
    foe: state.units.find((unit) => unit.team === 1)!,
  };
}

describe('★★ 若叶睦：一次性锁血（多首野兽）', () => {
  it('★ 致命伤害 -> 锁 1 点血、不算死、不能攻击/移动、带嘲讽', () => {
    const { state, me, foe } = board();
    expect(collectMods(state, me).defyDeath, '被动要在 mods 里查得到').toBeTruthy();

    me.hp = 100;
    dealDamage(state, foe, me, LETHAL, 'physical', 'attack');

    expect(me.dead, '不该死').toBe(false);
    expect(me.hp, '血量锁在 1').toBe(1);
    expect(me.statuses['defyDeathUsed'], '记下"用过了"（只有一次）').toBe(1);
    expect(me.statuses['defyDeathUntil'], '嘲讽窗口要挂上').toBeGreaterThan(state.tick);
    const mods = collectMods(state, me);
    expect(mods.noAttack, '窗口内不能攻击').toBe(true);
    expect(mods.noMove, '窗口内不能移动').toBe(true);
  });

  it('★★ 窗口内再挨一次致命伤害 -> 还是不死（用户报的那条）', () => {
    const { state, me, foe } = board();
    me.hp = 100;
    dealDamage(state, foe, me, LETHAL, 'physical', 'attack');
    expect(me.hp).toBe(1);

    /*
      ★ 这就是修之前会红的那一步：以前只锁血、没有 `cannotDie`，
      第二段伤害直接把 1 点血扣成 0 —— 带嘲讽的她几乎是必死。
    */
    dealDamage(state, foe, me, LETHAL, 'physical', 'attack');
    expect(me.dead, '窗口内应该一直吊在 1 点血').toBe(false);
    expect(me.hp).toBe(1);

    // 同一 tick 里再来第三下（连击/溅射的极端情况）也一样
    dealDamage(state, foe, me, LETHAL, 'physical', 'spell');
    expect(me.dead).toBe(false);
  });

  it('★ 窗口结束之后 -> 才会真的死（不是永久无敌）', () => {
    const { state, me, foe } = board();
    me.hp = 100;
    dealDamage(state, foe, me, LETHAL, 'physical', 'attack');
    expect(me.statuses['defyDeathUsed']).toBe(1);

    // 1 星窗口 = 1 秒 = 20 tick（`TICKS_PER_SECOND`）；跑够 30 tick 让修正包过期
    for (let i = 0; i < 30 && !state.over; i++) step(state, UNIT_DEFS);
    expect(state.over, '这 30 tick 里不该已经打完').toBe(false);
    expect(collectMods(state, me).cannotDie, '窗口过期后不再免死').toBe(false);

    dealDamage(state, foe, me, LETHAL, 'physical', 'attack');
    expect(me.dead, '窗口结束了就该真的死').toBe(true);
    expect(me.statuses['defyDeathUsed'], '被动不会刷新').toBe(1);
  });
});

describe('★ 0.2.1：锁血时长改成 1/2/3 秒', () => {
  /*
    【用户口径（2026-10-17）】「若叶睦的锁血被动时长改为 1s/2s/3s」。
    原来是 5/7/10 秒 —— 她只有 1 费，却是"免死 10 秒的嘲讽靶子"，
    对面整场输出都被白吃。改成秒级窗口后只保留功能性：
    扛住这一发致命伤害、把仇恨拉过来，然后该死就死。
  */
  /*
    ★★ 0.2.2 修 bug（用户报「被动生效时间和描述不符」）：
    这里原来断言的是 `[100, 200, 300]` 并注释"= 1/2/3 秒" —— **断言抄的是错数据**，
    于是 5 倍的时长一路"通过"进了游戏。本项目的口径是 20 tick = 1 秒。

    ⇒ 现在的断言**锚在常量上**（`TICKS_PER_SECOND`），不再手写 tick 数：
      以后谁再把 tick 口径当成 100/s，这条会立刻红。
  */
  it('★★ 数据表：durationTicks = 1/2/3 秒（= 20/40/60 tick，锚在 TICKS_PER_SECOND 上）', () => {
    const def = UNIT_DEFS[MORITS]!;
    const ticks = def.skill.passive?.defyDeath?.durationTicks as readonly number[];
    expect(ticks).toEqual([1, 2, 3].map((second) => second * TICKS_PER_SECOND));
    // 反过来说也钉一次：1 星那一档**必须**正好是一秒，不能是 5 秒（0.2.2 之前就是 5 秒）
    expect(ticks[0]).toBe(TICKS_PER_SECOND);
    expect(UNIT_DEFS[MORITS]!.skill.name, '还是那个技能名').toBe('若叶睦·多首野兽');
  });

  it('实战：2 星窗口 = 2 秒（走 1.5 秒还免死，走够 2.5 秒才失效）', () => {
    const state = createBattle(
      UNIT_DEFS,
      [
        {
          team: 0,
          units: [{ defId: MORITS, star: 2, cell: { col: 4, row: 4 } }],
          playerContext: { gold: 0, hp: 100 },
        },
        {
          team: 1,
          units: [
            {
              defId: 'mn_duholy',
              star: 3,
              cell: { col: 5, row: 4 },
              statOverride: { hp: 100_000_000, armor: 0, magicResist: 0, attackSpeed: 0.01 },
            },
          ],
          playerContext: { gold: 0, hp: 100 },
        },
      ],
      20261017,
    );
    const me = state.units.find((unit) => unit.team === 0)!;
    const foe = state.units.find((unit) => unit.team === 1)!;
    me.hp = 100;
    dealDamage(state, foe, me, LETHAL, 'physical', 'attack');
    expect(me.dead).toBe(false);
    // 2 星 = 2 秒 = 40 tick：跑到 30 tick（1.5 秒）时还必须免死
    for (let i = 0; i < 30 && !state.over; i++) step(state, UNIT_DEFS);
    expect(collectMods(state, me).cannotDie, '2 星窗口还有效').toBe(true);
    // 再走 20 tick（合计 50 tick = 2.5 秒）才该关窗
    for (let i = 0; i < 20 && !state.over; i++) step(state, UNIT_DEFS);
    expect(collectMods(state, me).cannotDie, '走够 2.5 秒后窗口关闭').toBe(false);
  });
});
