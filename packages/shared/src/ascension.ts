/**
 * ============================================================
 *  ★★ 0.3.2 盟约「阿米娅 · 不容拒绝」：**升变形态**
 * ============================================================
 *
 * 【玩法】阿米娅（1 费）可以沿两条线各升变一次，最终汇到「炉芯终曲」：
 *
 *   阿米娅(op07) ──青色怒火之证──▶ 阿米娅·青色怒火(3 费)
 *                 └─慈悲愿景之证─▶ 阿米娅·慈悲愿景(3 费)
 *                                        │
 *                              炉芯终曲之证（**要求 3 星**）
 *                                        ▼
 *                                 阿米娅·炉芯终曲(5 费，只有 3 星形态)
 *
 * 【和"转职 / 变形同构"有什么区别？】
 *   · 转职是**加一个羁绊标签**，棋子本体不变；
 *   · 变形同构是**产出一件转职藏品**，棋子也不变；
 *   · 升变是**把这个棋子换成另一个棋子**（面板、技能、模型全换）——
 *     所以它在数据结构上是"换 `defId`"，星级 / 装备 / 叠层都要跟着搬过去。
 *
 * 【为什么形态单独放一张表，而不是写进 ROSTER？】
 * ROSTER 是"商店名单"：写进去就能被抽到 / 买到。这三个形态**只能由升变产生**，
 * 所以单独一张表 + `ascendOnly` 标记，由 `isPlayableDef()` 一起排除
 * （和召唤物 `summonOnly`、野怪 `monsterOnly` 完全同一个套路）。
 *
 * 【技能】用户口径：这一版**先不做技能，但要留好接口**。
 * 所以下面三个形态各自挂了一条 **占位技能**（不是空技能 —— 空技能会让
 * `validate-data` 直接报 `NO_ANY_EFFECT`，也会让"升变之后反而变弱"）：
 * 形态换了之后面板暴涨，占位技能只要**不扯后腿**就行。
 * 真正的技能设计时只改 `skill` 这一块，其余代码一行都不用动。
 * ★ 占位技能的判据钉在 `packages/shared/test/ascension.test.ts`
 *   （"技能还是占位"那条）—— 正式技能写完后那条测试会红，提醒同步。
 */

import type { UnitDef } from './types.js';
import { MAX_BATTLE_TICKS, TICKS_PER_SECOND } from './constants.js';

/** 秒 → tick（★ 项目铁律：绝不手写 tick 数） */
const s = (seconds: number): number => Math.round(seconds * TICKS_PER_SECOND);

/** 升变链的起点：普通的 1 费阿米娅（`op07`，在 ROSTER 里） */
export const AMIYA_BASE_ID = 'op07';

/** 三个升变形态的 id（`ASCEND_DEFS` 的 key） */
export const AMIYA_FORM_IDS = {
  /** 近卫阿米娅 → 爆发型 */
  blue: 'op_amiya_blue',
  /** 医疗阿米娅 → 辅助型 */
  mercy: 'op_amiya_mercy',
  /** 终态（只有 3 星形态） */
  core: 'op_amiya_core',
} as const;

/** 阿米娅的本名（不随形态变，卡面 / 提示里都用它） */
const AMIYA_TRAITS = ['rhodes', 'leader', 'arts'] as const;

/**
 * ★★ 三张升变之证的 id。
 *
 * 【为什么要在这里再列一遍？】
 * `item-data.ts` 里那三条是"藏品数据"，这里这份是"**专用栏位的固定顺序**"：
 * 界面上那 3 格是按「青色 / 慈悲 / 终曲」排的，发证时也按这个顺序直接落到对应格，
 * 不用去找空位、也天然不会重复。
 *
 * ★ 两边必须一致 —— 测试里有断言（`amiya-quest.test.ts`）钉住这三个 id 在
 *   `ITEM_DEFS` 里存在且都是 `covenantOnly`。
 */
export const AMIYA_CERT_IDS = {
  blue: 'itm_amiya_blue_cert',
  mercy: 'itm_amiya_mercy_cert',
  core: 'itm_amiya_core_cert',
} as const;

/** 专用栏位的固定顺序（下标 = 界面上的第几格） */
export const AMIYA_CERT_ORDER: readonly string[] = [
  AMIYA_CERT_IDS.blue,
  AMIYA_CERT_IDS.mercy,
  AMIYA_CERT_IDS.core,
];

/** 专用栏位有几格 */
export const AMIYA_CERT_SLOTS = AMIYA_CERT_ORDER.length;

/**
 * 三个升变形态的完整定义。
 *
 * ★ 数值是 0.3.2 的初稿（按现有 1 费 阿米娅 427/68 与 5 费 丰川祥子 1459/141 这条曲线定的），
 *   技能做出来之后大概率要回调，改这里就行。
 */
export const ASCEND_DEFS: Record<string, UnitDef> = {
  /*
    青色怒火：近卫阿米娅的模型（`char_1001_amiya2`）。
    定位是"她自己变强"——射程从 3 掉到 2，换来血量和攻击。
  */
  [AMIYA_FORM_IDS.blue]: {
    id: AMIYA_FORM_IDS.blue,
    name: '阿米娅·青色怒火',
    cost: 3,
    charId: 'char_1001_amiya2',
    traits: [...AMIYA_TRAITS],
    base: {
      hp: 820,
      attackDamage: 110,
      attackSpeed: 1150,
      armor: 22,
      magicResist: 30,
      // ★ 0.3.2 用户口径：近卫形态，射程 1（原来是 2）
      range: 1,
      manaPerAttack: 100,
    },
    starHpBp: 1800,
    starDamageBp: 1800,
    color: '#3f7fd6',
    sprite: AMIYA_FORM_IDS.blue,
    ascendOnly: true,
    /*
      ★ 0.3.2 表现层（用户口径）：普攻 = **黑墨斩击 + 青色刃口**。
      id 的含义与注册表条目见 `apps/web/src/three/sequence-fx.ts`；
      受击痕自动跟着变黑（`melee-hit-fx.ts` 的 `MELEE_SLASH_STYLES`）。
    */
    combatFx: 'amiya_cyan_slash',
    /*
      ★ 占位（0.3.3 正式设计：近战爆发 + 眩晕）。
      先用"自己加攻 8 秒"顶着 —— 形态换了之后她从术师变近卫，
      有伤害就比没有强，等正式技能出来整块替换。
    */
    skill: {
      id: 'op_amiya_blue_skill',
      name: '青色怒火',
      desc:
        '获得 10/15/20 发弹药：每次攻击消耗 1 发，攻击变为**真实伤害**且攻击力 +20%/30%/50%；' +
        '技能期间我方全体攻击力 +20%/25%/30%，且单次攻击变为**两连击**',
      /*
        ★ 0.3.2 正式技能（用户口径）：

        · **弹药 10/15/20 发** —— `attacks` 是"接下来 N 次攻击"，
          这个项目里它同时就是"弹药"：打空之前不回蓝（`isSkillActive` 闸门）；
        · **攻击变真实伤害** —— `damageTypeOverride: 'true'`；
        · **攻击力 +20%/30%/50%** —— `attackDamageBp`
          （2026-10-22 用户下调：原来写 50/70/120，实测太强）；
        · **单次攻击变两连击** —— `multiHit: 2`（两段都吃上面那份攻击力）；
        · **全队 +20%/25%/30% 且两连击** —— 另一条 `allAllies` 的包。

        【全队那一条的时长怎么定？】
        它没法跟着"弹药打空"结束（那是施法者自己的次数），所以给一个**和弹药消耗
        大致同期**的固定时长（20 秒 ≈ 2 星攻速下打空 15 发的时间）。
        写"整场"会让这条盟约变成永久全队 +30%，太强。
      */
      effects: [
        {
          kind: 'buff',
          target: 'self',
          stats: {
            attackDamageBp: [2000, 3000, 5000],
            damageTypeOverride: 'true',
            multiHit: 2,
          },
          // 有 attacks 时这个时长会被忽略（走"次数"那条路），写一个够长的值即可
          durationTicks: MAX_BATTLE_TICKS,
          attacks: [10, 15, 20],
        },
        {
          kind: 'buff',
          target: 'allAllies',
          stats: { attackDamageBp: [2000, 2500, 3000], multiHit: 2 },
          durationTicks: s(20),
        },
      ],
      manaSource: 'attack',
      // ★ 初始技能条 100/300/600（MANA_MAX = 1000 ⇒ 10% / 30% / 60%）
      startManaBp: [1000, 3000, 6000],
      /*
        ★ 0.3.2 表现层（用户口径：技能特效 = 青 + 红 + 黑三色混合）：
        起手 = 脚下墨爆（黑 + 青勾边 + 红火星）；技能期每一刀 = 黑刃 + 青刃口 + 红色命中爆点。
        条目见 `SKILL_FX.amiya_cyan_fury`。
      */
      castFx: 'amiya_cyan_fury',
    },
  },

  /*
    慈悲愿景：医疗阿米娅的模型（`char_1037_amiya3`）。
    定位是"带着队伍变强"——面板最低，但它会留在后排。
  */
  [AMIYA_FORM_IDS.mercy]: {
    id: AMIYA_FORM_IDS.mercy,
    name: '阿米娅·慈悲愿景',
    cost: 3,
    charId: 'char_1037_amiya3',
    traits: [...AMIYA_TRAITS],
    base: {
      hp: 760,
      attackDamage: 85,
      attackSpeed: 1100,
      armor: 26,
      magicResist: 38,
      // ★ 0.3.2 用户口径：医疗形态，射程 4（原来是 3）
      range: 4,
      manaPerAttack: 100,
    },
    starHpBp: 1800,
    starDamageBp: 1800,
    color: '#b9a6cf',
    sprite: AMIYA_FORM_IDS.mercy,
    ascendOnly: true,
    /*
      ★ 0.3.2 表现层（用户口径：「粉色法术光效，从发射到命中保持统一的柔和粉色调」）：
      注册表键在 `apps/web/src/three/bolt-tracer-fx.ts` 的 `TRACER_FX.amiya_mercy`。
      ★ 升变形态不在 `TRACER_FX_IDS` 那张按 opNN 编的表里（那是 ROSTER 用的），
        所以这里直接写在 def 上 —— 和 `tracerFx` 是同一个字段，读的地方只有一处。
    */
    tracerFx: 'amiya_mercy',
    skill: {
      id: 'op_amiya_mercy_skill',
      name: '慈悲愿景',
      desc:
        '主动：对前方 3 格（含自身格、两侧各延伸 1 格）的敌人造成攻击力 200%/300%/500% 的**真实伤害**，' +
        '并使其攻击速度 -50%，持续 3/5/10 秒；同时自身攻击速度 +50%，持续 10 秒。' +
        '被动：每次攻击都会治疗 3 格内生命值最低的友军（含自己）自身攻击力 20%/30%/45% 的生命',
      /*
        ★ 0.3.2 正式技能（用户口径）：

        · **前方 3×4 矩形** —— `shape: 'rect'` + `radius: 3`
          （深 4 格含自己、宽 3 格；`depth >= 0` 保证不往背后打，
          这就是"不能斜着释放"的实际含义）；
        · **真实伤害** —— `damageType: 'true'`；
        · **迟缓 50% 攻速 3/5/10 秒** —— `debuff.attackSpeedBp: -5000` + 星级数组时长；
        · **自身攻速 +50% 10 秒** —— 第二条 `self` 包；
        · **被动"每次攻击奶 3 格内最低血友军"** —— 用 `pulse` 表达：
          `intervalFromAttackSpeed` 让它**跟着自己的攻击频率**走（= 每次攻击一跳），
          `radius: 3` + `affect: 'allies'` + `single: true` 就是"3 格内治一个"。
          ★ 严格说这是"每跳治一个"，不是"打谁治谁"；对玩法没有实质差别，
            而且它天然自带"按攻速触发"这个最关键的节奏。
      */
      effects: [
        {
          kind: 'damage',
          target: 'currentTarget',
          fallback: 'nearestEnemy',
          power: [2000, 3000, 5000],
          damageType: 'true',
          radius: 3,
          shape: 'rect',
          /*
            ★★ 0.3.2 表现层（用户口径）：「仅在造成伤害的那一瞬间，以 3×4 的方格阵列
            生成粉色方形特效并全场爆闪一次；三角粒子沿边缘飘动；整套 2 秒后完全消失」。
            → `apps/web/src/three/amiya-form-fx.ts` 的 `amiya_verdict`。
            ★ 挂在**伤害**上而不是 `castFx` 上：用户要的是"造成伤害那一瞬"，
              而这个技能如果一个人都没打到（`hitAny` 为假）就不该有方块阵 ——
              挂在 zone 上天然满足这条，挂在 cast 上会在空放时也铺一片。
          */
          fx: 'amiya_verdict',
          debuff: {
            stats: { attackSpeedBp: -5000 },
            durationTicks: [s(3), s(5), s(10)],
          },
        },
        {
          kind: 'buff',
          target: 'self',
          stats: { attackSpeedBp: 5000 },
          durationTicks: s(10),
        },
      ],
      passive: {
        pulse: {
          intervalTicks: TICKS_PER_SECOND,
          intervalFromAttackSpeed: true,
          radius: 3,
          affect: 'allies',
          single: true,
          heal: { basis: 'attack', ratioBp: [2000, 3000, 4500] },
        },
      },
      manaSource: 'attack',
      // ★ 初始技能条 200/400/600（20% / 40% / 60%）
      startManaBp: [2000, 4000, 6000],
    },
  },

  /*
    炉芯终曲：终态。用户口径是"基本成型即赢"，所以面板直接压过现有 5 费。
    ★ 只有 3 星形态 —— 它不会被 1/2 星的阿米娅升到（见 `minStar: 3`）。
    ★ 模型 = 集成战略的敌方 Boss「"阿米娅",炉芯终曲」，
      charId `enemy_2092_skzamy`（Ark-Models 的 `models_enemies/2092_skzamy/`），
      走的是和野怪同一条抓取/渲染路子（`fetch-chibi.ts` 里 `enemy_` 前缀分支）。
  */
  [AMIYA_FORM_IDS.core]: {
    id: AMIYA_FORM_IDS.core,
    name: '阿米娅·炉芯终曲',
    cost: 5,
    charId: 'enemy_2092_skzamy',
    traits: [...AMIYA_TRAITS],
    base: {
      hp: 2200,
      attackDamage: 220,
      attackSpeed: 1300,
      armor: 55,
      magicResist: 60,
      // ★ 0.3.2 用户口径：终态射程 5
      range: 5,
      manaPerAttack: 100,
    },
    starHpBp: 1800,
    starDamageBp: 1800,
    color: '#b4322f',
    sprite: AMIYA_FORM_IDS.core,
    ascendOnly: true,
    /*
      ★ 0.3.2 表现层（用户口径：「黑色法术特效」）：
      `TRACER_FX.amiya_core` = 暗芯弹（中间不画、只描暗红两条轨 + 空心弹头），
      加色混合下这是唯一能读成"黑"的画法（见 `bolt-tracer-fx.ts` 的 `coreSplit`）。
    */
    tracerFx: 'amiya_core',
    /*
      ★★ 0.3.2 被动：**重生 1 次**（用户口径）。

      · 倒下后**躺 10 秒**才站起来（`delayTicks`）——
        这 10 秒里每秒对全场造成自身攻击力 100% 的真实伤害（`downedPulse`，
        实现见 `combat-math.ts` 的 `tickDowned`）；
      · 站起来之后**无敌 10 秒** —— 用 `phase2.buffs` 里那份 `invulnerable` 包表达
        （现成能力，不新增字段）；
      · 满血复活（`hpBp: 10000`）。
      · 一场战斗只重生一次（`rebornUsed`）。
    */
    reborn: {
      hpBp: 10000,
      delayTicks: s(10),
      downedPulse: { intervalTicks: s(1), power: 1000, damageType: 'true' },
      phase2: {
        desc: '重生完成：无敌 10 秒（形态本身不变，还是同一套模型）',
        buffs: [{ stats: { invulnerable: true }, durationTicks: s(10) }],
      },
      desc: '重生 1 次：倒地 10 秒（期间每秒对全场造成攻击力 100% 真实伤害），站起来后无敌 10 秒',
    },
    skill: {
      id: 'op_amiya_core_skill',
      name: '无言的期盼',
      desc:
        '使全体敌人获得「终曲」10 秒：攻击速度 / 攻击力 / 双抗 / 技能回复速度全部 -99%，无法移动，' +
        '每秒受到自身最大生命 5% 的真实伤害；期间每 2 秒随机抹除一名敌人（无视无敌、重生与免死）',
      /*
        ★ 0.3.2 正式技能（用户口径）：

        · **终曲 debuff 10 秒** —— 五条属性一起削 + `noMove`：
          `attackSpeedBp/attackDamageBp/armorBp/magicResistBp/manaGainBp` 全 -9900；
          ★ `manaGainBp` 是本轮新增的"技力获取倍率"，判据在 `gainMana()`（和 noManaGain 同一处）。
        · **每秒 5% 最大生命真实伤害** —— `dot` + `powerBasis: 'targetMaxHp'`（也是本轮新增）：
          power 500 = 千分比 5%，基数是**被打的人自己**的生命上限。
        · **每 2 秒随机即死一个** —— `kind: 'execute'`，走 `tickExecute`；
          它会先把 `rebornUsed` / `defyDeathUsed` / `unyieldingRevives` 这些
          "杀不死"的开关关掉再杀，所以**无视无敌、重生、免死**（表里原话）。
      */
      effects: [
        {
          kind: 'debuff',
          target: 'allEnemies',
          stats: {
            attackSpeedBp: -9900,
            attackDamageBp: -9900,
            armorBp: -9900,
            magicResistBp: -9900,
            manaGainBp: -9900,
            noMove: true,
          },
          durationTicks: s(10),
        },
        {
          kind: 'dot',
          target: 'allEnemies',
          /*
            ★ `power` 是**千分比**：5% = 50（曾经手写成 500 = 50%，一跳直接打掉半个血条）。
          */
          power: 50,
          powerBasis: 'targetMaxHp',
          damageType: 'true',
          durationTicks: s(10),
          intervalTicks: s(1),
        },
        {
          /*
            ★★ 0.3.2 真·即死：技能期间每 2 秒随机抹掉 1 个敌人（共 5 次）。
            穿透无敌 / 重生 / 免死 —— 实现在 `tickExecute`（`skills.ts`）。
          */
          kind: 'execute',
          target: 'randomEnemies',
          count: 1,
          intervalTicks: s(2),
          durationTicks: s(10),
          /*
            ★ 纯表现：内核在**真抹掉人**的那一 tick 多报一条 `executeFx`，
            渲染层照它播"黑红破碎"（`amiya-form-fx.ts` 的 `amiya_execute`）。
          */
          fx: 'amiya_execute',
        },
      ],
      manaSource: 'auto',
      manaPerSecond: 100,
      // ★ 初始技能条 900（MANA_MAX = 1000 ⇒ 90%）
      startManaBp: 9000,
      /*
        ★★ 0.3.2 表现层（用户口径）：「黑色半透明、带破碎镜面质感的碎片特效在全场持续飘动」。
        → `amiya-form-fx.ts` 的 `amiya_requiem`；时长读技能数据（这里 10 秒），不写死。
      */
      castFx: 'amiya_requiem',
    },
  },
};

/** 这个 id 是不是升变形态（`isPlayableDef` 之外的第二个判据，界面也会用） */
export function isAscendFormId(id: string | undefined | null): boolean {
  if (!id) return false;
  return id in ASCEND_DEFS;
}

/**
 * ★★ 家族 key —— 「哪几个棋子算**同一个棋子**」的唯一判据。
 *
 * 【为什么要有它？】
 * 用户口径：三个形态和基础阿米娅是**同一只棋子**。
 *   · **牌库**：升变不从池里多拿几张，也不把原来那几张还回去 ——
 *     它换了个形态之后继续占「阿米娅」的份数；
 *   · **升星**：手里 1 星「青色怒火」+ 再买 2 张 1 费阿米娅 = **2 星青色怒火**。
 *
 * 所以凡是"按棋子记账"的地方都必须先过它：
 *   · `economy.copiesHeld`（牌库占用）
 *   · `economy.mergeBench`（合成分组）
 *   · `Room.returnToPool`（淘汰回库 / 卖出还牌）
 *
 * ★ 别在别处再写一遍 `id === 'op_amiya_blue' || id === ...`：
 *   以后加第四个形态时，那种写法一定会漏掉某一处，而**漏的那一处不会报错** ——
 *   牌库会静默地越用越少（或越用越多），到残局才看得出来。
 */
export function familyKeyOf(defId: string): string {
  return isAscendFormId(defId) ? AMIYA_BASE_ID : defId;
}

/**
 * 形态在升变链上的位置：基础 0 / 中间形态 1 / 终态 2。
 *
 * 用途只有一个：**合成时保留"更靠后"的那个形态**。
 * （1 星青色怒火 + 2 张基础阿米娅 → 结果必须是青色怒火，不能退回基础阿米娅）
 */
export function ascendRankOf(defId: string | undefined | null): number {
  if (!defId) return 0;
  if (defId === AMIYA_FORM_IDS.core) return 2;
  return isAscendFormId(defId) ? 1 : 0;
}

/**
 * ★ 0.3.2 用户口径：**升变后的形态不能出售**。
 *
 * 【为什么不许卖？】
 *   · 升变是盟约「阿米娅 · 不容拒绝」的核心收益，证用掉之后这个棋子就"定型"了。
 *     能卖的话它就变成"一张证换一笔金币"的提款机；
 *   · 而且卖掉要把她占的那几张阿米娅牌还回共享牌库 ——
 *     等于连这条玩法的成本一起退掉了。
 *   · 玩法上的意思也很直白：阿米娅升变是不可逆的，选了就得用。
 *
 * ★ 判据只有这一处。三个入口都调它：
 *   · 内核 `sellBenchUnit`（最终闸门，任何调用点都拦得住）
 *   · 客户端右键卖出（要先拦，否则会先把牌还回共享牌库再被拒）
 *   · 服务端 `sellCard`（防手滑 / 防改客户端）
 *   别在界面里再写一遍 `defId === 'op_amiya_blue'` —— 以后加第四个形态一定漏。
 */
export function isSellLockedDefId(defId: string | undefined | null): boolean {
  return isAscendFormId(defId);
}

/** 形态是不是"终态"（炉芯终曲） */
export function isFinalAscendForm(id: string | undefined | null): boolean {
  return id === AMIYA_FORM_IDS.core;
}

/**
 * 升变链：`from` → `to` 的合法路线。
 *
 * ★ 和藏品里的 `onEquip.ascend` 是**同一份数据**的两个视角：
 *   · 藏品那边写"这件证能把谁变成谁"（谁拿到证、用在哪）；
 *   · 这里写"这条链长什么样"（界面画进度、校验用）。
 *   两边都来自 `ASCEND_DEFS` + 藏品表，所以不会出现"证和链对不上"。
 */
export const ASCEND_ROUTES = {
  [AMIYA_BASE_ID]: [AMIYA_FORM_IDS.blue, AMIYA_FORM_IDS.mercy],
  [AMIYA_FORM_IDS.blue]: [AMIYA_FORM_IDS.core],
  [AMIYA_FORM_IDS.mercy]: [AMIYA_FORM_IDS.core],
} as const;
