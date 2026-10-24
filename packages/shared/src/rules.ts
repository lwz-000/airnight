import {
  ATTACK_DAMAGE_BP,
  ARENA_W,
  BLOCKED_RETARGET_TICKS,
  BOARD_CELLS,
  BOARD_H,
  BOARD_W,
  BP,
  CELL_EMPTY,
  FIX,
  FORCE_END_TICKS,
  ITEM_SOURCE_ID,
  MAX_BATTLE_TICKS,
  MANA_MAX,
  RAGE_ATTACK_BP,
  RAGE_SPEED_BP,
  RAGE_START_TICKS,
  STAR3_HP_BONUS_BP,
  STAR3_HP_FLAT_BY_COST,
  START_MANA_BY_STAR,
  TICKS_PER_SECOND,
  TIMEOUT_DRAW_MARGIN_BP,
  ZONE_FLASH_TICKS,
} from './constants.js';
import {
  applyShield,
  applyShieldGrant,
  applyStun,
  applyUnitPhase,
  computeChecksum,
  dealDamage,
  emitBuffEvents,
  emitZone,
  addFeverFor,
  feverMechanicOf,
  gainMana,
  healUnit,
  isSkillActive,
  removeSummon,
  shieldGrantOf,
  spawnSummon,
  tickDowned,
  tickShield,
} from './combat-math.js';
import { covenantRightmostChargeShield } from './covenant-data.js';
import { aliveCount, cellDistance, cellIndex, getUnit, isValidPlacement, moveStyleOf, totalHp, totalMaxHp, withinShape } from './field.js';
import { effectiveArmor, effectiveMagicResist, healAmountOf, refreshMaxHp, scaleStats, starValue, FOREVER_TICKS } from './mods.js';
import type { ResolvedAttackProfile } from './mods.js';
import {
  attackInterval,
  canTargetUnit,
  isUntargetable,
  nearestApproachTarget,
  selectReachableTarget,
  selectTarget,
  tickStatuses,
  tryMoveToward,
} from './movement.js';
import {
  addBuff,
  addTimed,
  canCast,
  castSkill,
  collectMods,
  effectiveAttackDamage,
  // ★ 0.2：空弦"按场上 [远射] 人数加射程"的折算（同在 createBattle 里）
  allyTraitRangeFlatOf,
  effectiveAttackSpeed,
  effectiveRange,
  findEmptyNear,
  gainsManaFromAttack,
  // ★ 0.1.4：老鲤金币折算（见 createBattle 里的调用点）
  goldScalingAttackBpOf,
  hasActiveSkill,
  moveUnitTo,
  // ★ 0.2：**队友类**规则的统一入口（不含施法者自己）——
  //   芙蓉的"攻击改为治疗"和凯尔希/耀骑士临光那条"每 N 次攻击给队友增益"都走它，
  //   不再各自实现一遍（见 skills.ts 里 resolveAllyTargets 的说明）。
  resolveAllyTargets,
  resolveTargets,
  skillVariantOf,
  // ★ 0.2.1：施法演出用哪套图（纯表现层，写进 cast 事件的 fx）
  castFxOf,
  tickSkill,
  // ★ 0.2：新约能天使"技能结束时收回挂在队友身上的减益/护盾"（见 tick 循环 1.5）
  tickSkillAttachments,
  doSummon,
} from './skills.js';
import { createRng } from './rng.js';
import type { Rng } from './rng.js';
import { applyTraitBonuses } from './synergies.js';
// ★ 0.2：野怪的全局攻击力系数（"所有小怪野怪 −30%"），只在这一个常量里
import { monsterAttackScaleOf } from './monster-data.js';
// ★ 0.1.1 藏品二版：属性时间线里顺手采一条"状态效果"（见 BattleStatsSample.effects 的说明）
import { activeEffectsOf } from './status-effects.js';
import { resolveSharedItems, resolveWearerItems } from './item-effects.js';
import type { WearerItemEffects } from './item-effects.js';
import type {
  BattleResult,
  BattleState,
  BattleStatsSample,
  Cell,
  DamageType,
  PeriodicEffect,
  ScopedMechanic,
  SkillEffect,
  SplashShape,
  TeamMechanicRuntime,
  TeamSetup,
  // ★ 0.2：队友增益的选目标规则（pickAllyForBuff 的入参）
  TargetRule,
  TraitBonus,
  // ★ 0.3.31：队伍级机制（`teamMechanics` 的签名要用）
  TraitMechanic,
  UnitDef,
  UnitDefTable,
  UnitState,
  UnitStatOverride,
} from './types.js';

/** 星级倍率：每升一星，血量/攻击乘算一次。1000 = 不变 */
export function starMultiplier(star: number, perStarBp: number): number {
  let bp = 1000; // 一星基准
  for (let i = 1; i < star; i++) {
    bp = Math.floor((bp * perStarBp) / 1000);
  }
  return bp;
}

/** 队内排序用的下标 -> 全局唯一 id。1000 起步，留足空间 */
function unitIdFor(team: 0 | 1, index: number): number {
  return team * 1000 + index + 1;
}

/**
 * ★ 0.1.2（测试模式）：把「基础数值覆盖」套进 stats。
 *
 * 【唯一一次"面板单位 -> 内核定点数"的换算就在这里】
 * 面板上填的是 4500 / 1.2 / 3 这种人类数字，内核要的是 4500×FIX、1200。
 * 这个换算**只在这一个函数里做** —— 别在客户端或者别的地方再乘一次 FIX，
 * 那一定会出现"填 4500、实际生效 4.5"这种只有开打才发现的问题。
 *
 * 【只覆盖填了的项】
 * 不填 = 不动（保留白板值）。血量同时改 hp 与 maxHp，
 * 和 applyTraitBonuses 的做法一致（不然会出现"上限改了、当前血没改"的错位）。
 */
function applyStatOverride(
  stats: {
    hp: number;
    maxHp: number;
    attackDamage: number;
    attackSpeed: number;
    armor: number;
    magicResist: number;
    range: number;
  },
  override: UnitStatOverride,
): void {
  /** 只在是有限数时才采用（防止 NaN 顺着界面漏进内核把整场战斗搞崩） */
  const num = (value: number | undefined): number | null =>
    typeof value === 'number' && Number.isFinite(value) ? value : null;

  /*
    ★ 钳制一律在**面板单位**上做，最后才换算成定点数。
    反过来（先乘 FIX 再钳到 1）会得到"1 定点 = 0.001 面板血"这种数值 ——
    场面就是一只 0.001 血的棋子，看着还在、摸一下就没了。
  */
  const fixOf = (value: number, floor: number): number => Math.round(Math.max(floor, value) * FIX);

  const hp = num(override.hp);
  if (hp !== null) {
    const fixed = fixOf(hp, 1);
    stats.hp = fixed;
    stats.maxHp = fixed;
  }
  const atk = num(override.attackDamage);
  if (atk !== null) stats.attackDamage = fixOf(atk, 0);
  const speed = num(override.attackSpeed);
  // 攻速下限给 0.1 次/秒（内核 100）：填 0 会让攻击间隔变成无穷大
  if (speed !== null) stats.attackSpeed = Math.round(Math.max(0.1, speed) * 1000);
  const armor = num(override.armor);
  if (armor !== null) stats.armor = fixOf(armor, 0);
  const mr = num(override.magicResist);
  if (mr !== null) stats.magicResist = fixOf(mr, 0);
  const range = num(override.range);
  // 射程至少 1 格（0 会让近战判定的边界变得很怪）
  if (range !== null) stats.range = Math.max(1, Math.round(range));
}

/**
 * ★ 0.1.2：一枚棋子的「白板属性」—— **基础值 × 星级（+ 3 星质变）**，不含羁绊 / 藏品。
 *
 * ============================================================
 *  【为什么把它单独抽出来？】
 * ============================================================
 * 这个数是**两拨人**都要的：
 *   · 内核 —— `createUnit` 拿它当起点，再往上叠羁绊加成；
 *   · 界面 —— 详情页的 ▲▼ 要拿它当对比基准；测试模式的「数值修改」面板
 *     要拿它当**输入框的初值**（你看到的数字就是你能改的数字）。
 * 以前界面自己照着数据表又算了一遍（`def.base.hp * starMul`），
 * 而它**漏了 3 星质变那部分加血** —— 于是 3 星棋子详情页里的「白板」
 * 永远比实际白板低一截，▲▼ 全是错的。抽出来之后就只有一个算法了。
 *
 * @returns **内核定点单位**（血量/攻速以外的都是 ×FIX；攻速是"千分之一"）。
 *   界面要显示成面板数字就 ÷FIX（攻速 ÷1000），和 previewUnitStats 一样的口径。
 * @param override 测试模式的逐卡覆盖（见 types.ts 的 UnitStatOverride）。
 *   **覆盖在羁绊之前生效** —— 面板改的是白板，羁绊照样叠上去。
 */
export function unitBaseStats(
  def: UnitDef,
  star: number,
  override?: UnitStatOverride,
): {
  hp: number;
  maxHp: number;
  attackDamage: number;
  attackSpeed: number;
  armor: number;
  magicResist: number;
  manaPerAttack: number;
  range: number;
} {
  const hpBp = starMultiplier(star, def.starHpBp);
  const dmgBp = starMultiplier(star, def.starDamageBp);
  /*
    「3 星质变」的额外血量（见 constants.ts 的 STAR3_HP_BONUS_BP）。
    只加生命上限，不加攻击力 —— 加攻击力只会让"能赢的更碾压、输的照样输"，
    加血量才真正改变结局（活到技能打完，才是"一人杀穿一队"）。
  */
  const star3HpBp = star >= 3 ? (STAR3_HP_BONUS_BP[def.cost] ?? 10000) : 10000;
  const hpTotalBp = Math.floor((hpBp * star3HpBp) / 10000);
  /*
    ★ 用户追加要求：3 星 5 费**再加 5000 固定血量**（见 STAR3_HP_FLAT_BY_COST）。

    【为什么是"加一个固定值"而不是把那 5000 折成倍率？】
    翻倍对"血厚的"和"血薄的"效果差一倍 —— 而用户要的是"人人都 +5000"，
    这在一张按费用的表里只能写成绝对值。加的是**生命上限**，不加攻击力
    （和上面那条同一个理由：加血才真正改变"能不能活到技能打完"）。
  */
  const star3HpFlat = star >= 3 ? (STAR3_HP_FLAT_BY_COST[def.cost] ?? 0) : 0;
  const star3HpFlatFix = star3HpFlat * FIX;

  const stats = {
    hp: Math.floor((def.base.hp * FIX * hpTotalBp) / 1000) + star3HpFlatFix,
    maxHp: Math.floor((def.base.hp * FIX * hpTotalBp) / 1000) + star3HpFlatFix,
    attackDamage: Math.floor((def.base.attackDamage * FIX * dmgBp) / 1000),
    attackSpeed: def.base.attackSpeed,
    armor: def.base.armor * FIX,
    magicResist: def.base.magicResist * FIX,
    manaPerAttack: def.base.manaPerAttack,
    // 射程也放进 stats，因为羁绊可以改它（炮手 +2、术士 +1）
    range: def.base.range,
  };

  /*
    ★ 0.1.2（测试模式）：基础数值覆盖（见 types.ts 的 UnitStatOverride）。
    【为什么必须放在这一点、也就是羁绊之前？】
    面板改的是"白板值"，羁绊/藏品是在白板之上做加法。
    覆盖完再叠加成，界面才会是"我填了 4500、吃羁绊显示 5200"这种可解释的结果。
    反过来先叠再加，就等于"覆盖把羁绊吃掉"，越调越乱。
  */
  if (override) applyStatOverride(stats, override);
  return stats;
}

/**
 * 根据定义表创建一枚棋子实例。
 *
 * 【羁绊加成在这里合入 —— 这是整个羁绊系统的落地点】
 * 顺序是：基础值 × 星级倍率，再加羁绊加成（加法）。
 * 战斗循环完全不知道羁绊的存在，它只看到「这个棋子的属性是这个数」。
 * 所以 rules.ts 剩下的部分一行都不用改。
 */
export function createUnit(
  def: UnitDef,
  team: 0 | 1,
  star: number,
  cell: Cell,
  index: number,
  rng: Rng,
  traitBonuses: TraitBonus[] = [],
  statOverride?: UnitStatOverride,
): UnitState {
  // 「基础 × 星级（+ 3 星质变）」这一层 —— 唯一的实现见 unitBaseStats
  const stats = unitBaseStats(def, star, statOverride);

  // 再把羁绊加成加上去（只在有加成时才调用，省一点开销）
  if (traitBonuses.length > 0) {
    applyTraitBonuses(stats, traitBonuses);
  }
  /*
    「治疗效果提升」（支援羁绊）不进属性，而是记成一个状态。
    【为什么？】因为它是**在被治疗那一刻**才用得上的倍率，
    而且它跟着"被治疗的人"走（支援写的是"提升我方全部干员…治疗效果"）。
    记成状态之后，任何来源的治疗都会自动享受到加成 ——
    以后新加的治疗技能/装备都不用改。
  */
  /*
    ★★ 0.3.31：「治疗效果」要分**打出去**还是**吃进来**，两者不是一回事。
      · `healingInBp`  = 全队型（支援）：我方全体**受到**的治疗 +X%
      · `healingOutBp` = 本人型（治疗）：带标签的干员**打出**的治疗 +X%
    以前只有"受治疗"一个状态，于是"治疗"羁绊的 `healingBp` 被静默丢弃 ——
    凑齐了完全没效果，而且不报任何错（用户在 0.3.3 实测反馈）。
    ★ 判据只看 `bonus.scope`：全队型进 `healingBonusBp`，本人型进 `healingOutBp`。
  */
  let healingInBp = 0;
  let healingOutBp = 0;
  /*
    ★ 0.3.31：这两个值要**按范围**分别累计，所以这里必须能看到"这条加成是全队还是本人"。
    `TraitBonus.scope` 就是干这个的（synergies.ts 里填好带过来）。
    没写 scope 的（老数据 / 手工构造）一律当成"受治疗"，和改动前一致。
  */
  const collectHealing = (bonus: TraitBonus): void => {
    if (bonus.scope === 'members') healingOutBp += bonus.value;
    else healingInBp += bonus.value;
  };
  /*
    ★★ 0.2.2 剑士「瞬移后羁绊攻/攻速翻倍」要用：把这一档**羁绊实际给了多少 bp**
    抄一份带走。折进 `stats` 之后就再也看不出"哪部分是羁绊给的"了
    （见 `UnitState.traitBonusBp` 的说明）。
  */
  let traitAttackDamageBp = 0;
  let traitAttackSpeedBp = 0;
  for (const bonus of traitBonuses) {
    if (bonus.effect === 'healingBp') collectHealing(bonus);
    else if (bonus.effect === 'attackDamageBp') traitAttackDamageBp += bonus.value;
    else if (bonus.effect === 'attackSpeedBp') traitAttackSpeedBp += bonus.value;
  }

  const unit: UnitState = {
    id: unitIdFor(team, index),
    team,
    defId: def.id,
    star,
    cell: { col: cell.col, row: cell.row },
    hp: stats.hp,
    maxHp: stats.maxHp,
    baseMaxHp: stats.maxHp,
    // 开局自带的法力按星级给（见 constants.ts 的 START_MANA_BY_STAR）
    /*
      ★ 0.1.3：`startManaBp` 优先 —— "左手"的被动「入场时立刻开启一次技能」
      就是"开局技能条拉满"。不写就还是按星级那份默认初始法力。
    */
    mana:
      def.skill.startManaBp !== undefined
        ? Math.min(
            MANA_MAX,
            Math.floor((MANA_MAX * starValue(def.skill.startManaBp, star)) / 10000),
          )
        : (START_MANA_BY_STAR[Math.max(1, Math.min(3, Math.floor(star)))] ?? 0),
    // 法力从哪来是**按棋子定的**（你给的三种：攻击回复/受击回复/自动回复）
    manaSource: def.skill.manaSource,
    manaPerSecond: def.skill.manaPerSecond ?? 0,
    armor: stats.armor,
    magicResist: stats.magicResist,
    attackDamage: stats.attackDamage,
    attackSpeed: stats.attackSpeed,
    // 注意：射程取的是**加成之后**的值（炮手/术士的射程加成走这里）
    range: stats.range,
    // 开局给每枚棋子一个很小的随机延迟（0~4 tick）。
    // 两个作用：
    //   1. 让「随机种子」真正参与战斗 —— 否则所有技能都是确定数值，
    //      种子就形同虚设，等于每局战斗一模一样
    //   2. 避免所有棋子在同一个 tick 集体出手，观感会自然很多
    nextActionTick: rng.nextInt(5),
    moveCooldown: 0,
    blockedTicks: 0,
    prevCell: null,
    targetId: CELL_EMPTY,
    statuses: {
      manaPerAttack: stats.manaPerAttack,
      ...(healingInBp > 0 ? { healingBonusBp: healingInBp } : {}),
      ...(healingOutBp > 0 ? { healingOutBp } : {}),
    },
    isSummon: false,
    damageDealt: 0,
    // ★ 0.2.2 剑士：记下"羁绊给了多少 bp"，瞬移翻倍时按它折算（0 就不写，省内存）
    ...(traitAttackDamageBp > 0 || traitAttackSpeedBp > 0
      ? { traitBonusBp: { attackDamageBp: traitAttackDamageBp, attackSpeedBp: traitAttackSpeedBp } }
      : {}),
    dead: false,
    // 二阶段「重生」（只有野怪有）。抄一份到运行时，战斗内核不再回头查表
    ...(def.reborn ? { reborn: { ...def.reborn }, rebornUsed: false } : {}),
  };

  /*
    ★★ 0.2（用户口径）：野怪攻击力下调，**只降「小怪」这一档**
    （源石虫 / 猎狗 / 士兵 / 隐形弩手；其余档位一律原样）。

    ★ 位置很讲究：必须在下面 `phaseBase` 快照**之前**。
      多阶段野怪（杰斯顿 / 博卓卡斯替 / 奎隆）切阶段时是**从 phaseBase 重算**的，
      放在快照之后就等于"一进二阶段攻击力悄悄涨回原值"——数值对不上还查不出来。
    ★ 只改攻击力这一项：血量/双抗/攻速都不动。
    ★ 「哪几档吃倍率」的唯一出处是 `monsterAttackScaleOf`（monster-data.ts），
      这里**不许**自己写档位判断。
  */
  if (def.monsterOnly) {
    const attackScale = monsterAttackScaleOf(def.monsterTier);
    if (attackScale !== 10000) {
      unit.attackDamage = Math.floor((unit.attackDamage * attackScale) / BP);
    }
  }

  /*
    技能的被动 + 运行时容器。
    ★ 这里是「3 星专属技能替换掉 1/2 星技能」这条规则的落地点：
    开战时按星级解析一次，之后战斗循环读到的就永远是"这个星级该有的那一套"。
  */
  unit.skillPassive = skillVariantOf(def, star).passive;
  unit.skill = {
    buffs: [],
    immuneHits: 0,
    pulseTimer: 0,
    pulseHits: 0,
    pulseDebuffed: [],
    timed: [],
    guardUses: 0,
    attackCount: 0,
    version: 0,
    manaAccum: 0,
  };
  // 被动里带血量上限的（玛恩纳 +1000）要在开局就生效
  if (unit.skillPassive?.hpFlat !== undefined || unit.skillPassive?.hpBp !== undefined) {
    refreshMaxHp(unit);
    unit.hp = unit.maxHp;
  }

  /*
    ★ 0.0.3：多阶段野怪（杰斯顿 / 博卓卡斯替 / 奎隆）。
    这里只**记下基础形态**——真正套"一阶段覆盖"要等 createBattle 把
    羁绊/藏品的机制挂上去之后（applyUnitPhase 会重建那份机制列表）。
  */
  if (def.reborn && (def.reborn.phase1 || def.reborn.phase2)) {
    const variant = skillVariantOf(def, star);
    unit.phase = 1;
    unit.phaseBase = {
      range: unit.range,
      attackDamage: unit.attackDamage,
      attackSpeed: unit.attackSpeed,
      armor: unit.armor,
      magicResist: unit.magicResist,
      baseMaxHp: unit.baseMaxHp,
      passive: unit.skillPassive,
      effects: variant.effects,
      skillName: variant.name,
      manaSource: unit.manaSource,
      manaPerSecond: unit.manaPerSecond,
    };
  }

  return unit;
}

/**
 * 创建一场战斗的初始状态。
 *
 * @param defs  棋子定义表
 * @param teams 双方阵容
 * @param seed  随机种子。服务器生成并广播 —— 所有客户端用同一个种子能算出完全一样的过程
 */
export function createBattle(defs: UnitDefTable, teams: [TeamSetup, TeamSetup], seed: number): BattleState {
  const units: UnitState[] = [];
  // 必须用 BOARD_CELLS 而不是写死数字 ——
  // 棋盘尺寸是可配置的（constants.ts 里的 ARENA_W/ARENA_H），
  // 写死一个数就会在改尺寸时静默出错（数组下标越界，格子找不到棋子）
  const cellToUnit = new Array<number>(BOARD_CELLS).fill(CELL_EMPTY);

  // 先创建随机数发生器 —— 后面每个棋子的出手延迟都要从这里取，顺序固定 => 确定性
  const rng = createRng(seed);

  /*
    ★ 0.0.3：每个棋子身上的 A 类藏品效果，按 unitId 记一份。
    创建时算一次，后面"挂机制"和"应用开局效果"两步还要用，避免重复解析。
  */
  const wearerEffects = new Map<number, WearerItemEffects>();
  /*
    ★ 0.0.3 藏品（B 类）：队伍级的"进行时"机制，每队一份。
    例：奇缘面具的全队减伤、急救药箱的周期回血。
    它们**不能**挂在单个棋子上 —— 那样 8 个干员会各触发一次。
  */
  const teamMechanics: [TeamMechanicRuntime[], TeamMechanicRuntime[]] = [[], []];

  for (const setup of teams) {
    /*
      ★ 0.0.3 藏品（B 类）：共享藏品的**属性加成**在这里并进来。

      【为什么必须在 createBattle 里并，而不是让调用方并？】
      因为"要并哪些加成"要看**玩家的场外状态**（有多少金币、还剩多少血）
      和**本队上场的棋子**（费用多少、射程多远）—— 只有拿到完整 TeamSetup 的
      这一层才同时具备这两样。放在客户端的话，联机时服务端重建的 TeamSetup
      就没有这些加成了（服务端根本不知道玩家有多少金币）。
      并进来的时机也很关键：必须在 createUnit **之前** ——
      `applyTraitBonuses` 是在 createUnit 里跑的，晚一步就一点效果都没有。
    */
    const sharedEffects = resolveSharedItems(
      setup.sharedItems,
      setup.units,
      defs,
      {
        gold: setup.playerContext?.gold ?? 0,
        hp: setup.playerContext?.hp ?? 100,
        round: setup.round ?? 1,
        itemState: setup.itemState,
        // ★ 0.2：逐副本层数（两个同款共享藏品各叠各的）
        itemLayers: setup.sharedItemLayers,
      },
    );
    teamMechanics[setup.team] = sharedEffects.teamMechanics.map((mechanic) => ({ mechanic, timer: 0 }));

    /*
      ★ 0.2：先数一遍"本队场上每个 trait 各有多少人"（**含自己**）。
      空弦的被动「每上场 2 名 [远射] 干员，攻击距离 +2 格」要按这个折算，
      而它是**队伍级**信息 —— `collectMods` 只看得到单个棋子，所以只能在这里数。
      数完立刻烘成固定值，之后中途死人也不影响（开局属性的直觉）。
    */
    const teamTraitCount = new Map<string, number>();
    for (const placement of setup.units) {
      for (const trait of defs[placement.defId]?.traits ?? []) {
        teamTraitCount.set(trait, (teamTraitCount.get(trait) ?? 0) + 1);
      }
    }

    let index = 0;
    for (const placement of setup.units) {
      const def = defs[placement.defId];
      if (!def) throw new Error(`未知棋子: ${placement.defId}`);

      if (!isValidPlacement(setup.team, placement.cell)) {
        throw new Error(`棋子 ${def.id} 放错半场了: (${placement.cell.col},${placement.cell.row})`);
      }
      const slot = cellIndex(placement.cell.col, placement.cell.row);
      if (cellToUnit[slot] !== CELL_EMPTY) {
        throw new Error(`格子重复占用: (${placement.cell.col},${placement.cell.row})`);
      }

      // 羁绊加成有两个来源：
      //   1. 全队型（setup.traitBonuses）—— 所有人都吃
      //   2. 本人型（setup.unitTraitBonuses[defId]）—— 只有带这个标签的棋子吃
      // 藏品的共享加成也转成了同一种形状（见 item-effects.ts 的 statsToBonuses）。
      // 顺序固定（先全队后本人、先羁绊后藏品），保证同样的输入永远得到同样的属性
      const bonuses: TraitBonus[] = [
        ...(setup.traitBonuses ?? []),
        ...(setup.unitTraitBonuses?.[def.id] ?? []),
        ...sharedEffects.teamBonuses,
        ...(sharedEffects.unitBonuses[def.id] ?? []),
      ];
      const unit = createUnit(
        def,
        setup.team,
        placement.star,
        placement.cell,
        index,
        rng,
        bonuses,
        // ★ 0.1.2 测试模式：这张卡的基础数值覆盖（正常对局是 undefined）
        placement.statOverride,
      );

      /*
        ★ 0.1.4：老鲤「财可通神」—— "每拥有 10 枚金币，攻击力 +10%/15%/15%"。

        【为什么在这里烘死，而不是留在 collectMods 里现算？】
        `collectMods` 拿不到"玩家有多少金币"（那是场外状态，只在 TeamSetup 上），
        而这个被动**数据表里写了、类型里也声明了、却谁都没消费** ——
        于是老鲤（effects 为空 = 纯被动）在场上是一块白板。

        折算结果挂成一个 **`passive: true` 的常驻修正包**：
          · 走的是和藏品完全一样的那条路（addBuff → collectMods → mergeStats），
            攻击力/攻速/吸血那一套计算一行都不用改；
          · `passive: true` 是必须的 —— 否则会被 `isSkillActive` 当成"技能生效中"，
            老鲤一辈子回不了蓝（藏品也踩过这个坑）。
        */
      const goldScalingBp = goldScalingAttackBpOf(
        unit.skillPassive,
        placement.star,
        setup.playerContext?.gold ?? 0,
      );
      if (goldScalingBp > 0) {
        addBuff(unit, {
          stats: { attackDamageBp: goldScalingBp },
          ticksLeft: FOREVER_TICKS,
          sourceId: unit.id,
          passive: true,
        });
      }

      /*
        ★ 0.2：空弦「每上场 2 名阵营为 [远射] 的干员，攻击距离 +2 格」。
        和上面老鲤那条同一个套路（队伍级信息 ⇒ 开局烘成常驻包，
        `passive: true` 也不能少，否则她会永远"技能生效中"、一点蓝都回不上）。
      */
      const traitScaling = unit.skillPassive?.allyTraitRangeFlat;
      if (traitScaling) {
        const rangeFlat = allyTraitRangeFlatOf(
          unit.skillPassive,
          placement.star,
          teamTraitCount.get(traitScaling.trait) ?? 0,
        );
        if (rangeFlat > 0) {
          addBuff(unit, {
            stats: { rangeFlat },
            ticksLeft: FOREVER_TICKS,
            sourceId: unit.id,
            passive: true,
          });
        }
      }

      /*
        ★ 0.0.3 藏品（A 类）：把装备在这枚棋子身上的藏品就地挂上去。

        【为什么在这里逐个棋子处理，而不是像羁绊那样按 defId 批量加？】
        因为藏品是按**棋子实例**装备的：同名干员可能一个装了双模机械臂、
        一个没装。按 defId 批量加会让没装的那个白嫖到加成。
        逐个 placement 处理，从根上就没有这个问题。

        属性的落法：**每件藏品挂一个"永久"修正包**。
        这样 collectMods 那套（攻击/血量/护甲/魔抗/吸血/攻速…）一行都不用改，
        而且"哪件藏品贡献了多少"天然可查。
      */
      if (placement.items && placement.items.length > 0) {
        // ★ 0.2：把"这一枚棋子身上每件藏品各自的层数"一起传下去（同下标）
        const effects = resolveWearerItems(def, placement.items, setup.itemState, placement.itemLayers);
        wearerEffects.set(unit.id, effects);

        for (const stats of effects.statsList) {
          // passive: 这是"常驻属性包"，不是技能效果 —— isSkillActive 要跳过它
          // （不然穿过藏品的棋子永远在"技能生效中"，一点蓝都回不上，技能放不出来）
          addBuff(unit, { stats, ticksLeft: FOREVER_TICKS, sourceId: unit.id, passive: true });
        }
        // 改了血量上限的（歌利亚头盔 +500、天马之盔 +1000/+30%）要顺手顶满当前血量。
        // 和 createUnit 里处理 skillPassive.hpFlat 的做法保持一致 ——
        // 不然会看到"上限涨了但血条还是原来那么长"。
        if (effects.statsList.length > 0) {
          refreshMaxHp(unit);
          unit.hp = unit.maxHp;
        }
        // 治疗效果提升：healUnit 读的就是这个状态，直接写进去即可（运行时零开销）
        if (effects.healingBp > 0) {
          unit.statuses['healingBonusBp'] = (unit.statuses['healingBonusBp'] ?? 0) + effects.healingBp;
        }
        /*
          ★ 0.3.2「迅捷作战粮」：技力回复提升。同样写进状态，
          由 `gainMana`（三条回蓝路的唯一入口）在乘算点读它 —— 运行时零额外开销。
        */
        if (effects.manaGainBp > 0) {
          unit.statuses['manaGainBonusBp'] = (unit.statuses['manaGainBonusBp'] ?? 0) + effects.manaGainBp;
        }
        // 阵亡重生一次（M3茧甲）：复用野怪那套 reborn ——
        // 它是唯一挡在"标记死亡"之前的复活点，不会留下半死状态。
        // 野怪本来就有 reborn 的不覆盖（野怪的二阶段优先）。
        if (effects.revive && !unit.reborn) {
          unit.reborn = { hpBp: effects.revive.hpBp, desc: effects.revive.desc };
          unit.rebornUsed = false;
        }
      }

      cellToUnit[slot] = unit.id;
      units.push(unit);
      index++;
    }
  }

  // 按 id 升序 —— 这是「确定性」的第一道保险：处理顺序永远一致
  units.sort((a, b) => a.id - b.id);

  /*
    把羁绊的**战斗中机制**挂到棋子上。
    【为什么要这么做？】
    战斗循环里每一步都要问"这个棋子有没有某个机制"。
    如果每次都回查羁绊表、数标签、算档位，既慢又容易把"谁受益"算错。
    开战时一次性解析好、挂在棋子上，战斗循环只读这里 ——
    **主循环完全不需要知道任何羁绊的名字**。
    机制列表在创建时从两个队伍的 setup 里取（联机时它跟着阵容广播）。
  */
  for (const unit of units) {
    const setup = teams.find((item) => item.team === unit.team);
    const mechanics = setup?.unitMechanics?.[unit.defId] ?? [];
    /*
      ★ 0.0.3：这枚棋子自己的**藏品机制**也挂在这里。
      和羁绊机制同一个数组、同一个类型 —— 战斗循环读的时候不需要区分来源，
      但 tagMechanic 会给它们打上 `item_xxx` 的标记，方便排查。
    */
    const itemMechanics = wearerEffects.get(unit.id)?.mechanics ?? [];
    /*
      ★ 0.0.3：野怪数据表自带的机制（嘲讽 / 残血增伤 / 成对光环…）。
      它们是"与阶段无关"的一层 —— 换阶段时不会被动摇（要换的写在
      reborn.phase1/phase2.mechanics 里）。
    */
    const defMechanics = defs[unit.defId]?.mechanics ?? [];
    const baseMechanics = [...mechanics, ...itemMechanics, ...defMechanics];
    unit.prePhaseMechanics = baseMechanics;
    unit.trait = {
      mechanics: [...baseMechanics],
      attackCount: 0,
      speedStacks: 0,
      bonusAttackSpeedBp: 0,
      surgeSpeedBp: 0,
      surgeAttackBp: 0,
      surgeTicks: 0,
      surgeUsed: false,
      lastNukeAt: 0,
      periodicTimers: [],
    };
    /*
      嘲讽（游击队盾卫）：开战直接挂上。
      表里写的是"每 10 秒强制周围 3 格干员改打自己"，用户确认按**常驻**处理 ——
      所以直接是一个永久标记，不需要每 10 秒刷一遍。
    */
    for (const mechanic of defMechanics) {
      if (mechanic.kind !== 'taunt') continue;
      unit.taunt = true;
      unit.tauntRadius = mechanic.radius;
    }
  }

  /*
    ★ 0.0.3：套"一阶段"覆盖。
    必须在上面那个循环**之后** —— applyUnitPhase 会重建 unit.trait.mechanics，
    早一步执行的话那段重建就会把刚挂好的羁绊/藏品机制抹掉。
  */
  for (const unit of units) {
    if (!unit.phaseBase) continue;
    applyUnitPhase(unit, 1);
    // 开战满血（一阶段可能改了生命上限）
    unit.hp = unit.maxHp;
  }
  // trait 的机制数量定下来了，给周期类机制各开一个计时器
  for (const unit of units) {
    if (unit.trait) unit.trait.periodicTimers = new Array(unit.trait.mechanics.length).fill(0);
  }

  /*
    ★ 0.0.3 藏品（B 类）：队伍级的"进行时"机制已经在上面那个循环里装好了
    （`teamMechanics[setup.team]`）—— 它必须和"并属性加成"用同一个 sharedEffects，
    分成两处算的话就会因为参数不同而算出两套结果。
  */

  const state: BattleState = {
    rng,
    seed,
    defs,
    units,
    cellToUnit,
    nextSummonId: 1,
    log: [],
    tick: 0,
    over: false,
    winner: null,
    nukeAttackCount: [0, 0],
    nukeLastAt: [0, 0],
    // ★ 0.2：可露希尔的技能按金币加成（"每有 10 金币额外增加 1%，最高 5%"）。
    // 金币在战斗中不会变，所以开局按队伍灌一次就够了。
    playerGold: [teams[0]?.playerContext?.gold ?? 0, teams[1]?.playerContext?.gold ?? 0],
    teamMechanics,
    // ★ 0.2 MujicaAve：本场每队攒到的 fever，从 0 开始（见 BattleState.feverGained）
    feverGained: [0, 0],
    // ★ 0.3 盟约「命结之秘」：每队各有 2 次"阵亡即复活"的额度（见 BattleState.covenantRevives）
    covenantRevives: [0, 0],
    covenantIds: [teams[0]?.covenantId, teams[1]?.covenantId],
  };

  /*
    ============================================================
    ★★ 0.2 MujicaAve：消耗 fever 之后的那一场 —— 「特殊技能」
    ============================================================
    `setup.feverSkill` 有值 = 这位玩家上一回合布阵时选择了「消耗 fever」。
    要做三件事（用户的注意事项 3：「开局就放，多获得免死效果，其他效果和普通技能一致。
    结束后会立刻回满技能条一次」）：

      1. **免死窗口**：挂一条 `cannotDie` 修正包，时长 = 档位给的 5/10/15 秒。
         ★ 复用 `cannotDie` 而不是新写一个判据 —— 全仓库只有 `dealDamage` 里
           那一处判"这一下打不死"（魔王 3 星也走它），新开一条就必然走散。
      2. **立刻放一次它自己的技能**：效果和普通技能完全一致（`skillVariantOf`），
         只是不经过"攒够技力"这一步。★ 技能本身的时长仍按数据走 ——
         5/10/15 秒约束的是**免死窗口**，改技能时长会连带改掉它的增伤倍率窗口。
      3. **窗口到点回满技力**：用一个**绝对 tick** 记着（`feverSkillUntilTick`），
         到点在 `tickFeverWindows` 里回一次满技力。
         ★ 为什么不挂在"修正包到期"那个回收点？因为包可能被顶掉、棋子也可能中途阵亡，
           而"结束回满"是个一次性动作，漏跑一次玩家就少一次技能 —— 用 tick 比对最稳。

    ★ 谁能吃到：**带 fever 机制**的棋子（= 该玩家场上所有 MujicaAve 干员）。
    */
  for (const setup of teams) {
    if (!setup.feverSkill) continue;
    const duration = Math.max(1, Math.floor(setup.feverSkill.durationTicks));
    for (const unit of units) {
      if (unit.team !== setup.team || unit.dead) continue;
      if (!feverMechanicOf(unit)) continue;
      addBuff(unit, {
        stats: { cannotDie: true },
        ticksLeft: duration,
        sourceId: unit.id,
      });
      const def = defs[unit.defId];
      const effects = def ? skillVariantOf(def, unit.star).effects : [];
      if (effects.length > 0) castSkill(state, unit, `${unit.defId}_skill`, [...effects], defs, def ? castFxOf(def, unit.star) : undefined);
      unit.feverSkillUntilTick = state.tick + duration;
    }
  }

  // 开局事件
  for (const unit of state.units) {
    state.log.push({
      type: 'spawn',
      t: 0,
      unitId: unit.id,
      team: unit.team,
      defId: unit.defId,
      star: unit.star,
      cell: { ...unit.cell },
      maxHp: unit.maxHp,
    });
  }

  // 羁绊的"开局类"机制（护盾 / 全队光环 / 血最高者加成 / 三星计数）
  applyStartOfBattleMechanics(state, defs, teams);

  /*
    ★★ 0.3.1 盟约的"开局类"效果（桑葚「药枚实验」：标记最右一列的单位）。
    放在羁绊之后：它只看**站位**，和属性无关，顺序上放最后最不容易互相干扰。
  */
  applyCovenantBattleStart(state);

  /*
    ★ 0.0.3 藏品：B 类藏品的"开局类"机制。
    只做两件：
      · 迷迭香之拥：开局把**敌方全体**的双抗砍掉 25%
      · 药枚      ：开局给**我方全体**各一次"免疫伤害"次数
    它们的作用对象是"敌方"或"全队"，挂不到单个棋子上，所以在固定位置执行。
  */
  applySharedItemBattleStart(state);

  /*
    ★ 0.1.1 藏品二版：A 类藏品里"开局要数全场"的两条机制。
      · startSurroundAttack  —— 岩角号：按**周围 4 格**有几名干员折算成固定攻击力加成
      · startRandomAllyBuff  —— 生还者合约：随机挑一名我方干员挂上加成
    它们必须在**所有棋子都建好之后**才能算（数周围、随机挑人都要看全场），
    所以不能塞进上面那个"逐棋子挂属性包"的循环里。
  */
  applyWearerStartMechanics(state, wearerEffects);

  /*
    技能 + 藏品（A 类）的"开局类"效果
    （砾的入场护盾、见行者的开局给队友加攻速、奥数法阵的开局 +10 魔抗…）。

    【为什么放在羁绊/共享藏品之后？】
    因为羁绊里有"按血量最高的人给加成"这种结论 —— 它要看到**加成之后**的属性。
    棋子自己的开局效果放在最后最不容易互相干扰。顺序固定 = 确定性。
  */
  for (const unit of state.units) {
    // 藏品（A 类）的开局效果：奥数法阵的"回合开始额外 +10 魔抗，持续 15 秒"
    // passive: true —— 藏品的开局包不是"技能效果"，不能挡回蓝（见 applyBattleStartEffect）
    for (const effect of wearerEffects.get(unit.id)?.battleStart ?? []) {
      applyBattleStartEffect(state, unit, effect, { passive: true });
    }
    const def = defs[unit.defId];
    if (!def) continue;
    const variant = skillVariantOf(def, unit.star);
    if (!variant.battleStart || variant.battleStart.length === 0) continue;
    for (const effect of variant.battleStart) {
      applyBattleStartEffect(state, unit, effect);
    }
    /*
      ★★ 0.2.1 表现层：数据里写了 `castFx` 的"**开局类**技能"（玛恩纳 3 星
      「未照耀的荣光」= 开局立刻开技能、持续 100 秒），在这里补一条 `cast` 事件 ——
      否则那套金色起手演出永远没有触发点（他没有 effects ⇒ 不会走 castSkill，
      通用那圈符文环也被 `hasActiveSkill` 挡掉）。

      ★ 口径：`battleStart` **本身不是"放技能"**（上面那段注释说得很清楚，
        砾的护盾是入场自带），所以只有**数据明确要求播演出**（写了 castFx）时才补这一条。
      ★ 纯表现：`computeChecksum` 的 cast 分支只混 unitId，战斗结果不受影响；
        不写 `castFx` 的干员一条都不会多。
    */
    if (variant.castFx) {
      state.log.push({ type: 'cast', t: state.tick, unitId: unit.id, skillId: def.skill.id, fx: variant.castFx });
    }
  }

  /*
    ★ 0.1.1 藏品二版：开局法力条预充（高卢银行支票 50% / 第二经济改革法 100%）。
    必须放在**所有增益包挂完之后** —— 它就是去读修正包里的 initialManaBp，
    早一步执行就会读到一份还没算齐的修正。
  */
  applyInitialMana(state);

  // 开局加成可能改了血量上限，所以开局事件之后要把 maxHp 同步一遍
  refreshSpawnMaxHp(state);

  return state;
}

/**
 * 只执行"开局那一次"能用得上的几种技能效果。
 *
 * 【为什么不用 castSkill 直接跑？】
 * 因为 castSkill 会推一条 `cast` 事件、并把法力清零 ——
 * 而开局效果不是"放技能"（砾的护盾是入场自带，不是她攒满法力放的）。
 * 混在一起会让战斗日志里出现莫名其妙的 cast，
 * 也会让"她开局就有满法力"这种假象出现。
 *
 * 【`opts.passive` 是干什么的？】
 * `case 'buff'` 挂出来的包形状和技能 buff 一样，于是也会被
 * `isSkillActive`（"技能生效中不攒蓝"那道闸）当成技能效果 —— 对
 * **藏品**的开局效果来说这是错的：奥数法阵的"开局 +10 魔抗 15 秒"
 * 跟技能毫无关系，却让穿它的干员整整 15 秒一点蓝都不回（用户报的 bug）。
 * 所以藏品那条路传 `passive: true`，把它们排除在闸门之外；
 * 干员自己技能里的开局效果（砾的入场护盾、玛恩纳的"开局就开技能"）
 * **保持原样** —— 那是真的在"技能生效中"。
 */
function applyBattleStartEffect(
  state: BattleState,
  unit: UnitState,
  effect: SkillEffect,
  opts?: { passive?: boolean },
): void {
  switch (effect.kind) {
    case 'shield': {
      // ★ 0.2：走统一入口（支持已损失生命基准 / 自衰减 / 破盾子弹 / 护盾期间不回技力）
      applyShieldGrant(state, unit, unit, shieldGrantOf(effect, unit.star));
      break;
    }
    case 'buff': {
      const targets = resolveTargets(state, unit, effect.target);
      for (const target of targets) {
        addBuff(target, {
          stats: effect.stats,
          // ★ 0.2：时长可以是星级三元组（按**施法者**星级解析）
          ticksLeft:
            effect.attacks !== undefined
              ? MAX_BATTLE_TICKS
              : starValue(effect.durationTicks, unit.star),
          attackCharges: effect.attacks !== undefined ? starValue(effect.attacks, unit.star) : undefined,
          sourceId: unit.id,
          ...(opts?.passive ? { passive: true } : {}),
        });
      }
      break;
    }
    case 'heal': {
      const targets = resolveTargets(state, unit, effect.target);
      for (const target of targets) {
        const base =
          effect.basis === 'casterMaxHp' ? unit.maxHp : effect.basis === 'targetMaxHp' ? target.maxHp : unit.attackDamage;
        healUnit(state, unit, target, Math.floor((base * starValue(effect.power, unit.star)) / FIX));
      }
      break;
    }
    /*
      ★ 0.0.3：「回合开始时瞬移到最近的敌人面前」（“复仇者”一阶段）。
      开局类效果以前只认护盾/增益/治疗，这里补上瞬移 —— 它的语义就是"开局站位"，
      和 castSkill 里那个瞬移是同一件事，只是不经过"放技能"。
    */
    case 'teleport': {
      let targets = resolveTargets(state, unit, effect.target);
      if (targets.length === 0 && effect.fallback) targets = resolveTargets(state, unit, effect.fallback);
      const target = targets[0];
      if (!target) break;
      const spot = findEmptyNear(state, target.cell, moveStyleOf(unit), { nearerTo: unit.cell });
      if (spot) moveUnitTo(state, unit, spot);
      break;
    }
    default:
      // 其他效果类型不适合"开局"，静默跳过（数据里写了也会被忽略）
      break;
  }
}

/**
 * ★★ 0.3.1 盟约的**开局类**效果（目前只有桑葚「药枚实验」）。
 *
 * 【"最右一列"到底指哪一列？】
 * 棋盘是左右各半：队伍 0 占 0~4 列、队伍 1 占 5~9 列。
 * 如果按"全场最右"（第 9 列）算，队伍 0 永远不可能触发 —— 显然不对。
 * 所以这里按**每支队伍自己占用的最大列**算：队伍 0 的右边缘是第 4 列附近、
 * 队伍 1 的右边缘是第 9 列。两支队伍各按自己的"最右"生效，是对称的。
 *
 * 【为什么用 statuses 标记，而不是每次攻击现算？】
 * 现算要遍历全场、还要处理"战斗中棋子移动了算不算"的问题 ——
 * 用户口径是"**战斗开始时**使最右边的单位获得效果"，
 * 所以位置在开局那一刻就定死（之后走到哪里都保留）。
 */
function applyCovenantBattleStart(state: BattleState): void {
  for (const team of [0, 1] as const) {
    const cfg = covenantRightmostChargeShield(state.covenantIds?.[team]);
    if (!cfg) continue;
    const mine = state.units.filter((unit) => unit.team === team && !unit.dead);
    if (mine.length === 0) continue;
    let maxCol = -1;
    for (const unit of mine) maxCol = Math.max(maxCol, unit.cell.col);
    for (const unit of mine) {
      if (unit.cell.col === maxCol) unit.statuses['cvChargeShield'] = 1;
    }
  }
}

/**
 * 把羁绊的**开局类机制**应用上去。
 *
 * 【为什么要单独一步、而且必须顺序固定？】
 * 因为这些机制之间会互相影响：
 *   · 重装的"护甲总和分给全队"要**先算完**成员自己的护甲加成，
 *     再去求总和，否则算的是加成前的数
 *   · 罗德岛的"血最高者"要看加成后的血量
 *   · 龙的"三星计数"加的是全部属性，会影响所有人
 * 所以顺序写死：先"按队伍算的"（重装光环、龙、领导人），
 * 再"按个体算的"（血最高者、开局护盾）。
 */
/**
 * 找出**队伍级**的机制（成员型：挂在每个成员身上，但只需结算一次）。
 *
 * ============================================================
 *  ★★ 0.3.31 修「卡西米尔有概率不召唤援军」（用户实测反馈）
 * ============================================================
 * 以前这里写的是 `const speaker = myUnits[0]`，然后只读**那一个**单位的机制表。
 * 但机制表是按 `defId` 挂的，只有**这条羁绊的成员**才有 ——
 * 而 `myUnits[0]` 是"部署顺序里的第一个"，它很可能是别的羁绊的干员。
 * 于是整段被静默跳过：
 *   · 卡西米尔凑齐 3 人却不召唤白杨（**取决于你第一个摆的是谁** —— 所以"有时候有有时候没有"）；
 *   · 支援的双抗加成同理，第一个摆的不是支援成员就白给。
 * 这类 bug 不报错、对局照常，玩家只会觉得"羁绊凑齐了没效果"。
 *
 * 现在改成：扫**所有**成员，按"这条机制属于谁"去重。
 * 去重键用 `kind + summonId/traitId` —— 同一档的召唤物 / 同一个羁绊只会结算一次，
 * 不会因为 3 个成员各带一份就召唤出 3 只。
 */
function teamMechanics<K extends TraitMechanic['kind']>(
  myUnits: ReadonlyArray<{ defId: string }>,
  mechByDef: Record<string, readonly TraitMechanic[]>,
  kind: K,
): Extract<TraitMechanic, { kind: K }>[] {
  const seen = new Set<string>();
  const out: Extract<TraitMechanic, { kind: K }>[] = [];
  for (const unit of myUnits) {
    for (const mechanic of mechByDef[unit.defId] ?? []) {
      if (mechanic.kind !== kind) continue;
      const narrowed = mechanic as Extract<TraitMechanic, { kind: K }>;
      const raw = narrowed as unknown as Record<string, unknown>;
      const tag = typeof raw.summonId === 'string' ? raw.summonId : typeof raw.traitId === 'string' ? raw.traitId : '';
      const key = `${kind}|${tag}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(narrowed);
    }
  }
  return out;
}

function applyStartOfBattleMechanics(
  state: BattleState,
  defs: UnitDefTable,
  teams: [TeamSetup, TeamSetup],
): void {
  for (const setup of teams) {
    const mechByDef = setup.unitMechanics ?? {};
    const myUnits = state.units.filter((unit) => unit.team === setup.team);
    if (myUnits.length === 0) continue;

    // ---- 1) 全队光环：把"某属性的总和"按比例分给每个人（重装）----
    for (const unit of myUnits) {
      const mechanics = mechByDef[unit.defId] ?? [];
      for (const mechanic of mechanics) {
        if (mechanic.kind !== 'auraFromSum') continue;
        // 求"带这个机制的所有棋子"的属性和。
        // 注意只统计**同样有这条机制**的成员（也就是重装干员），
        // 数学上：重装护甲总和 × 比例，分给所有我方干员。
        let sum = 0;
        for (const member of myUnits) {
          const memberMechanics = mechByDef[member.defId] ?? [];
          if (!memberMechanics.some((item) => item.kind === 'auraFromSum')) continue;
          sum += mechanic.source === 'armor' ? member.armor : member.magicResist;
        }
        const share = Math.floor((sum * mechanic.ratioBp) / 10000);
        state.log.push({
          type: 'aura',
          t: 0,
          unitId: unit.id,
          stat: mechanic.source === 'armor' ? 'armor' : 'magicResist',
          amount: share,
        });
      }
    }

    // 把光环加成真正加到属性上（分两步是因为上面要"先算完总和再统一发"，
    // 否则边加边算会让先处理的棋子享受到后处理的棋子的加成）
    const auraEvents = state.log.filter((event) => event.type === 'aura');
    for (const event of auraEvents) {
      if (event.type !== 'aura') continue;
      const unit = state.units.find((item) => item.id === event.unitId);
      if (!unit || unit.team !== setup.team) continue;
      if (event.stat === 'armor') unit.armor += event.amount;
      else unit.magicResist += event.amount;
    }

    // ---- 2) 每有一个三星干员，全队提升全部属性（龙）----
    const tripleCount = myUnits.filter((unit) => unit.star >= 3).length;

    for (const unit of myUnits) {
      const mechanics = mechByDef[unit.defId] ?? [];

      for (const mechanic of mechanics) {
        if (mechanic.kind === 'allStatsByTriple' && tripleCount > 0) {
          // values[0] 对应"1 个三星"，values[1] 对应 2 个……超出范围就取最后一个
          const index = Math.min(tripleCount, mechanic.values.length) - 1;
          const bp = mechanic.values[index] ?? 0;
          if (bp <= 0) continue;
          unit.attackDamage += Math.floor((unit.attackDamage * bp) / 10000);
          unit.attackSpeed += Math.floor((unit.attackSpeed * bp) / 10000);
          unit.armor += Math.floor((unit.armor * bp) / 10000);
          unit.magicResist += Math.floor((unit.magicResist * bp) / 10000);
          const extra = Math.floor((unit.maxHp * bp) / 10000);
          unit.maxHp += extra;
          unit.hp += extra;
        }
      }
    }

    // ---- 2b) 每有一个"本羁绊的三星干员"，全队攻击力提升（龙，0.0.3 A 版）----
    /*
      【为什么数的是"带这个羁绊的三星"而不是"全队三星"？】
      旧版龙的 `allStatsByTriple` 数的是全队任意三星 —— 一个非龙的三星也算一份。
      A 版明确写成"每有一个**龙羁绊干员**到达 3 星"，所以这里认人：
      机制上带着 `traitId`（resolveUnitMechanics 自动填的），拿它去查棋子自己的标签。

      【为什么加成发在"每个 unit 一次"的循环里？】
      这条机制是 team 型（发给全队每个人各一份），所以每个人各加一次 = 全队都吃到。
    */
    for (const unit of myUnits) {
      const mechanics = mechByDef[unit.defId] ?? [];
      for (const mechanic of mechanics) {
        if (mechanic.kind !== 'attackByTripleTrait') continue;
        const traitId = mechanic.traitId;
        let tripleCount = 0;
        for (const member of myUnits) {
          if (member.star < 3) continue;
          if (traitId && !(defs[member.defId]?.traits ?? []).includes(traitId)) continue;
          tripleCount++;
        }
        if (tripleCount <= 0) continue;
        const bp = mechanic.perTripleBp * tripleCount;
        unit.attackDamage += Math.floor((unit.attackDamage * bp) / 10000);
      }
    }

    /*
      ---- 2c) ★★ 0.3 龙：按“场上这个羁绊干员的星级总和”提升全队攻击力 ----

      用户口径：「按照场上龙羁绊干员的星级总和提升全队攻击力
      （重复干员只计算最高星级的一个），每一星提升 2%/3%/5%」。

      【为什么要“按 defId 取最高星”】
      因为同一个干员上两个（比如两个 1 星陈）并不是“两个龙”，
      而是“同一个乺子算一份”—— 否则拿两张同名卡就能刷星级。
      取 max(star) 而不是相加：合成成 2 星之后就只剩一个了，
      两种算法结果一致；但万一因为某种原因同名共存（博士投影之类），
      取 max 不会把它们叠成两倍。
    */
    for (const unit of myUnits) {
      const mechanics = mechByDef[unit.defId] ?? [];
      for (const mechanic of mechanics) {
        if (mechanic.kind !== 'attackByTraitStars') continue;
        const traitId = mechanic.traitId;
        /** defId -> 这个干员在场上的最高星级 */
        const bestStar = new Map<string, number>();
        for (const member of myUnits) {
          if (traitId && !(defs[member.defId]?.traits ?? []).includes(traitId)) continue;
          const prev = bestStar.get(member.defId) ?? 0;
          if (member.star > prev) bestStar.set(member.defId, member.star);
        }
        let starSum = 0;
        for (const star of bestStar.values()) starSum += star;
        if (starSum <= 0) continue;
        const bp = mechanic.perStarBp * starSum;
        unit.attackDamage += Math.floor((unit.attackDamage * bp) / 10000);
      }
    }

    // ---- 3) 血量最高的成员获得攻击力加成（罗德岛）----
    // 【为什么每场只选一个、而且死亡后要继承？】
    // 这是你的设计：「生命值最高的那个罗德岛干员攻击力提升，
    // 死亡后由下一个角色继承」。所以不能开战时加完就不管了 ——
    // 要在战斗过程中检查"当前持有者是否还活着"，死了就换人。
    // 这里只做开局的第一次指派，"继承"在 step() 里每 tick 检查。
    for (const unit of myUnits) {
      const mechanics = mechByDef[unit.defId] ?? [];
      const carrier = mechanics.find((mechanic) => mechanic.kind === 'highestHpCarrier');
      if (!carrier || carrier.kind !== 'highestHpCarrier') continue;
      if (assignHpCarrier(state, setup.team, carrier.attackDamageBp)) break;
    }

    // ---- 4) 开局护盾（支援）----
    for (const unit of myUnits) {
      const mechanics = mechByDef[unit.defId] ?? [];
      for (const mechanic of mechanics) {
        if (mechanic.kind !== 'startShield') continue;
        const amount = Math.floor((unit.maxHp * mechanic.hpBp) / 10000);
        if (amount <= 0) continue;
        applyShield(state, null, unit, amount, mechanic.durationTicks);
      }
    }

    // ---- 5) 开局常驻被动修正包（0.2：卡西米尔的闪避 / 萨卡兹的全能吸血）----
    // 走 addBuff(passive: true) 这条既有通路：collectMods 一汇总就生效，
    // 而且 passive 标记保证它不会把棋子当成"技能生效中"（否则回不了蓝）。
    for (const unit of myUnits) {
      const mechanics = mechByDef[unit.defId] ?? [];
      for (const mechanic of mechanics) {
        if (mechanic.kind !== 'startSelfBuff') continue;
        addBuff(unit, { stats: mechanic.stats, ticksLeft: FOREVER_TICKS, sourceId: unit.id, passive: true });
      }
    }

    /*
      ---- 6) 队伍级开局双抗（0.2 支援）----
      ★ 支援是 `scope: 'team'`，机制会挂到**每一个人**身上 ——
      所以只能结算一次。挑 id 最小的那个人当"发言人"，读它的机制表。
      "10% 的物抗"按**当次护甲的百分比**换算成固定值（SkillStats 没有 armorBp，
      而开局这一刻算出来的固定值在整场战斗里都成立，两者等价）。

      ★★ 0.2 修（用户报"布阵阶段双抗显示大了几百倍"）：
      `SkillStats` 的 `armorFlat` / `magicResistFlat` 是**面板点数**
      （数据表里写 15 / 20 / 30 那种，`collectMods` 收到之后会 `* FIX` 变成内核定点数），
      而 `unit.armor` **本身就是定点数** —— 这里原来直接塞进去 ⇒
      被 `collectMods` 又乘了一次 FIX ⇒ **护甲/魔抗大 1000 倍**
      （30 点护甲变成 30000 点，玩家看到的就是"大了几百倍"）。
      ⇒ 换算到面板单位必须**再除一次 FIX**，也就是除了 `BP * FIX`。
      ★ 同一族还有 `deathStatTransfer`（罗德岛传属性）里的 hpFlat/双抗，一起修了。
    */
    /*
      ★★ 0.3.31：用 `teamMechanics` 扫所有成员（见函数注释 —— `myUnits[0]` 可能是别的羁绊）。
    */
    for (const mechanic of teamMechanics(myUnits, mechByDef, 'startResist')) {
      for (const unit of myUnits) {
        const stats = {
          armorFlat: Math.floor((unit.armor * mechanic.armorBp) / (BP * FIX)),
          magicResistFlat: Math.floor((unit.magicResist * mechanic.magicResistBp) / (BP * FIX)),
        };
        if (stats.armorFlat <= 0 && stats.magicResistFlat <= 0) continue;
        addBuff(unit, { stats, ticksLeft: Math.max(1, mechanic.durationTicks), sourceId: unit.id });
      }
    }

    /*
      ---- 7) 跨回合叠层（0.2 罗德岛）----
      层数是客户端算好、跟着阵容上报的（`TeamSetup.traitStacks`），
      内核只负责"把 N 层换成 N × 每层的那点属性" —— 挂成常驻被动包。
      层数上限在这里再夹一次（不信任外部输入），0 层等于没这回事。
    */
    const traitStacks = setup.traitStacks ?? {};
    for (const unit of myUnits) {
      for (const mechanic of mechByDef[unit.defId] ?? []) {
        if (mechanic.kind !== 'roundTraitStack') continue;
        const raw = traitStacks[mechanic.traitId ?? ''] ?? 0;
        const stacks = Math.min(mechanic.maxStacks, Math.max(0, Math.floor(raw)));
        if (stacks <= 0) continue;
        addBuff(unit, {
          stats: {
            hpBp: mechanic.hpBp * stacks,
            attackDamageBp: mechanic.attackDamageBp * stacks,
          },
          ticksLeft: FOREVER_TICKS,
          sourceId: unit.id,
          passive: true,
        });
      }
    }

    /*
      ---- 8) 开局召唤援军（0.2 卡西米尔）----
      ★★ 这是一个真 bug 的修复：`startSummon` 原来**只在共享藏品那条路**
      （`applySharedItemBattleStart`）里有分支，羁绊自己写的 `startSummon` 谁都不读 ——
      表现就是"卡西米尔凑齐了却不召唤援军"，而且不报任何错。

      ★ 机制是挂在**每个成员**身上的（成员型），所以只能结算一次：
      挑 id 最小的那个人当"发言人"，读它的机制表（和上面 startResist 同一个套路）。

      ★ 位置必须放在**所有开局结算的最后** —— 因为 `cellsBesideHighestHpAlly`
      要按"当前生命值最高的友方"找落点，如果先召唤、后算护盾/加成，
      落点就会按还没加成的血量来选；而且刚召唤出来的援军不该参与"谁血最高"的评比。
    */
    /*
      ★★ 0.3.31：同样改成扫所有成员 —— 用户报的"卡西米尔有概率没召唤出援军"
      就是 `myUnits[0]` 恰好不是卡西米尔成员（第一个摆的不是她）。
      去重键是 `summonId`：同档的援军只会召唤一次。
    */
    const summoner = myUnits[0]!;
    for (const mechanic of teamMechanics(myUnits, mechByDef, 'startSummon')) {
      const def = state.defs[mechanic.summonId];
      if (!def) continue;
      const cells =
        mechanic.placement === 'besideHighestHpAlly'
          ? cellsBesideHighestHpAlly(state, setup.team, Math.max(1, mechanic.count))
          : summonCells(state, setup.team, Math.max(1, mechanic.count));
      for (const cell of cells) {
        spawnSummon(state, def, summoner, cell, { hp: mechanic.hp, attackDamage: mechanic.attackDamage });
      }
    }
  }
}

/**
 * ★ 0.0.3：B 类藏品的「开局类」机制。
 *
 * 现在只有两种，而且都**一次性生效**（不像 teamRegen 那样每 tick 要动）：
 *   · startEnemyShred   —— 把我方**敌方全体**的护甲/魔抗按比例砍掉
 *   · startTeamImmunity —— 给我方**全体**各挂 N 次"免疫伤害"
 *
 * 【为什么破例直接改 unit.armor 而不是挂 buff？】
 * 「减少 25% 双抗」是对**开战那一刻的数值**打折，之后敌人再吃到自己的
 * 增益/减益都跟这条无关。直接改属性最贴切，也不会和"敌方的护甲 buff"
 * 打架（乘法打折只做一次）。而护甲是 FIX 整数，直接乘除取整就是确定性的。
 *
 * 【为什么免疫走 addBuff 而不是改 statuses？】
 * 因为它必须**按次数消耗**，而"免疫 N 次"这套逻辑
 * （collectMods 汇总 + dealDamage 里 consumeImmuneCharge）已经在技能那边
 * 写得稳稳的了，复用即可 —— 药枚只是"给它 1 次"，机制完全一样。
 */
/**
 * 从"打过标记"的机制里取回**藏品 id**（`tagMechanic` 写的是 `traitId: 'item_<id>'`）。
 *
 * 用途：把"这条增益是哪件藏品给的"写进战斗日志 ——
 * 生还者合约的随机强化是挑人挂的，界面只能靠这个标记认人。
 */
function itemIdOfMechanic(mechanic: { traitId?: string }): string | undefined {
  const tag = mechanic.traitId;
  return tag && tag.startsWith('item_') ? tag.slice('item_'.length) : undefined;
}

function applySharedItemBattleStart(state: BattleState): void {
  for (let team = 0; team < 2; team++) {
    for (const runtime of state.teamMechanics?.[team as 0 | 1] ?? []) {
      const mechanic = runtime.mechanic;

      if (mechanic.kind === 'startEnemyShred') {
        for (const unit of state.units) {
          if (unit.dead || unit.team === team) continue;
          // 砍 25% 就是乘 (10000 - 2500) / 10000 = 0.75
          if (mechanic.armorBp > 0) {
            unit.armor = Math.floor((unit.armor * (10000 - mechanic.armorBp)) / 10000);
          }
          if (mechanic.magicResistBp > 0) {
            unit.magicResist = Math.floor((unit.magicResist * (10000 - mechanic.magicResistBp)) / 10000);
          }
        }
        continue;
      }

      if (mechanic.kind === 'startTeamImmunity') {
        for (const unit of state.units) {
          if (unit.dead || unit.team !== team) continue;
          // passive：这是"常驻被动"（不是技能效果），不该挡回蓝 —— 同藏品属性包
          addBuff(unit, { stats: { immuneHits: mechanic.hits }, ticksLeft: FOREVER_TICKS, sourceId: unit.id, passive: true });
        }
        continue;
      }

      /*
        ★★ 0.1.2 修：生还者合约「战斗开始时，使随机一名干员攻击力 +20%、防御 +20%，
        每次胜利后额外 +20%（最高 +100%）」——**它以前一直没生效**。

        【根因】这件藏品是 **B 类（共享）**，机制挂在 `state.teamMechanics` 上，
        而整个内核只有 A 类那条路（`applyWearerStartMechanics`）认 `startRandomAllyBuff` ——
        两条路各走各的，这条机制就再也没人读。

        【为什么放在队伍级这里、而不是继续放在 A 类那段？】
        因为"随机挑一名我方干员"是**队伍级**的事（不需要落点干员），
        而且它必须等所有棋子都建好才能挑人 —— 这里的时机正好（开局结算的最后一段）。
        层数带来的放大走 `scaleBp`（10000 = 只吃基础那 20%）。
      */
      if (mechanic.kind === 'startRandomAllyBuff') {
        const allies = state.units.filter((other) => !other.dead && other.team === team);
        if (allies.length === 0) continue;
        const picked = allies[state.rng.nextInt(allies.length)]!;
        const factorBp = Math.max(10000, mechanic.scaleBp ?? 10000);
        const stats = scaleStats(mechanic.stats, factorBp);
        addBuff(picked, { stats, ticksLeft: FOREVER_TICKS, sourceId: picked.id, passive: true });
        // itemId 让界面能回答"这一场抽到哪个干员了"（生还者合约那一行要显示名字）
        emitBuffEvents(state, picked.id, picked, stats, FOREVER_TICKS, 1, itemIdOfMechanic(mechanic));
        continue;
      }

      /*
        ★ 0.1.1 藏品二版：全队"受到的治疗 / 生命回复"提升（活玫瑰 +8% / 涌动之餐 +30%）。
        和 A 类的 combat.healingBp 落法完全一样 —— healUnit 读的就是
        `statuses['healingBonusBp']`，直接累加进去，运行时零开销。
      */
      if (mechanic.kind === 'teamHealingBp') {
        for (const unit of state.units) {
          if (unit.dead || unit.team !== team) continue;
          unit.statuses['healingBonusBp'] = (unit.statuses['healingBonusBp'] ?? 0) + mechanic.ratioBp;
        }
        continue;
      }

      /*
        ★ 0.1.1 藏品二版：队伍级开局召唤（支援防暴桩的两只假人 / 天师锦囊的炎佑）。
        数值（血量 / 攻击力）由 resolveSharedItems 按**当前回合数**算好塞进来，
        内核只管照数召唤 —— 因为它根本不知道现在是第几回合。
      */
      if (mechanic.kind === 'startSummon') {
        const def = state.defs[mechanic.summonId];
        if (!def) continue;
        const owner = state.units.find((unit) => !unit.dead && unit.team === team);
        if (!owner) continue;
        // ★ 0.2：卡西米尔的援军要落在"生命值最高的友方旁边"，藏品那条路仍是旧行为
        const cells =
          mechanic.placement === 'besideHighestHpAlly'
            ? cellsBesideHighestHpAlly(state, team as 0 | 1, Math.max(1, mechanic.count))
            : summonCells(state, team as 0 | 1, Math.max(1, mechanic.count));
        for (const cell of cells) {
          spawnSummon(state, def, owner, cell, { hp: mechanic.hp, attackDamage: mechanic.attackDamage });
        }
      }
    }
  }
}

/**
 * ★ 0.1.1：在某一方自己的半场里，从**最靠前线的那一列**往里找若干个空格。
 *
 * 【为什么从前往后找？】
 * 召唤物（假人 / 炎佑）是要**挡在队伍前面**的，放在最后一排等于没放。
 * 顺序写死（先列后行、行号从小到大）=> 确定性。
 * 找不到足够空格时就少放几只（绝不硬塞已有的格子）。
 */
function summonCells(state: BattleState, team: 0 | 1, count: number): Cell[] {
  const out: Cell[] = [];
  const cols: number[] = [];
  if (team === 0) {
    for (let col = ARENA_W - 1; col >= 0; col--) cols.push(col);
  } else {
    for (let col = ARENA_W; col < BOARD_W; col++) cols.push(col);
  }
  for (const col of cols) {
    for (let row = 0; row < BOARD_H; row++) {
      if (out.length >= count) return out;
      if (state.cellToUnit[cellIndex(col, row)] !== CELL_EMPTY) continue;
      out.push({ col, row });
    }
  }
  return out;
}

/**
 * ★ 0.2 卡西米尔援军：落在"生命值最高的友方"周围 8 格。
 *
 * 【三条口径】
 *   · "生命值最高"看的是**当前 maxHp**（含羁绊加成之后的），并列时取 id 小的；
 *   · 只挑己方、存活、且**不是召唤物**的棋子 —— 否则援军会围着另一个援军转；
 *   · 周围没位置时**退回自己半场最靠前线的一列**（数据表里写明的兜底），
 *     而不是干脆不召唤（不然羁绊看起来"没生效"）。
 */
function cellsBesideHighestHpAlly(state: BattleState, team: 0 | 1, count: number): Cell[] {
  let anchor: UnitState | null = null;
  for (const unit of state.units) {
    if (unit.dead || unit.team !== team) continue;
    if (state.defs[unit.defId]?.summonOnly === true) continue;
    if (!anchor || unit.maxHp > anchor.maxHp || (unit.maxHp === anchor.maxHp && unit.id < anchor.id)) anchor = unit;
  }
  const out: Cell[] = [];
  if (anchor) {
    for (let dc = -1; dc <= 1; dc++) {
      for (let dr = -1; dr <= 1; dr++) {
        if (dc === 0 && dr === 0) continue;
        if (out.length >= count) return out;
        const col = anchor.cell.col + dc;
        const row = anchor.cell.row + dr;
        if (col < 0 || col >= BOARD_W || row < 0 || row >= BOARD_H) continue;
        if (state.cellToUnit[cellIndex(col, row)] !== CELL_EMPTY) continue;
        out.push({ col, row });
      }
    }
  }
  if (out.length < count) {
    for (const cell of summonCells(state, team, count - out.length)) out.push(cell);
  }
  return out;
}

/**
 * ★ 0.1.1 藏品二版：A 类藏品里两条"开局要看全场"的机制。
 *
 * 顺序固定（按 state.units，也就是 id 升序）=> 确定性。
 * `state.rng` 只在"随机挑一名我方干员"那一处被消耗 ——
 * 和别的随机点一样，消耗次数固定，不随场面变化。
 */
function applyWearerStartMechanics(state: BattleState, wearerEffects: Map<number, WearerItemEffects>): void {
  for (const unit of state.units) {
    const mechanics = wearerEffects.get(unit.id)?.mechanics ?? [];
    for (const mechanic of mechanics) {
      /*
        岩角号「战斗开始时，干员周围 4 格每有一名干员，攻击力 +10%
        （战斗开始后增益不会变动）」。
        · "周围 4 格" = 上下左右四个正相邻格（十字），不含斜角 —— 和"周围 8 格"那种方块半径区分开
        · 开局数完就挂成一个**永久属性包**：之后队友死了也不掉（这正是"不会变动"的含义）
      */
      if (mechanic.kind === 'startSurroundAttack') {
        let count = 0;
        for (const other of state.units) {
          if (other.dead || other.id === unit.id) continue;
          const dc = Math.abs(other.cell.col - unit.cell.col);
          const dr = Math.abs(other.cell.row - unit.cell.row);
          if (dc + dr === 1) count++;
        }
        const bp = mechanic.perAllyBp * count;
        if (bp <= 0) continue;
        addBuff(unit, {
          stats: { attackDamageBp: bp },
          ticksLeft: FOREVER_TICKS,
          sourceId: unit.id,
          passive: true,
        });
        emitBuffEvents(state, unit.id, unit, { attackDamageBp: bp }, FOREVER_TICKS);
        continue;
      }

      /*
        生还者合约「战斗开始时，使随机一名干员攻击力 +20%，防御 +20%，
        每次胜利后额外 +20%（最高叠加 100%）」。
        层数带来的放大走 `scaleBp`（10000 = 只吃基础那 20%）。
      */
      if (mechanic.kind === 'startRandomAllyBuff') {
        const allies = state.units.filter((other) => !other.dead && other.team === unit.team);
        if (allies.length === 0) continue;
        const picked = allies[state.rng.nextInt(allies.length)]!;
        const factorBp = Math.max(10000, mechanic.scaleBp ?? 10000);
        const stats = scaleStats(mechanic.stats, factorBp);
        addBuff(picked, { stats, ticksLeft: FOREVER_TICKS, sourceId: unit.id, passive: true });
        emitBuffEvents(state, unit.id, picked, stats, FOREVER_TICKS, 1, itemIdOfMechanic(mechanic));
      }
    }
  }
}

/**
 * ★ 0.1.1 藏品二版：开局把法力条按比例预充（高卢银行支票 50% / 第二经济改革法 100%）。
 *
 * 【「被动技能无效」怎么落实？】
 * 设计稿那两件藏品都写了这句。它的意思是：这个效果是给"**能放技能**的干员
 * 提前攒好能量条"的 —— 一个只有被动、根本没有主动技能的棋子没有能量条可言，
 * 给它充能毫无意义。所以这里跳过"没有可释放效果"的棋子。
 * 判据和战斗循环里那条 `skillEffects.length > 0` 完全一致（同一个 skillVariantOf）。
 */
function applyInitialMana(state: BattleState): void {
  for (const unit of state.units) {
    if (unit.dead) continue;
    const def = state.defs[unit.defId];
    if (!def) continue;
    if (skillVariantOf(def, unit.star).effects.length === 0) continue; // 纯被动棋子：无效
    const mods = collectMods(state, unit);
    if (mods.initialManaBp <= 0) continue;
    const gain = Math.floor((MANA_MAX * Math.min(10000, mods.initialManaBp)) / BP);
    if (gain <= 0) continue;
    unit.mana = Math.min(MANA_MAX, unit.mana + gain);
  }
}

/**
 * ★ 0.1.1 藏品二版：藏品带来的"每 tick 要做的事"。
 *
 * 覆盖两条：
 *   · lowHpShield    —— 染血辞典：血量首次跌破阈值时给一个护盾（整场一次）
 *   · lowHpManaRegen —— 止痛片：血量越低回蓝越快
 *
 * 【为什么不塞进 tickUnitMechanics？】
 * 那个函数用 `periodicTimers` 数组按下标给每条机制计时 ——
 * 这两条不是"到点触发"而是"按当前血量连续计算"，混进去会把计时器下标错位。
 */
function tickItemMechanics(state: BattleState, unit: UnitState): void {
  const runtime = unit.trait;
  if (!runtime || unit.dead) return;

  for (const mechanic of runtime.mechanics) {
    if (mechanic.kind === 'lowHpShield') {
      if (runtime.lowHpShieldUsed) continue;
      if (unit.maxHp <= 0) continue;
      // hp 百分比 > 阈值就还没到：hp * 10000 > maxHp * hpBelowBp
      if (unit.hp * 10000 > unit.maxHp * mechanic.hpBelowBp) continue;
      runtime.lowHpShieldUsed = true;
      const amount = Math.floor((unit.maxHp * mechanic.shieldBp) / 10000);
      if (amount > 0) applyShield(state, unit, unit, amount, mechanic.durationTicks);
      continue;
    }

    if (mechanic.kind === 'lowHpManaRegen') {
      // 直接把"低血折算后的每秒法力"读出来（collectMods 里已经按当前血量算好）
      const mods = collectMods(state, unit);
      if (mods.manaRegenMilliPerSecond <= 0) continue;
      runtime.manaRegenAccum = (runtime.manaRegenAccum ?? 0) + mods.manaRegenMilliPerSecond;
      // 每 tick 攒 manaRegenMilli，攒够 1000 × TICKS_PER_SECOND 就是 1 点法力
      const perMana = 1000 * TICKS_PER_SECOND;
      const grant = Math.floor(runtime.manaRegenAccum / perMana);
      if (grant > 0) {
        runtime.manaRegenAccum -= grant * perMana;
        gainMana(state, unit, grant);
      }
    }
  }
}

/**
 * ★ 0.0.3：队伍级藏品的"进行时"机制，每 tick 走一步。
 *
 * 现在只有 `teamRegen`（急救药箱：每 3 秒给全体回 100 血）。
 * 【为什么每队只有一个执行者？】见 BattleState.teamMechanics 的说明 ——
 * 挂在每个棋子上会让 8 个人各回一次，变成每 3 秒回 800。
 */
function tickTeamMechanics(state: BattleState): void {
  const runtimes = state.teamMechanics;
  if (!runtimes) return;
  for (let team = 0; team < 2; team++) {
    for (const runtime of runtimes[team as 0 | 1] ?? []) {
      const mechanic = runtime.mechanic;
      /*
        ★ 0.1.1 藏品二版：苍桐「金币为 70 及以上时，每隔 10 秒对全场敌人
        造成一次 100 点法术伤害和 1.5 秒的晕眩」。
        `active` 是 resolveSharedItems 在组阵容时按玩家金币判定的结论
        （金币在备战期不变），内核只读它。
      */
      if (mechanic.kind === 'goldThresholdNuke') {
        if (!mechanic.active) continue;
        runtime.timer++;
        if (runtime.timer < mechanic.intervalTicks) continue;
        runtime.timer = 0;
        for (const enemy of state.units) {
          if (enemy.dead || enemy.team === team) continue;
          dealDamage(state, null, enemy, mechanic.damage * FIX, mechanic.damageType, 'spell', ITEM_SOURCE_ID);
          if (mechanic.stunTicks > 0) applyStun(state, null, enemy, mechanic.stunTicks);
        }
        continue;
      }
      if (mechanic.kind !== 'teamRegen') continue;
      runtime.timer++;
      if (runtime.timer < mechanic.intervalTicks) continue;
      runtime.timer = 0;
      // 顺序固定（state.units 是按 id 升序的）=> 确定性
      for (const unit of state.units) {
        if (unit.dead || unit.team !== team) continue;
        // 召唤物、陷阱也算"我方单位"，一起回血（和"我方全部干员"的语义一致）
        healUnit(state, null, unit, mechanic.amount * FIX);
      }
    }
  }
}

/**
 * ★ 0.0.3：野怪自己的"每 tick 要做的事"。
 *
 * 覆盖两类：
 *   · `periodic`    —— 到点就触发（落雷 / 全场打击 / 定期召唤）
 *   · `pairRequires`—— 场上有某只同伴时，自身定期回血（深池伙友卫队精英）
 *
 * 【计时器为什么是一个和 mechanics 对齐的数组？】
 * 因为同一个棋子身上可能挂好几条周期机制，各自要有各自的节奏。
 * 数组下标 = mechanics 的下标，顺序固定 => 确定性。
 */
function tickUnitMechanics(state: BattleState, unit: UnitState, defs: UnitDefTable): void {
  const runtime = unit.trait;
  if (!runtime) return;
  const mechanics = runtime.mechanics;
  if (!runtime.periodicTimers || runtime.periodicTimers.length !== mechanics.length) {
    runtime.periodicTimers = new Array(mechanics.length).fill(0);
  }

  for (let i = 0; i < mechanics.length; i++) {
    const mechanic = mechanics[i]!;
    if (mechanic.kind === 'periodic') {
      const timer = runtime.periodicTimers[i]! + 1;
      if (timer < Math.max(1, mechanic.intervalTicks)) {
        runtime.periodicTimers[i] = timer;
        continue;
      }
      runtime.periodicTimers[i] = 0;
      firePeriodic(state, unit, mechanic.effect, defs);
      continue;
    }
    if (mechanic.kind === 'pairRequires' && mechanic.selfHealBp && mechanic.intervalTicks) {
      // 没有同伴在场上 -> 这条不生效，计时器也归零（同伴回来要重新攒）
      if (!hasLivingAllyDef(state, unit, mechanic.requiresDefId)) {
        runtime.periodicTimers[i] = 0;
        continue;
      }
      const timer = runtime.periodicTimers[i]! + 1;
      if (timer < Math.max(1, mechanic.intervalTicks)) {
        runtime.periodicTimers[i] = timer;
        continue;
      }
      runtime.periodicTimers[i] = 0;
      healUnit(state, unit, unit, Math.floor((unit.maxHp * mechanic.selfHealBp) / BP));
      continue;
    }

    // ★ 0.2 重装：每 intervalTicks 检查一次，**当前没有护盾**才补一个"已损失生命 × missingHpBp"
    if (mechanic.kind === 'periodicShield') {
      const timer = runtime.periodicTimers[i]! + 1;
      if (timer < Math.max(1, mechanic.intervalTicks)) {
        runtime.periodicTimers[i] = timer;
        continue;
      }
      runtime.periodicTimers[i] = 0;
      // "护盾存在期间不会再次获得" —— 有盾就跳过，计时器已经归零，下一次从零开始攒
      if ((unit.statuses['shieldValue'] ?? 0) > 0) continue;
      const amount = Math.floor(((unit.maxHp - unit.hp) * mechanic.missingHpBp) / BP);
      if (amount > 0) applyShield(state, unit, unit, amount, FOREVER_TICKS);
      continue;
    }

    /*
      ★ 0.2 法术：队伍级回技力。
      ★★ 机制是挂在**每一个**友方身上的（成员型），但效果是"全体每 5 秒回一次" ——
      如果人手一份各自计时，实际会变成"每人每 5 秒回一次、共 N 次"。
      所以只让**持有这条机制、且 id 最小的存活单位**驱动计时器（确定性，不受遍历顺序影响）。
      驱动者死了会自动换成下一个，计时器重新从 0 攒。
    */
    if (mechanic.kind === 'teamManaRegen') {
      if (!isTeamManaDriver(state, unit)) {
        runtime.periodicTimers[i] = 0;
        continue;
      }
      const timer = runtime.periodicTimers[i]! + 1;
      if (timer < Math.max(1, mechanic.intervalTicks)) {
        runtime.periodicTimers[i] = timer;
        continue;
      }
      runtime.periodicTimers[i] = 0;
      const gain = Math.floor((MANA_MAX * mechanic.manaBp) / BP);
      if (gain > 0) {
        for (const ally of state.units) {
          if (ally.dead || ally.team !== unit.team) continue;
          // duringSkill：这是"按时间来的"回蓝，技能持续期间也照给（同自动回复的口径）
          gainMana(state, ally, gain, { duringSkill: true });
        }
      }
      continue;
    }

    /*
      ★★ 0.2 MujicaAve：**成员自己**每秒回技力（`selfManaRegen`）。
      和上面那条只差"受益范围"：`teamManaRegen` 是一条机制管全队（所以要发言人），
      这一条是"谁的机制谁自己回"——各回各的，不需要发言人，也不会互相顶掉。
    */
    if (mechanic.kind === 'selfManaRegen') {
      const timer = runtime.periodicTimers[i]! + 1;
      if (timer < Math.max(1, mechanic.intervalTicks)) {
        runtime.periodicTimers[i] = timer;
        continue;
      }
      runtime.periodicTimers[i] = 0;
      if (!unit.dead) {
        const gain = Math.floor((MANA_MAX * mechanic.manaBp) / BP);
        // duringSkill：按时间来的回蓝，技能持续期间也照给（同自动回复的口径）
        if (gain > 0) gainMana(state, unit, gain, { duringSkill: true });
      }
      continue;
    }
  }
}

/** ★ 0.2：队伍级机制的"发言人"—— 同队里持有该机制、id 最小的存活单位 */
function isTeamManaDriver(state: BattleState, unit: UnitState): boolean {
  for (const other of state.units) {
    if (other.dead || other.team !== unit.team) continue;
    if (!(other.trait?.mechanics ?? []).some((item) => item.kind === 'teamManaRegen')) continue;
    return other.id === unit.id;
  }
  return false;
}

/** 场上（同队、存活）有没有某个 defId 的同伴 */
function hasLivingAllyDef(state: BattleState, unit: UnitState, defId: string): boolean {
  for (const other of state.units) {
    if (other.dead || other.team !== unit.team) continue;
    if (other.defId === defId) return true;
  }
  return false;
}

/** 触发一次周期效果 */
function firePeriodic(state: BattleState, unit: UnitState, effect: PeriodicEffect, defs: UnitDefTable): void {
  if (effect.type === 'allEnemiesDamage') {
    const amount = Math.floor((effectiveAttackDamage(unit, collectMods(state, unit)) * effect.attackBp) / BP);
    if (amount <= 0) return;
    // 按 id 升序打（确定性），和别的地方保持一致的顺序
    for (const enemy of state.units) {
      if (enemy.dead || enemy.team === unit.team) continue;
      dealDamage(state, unit, enemy, amount, effect.damageType, 'spell');
    }
    return;
  }

  if (effect.type === 'randomCellStrike') {
    /*
      骰子走 state.rng —— 联机两边必须落在同一格。
      ★ "5 格"是**不重复**的 5 格：重复掷到同一格就再掷（有次数上限，
      免得棋盘小的时候死循环）；上限用尽就认了重复，仍然是确定性的。
    */
    const want = Math.max(1, effect.cells ?? 1);
    const picked: number[] = [];
    for (let i = 0; i < want; i++) {
      let index = 0;
      for (let attempt = 0; attempt < 8; attempt++) {
        index = state.rng.nextInt(BOARD_W) * 100 + state.rng.nextInt(BOARD_H);
        if (!picked.includes(index)) break;
      }
      picked.push(index);

      const col = Math.floor(index / 100);
      const row = index % 100;
      for (const other of state.units) {
        if (other.dead) continue;
        if (other.cell.col !== col || other.cell.row !== row) continue;
        // 不分敌我：连自己人和自己都打
        dealDamage(state, unit, other, effect.power * FIX, effect.damageType, 'spell');
      }
      // 空放也画一下框，让玩家看得见"这一道雷落在哪"
      emitZone(state, unit, { col, row }, 0, 'square', 'damage', ZONE_FLASH_TICKS);
    }
    return;
  }

  if (effect.type === 'summon') {
    const def = defs[effect.defId];
    if (!def) return;
    for (let n = 0; n < Math.max(1, effect.count); n++) {
      const towardTop = n % 2 === 0;
      const cell = columnEndCell(state, unit.cell, towardTop);
      if (cell) spawnSummon(state, def, unit, cell, {});
    }
  }
}

/** 从 `from` 沿着同一列朝上（row→0）或朝下（row→BOARD_H-1）找第一个空格 */
function columnEndCell(state: BattleState, from: Cell, towardTop: boolean): Cell | null {
  const step = towardTop ? -1 : 1;
  const end = towardTop ? 0 : BOARD_H - 1;
  for (let row = from.row + step; towardTop ? row >= end : row <= end; row += step) {
    if (state.cellToUnit[cellIndex(from.col, row)] === CELL_EMPTY) return { col: from.col, row };
  }
  return null;
}

/**
 * 指派"血量最高者"作为攻击力加成的持有者。
 *
 * @returns 是否指派成功
 */
function assignHpCarrier(state: BattleState, team: 0 | 1, attackDamageBp: number): boolean {
  // 只从"带 highestHpCarrier 机制"的棋子里选 —— 也就是罗德岛干员
  let best: UnitState | null = null;
  for (const unit of state.units) {
    if (unit.team !== team || unit.dead) continue;
    const mechanics = unit.trait?.mechanics ?? [];
    if (!mechanics.some((mechanic) => mechanic.kind === 'highestHpCarrier')) continue;
    if (unit.statuses['carrierBonusBp'] !== undefined) continue; // 已经是持有者
    // 平局按 id 小的优先 => 确定性
    if (!best || unit.hp > best.hp || (unit.hp === best.hp && unit.id < best.id)) best = unit;
  }
  if (!best) return false;

  best.attackDamage += Math.floor((best.attackDamage * attackDamageBp) / 10000);
  // 用一个 status 记"我加成过了、数值是多少"，死亡继承时要减回去
  best.statuses['carrierBonusBp'] = attackDamageBp;
  // 用一条 buff 事件让界面能显示"这个人身上有罗德岛的加成"
  state.log.push({
    type: 'buff',
    t: state.tick,
    sourceId: best.id,
    targetId: best.id,
    stat: 'attackDamage',
    bonusBp: attackDamageBp,
    durationTicks: MAX_BATTLE_TICKS,
  });
  /*
    ★ 羁绊日志：「谁在吃这个加成」（你报的第 6 条）。
    罗德岛的加成会随"持有者阵亡"换人，所以每次指派都记一条 ——
    界面据此显示"当前持有者：XXX"，并在换人时往羁绊日志里写一行。
  */
  state.log.push({
    type: 'trait',
    t: state.tick,
    traitId: carrierTraitIdOf(state, team),
    unitId: best.id,
    kind: 'carrier',
    value: attackDamageBp,
  });
  return true;
}

/**
 * 「血量最高者吃加成」这条机制是哪个羁绊给的。
 *
 * 【为什么要现查？】
 * 继承加成的时候（持有者死了换人）身上只有一个万分比数值，
 * 没有羁绊 id —— 而羁绊日志要按羁绊分组显示。
 * 现查一次比"把字符串塞进 statuses"干净：那张表是纯数字的。
 */
function carrierTraitIdOf(state: BattleState, team: 0 | 1): string {
  for (const unit of state.units) {
    if (unit.team !== team) continue;
    for (const mechanic of unit.trait?.mechanics ?? []) {
      if (mechanic.kind === 'highestHpCarrier') return mechanic.traitId ?? 'rhodes';
    }
  }
  return 'rhodes';
}

/** 开局机制可能改了最大生命，把 spawn 事件里的数值同步过来（界面血条要用） */
function refreshSpawnMaxHp(state: BattleState): void {
  for (const event of state.log) {
    if (event.type !== 'spawn') continue;
    const unit = state.units.find((item) => item.id === event.unitId);
    if (unit) event.maxHp = unit.maxHp;
  }
}

/**
 * ★★ 0.2 MujicaAve：消耗 fever 后那一场的「特殊技能窗口」到点了 —— 回满一次技力。
 *
 * 【为什么用"绝对 tick 比对"而不是挂一条定时包、在包到期时结算？】
 * 因为这一下是**一次性动作**（"结束后会立刻回满技能条一次"）：
 *   · 包可能被别的 buff 顶掉、也可能因为棋子中途阵亡/倒地而不走正常的回收路径；
 *   · 漏跑一次，玩家就白花了一整笔 fever（他那场本该多一次技能）。
 * 而 `feverSkillUntilTick` 是记在棋子自己身上的绝对时间，只要它还活着、
 * 主循环还在推进，到点就一定会被这里看到 —— 少一个"谁负责回收"的环节。
 *
 * ★ 回蓝走 `gainMana(..., { duringSkill: true })`：
 *   1）它**会记一条 `mana` 事件** —— 客户端回放就是靠事件更新技力条的，
 *      直接写 `unit.mana` 界面上不会动（这是回放层的硬约束）；
 *   2）`duringSkill` 是必要参数：这一刻免死包可能还没回收完，
 *      不绕过"技能生效中不攒蓝"那道闸就白回了。
 */
function tickFeverWindows(state: BattleState): void {
  for (const unit of state.units) {
    if (unit.feverSkillUntilTick === undefined) continue;
    if (state.tick < unit.feverSkillUntilTick) continue;
    unit.feverSkillUntilTick = undefined;
    if (unit.dead) continue;
    gainMana(state, unit, MANA_MAX, { duringSkill: true });
  }
}

/**
 * 推进一个 tick。
 *
 * 执行顺序（顺序本身也是确定性的一部分，不能随意调整）：
 *   1. 递减所有棋子的冷却/状态
 *   2. 按 id 升序逐个棋子行动：能放技能就放，否则能打就打，否则往前走
 *   3. 检查胜负
 *
 * 【为什么不用 requestAnimationFrame 或 setTimeout 驱动？】
 * 因为战斗必须「离线可推演」：服务器要能一次性跑完 1500 个 tick 算结果，
 * 客户端要能同样的 1500 个 tick 播出动画。所以必须是纯函数式的 step 循环，
 * 跟现实时间完全脱钩。这样也顺便得到了「快进 / 回放 / 断线重连」的能力。
 */
export function step(state: BattleState, defs: UnitDefTable): void {
  if (state.over) return;
  state.tick++;

  // 0) 召唤物到期回收（迷迭香的柱子"持续20秒"）
  //    放在最前面，这样"到期的当天"它不会再出手/被打
  for (const unit of state.units) {
    if (unit.dead || unit.expiresAtTick === undefined) continue;
    if (state.tick >= unit.expiresAtTick) removeSummon(state, unit);
  }

  // 0.5) ★ 0.2 MujicaAve：特殊技能窗口到点 -> 回满一次技力（见 tickFeverWindows）
  tickFeverWindows(state);

  /*
    ★ 0.1.3：阶段切换时挂上的**一次性效果**（血骑士"复活后召唤 6 只凝血之刃"）。
    `applyUnitPhase` 是纯改数值的、拿不到 state/defs，所以它只把效果挂在 `phasePending` 上，
    由这里结算 —— 放在循环最前面，复活那一帧就能看到刀刃。
  */
  for (const unit of state.units) {
    if (unit.dead || !unit.phasePending || unit.phasePending.length === 0) continue;
    const pending = unit.phasePending;
    unit.phasePending = undefined;
    for (const effect of pending) {
      if (effect.kind === 'summon') doSummon(state, unit, effect, defs);
      else applyBattleStartEffect(state, unit, effect);
    }
  }

  /*
    ★★ 0.2 羁绊「不屈」：复活之后"立刻释放一次技能"。

    这一格分两条路：
      · **有主动效果**的棋子：`killUnit` 已经把法力灌满了，走 `actUnit` 里那套正常施法，
        所以这里什么都不用做（不然会放两次）。
      · **纯被动**的棋子（`effects` 为空 —— 砾 / 耀骑士临光 / 伊内丝都是）：
        灌满法力也没东西可放，所以把它的**开局效果（`battleStart`）重新应用一次** ——
        砾（op19）就是"护盾 + 35 护甲/魔抗 10 秒"再来一遍（用户口径："砾复活后护盾可以刷新一次"）。

    【为什么不在 `killUnit` 里直接做？】
    因为星级解析（`skillVariantOf`）和效果的落地（`applyBattleStartEffect`）都在
    这个文件 / `skills.ts` 里，而 `combat-math.ts` 是被它们 import 的一方 ——
    反过来 import 就是循环依赖。所以 `killUnit` 只留一个 `reviveSkillPending` 标记，
    由这里办（和上面 `phasePending` 同一套做法）。

    ★ 濒死时旧护盾一般已经被打破了（不打破就打不死），所以观感就是"刷新"；
      万一那次是真实伤害绕过护盾打死的，旧盾还在，这一下会**叠加**。
    */
  for (const unit of state.units) {
    if (unit.dead || !unit.statuses['reviveSkillPending']) continue;
    delete unit.statuses['reviveSkillPending'];
    const def = defs[unit.defId];
    if (!def) continue;
    const variant = skillVariantOf(def, unit.star);
    // 有主动效果 => 走"灌满法力 + 正常施法"那条，别在这儿重复触发
    if (variant.effects.length > 0) continue;
    for (const effect of variant.battleStart ?? []) {
      applyBattleStartEffect(state, unit, effect);
    }
  }

  // 1) 冷却与状态倒计时
  for (const unit of state.units) {
    if (unit.dead) continue;
    /*
      ★ 0.0.3：先看"倒地等复活的 Boss"该不该站起来了。
      站起来之前它什么都不做（不能攻击不能移动，也不回蓝），
      所以下面的状态倒计时/技能推进全部跳过。
    */
    tickDowned(state, unit);
    if (unit.downedUntilTick !== undefined) continue;
    if (unit.moveCooldown > 0) unit.moveCooldown--;
    tickStatuses(state, unit);
    // ★ 0.2：护盾单独结算（衰减 / 到期 / 破盾补盾），见 combat-math.ts 的 tickShield
    tickShield(state, unit);

    /*
      羁绊的两件"每 tick 要做的事"：
        · 临时攻速加成的倒计时（维多利亚的低血爆发有时限）
        · 低血爆发的触发检查（血量第一次跌破阈值时生效）
      放在这里而不是攻击函数里，是因为"血量跌破阈值"可能由任何来源造成
      （普攻、技能、溅射、斩杀），挂在一处必然会漏。
    */
    const runtime = unit.trait;
    if (runtime) {
      if (runtime.surgeTicks > 0) {
        runtime.surgeTicks--;
        if (runtime.surgeTicks === 0) {
          // 到点了：把"有时限的那部分"攻速/攻击力收回去。
          // 因为临时加成是单独存的，这里直接清零就行，不会误伤永久叠层。
          runtime.surgeSpeedBp = 0;
          runtime.surgeAttackBp = 0;
        }
      }
      checkLowHpSurge(state, unit, runtime.mechanics);
    }

    // 技能：自动回蓝 / 增益倒计时 / 脉冲 / 持续伤害 / 队友救援
    tickSkill(state, unit);

    /*
      ★ 0.0.3：野怪的"周期类"机制（落雷 / 成对回血 / 定期召唤）。
      放在技能之后 —— 顺序固定是确定性的一部分。
    */
    tickUnitMechanics(state, unit, defs);

    /*
      ★ 0.1.1 藏品二版：残血一次性护盾（染血辞典）与低血回蓝（止痛片）。
      放在机制之后 —— 顺序固定是确定性的一部分。
    */
    tickItemMechanics(state, unit);
  }

  // 1.5) ★ 0.2 新约能天使：技能"挂到别人身上"的东西（队友减益 / 剩余护盾）的回收。
  // 必须**对所有单位（含已阵亡的施法者）**跑一趟 —— 施法者中途被打死时，
  // 挂在队友身上的那份减益同样要还回去，所以不能并进上面那个 `if (unit.dead) continue` 的循环。
  for (const unit of state.units) tickSkillAttachments(state, unit);

  // 1.6) 需要"跟着状态变化换人"的机制（罗德岛的最高血量持有者继承）
  tickTraitMechanics(state);

  /*
    ★ 0.0.3 藏品（B 类）：队伍级的周期机制（急救药箱每 3 秒给全体回血）。
    放在"羁绊换人"之后、"陷阱爆炸"之前 —— 顺序本身是确定性的一部分，
    写在这里是为了让它固定下来（改顺序会改变同种子下的战斗过程）。
  */
  tickTeamMechanics(state);

  // 1.7) 陷阱检查：棋子周围出现敌人就爆炸（望）
  tickTraps(state);

  // 1.8) 狂暴：打满 40 秒后全场攻击力/攻速大幅提升（见 constants.ts 的说明）
  tickRage(state);

  // 2) 行动。array 顺序固定（id 升序），这是确定性的关键
  //
  // ★ 遍历的是**一份快照**，不是 state.units 本身。
  //
  // 【为什么？—— 加了召唤物之后这里变成了一个真 bug】
  // 棋子放技能时会召唤出新的单位（迷迭香的柱子、维娜的金狮子、望的棋子），
  // 而 `spawnSummon` 会 `state.units.push(...)` 之后**再 sort 一次**。
  // 如果正在用 `for (const unit of state.units)` 遍历这个数组：
  //   · for...of 是按**下标**走的，push 之后长度变长 -> 新召唤物会被"顺路"访问到
  //     （它这一帧本来不该行动）
  //   · 更糟的是 sort 会**打乱正在遍历的数组** -> 有的棋子这一帧被跳过、有的被走两遍
  // 结果就是战斗过程变得莫名其妙（而且**双方算出来仍然一致**，所以校验和查不出来）。
  // 用快照就干净了：这一帧要行动的棋子在一开始就定好，
  // 中途召唤出来的东西从下一帧才开始参与。
  for (const unit of [...state.units]) {
    if (unit.dead) continue;
    // ★ 0.0.3：倒地等复活的 Boss 这一帧不行动
    if (unit.downedUntilTick !== undefined) continue;

    /*
      ★★ 0.1.3 修：「自动回蓝」的棋子**法力一满就立刻放技能**，不再等下一次行动。
      【原来错在哪】满蓝之后要等 `nextActionTick` 轮到它 —— 而那个时刻由**攻击间隔**决定
      （锏攻速 1.8 -> 14 tick = 0.7 秒），于是"每 10 秒一次"实际变成 10~10.7 秒，
      玩家看到的就是"技能条明明满了、它却停一下才放"（用户报的就是这条）。
      【为什么只对 `auto`？】攻击 / 受击回蓝的棋子，满蓝那一刻本来就在行动中，
      提前放会改掉它们"打一下才放技能"的节奏 —— 那是设计的一部分，不动。
    */
    if (unit.manaSource === 'auto' && canCast(unit)) {
      const skillDef = defs[unit.defId];
      const autoEffects = unit.phaseSkill
        ? unit.phaseSkill.effects
        : skillDef
          ? skillVariantOf(skillDef, unit.star).effects
          : [];
      if (skillDef && autoEffects.length > 0) {
        // castSkill 末尾会把法力清零，所以不会在同一个 tick 里连放
        castSkill(state, unit, skillDef.skill.id, autoEffects, defs, castFxOf(skillDef, unit.star));
        continue;
      }
    }

    if (state.tick < unit.nextActionTick) continue;

    // 被控住了：这次行动作废，并顺延
    const stun = unit.statuses['stun'] ?? 0;
    if (stun > 0) {
      unit.nextActionTick = state.tick + stun;
      continue;
    }

    actUnit(state, unit, defs);
  }

  // 3) 胜负检查
  checkBattleEnd(state);
}

/**
 * 陷阱：周围 3×3（**八格**，含斜角）出现敌人就爆炸。
 *
 * 【为什么不在 actUnit 里做？】
 * 因为陷阱"不行动"（noAttack + noMove），它只是在等。
 * 而且爆炸是**环境事件**，不该占用它的行动机会。
 *
 * ★★ 0.2 修（用户报"望的棋子应该是周围 8 格触发"）：
 * 原来这里判的是 `cellDistance(unit.cell, other.cell, style) > trap.radius`，
 * 而 `cellDistance` 对**四方向移动**的棋子算的是**曼哈顿距离** ——
 * `radius: 1` 于是只覆盖上下左右 4 格，**斜着走进来的敌人踩不到雷**。
 * （棋子自己就是 noMove 的四方向单位，所以这条在实践中 100% 生效。）
 * 现在改走棋盘几何的唯一实现 `withinShape(..., 'square')` ——
 * 方形用的是切比雪夫距离（|Δ列| ≤ r 且 |Δ行| ≤ r），
 * `radius: 1` 正好就是"周围 8 格"。
 * ★ 同一个坑在 `withinRadius` 的注释里记过一次（"炮手 3×3 实际只打到十字"），
 * 凡是"周围 N 格"的范围判定都别再自己写距离函数。
 */
function tickTraps(state: BattleState): void {
  for (const unit of state.units) {
    if (unit.dead || !unit.trap) continue;
    const trap = unit.trap;
    const style = moveStyleOf(unit);
    const hit: UnitState[] = [];
    for (const other of state.units) {
      if (other.dead || other.team === unit.team) continue;
      if (!withinShape(unit.cell, unit.cell, other.cell, trap.radius, 'square', style)) continue;
      hit.push(other);
    }
    if (hit.length === 0) continue;

    // 爆炸：对范围内所有敌人造成一次法术伤害，然后自己消失
    for (const enemy of hit) {
      dealDamage(state, unit, enemy, trap.power, trap.damageType, 'spell', unit.summonOwnerId ?? unit.id);
    }
    removeSummon(state, unit);
  }
}

/**
 * ★ 狂暴（你要求的第 14 条）：战斗打到 40 秒时，全场攻击力/攻速大幅提升。
 *
 * 【为什么不每 tick 加一次？】
 * 那样会无限叠加上去，10 tick 之后伤害就爆表了。
 * 这里用 `state.tick === RAGE_START_TICKS` 精确触发一次 ——
 * tick 是单调递增的，这个判断在整个战斗里只会成立一次，
 * 所以不需要额外的"是否已触发"标志（状态越少越不容易算错）。
 *
 * 【为什么走 statuses 而不是直接改 unit.attackDamage？】
 * 因为 statuses 是**临时修正**那一层，所有属性计算（collectMods）
 * 本来就会把它叠上去。直接改基础值会污染"面板攻击力"，
 * 而面板攻击力是要显示给玩家看、也要被技能按比例引用的。
 */
function tickRage(state: BattleState): void {
  if (state.tick !== RAGE_START_TICKS) return;
  for (const unit of state.units) {
    if (unit.dead) continue;
    unit.statuses['attackSpeedBuff'] = MAX_BATTLE_TICKS * 4;
    unit.statuses['attackSpeedBonusBp'] = RAGE_SPEED_BP;
    unit.statuses['attackDamageBuff'] = MAX_BATTLE_TICKS * 4;
    unit.statuses['attackDamageBonusBp'] = RAGE_ATTACK_BP;
  }
}

/** 单个棋子的一次行动 */
function actUnit(state: BattleState, unit: UnitState, defs: UnitDefTable): void {
  const def = defs[unit.defId];
  const mods = collectMods(state, unit);
  const interval = attackInterval(effectiveAttackSpeed(unit, mods));

  // --- 情况 A：法力满了，先放技能 ---
  // ★ 0.0.3：多阶段野怪用 unit.phaseSkill（换阶段时被替换过的那套），其余棋子走数据表
  const activeSkill = unit.phaseSkill ?? null;
  const skillEffects = activeSkill ? activeSkill.effects : def ? skillVariantOf(def, unit.star).effects : [];
  if (def && canCast(unit) && skillEffects.length > 0) {
    unit.nextActionTick = state.tick + interval;
    castSkill(state, unit, def.skill.id, skillEffects, defs, castFxOf(def, unit.star));
    return;
  }

  // 「没有技能时不进行主动移动和攻击」（玛恩纳的被动）
  if (mods.noMove && mods.noAttack) {
    unit.nextActionTick = state.tick + interval;
    return;
  }

  /*
    「不会攻击」（夜莺）—— 直接跳过整个索敌流程。
    【为什么连走位也跳掉？】
    因为她根本打不出伤害，朝敌人走过去没有任何意义，只会把自己送到对面脸上。
    治疗/光环类棋子"待在原地给队友上 buff"才是它该有的行为。
  */
  if (mods.noAttack) {
    unit.nextActionTick = state.tick + interval;
    return;
  }

  /*
    ★ 0.1.3：**护送型召唤物**（血骑士的凝血之刃）—— 整段行为由 escort 机制接管：
    不索敌、不攻击，只朝主人走；贴近了就把效果"送达"，然后自己消失；主人没了自己也消失。
    ★ 放在"找目标"之前 —— 它根本不需要敌人。
    ★ 查的是 `def.mechanics`（写在数据里的那层），**不是** `unit.trait.mechanics`：
    后者是羁绊用的运行时结构，召唤物拿不到整份（见 combat-math 的 spawnSummon 说明）。
  */
  const escort =
    unit.trait?.mechanics?.find((m) => m.kind === 'escort') ??
    def?.mechanics?.find((m) => m.kind === 'escort');
  if (escort) {
    runEscort(state, unit, escort);
    unit.nextActionTick = state.tick + interval;
    return;
  }

  // --- 找目标 ---
  // 【注意：当前目标可能"已经打不到了"】
  // 飞行单位对近战不可选中，而"谁是飞行"是在开战时定下的，
  // 但飞行干员自己可能被羁绊/状态改变射程 —— 所以这里每次都重新校验一次，
  // 不合格就重新选目标。不校验的话会出现"近战贴着一个打不到的飞行单位干站着"。
  let target = unit.targetId >= 0 ? getUnit(state, unit.targetId) : undefined;
  const reach = effectiveRange(state, unit);
  if (!target || target.dead || !canTargetUnit(state, unit, target)) {
    unit.targetId = selectTarget(state, unit, { preferLowestHp: mods.preferLowestHp });
    target = unit.targetId >= 0 ? getUnit(state, unit.targetId) : undefined;
  } else if (cellDistance(unit.cell, target.cell, moveStyleOf(unit)) > reach) {
    /*
      ★ 「锁着的目标够不着了，但旁边就有更近的敌人」—— 必须换目标。
      【不复现就想不到的场景】（你报的第 8 条）
      赤刃明霄陈 3 星会瞬移到敌人堆里。落地之后它锁着的还是**瞬移前**那个
      远处的目标，而四周已经被敌人贴满：
        · 射程 1，够不着那个远目标 -> 走位
        · 四个方向里"能靠近"的格子全被贴脸的敌人占着 -> 贪心寻路一步都走不动
      结果就是它拿着 +1000% 攻击力原地罚站到死，一条伤害都打不出来。
      这里补一句：够不着就重新选一次最近的敌人 —— 贴脸的那个立刻就能打。
      只在"确实够不着"时才重新选，所以正常对局的目标锁定完全不变。
    */
    const nearer = selectTarget(state, unit, { preferLowestHp: mods.preferLowestHp });
    const candidate = nearer >= 0 ? getUnit(state, nearer) : undefined;
    const style = moveStyleOf(unit);
    if (candidate && cellDistance(unit.cell, candidate.cell, style) < cellDistance(unit.cell, target.cell, style)) {
      unit.targetId = nearer;
      target = candidate;
    }
  }

  // 没有能打的目标了
  //
  // 【这里有两种情况，处理方式不一样】(对应你报的"近战打不到飞行单位就挂机")
  //   a) 场上一个敌人都没有 -> 真的没事干，站着等主循环结算（下一 tick 就结束了）
  //   b) 有敌人，但全都打不到（比如敌方**全是飞行单位**，近战射程 1）
  //      -> 不能站着罚站！朝最近的敌人走过去。
  //         反正碰不到它，但至少不像卡住了；玩家也能一眼看出
  //         "我这队近战完全够不着，得补远程/术士"，而不是以为游戏坏了。
  //
  // ★ 0.1.4：注意"打不到"和"不该走向"是两回事。
  //   飞行单位属于"打不到但可以走过去"；**隐匿单位属于"根本不该走向"**
  //   （你的新规则：「也不会走向有隐匿的单位」）—— 这两种筛选由
  //   `nearestApproachTarget` 内部区分，这里不用管。
  if (!target || target.dead) {
    const fallbackId = nearestApproachTarget(state, unit);
    const fallback = fallbackId >= 0 ? getUnit(state, fallbackId) : undefined;
    if (fallback && !fallback.dead) {
      const moved = tryMoveToward(state, unit, fallback);
      // 朝一个"打不到的目标"走也会被挡住时，换一个绕得过去的敌人走
      if (!moved && unit.blockedTicks >= BLOCKED_RETARGET_TICKS) {
        const alt = selectReachableTarget(state, unit);
        if (alt >= 0 && alt !== unit.targetId) {
          unit.targetId = alt;
          unit.blockedTicks = 0;
        }
      }
      unit.nextActionTick = state.tick + Math.max(1, Math.ceil(interval / 2));
      return;
    }
    unit.nextActionTick = state.tick + 1;
    return;
  }

  // --- 情况 B：在射程内，攻击 ---
  // 距离算法跟着棋子的移动方式走：四方向走的棋子，射程也算曼哈顿距离。
  // 射程取的是**技能加成之后**的值（空弦 +2、号角 +2、澄闪全场…）
  if (cellDistance(unit.cell, target.cell, moveStyleOf(unit)) <= reach) {
    /*
      ★ 0.1.3 战栗：够得着也**打不出这一下** —— 但要和 `noAttack` 区别对待。
      上面那个 `noAttack` 是"这个棋子根本打不出伤害"，所以连索敌和走位都跳过；
      战栗只是"手被按住"：**走位照旧、技能照放**，只吃掉普攻。
      所以这里只是不调 performAttack，不能提前 return 整个流程。
    */
    if (!mods.disarmed) performAttack(state, unit, target);
    unit.nextActionTick = state.tick + interval;
    return;
  }

  // --- 情况 C：走位 ---
  // 「不主动移动」的棋子（魔王）只打不走
  if (mods.noMove) {
    unit.nextActionTick = state.tick + interval;
    return;
  }
  tryMoveToward(state, unit, target);
  /*
    ★ 连续挪不动 -> 换一个"真的走得到"的敌人（你报的第 4 条）。
    没有这一段的话，后排近战被队友堵住时会一直锁着那个
    几何上最近、路径上却永远走不到的敌人，原地站到死。
    只在"确实卡住"时才换人，所以正常对局的目标锁定一个字节都不会变。
  */
  if (unit.blockedTicks >= BLOCKED_RETARGET_TICKS) {
    const alt = selectReachableTarget(state, unit);
    if (alt >= 0 && alt !== unit.targetId) {
      unit.targetId = alt;
      unit.blockedTicks = 0;
    }
  }
  // 移动也要占一次行动，但间隔短一些，观感更流畅
  unit.nextActionTick = state.tick + Math.ceil(interval / 2);
}

/**
 * 普通攻击。
 *
 * 【这里挂了大部分羁绊和技能的"攻击那一刻"效果】
 * 羁绊方面（16 个里 8 个在攻击时生效）：
 *   萨卡兹  攻击附带法术伤害      法术  攻击附带目标最大生命百分比伤害
 *   炮手    攻击溅射 3×3          术士  额外攻击 N 个敌人
 *   剑士    每 3 次叠攻速          远射  每次攻击叠攻速
 *   拉特兰  累计 N 次全体核爆      炎    斩杀残血
 *
 * 技能方面（同一个位置，走的是"修正包"）：溅射、额外目标、连续攻击、
 * 伤害类型改写、附带伤害、眩晕概率、吸血、远距离加成、对某标签增伤。
 *
 * 【为什么顺序也是"确定性"的一部分？】
 * 因为它决定了"谁先死、谁还能再挨一下"。
 * 比如溅射和斩杀的先后不同，结果可能就不一样。
 * 所以顺序写死在这里，不依赖任何数据表的顺序。
 *
 * 顺序：闪避/免疫 -> 主目标伤害 -> 附带伤害 -> 溅射 -> 斩杀 -> 额外目标 -> 计数类
 */
/**
 * ★ 0.1.3：护送型召唤物的一次行动（血骑士的凝血之刃）。
 *
 * 三种结果，按优先级：
 *   1. **主人没了** -> 自己消失（用户口径："若血骑士死亡，则场地上所有凝血之刃一起死亡"）；
 *   2. **已经贴到主人身边** -> 送达：治疗 + 挂一份限时属性包，然后自己消失；
 *   3. 否则 -> 朝主人走一步。
 *
 * 【为什么用 `removeSummon` 而不是 `killUnit`？】
 * 它是**自己消散**、不是被打死 —— 不该记 death 事件、不给对面回蓝、也不参与"剩余人数"结算。
 */
function runEscort(
  state: BattleState,
  unit: UnitState,
  escort: Extract<ScopedMechanic, { kind: 'escort' }>,
): void {
  const owner = state.units.find(
    (other) => !other.dead && other.team === unit.team && other.defId === escort.targetDefId,
  );
  if (!owner) {
    removeSummon(state, unit);
    return;
  }

  if (cellDistance(unit.cell, owner.cell, moveStyleOf(unit)) <= escort.range) {
    if (escort.healBp) {
      healUnit(state, owner, owner, Math.floor((owner.maxHp * escort.healBp) / BP));
    }
    if (escort.stats && owner.skill) {
      /*
        ★ 用户口径：这份 +50% **不叠加** —— 多只刀刃送达也只算一份，重复送达只是**刷新时长**。
        做法：先把上一次"送达"留下的那份摘掉，再挂新的。
        用负数 sourceId 当标记（`ESCORT_SOURCE_ID`）—— 用主人自己的 id 会误伤
        主人自己放技能挂的那些包。
      */
      owner.skill.buffs = owner.skill.buffs.filter((buff) => buff.sourceId !== ESCORT_SOURCE_ID);
      owner.skill.version++;
      addBuff(owner, {
        stats: escort.stats,
        ticksLeft: escort.buffTicks ?? 200,
        sourceId: ESCORT_SOURCE_ID,
      });
    }
    removeSummon(state, unit);
    return;
  }

  tryMoveToward(state, unit, owner);
}

/** ★ 0.1.3：护送型召唤物"送达"时那份属性包的来源标记（负数，绝不会和棋子 id 撞） */
const ESCORT_SOURCE_ID = -1;

/**
 * ★★ 0.2：「这一击是不是"每第 N 次攻击"那一击」—— **判据唯一实现**。
 *
 * `attackCount` 是在 `onAttackLanded()` 里自增的（也就是"本次攻击"还没算进去），
 * 所以判据要 `attackCount + 1`。
 *
 * 【为什么要抽出来？】0.2 起有两个消费方：克洛丝/芳汀的"额外一段伤害"
 * （`mods.everyNthAttack.bonus`）和可露希尔的"额外攻击 1 名目标"
 * （`mods.everyNthAttack.extraTargets`）。两处各抄一遍 `% every === 0` 的话，
 * 以后"第 0 次算不算"这种口径一改就会只改到一半。
 */
function isEveryNthAttackHit(unit: UnitState, every: number): boolean {
  const runtime = unit.skill;
  if (!runtime) return false;
  return (runtime.attackCount + 1) % Math.max(1, every) === 0;
}

function performAttack(state: BattleState, attacker: UnitState, target: UnitState): void {
  const mods = collectMods(state, attacker);
  const mechanics = attacker.trait?.mechanics ?? [];
  const style = moveStyleOf(attacker);

  /*
    ★★ 0.3.1 盟约「药枚实验」（桑葚）：被标记的（最右一列）单位**每次攻击**
    有 20% 概率获得 1 层次数护盾。

    【为什么放在函数最前面？】
    "每次攻击"是一个**事件**，不是"每次造成伤害" —— 连击 / 溅射 / 额外目标
    都只算一次攻击。放在这里天然就是一次，不会因为打了几个人而多掷几次。

    【为什么要先看标记？】
    只有战斗开始时被 `applyCovenantBattleStart` 标过的单位才掷骰。
    没标记的单位**一次随机数都不消费** ⇒ 不会推动整场的随机序列，
    别的棋子的概率判定（暴击/闪避/连击）一个都不会错位。
  */
  if (attacker.statuses['cvChargeShield']) {
    const cfg = covenantRightmostChargeShield(state.covenantIds?.[attacker.team]);
    if (cfg && state.rng.nextInt(10000) < cfg.chanceBp) {
      attacker.statuses['shieldCharges'] = (attacker.statuses['shieldCharges'] ?? 0) + cfg.charges;
    }
  }

  /*
    ★ 0.2：**每击随机换目标**（维什戴尔"每次攻击都随机攻击攻击范围内的敌人"）。
    放在最前面 —— 后面所有伤害/溅射/附伤/AI 都按"这一击真正打的那个人"算。
    ★ 只在有这条机制时才掷骰（不消耗 rng ⇒ 别的棋子的随机序列一点不变）；
    射程内没别人时照旧打原目标（不空放）。
  */
  if (mods.randomAttackTarget) {
    const reach = effectiveRange(state, attacker);
    const candidates = state.units.filter(
      (other) =>
        !other.dead &&
        other.team !== attacker.team &&
        cellDistance(attacker.cell, other.cell, style) <= reach,
    );
    if (candidates.length > 0) target = candidates[state.rng.nextInt(candidates.length)]!;
  }

  /*
    「攻击改为治疗队友」（芙蓉）是最特殊的一种：它把整次攻击的性质换掉了。
    所以放在最前面单独处理，后面那些"伤害相关"的机制一概不参与。
  */
  if (mods.attackHeals) {
    state.log.push({ type: 'attack', t: state.tick, unitId: attacker.id, targetId: attacker.id, attackType: 'attack' });
    const ally = resolveAllyTarget(state, attacker, 'lowestHpAlly');
    if (ally) {
      /*
        ★ 0.2：治疗量可以是**两条基准相加**（芙蓉 = 自身攻击力 110/120/125% + 目标生命上限 3%/6%/10%）。
        唯一实现是 `mods.ts` 的 `healAmountOf()`，别再在这里自己算一遍。
      */
      const amount = healAmountOf(attacker, ally, mods.attackHeals);
      if (amount > 0) healUnit(state, attacker, ally, amount);
    }
    // 治疗也算"出手"，所以要回蓝（否则芙蓉永远放不出第二个技能）
    if (gainsManaFromAttack(attacker)) gainMana(state, attacker, attacker.statuses['manaPerAttack'] ?? 100);
    onAttackLanded(state, attacker, target, mechanics);
    return;
  }

  /*
    ★★ 0.2 MujicaAve：「每次**受到攻击**时 fever +1」。
    放在这里 = 这一击**真打出去了**（重新锁定目标之后、治疗型攻击那条支路之外）。
    ★ 一次攻击只算一次（多段连击算一次"收到攻击"，因为"受到攻击"描述的是**被打这件事**，
      而"造成伤害"那半边才是按每一次伤害结算算的 —— 两个口径故意不同，
      见 trait-data 的 `onHit` / `onDeal` 说明）。
  */
  addFeverFor(state, target, 'onHit');

  // ---- 0) 伤害类型 / 攻击力 ----
  /*
    ★ 0.2 术士：普攻改成"攻击力 × attackBp 的**法术**伤害"。
    同一条机制可能出现两份 —— `TraitDef.innate` 的无条件版（100%）和
    激活档位的加强版（110/120/150%）—— 所以取 attackBp 最大的那份。
  */
  const magicAttackBp = mechanics.reduce(
    (best, item) => (item.kind === 'magicAttack' ? Math.max(best, item.attackBp) : best),
    0,
  );
  // 「攻击变为法术攻击」改写的是伤害类型，不改攻击力数值
  const damageType = mods.damageTypeOverride ?? (magicAttackBp > 0 ? 'magic' : 'physical');
  /*
    ★ 0.2 剑士「每次攻击有 X% 概率触发 2 连击（连击不会再次触发连击效果）」。
    实现成"掷一次骰、多打一段"——因为**只掷一次**，
    "连击不再触发连击"就是天然成立的，不需要额外的递归保护。
  */
  const doubleMech = mechanics.find((item) => item.kind === 'probDoubleAttack');
  const extraHit = doubleMech && state.rng.nextInt(10000) < doubleMech.chanceBp ? 1 : 0;
  const hits = Math.max(1, mods.multiHit) + extraHit;
  /*
    ★ 0.1.3：连击**每一段**的伤害比例（锏的被动是 2 段 ×90%）。
    乘在"每段的基础伤害"上，所以后面那些增伤（对某标签 / 残血增伤）照常生效。
    不写 = 每段满额（老行为，维什戴尔那批）。
  */
  const perHitDamage = Math.floor((effectiveAttackDamage(attacker, mods) * mods.multiHitBp) / BP);
  const baseDamage = magicAttackBp > 0 ? Math.floor((perHitDamage * magicAttackBp) / BP) : perHitDamage;

  /*
    ★ 0.0.3：「攻击残血目标增伤」（“盛怒”：目标血量低于一半时伤害 +50%）。
    在**每一段**伤害之前判定 —— 连击的第 3 段把目标打到半血以下时，
    第 4 段就该吃到加成（按"打出去的瞬间"算最自然）。
  */
  const executeBonusBp = executeBonusAgainst(mechanics, target);

  let dealt = 0;
  /*
    ★★ 0.2：**自定义弹道**（丰川祥子的音符 / 祐天寺若麦的五连击）。
    每段有自己的倍率、甚至自己的伤害类型，所以先把"这一击打几下、每下多少"排成一张表，
    再统一走下面那段循环 —— 这样"逐段的眩晕/战栗判定""对某标签增伤""吸血统计"
    都还是同一份实现，不会因为多开一条路而走散。
  */
  const profile = mods.attackProfile;
  /*
    ★ 0.2.1：普攻贴图特效的 key（`UnitDef.combatFx`）。没有就是 undefined ⇒ 渲染层走原来那套
    "弧 + 爆点"的程序化特效，行为一个字节都不变。纯表现层，不进校验和。
  */
  const attackerDef = state.defs[attacker.defId];
  /*
    ★★ 0.2.1：两条"这一下该不该用**普攻专属**表现"的闸门（都是纯表现层）：
      ① `combatFxBasicOnly` —— 技能生效期间的攻击让位给技能自己的表现。
         菲亚梅塔的技能把普攻变成 5×5 轰击，那一发不该是"1 格炮弹爆炸"；
         号角 / 灰毫 / 空爆 的技能只是加数值，没这个标记 ⇒ 技能照旧用炮弹。
      ② 这一发自己带 `splash.fx`（维什戴尔 3 星的 5×5 爆炸）——
         那套爆炸已经负责"这一发是什么技能"，再叠一个 1 格的普攻爆炸只是糊。
         弹道不受这一条影响：炮弹照样飞过去，落点才换成 5×5 大爆炸。
  */
  const skillOwnsFx = attackerDef?.combatFxBasicOnly === true && isSkillActive(state, attacker);
  const splashOwnsFx = mods.splash?.fx !== undefined;
  const combatFxKey = skillOwnsFx || splashOwnsFx ? undefined : attackerDef?.combatFx;
  /*
    ★ 0.2.1 表现层：远程弹道的贴图（澄闪的粉色闪电）。
    ★ 优先用 `attackProfile.fx`（祥子的音符），没有才用单位自己的 `tracerFx` ——
      两者都在**内核这一处**决定，渲染层只认字符串。
  */
  const tracerFxKey = skillOwnsFx ? undefined : attackerDef?.tracerFx;
  const eventFx = profile?.fx ?? tracerFxKey;
  const plan: Array<{ damage: number; damageType: DamageType }> = [];
  if (profile) {
    for (const step of profile.hits) {
      let value = Math.floor((effectiveAttackDamage(attacker, mods) * step.bp) / BP);
      // 术士那种"普攻整体转法术"仍然生效（除非这一段自己指定了类型）
      if (magicAttackBp > 0 && !step.damageType) value = Math.floor((value * magicAttackBp) / BP);
      plan.push({ damage: value, damageType: step.damageType ?? damageType });
    }
  } else {
    for (let index = 0; index < hits; index++) plan.push({ damage: baseDamage, damageType });
  }

  for (const [hitIndex, step] of plan.entries()) {
    if (target.dead) break;
    /*
      ★ 若麦："技能期间随机攻击范围内的目标" ⇒ 这**一下**换人，不是整次攻击换人。
      随机走 `state.rng`，联机两边掷出同一个。
    */
    if (profile?.randomTarget) {
      const picked = randomTargetInRange(state, attacker);
      if (picked) target = picked;
    }
    const victims =
      profile && (profile.maxTargets > 1 || profile.pierceLength > 0)
        ? pierceVictims(state, attacker, target, profile)
        : [target];
    for (const victim of victims) {
      if (victim.dead) continue;
      state.log.push({
        type: 'attack',
        t: state.tick,
        unitId: attacker.id,
        targetId: victim.id,
        attackType: 'attack',
        // ★ 0.2 表现层：自定义弹道（祥子的音符 / 澄闪的粉色闪电）—— 渲染层据此换特效
        ...(eventFx ? { fx: eventFx } : {}),
        // ★ 0.2.1 表现层：这一枪该播哪套贴图特效（能天使的枪口火光/命中火花）
        ...(combatFxKey ? { combatFx: combatFxKey } : {}),
        /*
          ★ 0.2.1 表现层：连击的第几段（单发不写）。
          维什戴尔 1/2 星的 3 连击在同一 tick 报 3 条 ⇒ 渲染层靠它把第 2/3 次爆炸
          依次延后几十毫秒，才看得到"连续炸三下"。
        */
        ...(plan.length > 1 ? { hitIndex } : {}),
      });
      // 连续攻击的每一次都要走一遍"对某标签增伤"
      let raw = applyVsTraitBonus(state, attacker, victim, step.damage, mods);
      // ★ 0.3 近卫：对**射程 ≥ N** 的干员伤害提升到 X%（逐段算，和上面那条同一个时机）
      raw = applyRangeAmpBonus(victim, raw, mods);
      if (executeBonusBp > 0) raw = Math.floor((raw * (BP + executeBonusBp)) / BP);
      dealt += dealDamage(state, attacker, victim, raw, step.damageType, 'attack');
    }
    /*
      ★ 0.0.3 彩蛋：连击**逐段**判定眩晕。
      维维美写的是「30%（连击单独计算）概率眩晕目标 1 秒」——
      3 连击就是 3 次独立掷骰（至少中一次约 65.7%），而不是整次攻击只掷一次。
      默认（perHit 不写）仍然是老行为：整次攻击只判定一次，见下面第 5 步。
    */
    if (mods.stunOnHit?.perHit && !target.dead) {
      if (state.rng.nextInt(10000) < mods.stunOnHit.chanceBp) {
        applyStun(state, attacker, target, mods.stunOnHit.durationTicks);
      }
    }
    /*
      ★ 0.1.3：战栗也是**逐段**判定（锏的"连击单独判定"）。
      和上面眩晕那段完全同构，只是挂上去的是 `disarmed` —— 逐段掷骰的手感差别
      参考维维美那条注释（3 连击至少中一次的概率远高于单次）。
    */
    if (mods.disarmOnHit?.perHit && !target.dead) {
      if (state.rng.nextInt(10000) < mods.disarmOnHit.chanceBp) {
        addBuff(target, {
          stats: { disarmed: true },
          ticksLeft: mods.disarmOnHit.durationTicks,
          sourceId: attacker.id,
        });
      }
    }
  }

  /*
    ★ 0.0.3：攻击附带流血（拾荒者「5 秒内每秒扣最大生命 1%」）。
    挂在目标身上、由目标自己逐 tick 结算 —— 所以"打一下就跑"也照常掉血。
  */
  if (!target.dead) {
    for (const mechanic of mechanics) {
      if (mechanic.kind !== 'bleed') continue;
      addTimed(target, {
        kind: 'dot',
        sourceId: attacker.id,
        amount: Math.floor((target.maxHp * mechanic.ratioBp) / BP),
        damageType: 'physical',
        intervalTicks: Math.max(1, mechanic.intervalTicks),
        ticksLeft: Math.max(1, Math.floor(mechanic.durationTicks / Math.max(1, mechanic.intervalTicks))),
        timer: 0,
      });
      break;
    }
  }

  /*
    ★★ 0.2 炎国「每次攻击给目标附着燃烧减益」：
    每层每秒造成目标**最大生命** perSecondBp 的法术伤害，最多 maxStacks 层，
    **每次被附着都把身上所有燃烧层的持续时间刷成满**（表里写的是"每次被附着刷新持续时间"）。

    走 `addTimed` 的 dot 通路（和流血同一套：挂在目标身上、目标自己逐 tick 结算，
    所以"打一下就跑"也照常掉血）。用 `tag: 'burn'` 把自己那几条挑出来 ——
    这样"数层数"和"刷新时长"都不需要额外的战斗状态。

    ★★ 0.2 修（用户报"燃烧没有叠加和重复刷新时长"，实测确认）：
    原来只有"已经满层"那一条分支才刷新，其余情况一律只新增一层。
    于是单位最常见的节奏（攻击间隔 ≈ 燃烧时长）下是这样的：
    每 20 tick 攻击一次、每层也正好 20 tick 掉一跳 ⇒ 每次攻击前刚好有一层到期，
    层数**停在 5 就不再增长**，而 `burns.length >= maxStacks` 那条刷新分支
    **几乎永远不会执行**：早附着的那几层一直挂在"还剩 1 跳"上，
    界面上读到的正是它们 ⇒ 看起来既没叠层、时长也不刷新。
    现在改成"每次都刷"：语义正好是"这个减益一直被维持着，
    从最后一次附着算起 5 秒后才整体散掉"，和表的说法一致。

    ⚠️ 层数上限只管**新增**：满层之后不再加条，但**照常刷新**。
  */
  if (!target.dead) {
    for (const mechanic of mechanics) {
      if (mechanic.kind !== 'burnStack') continue;
      const timed = target.skill?.timed;
      if (!timed) break;
      const interval = 20; // 每秒一跳
      const ticksLeft = Math.max(1, Math.floor(mechanic.durationTicks / interval));
      const maxStacks = Math.max(1, mechanic.maxStacks);
      const burns = timed.filter((entry) => entry.tag === 'burn');
      const amount = Math.floor((target.maxHp * mechanic.perSecondBp) / BP);
      // 没满层就再添一层（伤害算不出来就没有意义，不添）
      if (burns.length < maxStacks && amount > 0) {
        addTimed(target, {
          kind: 'dot',
          sourceId: attacker.id,
          amount,
          damageType: 'magic',
          intervalTicks: interval,
          ticksLeft,
          timer: 0,
          tag: 'burn',
        });
      }
      /*
        刷新**所有**燃烧层的剩余时长（不只是刚到期的那些）。
        ★ 只改 `ticksLeft`、不动 `timer`：各层仍然按各自的节奏跳，
        总伤害一秒内均匀铺开（如果连 timer 一起抹平，5 层会同一 tick 一起爆，
        视觉上是"一下掉一大管血"，手感比现在差）。
      */
      for (const entry of burns) entry.ticksLeft = ticksLeft;
      break;
    }
  }

  /*
    ★ 0.2：每第 N 次攻击额外结算一次（克洛丝 / 芳汀的"每第三次攻击"）
    + ★ 0.2 可露希尔：「每 2 次攻击额外攻击 1 名目标」。

    【为什么这两条要在这里一起算出来、并提前于下面那个"目标死了就收工"的短路？】
    因为那个短路是按"还有没有后续段落要跑"来判断的：
    可露希尔那一击如果主目标刚好被打死，`extraTargets` 又没写在她身上
    （写在 `everyNthAttack.extraTargets` 里），短路就会**把多打一个人也一起吃掉**。
    所以先判出"这一击是不是额外目标那一击"，再把它并进短路的条件里。

    额外伤害走 `'spell'` 攻击类型，和普攻（`'attack'`）能干净地分开 ——
    溅射 / 斩杀 / 反弹那些"只在普攻时触发"的机制不会因为它再触发一遍。
    ★ `bonus` 为 null 时这一条不生效（可露希尔的被动只多打一个人，不多打一段伤害）。
  */
  const everyNth = mods.everyNthAttack;
  const everyNthHit = everyNth ? isEveryNthAttackHit(attacker, everyNth.every) : false;
  /** ★ 0.2：这一击靠"每第 N 次攻击"额外多打几个目标 */
  const everyNthExtra = everyNth && everyNthHit ? everyNth.extraTargets : 0;

  if (target.dead && mods.splash === null && mods.extraTargets <= 0 && everyNthExtra <= 0) {
    onAttackLanded(state, attacker, target, mechanics);
    return;
  }

  if (everyNth?.bonus && everyNthHit && attacker.skill && !target.dead) {
    const bonus = everyNth.bonus;
    const basis = bonus.basis === 'attack' ? effectiveAttackDamage(attacker, mods) : dealt;
    const amount = Math.floor((basis * bonus.ratioBp) / BP);
    if (amount > 0) {
      dealDamage(state, attacker, target, amount, bonus.damageType, 'spell');
    }
  }

  /*
    ★ 0.2：每次攻击给**目标**挂一份减益（伊内丝的"每次都削目标攻速"）。
    放在**主伤害循环之后** —— 语义是"每次攻击"而不是"每一段连击"。
    ★ chanceBp 不写 = 必中；必中时**不掷骰**（不消耗 rng，别的棋子的随机序列不受影响）。
  */
  const debuffOnHit = mods.debuffOnHit;
  if (debuffOnHit && !target.dead) {
    if (debuffOnHit.chanceBp >= 10000 || state.rng.nextInt(10000) < debuffOnHit.chanceBp) {
      addBuff(target, {
        stats: debuffOnHit.stats,
        ticksLeft: debuffOnHit.durationTicks,
        sourceId: attacker.id,
      });
    }
  }

  /*
    ★ 0.2 截云「裂痕」：每次攻击给目标附一份持续伤害。
    ★ 和上面那条减益的区别是**不叠加、而且必须等上一份结束才能再附着** ——
      所以先看一眼目标身上有没有"我挂的那条裂痕"（`tag: 'rift'`）：
      有就整条跳过（既不叠层也不刷新时长）。
      "打一下就跑也照常掉血"由 dot 自己的通路保证（挂在目标身上、目标逐 tick 结算）。
  */
  const onHitDot = mods.onHitDot;
  if (onHitDot && !target.dead) {
    const timed = target.skill?.timed;
    if (timed && !timed.some((entry) => entry.tag === 'rift')) {
      const amount = Math.floor((attacker.attackDamage * onHitDot.power) / FIX);
      if (amount > 0) {
        addTimed(target, {
          kind: 'dot',
          sourceId: attacker.id,
          amount,
          damageType: onHitDot.damageType,
          intervalTicks: onHitDot.intervalTicks,
          // ticksLeft 的语义是**跳数**（见 addTimed 的注释），只能在跳发生那一刻减
          ticksLeft: Math.max(1, Math.floor(onHitDot.durationTicks / onHitDot.intervalTicks)),
          timer: 0,
          tag: 'rift',
        });
      }
    }
  }

  // ---- 1) 攻击附带伤害 ----
  // 三个来源走同一段代码：羁绊机制、技能修正包、远距离加成
  const bonusSources: Array<{
    source: 'dealt' | 'maxHp' | 'missingHp' | 'targetMaxHp' | 'selfMaxHp' | 'attack';
    ratioBp: number;
    damageType: 'physical' | 'magic' | 'true';
  }> = [];
  for (const mechanic of mechanics) {
    if (mechanic.kind !== 'onHitDamage') continue;
    bonusSources.push({ source: mechanic.scale, ratioBp: mechanic.ratioBp, damageType: mechanic.damageType });
  }
  if (mods.bonusDamage) bonusSources.push(mods.bonusDamage);
  // 「对距离自己超过 N 格的敌人附伤」（予愿安洁莉娜）
  if (mods.farBonus && cellDistance(attacker.cell, target.cell, style) > mods.farBonus.minDistance) {
    bonusSources.push({ source: 'dealt', ratioBp: mods.farBonus.ratioBp, damageType: mods.farBonus.damageType });
  }

  for (const bonus of bonusSources) {
    if (target.dead) break;
    /*
      三种基准：打出的伤害 / 目标最大生命 / **自己最大生命**。
      `selfMaxHp` 是 0.0.3 A 版重装那条（"攻击附带**自身**最大生命值 2%/3% 的物理伤害"）——
      别和 targetMaxHp 搞混：肉盾自己的血才是这条的强度来源。
    */
    const amount =
      bonus.source === 'dealt'
        ? Math.floor((dealt * bonus.ratioBp) / BP)
        : bonus.source === 'missingHp'
          ? Math.floor(((target.maxHp - target.hp) * bonus.ratioBp) / BP)
          : bonus.source === 'selfMaxHp'
            ? Math.floor((attacker.maxHp * bonus.ratioBp) / BP)
            : bonus.source === 'attack'
              ? // ★ 0.2：按**自身攻击力**算（予愿安洁莉娜）。放在最里面是为了不动前面四条的老分支
                Math.floor((effectiveAttackDamage(attacker, mods) * bonus.ratioBp) / BP)
              : Math.floor((target.maxHp * bonus.ratioBp) / BP);
    if (amount <= 0) continue;
    dealDamage(state, attacker, target, amount, bonus.damageType, 'spell');
  }

  // ---- 2) 溅射 ----
  // 羁绊的炮手和技能的溅射（空爆/夕/天火/陈/菲亚梅塔/维什戴尔…）走同一段
  const splashList: Array<{
    radius: number;
    shape: SplashShape;
    ratioBp: number;
    damageType: 'physical' | 'magic' | 'true';
    /** ★ 0.0.3 彩蛋：打几段（默认 1） */
    hits: number;
    /** ★ 0.0.3 彩蛋：伤害基数（'dealt' 总伤害 / 'attack' 攻击力） */
    basis: 'dealt' | 'attack';
    /** ★ 0.2：这一发该播哪套特效（只有技能数据里写了才有，见 SkillStats.splash.fx） */
    fx?: string;
  }> = [];
  for (const mechanic of mechanics) {
    if (mechanic.kind !== 'splash') continue;
    splashList.push({
      radius: mechanic.radius,
      // ★ 0.2：炮手从 3×3 方块改成了"周围四格（十字）"，形状由数据决定；不写沿用方块
      shape: mechanic.shape ?? 'square',
      ratioBp: mechanic.ratioBp,
      damageType: mechanic.damageType,
      hits: 1,
      basis: 'dealt',
    });
  }
  if (mods.splash) splashList.push(mods.splash);

  for (const splash of splashList) {
    if (dealt <= 0) continue;
    /*
      ★ 0.0.3 彩蛋：基数可以是"这次攻击打出的总伤害"或"攻击力"。
      彩蛋被动「周围 8 格 2 次攻击力 50%」说的是**攻击力**的 50% ——
      用总伤害做基数的话，3 连击会把范围伤害放大成 150% 攻击力（差三倍）。
    */
    const splashBase = splash.basis === 'attack' ? baseDamage : dealt;
    const splashRaw = Math.floor((splashBase * splash.ratioBp) / BP);
    if (splashRaw <= 0) continue;
    /*
      先记一条「范围效果」，界面才知道该在哪里画方框。
      ★ 只在**真的有人被打到**时才发（下面 hitAny 判断）——
      否则"空放"也会闪一个白框，看起来像打到了但其实没打到。
    */
    let hitAny = false;
    // 候选顺序：按 id 升序（确定性）
    for (const other of state.units) {
      if (other.dead || other.team === attacker.team) continue;
      if (splash.shape !== 'line' && other.id === target.id) continue;
      if (!withinShape(attacker.cell, target.cell, other.cell, splash.radius, splash.shape, style)) continue;
      hitAny = true;
      // hits > 1 = 同一个格子挨好几段（彩蛋的"2 次 50%"）
      for (let hit = 0; hit < Math.max(1, splash.hits); hit++) {
        if (other.dead) break;
        dealDamage(state, attacker, other, splashRaw, splash.damageType, 'spell');
      }
    }
    if (hitAny) {
      emitZone(state, attacker, target.cell, splash.radius, splash.shape, 'damage', ZONE_FLASH_TICKS, splash.fx);
    }
    /*
      ★ 0.2：数据里写了 `fx` 的溅射，额外报一条「爆炸」事件给渲染层播专属特效
      （维什戴尔 3 星的 5×5 大招）。

      【为什么条件是 `splash.fx` 而不是"攻击者是谁"？】
      同一个 5×5 溅射，炮手羁绊也走这段代码 —— 那套爆炸图是量着 5×5 画的，
      套到炮手的"周围四格"上会糊。所以"该不该播专属特效"只能由**数据**说了算，
      内核这里只负责如实把标记转达给界面（和 `slash` 事件同一个分工）。

      ★★ 【为什么它**不**跟着上面的 `hitAny`？这两个口径故意不一样】
      白框（`zone`）回答的是"**打到了哪些格子**"：要真的打到了第二个人才该闪
      —— 否则单挑时地上亮一个 5×5 方框，看着像打到了五个，是假的。
      爆炸（`bloom`）回答的是"**这一发是什么技能**"：维什戴尔的弹药本身就是
      "变成 5×5 群体物理伤害"，单挑时只命中一个人，那也仍然是一次 5×5 大爆炸。
      ⇒ 如果把爆炸也挂在 `hitAny` 上，**单挑（或者身边没队友的敌人）时一次都不会炸**，
        玩家看到的就是"这技能没有特效"。
      走到这里的前提是 `dealt > 0`（这次攻击真的打出了伤害），所以不会"空放也炸"。

      ★ 纯表现层：不进校验和（见 computeChecksum）。
    */
    if (splash.fx) {
      state.log.push({
        type: 'bloom',
        t: state.tick,
        cell: { col: target.cell.col, row: target.cell.row },
        radius: splash.radius,
        shape: splash.shape,
        fx: splash.fx,
      });
    }
  }

  // ---- 3) 斩杀 ----
  for (const mechanic of mechanics) {
    if (mechanic.kind !== 'execute') continue;
    if (target.dead) break;
    // 阈值是"目标最大生命的万分比"
    if (target.hp * 10000 > target.maxHp * mechanic.thresholdBp) continue;
    // 用"真实伤害 = 剩余血量"来结算，这样伤害数字和血量对得上
    dealDamage(state, attacker, target, target.hp, 'true', 'spell');
  }

  // ---- 4) 额外目标 ----
  // ★ 0.2 可露希尔：「每 2 次攻击额外攻击 1 名目标」——
  // 和常驻的 `mods.extraTargets` 加在一起（她两样都可能同时有）。
  const extraCount =
    mods.extraTargets +
    everyNthExtra +
    mechanics.reduce((sum, m) => (m.kind === 'extraTargets' ? sum + m.count : sum), 0);
  if (extraCount > 0) {
    const range = effectiveRange(state, attacker);
    const extras: UnitState[] = [];
    for (const other of state.units) {
      if (other.dead || other.team === attacker.team) continue;
      if (other.id === target.id) continue;
      if (cellDistance(attacker.cell, other.cell, style) > range) continue;
      extras.push(other);
    }
    // 按距离升序、距离相同按 id 升序（确定性）
    extras.sort((a, b) => {
      const da = cellDistance(attacker.cell, a.cell, style);
      const db = cellDistance(attacker.cell, b.cell, style);
      return da - db || a.id - b.id;
    });
    for (const extra of extras.slice(0, extraCount)) {
      if (extra.dead) continue;
      // 额外目标的伤害是"全额但不算普攻"，所以用 spell 类型
      dealDamage(state, attacker, extra, baseDamage, damageType, 'spell');
      /*
        ★ 0.2.1 表现层（用户口径："额外打到的人也要连上线"）：
        额外目标是走**这段代码**扣血的，没有自己的 `attack` 事件 ⇒
        渲染层只看到一条弹道。这里补一条**纯表现**事件，让它也连一条。
        ★ 不进校验和（`computeChecksum` 里 `continue`），也不影响任何战斗计数。
        ★ 只有写了 `tracerFx`（有自己的弹道样式）的干员才报，别人一条都不会多。
      */
      if (eventFx) {
        state.log.push({ type: 'attackLink', t: state.tick, sourceId: attacker.id, targetId: extra.id, fx: eventFx });
      }
    }
  }

  // ---- 5) 攻击命中时的眩晕概率（梅 / 澄闪 / 天火 / 惊蛰）----
  // ★ perHit 的（彩蛋）已经在上面连击循环里逐段判定过了，这里不再重复一次
  if (mods.stunOnHit && !mods.stunOnHit.perHit && !target.dead) {
    if (state.rng.nextInt(10000) < mods.stunOnHit.chanceBp) {
      applyStun(state, attacker, target, mods.stunOnHit.durationTicks);
    }
  }

  // ---- 6) 攻击计数类（叠攻速 / 累计核爆 / 技能给的队友增益）----
  onAttackLanded(state, attacker, target, mechanics, dealt > 0 || target.dead);
}

/** 「对非萨卡兹敌人伤害增加」这类按标签的判断 */
function applyVsTraitBonus(
  state: BattleState,
  attacker: UnitState,
  target: UnitState,
  damage: number,
  mods: ReturnType<typeof collectMods>,
): number {
  if (!mods.vsTraitDamageBp || mods.vsTraitDamageBp.ratioBp === 0) return damage;
  const targetDef = stateDefOf(state, target);
  if (!targetDef) return damage;
  const has = targetDef.traits.includes(mods.vsTraitDamageBp.trait);
  const matches = mods.vsTraitDamageBp.exclude ? !has : has;
  if (!matches) return damage;
  return Math.floor((damage * (BP + mods.vsTraitDamageBp.ratioBp)) / BP);
}

/**
 * ★★ 0.3 近卫：攻击**射程 ≥ minRange** 的干员时，这一击的伤害**提升到** totalBp。
 *
 * 【为什么写成“提升到”而不是“额外附加一段”】
 * 数据表里写的就是「对射程大于等于 3 的干员伤害提升至 120%/130%/150%」，
 * 那是**乘法**而不是“再打一下”（后者会被护甲再减一次、也会触发额外逻辑）。
 * 所以这里直接乘在**未减伤的原始伤害**上，再交给 dealDamage 走常规流程。
 *
 * ★ 射程读的是**目标当前**的 `range`（已含输出装备 / 羁绊 / 技能加成）——
 * 玩家看到的面板就是这个数，用它判断才不会“看着是 3 格却不触发”。
 */
function applyRangeAmpBonus(
  target: UnitState,
  damage: number,
  mods: ReturnType<typeof collectMods>,
): number {
  const amp = mods.rangeAmp;
  if (!amp) return damage;
  if (target.range < amp.minRange) return damage;
  const extraBp = amp.totalBp - BP;
  if (extraBp === 0) return damage;
  return Math.floor((damage * (BP + extraBp)) / BP);
}

/**
 * ★ 0.0.3：对残血目标的增伤比例（万分比）。
 *
 * “盛怒”「攻击生命值低于一半的干员时，造成的伤害 +50%」——
 * 这里只算一个数出去，具体乘法在 performAttack 里做（那里才知道每一段伤害）。
 */
function executeBonusAgainst(mechanics: readonly ScopedMechanic[], target: UnitState): number {
  if (target.maxHp <= 0) return 0;
  let bonus = 0;
  for (const mechanic of mechanics) {
    if (mechanic.kind !== 'executeBonus') continue;
    // hp * 10000 <= maxHp * threshold  =>  血量百分比低于阈值
    if (target.hp * 10000 > target.maxHp * mechanic.hpThresholdBp) continue;
    bonus += mechanic.ratioBp;
  }
  return bonus;
}

/** 从战斗状态里反查一个棋子的定义表条目（技能按标签判断时会用到） */
function stateDefOf(state: BattleState, unit: UnitState): UnitDef | undefined {
  return state.defs?.[unit.defId];
}

/**
 * 给"攻击改为治疗"的技能找目标（芙蓉"治疗血量最低的队友"）。
 *
 * ★ 0.2：不在本地再挑一遍了 —— 直接借 `resolveAllyTargets`。
 *   原来这里自己写了个循环取"血量绝对值最低"，和 `skills.ts` 里
 *   `resolveTargets` 的 `lowestHpAlly` 分支是**同一件事的第二份实现**
 *   （而且语义有细微差别：这里把施法者自己也算进候选，
 *    `resolveTargets` 也算 —— 但设计稿写的是"队**友**"）。
 *   现在统一成一处：候选不含自己，规则只有 skills.ts 那一份。
 */
function resolveAllyTarget(state: BattleState, caster: UnitState, rule: 'lowestHpAlly'): UnitState | undefined {
  return resolveAllyTargets(state, caster, rule, 1)[0];
}

/**
 * 攻击命中之后的"计数类"机制。
 *
 * 【为什么这些要单独一个函数？】
 * 因为它们都是"累计到某个次数才生效"，需要一个计数器。
 * 计数器挂在棋子上（`unit.trait.attackCount`），每次攻击后 +1，
 * 然后按固定顺序检查：先叠攻速（剑士/远射），再看要不要放核爆（拉特兰）。
 */
function onAttackLanded(
  state: BattleState,
  attacker: UnitState,
  target: UnitState,
  mechanics: readonly ScopedMechanic[],
  landed = true,
): void {
  const runtime = attacker.trait;
  if (!runtime) return;
  runtime.attackCount++;
  const mods = collectMods(state, attacker);

  /*
    ★ 拉特兰的计数是**全队共享**的（你报的第 8 条）。
    每只拉特兰干员打出一次普攻，都往"本队"的那个数上加一格 ——
    而不是记在攻击者自己身上。下面所有读写都走 state.nukeAttackCount[team]。
  */
  const usesNuke = mechanics.some((mechanic) => mechanic.kind === 'attackCountNuke');

  // 技能自己的攻击计数（可露希尔"每2次攻击"、伊内斯"每次攻击"）
  const skillRuntime = attacker.skill;
  if (skillRuntime) {
    skillRuntime.attackCount++;
    const allyBuff = mods.onAttackAllyBuff;
    if (allyBuff && skillRuntime.attackCount % allyBuff.every === 0) {
      const picked = pickAllyForBuff(state, attacker, allyBuff.target);
      if (picked) {
        if (allyBuff.heal) {
          /*
            ★★ 0.2 修 bug：这里原来是 `(base * ratioBp) / FIX`。
            `ratioBp` 是**万分比**（凯尔希写的是 3500 = 35%），除 FIX(1000) 会除以 10 ——
            于是凯尔希每次普攻给队友回**350%** 生命上限的血（10 倍）。
            现在统一走 `healAmountOf()`，和脉冲治疗 / 芙蓉同一条实现。
          */
          const amount = healAmountOf(attacker, picked, allyBuff.heal);
          if (amount > 0) healUnit(state, attacker, picked, amount);
        }
        if (allyBuff.stats && allyBuff.durationTicks > 0) {
          addBuff(picked, { stats: allyBuff.stats, ticksLeft: allyBuff.durationTicks, sourceId: attacker.id });
        }
      }
    }
  }

  /*
    「接下来 N 次攻击」的消耗。
    ★ 放在这里而不是攻击之前，是因为"这一击"本身要吃到加成，
    用完这一次之后才该减少。
    「若击杀敌人则刷新效果」（赤刃明霄陈 3 星）也在这里处理。
  */
  let refreshed = false;
  if (skillRuntime) {
    for (let i = skillRuntime.buffs.length - 1; i >= 0; i--) {
      const buff = skillRuntime.buffs[i]!;
      if (buff.attackCharges === undefined) continue;
      const killed = target.dead && buff.stats.onKillRefresh === true;
      if (killed) {
        refreshed = true; // 击杀 -> 不消耗，次数重新拉满
        continue;
      }
      // ★ 0.2 新约能天使 3 星："五连击消耗五发弹药" ⇒ 一次扣 5
      buff.attackCharges -= Math.max(1, buff.chargesPerAttack ?? 1);
      if (buff.attackCharges <= 0) skillRuntime.buffs.splice(i, 1);
    }
    if (refreshed) skillRuntime.version++;
  }

  /*
    ★ 0.2 洛洛「锁链」：技能持续期间每击杀一名目标，技能**额外持续 1 秒**。
    和上面那条"刷新次数"放在同一处 —— 它们都是"**这一击**击杀时"的结算，
    分散到两个地方迟早会出现"一处算了、另一处忘了"。
    ★ 只延长**自己写了 `onKillExtendTicks` 的那一包**，不是无差别延长全身 buff；
      常驻包（整场）不延长 —— 它本来就不会过期。
  */
  if (skillRuntime && target.dead) {
    for (const buff of skillRuntime.buffs) {
      const extend = buff.stats.onKillExtendTicks;
      if (extend === undefined || extend <= 0) continue;
      if (buff.ticksLeft >= MAX_BATTLE_TICKS) continue;
      buff.ticksLeft += extend;
    }
  }
  if (!landed) return;

  /*
    ★ 拉特兰：计一次数，并把当前进度如实记进事件流。

    【为什么计数放在 `if (!landed) return` **之后**？】
    这是 0.0.2 改成"全队共享计数"时冒出来的一个坑，记在这里免得以后再踩：
    触发检查（下面那段）在 landed 分支里，如果计数在被免疫/被挡下的攻击上
    也加一格，就会出现「计数加到 14，触发检查却因为没落地被跳过」——
    界面显示成"进度 14 / 10 还没发动"，自相矛盾。
    所以口径统一成：**只有真的打中的攻击才算"累计攻击次数"**。
  */
  if (usesNuke) state.nukeAttackCount[attacker.team]++;

  /*
    ★ 羁绊日志：把"计数类"羁绊的当前进度如实记下来（你报的第 6 条）。
    每打一下记一条 `trait progress`，界面把它显示成"拉特兰 12 / 30"这样的实时进度。
    只有真的有计数类羁绊的棋子才会产生这种事件，所以绝大多数棋子一条都不会多记。
  */
  for (const mechanic of mechanics) {
    if (mechanic.kind !== 'attackCountNuke') continue;
    state.log.push({
      type: 'trait',
      t: state.tick,
      traitId: mechanic.traitId ?? 'laterano',
      unitId: attacker.id,
      kind: 'progress',
      // value = "距离下一次发动还差几次"的**已累计**部分，发动后自动归零。
      // 界面上直接显示成「12 / 30」，不需要自己记住上次发动是什么时候。
      value: state.nukeAttackCount[attacker.team] - state.nukeLastAt[attacker.team],
      target: mechanic.every,
    });
  }

  // 剑士：每攻击 every 次，永久提升攻速
  for (const mechanic of mechanics) {
    if (mechanic.kind !== 'attackCounterSpeed') continue;
    if (runtime.attackCount % mechanic.every !== 0) continue;
    if (runtime.speedStacks >= mechanic.maxStacks) continue;
    runtime.speedStacks++;
    runtime.bonusAttackSpeedBp += mechanic.bonusBp;
    state.log.push({
      type: 'buff',
      t: state.tick,
      sourceId: attacker.id,
      targetId: attacker.id,
      stat: 'attackSpeed',
      bonusBp: mechanic.bonusBp,
      durationTicks: MAX_BATTLE_TICKS,
    });
  }

  // 远射：每次攻击都永久提升攻速
  for (const mechanic of mechanics) {
    if (mechanic.kind !== 'rampSpeed') continue;
    if (runtime.speedStacks >= mechanic.maxStacks) continue;
    runtime.speedStacks++;
    runtime.bonusAttackSpeedBp += mechanic.perAttackBp;
  }

  // 拉特兰：全队累计攻击 every 次，对全体敌人来一发（计数是队伍共享的）
  for (const mechanic of mechanics) {
    if (mechanic.kind !== 'attackCountNuke') continue;
    if (state.nukeAttackCount[attacker.team] - state.nukeLastAt[attacker.team] < mechanic.every) continue;
    state.nukeLastAt[attacker.team] = state.nukeAttackCount[attacker.team];

    /*
      伤害有两种口径，由数据决定（见 types.ts 的 attackCountNuke）：
        · flatDamage   —— 固定值（0.0.3 A 版用的就是这个）：面板单位 × FIX
        · totalAttackBp —— "全部拉特兰攻击力总和" × 万分比（0.0.2 的旧口径）

      固定值那条**不吃任何加成**，所以不需要遍历队友求攻击力和；
      百分比那条要先把同队同标签棋子的攻击力求和（它们身上都带这条机制）。
    */
    let nukeRaw: number;
    if (mechanic.flatDamage !== undefined) {
      nukeRaw = mechanic.flatDamage * FIX;
    } else {
      let totalAttack = 0;
      for (const ally of state.units) {
        if (ally.dead || ally.team !== attacker.team) continue;
        const allyMechanics = ally.trait?.mechanics ?? [];
        if (!allyMechanics.some((item) => item.kind === 'attackCountNuke')) continue;
        totalAttack += effectiveAttackDamage(ally, collectMods(state, ally));
      }
      /*
        ★ 顺手修掉一个隐藏的换算错：旧代码是
          `floor(totalAttack * bp / BP / 10000) * FIX`，
        多除了一个 10000 再乘 FIX，等于又缩小了 10 倍。
        totalAttack 本身已经是 FIX 单位，乘万分比除 BP 就是 FIX 单位的伤害，
        不需要再换一次 —— 所以这里只保留前面那一步。
      */
      nukeRaw = Math.floor((totalAttack * (mechanic.totalAttackBp ?? 0)) / BP);
    }
    if (nukeRaw <= 0) continue;

    state.log.push({
      type: 'cast',
      t: state.tick,
      unitId: attacker.id,
      skillId: 'trait_laterano_volley',
      /*
        ★★ 0.2.1：这一发要"看得见"。
        `traitCast: true` 告诉表现层和日志层：**这不是棋子放技能**
        （别弹施法环、别把技能条清零、别记"XX 释放技能"）；
        `boardFx` 是数据里点名的那套全场层演出（拉特兰 = 从本方半场横扫的子弹雨）。
        ★ 两个都是纯表现字段，`computeChecksum` 的 cast 分支只混 unitId ⇒ 不影响联机分叉。
      */
      traitCast: true,
      boardFx: mechanic.fx,
    });
    /*
      ★ 先打完，再记"这一发总共打出了多少"（0.0.2 追加需求）。

      【为什么不是 nukeRaw × 敌人数？】
      因为那只是**理论上限**：护盾、护甲、魔抗、闪避都会把实际伤害吃掉一块。
      羁绊日志要给玩家看的显然是"这一发真的打掉了多少血"，
      所以把 dealDamage 的返回值累加起来 —— 它返回的就是实际扣掉的血量。

      【为什么事件要推到伤害之后？】
      因为总和得等伤害结算完才知道。同 tick 内事件顺序变了，
      但进度事件的 tick 没变，界面的"进度归零"逻辑照样对得上。
    */
    let dealtTotal = 0;
    for (const enemy of state.units) {
      if (enemy.dead || enemy.team === attacker.team) continue;
      dealtTotal += dealDamage(state, attacker, enemy, nukeRaw, 'physical', 'spell');
    }
    // 羁绊日志：这一发是真的发动了（界面弹一条"拉特兰 发动！共造成 N 伤害"）
    state.log.push({
      type: 'trait',
      t: state.tick,
      traitId: mechanic.traitId ?? 'laterano',
      unitId: attacker.id,
      kind: 'trigger',
      value: dealtTotal,
      target: mechanic.every,
    });
  }

  /*
    ★ 0.0.3 藏品：每 N 次普攻给**下一次**普攻挂一个限次修正包（突袭手雷）。

    【为什么放在最后、而且用 attackCharges 而不是直接加属性？】
    因为它是"下一次攻击"生效，不是"这一下"。这个函数是**这一击结算完之后**
    才跑的（performAttack 末尾调用），所以在这里挂的包天然会留给下一击；
    而 `attackCharges: 1` 会在下一击结束时被上面那段消耗逻辑摘掉 ——
    正好只影响一次攻击。直接改 attackDamage 的话就再也收不回来了。
  */
  for (const mechanic of mechanics) {
    if (mechanic.kind !== 'everyNthAttack') continue;
    if (runtime.attackCount % mechanic.every !== 0) continue;
    addBuff(attacker, {
      stats: mechanic.stats,
      ticksLeft: mechanic.durationTicks ?? MAX_BATTLE_TICKS,
      attackCharges: mechanic.attacks ?? 1,
      sourceId: attacker.id,
    });
  }

  /*
    ★ 0.0.3 藏品：击杀掉金（铳骑之威「击杀敌人有 20% 获得一金币」）。

    【为什么记成一条事件、而不是直接给玩家加钱？】
    因为战斗内核根本不知道"玩家"是谁（它只有两支队伍）。
    而且联机时两边都要掷出同一个骰子 —— 记进事件流之后，
    客户端播完战斗照着 `gold` 事件把钱加上去就行。
    这里的骰子走 state.rng，所以是确定性的。
  */
  if (target.dead) {
    /*
      ★ 0.0.3：击杀回血（W「击杀干员时回复自身 10% 生命值」）。
      顺手放在这里 —— 和"击杀掉金"同一条语义路径，以后再加"击杀 XX"都在这一块。
    */
    for (const mechanic of mechanics) {
      if (mechanic.kind !== 'healOnKill') continue;
      healUnit(state, attacker, attacker, Math.floor((attacker.maxHp * mechanic.hpBp) / BP));
    }
    for (const mechanic of mechanics) {
      if (mechanic.kind !== 'goldOnKill') continue;
      if (state.rng.nextInt(10000) >= mechanic.chanceBp) continue;
      state.log.push({
        type: 'gold',
        t: state.tick,
        team: attacker.team,
        amount: mechanic.gold,
        sourceId: attacker.id,
        reason: 'kill',
      });
    }
  }
}

/** 「使我方随机一名干员获得增益」的选人（可露希尔/伊内丝）—— 用战斗自己的随机数 */
/**
 * 「每 N 次攻击给队友增益/治疗」挑一个队友（凯尔希、耀骑士临光那条被动）。
 *
 * ★★ 0.2 修 bug：这里原来**只认 `randomAlly` 和 `nearestAlly`**，
 *   传到别的规则就一路掉进末尾的"最近的队友" ——
 *   而 0.2 恰好把凯尔希的目标从 `nearestAlly` 改成了 `lowestHpRatioAlly`
 *   （"百分比生命值最低的一名队友"）。数据改了、这里没跟上，于是：
 *   **表面上是"治疗残血队友"，实际还在治最近的那个，而且不报任何错**。
 *   导出表里那一格渲染成裸 id（`每 1 次攻击 → lowestHpRatioAlly`）
 *   是当时唯一的线索（见 scripts/export-operator-table.ts 里的 TARGET_LABEL）。
 *
 * 现在直接借 `resolveAllyTargets`（skills.ts 里选目标的**唯一实现**）：
 *   · 以后再加队友类规则，改 `skills.ts` 一处即可，不会再漏掉这条旁路；
 *   · 候选**不含施法者自己** —— 和设计稿写的"队**友**"一致，
 *     也和这里原来的行为（`unit.id !== attacker.id`）一致。
 */
function pickAllyForBuff(state: BattleState, attacker: UnitState, rule: TargetRule): UnitState | undefined {
  return resolveAllyTargets(state, attacker, rule, 1)[0];
}

/**
 * 每 tick 检查一次"需要跟着状态变化换人"的机制。
 *
 * 目前只有一种：罗德岛的「生命值最高的那个干员攻击力提升，死亡后由下一个继承」。
 * 所以每 tick 要看一眼持有者还活着没有，死了就把加成转给下一个血量最高的成员。
 *
 * 【为什么要每 tick 检查而不是在死亡时触发？】
 * 因为"死亡"可能由很多地方引发（普攻、技能、溅射、斩杀、反伤）。
 * 在死亡处逐个挂钩子一定会漏一个；每 tick 扫一眼则**不可能漏**，
 * 而且代价极小（只在有这种机制的队伍里扫一遍）。
 */
function tickTraitMechanics(state: BattleState): void {
  for (const team of [0, 1] as const) {
    let needsReassign = false;
    let bonusBp = 0;

    for (const unit of state.units) {
      if (unit.team !== team) continue;
      const bp = unit.statuses['carrierBonusBp'];
      if (bp === undefined) continue;
      if (unit.dead) {
        // 持有者死了：把加成减回去（这样属性表和伤害计算都不会虚高）
        unit.attackDamage -= Math.floor((unit.attackDamage * bp) / (10000 + bp));
        delete unit.statuses['carrierBonusBp'];
        needsReassign = true;
        bonusBp = bp;
      }
    }

    if (needsReassign && bonusBp > 0) {
      assignHpCarrier(state, team, bonusBp);
    }
  }
}

/**
 * 血量首次跌破阈值时，攻速大幅提升一段时间（维多利亚）。
 *
 * 【为什么放在"受伤之后"检查？】
 * 因为触发条件是"生命值降低至 50% 时" —— 只有挨打才会发生。
 * 放在每 tick 检查也可以，但那样每个棋子每 tick 都要算一次血量百分比；
 * 挂在伤害结算之后，只有真的掉血的棋子才会被检查。
 */
function checkLowHpSurge(state: BattleState, unit: UnitState, mechanics: readonly ScopedMechanic[]): void {
  const runtime = unit.trait;
  if (!runtime || runtime.surgeUsed) return;
  if (unit.dead || unit.maxHp <= 0) return;

  for (const mechanic of mechanics) {
    if (mechanic.kind !== 'lowHpSurge') continue;
    // hp * 10000 <= maxHp * threshold  =>  血量百分比低于阈值
    if (unit.hp * 10000 > unit.maxHp * mechanic.hpThresholdBp) continue;
    runtime.surgeUsed = true;
    runtime.surgeSpeedBp += mechanic.speedBp;
    if (mechanic.attackDamageBp) runtime.surgeAttackBp += mechanic.attackDamageBp;
    /*
      有时限的（维多利亚）走倒计时；**不写 durationTicks 的（寻仇者 / “复仇者”）
      是永久生效** —— 所以只把 surgeTicks 撑到"有时限的那一份"，
      没有时长就当它跟着整场战斗走。
    */
    if (mechanic.durationTicks) runtime.surgeTicks = Math.max(runtime.surgeTicks, mechanic.durationTicks);
    /*
      ★ 0.0.3：顺手给界面记一条"属性被改了"的事件。

      【为什么非得记？】
      这个加成没走 addBuff（它存在 trait.surgeSpeedBp 里），
      而详情页的"实时数值"是跟**事件流**走的 ——
      不记的话，“复仇者”半血之后攻速真的翻了倍，面板上却一动不动。
      （只是日志：战斗内核该怎么算还怎么算。）
    */
    const surgeTicks = mechanic.durationTicks ?? MAX_BATTLE_TICKS;
    state.log.push({
      type: 'buff',
      t: state.tick,
      sourceId: unit.id,
      targetId: unit.id,
      stat: 'attackSpeed',
      bonusBp: mechanic.speedBp,
      durationTicks: surgeTicks,
    });
    if (mechanic.attackDamageBp) {
      state.log.push({
        type: 'buff',
        t: state.tick,
        sourceId: unit.id,
        targetId: unit.id,
        stat: 'attackDamage',
        bonusBp: mechanic.attackDamageBp,
        durationTicks: surgeTicks,
      });
    }
    /*
      ★ 0.2 维多利亚：触发时同时"每秒回复自身生命上限 regenBp"，持续 regenTicks。
      走 `addTimed` 的 hot 通路（和 dot 同一套：宿主自己逐 tick 结算）。
      注意用的是**独立于攻速**的时长 —— 攻速 5 秒、回血 10 秒，两者不该共用一个数。
    */
    if (mechanic.regenBp && mechanic.regenTicks) {
      const amount = Math.floor((unit.maxHp * mechanic.regenBp) / BP);
      if (amount > 0) {
        addTimed(unit, {
          kind: 'hot',
          sourceId: unit.id,
          amount,
          damageType: 'true',
          intervalTicks: 20,
          ticksLeft: Math.max(1, Math.floor(mechanic.regenTicks / 20)),
          timer: 0,
        });
      }
    }
  }
}

/** 判断战斗是否结束 */
function checkBattleEnd(state: BattleState): void {
  const alive0 = aliveCount(state, 0);
  const alive1 = aliveCount(state, 1);

  if (alive0 === 0 || alive1 === 0) {
    // 同归于尽算平局
    const winner: 0 | 1 | null = alive0 === 0 && alive1 === 0 ? null : alive0 === 0 ? 1 : 0;
    finish(state, winner, 'eliminated');
    return;
  }

  /*
    ★ 超时强制结束（你要求的第 14 条）。
    【判定顺序：先比"人"，再比"血"】
      1. 存活干员多的一方获胜 —— 场上多站一个人，胜面本来就更大；
      2. 人数相同再比**剩余总血量**（绝对量，不是百分比）；
      3. 连血量都一样才算平局。
    注意这里已经不用 TIMEOUT_DRAW_MARGIN_BP 那套"2% 以内算平局"了 ——
    那是为"血量百分比比较"设计的容错，换成"人数优先 + 绝对血量"之后
    不再需要（人数不同直接分胜负，不会再出现"偷鸡"）。
  */
  if (state.tick >= FORCE_END_TICKS) {
    let winner: 0 | 1 | null = null;
    if (alive0 !== alive1) {
      winner = alive0 > alive1 ? 0 : 1;
    } else {
      const hp0 = totalHp(state, 0);
      const hp1 = totalHp(state, 1);
      if (hp0 !== hp1) winner = hp0 > hp1 ? 0 : 1;
    }
    finish(state, winner, 'timeout');
  }
}

/** 结束战斗并写收尾事件 */
function finish(state: BattleState, winner: 0 | 1 | null, reason: 'eliminated' | 'timeout'): void {
  state.over = true;
  state.winner = winner;
  const max0 = Math.max(1, totalMaxHp(state, 0));
  const max1 = Math.max(1, totalMaxHp(state, 1));
  const hpBpTeam0 = Math.floor((totalHp(state, 0) * BP) / max0);
  const hpBpTeam1 = Math.floor((totalHp(state, 1) * BP) / max1);
  state.log.push({ type: 'end', t: state.tick, winner, reason, hpBpTeam0, hpBpTeam1 });
}

/**
 * 跑完整场战斗，返回结果。
 * 服务器、客户端、单元测试都调用这一个函数 —— 所以三者的行为必然一致。
 */
export function simulate(
  defs: UnitDefTable,
  teams: [TeamSetup, TeamSetup],
  seed: number,
  opts?: { statsTimeline?: boolean },
): BattleResult {
  const state = createBattle(defs, teams, seed);

  /*
    ★ 属性时间线（可选）：客户端要它来显示"详情页里的真实数值"。
    采样的口径和战斗内核真正用的是同一套函数（collectMods + effective*），
    所以面板上的数字和实际打的伤害永远一致；而且**只要属性被改过就能看出来**，
    不依赖"改属性的人有没有记得上报事件"（以前的坑）。
  */
  const timeline: BattleStatsSample[] | undefined = opts?.statsTimeline ? [] : undefined;
  const lastSample = new Map<number, BattleStatsSample>();
  /**
   * ★ 0.1.1 藏品二版：效果集合的"变化判据"。
   *
   * 【为什么不把整条 sample 拿去比？】
   * `effects[].ticksLeft` 每 tick 都在变，直接比对象会变成"每 tick 一条"。
   * 所以单独维护一份"只含种类 + 数值说明"的字符串签名 ——
   * 剩余时间和它无关，界面按 `ticksLeft - (当前tick - t)` 自己往下数。
   */
  const lastEffectKey = new Map<number, string>();
  const takeSample = (): void => {
    if (!timeline) return;
    for (const unit of state.units) {
      if (unit.dead) continue;
      const mods = collectMods(state, unit);
      /*
        状态效果和属性一起采（见 BattleStatsSample.effects 的说明）：
        内核这里刚好同时握着"修正包"和"真实的 UnitState"，不采白不采。
      */
      const effects = activeEffectsOf(mods, unit, defs[unit.defId]).map((effect) => ({
        kind: effect.kind as string,
        ...(effect.detail ? { detail: effect.detail } : {}),
        // ★ 0.1.3：按时间 / 按次数分别记 —— 界面各显示各的（"剩 2.4 秒" / "剩 3 次"）
        ...(effect.duration?.kind === 'time' ? { ticksLeft: effect.duration.ticksLeft } : {}),
        ...(effect.duration?.kind === 'count' ? { countLeft: effect.duration.left } : {}),
      }));
      const sample: BattleStatsSample = {
        t: state.tick,
        unitId: unit.id,
        attackSpeed: effectiveAttackSpeed(unit, mods),
        attackDamage: effectiveAttackDamage(unit, mods),
        armor: effectiveArmor(unit, mods),
        magicResist: effectiveMagicResist(unit, mods),
        range: effectiveRange(state, unit),
        maxHp: unit.maxHp,
        effects,
      };
      /*
        ★ 变化判据里**故意不含 `ticksLeft`**：它每 tick 都在变，
        放进去就成了"每 tick 每个棋子一条"（十来个棋子打 20 秒就是几千条）。
        界面按"ticksLeft - (现在 - 采样tick)"自己往下数，所以不需要重采。

        ★ 但 `countLeft` **必须**放进去：次数是离散的（只在攻击那一刻 -1），
        界面没法用时间推出来。放进去之后，每挨一下攻击就补一条采样，
        界面读最新那条就是准的（攻击频率远低于 tick 频率，量很小）。
      */
      const effectKey = effects.map((e) => `${e.kind}:${e.detail ?? ''}:${e.countLeft ?? ''}`).join('|');
      const prev = lastSample.get(unit.id);
      if (
        prev &&
        prev.attackSpeed === sample.attackSpeed &&
        prev.attackDamage === sample.attackDamage &&
        prev.armor === sample.armor &&
        prev.magicResist === sample.magicResist &&
        prev.range === sample.range &&
        prev.maxHp === sample.maxHp &&
        lastEffectKey.get(unit.id) === effectKey
      ) {
        continue;
      }
      lastSample.set(unit.id, sample);
      lastEffectKey.set(unit.id, effectKey);
      timeline.push(sample);
    }
  };

  // t=0 先采一条：那就是"开战那一刻"的基线（被动/羁绊/藏品/开局光环都在里面）
  takeSample();
  while (!state.over) {
    step(state, defs);
    takeSample();
  }

  const endEvent = state.log[state.log.length - 1];
  const hpBpTeam0 = endEvent && endEvent.type === 'end' ? endEvent.hpBpTeam0 : 0;
  const hpBpTeam1 = endEvent && endEvent.type === 'end' ? endEvent.hpBpTeam1 : 0;
  const reason = endEvent && endEvent.type === 'end' ? endEvent.reason : 'timeout';

  return {
    seed,
    winner: state.winner,
    reason,
    ticks: state.tick,
    log: state.log,
    hpBpTeam0,
    hpBpTeam1,
    checksum: computeChecksum(state, state.winner, state.tick),
    // ★ 0.2 MujicaAve：把这一场每队攒到的 fever 交出去（回合流程拿它结算）
    feverGained: [state.feverGained[0], state.feverGained[1]],
    ...(timeline ? { statsTimeline: timeline } : {}),
  };
}

/**
 * ★ 0.2：**自定义弹道**用 —— 射程内随机挑一个敌人（若麦的"随机攻击范围内的目标"）。
 * 走 `state.rng`，联机两边掷出同一个。
 */
function randomTargetInRange(state: BattleState, attacker: UnitState): UnitState | null {
  const reach = effectiveRange(state, attacker);
  const style = moveStyleOf(attacker);
  const candidates = state.units.filter(
    (other) => !other.dead && other.team !== attacker.team && cellDistance(attacker.cell, other.cell, style) <= reach,
  );
  if (candidates.length === 0) return null;
  return candidates[state.rng.nextInt(candidates.length)] ?? null;
}

/**
 * ★ 0.2：**穿透弹道**的目标表（祥子的音符：沿"自己 → 主目标"的方向穿 `pierceLength` 格）。
 *
 * 口径：
 *   · 主目标**一定**在内（哪怕它不在直线上 —— 音符是冲它去的）；
 *   · 其余按"离主目标越近越先吃"排序，最多 `maxTargets` 个；
 *   · 同距离按 id 升序 ⇒ 确定性（联机两边必须挑出同一批）。
 */
function pierceVictims(
  state: BattleState,
  attacker: UnitState,
  target: UnitState,
  profile: ResolvedAttackProfile,
): UnitState[] {
  if (profile.maxTargets <= 1 && profile.pierceLength <= 0) return [target];
  const style = moveStyleOf(attacker);
  const line = state.units.filter(
    (other) =>
      !other.dead &&
      other.team !== attacker.team &&
      withinShape(attacker.cell, target.cell, other.cell, Math.max(1, profile.pierceLength), 'line', style),
  );
  if (!line.some((unit) => unit.id === target.id)) line.push(target);
  line.sort(
    (a, b) => cellDistance(a.cell, target.cell, style) - cellDistance(b.cell, target.cell, style) || a.id - b.id,
  );
  return line.slice(0, Math.max(1, profile.maxTargets));
}
