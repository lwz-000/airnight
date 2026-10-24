/**
 * ============================================================
 *  导出「干员总表」—— 阵营 / 职业 / 全部数值 / 技能介绍
 * ============================================================
 *
 * 用法：
 *   node node_modules/tsx/dist/cli.mjs scripts/export-operator-table.ts
 *
 * 产出（都在 `各项数值/` 下）：
 *   · AIRNIGHT-干员总表.xlsx —— 3 张表：干员总表 / 羁绊（阵营·职业） / 说明
 *   · AIRNIGHT-干员总表.md   —— 同样内容的 markdown 表格（方便贴进文档、聊天）
 *
 * 【和 AIRNIGHT-数值总表.xlsx 的区别】
 *   数值总表是"全项目快照"（干员 + 羁绊 + 野怪 + 藏品 + 掉落…十几张表）；
 *   这张专注干员一张表，并且把「阵营 / 职业」拆成两列、把技能**效果明细**
 *   （结构化数据逐条翻成中文）也列出来 —— 给策划对着看用。
 *
 * 【什么时候重跑】改过这几个文件之后：
 *   unit-data.ts（名单/羁绊/费用/射程）· unit-stats.ts（数值）·
 *   skill-data.ts（技能）· trait-data.ts（羁绊档位）
 *
 * ============================================================
 *  ★★ 数值单位（这一节是"别再看错十倍"的关键）★★
 * ============================================================
 *  内核里有两套放大倍数，**同一个数字在两套里差 10 倍**：
 *    · `FIX = 1000`（千分比）—— 血量/伤害/护甲这类"点数"，
 *      以及技能 effect 里的 `power`（伤害/治疗/护盾）= **攻击力或生命上限的千分比**。
 *      例：`heal.power = 300` ⇒ 目标生命上限的 **30%**（是 300/1000，不是 30/1000）。
 *    · `BP = 10000`（万分比）—— 所有 `xxxBp` 字段（加成/减免/溅射比例/概率）。
 *      例：`splash.ratioBp = 1500` ⇒ **15%**；`attackSpeedBp = 3000` ⇒ **+30%**。
 *  下面 `UNIT_OF` 表把每个字段属于哪一套写清楚了；写错就会整套表差 10 倍。
 */
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import {
  SUMMON_DEFS,
  TRAIT_DEFS,
  TRAIT_KINDS,
  TRAIT_MEMBERS,
  UNIT_DEFS,
  playableDefs,
  type SkillEffect,
  type StarValue,
  type UnitDef,
} from '../packages/shared/src/index.js';
// ★ 0.2：护盾时长写 FOREVER_TICKS 的一律显示成"持续到被打光"，
// 判据必须用内核那一个常量（见 mods.ts 的 FOREVER_TICKS）
import { FOREVER_TICKS } from '../packages/shared/src/mods.js';
import { buildXlsx } from './xlsx-write.mjs';

const OUT_DIR = '各项数值';
const OUT_XLSX = `${OUT_DIR}/AIRNIGHT-干员总表.xlsx`;
const OUT_MD = `${OUT_DIR}/AIRNIGHT-干员总表.md`;

type Cell = string | number;
type Row = Cell[];

// ============================================================
//  中文映射（数据里存的是英文枚举，给策划看的表要翻成中文）
// ============================================================
const MANA_LABEL: Record<string, string> = {
  attack: '攻击回复',
  damage: '受击回复',
  auto: '自动回复',
  // ★ 0.2：表格「法力回复」列写「无」的那些
  none: '无',
};

const TARGET_LABEL: Record<string, string> = {
  currentTarget: '当前目标',
  nearestEnemy: '最近的敌人',
  farthestEnemy: '最远的敌人',
  lowestHpEnemy: '血量最低的敌人',
  highestHpEnemy: '血量最高的敌人',
  allEnemies: '全体敌人',
  enemiesInRadius3: '自己周围 3 格的敌人',
  enemiesAroundTarget: '当前目标周围的敌人',
  randomEnemies: '随机几个敌人',
  self: '自己',
  lowestHpAlly: '血量最低的队友',
  /*
    ★★ 0.2：这两个是**百分比**血量（不是绝对值）——
    凯尔希"攻击范围内百分比生命值最低的一名队友"、蕾缪安"优先攻击百分比生命值最低的敌人"。
    它们以前**没登记**，于是导出表里那一格渲染成裸规则名（`→ lowestHpRatioAlly`）——
    当时就是靠这个"不像中文的怪字"才发现 `pickAllyForBuff` 根本没实现这条规则
    （见 rules.ts 里那段说明）。新加 `TargetRule` 记得同步这里。
  */
  lowestHpRatioAlly: '百分比生命值最低的队友',
  lowestHpRatioEnemy: '百分比生命值最低的敌人',
  nearestAlly: '最近的队友',
  randomAlly: '随机一个队友',
  allAllies: '全体队友',
  // ★ 0.2：八幡海铃"攻击范围内的敌人眩晕"—— 跟着**当前射程**走（能被射程加成放大）
  enemiesInRange: '自己攻击范围内的敌人',
};

const KIND_LABEL: Record<string, string> = {
  damage: '造成伤害',
  dot: '持续伤害',
  heal: '治疗',
  healOverTime: '持续治疗',
  shield: '护盾',
  stun: '眩晕',
  buff: '增益',
  debuff: '减益',
  summon: '召唤',
  teleport: '瞬移',
  revive: '复活',
  trap: '陷阱',
  gainMana: '回蓝',
  lockOn: '锁定引爆',
};

const PLACE_LABEL: Record<string, string> = {
  besideSelf: '自己身边的空格',
  besideEnemy: '敌人旁边',
  emptyAroundSelf: '自己周围 8 格的空格',
  randomEmpty: '全场随机空格',
  rangeEdge: '射程最末端',
  randomSpread: '全场随机 N 处',
  /*
    ★ 0.2：望·连星的两个新落点。以前没登记 ⇒ 导出表里渲染成裸规则名
    （`落点besideHighestHpRatioEnemy`），策划看到一串英文。
    `TrapPlace` 以后再加取值，记得同步这里（否则又是同样的一行英文）。
  */
  besideHighestHpRatioEnemy: '攻击范围内百分比生命值最高的敌人身旁',
  besideLowestHpEnemy: '全场生命值最低的敌人身旁',
};

const BASIS_LABEL: Record<string, string> = {
  flat: '固定点数',
  maxHp: '施法者生命上限',
  attack: '施法者攻击力',
  casterMaxHp: '施法者生命上限',
  casterAttack: '施法者攻击力',
  targetMaxHp: '目标生命上限',
  // ★ 0.2：赤刃明霄陈那条"缓慢恢复已损失生命值"用的口径
  missingHp: '目标已损失生命',
};

const DAMAGE_LABEL: Record<string, string> = { physical: '物理', magic: '法术', true: '真实' };
const SHAPE_LABEL: Record<string, string> = { square: '方形', cross: '十字', line: '直线' };

/** 属性字段的中文名 */
const STAT_LABEL: Record<string, string> = {
  attackDamageBp: '攻击力',
  attackSpeedBp: '攻速',
  hpFlat: '生命上限',
  hpBp: '生命上限',
  armorFlat: '护甲',
  armorBp: '护甲',
  armorPenBp: '破甲',
  magicResistFlat: '魔抗',
  magicResistBp: '魔抗',
  rangeFlat: '攻击距离',
  rangeUnlimited: '攻击距离（全场）',
  moveStepFlat: '每次移动格数',
  lifestealBp: '吸血',
  manaGainBp: '法力回复',
  manaPerAttack: '每次普攻回蓝',
  healingBp: '治疗效果',
  allStatsBp: '全部属性',
  invulnerable: '无敌',
  untargetable: '不可被选中',
  immuneHits: '免疫攻击次数',
  evasionBp: '闪避',
  evasionPhysicalBp: '物理闪避',
  evasionMagicBp: '法术闪避',
  splash: '溅射',
  multiHit: '连击段数',
  /*
    ★ 0.2：连击**每段**的伤害比例（万分比）。以前**没登记** ⇒
    导出表里渲染成裸字段名 `multiHitBp 3000 / 3500 / 9000`（6 个干员中招），
    策划看到的是一串内部数字而不是"每段攻击 +30%/35%/90%"。
    凡是 `*Bp` 一律登记成 'bp'，别让它掉进 `UNIT_OF[key] ?? 'flat'` 那个兜底。
  */
  multiHitBp: '每段攻击',
  /*
    ★ 0.2：这两个是**门控/行为开关**（不是数值），以前同样没登记：
      · `minStar`  —— 这份属性只在星级 ≥ N 时生效（予愿安洁莉娜"三星时获得隐匿"）
      · `randomAttackTarget` —— 每次攻击重新随机选目标（维什戴尔）
  */
  minStar: '只在星数 ≥',
  randomAttackTarget: '每次攻击随机选目标',
  extraTargets: '额外攻击目标',
  stunOnHit: '普攻附带眩晕',
  bonusDamage: '附带额外伤害',
  farBonus: '远距离增伤',
  attackHeals: '攻击改为治疗',
  vsTraitDamageBp: '对某类敌人增伤',
  attackHealsRatio: '攻击治疗比例',
  damageTakenBp: '受到的伤害',
  armorPen: '破甲',
  onKillRefresh: '击杀刷新',
  initialManaBp: '开局法力',
  // ★ 0.2：克洛丝 / 芳汀的"每第三次攻击额外造成一次伤害"，以及可露希尔的"每 2 次攻击额外攻击 1 名目标"
  everyNthAttack: '每 N 次攻击',
  noAttack: '不会攻击',
  noMove: '不会移动',
  // ★ 0.2：赤刃明霄陈"技能持续期间不再获得技力"
  noManaGain: '技能期间不获得技力',
  // ★ 0.2：可露希尔"此数值每有 10 金币额外增加 1%，最高上限 5%"
  goldBonusBp: '按金币加成',
  cannotDie: '不会死亡',
  preferLowestHp: '优先打残血',
  damageTypeOverride: '伤害类型改为',
  pulse: '周期脉冲（光环）',
  onAttackAllyBuff: '每 N 次攻击给队友增益',
  allyLowHpGuard: '队友残血救援',
  nearbyEnemyAttackBp: '身边有敌人时加成',
  goldScalingAttackBp: '按金币加成攻击力',
  reflect: '反弹伤害',
  // ★ 0.2：伊内丝"每次攻击使目标攻速减少当前攻速的 X%"
  debuffOnHit: '每次攻击给攻击目标减益',
  // ★ 0.2
  allyTraitRangeFlat: '按场上职业人数加攻击距离',
  attackSpeedLocked: '攻速恒定',
  attackSpeedToAttackRatioBp: '每 1% 攻速折算攻击力',
  onHitDot: '普攻附带的持续伤害',
  onKillExtendTicks: '击杀延长技能',
  onExpireDamage: '技能结束时的伤害',
  // ★ 0.2：Mujica 三人（若麦五连击 / 祥子音符 / 睦锁血）
  attackProfile: '普攻形态',
  defyDeath: '濒死锁血',
  // ★ 0.2：八幡海铃"低存在感"—— 敌人索敌时只要还有别的目标就**最后才**考虑她
  lowPresence: '低存在感（敌人最后才打她）',
};

/** 表现层弹道标记（`attackProfile.fx`）-> 中文。不登记 = 裸英文 id 漏进策划表 */
const ATTACK_FX_LABEL: Record<string, string> = {
  note: '音符',
};

/**
 * 每个字段的**量纲**（和内核的换算一一对应，见文件头的说明）：
 *   bp       万分比（÷10000）—— 显示成 %（÷100），如 1500 -> 15%
 *   permille 千分比（÷1000）—— 显示成 %（÷10）， 如 300  -> 30%
 *   flat     绝对值（点 / 格 / 次 / 段）
 *   ticks    时间（÷20）—— 显示成秒
 *   bool     开关
 *   type     枚举（伤害类型等）
 */
type Unit = 'bp' | 'permille' | 'flat' | 'ticks' | 'bool' | 'type';

const UNIT_OF: Record<string, Unit> = {
  attackDamageBp: 'bp',
  attackSpeedBp: 'bp',
  hpBp: 'bp',
  armorBp: 'bp',
  magicResistBp: 'bp',
  armorPenBp: 'bp',
  lifestealBp: 'bp',
  evasionBp: 'bp',
  evasionPhysicalBp: 'bp',
  evasionMagicBp: 'bp',
  damageTakenBp: 'bp',
  initialManaBp: 'bp',
  healingBp: 'bp',
  allStatsBp: 'bp',
  hpFlat: 'flat',
  armorFlat: 'flat',
  magicResistFlat: 'flat',
  rangeFlat: 'flat',
  moveStepFlat: 'flat',
  multiHit: 'flat',
  multiHitBp: 'bp',
  minStar: 'flat',
  randomAttackTarget: 'bool',
  extraTargets: 'flat',
  immuneHits: 'flat',
  manaPerAttack: 'flat',
  rangeUnlimited: 'bool',
  noAttack: 'bool',
  noMove: 'bool',
  noManaGain: 'bool',
  cannotDie: 'bool',
  untargetable: 'bool',
  preferLowestHp: 'bool',
  invulnerable: 'bool',
  onKillRefresh: 'bool',
  attackSpeedLocked: 'bool',
  attackSpeedToAttackRatioBp: 'bp',
  lowPresence: 'bool',
  damageTypeOverride: 'type',
};

/** StarValue（单值 或 `[1星, 2星, 3星]`）-> 文案。只写两个数时第三个沿用第二个 */
const starText = (value: StarValue, unit: Unit): string => {
  const list = Array.isArray(value) ? value : [value];
  const three = list.length >= 3 ? list.slice(0, 3) : [list[0]!, list[1] ?? list[0]!];
  return three
    .map((n) => {
      switch (unit) {
        case 'bp':
          return `${n >= 0 ? '+' : ''}${n / 100}%`;
        case 'permille':
          return `${n >= 0 ? '+' : ''}${n / 10}%`;
        case 'ticks':
          return `${Math.round((n / 20) * 100) / 100} 秒`;
        default:
          return String(n);
      }
    })
    .join(' / ');
};

const dash = (text: string): string => text || '（无）';

/** 一条或一**组**治疗基准 -> 「+110%（按施法者攻击力） + +3%（按目标生命上限）」 */
function healsText(spec: unknown): string {
  if (!spec) return '（无）';
  const list = (Array.isArray(spec) ? spec : [spec]) as Record<string, unknown>[];
  return list
    .map((h) => `${starText(h.ratioBp as StarValue, 'bp')}（按${BASIS_LABEL[h.basis as string] ?? h.basis}）`)
    .join(' + ');
}

/** 嵌套结构（splash / pulse / reflect…）-> 中文片段 */
function nestedText(key: string, value: unknown): string {
  const v = value as Record<string, unknown>;
  switch (key) {
    case 'bonusDamage': {
      const source =
        v.source === 'maxHp' ? '目标最大生命' : v.source === 'missingHp' ? '目标已损失生命' : '造成的伤害';
      return `${starText(v.ratioBp as StarValue, 'bp')}（按${source}，${DAMAGE_LABEL[v.damageType as string] ?? v.damageType}）`;
    }
    case 'splash': {
      const shape = v.shape ? ` ${SHAPE_LABEL[v.shape as string] ?? v.shape}` : '';
      const basis = v.basis === 'attack' ? '按攻击力' : '按本次伤害';
      const hits = v.hits !== undefined ? `，${starText(v.hits as StarValue, 'flat')} 段` : '';
      return `${starText(v.ratioBp as StarValue, 'bp')}（${v.radius} 格${shape}，${basis}${hits}，${DAMAGE_LABEL[v.damageType as string] ?? v.damageType}）`;
    }
    case 'farBonus':
      return `距离 > ${v.minDistance} 格时 ${starText(v.ratioBp as StarValue, 'bp')}（${DAMAGE_LABEL[v.damageType as string] ?? v.damageType}）`;
    case 'stunOnHit':
      return `概率 ${starText(v.chanceBp as StarValue, 'bp')}，眩晕 ${starText(v.durationTicks as StarValue, 'ticks')}${v.perHit ? '（每段都判）' : ''}`;
    case 'attackHeals':
      /*
        ★ 0.2 修正单位：这里原来写的是 `permille`（÷10），而 `attackHeals.ratioBp`
        本来就是**万分比**（芙蓉写 [1000,1500,2000] = 10%/15%/20%），
        结果导出表里显示成 +100%/+150%/+200%。现在统一按 `bp` 渲染，
        并且支持"多条基准相加"（数组）。
      */
      return healsText(v);
    case 'vsTraitDamageBp':
      return `${TRAIT_DEFS[v.trait as string]?.name ?? v.trait}${v.exclude ? '以外的敌人' : ''} ${starText(v.ratioBp as StarValue, 'bp')}`;
    case 'reflect':
      return `反弹 ${starText(v.ratioBp as StarValue, 'bp')}${v.capAttackBp !== undefined ? `，上限为攻击力的 ${(v.capAttackBp as number) / 100}%` : ''}`;
    case 'nearbyEnemyAttackBp':
      return `${v.radius} 格内有敌人时 ${starText(v.ratioBp as StarValue, 'bp')}`;
    case 'goldScalingAttackBp': {
      /*
        ★ 0.2：`maxGold` = 折算用的金币封顶（策划表 R111 散文列那句
        「当金币达到 100 时达到最大值」）。结构化列里没有这一句 ⇒
        我们会多渲染一段"（金币 100 封顶）"，对账时这一格会显示成差异 ——
        那是**故意多出来的信息**（导出表要说清代码到底怎么算的），不是没做完。
        参照 `reflect` 渲染"上限为攻击力的 X%"的写法。
      */
      const cap = v.maxGold as number | undefined;
      const capText = cap === undefined ? '' : `（金币 ${cap} 封顶）`;
      return `每 ${v.perGold} 金 ${starText(v.ratioBp as StarValue, 'bp')}${capText}`;
    }
    // ★ 0.2：空弦"每上场 2 名 [远射] 干员，攻击距离 +2 格"
    case 'allyTraitRangeFlat':
      return `每上场 ${v.per} 名 [${TRAIT_DEFS[v.trait as string]?.name ?? v.trait}] 干员 攻击距离 ${starText(v.rangeFlat as StarValue, 'flat')} 格`;
    // ★ 0.2：截云"每次攻击给目标附一份持续伤害"
    case 'onHitDot':
      return `${starText(v.power as StarValue, 'permille')} 攻击力/${DAMAGE_LABEL[v.damageType as string] ?? v.damageType}，持续 ${starText(v.durationTicks as StarValue, 'ticks')}，每 ${starText((v.intervalTicks ?? 20) as StarValue, 'ticks')} 一跳`;
    // ★ 0.2：洛洛"技能结束后对目标造成一次…"
    case 'onExpireDamage':
      return `${starText(v.power as StarValue, 'permille')} 攻击力/${DAMAGE_LABEL[v.damageType as string] ?? v.damageType}`;
    case 'pulse': {
      /*
        ★ 0.2：`intervalFromAttackSpeed` 时，间隔不是固定秒数而是"跟着自己的攻速"（夜莺）。
      */
      const every = v.intervalFromAttackSpeed
        ? '按攻击频率'
        : `每 ${starText(v.intervalTicks as StarValue, 'ticks')}`;
      const parts = [every, `${v.radius ?? 2} 格`, v.affect === 'allies' ? '对我方' : '对敌人'];
      if (v.damage) {
        const d = v.damage as Record<string, unknown>;
        parts.push(`伤害 ${starText(d.ratioBp as StarValue, 'bp')}（按${BASIS_LABEL[d.basis as string] ?? '攻击力'}，${DAMAGE_LABEL[d.damageType as string] ?? d.damageType}）`);
      }
      if (v.heal) parts.push(`治疗 ${healsText(v.heal)}`);
      if (v.buff) parts.push(`附带增益：${statsText(v.buff as Record<string, unknown>)}`);
      /*
        ★ 0.2 可露希尔 Q.E.D：脉冲的两条扩展。
        ★ 新加的嵌套字段必须在这里登记，否则会渲染成 `undefined`（见上面的提醒）。
      */
      if (v.rampAfterHits) {
        const r = v.rampAfterHits as Record<string, unknown>;
        parts.push(`第 ${r.hits} 跳之后伤害变为 ${starText(r.ratioBp as StarValue, 'bp')}`);
      }
      if (v.pulseDebuffOnce) {
        const d = v.pulseDebuffOnce as Record<string, unknown>;
        parts.push(
          `对每个目标仅一次：${statsText(d.stats as Record<string, unknown>)}，持续 ${starText(d.durationTicks as StarValue, 'ticks')}`,
        );
      }
      return parts.join('，');
    }
    case 'onAttackAllyBuff': {
      const parts = [`每 ${v.every} 次攻击 → ${TARGET_LABEL[v.target as string] ?? v.target}`];
      if (v.stats) parts.push(`增益：${statsText(v.stats as Record<string, unknown>)}`);
      if (v.heal) parts.push(`治疗 ${healsText(v.heal)}`);
      parts.push(`持续 ${starText(v.durationTicks as StarValue, 'ticks')}`);
      return parts.join('，');
    }
    case 'allyLowHpGuard':
      /*
        ★★ `selfAttackBp` 是 `StarValue`（数据里是 `[12000, 15000, 15000]`），
        **不能**当普通数字整除 100 —— 那样会渲染成 `自身攻击力 +NaN%`
        （数组除以数字 = NaN，而且不会报错、静默进表）。
        凡是 `*Bp` 字段一律走 `starText(..., 'bp')`，它是"万分比 -> %"的唯一出处。
      */
      return `队友血量 < ${((v.thresholdBp as number) / 100).toFixed(0)}% 时瞬移过去给它护盾 ${starText(v.shieldBasisCasterMaxHp as StarValue, 'bp')}，自身攻击力 +${starText(v.selfAttackBp as StarValue, 'bp')}（${starText(v.selfBuffTicks as StarValue, 'ticks')}，每场最多 ${starText(v.maxUses as StarValue, 'flat')} 次）`;
    /*
      ★ 0.2：新加的字段**必须在这里登记**，否则会掉进 `default` 分支、
      被当成普通数值渲染成 `[object Object]`（导出表和界面都会显示成这样）。
      这是"加了字段但没加消费方渲染"的典型翻车方式 —— 和当初"数据表加字段必须确认有消费方"是同一条。
    */
    /*
      ★★ 0.2：伊内丝"每次攻击削目标攻速"。以前这里**没有登记**，
      整格渲染成 `debuffOnHit [object Object]`（导出表里一眼看不出是坏字）。
      现在导出自检会直接把这个拦下来（见文件尾的 `assertCleanRows`）。
    */
    case 'debuffOnHit': {
      // `chanceBp` 不写 = 100% 必中，只有真的不是必中时才把概率写出来
      const chance = (v.chanceBp as StarValue | undefined) ?? 10000;
      const minChance = Array.isArray(chance) ? Math.min(...chance) : chance;
      const parts = ['每 1 次攻击 → 被攻击目标'];
      if (minChance < 10000) parts.push(`${starText(chance, 'bp')} 概率`);
      parts.push(`减益：${statsText(v.stats as Record<string, unknown>)}`);
      parts.push(`持续 ${starText(v.durationTicks as StarValue, 'ticks')}`);
      return parts.join('，');
    }
    case 'everyNthAttack': {
      /*
        ★ 0.2：这条有两个可独立出现的部分 ——
          · `bonusDamage`：额外结算一段伤害（克洛丝 / 芳汀）
          · `extraTargets`：额外攻击几个目标（可露希尔，她**没有** bonusDamage）
        以前只渲染 bonusDamage ⇒ 可露希尔那半会渲染成 `undefined`（`d.ratioBp` 读不到）。
      */
      const parts = [`每 ${v.every} 次攻击`];
      const d = v.bonusDamage as Record<string, unknown> | undefined;
      if (d) {
        const basis = d.source === 'attack' ? '按攻击力' : '按本次伤害';
        parts.push(`额外伤害 ${starText(d.ratioBp as StarValue, 'bp')}（${basis}，${DAMAGE_LABEL[d.damageType as string] ?? d.damageType}）`);
      }
      if (v.extraTargets !== undefined) parts.push(`额外攻击 ${starText(v.extraTargets as StarValue, 'flat')} 名目标`);
      return parts.join('，');
    }
    // ★ 0.2：可露希尔"此数值每有 10 金币额外增加 1%，最高上限 5%"
    case 'goldBonusBp':
      return `每 ${v.perGold} 金币 +${((v.bpPerStep as number) / 100).toFixed(0)}%（上限 +${((v.maxBp as number) / 100).toFixed(0)}%）`;
    /**
      ★ 0.2：若叶睦「多首野兽」的一次性锁血被动。
      `hp / durationTicks / taunt` 三个内部字段**必须**全翻成人话 ——
      漏登记时整格会渲染成 `defyDeath [object Object]`（导出自检会拦下来）。
    */
    case 'defyDeath': {
      const hp = (v.hp as number | undefined) ?? 1;
      const taunt = v.taunt !== false ? '、带嘲讽' : '';
      return `受到致命伤害时不倒下，改为锁 ${hp} 点血 ${starText(v.durationTicks as StarValue, 'ticks')}（期间不能攻击、不能移动${taunt}），每场只触发一次`;
    }
    /**
      ★ 0.2：自定义普攻弹道（若麦"五连击" / 祥子"音符"）。
      `hits[].bp` 是**万分比**（和 `multiHitBp` 同一套），别按千分比渲染。
      段与段之间是"依次结算"（若麦前四段小、第五段大；祥子一段物理一段法术），
      所以渲染成 `A + B + C` 而不是取平均。
    */
    case 'attackProfile': {
      const hits = (v.hits as Record<string, unknown>[] | undefined) ?? [];
      const seg = hits
        .map(
          (h) =>
            `${starText(h.bp as StarValue, 'bp')}${h.damageType ? ` ${DAMAGE_LABEL[h.damageType as string] ?? h.damageType}伤害` : ''}`,
        )
        .join(' + ');
      const parts = [`${hits.length} 段：${seg || '（无）'}`];
      const maxTargets = (v.maxTargets as number | undefined) ?? 1;
      if (maxTargets > 1) parts.push(`最多打 ${maxTargets} 名`);
      if (v.pierceLength !== undefined) parts.push(`直线穿透 ${v.pierceLength} 格`);
      if (v.randomTarget) parts.push('每段重新随机挑目标');
      if (v.fx) parts.push(`弹道：${ATTACK_FX_LABEL[v.fx as string] ?? v.fx}`);
      return parts.join('，');
    }
    default:
      return JSON.stringify(value);
  }
}

const NESTED_KEYS = new Set([
  'bonusDamage', 'splash', 'farBonus', 'stunOnHit', 'attackHeals', 'vsTraitDamageBp',
  'reflect', 'pulse', 'onAttackAllyBuff', 'allyLowHpGuard', 'nearbyEnemyAttackBp', 'goldScalingAttackBp',
  // ★ 0.2：新字段忘了加到这里 = 会被当成普通数字渲染（见 nestedText 里的注释）
  'everyNthAttack',
  // ★ 0.2：空弦"按场上某职业人数加射程"
  'allyTraitRangeFlat',
  // ★ 0.2：截云"普攻附带的持续伤害" / 洛洛"技能结束时的伤害"
  'onHitDot',
  'onExpireDamage',
  // ★ 0.2：可露希尔"每有 10 金币额外增加 1%"
  'goldBonusBp',
  // ★ 0.2：伊内丝"每次攻击削目标攻速"
  'debuffOnHit',
  // ★ 0.2：Mujica —— 自定义普攻弹道 / 一次性锁血（不登记 = 渲染成 [object Object]）
  'attackProfile',
  'defyDeath',
]);

/** 一组属性（buff 的 stats / 技能的 passive）-> 中文一行 */
function statsText(stats: Record<string, unknown> | undefined): string {
  if (!stats || Object.keys(stats).length === 0) return '（无）';
  const parts: string[] = [];
  for (const [key, value] of Object.entries(stats)) {
    if (value === undefined || value === null) continue;
    const label = STAT_LABEL[key] ?? key;
    if (NESTED_KEYS.has(key)) {
      parts.push(`${label} ${nestedText(key, value)}`);
      continue;
    }
    const unit = UNIT_OF[key] ?? 'flat';
    if (unit === 'bool') {
      parts.push(String(value) === 'true' ? label : `${label}（否）`);
      continue;
    }
    if (unit === 'type') {
      parts.push(`${label}${DAMAGE_LABEL[String(value)] ?? String(value)}`);
      continue;
    }
    if (typeof value === 'number' || Array.isArray(value)) {
      parts.push(`${label} ${starText(value as StarValue, unit)}`);
      continue;
    }
    parts.push(`${label} ${String(value)}`);
  }
  return parts.join('，');
}

/** 一条技能效果 -> 中文一行 */
function effectText(effect: SkillEffect): string {
  const e = effect as Record<string, unknown> & { kind: string };
  const parts: string[] = [KIND_LABEL[e.kind] ?? e.kind];
  const target = e.target as string | undefined;
  if (target) parts.push(`→ ${TARGET_LABEL[target] ?? target}`);
  const fallback = e.fallback as string | undefined;
  if (fallback) parts.push(`（目标没了改打 ${TARGET_LABEL[fallback] ?? fallback}）`);

  switch (e.kind) {
    case 'damage': {
      // power 走 FIX（千分比）：220 = 攻击力的 220%
      const area = e.radius ? `范围 ${e.radius} 格${e.shape ? ` ${SHAPE_LABEL[e.shape as string] ?? e.shape}` : ''}` : '单体';
      parts.push(`${starText(e.power as StarValue, 'permille')} 攻击力，${area}，${DAMAGE_LABEL[e.damageType as string] ?? e.damageType}`);
      if (e.hits !== undefined) parts.push(`连击 ${starText(e.hits as StarValue, 'flat')} 次`);
      if (e.knockback !== undefined) parts.push(`击退 ${starText(e.knockback as StarValue, 'flat')} 格`);
      // ★ 0.2：妮芙"主伤害 + 目标周围另一份倍率的伤害"
      if (e.splash) {
        const sp = e.splash as Record<string, unknown>;
        parts.push(
          `并对目标周围 ${sp.radius} 格额外 ${starText(sp.power as StarValue, 'permille')} 攻击力${DAMAGE_LABEL[sp.damageType as string] ?? sp.damageType}`,
        );
      }
      // ★ 0.2：见行者"击退路线上的敌人一并眩晕 + 附伤"
      if (e.pathStun) {
        const ps = e.pathStun as Record<string, unknown>;
        parts.push(
          `击退路线上有敌人时：连同目标一同眩晕 ${starText(ps.durationTicks as StarValue, 'ticks')}` +
            `，路线上的敌人额外受 ${starText(ps.power as StarValue, 'permille')} 攻击力${DAMAGE_LABEL[ps.damageType as string] ?? ps.damageType}`,
        );
      }
      break;
    }
    case 'dot': {
      parts.push(`${starText(e.power as StarValue, 'permille')} 攻击力/${DAMAGE_LABEL[e.damageType as string] ?? e.damageType}`);
      parts.push(`持续 ${starText(e.durationTicks as StarValue, 'ticks')}`);
      if (e.intervalTicks) parts.push(`每 ${starText(e.intervalTicks as StarValue, 'ticks')} 一跳`);
      break;
    }
    case 'heal':
    case 'healOverTime': {
      parts.push(`${starText(e.power as StarValue, 'permille')}（按${BASIS_LABEL[e.basis as string] ?? '施法者攻击力'}）`);
      if (e.kind === 'healOverTime') parts.push(`持续 ${starText(e.durationTicks as StarValue, 'ticks')}`);
      break;
    }
    case 'shield': {
      const flat = e.basis === 'flat';
      parts.push(
        flat
          ? `${starText(e.power as StarValue, 'flat')} 点（固定）`
          : `${starText(e.power as StarValue, 'permille')}（按施法者${
              e.basis === 'missingHp' ? '已损失生命值' : '生命上限'
            }）`,
      );
      // ★ 0.2：左乐/机械师的护盾是"一直存在直到被打光"，时长写 FOREVER_TICKS
      if (e.skillBound) {
        // ★ 0.2 新约能天使："技能结束时，所给予的剩余护盾消失"
        parts.push('持续到技能结束');
      } else if (e.durationTicks !== undefined && (e.durationTicks as number) < FOREVER_TICKS) {
        parts.push(`持续 ${starText(e.durationTicks as StarValue, 'ticks')}`);
      } else {
        parts.push('持续到被打光');
      }
      if (e.decayBpPerSecond !== undefined) {
        parts.push(`每秒衰减 ${starText(e.decayBpPerSecond as StarValue, 'bp')}`);
      }
      if (e.bullets !== undefined) parts.push(`${starText(e.bullets as StarValue, 'flat')} 颗破盾子弹`);
      if (e.noManaWhileActive) parts.push('护盾存在期间无法获得技力');
      // ★ 0.2 新约能天使："技能结束时，所给予的剩余护盾消失"
      if (e.skillBound) parts.push('技能结束即消失');
      const blast = e.breakBlast as
        | { radius: number; shape?: string; power: StarValue; basis?: string; damageType?: string }
        | undefined;
      if (blast) {
        parts.push(
          `破盾时对${SHAPE_LABEL[blast.shape ?? 'square'] ?? ''}${blast.radius} 格敌人造成 ` +
            `${starText(blast.power, 'permille')}（按施法者${blast.basis === 'maxHp' ? '生命上限' : '攻击力'}）的${DAMAGE_LABEL[blast.damageType ?? 'physical'] ?? ''}伤害`,
        );
      }
      break;
    }
    case 'stun':
      parts.push(`眩晕 ${starText(e.durationTicks as StarValue, 'ticks')}`);
      break;
    case 'buff':
    case 'debuff': {
      parts.push(statsText(e.stats as Record<string, unknown>));
      if (e.attacks) {
        parts.push(`接下来 ${e.attacks} 次攻击`);
        // ★ 0.2 新约能天使 3 星："攻击变成五连击并消耗五发弹药"
        if (e.chargesPerAttack) parts.push(`每次攻击消耗 ${e.chargesPerAttack} 发`);
      } else if (e.skillBound) {
        // ★ 0.2 新约能天使："技能结束时，友方减益恢复"——时长由技能决定，不是固定秒数
        parts.push('持续到技能结束');
      } else {
        parts.push(`持续 ${starText(e.durationTicks as StarValue, 'ticks')}`);
      }
      break;
    }
    case 'summon': {
      const summon = SUMMON_DEFS[e.summonId as string];
      parts.push(`召唤 ${summon?.name ?? e.summonId} × ${starText(e.count as StarValue, 'flat')}`);
      parts.push(`落在${PLACE_LABEL[e.place as string] ?? e.place}`);
      parts.push(`存在 ${starText(e.durationTicks as StarValue, 'ticks')}`);
      if (e.max) parts.push(`场上最多 ${e.max} 个`);
      if (e.hp !== undefined) parts.push(`血 ${starText(e.hp as StarValue, 'flat')}`);
      if (e.attackDamage !== undefined) parts.push(`攻击 ${starText(e.attackDamage as StarValue, 'flat')}`);
      break;
    }
    case 'teleport':
      parts.push('瞬移到目标身边');
      break;
    case 'revive':
      parts.push(`复活 ${e.count} 名已阵亡干员${e.star ? `（升到 ${e.star} 星）` : ''}`);
      // ★ 0.2 新约能天使 3 星："并使其回复 100% 的技力"
      if (e.manaBp !== undefined) parts.push(`并回复 ${((e.manaBp as number) / 100).toFixed(0)}% 的技力`);
      break;
    case 'trap': {
      parts.push(`布下 ${e.trapId} × ${starText(e.count as StarValue, 'flat')}`);
      parts.push(`落点${PLACE_LABEL[e.place as string] ?? e.place}`);
      // power 同样走 FIX：按施法者攻击力的千分比
      parts.push(`爆炸 ${starText(e.power as StarValue, 'permille')} 攻击力 ${DAMAGE_LABEL[e.damageType as string] ?? e.damageType}`);
      if (e.radius) parts.push(`范围 ${e.radius} 格`);
      parts.push(`存在 ${starText(e.durationTicks as StarValue, 'ticks')}`);
      break;
    }
    case 'gainMana':
      parts.push(`回蓝 ${e.amount}`);
      break;
    case 'lockOn': {
      // ★ 0.2 蕾缪安 3 星：先记落点、后引爆
      parts.push(`${starText(e.count as StarValue, 'flat')} 颗弹药`);
      parts.push(`每 ${starText(e.intervalTicks as StarValue, 'ticks')} 锁定一名敌人所在的地块`);
      parts.push(`${starText(e.blastTicks as StarValue, 'ticks')} 后一起引爆`);
      parts.push(
        `每颗 ${starText(e.power as StarValue, 'permille')} 攻击力${DAMAGE_LABEL[e.damageType as string] ?? e.damageType}`,
      );
      parts.push(`范围 ${e.radius} 格 ${SHAPE_LABEL[e.shape as string] ?? ''}`.trim());
      break;
    }
    default:
      break;
  }
  return parts.join('，');
}

const effectsText = (effects: readonly SkillEffect[] | undefined): string =>
  effects && effects.length > 0 ? effects.map(effectText).join('；') : '（无）';

/**
 * 技能类型：主动 / 主动(被动) / 被动 / 开局类 / 无主动
 *
 * ★ 0.2：「被动 + 主动」同时存在的棋子（空爆、空弦）在策划表里写作 `主动(被动)`。
 *   以前这里一看到 `effects` 非空就返回 `主动`，于是那些棋子的「被动加成」列
 *   明明有内容、类型列却只写"主动"，对账时被当成差异。现在按表的口径拼出来。
 */
function skillKind(def: UnitDef): string {
  const skill = def.skill;
  if (skill.effects.length > 0) return skill.passive ? '主动(被动)' : '主动';
  if (skill.passive) return '被动';
  if (skill.battleStart && skill.battleStart.length > 0) return '开局类';
  return '无主动';
}

// ============================================================
//  1. 干员总表
// ============================================================
const operatorRows: Row[] = [
  [
    '干员id', '名字', '费用', '射程', '阵营（出身/势力）', '职业（战斗定位）',
    '生命', '攻击', '攻速（次/秒）', '护甲', '魔抗', '每次普攻回蓝',
    '每星生命倍率', '每星攻击倍率',
    '技能名', '技能类型', '法力回复', '技能介绍', '技能效果明细', '被动加成', '开局效果',
    '3星技能名', '3星技能介绍', '3星技能效果明细', '官方charId',
  ],
];

const operators = playableDefs().slice().sort((a, b) => a.id.localeCompare(b.id));
const nameOfTraits = (ids: readonly string[]): string =>
  ids.map((id) => TRAIT_DEFS[id]?.name ?? id).join('、') || '—';

/**
 * 一条干员记录 —— xlsx 和 markdown **都从它派生**。
 *
 * 【为什么不用"数组下标"而是对象？】
 * 第一版是先拼 xlsx 行数组、写 md 时再按位置解构出来 —— 结果加了一列之后
 * 下标整体错位，md 的"技能"列串到"法力回复"上去了。改成对象之后，
 * 加/删列只改这一处，两种输出永远对齐。
 */
interface OperatorRecord {
  id: string;
  name: string;
  cost: number;
  range: number;
  race: string;
  klass: string;
  hp: number;
  attack: number;
  speed: number;
  armor: number;
  magicResist: number;
  manaPerAttack: number;
  starHp: string;
  starDamage: string;
  skillName: string;
  skillKind: string;
  manaSource: string;
  skillDesc: string;
  skillEffects: string;
  passive: string;
  battleStart: string;
  star3Name: string;
  star3Desc: string;
  star3Effects: string;
  charId: string;
}

const records: OperatorRecord[] = operators.map((def) => {
  const race = def.traits.filter((t) => (TRAIT_KINDS[t] ?? 'class') === 'race');
  const klass = def.traits.filter((t) => (TRAIT_KINDS[t] ?? 'class') === 'class');
  const skill = def.skill;
  const star3 = skill.star3;
  return {
    id: def.id,
    name: def.name,
    cost: def.cost,
    range: def.base.range,
    race: nameOfTraits(race),
    klass: nameOfTraits(klass),
    hp: def.base.hp,
    attack: def.base.attackDamage,
    speed: def.base.attackSpeed / 1000,
    armor: def.base.armor,
    magicResist: def.base.magicResist,
    manaPerAttack: def.base.manaPerAttack,
    starHp: `×${def.starHpBp / 1000}`,
    starDamage: `×${def.starDamageBp / 1000}`,
    skillName: skill.name,
    skillKind: skillKind(def),
    manaSource: MANA_LABEL[skill.manaSource] ?? skill.manaSource,
    skillDesc: skill.desc,
    skillEffects: effectsText(skill.effects),
    passive: statsText(skill.passive as Record<string, unknown> | undefined),
    /*
    ★ 0.2：`startManaBp`（开局技力 = 上限的 X%）**不在 `battleStart` 里**，
    以前这一列永远显示"（无）"—— 策划会以为"初始技力"没生效。
    但内核是读它的（`rules.ts` 的 `def.skill.startManaBp`），所以必须报出来。
  */
  battleStart: skill.startManaBp !== undefined
    ? `初始技力为技力上限的 ${skill.startManaBp / 100}%` +
      (skill.battleStart ? `；${effectsText(skill.battleStart)}` : '')
    : effectsText(skill.battleStart),
    star3Name: star3?.name ?? '（无）',
    star3Desc: star3?.desc ?? '（无）',
    /*
      ★ 0.2：3 星的"效果明细"不能只看 `effects` —— 玛恩纳（op47）的 3 星
      **没有 `effects`**，"开局立刻开启技能并持续 100 秒…"整条写在 `battleStart` 里。
      只读 `effects` 的话这一列是「（无）」，策划会以为"3 星没做"
      （和当初 `startManaBp` 导不出来是同一个坑：**同一个意思藏在两个字段里**）。
      `battleStart` / `passive` 有货才追加，其它干员的输出一个字节都不变。
    */
    star3Effects: (() => {
      if (!star3) return '（无）';
      const parts = [effectsText(star3.effects)];
      if (star3.battleStart && star3.battleStart.length > 0) {
        parts.push(`开局：${effectsText(star3.battleStart)}`);
      }
      if (star3.passive) parts.push(`被动：${statsText(star3.passive as Record<string, unknown>)}`);
      return parts.filter((part) => part !== '（无）').join('；') || '（无）';
    })(),
    charId: def.charId ?? '',
  };
});

for (const r of records) {
  operatorRows.push([
    r.id, r.name, r.cost, r.range, r.race, r.klass,
    r.hp, r.attack, r.speed, r.armor, r.magicResist, r.manaPerAttack,
    r.starHp, r.starDamage,
    r.skillName, r.skillKind, r.manaSource, r.skillDesc, r.skillEffects, r.passive, r.battleStart,
    r.star3Name, r.star3Desc, r.star3Effects, r.charId,
  ]);
}

// ============================================================
//  2. 羁绊（阵营 · 职业）
// ============================================================
const traitRows: Row[] = [
  ['羁绊', '类别', '作用范围', '需求人数', '效果说明', '属性加成', '战斗机制', '成员'],
];
const traits = Object.values(TRAIT_DEFS).sort((a, b) => {
  const ka = a.kind === 'race' ? 0 : 1;
  const kb = b.kind === 'race' ? 0 : 1;
  return ka - kb || a.name.localeCompare(b.name);
});
for (const trait of traits) {
  const members = (TRAIT_MEMBERS[trait.id] ?? []).map((id) => UNIT_DEFS[id]?.name ?? id).join('、');
  trait.tiers.forEach((tier, index) => {
    const statLines = (tier.effects ?? [])
      .map((effect) => {
        const type = (effect as { type: string }).type;
        const value = (effect as { value: number }).value;
        const label = STAT_LABEL[type] ?? type;
        const unit: Unit = UNIT_OF[type] ?? (type.endsWith('Bp') ? 'bp' : 'flat');
        const scope = (effect as { scope?: string }).scope === 'team' ? '（全队）' : '';
        if (unit === 'bool') return `${label}${scope}`;
        return `${label} ${starText(unit === 'flat' ? value : value, unit)}${scope}`;
      })
      .join('，');
    traitRows.push([
      index === 0 ? `${trait.name}（${trait.id}）` : '',
      index === 0 ? (trait.kind === 'race' ? '阵营 / 出身' : '职业 / 定位') : '',
      index === 0 ? (trait.scope === 'team' ? '全队受益' : '仅带此标签者') : '',
      `${tier.count} 人`,
      tier.desc,
      dash(statLines),
      (tier.mechanics ?? []).map((m) => (m as { kind: string }).kind).join('，') || '（无）',
      index === 0 ? members : '',
    ]);
  });
}

// ============================================================
//  3. 说明
// ============================================================
const noteRows: Row[] = [
  ['这张表是什么', '所有干员的「阵营 / 职业 / 全部数值 / 技能介绍」一表看完'],
  ['数据来源（改数值改这些文件）', '名单与羁绊：packages/shared/src/unit-data.ts'],
  ['', '基础数值：packages/shared/src/unit-stats.ts（由 docs/干员数值表.xlsx 导入生成，别手改）'],
  ['', '技能：packages/shared/src/skill-data.ts'],
  ['', '羁绊档位：packages/shared/src/trait-data.ts'],
  ['重跑命令', 'node node_modules/tsx/dist/cli.mjs scripts/export-operator-table.ts'],
  ['', ''],
  ['数值单位', '攻速写成「次/秒」；护甲/魔抗减伤 = 抗性 ÷（抗性 + 100）'],
  ['', '★ 技能里的百分比有两套放大倍数，同一个数字差 10 倍，别混：'],
  ['', '   power（伤害/治疗/护盾）走 FIX=1000：300 = 攻击力或生命上限的 30%'],
  ['', '   所有 xxxBp（加成/减免/溅射比例/概率）走 BP=10000：3000 = +30%、1500 = 15%'],
  ['', '本表已经把两套都换算成"人话百分比"，看到的就是游戏里真实生效的数值'],
  ['技能效果明细怎么读', '「造成伤害 → 当前目标，+180% / +240% / +300% 攻击力」：斜杠依次是 1/2/3 星'],
  ['', '「→」后面是选谁当目标；括号里是兜底目标（原目标死了改打谁）'],
  ['阵营 / 职业', '阵营 = 出身·势力（罗德岛/维多利亚/…）；职业 = 战斗定位（重装/远射/术士…）'],
  ['', '一个干员可以同时属于多组（两个阵营/职业都算数，羁绊按人数凑档）'],
  ['3 星技能', '3 星时**完全替换** 1/2 星的技能（不是叠加），所以单独列出'],
  ['彩蛋单位', 'egg_mvm（维维美·绝对主角）是彩蛋：商店极低概率出现，不参与羁绊'],
];

// ============================================================
//  写 xlsx
// ============================================================
if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
const sheets = [
  {
    name: '干员总表',
    rows: operatorRows,
    widths: [8, 14, 6, 6, 18, 18, 7, 7, 11, 6, 6, 11, 10, 10, 18, 8, 9, 46, 62, 34, 30, 20, 46, 50, 20],
    freezeHeader: true,
  },
  { name: '羁绊（阵营·职业）', rows: traitRows, widths: [20, 12, 12, 9, 52, 42, 22, 56], freezeHeader: true },
  { name: '说明', rows: noteRows, widths: [26, 84], freezeHeader: false },
];
// ============================================================
//  ★★ 写文件之前先自检：渲染炸掉的地方**必须报错**，不能静默进表
// ============================================================
/**
 * 导出表的"脏字"自检。
 *
 * 【为什么非要有这一道？】真实踩过：`allyLowHpGuard.selfAttackBp` 是 `StarValue`（数组），
 * 渲染时被当成普通数字除以 100 ⇒ 数组 / 100 = `NaN`，于是策划表里那一格是
 * **`自身攻击力 +NaN%`**，而且**不报错、不告警**，一路写进 xlsx 和 md。
 * 对账时只看"差异行数"根本看不出是渲染坏了还是数据错了。
 *
 * 判据就三条，全是"绝不该出现在成品表里"的东西：
 *   · `NaN`        —— 数组/对象被当数字算过
 *   · `undefined`  —— 字段没登记进 `nestedText`（或键名写错）
 *   · `[object Object]` —— 嵌套对象掉进了 `default` 分支（老毛病了）
 *
 * ★ 0.2 又加了第二类：**内部字段名不许漏进表里**。
 *   同一类翻车换了个样子：字段名是**字符串**而不是对象/数组，所以既不是
 *   `[object Object]` 也不是 `undefined` —— 渲染层掉进 `TARGET_LABEL[k] ?? k`
 *   这类兜底，把 `lowestHpRatioAlly` / `besideHighestHpRatioEnemy` / `multiHitBp`
 *   **原样写给了策划**（6 个干员的"每段攻击"曾显示成 `multiHitBp 5000 / 7000`）。
 *   这类格子里没有脏字，字面看"很正常"，只有仔细读才发现是英文，
 *   而且**每一次都伴随着一个真实的功能缺口**：凯尔希的
 *   `lowestHpRatioAlly` 之所以漏出来，正是因为 `pickAllyForBuff` 根本没实现它。
 *
 *   判据：干员总表的数据行里不该出现 camelCase / snake_case 标识符
 *   （表头与说明表是我们自己写的中文，不扫）。
 *   报错信息里会写清是哪一格 —— 要么补渲染登记，要么（真该给策划看的 id）
 *   加进下面的白名单。
 *
 * 宁可导出失败，也不要导出"看起来正常、其实一格是错的"的表。
 */
/** 允许出现在表里的"非中文标识符"：都是**有意**写给策划看的数据 id */
const IDENTIFIER_ALLOW = [
  /^char_/, // 官方 charId 列（鹰角那边的 id，本来就该原样给策划）
  /^op\d+$/, // 干员 id 列
  /^egg_mvm$/, // 彩蛋单位的干员 id
  /^summon_trap$/, // 陷阱用的召唤物 id —— 策划表自己也是这么写的
  /^(true|false|none)$/,
];
/** 词首判定：`Mon3tr` 里的 `on3tr` 不算一个标识符（前面还接着字母） */
const IDENTIFIER_RE = /(?<![A-Za-z0-9_])[a-z][A-Za-z0-9_]{3,}/g;

function assertCleanRows(sheets: { name: string; rows: Row[] }[]): void {
  const BAD = ['NaN', 'undefined', '[object Object]'];
  const found: string[] = [];
  const leaked: string[] = [];
  for (const sheet of sheets) {
    sheet.rows.forEach((row, rowIndex) => {
      // 只有干员总表的数据行要查标识符（第 0 行是表头，其它两张表是说明/羁绊文字）
      const checkIdentifiers = sheet.name === '干员总表' && rowIndex > 0;
      row.forEach((cell, colIndex) => {
        const text = String(cell ?? '');
        const hit = BAD.find((token) => text.includes(token));
        if (hit) found.push(`  ${sheet.name} 第 ${rowIndex + 1} 行第 ${colIndex + 1} 列：${hit} -> ${text.slice(0, 120)}`);
        if (!checkIdentifiers) return;
        for (const token of text.match(IDENTIFIER_RE) ?? []) {
          if (IDENTIFIER_ALLOW.some((re) => re.test(token))) continue;
          leaked.push(`  ${sheet.name} 第 ${rowIndex + 1} 行第 ${colIndex + 1} 列：${token} -> ${text.slice(0, 120)}`);
        }
      });
    });
  }
  if (found.length > 0) {
    throw new Error(`导出表里有未渲染的字段（${found.length} 处），拒绝写文件：\n${found.join('\n')}`);
  }
  if (leaked.length > 0) {
    throw new Error(
      `导出表里漏出了内部字段名（${leaked.length} 处），拒绝写文件：\n${leaked.join('\n')}\n` +
        '要么在嵌套渲染（nestedText / TARGET_LABEL / PLACE_LABEL …）里登记它，' +
        '要么它真的是要给策划看的 id —— 那就加进 IDENTIFIER_ALLOW。',
    );
  }
}

assertCleanRows(sheets);
writeFileSync(OUT_XLSX, buildXlsx(sheets));
console.log(`已导出 -> ${OUT_XLSX}（${sheets.length} 张表，干员 ${operators.length} 名 / 羁绊 ${traits.length} 个）`);

// ============================================================
//  写 markdown（同一份内容，方便贴文档 / 聊天）
// ============================================================
const mdEscape = (text: Cell): string => String(text).replace(/\|/g, '\\|').replace(/\n/g, ' ');
const md: string[] = [];
md.push('# AIRNIGHT 干员总表（阵营 · 职业 · 数值 · 技能）', '');
md.push(`共 ${operators.length} 名干员（含 1 个彩蛋单位）。数值是 **1 星基础值**，攻速单位是「次/秒」。`, '');
md.push('| 干员 | 费用 | 射程 | 阵营 | 职业 | 生命 | 攻击 | 攻速 | 护甲 | 魔抗 | 回蓝 | 技能 | 技能介绍 |');
md.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const r of records) {
  md.push(
    `| ${mdEscape(r.name)}（${r.id}） | ${r.cost} | ${r.range} | ${mdEscape(r.race)} | ${mdEscape(r.klass)} | ` +
      `${r.hp} | ${r.attack} | ${mdEscape(r.speed)} | ${r.armor} | ${r.magicResist} | ${r.manaPerAttack} | ` +
      `${mdEscape(r.skillName)}（${r.skillKind}·${r.manaSource}） | ${mdEscape(r.skillDesc)} |`,
  );
}
md.push('', '## 3 星技能（到 3 星会**替换**上面那套，不是叠加）', '');
md.push('| 干员 | 3 星技能 | 介绍 |', '|---|---|---|');
for (const r of records) {
  if (r.star3Name === '（无）') continue;
  md.push(`| ${mdEscape(r.name)}（${r.id}） | ${mdEscape(r.star3Name)} | ${mdEscape(r.star3Desc)} |`);
}
md.push('', '## 羁绊一览（阵营 = 出身·势力；职业 = 战斗定位）', '');
md.push('| 羁绊 | 类别 | 作用范围 | 需求人数 | 效果 | 属性加成 |', '|---|---|---|---|---|---|');
for (const row of traitRows.slice(1)) {
  const [name, kind, scope, count, desc, stats] = row;
  md.push(`| ${mdEscape(name)} | ${mdEscape(kind)} | ${mdEscape(scope)} | ${count} | ${mdEscape(desc)} | ${mdEscape(stats)} |`);
}
md.push('');
writeFileSync(OUT_MD, md.join('\n'));
console.log(`已导出 -> ${OUT_MD}（${md.length} 行）`);
