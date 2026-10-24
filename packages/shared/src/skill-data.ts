/**
 * 50 个干员的技能（从你的 `技能表` 一条条录进来的）。
 *
 * ============================================================
 *  这份数据怎么读（给非程序员）
 * ============================================================
 *
 * 每个技能由四块组成：
 *
 *   1. **effects** —— 攒满法力之后干什么（伤害、护盾、召唤、给自己加 buff…）
 *   2. **passive** —— 被动技能。入场就生效、一直存在、不攒法力也不放
 *      （你写的「被动：xxx」都进这里）
 *   3. **star3** —— 3 星专属技能。填了它就**完全替换** 1/2 星的技能
 *      （你定的规则：「到达三星只生效三星技能，不生效 1、2 星的技能」）
 *   4. **manaSource** —— 法力怎么攒：`attack` 攻击回复 / `damage` 受击回复 /
 *      `auto` 自动回复（玛恩纳那种「魔力随时间回复」）
 *
 * 数值写法（★ 两种量纲别混）：星级数值可以写一个数（三星通用）或三个数
 * （依次对应 1 星 / 2 星 / 3 星；只写两个数时第三个沿用第二个 —— 你表里
 * 有些技能只填了 1/2 星）。但**同一个百分比，两种字段的写法不同**：
 *   · `power`（伤害 / 治疗 / 护盾 / 陷阱的强度）走**千分比 FIX=1000**：
 *     `50%/100%/130%` = `[500, 1000, 1300]`
 *   · 带 `Bp` 的字段（`ratioBp` 溅射比例、各种 `xxxBp` 加成 / 概率）走**万分比 BP=10000**：
 *     `50%/100%/130%` = `[5000, 10000, 13000]`
 * ★ 踩过：op01 空爆 / op02 夕 的溅射曾按千分比写成 `[500, 1000, 1300]`，
 *   而引擎按万分比算 ⇒ 实际只有 5%/10%/13%，比技能描述小了 10 倍。
 *
 * ============================================================
 *  ⚠ 我替你做的三个判断（不是你写的，需要你过一眼）
 * ============================================================
 *
 * **① 没写持续时间的主动技能，我统一按「10 秒」处理。**
 *    你写「持续 N 秒」的地方我都照抄了；但像灰毫「攻击速度提升 40%/60%/90%」
 *    这种既没写"被动："也没写持续时间的，按 10 秒的主动技能处理。
 *    想改成常驻（被动），把那一条从 effects 挪到 passive 就行。
 *
 * **② 法力回复方式是我按定位推的**（你说"大部分是受击回复和攻击回复，
 *    有些可以加自动回复"）：
 *      · 射程 1~2 的近战/坦克 -> 受击回复（`damage`）
 *      · 射程 3 以上的远程   -> 攻击回复（`attack`）
 *      · 治疗/光环类         -> 自动回复（`auto`）
 *    你觉得哪个不对，直接改那一条的 `manaSource`。
 *
 * **③ 望的「棋子」我做成了真正的陷阱单位**，会被画成一个空白卡面的棋子，
 *    敌人走进 3×3 就爆炸消失（你说"召唤类先用空白卡面代替，但功能写好"）。
 */
import { MAX_BATTLE_TICKS, TICKS_PER_SECOND } from './constants.js';
import { FOREVER_TICKS } from './mods.js';
import type { SkillDef, UnitDef } from './types.js';

/** 把秒换算成 tick（战斗逻辑每秒 20 帧） */
const s = (seconds: number): number => Math.round(seconds * TICKS_PER_SECOND);

/** 「本场战斗永久」 */
const FOREVER = MAX_BATTLE_TICKS;

/**
 * 给"攻击很慢"的棋子用的自动回蓝速度：1000 法力 ÷ 125 = 8 秒充满。
 *
 * 【为什么会需要它？】
 * 蕾缪安（攻速 550 = 每秒 0.55 次）和望（750）是全表最慢的两个。
 * 我一开始给它俩按"远程 -> 攻击回复"的规则配了攻击回蓝，
 * 探针立刻打脸：蕾缪安攒满 1000 法力要打 **10 下 = 22 秒**，
 * 而它 5 秒就死了 —— 3 星技能一次都放不出来，单挑/带队胜率双双 **0%**。
 *
 * 所以慢攻速的棋子改用自动回复（你原话里也提过"有些可以添加自动回复"）。
 * 8 秒是刻意选的：比"靠攻击攒"快得多，但仍然明显慢于普通棋子的 4 秒左右，
 * 保留"狙击手要架一会儿"的节奏感。
 */
const AUTO_SLOW_ATTACKER = 125;

/**
 * 没有写持续时间的主动技能统一按 10 秒。
 * 见文件头「我替你做的三个判断 ①」。
 */
const D = s(10);

export const SKILLS: Record<string, SkillDef> = {
  // ============================================================
  // 1 费
  // ============================================================

  /** 空爆：攻击额外对敌人周围4格敌人造成50%/100%/130%物理伤害 */
  op01: {
    id: 'op01_skill',
    name: '空爆·散射弹',
    desc: '被动：攻击额外对目标周围四格的敌人造成 50%/100%/130% 物理伤害；主动：攻击力 +50%/100%/130%，持续 10 秒',
    effects: [
      {
        kind: 'buff',
        target: 'self',
        // ★ 0.2：原来的"溅射"挪到**被动**（常驻），主动改成"攻击力 +50/100/130%"
        //   （用户 2026-10-16 确认：溅射倍率仍是 50/100/130%）
        stats: { attackDamageBp: [5000, 10000, 13000] },
        durationTicks: D,
      },
    ],
    passive: {
      splash: { radius: 1, shape: 'cross', ratioBp: [5000, 10000, 13000], damageType: 'physical' },
    },
    manaSource: 'attack',
  },

  /** 夕：攻击额外对敌人周围4格敌人造成50%/100%/130%法术伤害 */
  op02: {
    id: 'op02_skill',
    // ★ 0.2 开局效果：初始技力为技力上限的 70%
    startManaBp: 7000,
    name: '夕·墨染',
    desc: '攻击额外对目标周围 4 格的敌人造成 50%/100%/130% 法术伤害',
    effects: [
      {
        kind: 'buff',
        target: 'self',
        /*
          ★ 0.2.1 表现层：`fx` = 渲染层 `BLOOM_FX.ink_cross_white` ——
          技能期间每一发攻击都会在目标格炸开**十字白墨**（十字 4 格，正好是她半径 1 的十字溅射）。
          ★ 同一套 `splash` 也被炮手羁绊复用，所以"播不播专属特效"只能由数据说了算。
        */
        stats: {
          splash: {
            radius: 1,
            shape: 'cross',
            ratioBp: [5000, 10000, 13000],
            damageType: 'magic',
            fx: 'ink_cross_white',
          },
        },
        durationTicks: D,
      },
    ],
    manaSource: 'attack',
  },

  /** 古米：回复离自身最近的一名干员30%/50%生命值 */
  op03: {
    id: 'op03_skill',
    name: '古米·应急口粮',
    desc: '回复周围八格内生命值最低的一名队友，回复量相当于自身攻击力 25%/30%/50%',
    effects: [
      { kind: 'heal', target: 'lowestHpAlly', power: [250, 300, 500], basis: 'attack' },
    ],
    // ★ 0.2：受击回复 -> 自动回复（10 秒充满 = 100/秒）
    manaSource: 'auto',
    manaPerSecond: 100,
  },

  /** 梅：被动：攻击有30%/40%概率使目标眩晕1秒 */
  op04: {
    id: 'op04_skill',
    name: '梅·麻醉弹',
    desc: '被动：攻击有 30%/40%/55% 概率使目标眩晕 1 秒',
    effects: [],
    passive: { stunOnHit: { chanceBp: [3000, 4000, 5500], durationTicks: s(1) } },
    // ★ 0.2：攻击回复 -> 无（纯被动，不攒法力）
    manaSource: 'none',
  },

  /** 灰毫：攻击速度提升40%/60%/90% */
  op05: {
    id: 'op05_skill',
    name: '灰毫·速射',
    desc: '攻击速度提升 40%/60%/90%，攻击力提升 15%/25%/40%',
    effects: [
      {
        kind: 'buff',
        target: 'self',
        stats: { attackSpeedBp: [4000, 6000, 9000], attackDamageBp: [1500, 2500, 4000] },
        durationTicks: D,
      },
    ],
    manaSource: 'attack',
  },

  /** 芙蓉：攻击改为治疗血量最低的队友；治疗量 = 自身攻击力% + 治疗目标生命上限% */
  op06: {
    id: 'op06_skill',
    name: '芙蓉·医疗弹',
    desc: '攻击改为治疗血量最低的队友，每次回复相当于自身攻击力 110%/120%/125% + 治疗目标生命上限 3%/6%/10% 的生命值，持续 10 秒',
    effects: [
      {
        kind: 'buff',
        target: 'self',
        /*
          ★ 0.2：治疗量从"目标生命上限 10%/15%/20%"改成**两条基准相加** ——
          「自身攻击力 110%/120%/125% **+** 治疗目标生命上限 3%/6%/10%」。
          数组的消费方只有一处（`mods.ts` 的 `healAmountOf()`），别再自己加。
        */
        stats: {
          attackHeals: [
            { basis: 'attack', ratioBp: [11000, 12000, 12500] },
            { basis: 'targetMaxHp', ratioBp: [300, 600, 1000] },
          ],
        },
        durationTicks: s(10),
      },
    ],
    manaSource: 'attack',
  },

  /** 阿米娅：技能开启使全队干员攻击力增加10/15/20% */
  op07: {
    id: 'op07_skill',
    name: '阿米娅·领袖号令',
    desc: '全队干员攻击力增加 15%/20%/25%',
    effects: [
      {
        kind: 'buff',
        target: 'allAllies',
        stats: { attackDamageBp: [1500, 2000, 2500] },
        durationTicks: D,
      },
    ],
    manaSource: 'attack',
  },

  /** 拉普兰德：攻击额外攻击一名敌人，攻击力增加30%，攻击变为法术攻击，持续10秒 */
  op08: {
    id: 'op08_skill',
    name: '拉普兰德·狼魂',
    desc: '攻击力 +30%/35%/45%，额外攻击 1 名敌人，攻击变为法术伤害，持续 10 秒',
    effects: [
      {
        kind: 'buff',
        target: 'self',
        stats: { attackDamageBp: [3000, 3500, 4500], extraTargets: 1, damageTypeOverride: 'magic' },
        durationTicks: s(10),
      },
    ],
    // ★ 0.2：受击回复 -> 攻击回复
    manaSource: 'attack',
  },

  /** 信仰搅拌机：技能开启获得自身生命值50/60/100%的护盾，持续10秒 */
  op09: {
    id: 'op09_skill',
    name: '信仰搅拌机·圣盾',
    desc: '获得自身生命上限 35%/45%/75% 的护盾，持续 10 秒',
    effects: [{ kind: 'shield', target: 'self', power: [350, 450, 750], durationTicks: s(10) }],
    manaSource: 'damage',
  },

  /** 空弦：被动「每上场 2 名 [远射] 攻击距离 +2 格」；主动：攻击力+/额外攻击一名目标 */
  op10: {
    id: 'op10_skill',
    name: '空弦·远射',
    desc: '被动：每上场 2 名阵营为 [远射] 的干员，攻击距离 +2 格；主动：攻击力 +15%/20%/30%，额外攻击 1 名目标，持续 8 秒',
    effects: [
      {
        kind: 'buff',
        target: 'self',
        // ★ 0.2：整条新增。老数据是"纯被动：攻击距离 +1/+2/+2、攻击力 +10%"，表里改成了主动技能
        stats: { attackDamageBp: [1500, 2000, 3000], extraTargets: 1 },
        durationTicks: s(8),
      },
    ],
    passive: {
      /*
        ★ 0.2：新机制 `allyTraitRangeFlat`（按**场上某职业的人数**加射程）。
        它是队伍级信息 ⇒ 在 `createBattle` 里开局折算成固定 `rangeFlat`（见 rules.ts）。
        口径：「每上场 2 名 [远射] 干员，攻击距离 +2 格」，**含自己**。
      */
      allyTraitRangeFlat: { trait: 'ranged', per: 2, rangeFlat: 2 },
    },
    manaSource: 'attack',
  },

  /** 星熊：被动：反弹受到伤害的10%/15/20%，上限为自身攻击力的200% */
  op11: {
    id: 'op11_skill',
    name: '星熊·荆棘',
    desc: '被动：反弹受到伤害的 15%/25%/30%，反弹上限为自身攻击力的 200%',
    effects: [],
    passive: { reflect: { ratioBp: [1500, 2500, 3000], capAttackBp: 2000 } },
    // ★ 0.2：受击回复 -> 无（纯被动，不攒法力）
    manaSource: 'none',
  },

  /** 天火：攻击改为造成3*3的范围法术伤害并眩晕0.5/1/1.5秒，持续10秒 */
  op12: {
    id: 'op12_skill',
    // ★ 0.2 开局效果：初始技力为技力上限的 40%
    startManaBp: 4000,
    name: '天火·陨星',
    desc: '攻击变为 3×3 范围法术伤害，攻击力 +10%/+15%/+20%，并眩晕 0.5/1/2 秒，持续 10 秒',
    effects: [
      {
        kind: 'buff',
        target: 'self',
        stats: {
          attackDamageBp: [1000, 1500, 2000],
          /*
            ★ 0.2.1 表现层：`fx` = `BLOOM_FX.skyfire_nova` ——
            技能期间每一发都是 **3×3 橙红大爆炸**（普攻那套 1 格橙黄爆炸会被
            `splashOwnsFx` 自动让位，不会大小两套叠在一起）。
          */
          splash: { radius: 1, shape: 'square', ratioBp: 10000, damageType: 'magic', fx: 'skyfire_nova' },
          stunOnHit: { chanceBp: 10000, durationTicks: [s(0.5), s(1), s(2)] },
        },
        durationTicks: s(10),
      },
    ],
    manaSource: 'attack',
  },

  /** 炎客：攻击时附带额外10/20/30%法术伤害，持续20秒 */
  op13: {
    id: 'op13_skill',
    name: '炎客·灼痕',
    desc: '攻击额外附带已造成伤害 10%/20%/30% 的法术伤害，持续 20 秒',
    effects: [
      {
        kind: 'buff',
        target: 'self',
        stats: { bonusDamage: { source: 'dealt', ratioBp: [1000, 2000, 3000], damageType: 'magic' } },
        durationTicks: s(20),
      },
    ],
    // ★ 0.2：受击回复 -> 攻击回复
    manaSource: 'attack',
  },

  /** 芳汀：攻击额外攻击一人，持续10秒 */
  op14: {
    id: 'op14_skill',
    name: '芳汀·双刃',
    desc: '每第三次攻击额外攻击一个目标，并额外造成相当于攻击力 105%/110%/120% 的法术伤害',
    effects: [],
    passive: {
      extraTargets: 1,
      everyNthAttack: {
        every: 3,
        bonusDamage: { source: 'attack', ratioBp: [10500, 11000, 12000], damageType: 'magic' },
      },
    },
    // ★ 0.2：主动 -> 被动；受击回复 -> 无（纯被动，不攒法力）
    manaSource: 'none',
  },

  /** 克洛斯：攻击速度增加50%/100%/100%，持续10秒 */
  op15: {
    id: 'op15_skill',
    name: '克洛丝·连射',
    desc: '每第三次攻击额外造成相当于攻击力 100%/105%/115% 的物理伤害',
    effects: [],
    passive: {
      everyNthAttack: {
        every: 3,
        bonusDamage: { source: 'attack', ratioBp: [10000, 10500, 11500], damageType: 'physical' },
      },
    },
    /*
      ★ 0.2：主动 -> **被动**（表 R82「技能类型」= 被动）。
      回蓝**保持"攻击回复"** —— 表 R82 的「法力回复」列写的就是它，
      别因为"她是纯被动、反正不放技能"就手滑改成 `none`
      （同样是纯被动的芳汀表里写的是"无"，两个人的值不一样，是策划特意区分的）。
    */
    manaSource: 'attack',
  },

  // ============================================================
  // 2 费
  // ============================================================

  /** 夜莺：被动：不会攻击，按攻击频率回复范围内友军「目标生命上限% + 自身攻击力%」 */
  op16: {
    id: 'op16_skill',
    name: '夜莺·圣域',
    desc: '被动：不会攻击敌人，按攻击频率恢复范围内友军的 1%/3%/5% 生命上限 + 自身攻击力 50%/70%/100% 的生命值',
    effects: [],
    passive: {
      noAttack: true,
      pulse: {
        /*
          ★ 0.2：间隔从"固定 1 秒"改成**跟着自己的攻速走**（表里写"按照攻击频率"）。
          `intervalTicks` 仍然要填 —— 它是结构的主字段，也是攻速异常（0）时的兜底。
        */
        intervalTicks: s(1),
        intervalFromAttackSpeed: true,
        radius: 2,
        affect: 'allies',
        /*
          ★ 0.2.1：**回血光环**（绿色 + `+++` 飘动）不写在脉冲上 ——
          它挂在 `heal` 事件上，id 在 `unit-data.ts` 的 `HEAL_HALO_IDS`。
          原因见 `three/heal-halo-fx.ts` 文件头（3 星那种"全体回血"发的是半径 0 的框）。
        */
        // ★ 0.2.1（用户 2026-10-17）：攻击力折算 110%/120%/135% -> **50%/70%/100%**
        heal: [
          { basis: 'targetMaxHp', ratioBp: [100, 300, 500] },
          { basis: 'attack', ratioBp: [5000, 7000, 10000] },
        ],
      },
    },
    // ★ 0.2：表里"法力回复 = 无" —— 她没有要攒蓝放的技能，填对是防"莫名充能"
    manaSource: 'none',
  },

  /** 风笛：攻击改为3次连续攻击，攻击力增加5%7%10%，持续10秒 */
  op17: {
    id: 'op17_skill',
    name: '风笛·三连突刺',
    desc: '攻击变为 3 次连续攻击，攻击力 +5%/+7%/+10%，持续 10 秒',
    effects: [
      {
        kind: 'buff',
        target: 'self',
        stats: { multiHit: 3, attackDamageBp: [500, 700, 1000] },
        durationTicks: s(10),
      },
    ],
    manaSource: 'damage',
  },

  /** 迷迭香：主动加攻速/攻击力 + 在敌人旁边召唤一根柱子（嘲讽、卡位） */
  op18: {
    id: 'op18_skill',
    // ★ 0.2 开局效果：初始技力为技力上限的 30%
    startManaBp: 3000,
    name: '迷迭香·战术柱',
    desc: '攻速 +15%/25%/35%，攻击力 +15%/25%/35%，持续 5 秒；同时在敌人旁边召唤一根战术柱（生命 250/350/600，不会攻击不会移动，嘲讽敌人优先攻击它，持续 5/6/7 秒）',
    effects: [
      // ★ 0.2：加上"攻速/攻击力"这一半（表里的"技能介绍"写了，原来的数据只有召唤）
      {
        kind: 'buff',
        target: 'self',
        stats: { attackSpeedBp: [1500, 2500, 3500], attackDamageBp: [1500, 2500, 3500] },
        durationTicks: s(5),
      },
      {
        kind: 'summon',
        summonId: 'summon_pillar',
        count: 1,
        // 同时只允许一根柱子（你要求的"迷迭香召唤物为一只"）：
        // 柱子是拿来卡位的，两根以上就把对面直接堵死了
        max: 1,
        // ★ 0.2：持续 20 秒 -> 5/6/7 秒，血量 300/500/700 -> 250/350/600
        durationTicks: [s(5), s(6), s(7)],
        place: 'besideEnemy',
        hp: [250, 350, 600],
      },
    ],
    manaSource: 'attack',
  },

  /** 砾：被动：入场后获得一个持续10秒的生命值100%/200%/250%的护盾 */
  op19: {
    id: 'op19_skill',
    name: '砾·磐石',
    desc: '被动：入场时获得相当于自身生命上限 75%/95%/125% 的护盾与 35 点护甲、35 点魔抗，持续 10 秒',
    effects: [],
    battleStart: [
      { kind: 'shield', target: 'self', power: [750, 950, 1250], durationTicks: s(10) },
      {
        kind: 'buff',
        target: 'self',
        stats: { armorFlat: 35, magicResistFlat: 35 },
        durationTicks: s(10),
      },
    ],
    // ★ 0.2：受击回复 -> 无（纯被动，不攒法力）
    manaSource: 'none',
  },

  /** 聆音：攻击造成1/2/2次周围3*3的群体法术伤害 */
  op20: {
    id: 'op20_skill',
    name: '聆音·共鸣',
    desc: '攻击变为 1/2/3 次 3×3 群体法术伤害',
    effects: [
      {
        kind: 'buff',
        target: 'self',
        stats: {
          multiHit: [1, 2, 3],
          damageTypeOverride: 'magic',
          splash: { radius: 1, shape: 'square', ratioBp: 10000, damageType: 'magic' },
        },
        durationTicks: D,
      },
    ],
    manaSource: 'damage',
  },

  /** 陈：攻击对前方3格所有的敌人造成一次攻击力100/150/200%的物理伤害 */
  op21: {
    id: 'op21_skill',
    name: '陈·赤霄',
    desc: '对前方 3 格所有敌人造成一次 150%/180%/230% 攻击力的物理伤害',
    /*
      ★★ 0.2.2：施法演出（纯表现，不进校验和）——
      **覆盖前方 3 格的剑光**：一条近黑的芯 + 几道赤红剑光往前铺开、远端收成箭头
      （用户手绘草图的口径）。实现在 `apps/web/src/three/chen-thrust-fx.ts`，
      走的是"程序化"那条通道，**不在** `SKILL_FX`（序列帧）里 ——
      长度要跟着技能数据（`radius: 3`）走，出贴图就得按 3 格宽重画。
    */
    castFx: 'chen_thrust',
    effects: [
      {
        kind: 'damage',
        target: 'currentTarget',
        fallback: 'nearestEnemy',
        power: [1500, 1800, 2300],
        damageType: 'physical',
        radius: 3,
        shape: 'line',
      },
    ],
    // ★ 0.2：受击回复 -> 攻击回复
    manaSource: 'attack',
  },

  /** 惊蛰：攻击会额外攻击一个敌人，并造成眩晕1秒 */
  op22: {
    id: 'op22_skill',
    name: '惊蛰·雷击',
    desc: '攻击力 +10%/+20%/+30%，攻击额外攻击 1/2/2 名敌人',
    effects: [
      {
        kind: 'buff',
        target: 'self',
        // ★ 0.2：去掉眩晕，改为"加攻击力 + 额外目标随星级 1/2/2"
        stats: { attackDamageBp: [1000, 2000, 3000], extraTargets: [1, 2, 2] },
        durationTicks: D,
      },
    ],
    manaSource: 'attack',
  },

  /** 洛洛：技能期间加攻速/攻击力；每击杀延长 1 秒；技能结束时补一次法术伤害 */
  op23: {
    id: 'op23_skill',
    name: '洛洛·锁链',
    desc: '攻击力 +10%/15%/25%，攻速 +20%/25%/30%，持续 5 秒；持续期间每击杀 1 名目标，技能额外持续 1 秒；技能结束时对目标造成一次相当于攻击力 30%/40%/50% 的法术伤害',
    effects: [
      {
        kind: 'buff',
        target: 'self',
        stats: {
          attackDamageBp: [1000, 1500, 2500],
          attackSpeedBp: [2000, 2500, 3000],
          // ★ 0.2：击杀延长（1 秒 = 20 tick）—— 在 rules.ts 里"这一击击杀时"那一处结算
          onKillExtendTicks: s(1),
          /*
            ★ 0.2：技能**结束时**补一次伤害 —— 实现落在"修正包到期回收"那个唯一的回收点上
            （`tickSkill` 的倒计时循环），所以不需要新增"技能结束"钩子。
            ★ 打的是**当前锁定的目标**。
            口径说明：表里的「技能效果明细」写的是"对**目标**造成一次…"，
            而「技能介绍」写的是"对目标**及周围四格**造成…"。
            按你之前定的口径（以「效果明细」为准，见"望·连星爆炸倍率"那一条）这里只打目标一个人。
          */
          onExpireDamage: { power: [300, 400, 500], damageType: 'magic' },
        },
        durationTicks: s(5),
      },
    ],
    manaSource: 'attack',
  },

  /** 熔泉：被动：对非萨卡兹敌人造成伤害增加30%50%50% */
  op24: {
    id: 'op24_skill',
    name: '熔泉·猎杀',
    desc: '被动：对非萨卡兹敌人造成的伤害增加 30%/50%/50%',
    effects: [],
    passive: { vsTraitDamageBp: { trait: 'sarkaz', exclude: true, ratioBp: [3000, 5000, 5000] } },
    // ★ 0.2：攻击回复 -> 无（纯被动，不攒法力）
    manaSource: 'none',
  },

  /** 见行者：主动：击退目标 3 格；路线上有敌人时连它一起眩晕并附伤 */
  op25: {
    id: 'op25_skill',
    // ★ 0.2 开局效果：初始技力为技力上限的 90%（表里从"被动"改成了"主动 + 开局技力"）
    startManaBp: 9000,
    name: '见行者·指引',
    desc: '击退目标 3 格并造成 10%/25%/35% 攻击力的物理伤害；若击退路线上有其他目标，则连同目标一同眩晕 1/2/3 秒，并对路线上的敌人额外造成 10%/15%/20% 攻击力的物理伤害',
    effects: [
      {
        kind: 'damage',
        target: 'currentTarget',
        fallback: 'nearestEnemy',
        // power 是**千分比**：100 = 攻击力的 10%
        power: [100, 250, 350],
        damageType: 'physical',
        knockback: 3,
        /*
          ★ 0.2 新机制 `pathStun`（击退路线上的单位一并眩晕 + 附伤）。
          口径取表里的「若击退路线有其他目标则**连同目标一同**眩晕 1/2/3 秒
          并额外造成攻击力 10%/15%/20% 的物理伤害」：
            · "连同目标一同眩晕" ⇒ 目标自己也晕；
            · 那个"额外伤害"打的是**路线上多出来的敌人** ——
              目标自己已经吃过本条主伤害了，再吃一次会变成两段（表里没这么写）。
        */
        pathStun: { durationTicks: [s(1), s(2), s(3)], power: [100, 150, 200], damageType: 'physical' },
      },
    ],
    manaSource: 'damage',
  },

  /** 截云：接下来 30 秒内，每次攻击给目标附一份 5 秒的「裂痕」（不叠加、结束才能再附着） */
  op26: {
    id: 'op26_skill',
    name: '截云·裂痕',
    desc: '接下来 30 秒内，每次攻击使目标在 5 秒内每秒受到 20%/30%/40% 攻击力的法术伤害（不会叠加，持续时间结束前不能再次被附着）',
    effects: [
      {
        kind: 'buff',
        target: 'self',
        stats: {
          /*
            ★ 0.2：整条换掉。原来的写法是"开技能时对血量最低的敌人挂一条 30 秒的 dot"——
            表里改成了「**接下来 30 秒内，每次攻击**给**被攻击目标**附一份 5 秒的裂痕」。

            ★★ 顺手修了一个 10 倍的老 bug：原来的 `power` 写的是 [2000, 3000, 4000]，
            而 dot 的 `power` 是**千分比**（和 `damage` 同一口径：990 = 99%），
            除 FIX 之后等于 **200%/300%/400%** 攻击力 —— 描述却写着 20%/30%/40%。
            现在写 [200, 300, 400]，和描述对上了。

            ★ 「不叠加、持续时间结束才能再次被附着」的口径在 rules.ts 里：
            挂之前先看目标身上有没有我这条（`tag: 'rift'`），有就整条跳过。
          */
          onHitDot: {
            power: [200, 300, 400],
            damageType: 'magic',
            durationTicks: s(5),
            intervalTicks: s(1),
          },
        },
        durationTicks: s(30),
      },
    ],
    manaSource: 'attack',
  },

  // ============================================================
  // 3 费
  // ============================================================

  /**
   * 机械师（0.2 改）：从"护甲 + 免疫次数"改成"**衰减护盾 + 破盾子弹**"。
   *
   * 【三条数据各自的出处】
   *   · 护盾 10%/15%/20% 生命上限、护甲 5/9/15、衰减 15%/s —— 表里的「效果明细」；
   *   · 1/2/3 颗子弹、破盾补盾、消耗子弹时周围四格 5% 生命上限法术伤害
   *     —— 表里的「技能介绍」。
   * 两条都写上了：明细负责数值，介绍负责机制，取并集。
   *
   * 【为什么 `durationTicks` 还是 10 秒？】表里没给护盾时长，
   * 而衰减 15%/s 意味着它 6.67 秒就自己掉完了 —— 10 秒只是个上限、永远不生效。
   * 真正的"什么时候消失"由衰减决定。
   */
  op27: {
    id: 'op27_skill',
    name: '机械师·装甲展开',
    desc:
      '获得 1/2/3 颗子弹；自身获得相当于生命上限 10%/15%/20% 的护盾与 5/9/15 点护甲，' +
      '护盾以每秒 15% 的速度衰减；护盾每被打破一次消耗一颗子弹、补回一层同样的护盾，' +
      '并对周围四格敌人造成自身生命上限 5% 的法术伤害',
    effects: [
      {
        kind: 'shield',
        target: 'self',
        power: [100, 150, 200],
        durationTicks: s(10),
        decayBpPerSecond: 1500,
        bullets: [1, 2, 3],
        breakBlast: { radius: 1, shape: 'cross', power: 50, basis: 'maxHp', damageType: 'magic' },
      },
      {
        kind: 'buff',
        target: 'self',
        stats: { armorFlat: [5, 9, 15] },
        durationTicks: s(10),
      },
    ],
    manaSource: 'damage',
  },

  /** 菲亚梅塔：攻击范围增加1格，造成一次5*5的100%/150%150%物理伤害 */
  op28: {
    id: 'op28_skill',
    name: '菲亚梅塔·轰击',
    desc: '攻击距离 +1 格，攻击变为 5×5 范围、100%/120%/150% 攻击力的物理伤害',
    /*
      ★★ 0.2.1 表现层（用户口径：「卡面冲天光效 + 落点 5×5 凤凰大爆炸」）：
        · `castFx`  → 施法那一刻卡面上窜起冲天红色火柱（渲染层 `SKILL_FX` 查表）；
        · `splash.fx` → 技能期间**每一次攻击**的落点炸 5×5 凤凰
          （内核报 `bloom` 事件 → `BLOOM_FX` 三层贴地）。
      ★ 两个都是纯表现层，不进校验和；数据里写的是注册表键，渲染层不认干员编号。
    */
    castFx: 'fiammetta_barrage',
    effects: [
      {
        kind: 'buff',
        target: 'self',
        stats: {
          rangeFlat: 1,
          splash: {
            radius: 2,
            shape: 'square',
            ratioBp: [10000, 12000, 15000],
            damageType: 'physical',
            // 5×5（radius 2）落点播凤凰爆炸；不写就是程序化火花
            fx: 'fiammetta_phoenix',
          },
        },
        durationTicks: D,
      },
    ],
    manaSource: 'attack',
  },

  /** 号角：被动：攻击范围增加2格，当有敌人进入周围8格时，攻击力增加20% */
  op29: {
    id: 'op29_skill',
    name: '号角·警戒',
    desc: '被动：攻击距离 +2 格；有敌人进入周围 8 格时攻击力 +20%',
    effects: [],
    passive: { rangeFlat: 2, nearbyEnemyAttackBp: { radius: 1, ratioBp: 2000 } },
    manaSource: 'attack',
  },

  /** 塑心：下一次攻击使敌人攻击力降低30%/50%60% */
  op30: {
    id: 'op30_skill',
    // ★ 0.2 开局效果：初始技力为技力上限的 30%
    startManaBp: 3000,
    name: '塑心·心防瓦解',
    desc: '使目标攻击力降低 25%/30%/40%、防御力降低 20%/25%/35%、魔抗降低 10%/15%/25%，持续 10 秒',
    effects: [
      {
        kind: 'debuff',
        // ★ 0.2：目标从「血量最低」改成「最近的敌人」；减益多了防御力与魔抗
        target: 'nearestEnemy',
        fallback: 'nearestEnemy',
        stats: {
          attackDamageBp: [-2500, -3000, -4000],
          armorBp: [-2000, -2500, -3500],
          magicResistBp: [-1000, -1500, -2500],
        },
        durationTicks: s(10),
      },
    ],
    manaSource: 'attack',
  },

  /** 焰尾：攻击速度增加100%，有75%闪避伤害，持续8秒 */
  op31: {
    id: 'op31_skill',
    name: '焰尾·残影',
    desc: '攻击速度 +30%/+50%/+90%，25%/45%/75% 概率闪避普通攻击，持续 8 秒',
    effects: [
      {
        kind: 'buff',
        target: 'self',
        // ★ 0.2：攻速与闪避都改成随星级递增（原来 1/2/3 星都是 +100% / 75%）
        stats: { attackSpeedBp: [3000, 5000, 9000], evasionBp: [2500, 4500, 7500] },
        durationTicks: s(8),
      },
    ],
    manaSource: 'damage',
  },

  /** 老鲤：被动：玩家每拥有10枚金币，攻击力加15%/20%/30%（金币达100时达到最大值） */
  op32: {
    id: 'op32_skill',
    name: '老鲤·财可通神',
    desc: '被动：玩家每拥有 10 枚金币，攻击力 +15%/20%/30%，金币达 100 时达到最大值',
    effects: [],
    passive: { goldScalingAttackBp: { perGold: 10, ratioBp: [1500, 2000, 3000], maxGold: 100 } },
    /*
      ★ 0.2：**这一行在策划表里自相矛盾**，按用户的拍板做的 —— 记清楚免得以后被当 bug 改回去：

      表 R111 的两列打起来了：
        · 「技能介绍」（散文列，绿色=策划新写的）：「被动：玩家每拥有 10 枚金币，
          **生命值上限** +2%/4%/10%，（当金币达到 100 时达到最大值）」
        · 「被动加成」（结构化列，红色）：「按金币加成**攻击力** 每 10 金 +15% / +20% / +30%」
        · 改版前的旧值是第三种：攻击力 +10%/15%/15%
      这是全表唯一一处**散文和结构化列讲的是两条不同机制**的地方（别的都只是措辞差）。

      ★ 用户拍板（两问都问过了）：
        1. **按结构化列做**：攻击力 +15%/20%/30%（不做生命值上限那套）；
        2. **散文列那句"金币达到 100 时达到最大值"要**：折算时金币先取
           `min(金币, 100)` 再去算步数 ⇒ 3 星封顶 10 步 × 30% = **+300%**。
           落地成 `maxGold: 100`（见 types.ts / skills.ts）。

      ⇒ 导出表的「技能介绍」列会一直和策划表不同（我们写攻击力、表里写生命值上限），
        对账时属于**已拍板的偏离**，不是"没做完"；
        「被动加成」列则因为多渲染了"（金币 100 封顶）"而多出一段，同样是故意的。

      ★ 量纲：`ratioBp` 是**万分比**，15% = 1500。

      ★ 0.2：`manaSource` 从 `'damage'`（受击回复）改成 `'none'` ——
      表 R111 的「法力回复」列写的就是**无**，而老鲤是纯被动（`effects: []`、
      也没有 3 星技能），本来一次技能都不会放。填 `'damage'` 只是"反正不放技能"的凑合，
      导出表里会显示成"受击回复"，和策划表对不上（对账时被当成硬差异）。
    */
    manaSource: 'none',
  },

  /** 远牙：攻击范围增加1格，优先攻击血量最低的敌方，攻击速度减30%，攻击力提升50%70%100%，持续100秒 */
  op33: {
    id: 'op33_skill',
    name: '远牙·狙击姿态',
    desc: '攻击距离 +1 格，优先攻击血量最低的敌人，攻速 -60%，攻击力 +30%/40%/55%，持续 100 秒',
    effects: [
      {
        kind: 'buff',
        target: 'self',
        stats: {
          rangeFlat: 1,
          preferLowestHp: true,
          // ★ 0.2：攻速 -30% -> -60%；攻击力 +50/70/100% -> +30/40/55%
          attackSpeedBp: -6000,
          attackDamageBp: [3000, 4000, 5500],
        },
        durationTicks: s(100),
      },
    ],
    manaSource: 'attack',
  },

  /** 妮芙：造成一次攻击力90%/95%/105%的法术伤害 + 对目标周围四格 80%/85%/95%，并击退 */
  op34: {
    id: 'op34_skill',
    // ★ 0.2 开局效果：初始技力为技力上限的 10%
    startManaBp: 1000,
    name: '妮芙·斥力',
    desc: '对目标造成 90%/95%/105% 攻击力的法术伤害，并对目标周围四格的敌人额外造成 80%/85%/95% 攻击力的法术伤害，再把它击退 1/2/2 格',
    effects: [
      {
        kind: 'damage',
        target: 'lowestHpEnemy',
        fallback: 'nearestEnemy',
        // ★ 0.2：主伤害 99% -> 90%/95%/105%
        power: [900, 950, 1050],
        damageType: 'magic',
        /*
          ★ 0.2 新字段 `splash`：**另一个倍率**的一圈伤害。
          和 `radius`（"把这一击变成范围"、威力相同）不是一回事 ——
          这里是"主伤害 90/95/105% + 周围四格 80/85/95%"。
          圈里会排除主目标自己（它已经吃过上面那段了）。
        */
        splash: { power: [800, 850, 950], radius: 1, damageType: 'magic' },
        knockback: [1, 2, 2],
      },
    ],
    manaSource: 'attack',
  },

  /**
   * 左乐（0.2 改）。
   *
   * 【改了什么】
   *   · 护盾基准：生命上限 50/70/100% → **已损失生命** 80/100/120%；
   *   · 吸血时长 10 秒 → 5 秒；
   *   · 新增"对前方 2 格所有敌人造成 3 次 20%/25%/35% 攻击力的物理伤害"；
   *   · 新增"护盾存在期间无法获得技力"；
   *   · 受击回复 → 攻击回复。
   *
   * 【为什么护盾没有时长？】表里给的是"护盾**存在期间**无法获得技力" ——
   * 说明它靠"被打光"结束，不是一个固定秒数。所以给 `FOREVER_TICKS`，
   * 由 `clearShield` 在打空那一刻收掉（卡面会显示成"永久"）。
   */
  op35: {
    id: 'op35_skill',
    name: '左乐·血饮',
    desc:
      '获得已损失生命值 80%/100%/120% 的护盾（护盾存在期间无法获得技力）；' +
      '获得持续 5 秒的 30%/50%/55% 吸血；对前方 2 格所有敌人造成 3 次 20%/25%/35% 攻击力的物理伤害',
    effects: [
      {
        kind: 'shield',
        target: 'self',
        basis: 'missingHp',
        power: [800, 1000, 1200],
        durationTicks: FOREVER_TICKS,
        noManaWhileActive: true,
      },
      {
        kind: 'buff',
        target: 'self',
        stats: { lifestealBp: [3000, 5000, 5500] },
        durationTicks: s(5),
      },
      {
        kind: 'damage',
        target: 'currentTarget',
        fallback: 'nearestEnemy',
        power: [200, 250, 350],
        hits: 3,
        radius: 2,
        shape: 'line',
        damageType: 'physical',
      },
    ],
    manaSource: 'attack',
  },

  // ============================================================
  // 4 费（★ 一部分有 3 星专属技能）
  // ============================================================

  /** 伊内斯：每次攻击使我方随机一名干员攻击速度增加20%/30%（不包括自己） */
  op36: {
    id: 'op36_skill',
    name: '伊内斯·暗夜无明',
    desc: '被动：每次攻击使目标攻速减少当前攻速的 10%/15%/40%，持续 3/4/10 秒',
    effects: [],
    passive: {
      /*
        ★ 0.2：整条换掉了 —— 旧的是"每次攻击给随机队友 +攻速"，
        新的是"每次攻击**削目标攻速**"。
        ★ 用 `debuffOnHit`（0.2 新增）：它挂到**敌人**身上，所以星级由
        `collectMods` 用**施法者**的星级定死（见 mods.ts 的 resolveStatsForStar）。
      */
      debuffOnHit: {
        // "减少当前攻速的 X%"：这里按"每次叠一份 -X%"实现（数据表只给了比例）
        stats: { attackSpeedBp: [-1000, -1500, -4000] },
        durationTicks: [s(3), s(4), s(10)],
      },
    },
    // ★ 0.2：3 星不再有独立技能（1/2/3 星共用同一条被动）
    // ★ 0.2：攻击回复 -> 无（纯被动，不攒法力）
    manaSource: 'none',
  },

  /** 澄闪：被动：攻击有60%/90%概率使目标眩晕1秒；3星：全场+攻速+攻击力 */
  op37: {
    id: 'op37_skill',
    name: '澄闪·电流翻涌',
    desc: '攻击距离 +1，5 秒内每次攻击造成 2 段法术伤害（每段攻击力的 55%/60%），每次造成伤害有 20%/35% 概率眩晕目标 1 秒（不可叠加）',
    effects: [
      {
        kind: 'buff',
        target: 'self',
        /*
          ★ 0.2：整条换掉 —— 从"被动：攻击有 X% 概率眩晕"改成主动技能。
          "每次攻击造成 N 段法术伤害、每段 X%"用现成字段就能表达：
          `multiHit`（几段）+ `multiHitBp`（每段占攻击力的比例）+ `damageTypeOverride: 'magic'`。
        */
        stats: {
          rangeFlat: 1,
          multiHit: 2,
          multiHitBp: [5500, 6000, 6000],
          damageTypeOverride: 'magic',
          stunOnHit: { chanceBp: [2000, 3500, 3500], durationTicks: s(1) },
        },
        durationTicks: s(5),
      },
    ],
    star3: {
      name: '澄闪·澄净闪耀',
      desc: '攻击距离变为全场，额外攻击一个目标，攻击速度 +70%，攻击力 +90%，每次攻击造成 3 段法术伤害（每段攻击力的 80%），持续 15 秒',
      effects: [
        {
          kind: 'buff',
          target: 'self',
          stats: {
            rangeUnlimited: true,
            extraTargets: 1,
            attackSpeedBp: 7000,
            attackDamageBp: 9000,
            multiHit: 3,
            multiHitBp: 8000,
            damageTypeOverride: 'magic',
          },
          durationTicks: s(15),
        },
      ],
    },
    manaSource: 'attack',
  },

  /**
   * 蕾缪安（0.2 改）。
   *
   * 【被动（1/2 星）】优先攻击**百分比**生命值最低的敌人，并额外造成其已损失生命
   * 40%/60%/80%（第三档是你确认的）的物理伤害。
   * ★ 新增「攻速恒定 0.55 + 每额外 1% 攻速转 0.1% 攻击力」——
   * 这两条都要写在**被动**里，因为它们是"她这个人的规矩"，不随技能开关变。
   *
   * 【3 星「强制追思」】表里「3星技能效果明细」写得很细，逐条落进数据：
   *   攻击距离 +10 → `rangeFlat`
   *   获得 7 颗弹药、停止攻击 **4 秒** → `lockOn`（count 7 / 每 11 tick 锁一个 / 4 秒后引爆）+ `noAttack`
   *   4 秒后对 7 个落点各打一次 3×3、每颗 600% 攻击力物理 → `lockOn.power = 6000`
   *   每个目标只锁一次、不够就都锁百分比生命最高的 → 内核 `pickLockTarget`
   *
   * ★★ 0.3.2（用户）：**读条从 7 秒缩到 4 秒**。理由很实在 ——
   *   7 秒里她既不能攻击也没有任何收益（还要吃满对面 7 秒的输出），
   *   实战里常常"技能条刚满就被打死"，等于这个 3 星技能没机会出手。
   *   仍然锁 7 个格子，所以锁定的**间隔**跟着压缩：`s(4) / 7` = 11 tick（0.55 秒一个）。
   *   ⚠ 间隔绝不能取 12：7 × 12 = 84 > 80（4 秒），第 7 颗弹药会落在引爆之后、被吞掉。
   */
  op38: {
    id: 'op38_skill',
    name: '蕾缪安·追猎',
    desc:
      '被动：优先攻击百分比生命值最低的敌人，并额外造成其已损失生命 40%/60%/80% 的物理伤害' +
      '（攻速恒定 0.55，每额外获得 1% 的攻速转化为 0.1% 的攻击力）',
    effects: [],
    passive: {
      preferLowestHp: true,
      bonusDamage: { source: 'missingHp', ratioBp: [4000, 6000, 8000], damageType: 'physical' },
      attackSpeedLocked: true,
      attackSpeedToAttackRatioBp: 1000,
    },
    star3: {
      name: '蕾缪安·强制追思',
      desc:
        '攻击距离 +10 格；获得 7 颗弹药并停止攻击 4 秒，期间快速锁定敌人所在的地块' +
        '（优先锁定百分比生命值最低的）；4 秒后把 7 颗弹药全部打在锁定地块上，' +
        '每颗造成 600% 攻击力的物理伤害（3×3 范围）。每个目标只锁定一次，' +
        '目标不够时剩余弹药全部锁定百分比生命最高的敌人' +
        '（攻速恒定 0.55，每额外获得 1% 的攻速转化为 0.1% 的攻击力）',
      effects: [
        {
          kind: 'lockOn',
          count: 7,
          /*
            ★ 4 秒锁 7 个：80 tick ÷ 7 ≈ 11.4 ⇒ 取 **11**（0.55 秒一个）。
            取 12 的话第 7 个落点（84 tick）会晚于引爆（80 tick），最后一颗弹药被吞。
          */
          intervalTicks: Math.floor(s(4) / 7),
          blastTicks: s(4),
          radius: 1,
          shape: 'square',
          power: 6000,
          damageType: 'physical',
          /*
            ★ 0.2.2 演出（纯表现，不进校验和）：
            被锁的地块上出现**狙击镜**（十字线 + 刻度 + 四角括号），
            外面一圈**粉色光环循环向内收缩**；引爆时炸出
            **粉色为主、外缘转金**的一团光 + 金色冲击波 + 碎屑。
            实现在 `apps/web/src/three/lockon-fx.ts`（注册表 `LOCKON_FX`）。
          */
          fx: 'lockon_sniper',
        },
        // 停攻：这段时间里她不普攻，只"标记落点"
        { kind: 'buff', target: 'self', stats: { noAttack: true }, durationTicks: s(4) },
        { kind: 'buff', target: 'self', stats: { rangeFlat: 10 }, durationTicks: s(4) },
      ],
      passive: { attackSpeedLocked: true, attackSpeedToAttackRatioBp: 1000 },
    },
    /*
      蕾缪安是"狙击手"：攻速只有 550（每秒 0.55 次），攻击回蓝要 22 秒才攒满，
      而它通常活不到那时候 —— 所以改成自动回复（见 AUTO_SLOW_ATTACKER 的说明）。
    */
    manaSource: 'auto',
    manaPerSecond: AUTO_SLOW_ATTACKER,
  },

  /** 魔王：被动：不主动移动，范围内我方每秒回血+加攻击力；3星：全场不死+回血×5 */
  op39: {
    id: 'op39_skill',
    name: '魔王·威慑领域',
    desc: '被动：不主动移动；范围内我方干员每秒回复魔王 45%/75% 攻击力的生命值，并 +35%/+65% 攻击力',
    effects: [],
    passive: {
      noMove: true,
      pulse: {
        intervalTicks: s(1),
        radius: 2,
        affect: 'allies',
        /*
          ★ 0.2.1：**粉色回血光环 + `🗡+`**（表示加攻击力）同样不写在这里 ——
          见 `unit-data.ts` 的 `HEAL_HALO_IDS`；"免死时更闪"由渲染层查
          施法者身上生效中的 `cannotDie` 决定，不需要新字段。
        */
        // ★ 0.2：治疗 30/60% -> 45/75%；附带攻击力 30/60% -> 35/65%
        heal: { basis: 'attack', ratioBp: [4500, 7500, 7500] },
        buff: { attackDamageBp: [3500, 6500, 6500] },
        buffDurationTicks: s(1.5),
      },
    },
    star3: {
      name: '魔王·不灭王权',
      desc: '攻击距离 +2 格；范围内我方干员每秒回复魔王 500% 攻击力的生命值，并 +100% 攻击力，持续期间我方干员不会死亡，技能持续 5 秒',
      effects: [
        { kind: 'buff', target: 'self', stats: { rangeFlat: 2 }, durationTicks: s(5) },
        { kind: 'buff', target: 'allAllies', stats: { cannotDie: true }, durationTicks: s(5) },
        { kind: 'buff', target: 'allAllies', stats: { attackDamageBp: 10000 }, durationTicks: s(5) },
        {
          kind: 'healOverTime',
          target: 'allAllies',
          /*
            ★ 0.2：300% -> 500% 攻击力，持续 10 秒 -> 5 秒。
            ★★ 0.2 修 bug：这里原来写的是 `power: 50000` ——
            `healOverTime.power` 走 **FIX（千分比）**（见 skills.ts 里
            `healAmount()` 的 `(base * power) / FIX`），50000 等于 **5000% 攻击力**，
            是策划表/`desc` 写的 **500%** 的 **10 倍**（每秒回 50 倍攻击力的血，等于无敌）。
            写数的人按万分比的口径填了（50000 = 万分比 500%）。
            ★ 量纲口诀同望那条：**带 `Bp` 后缀的才是万分比（÷10000），`power` 一律千分比（÷1000）**，
            百分数 = `power / 10` ⇒ 500% = 5000。
          */
          power: 5000,
          basis: 'attack',
          durationTicks: s(5),
          intervalTicks: s(1),
        },
      ],
    },
    // ★ 0.2：受击回复 -> 自然回复
    manaSource: 'auto',
    manaPerSecond: 100,
  },

  /** 隐德来希：每0.5秒不断对周围8格敌人造成攻击力70%/90%的法术伤害，持续5秒 */
  op40: {
    id: 'op40_skill',
    name: '隐德来希·绯红壁合',
    desc: '停止攻击；每 0.5 秒对周围 8 格的敌人造成 90%/110% 攻击力的物理伤害，持续 7 秒',
    effects: [
      {
        kind: 'buff',
        target: 'self',
        stats: {
          // ★ 0.2：**停止普通攻击**（数据表写明"停止攻击"）
          noAttack: true,
          pulse: {
            intervalTicks: s(0.5),
            radius: 1,
            affect: 'enemies',
            // ★ 0.2.1 表现层：血镰环绕（美术口径见 `.fx-proposal/leto-scythe.html`）。
            //   每 0.5 秒一报，渲染层刷新一次持续 0.6 秒的光环 ⇒ 看着是连着的"一直在转"。
            fx: 'leto_scythe_aura',
            // ★ 0.2：法术 → **物理**；70/90% → 90/110%；持续 5 秒 → 7 秒
            // ★ 玩家口径（已拍板）：数据表那句"在自身及最近 1 名友方处召唤血镰"
            //   是**说明性文字**（描述技能画面），**不是真召唤物** ——
            //   所以保持"自身光环"这套实现，战斗数值口径就是施法者攻击力，不改。
            //   血镰后面只加**特效**（渲染层读事件流画，见 three/attack-fx.ts 那条铁律），
            //   内核不新增召唤物、不加事件之外的状态。
            //   效果明细列写的「增益，→ 自己，周期脉冲（光环）」和这个口径是一致的。
            damage: { basis: 'attack', ratioBp: [9000, 11000, 11000], damageType: 'physical' },
          },
        },
        durationTicks: s(7),
      },
    ],
    star3: {
      name: '隐德来希·灵与欲的惜别',
      desc: '攻击变成 2 连击，攻速 +50%，攻击力 +100%；每次对目标造成伤害时，被攻击目标周围 2 格内所有敌人受到该次伤害 50% 的物理伤害，持续 10 秒',
      effects: [
        {
          kind: 'buff',
          target: 'self',
          stats: {
            multiHit: 2,
            attackSpeedBp: 5000,
            attackDamageBp: 10000,
            // ★ 0.2：整条换掉 —— 从"移动 4 格 + 每 0.5 秒 210/270%"改成"2 连击 + 命中溅射"
            //   "锁定最近目标、目标死了换下一个"是引擎**本来就有**的索敌行为，不用额外机制
            splash: { radius: 2, shape: 'square', ratioBp: 5000, damageType: 'physical', fx: 'leto_scythe_sweep' },
          },
          durationTicks: s(10),
        },
      ],
    },
    manaSource: 'damage',
  },

  /** 耀骑士临光：被动：队友残血时瞬移过去给盾并加自己攻击力，每回合 1/2 次 */
  op41: {
    id: 'op41_skill',
    name: '耀骑士·守护',
    // ★ 0.2：自身攻击力加成 100%/150% -> 120%/150%（表里"被动加成"和"技能介绍"两列都是 120%）
    desc: '被动：队友生命值降到 10% 以下时，瞬移到其身旁给一层相当于耀骑士 100%/150% 生命上限的护盾，并使自己 10 秒内攻击力 +120%/150%（每场最多 1/2 次）',
    effects: [],
    passive: {
      allyLowHpGuard: {
        thresholdBp: 1000,
        shieldBasisCasterMaxHp: [10000, 15000, 15000],
        selfAttackBp: [12000, 15000, 15000],
        selfBuffTicks: s(10),
        maxUses: [1, 2, 2],
      },
    },
    star3: {
      name: '耀骑士·断罪',
      /*
        ★ 0.2：整条换掉。原来是「5 发弹药、每一发攻击力 +300%」，
        表里改成「瞬移到血量最低的敌人面前，并使**接下来 10 次攻击**攻击力 +800%」——
        所以是 `attacks: 10` + `attackDamageBp: 80000`（+800%），而不是 300%。
        排他式弹药（打一次消耗一发）用的还是同一套 `attacks` 机制，没有新内核。
      */
      desc: '瞬移到血量最低的敌人面前，并获得 10 发弹药：每一发攻击力 +800%（打一次消耗一发）',
      effects: [
        { kind: 'teleport', target: 'lowestHpEnemy', fallback: 'nearestEnemy' },
        {
          kind: 'buff',
          target: 'self',
          stats: { attackDamageBp: 80000 },
          durationTicks: FOREVER,
          attacks: 10,
        },
      ],
    },
    manaSource: 'damage',
  },

  /** 望：在攻击范围最末端放下棋子，有敌人靠近就爆炸 */
  op42: {
    id: 'op42_skill',
    name: '望·连星',
    desc: '在攻击范围内百分比生命值最高的敌人身旁、以及全场生命值最低的敌人身旁各放下一枚棋子（身旁无可选敌人时改放攻击范围末端），棋子周围 3×3 出现敌人时爆炸，造成 200%/300% 群体法术伤害',
    effects: [
      {
        kind: 'trap',
        trapId: 'summon_trap',
        // ★ 0.2：落点从"攻击范围最末端"改成"某名敌人身旁"，而且**一次下两枚**（两个效果）
        place: 'besideHighestHpRatioEnemy',
        count: 1,
        /*
          ★★ 0.2 修 bug：这里原来写的是 `[20000, 30000, 30000]`。
          `trap.power` 走的是 **FIX（千分比）**（见 skills.ts 里
          `power = attackDamage * effect.power / FIX`）—— 20000 意味着
          **2000% 攻击力**，是策划表/`desc` 写的 **200%** 的 **10 倍**。
          写数的人显然按"万分比"的口径填了（20000 = 万分比 200%），
          和当初可露希尔 Q.E.D 那个 bug 正好是**反方向**的同一种错
          （那边是把千分比写进万分比字段 ⇒ 伤害只剩 1/10）。
          ★ 量纲口诀：**带 `Bp` 后缀的才是万分比（÷10000）；`power` 一律千分比（÷1000）**。
          换算成百分数就是 `power / 10` —— 200% ⇒ 2000。
          对照同一批已核对过的兄弟条目免得再算错：
          陈·赤霄 `power: [1500,1800,2300]` = 150%/180%/230%、
          妮芙·斥力 `[900,950,1050]` = 90%/95%/105%。
        */
        power: [2000, 3000, 3000],
        damageType: 'magic',
        // ★ 0.2：半径按**方形**算（切比雪夫）⇒ 1 = 周围 3×3（八格），含斜角。
        //   判定见 rules.ts 的 tickTraps（★ 以前那里按曼哈顿距离 ⇒ 斜角踩不到）
        radius: 1,
        durationTicks: s(20),
      },
      {
        kind: 'trap',
        trapId: 'summon_trap',
        place: 'besideLowestHpEnemy',
        count: 1,
        // ★ 同上：`power` 千分比，200% = 2000
        power: [2000, 3000, 3000],
        damageType: 'magic',
        radius: 1,
        durationTicks: s(20),
      },
    ],
    star3: {
      name: '望·天下劫',
      desc: '在全场随机 7 个位置放下棋子，爆炸倍率为 400%',
      effects: [
        {
          kind: 'trap',
          trapId: 'summon_trap',
          place: 'randomSpread',
          // ★ 0.2：5 个 -> 7 个；倍率 300% -> 400%
          count: 7,
          // ★★ 0.2 修 bug：40000 -> 4000（同一个"万分比写进千分比"的事故，实际是 4000%）
          power: 4000,
          damageType: 'magic',
          radius: 1,
          durationTicks: s(20),
        },
      ],
    },
    // 望的攻速 750 也偏慢（攻击回蓝要 16 秒），同样改成自动回复
    manaSource: 'auto',
    manaPerSecond: AUTO_SLOW_ATTACKER,
  },

  /** 予愿安洁莉娜：被动：打远的目标附伤；3星：全场+4目标+无敌 */
  op43: {
    id: 'op43_skill',
    name: '予愿安洁莉娜·酸橙的心事',
    desc: '额外攻击 2/3/5 个目标，每次攻击造成自身攻击力 30%/35%/90% 的物理伤害与相当于自身攻击力 25%/30%/90% 的法术伤害，持续 5/7/10 秒（三星时技能期间获得隐匿）',
    effects: [
      {
        kind: 'buff',
        target: 'self',
        /*
          ★ 0.2：整条换掉。用户确认"**普攻被替换**成这两段"（不是额外追加）——
          所以物理那段用 `multiHitBp` 把普攻压到 30/35/90%，
          法术那段用 `bonusDamage.source: 'attack'`（0.2 新增的"按自身攻击力"基准）。
        */
        stats: {
          multiHitBp: [3000, 3500, 9000],
          bonusDamage: { source: 'attack', ratioBp: [2500, 3000, 9000], damageType: 'magic' },
          extraTargets: [2, 3, 5],
        },
        durationTicks: [s(5), s(7), s(10)],
      },
      {
        kind: 'buff',
        target: 'self',
        /*
          ★ 0.2："三星时技能持续期间获得隐匿" —— **单独一份包**，挂 `minStar: 3`。
          ★★ 注意：`minStar` 是"整份包生效/不生效"的开关，所以**不能**把它和上面那份混在一起写，
          否则 1/2 星会连攻击力/额外目标都一起丢掉。
        */
        stats: { untargetable: true, minStar: 3 },
        durationTicks: [s(5), s(7), s(10)],
      },
    ],
    // ★ 0.2：3 星不再单独写技能（表里那一列是"（无）"）—— 3 星的差异全靠上面的星级数值 + minStar
    manaSource: 'attack',
  },

  /** 可露希尔：每2次攻击使我方随机1名干员获得攻击力/护甲/魔抗加成 */
  /**
   * 可露希尔：被动（每 2 次攻击额外攻击 1 名目标）+ 主动（全体友方防御/攻击加成，按金币加强）；
   * 3 星：Q.E.D（每 0.5 秒范围压制，9 跳后加强 + 单体攻速减益）
   */
  op44: {
    id: 'op44_skill',
    name: '可露希尔·特惠',
    /*
      ★ 0.2 改版（表 R123）：
        · 「被动：每 2 次攻击**额外攻击 1 名目标**」
          ⇒ `passive.everyNthAttack.extraTargets`（不是 `extraTargets` ——
            那个是**每一次**都多打，这个是每第 2 次才多打，见 types.ts 的说明）。
        · 技能类型从「被动」改成「主动」：`effects` 从空数组变成"全体友方 +防御/攻击"。
        · 「（此数值每有 10 金币额外增加 1%，最高上限 5%）」
          ⇒ `goldBonusBp`，放技能那一刻按 `BattleState.playerGold` 折算
            （金币在战斗中不会变，见 types.ts 里 `playerGold` 的说明）。
    */
    desc:
      '被动：每 2 次攻击额外攻击 1 名目标；主动：我方全体友方防御力 +15%/+30%，攻击力 +10%/+15%，' +
      '技能持续 10 秒；（此数值每有 10 金币额外增加 1%，最高上限 5%）',
    effects: [
      {
        kind: 'buff',
        target: 'allAllies',
        stats: {
          armorBp: [1500, 3000, 3000],
          attackDamageBp: [1000, 1500, 1500],
          goldBonusBp: { perGold: 10, bpPerStep: 100, maxBp: 500 },
        },
        durationTicks: s(10),
      },
    ],
    passive: {
      everyNthAttack: { every: 2, extraTargets: 1 },
    },
    star3: {
      name: '可露希尔·Q.E.D',
      /*
        ★ 0.2（表 R123 的 3 星列）：
        「开启技能后攻速 +50%，同时对攻击范围内所有敌人持续（每 0.5 秒）造成相当于自身攻击力 120% 的
          物理伤害，造成 9 次伤害后，后续时间造成相当于自身攻击力 180% 的物理伤害，技能持续 10 秒；
          被锁定目标攻速 -50%（此效果单个目标仅生效一次，持续 5 秒）」

        · 「攻击范围内所有敌人、每 0.5 秒」= 一条**敌人脉冲**：`intervalTicks: 10`、半径 = 她的射程 3。
        · 「造成 9 次伤害后换成 180%」= `rampAfterHits`，跳数是**全局**口径
          （每跳一次算一次，不管打到几个人）—— 用户的拍板。
          10 秒 ÷ 0.5 秒 = 20 跳，所以第 10 跳起一直是 180%。
        · 「被锁定目标攻速 -50%，单个目标仅生效一次」= `pulseDebuffOnce`。
        ★★ 倍率走 `ratioBp`，是**万分比**：120% = 12000、180% = 18000。
          写成 1200/1800（千分比的口径）会让实际伤害只有面板的 1/10 ——
          `rework-0.2.test.ts` 用"惰性靶子"把伤害数字和 120%/180% 直接对上，专防这一脚。
      */
      desc:
        '开启技能后攻速 +50%，同时对攻击范围内所有敌人持续（每 0.5 秒）造成相当于自身攻击力 120% 的' +
        '物理伤害，造成 9 次伤害后，后续时间造成相当于自身攻击力 180% 的物理伤害，技能持续 10 秒；' +
        '被锁定目标攻速 -50%（此效果单个目标仅生效一次，持续 5 秒）',
      effects: [
        {
          kind: 'buff',
          target: 'self',
          stats: {
            attackSpeedBp: 5000,
            pulse: {
              intervalTicks: 10,
              // 她的基础射程是 3（unit-data.ts），"攻击范围内"就按这个半径铺
              radius: 3,
              affect: 'enemies',
              damage: { basis: 'attack', ratioBp: 12000, damageType: 'physical' },
              rampAfterHits: { hits: 9, ratioBp: 18000 },
              pulseDebuffOnce: { stats: { attackSpeedBp: -5000 }, durationTicks: s(5) },
            },
          },
          durationTicks: s(10),
        },
      ],
    },
    manaSource: 'attack',
  },

  // ============================================================
  // 5 费（全部有 3 星专属技能）
  // ============================================================

  /** 维什戴尔：被动：攻击造成3次伤害。3星：下面6次攻击变成5*5群体物理，倍率1000% */
  op45: {
    id: 'op45_skill',
    name: '维什戴尔·饱和复仇',
    desc: '攻击变成 3 连击，每段造成自身攻击力 35%/40% 的物理伤害，技能持续 10 秒',
    effects: [
      {
        kind: 'buff',
        target: 'self',
        // ★ 0.2：被动"每次攻击 3 次伤害"改成**主动**（3 连击、每段 35%/40%），持续 10 秒
        // 「每次攻击都随机攻击攻击范围内的敌人」= 每击随机换目标（0.2 新增机制）
        stats: { multiHit: 3, multiHitBp: [3500, 4000, 4000], randomAttackTarget: true },
        durationTicks: s(10),
      },
    ],
    star3: {
      name: '维什戴尔·爆裂黎明',
      desc: '获得 6 发弹药：每一发变成 5×5 群体物理伤害、倍率 1000%（打一次消耗一发）；并在自身周边召唤一只魂灵之影（生命 3500、攻击 500，不会移动也不会主动攻击，每 4 秒造成一次相当于魂灵之影攻击力 5% 的法术伤害）；魂灵之影在场期间，自身获得隐匿',
      effects: [
        {
          kind: 'buff',
          target: 'self',
          stats: {
            attackDamageBp: 90000,
            splash: {
              radius: 2,
              shape: 'square',
              ratioBp: 10000,
              damageType: 'physical',
              /*
                ★ 0.2：这一发范围伤害播**维什戴尔那套红黑 5×5 爆炸**。
                取值是渲染层的注册表键（`apps/web/src/three/vishdal-bloom.ts` 的 `BLOOM_FX`），
                内核只负责把它原样塞进 `bloom` 事件（纯表现层，不进校验和）。
                ★ 写在数据里而不是让渲染层按 defId 判断 —— 理由见 `types.ts` 的说明。
              */
              fx: 'vishdal_bloom',
            },
          },
          durationTicks: FOREVER,
          attacks: 6,
        },
        /*
          ★ 0.2：3 星多召唤一只「魂灵之影」（`noCard`：只用模型、不画卡面背景）。
          "魂灵之影在场时自身获得隐匿"由**召唤物自己**每 tick 给主人续一份被动包实现
          （见 `summon_shadow.skill.passive.ownerAura` 与 `skills.ts` 的 `tickSkill`）。
          ★ `max: 3`：**场上同时最多 3 只**（用户口径）。技能是每攒满一次法力就放一次，
            不封顶的话一个能撑住的维什戴尔能堆出一排 —— `doSummon` 会按
            "自己召唤的、同一编号的、还活着的"数量算剩余名额，满了就一只都不生。
        */
        {
          kind: 'summon',
          summonId: 'summon_shadow',
          count: 1,
          max: 3,
          durationTicks: FOREVER,
          place: 'besideSelf',
        },
      ],
    },
    manaSource: 'attack',
  },

  /** 凯尔希：被动：每次攻击治疗最近队友；3星：3*3真实伤害+无敌 */
  op46: {
    id: 'op46_skill',
    name: '凯尔希·破梏重生',
    desc: '被动：每次攻击使攻击范围内百分比生命值最低的一名队友回复凯尔希 35%/45% 生命上限的生命值',
    effects: [],
    passive: {
      onAttackAllyBuff: {
        every: 1,
        // ★ 0.2：目标从"最近的队友"改成"**百分比**生命值最低的队友"（0.2 新增的规则）
        target: 'lowestHpRatioAlly',
        heal: { basis: 'casterMaxHp', ratioBp: [3500, 4500, 4500] },
        durationTicks: 0,
      },
    },
    star3: {
      name: '凯尔希·保护性拒止',
      desc: '获得 10 发弹药，攻击距离 +1 格，每次攻击消耗一发弹药，并且攻击变为 3×3 真实伤害、倍率 1000%，且子弹存在期间获得隐匿',
      effects: [
        {
          kind: 'buff',
          target: 'self',
          stats: {
            rangeFlat: 1,
            // ★ 0.2：倍率 300% -> 1000%（老写法是把"倍率"折成 +200%，所以 1000% 对应 +900%）
            attackDamageBp: 90000,
            damageTypeOverride: 'true',
            splash: { radius: 1, shape: 'square', ratioBp: 10000, damageType: 'true', fx: 'kalts_nova' },
            untargetable: true,
          },
          /*
            ★ 0.2：从"持续 10 秒"改成**10 发弹药**（打一次消耗一发）——
            和赤刃明霄陈/维什戴尔同一套：`experiments` 见 types.ts 的 ammo 说明，
            靠 `attacks: N` + `durationTicks: FOREVER` 表达"按次数"而不是"按时长"。
          */
          durationTicks: FOREVER,
          attacks: 10,
        },
      ],
    },
    manaSource: 'attack',
  },

  /** 玛恩纳：没技能时不移动不攻击，魔力随时间回复；3星：开局立刻开技能持续100秒 */
  op47: {
    id: 'op47_skill',
    name: '玛恩纳·未宽解的悲哀',
    desc: '攻击造成二连击，每段造成自身攻击力 50%/70% 的物理伤害，持续 20 秒（被动：没有技能时不主动移动和攻击，生命值 +1000，技力随时间回复，每秒回复 7.5%）',
    effects: [
      {
        kind: 'buff',
        target: 'self',
        // ★ 0.2：从"单次 150%/200% 攻击力"改成"**二连击、每段 50%/70%**"
        /*
          ★★ 0.2.1 修（用户 2026-10-17）：1/2 星"开了技能也不能移动"。
          根因 = 被动 `noMove: true` 是**常驻包**，而技能包里只写了 `noAttack: false` ——
          `noMove` 没被覆盖，于是技能生效期间他照样一步都不走（`mods.ts` 里这两个
          布尔字段都是"后写的说了算"，所以技能包必须**显式**写 false 才能解开）。
          补上 `noMove: false` 之后才是"没技能时不移动、开技就能追人"。
        */
        stats: { multiHit: 2, multiHitBp: [5000, 7000, 7000], noAttack: false, noMove: false },
        durationTicks: s(20),
      },
    ],
    passive: { noMove: true, noAttack: true, hpFlat: 1000 },
    star3: {
      name: '玛恩纳·未照耀的荣光',
      /** ★ 0.2.1 施法演出（美术包 `mlynar_s3_goldslash`）：起手光环 + 3×3 金色斩击 + 小雨滴 */
      castFx: 'mlynar_s3',
      /*
        【一个容易漏掉的连锁反应，记下来】
        你的规则是「3 星只生效 3 星技能，不生效 1/2 星的技能」。
        而玛恩纳的 1/2 星技能里**带着被动**（"没有技能时不主动移动和攻击，
        生命值提升1000"）。既然 1/2 星技能被整个替换掉，这些被动也**不该留下**。
        我一开始偷懒把 noMove 留在了 3 星里，结果探针显示：
        他一个人能打死 8 个里的 7 个，但最后一个远程敌人一直躲在他的
        攻击距离外 —— 他不能移动，追不上，于是 78% 的对局以"75 秒超时平局"收场。
        去掉 noMove 之后 3 星玛恩纳才真的能"单挑全图"。
        （这不是削弱/加强，是**按你定的规则**把该去掉的东西去掉。）
      */
      desc: '开局立刻开启技能并持续 100 秒，同时攻击 4 名敌人，攻击力 +800%，攻速 +35%，生命上限 +3000',
      effects: [],
      battleStart: [
        {
          kind: 'buff',
          target: 'self',
          // ★ 0.2：攻击力 +300% -> +800%，并补上 攻速 +35% 与 生命上限 +3000
          stats: { attackDamageBp: 80000, extraTargets: 3, attackSpeedBp: 3500, hpFlat: 3000, noAttack: false },
          durationTicks: s(100),
        },
      ],
    },
    manaSource: 'auto',
    // ★ 0.2：面板写明「每秒回复 7.5%」=> 1000 × 7.5% = 75/秒（原来按"大概 10 秒充满"写的 100）
    manaPerSecond: 75,
  },

  /** 赤刃明霄陈：攻速+按目标生命上限附伤+缓慢回血；3星：瞬移+5×900%斩击+隐匿 */
  op48: {
    id: 'op48_skill',
    name: '赤刃明霄陈·赤霄斩',
    /*
      ★ 0.2 改版（表 R127）：
        「攻速 +25%/+40%，接下来的攻击额外造成目标最大生命值 2%/3% 的法术伤害，
          并缓慢恢复已损失生命值 15%/30% 的生命值（恢复速率为 20%/s），技能持续 8s，
          技能持续期间不再获得技力。」

      · 附伤口径 = **目标最大生命**（`source: 'maxHp'`，万分比 200/300 = 2%/3%）。
      · 回血口径 = **已损失生命** 15%/30%，**速率 20%/s** ⇒
        每 0.25 秒跳一次、每跳 5% 已损失生命（5% ÷ 0.25s = 20%/s），
        1 星跳 3 次（15%）、2 星跳 6 次（30%）—— 总时长正好 0.75s / 1.5s。
        所以 `power` 两档都是 50、`durationTicks` 按星级写 [15, 30]。
      · 「技能持续期间不再获得技力」= `noManaGain`（挂在同一包上，包到期自动恢复回蓝）。
    */
    desc:
      '攻速 +25%/+40%，接下来的攻击额外造成目标最大生命值 2%/3% 的法术伤害，' +
      '并缓慢恢复已损失生命值 15%/30% 的生命值（恢复速率为 20%/s），技能持续 8 秒，' +
      '技能持续期间不再获得技力。',
    effects: [
      {
        kind: 'buff',
        target: 'self',
        stats: {
          attackSpeedBp: [2500, 4000, 4000],
          bonusDamage: { source: 'maxHp', ratioBp: [200, 300, 300], damageType: 'magic' },
          noManaGain: true,
        },
        durationTicks: s(8),
      },
      {
        kind: 'healOverTime',
        target: 'self',
        basis: 'missingHp',
        power: 50,
        durationTicks: [15, 30, 30],
        intervalTicks: 5,
      },
    ],
    star3: {
      name: '赤刃明霄陈·绝影-驰',
      /*
        ★ 0.2.1 施法演出（美术包 `chen_s3_crimsonblink`）：
        包上写的 charId 是 `char_010_chen`，但"赤霄·绝影（3 技能）」这套瞬移+五连斩
        是 **op48（char_1050_chen3 赤刃明霄陈）** 的 3 星技能，所以挂在它身上。
        1/2 星那套（攻速/附伤/回血）不该播红色连斩，所以只写在 star3 里。
      */
      castFx: 'chen_s3',
      /*
        ★ 0.2 改版（表 R127）：
        「瞬移到最近的敌人身旁，快速斩击 5 次，每次斩击造成自身攻击力 900%；
          技能持续期间获得隐匿，若击杀敌人则再斩击一次。」
        · 「快速斩击 5 次」= `multiHit: 5`、每段 `multiHitBp: 90000`（900%）。
        · 「技能持续期间获得隐匿」= `untargetable`（隐匿的判据唯一实现在 movement.ts）。
        · 「若击杀敌人则再斩击一次」= `onKillRefresh`（这一击杀了人就刷新次数）。
      */
      desc:
        '瞬移到最近的敌人身旁，快速斩击 5 次，每次斩击造成自身攻击力 900%；' +
        '技能持续期间获得隐匿，若击杀敌人则再斩击一次。',
      effects: [
        { kind: 'teleport', target: 'nearestEnemy' },
        {
          kind: 'buff',
          target: 'self',
          stats: { multiHit: 5, multiHitBp: 90000, untargetable: true, onKillRefresh: true },
          durationTicks: FOREVER_TICKS,
          attacks: 1,
        },
      ],
    },
    manaSource: 'damage',
  },

  /** 维娜·维多利亚：召唤金狮子；3星：全体+1000%生命、回满、+300%攻击 */
  op49: {
    id: 'op49_skill',
    // ★ 0.2 开局效果：初始技力为技力上限的 30%
    startManaBp: 3000,
    name: '维娜·维多利亚·进赴故土',
    desc: '攻击距离 +1 格，额外攻击一个目标，攻速 +40%/+60%，攻击力提升至 125%/150%，攻击变成真实伤害',
    effects: [
      {
        kind: 'buff',
        target: 'self',
        stats: {
          rangeFlat: 1,
          extraTargets: 1,
          attackSpeedBp: [4000, 6000, 6000],
          // ★ 0.2：「提升至 125%/150%」= +25%/+50%（不是"再加 125%"）
          attackDamageBp: [2500, 5000, 5000],
          damageTypeOverride: 'true',
        },
        durationTicks: D,
      },
    ],
    star3: {
      name: '维娜·维多利亚·俱以我之名',
      desc: '在周围空格召唤金色狮子，我方全体生命上限 +1000% 并回满生命值、攻击力 +500%、攻速 +100%，持续 20 秒（自身召唤物金色狮子也吃这套加成与恢复）',
      effects: [
        {
          kind: 'summon',
          summonId: 'summon_lion',
          count: 1,
          max: 8,
          durationTicks: s(20),
          place: 'emptyAroundSelf',
          // ★ 0.2：金狮子数值统一成 2000 生命 / 150 攻击（原来 800/1000 与 100/150 分星级）
          hp: [2000, 2000, 2000],
          attackDamage: [150, 150, 150],
        },
        {
          kind: 'buff',
          target: 'allAllies',
          // ★ 0.2：攻击力 +300% -> +500%，并补上 攻速 +100%
          stats: { hpBp: 100000, attackDamageBp: 50000, attackSpeedBp: 10000 },
          durationTicks: s(20),
        },
        { kind: 'heal', target: 'allAllies', power: 100000, basis: 'targetMaxHp' },
      ],
    },
    manaSource: 'damage',
  },

  /** 新约能天使：30 颗子弹的过载 + 给最近友方上盾/减益；3星：复活 + 五连击 */
  op50: {
    id: 'op50_skill',
    name: '新约能天使·开火成瘾症',
    /**
     * ★ 0.2.1 施法演出（美术包 `angel_gunfire`）：开技能那一下的**爆燃枪口**（只放一次）。
     * 平时的枪口火光/命中火花不走这里 —— 那是普攻，写在 `unit-data` 的 `combatFx` 里。
     */
    castFx: 'angel_overdrive',
    /*
      ★ 0.2 改版（表 R129）：
        · 「获得 30 颗子弹 … 每次攻击消耗一颗子弹，每颗子弹造成相当于自身攻击力 105%/110% 的物理伤害」
          ⇒ 一个 `attacks: 30` 的修正包，里面同时写着攻速 +150%/+250% 和
            **攻击力 +5%/+10%**（= 有子弹时普攻倍率变成 105%/110%，
            用户的拍板是"有子弹时普攻倍率变 105%/110%"）。
            子弹打光的那一刻这包被摘掉 ⇒ 攻速和倍率**一起**还原，一句话说清。
        · 「技能开启时，若存在友方则最近的一名友方受到攻速 -30%/-50% 的减益，并获得 1000/1300 点护盾」
          ⇒ `nearestAlly` 的 debuff + shield，两条都打 `skillBound`。
        · 「技能结束时，友方减益恢复，所给予的剩余护盾消失」
          ⇒ 由 `tickSkillAttachments` 在技能结束时收走（见 types.ts 的说明）。
    */
    desc:
      '获得 30 颗子弹，自身攻击速度 +150%/250%，获得 1000/1300 点护盾，每次攻击消耗一颗子弹，' +
      '每颗子弹造成相当于自身攻击力 105%/110% 的物理伤害；技能开启时，若存在友方则最近的一名友方' +
      '受到攻速 -30%/-50% 的减益，并获得 1000/1300 点护盾。（技能结束时，友方减益恢复，所给予的剩余护盾消失。）',
    effects: [
      {
        kind: 'buff',
        target: 'self',
        stats: {
          attackSpeedBp: [15000, 25000, 25000],
          // 「每颗子弹造成攻击力 105%/110%」= 普攻倍率 +5%/+10%
          attackDamageBp: [500, 1000, 1000],
        },
        // 时长写成"永久"，实际由 30 发子弹打完决定（见 rules.ts 的弹药消耗）
        durationTicks: FOREVER_TICKS,
        attacks: 30,
      },
      {
        kind: 'shield',
        target: 'self',
        power: [1000, 1300, 1300],
        basis: 'flat',
        durationTicks: FOREVER_TICKS,
        // 这份盾跟着技能走：技能结束（子弹打光 / 自己阵亡）就消失
        skillBound: true,
      },
      {
        kind: 'debuff',
        target: 'nearestAlly',
        stats: { attackSpeedBp: [-3000, -5000, -5000] },
        durationTicks: FOREVER_TICKS,
        skillBound: true,
      },
      {
        kind: 'shield',
        target: 'nearestAlly',
        power: [1000, 1300, 1300],
        basis: 'flat',
        durationTicks: FOREVER_TICKS,
        skillBound: true,
      },
    ],
    star3: {
      name: '新约能天使·使命必达！',
      /*
        ★ 0.2 改版（表 R129）：3 星换了整套口径 ——
        「获得 50 颗弹药，开启技能后仅一次使一位死亡的友方复活并提升到 3 星，
          并使其回复 100% 的技力；同时自身过载：攻击速度 +500%、攻击力 +30%，
          攻击变成五连击并消耗五发弹药。」
        · 「五连击并消耗五发弹药」= `multiHit: 5` + `chargesPerAttack: 5`
          （50 发 ÷ 每次 5 发 = 10 次攻击）。
        · 旧稿的"盾 + 攻速 +300%"整套换成上面这套 —— 不复用，免得两套数值互相打架。
      */
      desc:
        '获得 50 颗弹药，开启技能后仅一次使一位死亡的友方复活并提升到 3 星，并使其回复 100% 的技力；' +
        '同时自身过载：攻击速度 +500%、攻击力 +30%，攻击变成五连击并消耗五发弹药。',
      effects: [
        { kind: 'revive', count: 1, star: 3, manaBp: 10000 },
        {
          kind: 'buff',
          target: 'self',
          stats: { attackSpeedBp: 50000, attackDamageBp: 3000, multiHit: 5 },
          durationTicks: FOREVER_TICKS,
          attacks: 50,
          chargesPerAttack: 5,
        },
      ],
    },
    manaSource: 'attack',
  },
  /*
    ★ 0.2 追加：**MujicaAve 联动五人**的技能。
    ★ 量纲提醒：`power` / `ratioBp` 在各自字段里各有口径 ——
      技能效果里的 `power` 是**千分比**（600 = 60%），
      带 `Bp` 的字段（`armorBp` / `attackSpeedBp` / 脉冲的 `ratioBp` / `HealSpec.ratioBp`）是**万分比**（6000 = 60%）。
  */

  // ---------------- 若叶睦（op51，1 费，特種/不屈）----------------
  op51: {
    id: 'op51_skill',
    name: '若叶睦·多首野兽',
    desc:
      '物抗 +20%/+40%/+60%，并立刻回复已损失生命值的 10%/15%/20%，持续 10 秒；' +
      '被动：仅一次，受到致命伤害时锁 1 点生命值、无法攻击与移动并获得嘲讽，持续 1/2/3 秒（复活不会刷新）',
    effects: [
      // 「物抗 +20%/40%/60%」= armorBp 万分比；持续 10 秒
      { kind: 'buff', target: 'self', stats: { armorBp: [2000, 4000, 6000] }, durationTicks: 200 },
      // 「立刻回复已损失生命值」= basis 'missingHp'（`healAmount` 里本来就支持这一档）
      { kind: 'heal', target: 'self', power: [100, 150, 200], basis: 'missingHp' },
    ],
    /*
      ★ 0.2.1（用户 2026-10-17）：一次性锁血 5/7/10 秒 -> **1/2/3 秒**。
      太长的话她就是"免死 10 秒的嘲讽靶子"，对面整场输出都被白吃；改成秒级窗口，
      只留"扛住这一发、把仇恨拉过来"的功能性。

      ★★ 0.2.2 修 bug（用户报"生效时间和描述不符"）：
      上一版这里写的是 `[100, 200, 300]`，注释还写着"1 秒 = 100 跳" —— **全错**。
      本项目的口径是 `TICKS_PER_SECOND = 20`（`s(1) = 20`）；
      100 tick 是 **5 秒**，所以实际锁血是 **5/10/15 秒**，比描述长了整整 5 倍
      （"1 费的免死 15 秒嘲讽靶子"就是这么来的）。
      ⇒ 改成 `[s(1), s(2), s(3)]` = `[20, 40, 60]`，并且**用 `s()` 写**，
        以后再改 `TICKS_PER_SECOND` 也不会再错一次。
      ★ 教训：秒数一律写 `s(N)`，别手写 tick 数 —— 手写的那些数没有任何东西能校验。
    */
    passive: { defyDeath: { hp: 1, durationTicks: [s(1), s(2), s(3)] } },
    manaSource: 'damage',
  },

  // ---------------- 祐天寺若麦（op52，2 费，剑士）----------------
  op52: {
    id: 'op52_skill',
    name: '祐天寺若麦·如麦般生长',
    desc:
      '射程 +1，攻击变为 5 连击：前四段为攻击力的 5%/10%/15%，第五段为 100%/105%/110%；' +
      '技能期间随机攻击范围内的目标，持续 4/5/8 秒',
    effects: [
      {
        kind: 'buff',
        target: 'self',
        stats: {
          rangeFlat: 1,
          /*
            五连击 = `attackProfile`：前四段小、第五段大，而且**每一下重新随机挑目标**。
            ★ 为什么不用 `multiHit`？那个只能表达"每段一样"。
          */
          attackProfile: {
            randomTarget: true,
            hits: [
              { bp: [500, 1000, 1500] },
              { bp: [500, 1000, 1500] },
              { bp: [500, 1000, 1500] },
              { bp: [500, 1000, 1500] },
              { bp: [10000, 10500, 11000] },
            ],
          },
        },
        // 4/5/8 秒
        durationTicks: [80, 100, 160],
      },
    ],
    manaSource: 'damage',
  },

  // ---------------- 三角初华（op53，3 费，治疗）----------------
  op53: {
    id: 'op53_skill',
    name: '三角初华·我悲悯的',
    desc:
      '每 0.5 秒对攻击范围内随机一名敌人造成 60%/80%/100% 攻击力的法术伤害，' +
      '并为一名友方（优先攻击范围内血量最低的，我方有丰川祥子时优先她）治疗 10%/20%/30% 攻击力，持续 8/9/10 秒；' +
      '被动：未开启技能时攻击改为治疗友方，治疗量为 80%/100%/130% 攻击力',
    effects: [
      {
        kind: 'buff',
        target: 'self',
        stats: {
          /*
            一拍里"打一个敌人 + 奶一个队友" —— 用**单目标双向脉冲**（`affect: 'both'` + `single`）。
            脉冲半径取她的射程 3。
          */
          pulse: {
            intervalTicks: 10, // 0.5 秒
            radius: 3,
            affect: 'both',
            single: true,
            damage: { basis: 'attack', ratioBp: [6000, 8000, 10000], damageType: 'magic' },
            heal: { basis: 'attack', ratioBp: [1000, 2000, 3000] },
            // 我方有祥子就优先治她；对面有祥子就优先打她（用户口径原话）
            healPreferDefId: 'op55',
            attackPreferDefId: 'op55',
          },
        },
        // 8/9/10 秒
        durationTicks: [160, 180, 200],
      },
    ],
    // 被动：普攻变治疗（80%/100%/130% 攻击力）；优先血量最低的队友
    passive: { attackHeals: { basis: 'attack', ratioBp: [8000, 10000, 13000] } },
    manaSource: 'auto',
    manaPerSecond: 100, // 10 秒一轮
  },

  // ---------------- 八幡海铃（op54，4 费）----------------
  op54: {
    id: 'op54_skill',
    name: '八幡海铃·无存之所',
    desc:
      '立即使攻击范围内的敌人眩晕 1.5/2/10 秒，并每秒对攻击范围内的所有敌人造成 40%/70%/180% 攻击力的法术伤害；' +
      '被动：永久获得低存在感（敌方射程内还有别的目标时优先打别人）',
    effects: [
      // 立刻眩晕：用「我自己攻击范围内」这条新规则（跟着射程走）
      { kind: 'stun', target: 'enemiesInRange', durationTicks: [30, 40, 200] },
      {
        kind: 'buff',
        target: 'self',
        stats: {
          // 每秒一次的范围法术伤害（半径 = 她的射程 2）
          pulse: {
            intervalTicks: 20,
            radius: 2,
            affect: 'enemies',
            damage: { basis: 'attack', ratioBp: [4000, 7000, 18000], damageType: 'magic' },
          },
        },
        // 用户没写持续时间 ⇒ 按仓库惯例取 10 秒
        durationTicks: 200,
      },
    ],
    passive: { lowPresence: true },
    manaSource: 'damage',
  },

  // ---------------- 丰川祥子（op55，5 费，剑士）----------------
  op55: {
    id: 'op55_skill',
    name: '丰川祥子·满月的舞会',
    /*
      ★★ 0.2：**这里只写 1/2 星那一套**。
      3 星的「残月的余响」放在下面的 `star3.desc` 里 ——
      面板是按 `skillVariantOf(def, star)` 取描述的，把 3 星文案塞进本体 desc，
      结果就是"1 星棋子点开也写着 3 星技能"，读起来像自己已经能放（用户报过）。
      现在 1/2 星只看到本体技能 + 一句"升到 3 星会换成…"（那句由界面按 `star3.name` 生成）。
    */
    desc:
      '被动：每次攻击改为朝敌方直线 3 格飞出一个音符，' +
      '对穿过的敌人造成 70%/90% 攻击力的物理伤害（每个音符最多命中 3 人）',
    /*
      ★ 1/2 星的「满月的舞会」是**纯被动**（用户原文就写的"被动技能"）：
      普攻形态由下面的 `passive.attackProfile` 一直生效，没有"开技能"这回事。
      ⇒ `effects` 必须是**空数组**。
        以前这里塞了一个 `{kind:'buff', durationTicks:1}` 的占位，
        结果面板把她的技能标成"主动"、还画了一条永远在充能的蓝条 —— 读起来像能主动放。
      ★ `manaSource` 仍然保留 `attack`：3 星那一套（残月的余响）是要攒蓝放的，
        同一份 `SkillDef` 两种情况共用，这里不能为了 1/2 星改成 none。
      ★ 表现层标记 `fx: 'note'` 在被动里 —— 渲染层据此播 🎶 弹道
        （见 `apps/web/src/three/note-fx.ts`）。
    */
    effects: [],
    passive: {
      attackProfile: {
        pierceLength: 3,
        maxTargets: 3,
        fx: 'note',
        hits: [{ bp: [7000, 9000, 9000], damageType: 'physical' }],
      },
    },
    star3: {
      name: '丰川祥子·残月的余响',
      desc:
        '射程 +2、攻速 +200%、攻击力 +150%，每次攻击改为朝目标飞出两个音符' +
        '（分别造成物理与法术伤害，音符碰到敌人即消失），持续 15 秒',
      effects: [
        {
          kind: 'buff',
          target: 'self',
          stats: {
            rangeFlat: 2,
            attackSpeedBp: 20000,
            attackDamageBp: 15000,
            /*
              ★ 3 星把"穿透音符"换成"两发单体音符"：`attackProfile` 是**后者覆盖前者**，
              所以这条限时包一挂上，被动那套穿透就自动让位 —— 不需要给技能加特判。
              两个音符：一段物理、一段法术，都打在同一个目标上。
            */
            attackProfile: {
              fx: 'note',
              maxTargets: 1,
              hits: [
                { bp: 10000, damageType: 'physical' },
                { bp: 10000, damageType: 'magic' },
              ],
            },
          },
          durationTicks: 300,
        },
      ],
    },
    manaSource: 'attack',
  },
};

/**
 * 召唤物。
 *
 * 【为什么单独列出来？】
 * 它们不是"干员"，不进商店也不进牌库 —— 只由技能召唤出来。
 * 但战斗内核只认一张棋子表，所以它们和干员放同一张表，
 * 靠 `summonOnly: true` 标记出来（抽牌的地方都会跳过带这个标记的）。
 *
 * 【美术】
 * 你说"召唤类技能先用空白卡面代替，但功能写好" ——
 * 所以这几个都没有立绘，界面上会画成一张空白卡（见 sprite-graphics.ts 的
 * `drawSummonCard`）。
 *
 * 这里的 hp / attackDamage 是**最小值**，实际召唤时会被技能里的
 * `hp`/`attackDamage`（按施法者星级）覆盖掉。
 */
export const SUMMON_DEFS: Record<string, UnitDef> = {
  /** 迷迭香的柱子：不会攻击不会移动，嘲讽敌人 */
  summon_pillar: {
    id: 'summon_pillar',
    name: '战术柱',
    cost: 1,
    traits: [],
    base: {
      hp: 300,
      attackDamage: 0,
      attackSpeed: 1000,
      armor: 0,
      magicResist: 0,
      range: 1,
      manaPerAttack: 0,
    },
    starHpBp: 1000,
    starDamageBp: 1000,
    color: '#8a7f6a',
    sprite: 'summon_pillar',
    summonOnly: true,
    summonOf: 'op18',
    /*
      ★ 0.1.4：嘲讽写进数据（以前是 `combat-math.ts` 里一句 `def.id === 'summon_pillar'` 的硬编码）。

      【为什么要挪？】
      同一件事只剩一处实现 —— 现在和支援防暴桩的假人完全同一条路
      （`spawnSummon` 读 `def.mechanics`）。硬编码版本的三个毛病：
        · 数据表里查不到"战术柱会嘲讽"，只有读源码才知道；
        · 界面/图鉴那套只读数据，所以柱子的嘲讽一直没出现在说明里；
        · 以后再出一个会嘲讽的召唤物，还得再写一句 id 判断。
    */
    mechanics: [{ kind: 'taunt' }],
    skill: {
      id: 'summon_pillar_skill',
      name: '不动',
      // ★ 0.1.4：把"会吸引敌人"写进说明（以前只写了"不会动"，看不出它是干什么用的）
      desc: '不会攻击也不会移动，但会吸引敌人优先攻击',
      effects: [],
      passive: { noAttack: true, noMove: true },
      manaSource: 'auto',
    },
  },

  /** 维娜·维多利亚的金色狮子：会正常移动和攻击，但没护甲没魔抗 */
  summon_lion: {
    id: 'summon_lion',
    name: '金色狮子',
    cost: 1,
    /*
      ★ 0.0.2 追加需求第 6 条：金色狮子要显示官方立绘。

      【这个值是什么？】
      它是召唤物骨架的**素材名**（prts.wiki 上这个召唤物叫「黄金盟誓」，
      模型 id 是 token_10040_siege2_vlion）。官方资源镜像里它的目录形状是
      `spine/token_10040_siege2_vlion/token_10040_siege2_vlion_epoque_50/Front/...`，
      也就是比干员多一层"皮肤目录"，所以这里用**叶子名**当 charId ——
      本地缓存和游戏包里的目录/文件名都按它走，两边天然对齐。
      路径上的差异由 scripts/fetch-chibi.ts 的 REMOTE_OVERRIDES 处理。
    */
    charId: 'token_10040_siege2_vlion_epoque_50',
    traits: [],
    base: {
      hp: 800,
      attackDamage: 100,
      attackSpeed: 1200,
      armor: 0,
      magicResist: 0,
      range: 1,
      manaPerAttack: 0,
    },
    starHpBp: 1000,
    starDamageBp: 1000,
    color: '#d9a441',
    sprite: 'summon_lion',
    summonOnly: true,
    summonOf: 'op49',
    skill: {
      id: 'summon_lion_skill',
      name: '撕咬',
      desc: '普通的近战攻击',
      effects: [],
      manaSource: 'auto',
    },
  },

  /** 望的棋子：一个陷阱。敌人走进周围 3×3（八格）就爆炸 */
  summon_trap: {    id: 'summon_trap',
    name: '棋子',
    cost: 1,
    traits: [],
    base: {
      hp: 1,
      attackDamage: 0,
      attackSpeed: 1000,
      armor: 0,
      magicResist: 0,
      range: 1,
      manaPerAttack: 0,
    },
    starHpBp: 1000,
    starDamageBp: 1000,
    color: '#c0563f',
    /*
      ★ 0.2（用户口径）：卡面上**不画血条**。
      它只有 1 点血、又不可被选中 —— 血条除了让人误以为"它能扛几下"之外没有信息量。
      （判定的唯一实现是渲染层的 `canShowHpBar()`，见 types.ts 的 hideHpBar 说明。）
    */
    hideHpBar: true,
    sprite: 'summon_trap',
    summonOnly: true,
    summonOf: 'op42',
    skill: {
      id: 'summon_trap_skill',
      name: '引爆',
      desc: '有敌人靠近时爆炸；不会被敌人选作攻击目标',
      effects: [],
      /*
        「望的棋子无法被敌方选作攻击目标」（你要求的）。
        它只有 1 点血，能被打就等于"对面随手一下就拆了"，
        所以必须不能被选中 —— 只能靠"走过去踩到"来触发。
       */
      passive: { noAttack: true, noMove: true, untargetable: true },
      manaSource: 'auto',
    },
  },

  /**
   * ★ 0.1.1 藏品二版：支援防暴桩召唤的两名**假人**。
   *
   * 「在场上召唤两名假人，假人生命随回合阶段性增加。初始 1000，第 5 回合后 +300，
   *   第 15 回合后再 +600，最高 1900，假人不移动不攻击，获得嘲讽效果
   *   （在敌人攻击范围内优先攻击自身）（模型使用支援防暴桩的模型）」
   *
   * 【血量怎么来的？】基础 1000 在这里，但**随回合成长**那部分不在这里 ——
   * 战斗内核不知道现在是第几回合，所以由 `resolveSharedItems` 按
   * 藏品的 `summonGrowth` 算好、通过 `startSummon` 传进来覆盖。
   * 这里的 1000 只是"没人指定数值时"的兜底。
   *
   * 模型走 `trap_083_bunker`（支援防暴桩），由 fetch-chibi 抓下来。
   */
  summon_dummy: {
    id: 'summon_dummy',
    name: '假人',
    cost: 1,
    charId: 'trap_083_bunker',
    traits: [],
    base: {
      hp: 1000,
      attackDamage: 0,
      attackSpeed: 1200,
      armor: 0,
      magicResist: 0,
      range: 1,
      manaPerAttack: 0,
    },
    starHpBp: 1000,
    starDamageBp: 1000,
    color: '#9aa4b8',
    sprite: 'summon_dummy',
    summonOnly: true,
    // 嘲讽写在数据里 —— spawnSummon 会读它（见 combat-math.ts 的说明）
    mechanics: [{ kind: 'taunt' }],
    skill: {
      id: 'summon_dummy_skill',
      name: '不动',
      desc: '不会攻击也不会移动，但会吸引敌人优先攻击',
      effects: [],
      passive: { noAttack: true, noMove: true },
      manaSource: 'auto',
    },
  },

  /**
   * ★ 0.1.1 藏品二版：天师锦囊召唤的【炎佑】。
   *
   * 「战斗开始召唤一只【炎佑】，激活大炎羁绊【炎佑】属性 +30%……
   *   炎佑基础数值：生命值 500，攻击力 100，双抗 0，基础攻速 1.0，
   *   回合数达到 5 时生命值 +500、攻击力 +30，回合数达到 15 以上再 +500 / +30」
   *
   * 【★ traits 里为什么写 'yan'？—— 它**不**参与羁绊计算】
   * 用户口径：**棋子不参与羁绊的构建**。羁绊人数是从"上报的阵容"（placements）算的，
   * 召唤物是战斗中临时生出来的（走 `spawnSummon`，拿的是裸属性），
   * 所以炎佑：
   *   · 不会帮玩家凑大炎人数；
   *   · 也吃不到大炎给炎属性干员的加成。
   * 这里的 `traits: ['yan']` 只表示"它属于大炎"，供界面/数据对照用。
   * 真正的效果是「**大炎羁绊开着时**，炎佑自己 +30% 属性」——
   * 走 `summonGrowth.statBp + requireTrait: 'yan'`（在藏品数据里）。
   *
   * 攻速 1.0 = 每秒一下 —— 本项目的攻速字段用 1200 表示"每秒 1 次"
   * （见 attackInterval：24000/1200 = 20 tick = 1 秒）。
   */
  summon_yanyou: {
    id: 'summon_yanyou',
    name: '炎佑',
    cost: 1,
    charId: 'enemy_9012_acloon',
    traits: ['yan'],
    base: {
      hp: 500,
      attackDamage: 100,
      attackSpeed: 1200,
      armor: 0,
      magicResist: 0,
      range: 3,
      manaPerAttack: 0,
    },
    starHpBp: 1000,
    starDamageBp: 1000,
    color: '#e2554b',
    sprite: 'summon_yanyou',
    summonOnly: true,
    // ★ 设计稿点名：「炎佑添加为新的棋子，**不要背景卡片**」（见 UnitDef.noCard 的说明）
    noCard: true,
    skill: {
      id: 'summon_yanyou_skill',
      name: '焚身',
      desc: '普通的远程攻击',
      effects: [],
      manaSource: 'auto',
    },
  },

  /**
   * ★ 0.2 维什戴尔 3 星召唤的「魂灵之影」。
   *
   * 【它是什么】
   * 不会移动、不会主动攻击；每 4 秒对敌人造成一次"自身攻击力 5%"的法术伤害。
   * 血量 3500 / 攻击 500 / 物抗 0 / 法抗 0（数据表给的就是这么脆）。
   *
   * 【外观：只用模型，不要卡面背景】
   * ★ 用户点名：和炎佑一样走 `noCard` —— 复用维什戴尔自己的骨架
   * （`char_1035_wisdel`，即"影"来自她自己），渲染时**不画卡面底板**。
   * 见 `types.ts` 的 `UnitDef.noCard` 与 `three/sprite-graphics.ts` 里的处理。
   */
  summon_shadow: {
    id: 'summon_shadow',
    name: '魂灵之影',
    cost: 1,
    /*
      ★ 0.2：换成**官方同名模型**（以前这里临时挂的是维什戴尔本人的 `char_1035_wisdel`，
      所以场上会出现两个维什戴尔）。

      【这个 id 是什么？】方舟里"召唤物"的骨架是 `token_*` 命名空间下的，
      魂灵之影（Shadow of Revenant，持有者维什戴尔）就是 `token_10035_wisdel_wward`
      （`wisdel` = 维什戴尔，`wward` = 影卫；prts 上「魂灵之影」条目可查）。

      【为什么带 `_game_9` 后缀？】社区镜像里 token **只收录了皮肤版本**
      （另一例：维娜的金狮子只有 `token_10040_siege2_vlion_epoque_50`），
      默认那一套没镜像。魂灵之影可选的两套是 `_game_9`（绝对主角）和 `_sale_14`（超新星），
      这里选 `_game_9`：它的配色（黑/暗红）和**默认皮肤的维什戴尔**（黑灰甲 + 红）
      最接近，站在同一格旁边才像一套。想换成超新星版只改这一个字符串 + 重跑抓取/渲染。
    */
    charId: 'token_10035_wisdel_wward_game_9',
    traits: [],
    base: {
      hp: 3500,
      attackDamage: 500,
      attackSpeed: 1200,
      armor: 0,
      magicResist: 0,
      range: 1,
      manaPerAttack: 0,
    },
    starHpBp: 1000,
    starDamageBp: 1000,
    color: '#6b5b8a',
    sprite: 'summon_shadow',
    summonOnly: true,
    // 只用模型、不画卡面背景（同炎佑）
    noCard: true,
    /*
      ★ 0.2：模型缩小到 65%（用户口径"大概缩小 35% 左右"）。

      【为什么需要单独写？】小人的世界高度对所有棋子是同一个基准
      （`card-layout.ts` 的 `CHIBI_WORLD_H`），而官方那套 `token_*` 骨架
      比干员模型占地大 —— 直接铺到一格上，魂灵之影看着比维什戴尔本人还壮，
      完全不像"影子"。压到 65% 之后它才读成"跟在旁边的伴生体"。
      ★ 乘在**世界高度**上、脚底锚点不动 ⇒ 从地面往上缩，不会浮在半空。
      ★ 只影响观感：占格、碰撞、射程、血条位置都不变。
    */
    modelScale: 0.65,
    mechanics: [
      // 每 4 秒（80 tick）对全体敌人造成"自身攻击力 5%"的法术伤害（5% = 500 万分比）
      { kind: 'periodic', intervalTicks: 80, effect: { type: 'allEnemiesDamage', attackBp: 500, damageType: 'magic' } },
    ],
    skill: {
      id: 'summon_shadow_skill',
      name: '影袭',
      desc: '不会移动也不会主动攻击，每 4 秒对敌人造成自身攻击力 5% 的法术伤害；在场期间主人获得隐匿',
      effects: [],
      passive: {
        noAttack: true,
        noMove: true,
        // ★ 0.2：我活着就给主人续一份"隐匿"（见 skills.ts 的 tickSkill 与 SkillStats.ownerAura）
        ownerAura: { stats: { untargetable: true } },
      },
      manaSource: 'auto',
    },
  },

};

/** 这只棋子能不能被抽到（召唤物不能） */
export function isSummonDef(def: { summonOnly?: boolean }): boolean {
  return def.summonOnly === true;
}

/**
 * ============================================================
 *  ★ 彩蛋棋子「维维美·绝对主角」的技能
 * ============================================================
 *
 * 【它为什么不在上面的 SKILLS 表里？】
 * 上面那张表是按 `op01…op50` 编号索引的（行号即编号），
 * 而彩蛋**不在名单里**（不进 ROSTER），所以没有编号可用 ——
 * 它的技能单独导出、由 unit-data.ts 直接引用。
 *
 * 【三块数值，逐条对着用户的原话】
 *   · 技能「同时攻击 4 个敌人，持续 15 秒」
 *       -> 给自己挂一个限时增益：`extraTargets: 3`（额外 3 个 = 连主目标共 4 个）
 *   · 被动「攻击造成攻击力 100% 的 3 连击」
 *       -> `multiHit: 3`（内核里每一段都是**满额** baseDamage，正好 100%）
 *   · 被动「30%（连击单独计算）概率眩晕目标 1 秒」
 *       -> `stunOnHit.perHit: true`（每一段各掷一次骰，见 types.ts 的说明）
 *   · 被动「对周围 8 格造成 2 次攻击力 50% 的连击」
 *       -> `splash: { radius: 1, shape: 'square', hits: 2, basis: 'attack', ratioBp: 5000 }`
 *          半径 1 的方形 = 以目标为中心的 3×3；内核里会**排除主目标自身**
 *          （见 performAttack 的 `splash.shape !== 'line' && other.id === target.id`），
 *          所以剩下的正好是"周围 8 格"。
 *          `basis: 'attack'` 是关键：3 连击下若按"总伤害"算，50% 会变成 150% 攻击力。
 *
 * 【法力】攻击回复、每打一下 125 点，法力上限仍然是全局的 1000
 * （`constants.ts` 的 MANA_MAX）—— 也就是"打 8 下开一次技能"。
 */
export const EGG_SKILL: SkillDef = {
  id: 'egg_mvm_skill',
  name: '绝对主角·终幕',
  desc:
    '主动：持续 15 秒，同时攻击 4 个敌人。' +
    '被动：攻击造成攻击力 100% 的 3 连击；每段连击各有 30% 概率眩晕目标 1 秒；' +
    '并对周围 8 格造成 2 次攻击力 50% 的物理伤害',
  effects: [
    {
      kind: 'buff',
      target: 'self',
      stats: { extraTargets: 3 },
      durationTicks: s(15),
    },
  ],
  passive: {
    multiHit: 3,
    stunOnHit: { chanceBp: 3000, durationTicks: s(1), perHit: true },
    splash: {
      radius: 1,
      shape: 'square',
      ratioBp: 5000,
      damageType: 'physical',
      hits: 2,
      basis: 'attack',
    },
  },
  manaSource: 'attack',
};
