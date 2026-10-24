import type { TraitDefTable } from './types.js';

/**
 * ============================================================
 *  羁绊表（0.2 修订版）
 * ============================================================
 *
 * 数据来源：`AIRNIGHT-干员总表(未修改干员版)（修订版1）））.xlsx` 的「羁绊（阵营·职业）」表。
 * 改动清单见 `docs/0.2-改动清单.md`。
 *
 * ============================================================
 *  效果类型（`effects` 里的 type）
 * ============================================================
 *  | 写法            | 单位   | 例子 |
 *  |---|---|---|
 *  | attackDamageBp  | 万分比 | 5000 = +50% 攻击力 |
 *  | attackSpeedBp   | 万分比 | 3000 = +30% 攻速 |
 *  | hpBp            | 万分比 | 10000 = +100% 生命上限 |
 *  | armorFlat       | 绝对值 | 20 = +20 护甲 |
 *  | magicResistFlat | 绝对值 | 30 = +30 魔抗 |
 *  | armorBp         | 万分比 | 5000 = +50% 护甲 |
 *  | magicResistBp   | 万分比 | |
 *  | rangeFlat       | 绝对格 | 2 = 攻击距离 +2 格 |
 *  | healingBp       | 万分比 | 3000 = 治疗效果 +30% |
 *  | allStatsBp      | 万分比 | 2000 = 全部属性 +20% |
 *  | goldPerRound    | 金币数 | 经济类，不进战斗 |
 *
 * ⚠️ **闪避和全能吸血不在这里**：它们走 `mods` 的字段
 * （`evasionPhysicalBp` / `evasionMagicBp` / `lifestealBp`），
 * 所以用 `mechanics: [{ kind: 'startSelfBuff', stats: {...} }]` 在开局挂成常驻被动包。
 *
 * ============================================================
 *  `scope`：加成给谁（不写 = 'members'）
 * ============================================================
 *  | 值 | 含义 |
 *  |---|---|
 *  | 'members' | 只有带这个标签的棋子吃到（绝大多数） |
 *  | 'team'    | 全队都吃到（光环型：支援、领导人、龙、法术） |
 *
 * ============================================================
 *  ✅ 18 个羁绊全部有正式效果
 * ============================================================
 * ★ 0.2 的**人数门槛普遍上调**（3/6/9/11 这种），很多档位现有成员数凑不齐 ——
 *   这是**有意的**：转职类藏品可以把人凑够，凑不齐的档位不触发即可，
 *   不需要在数据里做任何特殊处理（档位是数据驱动的）。
 */
export const TRAIT_DEFS: TraitDefTable = {
  // ============================================================
  //  出身 / 势力
  // ============================================================

  sarkaz: {
    id: 'sarkaz',
    name: '萨卡兹',
    kind: 'race',
    /*
      ★ 0.2：档位 3/6/9/11；攻击力 +10/20/30/50%；附带该次伤害 10/15/20/30% 法术伤害；
      自带 5/10/15/30% 全能吸血；阵亡时对周围 3×3 造成"累计吸血量 × 100/105/110/150%"的法术伤害。
      （11 人档两列数字冲突时以「效果说明」为准 —— 用户 2026-10-16 确认。）
    */
    tiers: [
      {
        count: 3,
        effects: [{ type: 'attackDamageBp', value: 1000 }],
        mechanics: [
          { kind: 'onHitDamage', ratioBp: 1000, damageType: 'magic', scale: 'dealt' },
          { kind: 'startSelfBuff', stats: { lifestealBp: 500 } },
          { kind: 'deathExplosion', ratioBp: 10000 },
        ],
        desc: '萨卡兹干员 +10% 攻击力，攻击附带该次伤害 10% 的法术伤害，自带 5% 全能吸血；阵亡时对周围 3×3 造成 100% 吸血量的法术伤害',
      },
      {
        count: 6,
        effects: [{ type: 'attackDamageBp', value: 2000 }],
        mechanics: [
          { kind: 'onHitDamage', ratioBp: 1500, damageType: 'magic', scale: 'dealt' },
          { kind: 'startSelfBuff', stats: { lifestealBp: 1000 } },
          { kind: 'deathExplosion', ratioBp: 10500 },
        ],
        desc: '萨卡兹干员 +20% 攻击力，攻击附带该次伤害 15% 的法术伤害，自带 10% 全能吸血；阵亡时对周围 3×3 造成 105% 吸血量的法术伤害',
      },
      {
        count: 9,
        effects: [{ type: 'attackDamageBp', value: 3000 }],
        mechanics: [
          { kind: 'onHitDamage', ratioBp: 2000, damageType: 'magic', scale: 'dealt' },
          { kind: 'startSelfBuff', stats: { lifestealBp: 1500 } },
          { kind: 'deathExplosion', ratioBp: 11000 },
        ],
        desc: '萨卡兹干员 +30% 攻击力，攻击附带该次伤害 20% 的法术伤害，自带 15% 全能吸血；阵亡时对周围 3×3 造成 110% 吸血量的法术伤害',
      },
      {
        count: 11,
        effects: [{ type: 'attackDamageBp', value: 5000 }],
        mechanics: [
          { kind: 'onHitDamage', ratioBp: 3000, damageType: 'magic', scale: 'dealt' },
          { kind: 'startSelfBuff', stats: { lifestealBp: 3000 } },
          { kind: 'deathExplosion', ratioBp: 15000 },
        ],
        desc: '萨卡兹干员 +50% 攻击力，攻击附带该次伤害 30% 的法术伤害，自带 30% 全能吸血；阵亡时对周围 3×3 造成 150% 吸血量的法术伤害',
      },
    ],
  },

  kazimierz: {
    id: 'kazimierz',
    name: '卡西米尔',
    kind: 'race',
    /*
      ★ 0.2：档位 3/6/8，攻速 +20/30/50%，并各召唤一只援军：
        3 人 ->「左手」泰斯特·白杨；6 人 -> 血骑士狄开俄波利斯；8 人 -> 锏。

      【援军本体在哪？】
      它们**不是新做的**：`monster-data.ts` 里早就有 `mn_tester` / `mn_bldkgt` / `mn_blkswb`
      三个 def（带复活、护送召唤、每回合成长全套，见那里的 `summonGrowth` / `reborn`）。
      这里直接按 `summonId` 引用即可 —— 战斗内核只认一张 `state.defs`。

      ★ 6 人档的闪避：效果说明写「5 的物理闪避与 5 的法术闪避」，
      属性加成列写的是「5%物理伤害」—— **以效果说明为准**（用户 2026-10-16 确认）。
    */
    tiers: [
      {
        count: 3,
        effects: [{ type: 'attackSpeedBp', value: 2000 }],
        mechanics: [
          { kind: 'startSelfBuff', stats: { evasionPhysicalBp: 500 } },
          {
            kind: 'startSummon',
            // ★ 工程里的写法是「泰特斯·白杨」（mn_tytus），表格写的是「泰斯特·白杨」—— 以工程为准
            summonId: 'mn_tytus',
            count: 1,
            placement: 'besideHighestHpAlly',
          },
        ],
        desc: '卡西米尔干员 +20% 攻速、5% 物理闪避；开战在生命值最高的友方旁边召唤「左手」泰斯特·白杨',
      },
      {
        count: 6,
        effects: [{ type: 'attackSpeedBp', value: 3000 }],
        mechanics: [
          { kind: 'startSelfBuff', stats: { evasionPhysicalBp: 500, evasionMagicBp: 500 } },
          {
            kind: 'startSummon',
            // 血量用 monster-data.ts 里的 4000 —— 表格那格是输错了（用户 2026-10-16 确认）
            summonId: 'mn_bldkgt',
            count: 1,
            placement: 'besideHighestHpAlly',
          },
        ],
        desc: '卡西米尔干员 +30% 攻速、5% 物理闪避与 5% 法术闪避；开战在生命值最高的友方旁边召唤血骑士狄开俄波利斯',
      },
      {
        count: 8,
        effects: [{ type: 'attackSpeedBp', value: 5000 }],
        mechanics: [
          { kind: 'startSelfBuff', stats: { evasionPhysicalBp: 1500, evasionMagicBp: 1000 } },
          {
            kind: 'startSummon',
            summonId: 'mn_blkswb',
            count: 1,
            placement: 'besideHighestHpAlly',
          },
        ],
        desc: '卡西米尔干员 +50% 攻速、15% 物理闪避与 10% 法术闪避；开战在生命值最高的友方旁边召唤锏',
      },
    ],
  },

  laterano: {
    id: 'laterano',
    name: '拉特兰',
    kind: 'race',
    /*
      ★ 0.2：档位 3/6/**9**；+25/35/50% 攻击力与攻速；
      累计攻击 **30/20/20** 次后对全体敌人造成「固定 200/300/600 点 + 全部拉特兰干员攻击力总和的 10/15/20%」的物理伤害。

      【两条口径同时吃】`attackCountNuke` 的 `flatDamage` 与 `totalAttackBp` 是**可叠加**的
      （引擎里先算固定值、再算百分比那一条），所以两个字段都写。

      ★★ 0.2.2：触发次数改成 **30 / 20 / 20**（3 人档 30 次、6 人档 20 次、9 人档 20 次）。
      0.2 那版是三档统一 30（再往前是 30/20/10），用户这次要 30/20/20 ——
      也就是"6 人档就够快了，9 人档靠伤害拉开差距、不再继续加快"。
      ⇒ 计数与进度显示**全部读 `every`**（`rules.ts` 的 `mechanic.every`、
        事件里的 `target: mechanic.every`），所以只改这三处就够了，
        界面上「拉特兰 12/20」的分母会自动跟着变。

      ★★ 0.2.1：三档都挂了 `fx: 'laterano_volley'` —— 发动时从**触发方那半场**
      横扫全场的子弹雨（演出见 `apps/web/src/three/board-volley-fx.ts`，
      弹丸画法见 `bolt-tracer-fx.ts` 的 `bullet_laterano`）。
      三档演出完全一样、只有伤害不同，所以三个档位各写一次同样的 id。
    */
    tiers: [
      {
        count: 3,
        effects: [
          { type: 'attackDamageBp', value: 2500 },
          { type: 'attackSpeedBp', value: 2500 },
        ],
        mechanics: [
          {
            kind: 'attackCountNuke',
            every: 30,
            flatDamage: 200,
            totalAttackBp: 1000,
            fx: 'laterano_volley',
          },
        ],
        desc: '拉特兰 +25% 攻击力与攻速；累计攻击 30 次后，对全体敌人造成 200 点 + 拉特兰攻击力总和 10% 的物理伤害',
      },
      {
        count: 6,
        effects: [
          { type: 'attackDamageBp', value: 3500 },
          { type: 'attackSpeedBp', value: 3500 },
        ],
        mechanics: [
          {
            kind: 'attackCountNuke',
            // ★ 0.2.2：6 人档 20 次（原 30 次）
            every: 20,
            flatDamage: 300,
            totalAttackBp: 1500,
            fx: 'laterano_volley',
          },
        ],
        desc: '拉特兰 +35% 攻击力与攻速；累计攻击 20 次后，对全体敌人造成 300 点 + 拉特兰攻击力总和 15% 的物理伤害',
      },
      {
        count: 9,
        effects: [
          { type: 'attackDamageBp', value: 5000 },
          { type: 'attackSpeedBp', value: 5000 },
        ],
        mechanics: [
          {
            kind: 'attackCountNuke',
            // ★ 0.2.2：9 人档也是 20 次（和 6 人档同频，靠伤害拉开差距）
            every: 20,
            flatDamage: 600,
            totalAttackBp: 2000,
            fx: 'laterano_volley',
          },
        ],
        desc: '拉特兰 +50% 攻击力与攻速；累计攻击 20 次后，对全体敌人造成 600 点 + 拉特兰攻击力总和 20% 的物理伤害',
      },
    ],
  },

  rhodes: {
    id: 'rhodes',
    name: '罗德岛',
    kind: 'race',
    /*
      ★ 0.2：档位 3/5/7/10 —— **整条换掉了**（旧的 highestHpCarrier"血量最高者继承攻击力"不再存在）。

      新效果 = 两件事：
        ① **回合胜利时**给带标签的干员叠一层（生命上限 + 攻击力各 +2.25/3.25/4/10%），
           最多 10 层，**跨回合保存**；羁绊断档时层数要重新叠。
        ② 战斗中**第一个**阵亡的友方，把自身数值的 50/50/50/100% 传给最近的友方（每场 1/2/3/5 次）。

      ⚠️ ①是跨回合的：层数存在客户端 GameState 里随阵容上报，
      战斗侧只负责"把已有的层数换成属性"（`roundTraitStack`）。
    */
    tiers: [
      {
        count: 3,
        effects: [],
        mechanics: [
          { kind: 'roundTraitStack', hpBp: 225, attackDamageBp: 225, maxStacks: 10 },
          { kind: 'deathStatTransfer', ratioBp: 5000, maxTransfers: 1 },
        ],
        desc: '回合胜利时，罗德岛干员 +2.25% 生命上限与攻击力（最多 10 层，跨回合保存）；战斗中第一个阵亡的友方把 50% 数值传给最近的友方（每场 1 次）',
      },
      {
        count: 5,
        effects: [],
        mechanics: [
          { kind: 'roundTraitStack', hpBp: 325, attackDamageBp: 325, maxStacks: 10 },
          { kind: 'deathStatTransfer', ratioBp: 5000, maxTransfers: 2 },
        ],
        desc: '回合胜利时，罗德岛干员 +3.25% 生命上限与攻击力（最多 10 层，跨回合保存）；第一个阵亡的友方把 50% 数值传给最近的友方（每场 2 次）',
      },
      {
        count: 7,
        effects: [],
        mechanics: [
          { kind: 'roundTraitStack', hpBp: 400, attackDamageBp: 400, maxStacks: 10 },
          { kind: 'deathStatTransfer', ratioBp: 5000, maxTransfers: 3 },
        ],
        desc: '回合胜利时，罗德岛干员 +4% 生命上限与攻击力（最多 10 层，跨回合保存）；第一个阵亡的友方把 50% 数值传给最近的友方（每场 3 次）',
      },
      {
        count: 10,
        effects: [],
        mechanics: [
          { kind: 'roundTraitStack', hpBp: 1000, attackDamageBp: 1000, maxStacks: 10 },
          { kind: 'deathStatTransfer', ratioBp: 10000, maxTransfers: 5 },
        ],
        desc: '回合胜利时，罗德岛干员 +10% 生命上限与攻击力（最多 10 层，跨回合保存）；第一个阵亡的友方把 100% 数值传给最近的友方（每场 5 次）',
      },
    ],
  },

  victoria: {
    id: 'victoria',
    name: '维多利亚',
    kind: 'race',
    /*
      ★ 0.2：档位 3/6/9/11；攻击力 +15/25/40/60%，防御力 +10/20/40/60%；
      生命值**首次**降到 30/50/80/90% 以下时：攻速 +300/500/800/1000% 持续 5 秒，
      同时每秒回复自身生命上限 0.5/1/2/5%，持续 10/10/5/10 秒。

      ★ 攻速与回血是**两个独立时长**（数据表里就不一样），所以 lowHpSurge 上
      `durationTicks` 管攻速、`regenTicks` 管回血，别合并。
    */
    tiers: [
      {
        count: 3,
        effects: [
          { type: 'attackDamageBp', value: 1500 },
          { type: 'armorBp', value: 1000 },
        ],
        mechanics: [
          { kind: 'lowHpSurge', hpThresholdBp: 3000, speedBp: 30000, durationTicks: 100, regenBp: 50, regenTicks: 200 },
        ],
        desc: '维多利亚干员 +15% 攻击力、+10% 防御力；生命首次降到 30% 以下时攻速 +300% 持续 5 秒，并每秒回复 0.5% 生命上限持续 10 秒',
      },
      {
        count: 6,
        effects: [
          { type: 'attackDamageBp', value: 2500 },
          { type: 'armorBp', value: 2000 },
        ],
        mechanics: [
          { kind: 'lowHpSurge', hpThresholdBp: 5000, speedBp: 50000, durationTicks: 100, regenBp: 100, regenTicks: 200 },
        ],
        desc: '维多利亚干员 +25% 攻击力、+20% 防御力；生命首次降到 50% 以下时攻速 +500% 持续 5 秒，并每秒回复 1% 生命上限持续 10 秒',
      },
      {
        count: 9,
        effects: [
          { type: 'attackDamageBp', value: 4000 },
          { type: 'armorBp', value: 4000 },
        ],
        mechanics: [
          { kind: 'lowHpSurge', hpThresholdBp: 8000, speedBp: 80000, durationTicks: 100, regenBp: 200, regenTicks: 100 },
        ],
        desc: '维多利亚干员 +40% 攻击力、+40% 防御力；生命首次降到 80% 以下时攻速 +800% 持续 5 秒，并每秒回复 2% 生命上限持续 5 秒',
      },
      {
        count: 11,
        effects: [
          { type: 'attackDamageBp', value: 6000 },
          { type: 'armorBp', value: 6000 },
        ],
        mechanics: [
          { kind: 'lowHpSurge', hpThresholdBp: 9000, speedBp: 100000, durationTicks: 100, regenBp: 500, regenTicks: 200 },
        ],
        desc: '维多利亚干员 +60% 攻击力、+60% 防御力；生命首次降到 90% 以下时攻速 +1000% 持续 5 秒，并每秒回复 5% 生命上限持续 10 秒',
      },
    ],
  },

  yan: {
    id: 'yan',
    name: '炎',
    kind: 'race',
    /*
      ★ 0.2：档位 3/6/9/11；攻击力 +10/30/50/70%；
      造成伤害时斩杀生命值低于 5/10/20/30% 的敌人；
      并且**每次攻击给目标附着燃烧**：每秒受到目标最大生命 1% 的法术伤害，
      最多 5 层，每次被附着刷新持续时间（5 秒）。
    */
    tiers: [
      {
        count: 3,
        effects: [{ type: 'attackDamageBp', value: 1000 }],
        mechanics: [
          { kind: 'execute', thresholdBp: 500 },
          { kind: 'burnStack', perSecondBp: 100, maxStacks: 5, durationTicks: 100 },
        ],
        desc: '炎国干员 +10% 攻击力；造成伤害时斩杀生命值低于 5% 的敌人，每次攻击附着燃烧（每秒 1% 最大生命法术伤害，最多 5 层，持续 5 秒）',
      },
      {
        count: 6,
        effects: [{ type: 'attackDamageBp', value: 3000 }],
        mechanics: [
          { kind: 'execute', thresholdBp: 1000 },
          { kind: 'burnStack', perSecondBp: 100, maxStacks: 5, durationTicks: 100 },
        ],
        desc: '炎国干员 +30% 攻击力；造成伤害时斩杀生命值低于 10% 的敌人，每次攻击附着燃烧（每秒 1% 最大生命法术伤害，最多 5 层，持续 5 秒）',
      },
      {
        count: 9,
        effects: [{ type: 'attackDamageBp', value: 5000 }],
        mechanics: [
          { kind: 'execute', thresholdBp: 2000 },
          { kind: 'burnStack', perSecondBp: 100, maxStacks: 5, durationTicks: 100 },
        ],
        desc: '炎国干员 +50% 攻击力；造成伤害时斩杀生命值低于 20% 的敌人，每次攻击附着燃烧（每秒 1% 最大生命法术伤害，最多 5 层，持续 5 秒）',
      },
      {
        count: 11,
        effects: [{ type: 'attackDamageBp', value: 7000 }],
        mechanics: [
          { kind: 'execute', thresholdBp: 3000 },
          { kind: 'burnStack', perSecondBp: 100, maxStacks: 5, durationTicks: 100 },
        ],
        desc: '炎国干员 +70% 攻击力；造成伤害时斩杀生命值低于 30% 的敌人，每次攻击附着燃烧（每秒 1% 最大生命法术伤害，最多 5 层，持续 5 秒）',
      },
    ],
  },

  dragon: {
    id: 'dragon',
    name: '龙',
    kind: 'race',
    // 龙干员是触发条件，加成给全队（"我方全部干员"）
    scope: 'team',
    /*
      ★★ 0.3（用户口径）：挨了整条 ——
      旧：「每有 1 个龙羁绊干员到达 3 星，全队攻击力 +12%」（数“几个三星”）
      新：「按场上龙干员的**星级总和**提升全队攻击力，每一星 2%/3%/5%」
        · 重复干员只算最高星级的那一个（见 rules.ts 的 `attackByTraitStars`）
        · 所以 2 星也算，只是算 2 颗；两个 3 星龙 = 6 颗 = 1/2/3 档分别 +12/18/30%。
      ★ 为什么三个档位都写同一件事、只有数值不同？因为取的是“生效的最高档”，
        每档自带一份就行（和旧版一样的写法）。
    */
    tiers: [
      {
        count: 1,
        effects: [],
        mechanics: [{ kind: 'attackByTraitStars', perStarBp: 200 }],
        desc: '每一星龙羁绊干员（重复只算最高星级）使我方全部干员攻击力 +2%',
      },
      {
        count: 2,
        effects: [],
        mechanics: [{ kind: 'attackByTraitStars', perStarBp: 300 }],
        desc: '每一星龙羁绊干员（重复只算最高星级）使我方全部干员攻击力 +3%',
      },
      {
        count: 3,
        effects: [],
        mechanics: [{ kind: 'attackByTraitStars', perStarBp: 500 }],
        desc: '每一星龙羁绊干员（重复只算最高星级）使我方全部干员攻击力 +5%',
      },
    ],
  },

  flying: {
    id: 'flying',
    name: '飞行',
    kind: 'race',
    /*
      ★ 0.2 未改动。两档都写 `airborne` 是**故意的**：
      生效的是最高档，第二档会覆盖第一档；只写第一档的话，
      上满 2 个飞行干员之后"打不到"这条反而消失（越凑越弱）。
    */
    tiers: [
      {
        count: 1,
        effects: [{ type: 'rangeFlat', value: 1 }],
        mechanics: [{ kind: 'airborne', immuneToRangeAtMost: 1 }],
        desc: '飞行单位 +1 格攻击距离；攻击距离为 1 的敌方单位无法攻击飞行单位',
      },
      {
        count: 2,
        effects: [{ type: 'rangeFlat', value: 2 }],
        mechanics: [{ kind: 'airborne', immuneToRangeAtMost: 1 }],
        desc: '飞行单位 +2 格攻击距离；攻击距离为 1 的敌方单位无法攻击飞行单位',
      },
    ],
  },

  // ============================================================
  //  战斗定位
  // ============================================================

  swordsman: {
    id: 'swordsman',
    name: '剑豪',
    kind: 'class',
    /*
      ★ 0.3（用户口径）：**剑士改名为「剑豪」**，档位 3/6/9 改成 **2/4/6**；
      数值下调为 **攻击力 +10/15/25%、攻速 +15/20/30%**，
      连击概率（30/40/60%）与瞬移眩晕（0.5/1/3 秒）这些都**不变**。
      · 人数门槛从 3 降到 2，但单档收益也一并降了 —— 这是配套的平衡：
        "更好凑但更弱"。
      · ★ 原来是剑士的 5 个人（芳汀 / 炎客 / 左乐 / 祐天寺若麦 / 丰川祥子）
        **移到了新羁绊「近卫」**，现在剑豪只剩 6 个成员（正好顶到 6 人档）。

      【和旧版的区别】旧的"每攻击 3 次永久 +X% 攻速（有上限）"整条**删掉了**，
      换成了"直接给攻速 + 概率连击" —— 所以 `attackCounterSpeed` 不再出现在这里。

      ★★ 0.2.2 新增第二条机制（用户点名）：**开启技能时瞬移到血量最少的敌人面前并眩晕**。
        眩晕 0.5 / 1 / 3 秒（= 10 / 20 / 60 tick）。

      ★★ 0.2.2 再追加第三条（用户点名）：「瞬移后羁绊获得的攻击力提升和攻击速度提升效果翻倍，
        2 剑豪不加这个效果」⇒ `blinkDoublesTraitBonus` **只挂在 4 人档和 6 人档**。
        · 「翻倍」翻的是**这一档羁绊给的**那部分（不含藏品/技能），见 skills.ts 的
          `doubleTraitBonusAfterBlink`（按 `x/(1+x)` 折算额外倍率，才是精确的 2 倍）；
        · 本场只生效一次（`UnitState.traitBonusDoubled`）。
        · "面前那一格 / 找不到就最近的位置"由 `findEmptyNear` 的既定口径负责
          （见 `TraitMechanic.onCastBlinkStrike` 的注释），这里只给时长。
        · 判定在 `skills.ts` 的 `castSkill` 里、**在技能效果生效之前** ——
          所以"跳进去再打"：跳过去之后技能本身的索敌是在新位置上算的。
        · 三档都有，只是眩晕时长不同（人数越多跳得越狠）。
    */
    tiers: [
      {
        count: 2,
        effects: [
          { type: 'attackDamageBp', value: 1000 },
          { type: 'attackSpeedBp', value: 1500 },
        ],
        mechanics: [
          { kind: 'probDoubleAttack', chanceBp: 3000 },
          // ★ 0.2.2：开启技能时瞬移到血量最少的敌人面前，眩晕 0.5 秒
          { kind: 'onCastBlinkStrike', stunTicks: 10 },
        ],
        desc: '剑豪 +10% 攻击力、+15% 攻速，每次攻击有 30% 概率触发 2 连击；开启技能时瞬移到生命值最少的敌人面前并使其眩晕 0.5 秒',
      },
      {
        count: 4,
        effects: [
          { type: 'attackDamageBp', value: 1500 },
          { type: 'attackSpeedBp', value: 2000 },
        ],
        mechanics: [
          { kind: 'probDoubleAttack', chanceBp: 4000 },
          // ★ 0.2.2：眩晕 1 秒
          { kind: 'onCastBlinkStrike', stunTicks: 20 },
          // ★ 0.3：瞬移之后，这一档给的那 +15%/+20% 翻倍（2 人档没有这条）
          { kind: 'blinkDoublesTraitBonus' },
        ],
        desc:
          '剑豪 +15% 攻击力、+20% 攻速，每次攻击有 40% 概率触发 2 连击；' +
          '开启技能时瞬移到生命值最少的敌人面前并使其眩晕 1 秒；**瞬移后本档的攻击力与攻速加成翻倍**（每场一次）',
      },
      {
        count: 6,
        effects: [
          { type: 'attackDamageBp', value: 2500 },
          { type: 'attackSpeedBp', value: 3000 },
        ],
        mechanics: [
          { kind: 'probDoubleAttack', chanceBp: 6000 },
          // ★ 0.2.2：眩晕 3 秒
          { kind: 'onCastBlinkStrike', stunTicks: 60 },
          // ★ 0.3：瞬移之后，这一档给的那 +25%/+30% 翻倍
          { kind: 'blinkDoublesTraitBonus' },
        ],
        desc:
          '剑豪 +25% 攻击力、+30% 攻速，每次攻击有 60% 概率触发 2 连击；' +
          '开启技能时瞬移到生命值最少的敌人面前并使其眩晕 3 秒；**瞬移后本档的攻击力与攻速加成翻倍**（每场一次）',
      },
    ],
  },

  /*
    ============================================================
    ★★ 0.3 新羁绊「近卫」（3/4/5 人）
    ============================================================
    人员：芳汀 / 炎客 / 左乐 / 祐天寺若麦 / 丰川祥子
    （五个人原本挂在「剑士」下，0.3 移到这里；剑士同时改名「剑豪」）

    三个档位：攻击力 +5%/10%/25%、吸血 10%/20%/40%、双抗 +10/15/25、
              对**射程 ≥ 3** 的干员伤害提升至 120%/130%/150%。

    【为什么吸血走 `startSelfBuff` 而不是羁绊属性】
    `applyTraitBonuses` 只认“面板四项”（血/攻/护甲/魔抗…），
    吸血不属于基础属性、而是战斗修正包（Mods）里的一项。
    萨卡兹的「全能吸血」就是这么写的（`startSelfBuff` + `passive`）—— 沿用它。
    ★ 这条走的是“每个带这个羁绊的干员各自挂一份”（scope 默认 members），
      所以 `近卫干员吸血 +10%` 就是“近卫自己吸血，别人不吸”。

    【对远程增伤为什么不是新 mechanic】
    它必须在**逐段伤害结算**那个时机乘上去（和 `vsTraitDamageBp` 同一个位置），
    而那个位置读的是 `Mods`。所以它走 `SkillStats.rangeAmp` → `Mods.rangeAmp` 这条现成的修正包通路，
    比新开一个 mechanic 再在 `performAttack` 里另外读一遍要省事得多。
  */
  guard: {
    id: 'guard',
    name: '近卫',
    kind: 'class',
    tiers: [
      {
        count: 3,
        effects: [
          { type: 'attackDamageBp', value: 500 },
          { type: 'armorFlat', value: 10 },
          { type: 'magicResistFlat', value: 10 },
        ],
        mechanics: [
          {
            kind: 'startSelfBuff',
            stats: { lifestealBp: 1000, rangeAmp: { minRange: 3, totalBp: 12000 } },
          },
        ],
        desc:
          '近卫干员攻击力 +5%、吸血 10%、双抗 +10；' +
          '对射程 ≥ 3 的干员伤害提升至 120%',
      },
      {
        count: 4,
        effects: [
          { type: 'attackDamageBp', value: 1000 },
          { type: 'armorFlat', value: 15 },
          { type: 'magicResistFlat', value: 15 },
        ],
        mechanics: [
          {
            kind: 'startSelfBuff',
            stats: { lifestealBp: 2000, rangeAmp: { minRange: 3, totalBp: 13000 } },
          },
        ],
        desc:
          '近卫干员攻击力 +10%、吸血 20%、双抗 +15；' +
          '对射程 ≥ 3 的干员伤害提升至 130%',
      },
      {
        count: 5,
        effects: [
          { type: 'attackDamageBp', value: 2500 },
          { type: 'armorFlat', value: 25 },
          { type: 'magicResistFlat', value: 25 },
        ],
        mechanics: [
          {
            kind: 'startSelfBuff',
            stats: { lifestealBp: 4000, rangeAmp: { minRange: 3, totalBp: 15000 } },
          },
        ],
        desc:
          '近卫干员攻击力 +25%、吸血 40%、双抗 +25；' +
          '对射程 ≥ 3 的干员伤害提升至 150%',
      },
    ],
  },

  arts: {
    id: 'arts',
    name: '法术',
    kind: 'class',
    // "全体友方干员每 5 秒回复…技力" -> 全队光环
    scope: 'team',
    /*
      ★ 0.2：整条换掉了 —— 旧的"法术干员 +攻击力、攻击附带目标最大生命 % 伤害"不再存在。
      新效果 = **全体友方每 5 秒回复 10/15/20% 技力**（档位 2/3/4）。

      `innate` 不是这一档的效果 —— 它是"带术士/法术标签就有"的固有性质，
      这里只留了注释提醒；真正的 innate 挂在 `caster` 上（见下面）。
    */
    tiers: [
      {
        count: 2,
        effects: [],
        mechanics: [{ kind: 'teamManaRegen', intervalTicks: 100, manaBp: 1000 }],
        desc: '全体友方干员每 5 秒回复 10% 的技力',
      },
      {
        count: 3,
        effects: [],
        mechanics: [{ kind: 'teamManaRegen', intervalTicks: 100, manaBp: 1500 }],
        desc: '全体友方干员每 5 秒回复 15% 的技力',
      },
      {
        count: 4,
        effects: [],
        mechanics: [{ kind: 'teamManaRegen', intervalTicks: 100, manaBp: 2000 }],
        desc: '全体友方干员每 5 秒回复 20% 的技力',
      },
    ],
  },

  merchant: {
    id: 'merchant',
    name: '奸商',
    kind: 'class',
    // ★ 0.2：档位 1/2/**3**（新增第三档），每档多 1 金币/人
    tiers: [
      {
        count: 1,
        effects: [],
        mechanics: [{ kind: 'goldPerSurvivor', goldEach: 1 }],
        desc: '回合结束时，每有 1 名未阵亡的奸商干员 +1 金币（同一个干员只算一次）',
      },
      {
        count: 2,
        effects: [],
        mechanics: [{ kind: 'goldPerSurvivor', goldEach: 2 }],
        desc: '回合结束时，每有 1 名未阵亡的奸商干员 +2 金币（同一个干员只算一次）',
      },
      {
        count: 3,
        effects: [],
        mechanics: [{ kind: 'goldPerSurvivor', goldEach: 3 }],
        desc: '回合结束时，每有 1 名未阵亡的奸商干员 +3 金币（同一个干员只算一次）',
      },
    ],
  },

  support: {
    id: 'support',
    name: '支援',
    kind: 'class',
    // 你写的是"提升我方全部干员"，所以是全队光环
    scope: 'team',
    /*
      ★ 0.2：档位 2/4/6/**8**；全队生命上限 +10/10/20/30%；
      开局护盾 = 生命上限的 10/15/15/30%，持续 5/5/10/10 秒；
      并获得护甲 +10/15/15/20%、魔抗 +10/10/10/20%，持续 10 秒。

      ★ 抗性走 `startResist`（按**百分比**，用户确认），
      内核在开局把百分比换算成固定值挂成限时包（见 rules.ts 的 startResist 一段）。
    */
    tiers: [
      {
        count: 2,
        effects: [{ type: 'hpBp', value: 1000 }],
        mechanics: [
          { kind: 'startShield', hpBp: 1000, durationTicks: 100 },
          { kind: 'startResist', armorBp: 1000, magicResistBp: 1000, durationTicks: 200 },
        ],
        desc: '我方全体 +10% 生命上限；开局获得 10% 生命上限的护盾（5 秒），并获得 +10% 护甲与 +10% 魔抗（10 秒）',
      },
      {
        count: 4,
        effects: [{ type: 'hpBp', value: 1000 }],
        mechanics: [
          { kind: 'startShield', hpBp: 1500, durationTicks: 100 },
          { kind: 'startResist', armorBp: 1500, magicResistBp: 1000, durationTicks: 200 },
        ],
        desc: '我方全体 +10% 生命上限；开局获得 15% 生命上限的护盾（5 秒），并获得 +15% 护甲与 +10% 魔抗（10 秒）',
      },
      {
        count: 6,
        effects: [{ type: 'hpBp', value: 2000 }],
        mechanics: [
          { kind: 'startShield', hpBp: 1500, durationTicks: 200 },
          { kind: 'startResist', armorBp: 1500, magicResistBp: 1000, durationTicks: 200 },
        ],
        desc: '我方全体 +20% 生命上限；开局获得 15% 生命上限的护盾（10 秒），并获得 +15% 护甲与 +10% 魔抗（10 秒）',
      },
      {
        count: 8,
        effects: [{ type: 'hpBp', value: 3000 }],
        mechanics: [
          { kind: 'startShield', hpBp: 3000, durationTicks: 200 },
          { kind: 'startResist', armorBp: 2000, magicResistBp: 2000, durationTicks: 300 },
        ],
        desc: '我方全体 +30% 生命上限；开局获得 30% 生命上限的护盾（10 秒），并获得 +20% 护甲与 +20% 魔抗（15 秒）',
      },
    ],
  },

  healing: {
    id: 'healing',
    name: '治疗',
    kind: 'class',
    // ★ 0.2：档位 2/3/4 -> **3/4/5**（数值不变）
    tiers: [
      {
        count: 3,
        effects: [{ type: 'healingBp', value: 2000 }],
        desc: '治疗干员 +20% 治疗效果',
      },
      {
        count: 4,
        effects: [{ type: 'healingBp', value: 3000 }],
        desc: '治疗干员 +30% 治疗效果',
      },
      {
        count: 5,
        effects: [{ type: 'healingBp', value: 5000 }],
        desc: '治疗干员 +50% 治疗效果',
      },
    ],
  },

  defender: {
    id: 'defender',
    name: '重装',
    kind: 'class',
    /*
      ★ 0.2：档位 **3/5/7**；生命上限 +5/10/20%；
      攻击附带自身最大生命值 2/3/5% 的**物理**伤害；
      每 15 秒获得"已损失生命 30/35/50%"的护盾，**护盾存在期间不会再次获得**。
    */
    tiers: [
      {
        count: 3,
        effects: [{ type: 'hpBp', value: 500 }],
        mechanics: [
          { kind: 'onHitDamage', ratioBp: 200, damageType: 'physical', scale: 'selfMaxHp' },
          { kind: 'periodicShield', intervalTicks: 300, missingHpBp: 3000 },
        ],
        desc: '重装干员 +5% 生命上限；攻击附带自身最大生命值 2% 的物理伤害；每 15 秒获得已损失生命 30% 的护盾（有护盾时不获得）',
      },
      {
        count: 5,
        effects: [{ type: 'hpBp', value: 1000 }],
        mechanics: [
          { kind: 'onHitDamage', ratioBp: 300, damageType: 'physical', scale: 'selfMaxHp' },
          { kind: 'periodicShield', intervalTicks: 300, missingHpBp: 3500 },
        ],
        desc: '重装干员 +10% 生命上限；攻击附带自身最大生命值 3% 的物理伤害；每 15 秒获得已损失生命 35% 的护盾（有护盾时不获得）',
      },
      {
        count: 7,
        effects: [{ type: 'hpBp', value: 2000 }],
        mechanics: [
          { kind: 'onHitDamage', ratioBp: 500, damageType: 'physical', scale: 'selfMaxHp' },
          { kind: 'periodicShield', intervalTicks: 300, missingHpBp: 5000 },
        ],
        desc: '重装干员 +20% 生命上限；攻击附带自身最大生命值 5% 的物理伤害；每 15 秒获得已损失生命 50% 的护盾（有护盾时不获得）',
      },
    ],
  },

  leader: {
    id: 'leader',
    name: '领导人',
    kind: 'class',
    // 光环型：一个领导人给全队加成
    scope: 'team',
    // ★ 0.2：数值 +20/+20/+30% -> **+25/+25/+35%**（"恰好 1 名"的条件不变）
    tiers: [
      {
        count: 1,
        effects: [
          { type: 'attackDamageBp', value: 2500 },
          { type: 'hpBp', value: 2500 },
          { type: 'attackSpeedBp', value: 3500 },
        ],
        mechanics: [{ kind: 'soloRequires', exactly: 1 }],
        desc: '我方全体 +25% 攻击力、+25% 生命上限、+35% 攻速（**只有恰好 1 名领导人时生效**，上第 2 个就失效）',
      },
    ],
  },

  cannon: {
    id: 'cannon',
    name: '炮手',
    kind: 'class',
    /*
      ★ 0.2：档位仍是 2/4/6，但**溅射形状从 3×3 方块改成了"周围四格（十字）"**，
      比例从 15/20/40% 改成 **20/30/40%**。
      `splash` 的 `shape` 是 0.2 新加的字段（不写时仍是方块，老数据不受影响）。
    */
    tiers: [
      {
        count: 2,
        effects: [{ type: 'rangeFlat', value: 2 }],
        mechanics: [{ kind: 'splash', ratioBp: 2000, radius: 1, damageType: 'physical', shape: 'cross' }],
        desc: '炮手攻击距离 +2 格；攻击时对目标周围四格的其他敌人造成该次伤害 20% 的物理伤害',
      },
      {
        count: 4,
        effects: [{ type: 'rangeFlat', value: 2 }],
        mechanics: [{ kind: 'splash', ratioBp: 3000, radius: 1, damageType: 'physical', shape: 'cross' }],
        desc: '炮手攻击距离 +2 格；攻击时对目标周围四格的其他敌人造成该次伤害 30% 的物理伤害',
      },
      {
        count: 6,
        effects: [{ type: 'rangeFlat', value: 2 }],
        mechanics: [{ kind: 'splash', ratioBp: 4000, radius: 1, damageType: 'physical', shape: 'cross' }],
        desc: '炮手攻击距离 +2 格；攻击时对目标周围四格的其他敌人造成该次伤害 40% 的物理伤害',
      },
    ],
  },

  caster: {
    id: 'caster',
    name: '术士',
    kind: 'class',
    /*
      ★ 0.2：档位 2/3/4 -> **2/4/6**；攻击距离 +1 格；
      额外攻击 1/2/3 个敌人；
      **普攻造成等同自身攻击力 110/120/150% 的法术伤害**。

      ★★ `innate`：**即使不激活术士羁绊**，带术士标签的干员普攻也造成
      "攻击力 100%" 的法术伤害。它不属于任何档位，所以走 `TraitDef.innate`
      —— 这样"谁有这个固有性质"由数据决定，而不是在 rules.ts 里判断 `traits.includes('caster')`。
      激活之后档位给的 110/120/150% 数值更高，内核取 `attackBp` 最大的那一份。
    */
    innate: [{ kind: 'magicAttack', attackBp: 10000 }],
    tiers: [
      {
        count: 2,
        effects: [{ type: 'rangeFlat', value: 1 }],
        mechanics: [
          { kind: 'extraTargets', count: 1 },
          { kind: 'magicAttack', attackBp: 11000 },
        ],
        desc: '术士攻击距离 +1 格；普攻造成 110% 攻击力的法术伤害；额外攻击 1 个敌人',
      },
      {
        count: 4,
        effects: [{ type: 'rangeFlat', value: 1 }],
        mechanics: [
          { kind: 'extraTargets', count: 2 },
          { kind: 'magicAttack', attackBp: 12000 },
        ],
        desc: '术士攻击距离 +1 格；普攻造成 120% 攻击力的法术伤害；额外攻击 2 个敌人',
      },
      {
        count: 6,
        effects: [{ type: 'rangeFlat', value: 1 }],
        mechanics: [
          { kind: 'extraTargets', count: 3 },
          { kind: 'magicAttack', attackBp: 15000 },
        ],
        desc: '术士攻击距离 +1 格；普攻造成 150% 攻击力的法术伤害；额外攻击 3 个敌人',
      },
    ],
  },

  ranged: {
    id: 'ranged',
    name: '远射',
    kind: 'class',
    /*
      ★ 0.2：档位 3/6/**9**；攻速 +20/35/60%；
      每次攻击永久 +1% 攻速（上限 **+30/50/100%**）。
      上限 / 每次 1% -> maxStacks = 30 / 50 / 100。
    */
    tiers: [
      {
        count: 3,
        effects: [{ type: 'attackSpeedBp', value: 2000 }],
        mechanics: [{ kind: 'rampSpeed', perAttackBp: 100, maxStacks: 30 }],
        desc: '远射干员 +20% 攻速；每次攻击永久 +1% 攻速（上限 +30%）',
      },
      {
        count: 6,
        effects: [{ type: 'attackSpeedBp', value: 3500 }],
        mechanics: [{ kind: 'rampSpeed', perAttackBp: 100, maxStacks: 50 }],
        desc: '远射干员 +35% 攻速；每次攻击永久 +1% 攻速（上限 +50%）',
      },
      {
        count: 9,
        effects: [{ type: 'attackSpeedBp', value: 6000 }],
        mechanics: [{ kind: 'rampSpeed', perAttackBp: 100, maxStacks: 100 }],
        desc: '远射干员 +60% 攻速；每次攻击永久 +1% 攻速（上限 +100%）',
      },
    ],
  },

  /*
    ============================================================
    ★★ 0.2 MujicaAve（阵营）—— 档位 3/5/8（最高档 2026-10-17 从 7 抬到 8）
    ============================================================
    【这一条为什么和别的羁绊长得不一样？】
    它是第一个带「**跨回合玩家资源**」(fever) 的羁绊，所以除了"给成员加属性/机制"，
    还多了一整套回合侧玩法：攒 fever → 布阵时选「保留 / 消耗」→ 消耗了下一场
    全员开局强行放一次技能（窗口内不会被打死）→ 打输按档位退一部分回来。

    【两半参数放在同一条机制里】（`kind: 'fever'`）
      · 战斗侧（内核读）：`onHit` / `onDeal` / `skillDurationTicks`；
      · 回合侧（回合流程读）：`lossMultiplierBp` / `winDecayBp` / `refundBp` /
        `doubleAtRoundEnd` / `thresholds`。
    分开写两张表的话，"3 档到底是多少"就得去两个地方对照 —— 一定会走散。

    【口径（用户 2026-10-16 拍板）】
      · 消耗后那一场**这一场不再获得 fever**（所以"失败 ×1.5"在那场不适用）；
      · 输了返还的是"**上次消耗掉的那一笔**"的 50%/70%/100%；
      · 达标弹窗按**已跨过的最高档**问（低档不再问）；选「保留」则下次布阵还会再问；
      · 野怪回合**不获得 fever、也不判胜负**（所以倍数/扣减/翻倍整场跳过）。
    ★ 回技力只给**成员**（`selfManaRegen`，不是 `teamManaRegen`）；
      攻速走 `effects`（成员型），一样只给成员。
    */
  mujica: {
    id: 'mujica',
    name: 'MujicaAve',
    kind: 'race',
    tiers: [
      {
        count: 3,
        effects: [{ type: 'attackSpeedBp', value: 1500 }],
        mechanics: [
          { kind: 'selfManaRegen', intervalTicks: 20, manaBp: 500 },
          {
            kind: 'fever',
            onHit: 1,
            onDeal: 0,
            skillDurationTicks: 100,
            lossMultiplierBp: 15000,
            winDecayBp: 3000,
            refundBp: 5000,
            thresholds: [100, 300, 500, 1000, 1500, 2000, 3000],
          },
        ],
        desc:
          'MujicaAve 干员每秒回复 5% 技力、攻速 +15%；每次受到攻击 fever +1；' +
          '战斗失败时本场获得的 fever ×1.5；获胜一次损失当前 fever 的 30%；' +
          'fever 达到 100/300/500/1000/1500/2000/3000 时可选择消耗全部 fever，' +
          '使下一场全员开局开启特殊技能（持续 5 秒，期间受到致命伤害不会死亡，结束后技力回满）',
      },
      {
        count: 5,
        effects: [{ type: 'attackSpeedBp', value: 3000 }],
        mechanics: [
          { kind: 'selfManaRegen', intervalTicks: 20, manaBp: 1000 },
          {
            kind: 'fever',
            onHit: 1,
            onDeal: 1,
            skillDurationTicks: 200,
            lossMultiplierBp: 20000,
            winDecayBp: 3000,
            refundBp: 7000,
            thresholds: [100, 300, 500, 1000, 1500, 2000, 3000],
          },
        ],
        desc:
          'MujicaAve 干员每秒回复 10% 技力、攻速 +30%；每次受到攻击与造成伤害 fever +1；' +
          '战斗失败时本场获得的 fever ×2；获胜一次损失当前 fever 的 30%；' +
          'fever 达到 100/300/500/1000/1500/2000/3000 时可选择消耗全部 fever，' +
          '使下一场全员开局开启特殊技能（持续 10 秒，期间受到致命伤害不会死亡，结束后技力回满）',
      },
      {
        /*
          ★ 0.2（用户 2026-10-17）：「mujica 羁绊 7 人口档位，改为 8 人口档激活」。
          最高档从 7 人抬到 8 人 —— 现在的 MujicaAve 有 5 个正统成员，
          + 转职藏品补位也还凑得到，所以门槛抬高是"更难开满"而不是"开不出来"。
          ★ 数值/机制一个字没动，只改门槛。
        */
        count: 8,
        effects: [{ type: 'attackSpeedBp', value: 5000 }],
        mechanics: [
          { kind: 'selfManaRegen', intervalTicks: 20, manaBp: 2000 },
          {
            kind: 'fever',
            onHit: 1,
            onDeal: 1,
            skillDurationTicks: 300,
            lossMultiplierBp: 50000,
            winDecayBp: 0,
            refundBp: 10000,
            doubleAtRoundEnd: true,
            thresholds: [100, 300, 500, 1000, 1500, 2000, 3000],
          },
        ],
        desc:
          'MujicaAve 干员每秒回复 20% 技力、攻速 +50%；每次受到攻击与造成伤害 fever +1，' +
          '回合结束时**本场获得的** fever 翻倍；战斗失败时本场获得的 fever ×5；获胜不再损失 fever；' +
          'fever 达到 100/300/500/1000/1500/2000/3000 时可选择消耗全部 fever，' +
          '使下一场全员开局开启特殊技能（持续 15 秒，期间受到致命伤害不会死亡，结束后技力回满）',
      },
    ],
  },

  // ============================================================
  //  ★ 0.2 新增
  // ============================================================

  unyielding: {
    id: 'unyielding',
    name: '不屈',
    kind: 'class',
    /*
      ★ 0.2 新羁绊（用户 2026-10-17 口径）：
        档位 2/3/5；阵亡时 30%/40%/50% 概率站起来；
        复活后攻速 +20%/+40%/+60%，并**立刻释放一次技能**。

      ★★ 【每次死都掷，但每成功一次概率 -10%】
        用户后来追加：「改成每次死都掷，但是加一个限制，每复活一次复活概率 -10%」。
        所以这里写的 3000/4000/5000 是**第一次**的概率，
        之后由内核按"已经站起来几次"递减 10 个百分点
        （全局常量 `UNYIELDING_CHANCE_DECAY_BP`）：
          · 2 人（30%）：30 → 20 → 10 → 0，最多站起来 **3 次**
          · 3 人（40%）：40 → 30 → 20 → 10 → 0，**4 次**
          · 5 人（50%）：50 → 40 → 30 → 20 → 10 → 0，**5 次**
        概率归零之后不再掷骰（也不白耗随机数）。

      ★★ 和「必定复活」的藏品（M3 茧甲）**不叠加**：
        有茧甲时**先判茧甲**，不屈留到后面那次死再判（用户口径"有必定复活藏品时
        优先判定藏品复活效果"）。实现见 `combat-math.ts` 的 `killUnit`：
        茧甲走 `unit.reborn`，那一段在函数最前面且会 return，所以不屈天然排在它后面。

      ★ 为什么 `effects: []`？这条羁绊一点属性都不加，全是战斗中的机制 ——
        写在 `mechanics` 里（和拉特兰那些一样）。
    */
    tiers: [
      {
        count: 2,
        effects: [],
        mechanics: [{ kind: 'unyielding', chanceBp: 3000, attackSpeedBp: 2000 }],
        desc:
          '不屈干员阵亡时有 30% 概率复活（每复活一次概率 -10%）；' +
          '复活后攻速 +20%，并立刻释放一次技能',
      },
      {
        count: 3,
        effects: [],
        mechanics: [{ kind: 'unyielding', chanceBp: 4000, attackSpeedBp: 4000 }],
        desc:
          '不屈干员阵亡时有 40% 概率复活（每复活一次概率 -10%）；' +
          '复活后攻速 +40%，并立刻释放一次技能',
      },
      {
        count: 5,
        effects: [],
        mechanics: [{ kind: 'unyielding', chanceBp: 5000, attackSpeedBp: 6000 }],
        desc:
          '不屈干员阵亡时有 50% 概率复活（每复活一次概率 -10%）；' +
          '复活后攻速 +60%，并立刻释放一次技能',
      },
    ],
  },
};
