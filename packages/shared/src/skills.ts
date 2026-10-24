import { BOARD_H, BOARD_W, BP, CELL_EMPTY, FIX, MANA_MAX, MAX_BATTLE_TICKS, MELEE_RANGE, TICKS_PER_SECOND, ZONE_FLASH_TICKS } from './constants.js';
import {
  applyShield,
  applyShieldGrant,
  applyStun,
  clearShield,
  damageArea,
  dealDamage,
  emitBuffEvents,
  emitZone,
  gainMana,
  healUnit,
  killUnit,
  shieldGrantOf,
  spawnSummon,
} from './combat-math.js';
import { cellDistance, cellIndex, getUnit, isInside, moveStyleOf, withinRadius, withinShape } from './field.js';
import { addBuff, basisAmount, collectMods, effectiveRange, healAmountOf, pulseIntervalTicks, refreshMaxHp, resolveStatsForStar, starValue, withGoldBonus, FOREVER_TICKS, type ResolvedGuard, type ResolvedPulse } from './mods.js';
import type {
  BattleState,
  LockOnPlan,
  MoveStyle,
  SkillEffect,
  SkillStats,
  SplashShape,
  StarValue,
  TargetRule,
  TimedEffect,
  UnitDef,
  UnitDefTable,
  UnitState,
} from './types.js';

/*
  这个文件负责的是"技能的**生命周期**"：
  什么时候放、放了之后场上发生什么（召唤、陷阱、击退、瞬移、复活、脉冲、DoT）。

  「修正包怎么合并成属性」在 mods.ts 里 —— 因为 combat-math.ts 也要用它
  （挨打时要查闪避/免疫/免死/吸血），放在这里会形成循环依赖。
  这里把常用的几个再导出一次，调用方不用记两个文件。
*/
export {
  addBuff,
  canCast,
  collectMods,
  effectiveArmor,
  effectiveAttackDamage,
  effectiveAttackSpeed,
  effectiveMagicResist,
  effectiveRange,
  refreshMaxHp,
  starValue,
  FOREVER_TICKS,
} from './mods.js';
export type { Mods, ResolvedGuard } from './mods.js';

// ============================================================
// 星级技能的选择
// ============================================================

/** 这只棋子在当前星级下用的是哪套技能（3 星专属会整个替换掉 1/2 星那套） */
export function skillVariantOf(
  def: UnitDef,
  star: number,
): {
  effects: SkillEffect[];
  passive?: import('./types.js').SkillStats;
  battleStart?: SkillEffect[];
  name: string;
  desc: string;
  castFx?: string;
} {
  const skill = def.skill;
  if (star >= 3 && skill.star3) {
    return {
      effects: skill.star3.effects,
      passive: skill.star3.passive,
      battleStart: skill.star3.battleStart,
      name: skill.star3.name,
      desc: skill.star3.desc,
      // ★ 3 星没单独写就用技能本体那套（免得同一套图要在两处抄一遍）
      castFx: skill.star3.castFx ?? skill.castFx,
    };
  }
  return {
    effects: skill.effects,
    passive: skill.passive,
    battleStart: skill.battleStart,
    name: skill.name,
    desc: skill.desc,
    castFx: skill.castFx,
  };
}

/**
 * 这只棋子在当前星级下放技能时该播哪套特效（渲染层注册表键）。
 * ★ 唯一实现：内核填 `cast` 事件的 `fx`、客户端界面要预览也走它 —— 别在别处再写一遍。
 */
export function castFxOf(def: UnitDef, star: number): string | undefined {
  return skillVariantOf(def, star).castFx;
}

/**
 * 这个棋子在当前星级下有没有"要攒法力才能放"的技能。
 *
 * 【为什么要判断？】
 * 纯被动棋子（夜莺、星熊那种）不该攒法力 —— 否则它每攒满一次就会推一条
 * `cast` 事件，日志里全是噪声，还会让人以为"它能放技能但没效果"。
 */
export function hasActiveSkill(def: UnitDef, star: number): boolean {
  return skillVariantOf(def, star).effects.length > 0;
}

/**
 * ★ 0.1.4：把「按金币成长」的被动折算成**开局固定**的攻击力加成（万分比）。
 *
 * ============================================================
 *  【它修的 bug：老鲤「财可通神」的被动一点效果都没有】
 * ============================================================
 * `goldScalingAttackBp` 这个字段**数据表里写了、类型里也声明了**，
 * 但全项目没有任何一处消费它 —— 典型的"配好了没人读"。
 * 老鲤（op32）的 `effects` 是空数组（纯被动），于是这个棋子形同白板：
 * 既不放技能，也没有任何被动加成。
 *
 * 【语义】设计稿（0.2 按策划表）：「玩家每拥有 10 枚金币，攻击力 +15%/20%/30%」
 *   → 步数 = `floor(金币 / perGold)`，加成 = 步数 × 该星级的比例。
 *   例：3 星老鲤（3000 = 30%）、手上有 34 金币 → 3 步 × 30% = +90%。
 *
 * ★ 0.2：**可选的"金币封顶"**（`maxGold`）—— 策划表 R111 的散文列写
 *   「当金币达到 100 时达到最大值」，用户拍板要实现：金币先取
 *   `min(金币, maxGold)` 再去算步数。没配 `maxGold` 的棋子就是原来那样一直涨。
 *   ⚠️ 封顶那句**只存在于散文列**，结构化列（被动加成）里没有 ⇒
 *   导出表里我们会多渲染一段"（金币 100 封顶）"，对账时这一格会显示成差异，
 *   那是**故意多出来的信息**，不是没做完。
 *
 * 【为什么必须在**开局**折算一次，而不是每次 `collectMods` 现算？】
 * 因为 `collectMods` 拿不到"玩家有多少金币"—— 那是**场外状态**，
 * 只存在于 `createBattle` 收到的 `TeamSetup.playerContext` 里。
 * 而设计稿写的就是"开局按金币折算成固定加成"，战斗中金币本来也不会变
 * （见 types.ts 里这个字段的注释）。
 *
 * ★ 这里只负责**算**；算出来的值怎么落地由调用方决定
 *   （现用 `addBuff(..., passive: true)` 挂成一个常驻修正包，见 rules.ts）。
 *   这样 `mergeStats` / `collectMods` 那条既有链路一行都不用改。
 *
 * @param passive 这个棋子当前星级下的被动
 * @param gold    开局时玩家手里的金币
 * @returns 要加的攻击力（万分比）；没配这个被动 / 金币不够一步 = 0
 */
export function goldScalingAttackBpOf(
  passive:
    | {
        goldScalingAttackBp?: {
          perGold: number;
          ratioBp: import('./types.js').StarValue;
          maxGold?: number;
        };
      }
    | undefined,
  star: number,
  gold: number,
): number {
  const scaling = passive?.goldScalingAttackBp;
  if (!scaling) return 0;
  // 每多少金币算一步 —— 写 0 或负数会除出 Infinity，兜一个 1
  const perStep = Math.max(1, Math.floor(scaling.perGold));
  /*
    封顶只认**有限数字**：`undefined` = 不封顶；万一有人在数据里手写了个
    NaN / 负数，兜回"不封顶"而不是让整条加成变成 NaN
    （NaN 会让 `steps <= 0` 判不出来，一路把 NaN 抹到棋子攻击力上）。
  */
  const cap = scaling.maxGold;
  const countable = typeof cap === 'number' && Number.isFinite(cap) && cap >= 0 ? Math.min(gold, cap) : gold;
  const steps = Math.floor(Math.max(0, countable) / perStep);
  if (steps <= 0) return 0;
  return steps * starValue(scaling.ratioBp, star);
}

/**
 * ★ 0.2：把「按场上某职业人数加射程」的被动折算成**开局固定**的攻击距离。
 *
 * 【语义】设计稿（空弦）：「每上场 2 名阵营为 [远射] 的干员，攻击距离 +2 格」
 *   → 步数 = `floor(人数 / per)`，距离 = 步数 × 该星级的 `rangeFlat`。
 *   例：场上有 5 名远射、`per: 2` → 2 步 × 2 格 = +4 格。
 *
 * 【为什么必须在开局折算、而不是每 tick 数一遍？】
 * 和 `goldScalingAttackBpOf` 同一个理由：**"场上有几个远射"是队伍级信息**，
 * 而 `collectMods` 只看得到单个棋子（它连同队都有谁都不该知道）。
 * 开局数一次挂成常驻包，之后所有人的生死都不再影响它 —— 这也符合
 * "开局属性"的直觉（中途死人不会突然缩短射程）。
 *
 * @param passive   这个棋子当前星级下的被动
 * @param star      星级（取 `rangeFlat` 的哪一档）
 * @param allyCount 本队场上有几个带该 trait 的干员（**含自己**）
 * @returns 要加的攻击距离（格）；没配这条被动 / 人不够一步 = 0
 */
export function allyTraitRangeFlatOf(
  passive: { allyTraitRangeFlat?: { trait: string; per: number; rangeFlat: StarValue } } | undefined,
  star: number,
  allyCount: number,
): number {
  const scaling = passive?.allyTraitRangeFlat;
  if (!scaling) return 0;
  // 每多少人算一步 —— 写 0 或负数会除出 Infinity，兜一个 1
  const perStep = Math.max(1, Math.floor(scaling.per));
  const steps = Math.floor(Math.max(0, allyCount) / perStep);
  if (steps <= 0) return 0;
  return steps * starValue(scaling.rangeFlat, star);
}

// ============================================================
// 每 tick 推进
// ============================================================

/**
 * 推进一个棋子的技能状态。**顺序很重要**（确定性的一部分）：
 *   1. 自动回蓝
 *   2. 修正包倒计时 / 到期回收（含血量上限重算）
 *   3. 周期性脉冲（回血光环、范围伤害）
 *   4. 持续伤害 / 持续治疗
 *   5. 耀骑士那种"队友残血救援"的检查
 */
/**
 * ★★ 0.3.2 阿米娅·炉芯终曲「无言的期盼」：**每 2 秒随机抹除一名敌人**。
 *
 * 【"即死"为什么必须绕过保命】
 * 表里写得很明确：「立刻死亡，**无视无敌、重生、免死等一系列效果**」。
 * `killUnit` 里那一串分支（`reborn` → 命结之秘 → 不屈 → `cannotDie`）
 * 都是"这一击杀不死我"的设计，而这条技能的存在意义就是**不管这些**。
 *
 * 【怎么绕过】
 * 不去改 `killUnit` 的分支结构（一动就容易让某条保命悄悄失效），
 * 而是**在杀之前把那些保命来源逐个关掉**再走正常死亡流程：
 *   · `rebornUsed = true`      —— 跳过重生（茧甲 / 多阶段 Boss / 终曲自己）
 *   · `defyDeathUsed = 1`      —— 跳过若叶睦那种一次性锁血
 *   · `unyieldingRevives = 999` —— 不屈的概率衰减到 0
 *   · `statuses['cannotDie'] = 1` 标记（`killUnit` 开头的免死分支会读它以外的东西时兜底）
 * 关开关是幂等的、可读的；改分支则要重新验一遍所有保命组合。
 */
function tickExecute(state: BattleState, unit: UnitState): void {
  const plan = unit.executePlan;
  if (!plan) return;
  if (unit.dead) {
    unit.executePlan = undefined;
    return;
  }
  if (plan.ticksLeft <= 0) {
    unit.executePlan = undefined;
    return;
  }
  plan.ticksLeft -= 1;
  plan.timer += 1;
  if (plan.timer < plan.intervalTicks) return;
  plan.timer = 0;

  const foes = state.units.filter((other) => !other.dead && other.team !== unit.team);
  for (let i = 0; i < plan.count && foes.length > 0; i++) {
    const victim = foes.splice(state.rng.nextInt(foes.length), 1)[0];
    if (!victim) continue;
    /*
      ★ 0.3.2 表现层：**在杀之前**报一条 `executeFx`。
      放在 `killUnit` 之前是因为事件里要带 victim 的 id —— 死了之后 id 还在，
      但"报在导致它死的那一下之前"和 `slash` 是同一条口径（特效与掉血同帧）。
      ★ 纯表现层，不进校验和（computeChecksum 里 `continue` 掉了）。
    */
    if (plan.fx) {
      state.log.push({ type: 'executeFx', t: state.tick, unitId: victim.id, fx: plan.fx });
    }
    // 关掉一切"杀不死"的来源，再走正常死亡流程
    victim.rebornUsed = true;
    victim.statuses['defyDeathUsed'] = 1;
    victim.statuses['unyieldingRevives'] = 999;
    victim.hp = 0;
    killUnit(state, victim);
  }
}

export function tickSkill(state: BattleState, unit: UnitState): void {
  const runtime = unit.skill;
  if (!runtime) return;

  /*
    ★ 0.2 蕾缪安 3 星：锁定—引爆的推进。
    放在最前面 —— 引爆晚一 tick 就会和"先锁后炸"的边界撞上（第 7 个落点与引爆同 tick）。
  */
  tickLockOn(state, unit);
  // ★ 0.3.2 炉芯终曲：技能期间的周期性即死（每 intervalTicks 随机抹掉 count 个敌人）
  tickExecute(state, unit);

  /*
    ★ 0.2：**召唤物的"主人光环"** —— 我活着就给主人续一份状态
    （维什戴尔的魂灵之影："在场时，自身获得隐匿"）。

    【为什么写在召唤物这一侧、而不是主人的 buff 上？】
    因为"召唤物死了要把主人身上那份摘掉"这件事**没有回调点** ——
    挂在主人的 buff 上就得新增一个死亡钩子。
    反过来由召唤物每 tick 给主人续一份**短时长**包，召唤物一死就不再续，
    主人那边最多几 tick 后自然过期，**不用任何手动清理**。
    （续的是 passive 包：它是常驻被动，不该挡住主人回蓝。）
  */
  const aura = unit.skillPassive?.ownerAura;
  if (aura && !unit.dead) {
    const owner = state.units.find((other) => other.id === unit.summonOwnerId && !other.dead);
    if (owner) addBuff(owner, { stats: aura.stats, ticksLeft: 3, sourceId: unit.id, passive: true });
  }

  // 1) 自动回蓝
  if (unit.manaSource === 'auto' && unit.manaPerSecond > 0 && !unit.dead) {
    runtime.manaAccum += unit.manaPerSecond;
    const grant = Math.floor(runtime.manaAccum / TICKS_PER_SECOND);
    if (grant > 0) {
      runtime.manaAccum -= grant * TICKS_PER_SECOND;
      /*
        ★ 0.1.3：自动回复**不受"技能生效中不攒蓝"限制**。
        技能自己持续的那一两秒不该从"每 10 秒一轮"里扣掉 ——
        不这样的话锏的 CD 会变成 12 秒以上（用户报的"停几秒再回"就是它）。
      */
      gainMana(state, unit, grant, { duringSkill: true });
    }
  }

  // 2) 修正包倒计时
  let changed = false;
  for (let i = runtime.buffs.length - 1; i >= 0; i--) {
    const buff = runtime.buffs[i]!;
    if (buff.ticksLeft !== MAX_BATTLE_TICKS) {
      buff.ticksLeft--;
      if (buff.ticksLeft <= 0) {
        runtime.buffs.splice(i, 1);
        changed = true;
        /*
          ★ 0.2 洛洛「锁链」：这一包**到期时**结算一次伤害。
          ★ 放在回收点里而不是新加"技能结束"钩子 —— 回收点全仓库只有这一个，
            在这里顺手结算就不用额外处理"棋子中途死了""包被顶掉"这些边角。
          ★ 顺序：先 splice 再结算。这样万一这次伤害把谁打死了、触发了连锁，
            也不会看到"一个已经过期的包还挂在身上"。
        */
        const expire = buff.stats.onExpireDamage;
        if (expire) fireExpireDamage(state, unit, expire);
      }
    }
  }
  if (changed) {
    runtime.version++;
    // 血量上限可能被改过（维娜的 +1000%），回收时要重算并夹住当前血量
    refreshMaxHp(unit);
  }

  // 3) 脉冲
  const mods = collectMods(state, unit);
  if (mods.pulse) {
    /*
      ★ 0.2：`intervalFromAttackSpeed` 的脉冲**间隔跟着自己的攻速走**
      （夜莺"按照攻击频率恢复范围内友军的生命值"）。
      每 tick 问一次（而不是开局烘死）—— 攻速被技能/羁绊改过之后，治疗频率会跟着变。
      计算只有一处实现：`mods.ts` 的 `pulseIntervalTicks()`。
    */
    runtime.pulseTimer++;
    if (runtime.pulseTimer >= pulseIntervalTicks(unit, mods.pulse)) {
      runtime.pulseTimer = 0;
      /*
        ★ 0.2 可露希尔 Q.E.D 的"造成 9 次伤害后换成 180%"靠这个计数 ——
        口径是**全局跳数**（这一跳打到几个人都只算一跳），与用户的拍板一致。
        计数和脉冲计时器同一处推进，所以"每 0.5 秒一跳"和"跳过几次"天然对齐。
      */
      runtime.pulseHits++;
      firePulse(state, unit, mods.pulse, runtime.pulseHits);
    }
  }

  // 4) 持续伤害 / 治疗
  runTimedEffects(state, unit);

  // 5) 队友残血救援（耀骑士临光）
  const guard = mods.allyLowHpGuard;
  if (guard && runtime.guardUses < guard.maxUses) tryGuardAlly(state, unit, guard);
}

/**
 * ★ 0.2：一包修正包**到期时**结算的伤害（洛洛"技能结束后对目标造成一次…"）。
 *
 * 打谁：**当前锁定的目标**（`unit.targetId`）。没锁到人（或人已经死了）就整条不结算 ——
 * 这符合"技能结束顺手补一下"的直觉，也避免为了补一下去满场找目标。
 */
function fireExpireDamage(
  state: BattleState,
  unit: UnitState,
  spec: { power: StarValue; damageType: 'physical' | 'magic' | 'true' },
): void {
  if (unit.dead) return;
  const target = getUnit(state, unit.targetId);
  if (!target || target.dead || target.team === unit.team) return;
  const amount = Math.floor((unit.attackDamage * starValue(spec.power, unit.star)) / FIX);
  if (amount > 0) dealDamage(state, unit, target, amount, spec.damageType, 'spell');
}

/** 周期性脉冲：范围伤害 / 范围治疗 / 光环增益 */
function firePulse(state: BattleState, unit: UnitState, pulse: ResolvedPulse, hits: number): void {
  const style = moveStyleOf(unit);
  /*
    ★ 0.2 可露希尔 Q.E.D：第 `rampAfterHits.hits` 跳之后换成加强倍率。
    判断放在**循环外**（这一跳的全体敌人吃同一个倍率）——
    写进循环里的话，同一跳里第 1 个和第 3 个敌人会吃到不同倍率，
    那不是"造成 9 次伤害后"该有的口径。
  */
  let damageRatioBp = pulse.damage?.ratioBp ?? 0;
  if (pulse.damage && pulse.rampAfterHits && hits > pulse.rampAfterHits.hits) {
    damageRatioBp = pulse.rampAfterHits.ratioBp;
  }
  /*
    ★ 光环的范围框：治疗画绿框、伤害画白框，中心是**施法者自己**、半径用脉冲半径。
    光环是每秒刷一次的，框的存活时间取 1.2 秒 —— 比间隔略长，
    所以看起来是"一直亮着一个圈"，正是光环该有的观感；
    而它一旦停止（棋子死了），框会在 1.2 秒内消失，不会残留。
  */
  const auraTicks = Math.max(ZONE_FLASH_TICKS, pulse.intervalTicks + 4);
  let healedAny = false;
  let damagedAny = false;

  /*
    ★ 0.2：**单目标**脉冲（三角初华）—— 每跳只挑"随机一名敌人 + 一名友方"。
    半径内先按口径各挑一个，再进循环；挑选本身走 `state.rng`（联机两边一致）。
    ★ 治疗的优先级：先看 `healPreferDefId`（我方有丰川祥子就优先她），
      她不在场 / 不在范围 / 已满血时退回"血量最低"。
  */
  const wantsEnemies = pulse.affect === 'enemies' || pulse.affect === 'both';
  const wantsAllies = pulse.affect === 'allies' || pulse.affect === 'both';
  const inRadius = state.units.filter(
    (other) => !other.dead && withinRadius(unit.cell, other.cell, pulse.radius),
  );
  const preferAlly = pulse.healPreferDefId
    ? inRadius.find(
        (other) =>
          other.team === unit.team &&
          other.defId === pulse.healPreferDefId &&
          other.hp < other.maxHp,
      )
    : undefined;
  /*
    ★ 0.2：敌方的优先级 —— 先看 `attackPreferDefId`（对面有丰川祥子就先打她），
    对面没有 / 已经倒下 / 不在范围里才退回"范围内随机一名"。
    ★ 和治疗的顺序相反（治疗优先看"血最少"），因为这里要的是"点掉指定的人"。
  */
  const preferEnemy = pulse.attackPreferDefId
    ? inRadius.find((other) => other.team !== unit.team && other.defId === pulse.attackPreferDefId)
    : undefined;
  const singleEnemy = pulse.single
    ? (preferEnemy ??
      (() => {
        const pool = inRadius.filter((other) => other.team !== unit.team);
        return pool.length > 0 ? pool[state.rng.nextInt(pool.length)] : undefined;
      })())
    : undefined;
  const singleAlly = pulse.single
    ? (preferAlly ??
      inRadius
        .filter((other) => other.team === unit.team)
        .sort((a, b) => a.hp / Math.max(1, a.maxHp) - b.hp / Math.max(1, b.maxHp) || a.id - b.id)[0])
    : undefined;

  for (const other of state.units) {
    if (other.dead) continue;
    // 光环范围用"方块半径"，和界面上画的那个绿框/白框完全一致
    if (!withinRadius(unit.cell, other.cell, pulse.radius)) continue;

    const isAlly = other.team === unit.team;
    if (!wantsEnemies && !isAlly) continue;
    if (!wantsAllies && isAlly) continue;
    // 纯伤害脉冲不该打到自己；治疗脉冲可以治自己（夜莺/魔王的"范围内我方"包含自己）
    if (!wantsAllies && other.id === unit.id) continue;
    // ★ 0.2 单目标：这一跳只对挑中的那两个人生效
    if (singleEnemy && !isAlly && other.id !== singleEnemy.id) continue;
    if (singleAlly && isAlly && other.id !== singleAlly.id) continue;

    /*
      ★★ 0.2：**双向脉冲要先分阵营**。
      `affect: 'both'` 是"一拍里既打人又奶人"（三角初华），
      但伤害/治疗两段必须各管一边 —— 第一版没分，结果她把自己和队友也打了
      （出过一次：初华开技能掉自己的血，日志里目标 = 自己）。
      ★ `affect: 'enemies'` / `'allies'` 的老脉冲不受影响：它们本来就只有一段。
    */
    if (pulse.damage && !isAlly) {
      const amount = basisAmount(unit, other, pulse.damage.basis, damageRatioBp);
      if (amount > 0) {
        damagedAny = true;
        dealDamage(state, unit, other, amount, pulse.damage.damageType, 'spell');
      }
    }
    if (pulse.heal && isAlly) {
      // ★ 0.2：可以是"目标生命上限 % + 自身攻击力 %"两条相加（夜莺）
      const amount = healAmountOf(unit, other, pulse.heal);
      if (amount > 0) {
        healedAny = true;
        healUnit(state, unit, other, amount);
      }
    }
    if (pulse.buff && pulse.buffDurationTicks > 0) {
      addBuff(other, { stats: pulse.buff, ticksLeft: pulse.buffDurationTicks, sourceId: unit.id });
    }
    /*
      ★ 0.2 可露希尔 Q.E.D：「被锁定目标攻速 -50%（**此效果单个目标仅生效一次，持续 5s**）」。
      名单存在施法者的运行时上（`pulseDebuffed`）—— 记在**施法者**身上而不是目标身上，
      是因为判据是"这个技能有没有对它生效过"，别的棋子给的同类减益不该互相干扰。
    */
    if (pulse.pulseDebuffOnce && !unit.skill?.pulseDebuffed.includes(other.id)) {
      unit.skill?.pulseDebuffed.push(other.id);
      addBuff(other, {
        stats: pulse.pulseDebuffOnce.stats,
        ticksLeft: Math.max(1, pulse.pulseDebuffOnce.durationTicks),
        sourceId: unit.id,
      });
    }
  }

  // 框只在"真的发生在谁身上"时画 —— 空放不画（不然会骗人）
  if (damagedAny) emitZone(state, unit, unit.cell, pulse.radius, 'square', 'damage', auraTicks, pulse.fx ?? undefined);
  if (healedAny) emitZone(state, unit, unit.cell, pulse.radius, 'square', 'heal', auraTicks, pulse.fx ?? undefined);
}

/**
 * ★ 0.1.3：范围持续伤害"每跳命中后挂的负面包"用的来源标记（负数，绝不会和棋子 id 撞）。
 * 高频跳（锏是每 0.2 秒一次）如果不先摘掉旧的，一秒就能堆出 5 份重复的战栗。
 */
const SOURCE_DOT_DEBUFF = -2;

/** 持续伤害 / 持续治疗逐 tick 结算 */
function runTimedEffects(state: BattleState, unit: UnitState): void {
  const runtime = unit.skill;
  if (!runtime || runtime.timed.length === 0) return;

  for (let i = runtime.timed.length - 1; i >= 0; i--) {
    const effect = runtime.timed[i]!;
    effect.timer++;
    if (effect.timer >= effect.intervalTicks) {
      effect.timer = 0;
      if (!unit.dead) {
        const source = getUnit(state, effect.sourceId) ?? null;
        if (effect.kind === 'dot') {
          /*
            ★ 0.1.3：**范围**持续伤害（锏的"2 秒内每 0.2 秒斩一次"）。
            挂在施法者自己身上，每跳以**它当前的位置**为中心打一圈 —— 所以它一边走一边斩。
            ★ 战栗只在"这一跳真的打到了"的时候挂，而且是**先摘旧的再挂**
            （连击式的高频跳会一秒挂 5 次，不摘会堆出一串重复包）。
          */
          if (effect.radius && effect.shape) {
            /*
              ★ 0.1.3：**每跳报一条「斩击」事件** —— 界面就是靠它在棋盘上画那一刀
              （锏的"2 秒 10 刀"因此天然是"跳一次、挥一刀"，多一跳就多一刀）。
              ★ 报在伤害**之前**：这样特效和掉血落在同一帧，不会出现
              "先掉血、半秒后才挥刀"的错位。
              ★ 这个事件不进校验和（见 computeChecksum），纯表现层。
            */
            state.log.push({
              type: 'slash',
              t: state.tick,
              unitId: unit.id,
              radius: effect.radius,
              shape: effect.shape,
            });
            const style = moveStyleOf(unit);
            for (const foe of state.units) {
              if (foe.dead || foe.team === unit.team) continue;
              if (!withinShape(unit.cell, unit.cell, foe.cell, effect.radius, effect.shape, style)) continue;
              dealDamage(state, source, foe, effect.amount, effect.damageType, 'spell', effect.sourceId);
              if (effect.debuff && !foe.dead) {
                if (foe.skill) {
                  foe.skill.buffs = foe.skill.buffs.filter((buff) => buff.sourceId !== SOURCE_DOT_DEBUFF);
                  foe.skill.version++;
                }
                addBuff(foe, {
                  stats: effect.debuff.stats,
                  ticksLeft: effect.debuff.durationTicks,
                  sourceId: SOURCE_DOT_DEBUFF,
                });
              }
            }
          } else {
            // sourceIdOverride 保证即使施法者已经阵亡，伤害归属也不会丢
            dealDamage(state, source, unit, effect.amount, effect.damageType, 'spell', effect.sourceId);
          }
        } else {
          healUnit(state, source, unit, effect.amount);
        }
      }
      /*
        ★★ 0.1.3 修：`ticksLeft` 的语义是**跳数**（`addTimed` 里写的是
        `durationTicks / intervalTicks`），所以它只能在**跳发生的那一刻**减。
        原来它每 tick 都减一次 —— 于是"5 秒里每秒一跳"的持续伤害
        实际只持续 **5 tick（0.25 秒）**就消失了。
        锏的"2 秒内斩 10 次"最明显：只跳了 2~3 次就结束（用户报的就是这个）。
      */
      effect.ticksLeft--;
      if (effect.ticksLeft <= 0) runtime.timed.splice(i, 1);
    }
  }
}

/** 耀骑士临光：队友掉到阈值以下时瞬移过去给盾 + 自己加攻 */
function tryGuardAlly(state: BattleState, unit: UnitState, guard: ResolvedGuard): void {
  const runtime = unit.skill;
  if (!runtime) return;
  for (const ally of state.units) {
    if (ally.dead || ally.team !== unit.team || ally.id === unit.id) continue;
    if (ally.hp * BP > ally.maxHp * guard.thresholdBp) continue;
    if (ally.statuses['guardShield'] === 1) continue; // 同一个队友只救一次

    const spot = findEmptyNear(state, ally.cell, moveStyleOf(unit), {
      preferOwnHalf: unit.team,
      nearerTo: unit.cell,
    });
    if (spot) moveUnitTo(state, unit, spot);
    const shield = Math.floor((unit.maxHp * guard.shieldBasisCasterMaxHp) / BP);
    applyShield(state, unit, ally, shield, guard.selfBuffTicks);
    ally.statuses['guardShield'] = 1;
    addBuff(unit, {
      stats: { attackDamageBp: guard.selfAttackBp },
      ticksLeft: guard.selfBuffTicks,
      sourceId: unit.id,
    });
    runtime.guardUses++;
    return;
  }
}

// ============================================================
// 选目标
// ============================================================

/** 根据规则挑出施法目标。返回顺序固定（按 id 升序 / 按距离）=> 确定性 */
export function resolveTargets(
  state: BattleState,
  caster: UnitState,
  rule: TargetRule,
  /** ★ 0.1.3：`highestAttackEnemies` 这类"若干名"的规则要几个目标（默认 1） */
  count = 1,
): UnitState[] {
  const enemies: UnitState[] = [];
  const allies: UnitState[] = [];
  for (const unit of state.units) {
    if (unit.dead) continue;
    if (unit.team === caster.team) allies.push(unit);
    else enemies.push(unit);
  }
  return pickTargetsFrom(state, caster, enemies, allies, rule, count);
}

/**
 * ★ 0.2：**队友类规则**（`*Ally`）的统一入口 —— 候选里**不含施法者自己**。
 *
 * ============================================================
 *  【为什么非要单独开一个入口？】
 * ============================================================
 * `resolveTargets` 把同队**所有人**都塞进 `allies`（**包括施法者自己**）——
 * 对"选中自己"这类规则（见 skill-data 里 `target: 'self'`）是对的，
 * 但设计稿里凡是写"队友"的地方（芙蓉"治疗血量最低的**队友**"、
 * 凯尔希"百分比生命值最低的一名**队友**"）都**不该把施法者算进去**。
 *
 * 以前这件事在三个地方各写了一遍：
 *   · `resolveTargets` 的队友分支（含自己）
 *   · `rules.ts` 的 `resolveAllyTarget`（含自己）
 *   · `rules.ts` 的 `pickAllyForBuff`（**只认 randomAlly / nearestAlly**）
 * 第三处就是 0.2 那个静默 bug 的来源：凯尔希的目标从 `nearestAlly` 改成
 * `lowestHpRatioAlly` 之后，它不认识这个值，**一路掉进 default 的"最近的队友"**——
 * 数据改了、消费方没跟上，不报错、只是效果不对（表面"治疗残血队友"，
 * 实际还在治最近的那个）。导出表里那一格渲染成裸 id（`→ lowestHpRatioAlly`）
 * 就是当时唯一的线索。
 *
 * 所以现在**收敛成一处**：候选表的构造 + 挑选规则都走 `pickTargetsFrom`，
 * 队友类调用方统一从 `resolveAllyTargets` 进（它保证"不含自己"）。
 *
 * @param rule 只应当传 `*Ally` 类规则；传敌人规则会得到空数组（候选表里没有敌人）
 */
export function resolveAllyTargets(
  state: BattleState,
  caster: UnitState,
  rule: TargetRule,
  count = 1,
): UnitState[] {
  const allies: UnitState[] = [];
  for (const unit of state.units) {
    if (unit.dead || unit.team !== caster.team || unit.id === caster.id) continue;
    allies.push(unit);
  }
  return pickTargetsFrom(state, caster, [], allies, rule, count);
}

/**
 * 选目标的**唯一实现** —— `resolveTargets` / `resolveAllyTargets` 都从这里进，
 * 差别只在"候选表里放了谁"（自己算不算队友、敌人有没有）。
 * 新增一条 `TargetRule` 只需要在这里加一个 `case`，不必再担心有哪条旁路漏改。
 */
function pickTargetsFrom(
  state: BattleState,
  caster: UnitState,
  enemies: UnitState[],
  allies: UnitState[],
  rule: TargetRule,
  count: number,
): UnitState[] {
  switch (rule) {
    case 'self':
      return caster.dead ? [] : [caster];

    case 'currentTarget': {
      if (caster.targetId < 0) return [];
      const target = getUnit(state, caster.targetId);
      return target && !target.dead ? [target] : [];
    }

    case 'nearestEnemy':
      return pickExtreme(enemies, caster, true);

    case 'farthestEnemy':
      return pickExtreme(enemies, caster, false);

    case 'lowestHpEnemy': {
      const sorted = enemies.slice().sort((a, b) => a.hp - b.hp || a.id - b.id);
      return sorted.length > 0 ? [sorted[0]!] : [];
    }

    case 'highestHpEnemy': {
      const sorted = enemies.slice().sort((a, b) => b.hp - a.hp || a.id - b.id);
      return sorted.length > 0 ? [sorted[0]!] : [];
    }

    /*
      ★ 0.1.3：攻击力最高的**若干名**敌人（"左手"一次要削 3 个）。
      【为什么按 `attackDamage` 排？】技能描述写的就是"攻击力最高"，
      所以取棋子当前的攻击力（技能 / 羁绊加成之后的值）—— 和玩家在面板上看到的一致。
      【同值怎么办？】按 id 升序 —— 保证确定性（联机两边必须挑出同一批人）。
    */
    case 'highestAttackEnemies': {
      const sorted = enemies.slice().sort((a, b) => b.attackDamage - a.attackDamage || a.id - b.id);
      return sorted.slice(0, Math.max(1, count));
    }

    case 'allEnemies':
      return enemies;

    case 'enemiesInRadius3':
      // 「我周围 3 格」是画在棋盘上的一个方块，用方块半径（不是曼哈顿）
      return enemies.filter((unit) => withinRadius(caster.cell, unit.cell, 3));

    /*
      ★ 0.2：**我自己攻击范围内**的敌人（八幡海铃"攻击范围内的敌人眩晕"）。
      跟着**当前射程**走（能吃到射程加成），所以用 `effectiveRange` 而不是写死 3。
    */
    case 'enemiesInRange': {
      const reach = effectiveRange(state, caster);
      return enemies.filter((unit) => withinRadius(caster.cell, unit.cell, reach));
    }

    case 'enemiesAroundTarget': {
      const target = caster.targetId >= 0 ? getUnit(state, caster.targetId) : undefined;
      if (!target || target.dead) return [];
      const style = moveStyleOf(caster);
      return enemies.filter((unit) => cellDistance(target.cell, unit.cell, style) <= 1);
    }

    case 'randomEnemies': {
      if (enemies.length === 0) return [];
      return [enemies[state.rng.nextInt(enemies.length)]!];
    }

    case 'lowestHpAlly': {
      const sorted = allies.slice().sort((a, b) => a.hp - b.hp || a.id - b.id);
      return sorted.length > 0 ? [sorted[0]!] : [];
    }

    /*
      ★ 0.2：按**百分比**血量最低（不是绝对值）。
      用**交叉相乘**比较（`a.hp × b.maxHp` vs `b.hp × a.maxHp`），不做除法 ——
      全整数、没有浮点误差，并列时按 id 排，确定性不受影响。
    */
    case 'lowestHpRatioAlly': {
      const sorted = allies.slice().sort((a, b) => a.hp * b.maxHp - b.hp * a.maxHp || a.id - b.id);
      return sorted.length > 0 ? [sorted[0]!] : [];
    }

    case 'lowestHpRatioEnemy': {
      const sorted = enemies.slice().sort((a, b) => a.hp * b.maxHp - b.hp * a.maxHp || a.id - b.id);
      return sorted.length > 0 ? [sorted[0]!] : [];
    }

    case 'nearestAlly': {
      // 「不包括自己」—— 见行者/伊内丝/凯尔希写的都是"友方/队友"
      const others = allies.filter((unit) => unit.id !== caster.id);
      return pickExtreme(others, caster, true);
    }

    case 'randomAlly': {
      const others = allies.filter((unit) => unit.id !== caster.id);
      if (others.length === 0) return [];
      return [others[state.rng.nextInt(others.length)]!];
    }

    case 'allAllies':
      return allies;
  }
}

function pickExtreme(list: UnitState[], caster: UnitState, nearest: boolean): UnitState[] {
  let best: UnitState | null = null;
  let bestDistance = nearest ? Number.MAX_SAFE_INTEGER : -1;
  const sorted = list.slice().sort((a, b) => a.id - b.id);
  const style = moveStyleOf(caster);
  for (const unit of sorted) {
    const distance = cellDistance(caster.cell, unit.cell, style);
    if (nearest ? distance < bestDistance : distance > bestDistance) {
      bestDistance = distance;
      best = unit;
    }
  }
  return best ? [best] : [];
}

/**
 * ★★ 0.2.2 剑士羁绊：开技能时**瞬移到血量最少的敌人面前**，并眩晕那个敌人。
 *
 * 【"面前那一格"落在哪？】
 * 直接用 `findEmptyNear`（瞬移/召唤的**唯一**落点实现），它的既定三层优先级就是：
 *   ① 攻击距离内的空格（跳过去当回合就能打到）
 *   ② 同样在距离内时，选**离发起者最近**的那一格 ⇒ 落在"敌人朝我这一面"
 *   ③ 一格都没有，才退到"离目标最近的空格"
 * ⇒ ①② = 「面前的格子」，③ = 「若无位置则找最近的位置」。不另写一套落点逻辑。
 *
 * 【已经贴脸了还跳吗？】
 * 不跳。`findEmptyNear` 不可能返回施法者自己那一格（那格不是空格），
 * 所以"原地已经很近了"的时候跳一下等于把自己挪到旁边的空格 —— 纯属白丢位置，
 * 还会让"我要打谁"变得不可预测。贴脸就只眩晕、不位移。
 *
 * 【眩晕为什么用 `applyStun`？】
 * 全仓库只有它一处写 `statuses['stun']`（延迟由 rules.ts 统一处理），
 * 自己写一份就必然出现"同一段眩晕算了两次"的老 bug。
 */
function applyOnCastBlinkStrike(
  state: BattleState,
  caster: UnitState,
  mechanic: { target?: TargetRule; fallback?: TargetRule; stunTicks: number },
): void {
  let targets = resolveTargets(state, caster, mechanic.target ?? 'lowestHpEnemy');
  if (targets.length === 0 && mechanic.fallback) targets = resolveTargets(state, caster, mechanic.fallback);
  const target = targets[0];
  if (!target || target.dead) return;

  const style = moveStyleOf(caster);
  if (cellDistance(caster.cell, target.cell, style) > MELEE_RANGE) {
    const spot = findEmptyNear(state, target.cell, style, { nearerTo: caster.cell });
    if (spot) moveUnitTo(state, caster, spot);
  }
  applyStun(state, caster, target, mechanic.stunTicks);

  /*
    ★★ 0.2.2 剑士（**只有 6 / 9 人档**）：**瞬移之后**，这一档羁绊给的
    攻击力 / 攻速加成**翻倍**，本场有效、每个棋子只翻一次。
    ★ 放在 `applyStun` 之后、`castSkill` 的 `applyEffect` 之前 ——
      也就是说"跳过去 → 加成翻倍 → 这一发技能就吃到翻倍后的攻击力"，
      和用户说的"瞬移后"顺序一致。
    ★ 即使落点就在原地（已经贴脸、没挪），也算"这一次瞬移发生了"：
      否则同一个技能会因为站位不同而时有时无，玩家根本没法预期。
  */
  if ((caster.trait?.mechanics ?? []).some((item) => item.kind === 'blinkDoublesTraitBonus')) {
    doubleTraitBonusAfterBlink(state, caster);
  }
}

/**
 * ★★ 0.2.2 剑士：把**羁绊给的那部分**攻击力 / 攻速加成翻倍。
 *
 * 【为什么不直接挂一个"和羁绊一样大"的 buff？】
 * 因为 buff 的 `*Bp` 是**乘在已经加成过的数值上**的：
 * 9 人档 +55% 再挂 +55% ⇒ `1.55 × 1.55 = 2.40 倍`，而"翻倍"要的是
 * `1 + 0.55×2 = 2.10 倍`。差得不算小。
 *
 * 【所以挂多少？】
 * 设羁绊给的是 `x`（万分比），想在 `(1 + x)` 的基础上变成 `(1 + 2x)`，
 * 额外那一层的倍率就是 `x / (1 + x)`。整数 bp 取整误差 < 0.01%，肉眼看不出来。
 *
 * @returns 有没有真的翻（已经翻过、或这一档羁绊没给攻/攻速 → 什么都不做）
 */
function doubleTraitBonusAfterBlink(state: BattleState, unit: UnitState): void {
  if (unit.traitBonusDoubled) return;
  const bp = unit.traitBonusBp;
  if (!bp) return;
  /** (1+x) → (1+2x) 需要的额外倍率 */
  const extraOf = (value: number): number => Math.floor((value * 10000) / (10000 + value));
  const stats: SkillStats = {};
  if (bp.attackDamageBp > 0) stats.attackDamageBp = extraOf(bp.attackDamageBp);
  if (bp.attackSpeedBp > 0) stats.attackSpeedBp = extraOf(bp.attackSpeedBp);
  if (stats.attackDamageBp === undefined && stats.attackSpeedBp === undefined) return;
  /*
    ★ `passive: true` 必带：这是羁绊层的永久加成，不是"技能生效中"——
      不带的话 `gainMana` 会把这个人当成还在放技能，整场回不了蓝
      （0.2 已经在这个坑里栽过一次）。
  */
  addBuff(unit, { stats, ticksLeft: FOREVER_TICKS, sourceId: unit.id, passive: true });
  // 记一条事件：面板要能立刻看到攻击力/攻速跳上去（时间线采样只认事件）
  emitBuffEvents(state, unit.id, unit, stats, FOREVER_TICKS);
  unit.traitBonusDoubled = true;
}

// ============================================================
// 释放技能
// ============================================================

/**
 * 释放技能：按顺序执行所有效果。
 * 每个效果都会**重新选一次目标** —— 因为前一个效果可能已经把人打死了。
 */
export function castSkill(
  state: BattleState,
  caster: UnitState,
  skillId: string,
  effects: SkillEffect[],
  defs: UnitDefTable,
  /** ★ 0.2.1 表现层：这一套技能释放时播哪套特效（`SkillDef.castFx`），不进校验和 */
  fx?: string,
): void {
  state.log.push({ type: 'cast', t: state.tick, unitId: caster.id, skillId, ...(fx ? { fx } : {}) });

  /*
    ★★ 0.2.2 剑士：**开启技能的那一刻**瞬移到「血量最少的敌人」面前，并把那个敌人眩晕。
    见 `TraitMechanic.onCastBlinkStrike`。

    【为什么放在 applyEffect 之前？】
    因为它的语义是"跳进去再打" —— 跳过去之后，技能本身的索敌（最近敌人 /
    范围内所有敌人…）是在**新位置**上算的。放在后面就变成"在原地打完再飞走"，
    和"瞬移到敌人面前"完全不是一回事。

    【为什么读 `caster.trait.mechanics` 而不是进技能表？】
    这是**羁绊**给全体剑士的效果（三档只是时长不同），
    写进技能表就得给每个剑士各复制一份 —— 又是"同一动作两处实现"。

    【为什么 tick 0 直接跳过？】
    0.2 有一条"开局自动放一次技能"的路（fever 免死窗口，见 rules.ts）。
    那时候 `spawn` 事件**还没记**（它在后面才统一 push），
    这时候插一条 `move` / `status` 事件会排在 spawn 前面，表现层按 unitId
    找不到棋子。开局那一发本来也不该有"跳进去"的演出。
  */
  if (state.tick > 0) {
    for (const mechanic of caster.trait?.mechanics ?? []) {
      if (mechanic.kind !== 'onCastBlinkStrike') continue;
      applyOnCastBlinkStrike(state, caster, mechanic);
    }
  }

  for (const effect of effects) {
    applyEffect(state, caster, effect, defs);
  }

  /*
    ★ 0.0.3 藏品：开技能时给自己挂限时增益（骑士戒律「+50% 攻击力/攻速，持续 10 秒」）。

    【「10 秒内只能触发一次 / 不可叠加」怎么实现？】
    挂新包之前先看**同一件藏品**的包还在不在（判定用 `buff.stats === mechanic.stats`
    这个对象引用：ITEM_DEFS 里的 stats 是模块级常量，机制里带的就是它本身，
    resolveWearerItems 只给机制加了 traitId、没换 stats）：
      · 还在生效 → **直接跳过**：不重新挂、也不刷新时间 ——
        所以"10 秒内又开了一次技能"不会叠成 +100%，也不会把时效一直续下去；
      · 已经过期 → 摘掉残留（正常由 tickSkill 清掉，这里是兜底）再挂新的。

    【为什么不干脆看 buff 的 sourceId？】
    因为 sourceId 是棋子 id，同一枚棋子的技能 buff 也是这个 id，
    没法区分"藏品挂的"和"技能自己挂的"，会把技能自己的增益误删。

    【为什么 passive: true？】
    这是**藏品**的效果，不是技能本身的效果 —— 用户拍板"骑士戒律按藏品效果算"，
    所以它不该参与 `isSkillActive`（那道"技能生效中不攒蓝"的闸），
    否则开一次技能就得再等 10 秒才能攒蓝，等于把这件藏品变成负收益。
    （"只能用一次"由上面那条时间限制保证，不靠闸门。）
  */
  const runtime = caster.skill;
  if (runtime) {
    for (const mechanic of caster.trait?.mechanics ?? []) {
      if (mechanic.kind !== 'onCastBuff') continue;
      const stillActive = runtime.buffs.some((buff) => buff.stats === mechanic.stats && buff.ticksLeft > 0);
      if (stillActive) continue;
      for (let i = runtime.buffs.length - 1; i >= 0; i--) {
        if (runtime.buffs[i]!.stats === mechanic.stats) runtime.buffs.splice(i, 1);
      }
      addBuff(caster, {
        stats: mechanic.stats,
        ticksLeft: mechanic.durationTicks,
        sourceId: caster.id,
        passive: true,
      });
      // 记一条事件，界面才能"开技能后面板立刻跳 +50%"（见 emitBuffEvents）
      emitBuffEvents(state, caster.id, caster, mechanic.stats, mechanic.durationTicks);
    }

    /*
      ★ 0.1.1 藏品二版：拳经三问「干员每使用过一次技能，自身的攻击力 +5%，
      最多叠加 20 层」。
      【为什么每层挂一个"永久属性包"而不是累加到一个字段里？】
      因为 collectMods 本来就是把挂着的包逐个累加的 —— 挂 5 个包就是 +25%，
      不用再维护一个"自己算的层数 × 每层值"的平行实现（那是我最容易写错的地方）。
      `castStacks` 只用来**封顶**（超过 20 层就不再挂）。
      每场战斗从 0 开始（设计稿没说跨回合保留）。
    */
    for (const mechanic of caster.trait?.mechanics ?? []) {
      if (mechanic.kind !== 'onCastRamp') continue;
      const trait = caster.trait;
      if (!trait) break;
      const stacks = trait.castStacks ?? 0;
      if (stacks >= mechanic.maxStacks) continue;
      trait.castStacks = stacks + 1;
      addBuff(caster, {
        stats: { attackDamageBp: mechanic.perCastBp },
        ticksLeft: FOREVER_TICKS,
        sourceId: caster.id,
        passive: true,
      });
      emitBuffEvents(state, caster.id, caster, { attackDamageBp: mechanic.perCastBp }, FOREVER_TICKS);
    }
  }

  caster.mana = 0;
}

function applyEffect(state: BattleState, caster: UnitState, effect: SkillEffect, defs: UnitDefTable): void {
  // 召唤 / 复活 / 陷阱不需要目标，先处理掉
  if (effect.kind === 'summon') {
    doSummon(state, caster, effect, defs);
    return;
  }
  if (effect.kind === 'revive') {
    doRevive(state, caster, effect, defs);
    return;
  }
  if (effect.kind === 'trap') {
    doTrap(state, caster, effect, defs);
    return;
  }
  // ★ 0.2 蕾缪安 3 星：锁定—引爆是一条"定时器"，也不挑目标（锁谁由 tick 里现挑）
  if (effect.kind === 'lockOn') {
    doLockOn(state, caster, effect);
    return;
  }

  /*
    ★ 0.1.3：`damage` / `debuff` 允许一次挑**多个**目标（"左手"一次削攻击力最高的 3 名）。
    其它效果没写 `count`，统一按 1 个处理。
  */
  const wanted = 'count' in effect ? starValue(effect.count ?? 1, caster.star) : 1;
  let targets = resolveTargets(state, caster, effect.target, wanted);
  if (targets.length === 0 && 'fallback' in effect && effect.fallback) {
    targets = resolveTargets(state, caster, effect.fallback);
  }
  if (targets.length === 0) return;

  for (const target of targets) {
    switch (effect.kind) {
      case 'damage': {
        const power = starValue(effect.power, caster.star);
        const hits = Math.max(1, starValue(effect.hits ?? 1, caster.star));
        for (let h = 0; h < hits; h++) {
          if (target.dead) break;
          if (effect.radius && effect.radius > 0) {
            /*
              ★ 0.3.2：`effect.fx` 一路传到 `zone` 事件的 `fx` 上 ——
              这就是慈悲愿景「3×4 方格阵 + 局部爆闪」的挂载点：
              内核真正结算出伤害的那一刻报出去，渲染层按 `from` + `radius` + `shape`
              用**同一个** `withinShape` 数格子，画出来的阵一定和实际打到的范围一致。
            */
            damageArea(state, caster, target.cell, power, effect.damageType, effect.radius, effect.shape ?? 'square', undefined, {
              fx: effect.fx,
            });
          } else {
            const amount = Math.floor((caster.attackDamage * power) / FIX);
            dealDamage(state, caster, target, amount, effect.damageType, 'spell');
          }
        }
        const knock = starValue(effect.knockback ?? 0, caster.star);
        /*
          ★ 0.2 妮芙：主伤害之外，**对目标周围**再结算一份**另一个倍率**的伤害。
          放在击退之前 —— 表里的顺序是"先打两段、再把它推开"，
          而且推开之后再算范围，圈的中心就不是原来那个位置了。
          ★ 圈里排除主目标自己（它已经吃过上面那一段了）。
        */
        if (effect.splash && !target.dead) {
          damageArea(
            state,
            caster,
            target.cell,
            starValue(effect.splash.power, caster.star),
            effect.splash.damageType,
            effect.splash.radius,
            effect.splash.shape ?? 'square',
            target,
          );
        }
        if (knock > 0 && !target.dead) {
          /*
            ★ 0.2：见行者的「击退路线上的敌人一并眩晕 + 附伤」。
            ★ 路线上的单位必须在**击退之前**挑出来 —— 击退会把目标挪走，
              之后再数格子，站位就变了（而且"路线"本来也不该包含目标的新位置）。
          */
          const onPath =
            effect.pathStun && knock > 0
              ? knockbackRoute(state, caster, target, knock).filter(
                  (unit) => unit.team !== caster.team,
                )
              : [];
          knockback(state, caster, target, knock);
          if (effect.pathStun && onPath.length > 0) {
            const stunTicks = starValue(effect.pathStun.durationTicks, caster.star);
            const pathPower = starValue(effect.pathStun.power, caster.star);
            // 表里的口径是"连同目标一同眩晕" ⇒ 目标自己也晕
            if (!target.dead) applyStun(state, caster, target, stunTicks);
            for (const other of onPath) {
              if (other.dead) continue;
              applyStun(state, caster, other, stunTicks);
              const extra = Math.floor((caster.attackDamage * pathPower) / FIX);
              if (extra > 0) {
                dealDamage(state, caster, other, extra, effect.pathStun.damageType, 'spell');
              }
            }
          }
        }
        /*
          ★ 0.1.3：命中后给**被打到的**敌人挂负面包（锏的「被打的敌人获得 4 秒战栗」）。
          ★ 放在 `hits` 循环**之外** —— 10 段斩击只该挂一次战栗，不是挂 10 次。
        */
        if (effect.debuff && !target.dead) {
          addBuff(target, {
            stats: effect.debuff.stats,
            // ★ 0.3.2：时长可以是星级数组（慈悲愿景"迟缓 3/5/10 秒"），按施法者星级定死
            ticksLeft: starValue(effect.debuff.durationTicks, caster.star),
            sourceId: caster.id,
          });
        }
        break;
      }
      case 'execute': {
        /*
          ★ 0.3.2 炉芯终曲：技能期间**周期性即死**。
          这里只登记"接下来怎么杀"，真正的执行在 `tickSkill` 里的 `tickExecute`
          （它每 tick 跑一次，挑还活着的敌人）。
        */
        caster.executePlan = {
          ticksLeft: Math.max(0, Math.floor(effect.durationTicks)),
          intervalTicks: Math.max(1, effect.intervalTicks),
          timer: 0,
          count: Math.max(1, starValue(effect.count, caster.star)),
          // ★ 纯表现：原样带下去，由 tickExecute 在真杀掉人那 tick 报 `executeFx`
          ...(effect.fx ? { fx: effect.fx } : {}),
        };
        break;
      }
      case 'dot': {
        const interval = Math.max(1, effect.intervalTicks ?? TICKS_PER_SECOND);
        /*
          ★ 0.3.2：`powerBasis: 'targetMaxHp'` = 按**被打的人自己**的生命上限算
          （终曲「每秒受到自身最大生命 5% 的真实伤害」）。
          两个基数都是定点数，除 FIX 之后仍是定点，`dealDamage` 的口径不变。
        */
        const amount = Math.floor(
          ((effect.powerBasis === 'targetMaxHp' ? target.maxHp : caster.attackDamage) *
            starValue(effect.power, caster.star)) /
            FIX,
        );
        addTimed(target, {
          kind: 'dot',
          sourceId: caster.id,
          amount,
          damageType: effect.damageType,
          intervalTicks: interval,
          ticksLeft: Math.max(1, Math.floor(effect.durationTicks / interval)),
          timer: 0,
          // ★ 0.1.3：范围持续伤害（锏的"每 0.2 秒斩一圈"）—— 不写就是老行为（只打宿主）
          ...(effect.radius ? { radius: effect.radius, shape: effect.shape ?? 'square' } : {}),
          ...(effect.debuff
            ? {
                debuff: {
                  stats: effect.debuff.stats,
                  durationTicks: starValue(effect.debuff.durationTicks, caster.star),
                },
              }
            : {}),
        });
        break;
      }
      case 'heal': {
        const amount = healAmount(caster, target, starValue(effect.power, caster.star), effect.basis ?? 'attack');
        if (amount > 0) {
          healUnit(state, caster, target, amount);
          // 单体治疗也给个绿框：让"谁被奶了"看得见（半径 0 = 就他自己那一格）
          emitZone(state, caster, target.cell, 0, 'square', 'heal', ZONE_FLASH_TICKS);
        }
        break;
      }
      case 'healOverTime': {
        const interval = Math.max(1, effect.intervalTicks ?? TICKS_PER_SECOND);
        // ★ 0.2：时长可以按星级变（赤刃明霄陈"总量 15%/30%、速率 20%/s"⇒ 0.75 秒 / 1.5 秒）
        const ticks = starValue(effect.durationTicks, caster.star);
        addTimed(target, {
          kind: 'hot',
          sourceId: caster.id,
          amount: healAmount(caster, target, starValue(effect.power, caster.star), effect.basis ?? 'attack'),
          damageType: 'true',
          intervalTicks: interval,
          ticksLeft: Math.max(1, Math.floor(ticks / interval)),
          timer: 0,
        });
        /*
          持续治疗：在被治疗的人脚下画一个**持续整个技能时长**的绿框。
          魔王 3 星是"全体每秒回血"，所以会同时亮起几个绿框 ——
          那正好表达了"这几个棋子正在被持续治疗"。
        */
        emitZone(state, caster, target.cell, 0, 'square', 'heal', ticks);
        break;
      }
      case 'shield': {
        /*
          ★ 0.2：走统一入口。以前这里和 `rules.ts` 的开局效果里各写了一遍
          "flat 还是按生命上限"的算式，加"按已损失生命"就得改两处 —— 现在只有一处。
        */
        const grant = shieldGrantOf(effect, caster.star);
        applyShieldGrant(state, caster, target, grant, {
          boundTo: effect.skillBound ? caster.id : undefined,
        });
        if (effect.skillBound) markSkillAttachment(caster, target.id);
        /*
          ★ 机械师的「破盾子弹」：不是把配方挂到 statuses 上，而是挂到棋子上
          （见 types.ts 里 `shieldBullets` 的说明：补盾那一刻要能读回同一份配方）。
          ★ 只有写了 bullets 才建这一格 —— 别的护盾技能一点额外开销都没有。
        */
        if (effect.bullets !== undefined) {
          const runtime = caster.skill;
          if (runtime) {
            runtime.shieldBullets = { left: Math.max(0, starValue(effect.bullets, caster.star)), grant };
          }
        }
        break;
      }
      case 'stun':
        // ★ 0.2：时长可以按星级写（八幡海铃 1.5/2/10 秒），按**施法者**星级解析
        applyStun(state, caster, target, starValue(effect.durationTicks, caster.star));
        break;
      case 'buff':
        // attacks 有值 = 「接下来 N 次攻击」，此时持续时间写成"永久"，
        // 靠次数消耗掉它（见 rules.ts 的 performAttack）
        {
          const stats = resolvedCastStats(state, caster, effect.stats);
          addBuff(target, {
            stats,
            ticksLeft:
              effect.attacks !== undefined
                ? MAX_BATTLE_TICKS
                : starValue(effect.durationTicks, caster.star),
            attackCharges:
              effect.attacks !== undefined ? starValue(effect.attacks, caster.star) : undefined,
            sourceId: caster.id,
            /*
              ★ 0.1.4：给"按次数消耗的技能增益"打上来源标记 ——
              卡面靠它把这包显示成**弹药**（而不是笼统的「增益」）。
              ★ 必须由技能这一侧打：藏品的 `everyNthAttack` 和野怪的周期性强化
              形状完全一样（也是 `attackCharges`），只有这里能区分来源。
            */
            fromSkill: effect.attacks ? true : undefined,
            chargesPerAttack: effect.chargesPerAttack,
          });
          /*
            ★ 界面显示：限时增益记一条事件（面板靠 `buff` 事件实时跳数字）。
            按次数消耗的那种（`attacks`）**不记** —— 它的到期靠"打几下"，
            事件模型里只有"多少 tick 后到期"，记了会一直挂到战斗结束、显示成假的。
          */
          if (!effect.attacks) {
            emitBuffEvents(
              state,
              caster.id,
              target,
              stats,
              starValue(effect.durationTicks, caster.star),
              caster.star,
            );
          }
        }
        break;
      case 'debuff': {
        /*
          ★ 0.2 新约能天使：给最近友方挂的那份"攻速 -30%/-50%"要跟**技能结束**绑定，
          所以打上 `fromSkill`（= 这包是技能给的，能被 `tickSkillAttachments` 收走）。
          别的减益（塑心那种）不写 `skillBound`，行为一点不变。
          ★ 0.2：数值按**施法者**星级定死 —— 那份减益是施法者给出去的，
            不该按"被打的人"的星级算（1 星放的技能给 3 星敌人削 50% 攻速是没道理的）。
        */
        const stats = resolvedCastStats(state, caster, effect.stats);
        addBuff(target, {
          stats,
          ticksLeft: effect.durationTicks,
          sourceId: caster.id,
          fromSkill: effect.skillBound ? true : undefined,
        });
        emitBuffEvents(state, caster.id, target, stats, effect.durationTicks, caster.star);
        if (effect.skillBound) markSkillAttachment(caster, target.id);
        break;
      }
      case 'teleport': {
        const spot = findEmptyNear(state, target.cell, moveStyleOf(caster), { nearerTo: caster.cell });
        if (spot) moveUnitTo(state, caster, spot);
        break;
      }
      case 'gainMana':
        gainMana(state, caster, effect.amount);
        break;
    }
  }
}

/**
 * ★★ 0.2：把一条技能效果里的 `SkillStats` 变成"这一份落地时真正的数值"。
 *
 * 两件事，都只在这一个地方做（`buff` / `debuff` 共用）：
 *
 *  1. **按施法者的星级定死**（`resolveStatsForStar`）。
 *     以前 `addBuff` 把星级数组原样推进队列，由 `collectMods` 按**被挂的人**的星级解析 ——
 *     "自己给自己上"两种口径没差别，但"给队友上"就错了：
 *     1 星可露希尔给 2 星队友的加成会按队友的 2 星算，白送一级。
 *     （`debuffOnHit` 早就因为同样的理由在收集时定死了，这里补上另一半。）
 *
 *  2. **按金币加成**（可露希尔"此数值每有 10 金币额外增加 1%，最高上限 5%"）。
 *     金币从 `BattleState.playerGold` 取，按**施法者的队伍**算。
 *
 * 【为什么不挂在 `collectMods` 里现算？】`collectMods` 拿不到"玩家有多少金币"
 * 也拿不到"这份包是谁给的" —— 两个信息都只在放技能那一刻才齐全。
 */
function resolvedCastStats(state: BattleState, caster: UnitState, stats: SkillStats): SkillStats {
  const byStar = resolveStatsForStar(stats, caster.star);
  if (!byStar.goldBonusBp) return byStar;
  return withGoldBonus(byStar, state.playerGold[caster.team] ?? 0);
}

export function addTimed(target: UnitState, effect: TimedEffect): void {
  if (!target.skill) return;
  target.skill.timed.push(effect);
}

function healAmount(
  caster: UnitState,
  target: UnitState,
  power: number,
  basis: 'attack' | 'casterMaxHp' | 'targetMaxHp' | 'missingHp',
): number {
  const base =
    basis === 'casterMaxHp'
      ? caster.maxHp
      : basis === 'targetMaxHp'
        ? target.maxHp
        : basis === 'missingHp'
          ? Math.max(0, target.maxHp - target.hp)
          : caster.attackDamage;
  return Math.floor((base * power) / FIX);
}

/**
 * 范围伤害（技能版）。
 * 和普攻溅射共用"范围怎么算"的规则（withinShape），只是这里按技能倍率算伤害。
 *
 * ★ 0.2：搬到 `combat-math.ts` 去了 —— 因为"破盾爆炸"（机械师）要在
 * `combat-math` 里用同一份范围实现，而 `combat-math` 不能反过来依赖 `skills`。
 * 唯一实现仍然只有一份，这里只把名字引进来。
 */

// ============================================================
// 召唤 / 陷阱 / 复活 / 位移
// ============================================================

export function doSummon(
  state: BattleState,
  caster: UnitState,
  effect: Extract<SkillEffect, { kind: 'summon' }>,
  defs: UnitDefTable,
): void {
  const def = defs[effect.summonId];
  if (!def) return;
  const wanted = Math.max(1, starValue(effect.count, caster.star));

  /*
    ★ 「场上同时最多几只」的封顶（维娜 8 只 / 迷迭香 1 只 —— 你要求的）。
    【为什么要在召唤的时候扣掉已有的？】
    技能是每攒满一次法力就放一次的：不封顶的话，一个能撑住的召唤师
    在 20 秒里能堆出十几只金狮子，棋盘直接被塞满 ——
    对面根本走不过来（等于无条件控场），帧数也会掉。
    封顶之后，"场上现有几只"就是唯一的限制条件，玩家也好理解。
    只数**自己召唤的、同一编号的、还活着的**召唤物。
  */
  const alive = state.units.filter(
    (unit) => !unit.dead && unit.isSummon && unit.summonOwnerId === caster.id && unit.defId === effect.summonId,
  ).length;
  const room = effect.max === undefined ? wanted : Math.max(0, effect.max - alive);
  const count = Math.min(wanted, room);
  if (count <= 0) return;

  const hp = effect.hp ? starValue(effect.hp, caster.star) * FIX : undefined;
  const attackDamage = effect.attackDamage ? starValue(effect.attackDamage, caster.star) * FIX : undefined;

  for (let i = 0; i < count; i++) {
    let cell: { col: number; row: number } | null;
    if (effect.place === 'randomEmpty') {
      cell = randomEmptyCell(state);
    } else if (effect.place === 'randomEdge') {
      // ★ 0.1.3：从棋盘最外圈随机挑（血骑士的凝血之刃从场边走上来）
      cell = randomEdgeCell(state);
    } else if (effect.place === 'besideEnemy') {
      // "召唤在敌人旁边"落在**敌人朝我们这一面**（不限制半场，但不能绕到敌人背后）
      const enemyCell = nearestEnemyCell(state, caster);
      cell = enemyCell ? findEmptyNear(state, enemyCell, moveStyleOf(caster), { nearerTo: caster.cell }) : null;
    } else {
      // besideSelf / emptyAroundSelf：都是"自己周围找空格"
      cell = findEmptyNear(state, caster.cell, moveStyleOf(caster), {
        preferOwnHalf: caster.team,
        nearerTo: caster.cell,
      });
    }
    if (!cell) continue;
    // ★ 0.2：持续时间也允许按星级走（迷迭香的柱子 5/6/7 秒）
    spawnSummon(state, def, caster, cell, {
      hp,
      attackDamage,
      durationTicks: starValue(effect.durationTicks, caster.star),
    });
  }
}

function doTrap(
  state: BattleState,
  caster: UnitState,
  effect: Extract<SkillEffect, { kind: 'trap' }>,
  defs: UnitDefTable,
): void {
  const def = defs[effect.trapId];
  if (!def) return;
  const count = Math.max(1, starValue(effect.count, caster.star));
  const power = Math.floor((caster.attackDamage * starValue(effect.power, caster.star)) / FIX);
  for (let i = 0; i < count; i++) {
    const cell =
      effect.place === 'rangeEdge'
        ? rangeEdgeCell(state, caster)
        : effect.place === 'randomSpread'
          ? randomSpreadCell(state, caster)
          : trapBesideEnemyCell(state, caster, effect.place);
    if (!cell) continue;
    const trapUnit = spawnSummon(state, def, caster, cell, {
      hp: FIX,
      attackDamage: 0,
      durationTicks: effect.durationTicks,
    });
    if (trapUnit) trapUnit.trap = { radius: effect.radius ?? 1, power, damageType: effect.damageType };
  }
}

/**
 * 「全场随机放 N 个」（望的 3 星）。
 *
 * 【为什么不是真的全场随机？—— 探针逼出来的】
 * 一开始我就是纯随机挑空格。探针显示望的 3 星带队胜率只有 **12%**，
 * 原因很蠢：棋子有一半概率被放在**自己的半场**，而敌人永远不会走到那里，
 * 于是那几枚棋子从头到尾一次都没炸过 —— 技能等于没放。
 *
 * 现在分三级优先：
 *   1. 敌人附近 2 格内的空格（**最可能真的炸到人**）
 *   2. 敌方半场的空格（敌人总会走过去）
 *   3. 实在没位置了才退回全场
 * 这样既保留了"随机撒 5 个、位置不固定"的手感，
 * 又保证它们真的能参与战斗。
 */
function randomSpreadCell(state: BattleState, caster: UnitState): { col: number; row: number } | null {
  const half = BOARD_W / 2;
  const style = moveStyleOf(caster);
  const enemyCells = state.units.filter((unit) => !unit.dead && unit.team !== caster.team).map((unit) => unit.cell);

  const pick = (filter: (col: number, row: number) => boolean): { col: number; row: number } | null => {
    const empty: number[] = [];
    for (let i = 0; i < state.cellToUnit.length; i++) {
      if (state.cellToUnit[i] !== CELL_EMPTY) continue;
      const col = i % BOARD_W;
      const row = Math.floor(i / BOARD_W);
      if (!filter(col, row)) continue;
      empty.push(i);
    }
    if (empty.length === 0) return null;
    const index = empty[state.rng.nextInt(empty.length)]!;
    return { col: index % BOARD_W, row: Math.floor(index / BOARD_W) };
  };

  const nearEnemy = (col: number, row: number): boolean =>
    enemyCells.some((cell) => cellDistance(cell, { col, row }, style) <= 2);
  const inEnemyHalf = (col: number): boolean => (caster.team === 0 ? col >= half : col < half);

  return (
    pick((col, row) => inEnemyHalf(col) && nearEnemy(col, row)) ??
    pick((col) => inEnemyHalf(col)) ??
    pick(() => true)
  );
}

/**
 * 攻击范围最末端那一格（望"在攻击范围的最末端的格子放下棋子"）。
 *
 * 【为什么要有"没有目标就用最近的敌人"这个兜底？】
 * 因为放技能发生在**选目标之前**（actUnit 先看 `canCast` 再找目标）。
 * 正常对局里法力是一点一点攒的，轮到放技能时早就打过好几下了、必然有目标；
 * 但如果法力是靠"自动回复"或者被技能一次灌满的，`targetId` 就还可能是 -1 ——
 * 那样这个技能会**静默地什么都不做**（玩家只会看到"技能放了但没棋子"）。
 * 拿最近的敌人当方向就解决了，而且方向和"本来会锁谁"是一致的。
 */
/**
 * ★ 0.2（望·连星）：在某名敌人**旁边**找一个空格放陷阱。
 *
 *   · `besideHighestHpRatioEnemy` —— 先筛"攻击范围内"的敌人，再取**百分比**血量最高的
 *     （比较用交叉相乘，见 skills.ts 里 lowestHpRatioEnemy 的说明）；
 *   · `besideLowestHpEnemy`       —— 全场**绝对**血量最低的。
 *
 * 挑不到人、或那人周围 8 格都满了 ⇒ **退回 `rangeEdgeCell`**（数据表写明的兜底：
 * "若身旁无可选择敌人，则在攻击范围末端放下棋子"）。
 * 遍历顺序固定（先列后行、id 升序）⇒ 确定性。
 */
function trapBesideEnemyCell(
  state: BattleState,
  caster: UnitState,
  place: 'besideHighestHpRatioEnemy' | 'besideLowestHpEnemy',
): { col: number; row: number } | null {
  const style = moveStyleOf(caster);
  const reach = effectiveRange(state, caster);
  const pool = state.units.filter((unit) => {
    if (unit.dead || unit.team === caster.team) return false;
    if (place === 'besideLowestHpEnemy') return true;
    return cellDistance(caster.cell, unit.cell, style) <= reach;
  });
  if (pool.length === 0) return rangeEdgeCell(state, caster);

  const sorted = pool.slice().sort((a, b) => {
    if (place === 'besideHighestHpRatioEnemy') {
      // 百分比血量从高到低
      return b.hp * a.maxHp - a.hp * b.maxHp || a.id - b.id;
    }
    // 绝对血量从低到高
    return a.hp - b.hp || a.id - b.id;
  });
  const anchor = sorted[0]!;

  for (let dc = -1; dc <= 1; dc++) {
    for (let dr = -1; dr <= 1; dr++) {
      if (dc === 0 && dr === 0) continue;
      const col = anchor.cell.col + dc;
      const row = anchor.cell.row + dr;
      if (col < 0 || col >= BOARD_W || row < 0 || row >= BOARD_H) continue;
      if (state.cellToUnit[cellIndex(col, row)] === CELL_EMPTY) return { col, row };
    }
  }
  return rangeEdgeCell(state, caster);
}

function rangeEdgeCell(state: BattleState, caster: UnitState): { col: number; row: number } | null {
  const target = caster.targetId >= 0 ? getUnit(state, caster.targetId) : undefined;
  const toward = target && !target.dead ? target.cell : nearestEnemyCell(state, caster);
  if (!toward) return null;
  const dc = toward.col - caster.cell.col;
  const dr = toward.row - caster.cell.row;
  const sc = dc === 0 ? 0 : dc > 0 ? 1 : -1;
  const sr = dr === 0 ? 0 : dr > 0 ? 1 : -1;
  const range = effectiveRange(state, caster);
  for (let step = range; step >= 1; step--) {
    const col = caster.cell.col + sc * step;
    const row = caster.cell.row + sr * step;
    if (col < 0 || col >= BOARD_W || row < 0 || row >= BOARD_H) continue;
    if (state.cellToUnit[cellIndex(col, row)] === CELL_EMPTY) return { col, row };
  }
  return null;
}

function nearestEnemyCell(state: BattleState, caster: UnitState): { col: number; row: number } | null {
  let best: UnitState | null = null;
  let bestDistance = Number.MAX_SAFE_INTEGER;
  const style = moveStyleOf(caster);
  for (const other of state.units) {
    if (other.dead || other.team === caster.team) continue;
    const distance = cellDistance(caster.cell, other.cell, style);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = other;
    }
  }
  return best ? best.cell : null;
}

/**
 * 在 center 附近找一个空格。
 *
 * 【顺序为什么这么讲究？】
 * 因为"最近"必须有个确定说法，否则联机两边会选到不同格子。
 * 规则：一圈一圈往外找；同一圈里按"行升序、列升序"。
 *
 * 【落点的三层优先级】
 *   1. 落在**攻击距离内**的空格 —— 瞬移/召唤过去当回合就能生效。
 *      "瞬移**到**敌人面前 / 队友身旁"落在两步之外等于白瞬移。
 *   2. 同样在攻击距离内时，选**离发起者最近**的那一格：
 *      也就是落在"敌人朝我们这一面"，而不是越过敌人跑到它背后
 *      （柱子、金狮子这类召唤物绕到敌人背后就挡不住人了）。
 *   3. 攻击距离内一格都找不到，才退到"离目标最近的空格"。
 *
 * 【preferOwnHalf 是给谁用的？】
 * 救援类瞬移（耀骑士临光的护盾救援）会飞到**队友**旁边，那一类希望落在自己半场。
 * 而"瞬移到敌人面前"（临光 3 星、赤刃明霄陈 3 星）必须落在**敌人那边** ——
 * 早期版本所有瞬移都优先自己半场，结果 3 星技能等于把棋子往后拉：
 * 既打不到人，走回去的路上还会被贴脸敌人围住卡死（你报的第 8 条）。
 * 所以现在只有显式传 preferOwnHalf 的调用点（救援 / 自己身边召唤）才限制半场。
 */
export function findEmptyNear(
  state: BattleState,
  center: { col: number; row: number },
  style: MoveStyle,
  options: { preferOwnHalf?: 0 | 1; nearerTo?: { col: number; row: number } } = {},
): { col: number; row: number } | null {
  const half = BOARD_W / 2;
  const scoreTo = (cell: { col: number; row: number }): number =>
    options.nearerTo ? cellDistance(cell, options.nearerTo, style) : 0;

  const scan = (
    requireOwnHalf: boolean,
  ): { inRange: { col: number; row: number } | null; nearest: { col: number; row: number } | null } => {
    const ownHalf = (col: number): boolean =>
      !requireOwnHalf || options.preferOwnHalf === undefined
        ? true
        : options.preferOwnHalf === 0
          ? col < half
          : col >= half;

    let inRange: { col: number; row: number } | null = null;
    let inRangeScore = Number.MAX_SAFE_INTEGER;
    let nearest: { col: number; row: number } | null = null;
    let nearestDistance = Number.MAX_SAFE_INTEGER;
    let nearestScore = Number.MAX_SAFE_INTEGER;

    for (let radius = 0; radius <= 6; radius++) {
      for (let row = center.row - radius; row <= center.row + radius; row++) {
        for (let col = center.col - radius; col <= center.col + radius; col++) {
          // 只走这一圈的边框，里圈上一轮已经找过了
          if (radius > 0 && Math.abs(col - center.col) !== radius && Math.abs(row - center.row) !== radius) continue;
          if (!isInside(col, row)) continue;
          if (!ownHalf(col)) continue;
          if (state.cellToUnit[cellIndex(col, row)] !== CELL_EMPTY) continue;
          const distance = cellDistance({ col, row }, center, style);
          const score = scoreTo({ col, row });
          if (distance <= MELEE_RANGE) {
            if (score < inRangeScore) {
              inRangeScore = score;
              inRange = { col, row };
            }
            continue;
          }
          if (distance < nearestDistance || (distance === nearestDistance && score < nearestScore)) {
            nearestDistance = distance;
            nearestScore = score;
            nearest = { col, row };
          }
        }
      }
    }
    return { inRange, nearest };
  };

  const preferred = scan(options.preferOwnHalf !== undefined);
  if (preferred.inRange) return preferred.inRange;
  const anywhere = scan(false);
  return anywhere.inRange ?? preferred.nearest ?? anywhere.nearest;
}

/** 用战斗自己的随机数发生器挑一个空格 —— 保证联机两边抽到同一个 */
function randomEmptyCell(state: BattleState): { col: number; row: number } | null {
  const empty: number[] = [];
  for (let i = 0; i < state.cellToUnit.length; i++) {
    if (state.cellToUnit[i] === CELL_EMPTY) empty.push(i);
  }
  if (empty.length === 0) return null;
  const index = empty[state.rng.nextInt(empty.length)]!;
  return { col: index % BOARD_W, row: Math.floor(index / BOARD_W) };
}

/**
 * ★ 0.1.3：从**棋盘最外圈**随机挑一个空格。
 *
 * 【为什么不能直接用 randomEmptyCell？】
 * 血骑士的凝血之刃是「在随机场地边缘生成」—— 落在战场正中央就完全没有
 * "从外面慢慢走进来"的意思了。外圈 = 第一行 / 最后一行 / 第一列 / 最后一列。
 * 挑不到空格就返回 null（调用方跳过这一只，绝不硬塞）。
 */
function randomEdgeCell(state: BattleState): { col: number; row: number } | null {
  const empty: number[] = [];
  for (let col = 0; col < BOARD_W; col++) {
    for (const row of [0, BOARD_H - 1]) {
      const index = row * BOARD_W + col;
      if (state.cellToUnit[index] === CELL_EMPTY) empty.push(index);
    }
  }
  for (let row = 1; row < BOARD_H - 1; row++) {
    for (const col of [0, BOARD_W - 1]) {
      const index = row * BOARD_W + col;
      if (state.cellToUnit[index] === CELL_EMPTY) empty.push(index);
    }
  }
  if (empty.length === 0) return null;
  const index = empty[state.rng.nextInt(empty.length)]!;
  return { col: index % BOARD_W, row: Math.floor(index / BOARD_W) };
}

/** 把棋子挪到指定格子（瞬移用）。会同步格子占用表并记一条 move 事件 */
/**
 * **强制位移**：直接把棋子摆到另一格（瞬移 / 击退 / 开局站位），不走路。
 *
 * 【和"走路"的区别（★ 0.0.3）】
 * 走路走 `tryMoveToward`，一次只挪**一格**，是它自己的节奏；
 * 这个函数是"技能把人挪走"——一次可能跳好几格、也可能原地不动。
 * 日志里用 `instant: true` 标出来，客户端才不会把瞬移演成"走过去"
 * （用户明确要求：瞬移的表现不要改）。
 */
export function moveUnitTo(state: BattleState, unit: UnitState, cell: { col: number; row: number }): void {
  const from = { col: unit.cell.col, row: unit.cell.row };
  const oldIndex = cellIndex(from.col, from.row);
  if (state.cellToUnit[oldIndex] === unit.id) state.cellToUnit[oldIndex] = CELL_EMPTY;
  state.cellToUnit[cellIndex(cell.col, cell.row)] = unit.id;
  unit.cell = { col: cell.col, row: cell.row };
  state.log.push({ type: 'move', t: state.tick, unitId: unit.id, from, to: { ...unit.cell }, instant: true });
}

/**
 * 击退**方向**：从施法者指向目标、归一成正负 1（0 表示这一轴没有位移）。
 *
 * ★ 0.2：抽出来是因为"击退"和"击退路线"两件事都要用同一个方向 ——
 * 各写一份的话，改了一处另一处就会悄悄不对（这个仓库栽过好几次）。
 */
function knockbackAxis(caster: UnitState, target: UnitState): { sc: number; sr: number } {
  const dc = target.cell.col - caster.cell.col;
  const dr = target.cell.row - caster.cell.row;
  return { sc: dc === 0 ? 0 : dc > 0 ? 1 : -1, sr: dr === 0 ? 0 : dr > 0 ? 1 : -1 };
}

/**
 * 击退路线上第 1..`cells` 格**站着**的单位（不含目标自己那一格）。
 *
 * 见行者「若击退路线有其他目标则连同目标一同眩晕并额外造成伤害」用的就是它。
 * 顺着一格格数 ⇒ 顺序天然确定（确定性不受影响）。
 */
function knockbackRoute(
  state: BattleState,
  caster: UnitState,
  target: UnitState,
  cells: number,
): UnitState[] {
  const { sc, sr } = knockbackAxis(caster, target);
  const out: UnitState[] = [];
  for (let step = 1; step <= cells; step++) {
    const col = target.cell.col + sc * step;
    const row = target.cell.row + sr * step;
    if (col < 0 || col >= BOARD_W || row < 0 || row >= BOARD_H) break;
    const id = state.cellToUnit[cellIndex(col, row)];
    if (id === CELL_EMPTY) continue;
    const unit = getUnit(state, id);
    if (unit && !unit.dead) out.push(unit);
  }
  return out;
}

/** 击退：把目标沿着"远离施法者"的方向推 N 格 */
export function knockback(state: BattleState, caster: UnitState, target: UnitState, cells: number): void {
  const { sc, sr } = knockbackAxis(caster, target);
  for (let step = cells; step >= 1; step--) {
    const col = target.cell.col + sc * step;
    const row = target.cell.row + sr * step;
    if (col < 0 || col >= BOARD_W || row < 0 || row >= BOARD_H) continue;
    if (state.cellToUnit[cellIndex(col, row)] !== CELL_EMPTY) continue;
    moveUnitTo(state, target, { col, row });
    return;
  }
}

/** 复活已经阵亡的棋子（新约能天使 3 星） */
function doRevive(
  state: BattleState,
  caster: UnitState,
  effect: Extract<SkillEffect, { kind: 'revive' }>,
  defs: UnitDefTable,
): void {
  let revived = 0;
  // 按 id 升序复活（确定性）
  const dead = state.units
    .filter((unit) => unit.dead && unit.team === caster.team && !unit.isSummon && defs[unit.defId])
    .sort((a, b) => a.id - b.id);
  for (const unit of dead) {
    if (revived >= effect.count) break;
    const cell =
      findEmptyNear(state, unit.cell, moveStyleOf(caster), {
        preferOwnHalf: caster.team,
        nearerTo: caster.cell,
      }) ?? randomEmptyCell(state);
    if (!cell) break;
    // 复活的棋子星级按技能要求提升、回到满血
    unit.star = Math.min(3, Math.max(unit.star, effect.star ?? unit.star));
    unit.dead = false;
    unit.hp = unit.maxHp;
    state.cellToUnit[cellIndex(cell.col, cell.row)] = unit.id;
    unit.cell = { col: cell.col, row: cell.row };
    /*
      ★ 0.2：「并使其回复 100% 的技力」。
      直接写满而不是走 `gainMana()` —— 那个入口有"技能生效中不攒蓝"的闸门，
      而这里是**技能结算的一部分**，绕过它是必须的（和 `duringSkill` 同一个道理，
      但 `duringSkill` 也只是绕闸门、不绕 `MANA_MAX` 的上限夹取）。
    */
    if (effect.manaBp !== undefined) {
      const before = unit.mana;
      unit.mana = Math.min(MANA_MAX, Math.floor((MANA_MAX * effect.manaBp) / 10000));
      if (unit.mana !== before) {
        state.log.push({
          type: 'mana',
          t: state.tick,
          unitId: unit.id,
          amount: unit.mana - before,
          manaAfter: unit.mana,
        });
      }
    }
    revived++;
    state.log.push({
      type: 'spawn',
      t: state.tick,
      unitId: unit.id,
      team: unit.team,
      defId: unit.defId,
      star: unit.star,
      cell: { ...unit.cell },
      maxHp: unit.maxHp,
    });
  }
}

/**
 * ★★ 0.2 蕾缪安 3 星「强制追思」：放技能时**只登记计划**。
 *
 * 真正"锁谁"要等到每个锁定时刻现挑（见 `tickLockOn`）—— 因为敌人会走位，
 * 表里写的是"期间每秒锁定一名目标地块"，锁的是**那一刻**它站在哪。
 */
function doLockOn(state: BattleState, caster: UnitState, effect: Extract<SkillEffect, { kind: 'lockOn' }>): void {
  const runtime = caster.skill;
  if (!runtime) return;
  const interval = Math.max(1, effect.intervalTicks);
  runtime.lockOn = {
    locksLeft: Math.max(0, starValue(effect.count, caster.star)),
    // 第一个落点在 1 个间隔之后 —— "期间每秒锁定一名"，不是放技能那一瞬间就锁
    nextLockTick: state.tick + interval,
    intervalTicks: interval,
    lockedIds: [],
    cells: [],
    blastAtTick: state.tick + Math.max(1, effect.blastTicks),
    radius: Math.max(0, effect.radius),
    shape: effect.shape ?? 'square',
    power: starValue(effect.power, caster.star),
    damageType: effect.damageType,
    // ★ 0.2.2：样式 id 也存进计划 —— 引爆是 7 秒后的事，那时已经拿不到这条 effect 了
    ...(effect.fx ? { fx: effect.fx } : {}),
  };
}

/**
 * 挑下一个要锁的敌人。
 *
 * 表里的口径：**优先锁定百分比生命值最低的**；"每个目标只会锁定一次"；
 * **若目标数不足（没有没锁过的了），剩余弹药全部锁定百分比生命最高的敌人**。
 *
 * 【为什么不用浮点比较？】内核禁止浮点判定 —— 用交叉相乘比 `hp/maxHp` 的大小，
 * 全程整数。遍历顺序固定为 id 升序，同比例时取 id 小的（确定性）。
 */
function pickLockTarget(state: BattleState, caster: UnitState, plan: LockOnPlan): UnitState | null {
  const fresh: UnitState[] = [];
  for (const other of state.units) {
    if (other.dead || other.team === caster.team) continue;
    if (plan.lockedIds.includes(other.id)) continue;
    fresh.push(other);
  }
  if (fresh.length === 0) {
    // 备用：全场百分比生命最高的那个（可能已经锁过）
    let best: UnitState | null = null;
    for (const other of state.units) {
      if (other.dead || other.team === caster.team) continue;
      if (!best || other.hp * best.maxHp > best.hp * other.maxHp) best = other;
    }
    return best;
  }
  let lowest: UnitState | null = null;
  for (const other of fresh) {
    if (!lowest || other.hp * lowest.maxHp < lowest.hp * other.maxHp) lowest = other;
  }
  return lowest;
}

/**
 * ★★ 0.2：每 tick 推进"锁定—引爆"（由 `tickSkill` 调，所以主人死了就一起停）。
 *
 * 顺序固定为「先锁、后炸」：第 7 个落点锁完的那一 tick 正好是引爆 tick，
 * 反过来的话最后一颗弹药会被吞掉。
 */
function tickLockOn(state: BattleState, unit: UnitState): void {
  const runtime = unit.skill;
  const plan = runtime?.lockOn;
  if (!runtime || !plan) return;
  while (plan.locksLeft > 0 && state.tick >= plan.nextLockTick) {
    const picked = pickLockTarget(state, unit, plan);
    plan.locksLeft--;
    plan.nextLockTick += plan.intervalTicks;
    if (!picked) continue;
    plan.lockedIds.push(picked.id);
    const cell = { col: picked.cell.col, row: picked.cell.row };
    plan.cells.push(cell);
    /*
      ★★ 0.2.2：报一条**纯表现**的"锁定了这个地块"。
      渲染层据此在地上画狙击镜 + 向内收缩的粉色光环（见 `three/lockon-fx.ts`）。
      ★ 报的是**地块**不是人：人下一秒可能就走开了，而这一发打的就是这块地。
      ★ `ticksLeft` 让表现层知道"这圈瞄准镜该留多久"（= 到引爆还剩几秒），
        不用自己再去猜技能参数。
    */
    state.log.push({
      type: 'lockOnMark',
      t: state.tick,
      unitId: unit.id,
      cell,
      // 已经锁下的（含这一发）+ 还欠的（`locksLeft` 上面刚减过） = 总弹药数
      index: plan.cells.length - 1,
      total: plan.cells.length + plan.locksLeft,
      ticksLeft: Math.max(0, plan.blastAtTick - state.tick),
      ...(plan.fx ? { fx: plan.fx } : {}),
    });
  }
  if (state.tick >= plan.blastAtTick) {
    const cells = plan.cells;
    const { radius, shape } = plan;
    const fx = plan.fx;
    runtime.lockOn = undefined;
    for (const cell of cells) {
      /*
        ★★ 0.2.2：引爆的演出**不能靠 `zone`**。
        `damageArea` 只在"真的打到了人"时才 `emitZone` —— 落点空了就一条都不发，
        于是"炸了但没打到人"在画面上完全看不见。所以这里先报一条纯表现的爆炸事件。
        ★ 顺序：先报爆炸、再结算伤害 —— 表现层和掉血落在同一 tick，观感和数值一致。
      */
      state.log.push({
        type: 'lockOnBlast',
        t: state.tick,
        unitId: unit.id,
        cell,
        radius,
        shape,
        ...(fx ? { fx } : {}),
      });
      damageArea(state, unit, cell, plan.power, plan.damageType, radius, shape);
    }
  }
}

// ============================================================
// ★ 0.2：技能"挂到别人身上"的东西 —— 技能结束时一起收走
// ============================================================

/** 记下"这一份是技能给的"（新约能天使的友方减益 / 护盾） */
function markSkillAttachment(caster: UnitState, targetId: number): void {
  const runtime = caster.skill;
  if (!runtime) return;
  if (!runtime.skillAttachments) runtime.skillAttachments = { unitIds: [], armed: false };
  if (!runtime.skillAttachments.unitIds.includes(targetId)) runtime.skillAttachments.unitIds.push(targetId);
}

/**
 * ★★ 0.2 新约能天使：「**技能结束时，友方减益恢复，所给予的剩余护盾消失**」。
 *
 * 【为什么要"技能结束"这么一个钩子？】
 * 因为她的技能**没有秒数** —— 时长由 30 发弹药打完决定，
 * 放技能那一刻根本算不出"还剩几秒"。所以方向反过来：
 * 由施法者每 tick 看一眼自己身上还有没有技能包，没有了就**主动去收**
 * （友方身上 `fromSkill` 且 `sourceId` 是自己的 buff + `shieldBoundTo` 指向自己的护盾）。
 *
 * ★ 这个函数在 rules 的 tick 里**对所有单位（含已阵亡的）**都要调 ——
 * 施法者中途被打死时，友方那份减益同样必须还回去。
 */
export function tickSkillAttachments(state: BattleState, unit: UnitState): void {
  const runtime = unit.skill;
  const record = runtime?.skillAttachments;
  if (!runtime || !record) return;
  /*
    ★ 活着才判"技能是否还在生效"。
    施法者一旦阵亡，`unit.skill.buffs` 不会再被清理（死亡只标记 dead，
    不清运行时），所以必须**直接把"已死"当成"技能结束"** ——
    否则那包 fromSkill 会永远留在身上，队友的减益再也收不回来。
  */
  if (!unit.dead) {
    if (runtime.buffs.some((buff) => buff.fromSkill === true)) {
      // 技能还在生效中：先"上膛"，之后再判结束
      record.armed = true;
      return;
    }
    // 还没上过膛就等 —— 否则"只给别人上盾、自己没有技能包"的技能会立刻把刚给的盾收走
    if (!record.armed) return;
  }
  for (const id of record.unitIds) {
    const ally = getUnit(state, id);
    if (!ally) continue;
    if (ally.skill) {
      const before = ally.skill.buffs.length;
      ally.skill.buffs = ally.skill.buffs.filter(
        (buff) => !(buff.fromSkill === true && buff.sourceId === unit.id),
      );
      if (ally.skill.buffs.length !== before) ally.skill.version++;
    }
    // 只收"确实是自己给的那一层盾"（别人给的盾不受影响）
    if (ally.statuses['shieldBoundTo'] === unit.id + 1) clearShield(ally);
  }
  runtime.skillAttachments = undefined;
}

// ============================================================
// 法力回复来源
// ============================================================
/** 攻击命中时该不该回蓝 */
export function gainsManaFromAttack(unit: UnitState): boolean {
  return unit.manaSource === 'attack';
}

/** 受到伤害时该不该回蓝 */
export function gainsManaFromDamage(unit: UnitState): boolean {
  return unit.manaSource === 'damage';
}
