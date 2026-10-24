import { ARMOR_K, BP, CELL_EMPTY, FIX, MANA_FROM_DAMAGE_TAKEN, MANA_MAX, MAX_BATTLE_TICKS, MAX_REDUCTION_BP, TICKS_PER_SECOND, UNYIELDING_CHANCE_DECAY_BP, ZONE_FLASH_TICKS } from './constants.js';
import { covenantDeathRage, covenantDeathShieldRatioBp, covenantManaGainBp } from './covenant-data.js';
import { cellDistance, cellIndex, moveStyleOf, withinShape } from './field.js';
import { addBuff, collectMods, effectiveArmor, effectiveMagicResist, hasMechanic, refreshMaxHp, starValue } from './mods.js';
import type {
  BattleEvent,
  BattleState,
  Cell,
  DamageType,
  ScopedMechanic,
  ShieldGrant,
  SkillEffect,
  SkillStats,
  SplashShape,
  TraitMechanic,
  UnitDef,
  UnitState,
} from './types.js';

/**
 * 战斗数值结算：造成伤害、治疗、加盾。
 *
 * 所有函数都只接收整数、只返回整数，且不读写任何全局状态 ——
 * 这是「确定性」的前提。任何一处用了浮点数，联机就可能不同步。
 */

/** 把伤害/治疗事件推进日志 */
function push(state: BattleState, event: BattleEvent): void {
  state.log.push(event);
}

/**
 * ★ 0.0.3：把一个**限时增益包**记进战斗日志，只为让界面能实时显示数值变化。
 *
 * 【为什么需要它？】
 * 详情页的"战斗中实时数值"是**跟事件流走的**：
 * `replay.liveStatsOf()` = 开战那一刻的基线 + 所有还没到期的 `buff` 事件。
 * 而以前只有三处会发 buff 事件（罗德岛光环、剑士叠攻速、残血爆发）——
 * 技能/藏品挂的增益包根本没上报过，于是"开了技能面板一动不动"
 * （用户报的"骑士戒律装了之后面板没变"）。功能是实现了的，只是没显示。
 *
 * 【只在"战斗中"挂包的地方调用，别在开局效果里调】
 * 基线是从**开战状态**算的，开局效果（藏品的开局魔抗、砾的入场护盾…）
 * 早就在基线里了；再发一条事件就是**算两遍**。
 *
 * 【只上报攻速 / 攻击两种】
 * 因为面板上会跳 ▲▼ 的就是这两项（护甲/魔抗的临时增益目前只影响结算，
 * 面板不显示 —— 要加的话事件类型和界面都要跟着扩）。
 *
 * @param durationTicks 这次增益还剩多久（和挂上去的包保持一致，界面按它到期）
 */
export function emitBuffEvents(
  state: BattleState,
  sourceId: number,
  target: UnitState,
  stats: SkillStats,
  durationTicks: number,
  star = 1,
  /** ★ 0.1.1：这件增益是哪件藏品给的（藏品才有；界面靠它认"随机强化抽到了谁"） */
  itemId?: string,
): void {
  if (durationTicks <= 0) return;
  const damageBp = starValue(stats.attackDamageBp, star);
  const speedBp = starValue(stats.attackSpeedBp, star);
  if (damageBp !== 0) {
    state.log.push({
      type: 'buff',
      t: state.tick,
      sourceId,
      targetId: target.id,
      stat: 'attackDamage',
      bonusBp: damageBp,
      durationTicks,
      ...(itemId ? { itemId } : {}),
    });
  }
  if (speedBp !== 0) {
    state.log.push({
      type: 'buff',
      t: state.tick,
      sourceId,
      targetId: target.id,
      stat: 'attackSpeed',
      bonusBp: speedBp,
      durationTicks,
      ...(itemId ? { itemId } : {}),
    });
  }
}

/**
 * 按护甲/魔抗计算减免率。
 *
 * 公式：减免率 = armor / (armor + ARMOR_K)
 * 这是《魔兽争霸3》以来的经典公式，好处是「永远不会减到 0」，
 * 护甲越高收益越低，不会出现无敌。
 *
 * @param resistance 护甲或魔抗，单位 FIX（30 点护甲 = 30000）
 * @returns 减免率，单位 bp（0..MAX_REDUCTION_BP）
 */
export function reductionBp(resistance: number): number {
  if (resistance <= 0) return 0;
  const r = Math.floor((resistance * BP) / (resistance + ARMOR_K));
  return Math.min(r, MAX_REDUCTION_BP);
}

/** 施加减免：返回减免后的伤害（FIX） */
export function applyReduction(amount: number, resistance: number): number {
  const keepBp = BP - reductionBp(resistance);
  return Math.floor((amount * keepBp) / BP);
}

/**
 * ★★ 0.2 MujicaAve：这个单位身上那条「攒 fever」的机制（没有就是 null）。
 *
 * 【为什么单独抽出来？】"受到攻击"和"造成伤害"两处都要问同一个问题，
 * 而两处分别在 `rules.ts` 与这里 —— 各写一份 `for (…mechanics) if (kind === 'fever')`
 * 迟早会有一处改了、另一处没改（本项目的头号 bug 类型）。
 */
export function feverMechanicOf(
  unit: UnitState | null | undefined,
): Extract<TraitMechanic, { kind: 'fever' }> | null {
  if (!unit) return null;
  for (const mechanic of unit.trait?.mechanics ?? []) {
    if (mechanic.kind === 'fever') return mechanic;
  }
  return null;
}

/**
 * ★★ 0.2 MujicaAve：给这个单位所在的队伍加 fever。
 *
 * @param side `'onHit'` = 它**受到一次攻击**；`'onDeal'` = 它**造成一次伤害**。
 *   两个数分开是因为三档只算受击、五/七档才算造伤（见 trait-data 的说明）。
 *
 * ★ 只加在**真正发生的那一刻**（`performAttack` / `dealDamage` 里），
 * 不去事后数事件日志 —— 日志里没有"这一队有没有这条羁绊"，事后数等于把判定再写一遍。
 */
export function addFeverFor(
  state: BattleState,
  unit: UnitState | null | undefined,
  side: 'onHit' | 'onDeal',
): void {
  const mechanic = feverMechanicOf(unit);
  if (!mechanic) return;
  const amount = side === 'onHit' ? mechanic.onHit : mechanic.onDeal;
  if (amount > 0) state.feverGained[unit!.team] += amount;
}

/**
 * 造成伤害。会处理护盾吸收、死亡判定、法力回复、事件记录。
 *
 * @returns 实际打进血量的伤害（FIX）。用于吸血、统计等
 */
export function dealDamage(
  state: BattleState,
  source: UnitState | null,
  target: UnitState,
  rawAmount: number,
  damageType: DamageType,
  attackType: 'attack' | 'spell' = 'spell',
  sourceIdOverride?: number,
): number {
  if (target.dead || rawAmount <= 0) return 0;
  /*
    ★ 0.0.3：处于"倒地等复活"的 Boss 不接受任何伤害。
    它只是躺下了、还没站起来，不是可以被继续鞭尸的目标。
  */
  if (target.downedUntilTick !== undefined) return 0;

  const sourceId = source ? source.id : (sourceIdOverride ?? -1);
  if (sourceId === -1 && source === null && sourceIdOverride === undefined) {
    // 伤害必须能追溯到来源，否则录像回放和伤害统计都会错位。
    // 这种问题不该被静默吞掉 —— 直接报错，逼着调用方修。
    throw new Error(`伤害事件缺少来源：目标 ${target.id}，伤害类型 ${damageType}`);
  }

  /*
    ---- 第 0 步：闪避 / 免疫 ----
    【为什么放在最前面？】
    因为"闪避"必须是**完全没打到**：不该扣护盾、不该回蓝、不该触发反弹、
    也不该算进伤害统计。放在减免之后处理的话，护盾会被白白磨掉。
  */
  const targetMods = collectMods(state, target);
  if (targetMods.immuneHits > 0 && target.skill) {
    target.skill.immuneHits--;
    // 「免疫 N 次攻击」按次数消耗，所以要把当前生效的那份包也扣掉一次
    consumeImmuneCharge(target);
    push(state, { type: 'dodge', t: state.tick, sourceId, targetId: target.id, reason: 'immune' });
    return 0;
  }
  /*
    ★ 0.1.1 藏品二版：闪避分成"通用 / 只对物理 / 只对法术"三份。
      舞者手链（10% 双闪）= evasionBp；设计师量尺（15% 物理闪避）= evasionPhysicalBp；
      「法术杀手」（15% 法术闪避）= evasionMagicBp。
      一次物理攻击要躲过 通用 + 物理 两份之和，法术攻击躲过 通用 + 法术。
      （和已有行为完全兼容：没有新藏品时物理/法术闪避都是 0，加起来就是原来的 evasionBp。）
  */
  const evadeBp =
    targetMods.evasionBp +
    (damageType === 'physical' ? targetMods.evasionPhysicalBp : damageType === 'magic' ? targetMods.evasionMagicBp : 0);
  if (evadeBp > 0 && state.rng.nextInt(10000) < evadeBp) {
    push(state, { type: 'dodge', t: state.tick, sourceId, targetId: target.id, reason: 'evade' });
    return 0;
  }
  /*
    ★ 0.0.3：无敌（“复仇者”二阶段复活后的 8 秒）。
    和"免疫 N 次"的区别：无敌是**按时间**的，而且不消耗次数、不会被磨掉。
  */
  if (targetMods.invulnerable) {
    push(state, { type: 'dodge', t: state.tick, sourceId, targetId: target.id, reason: 'immune' });
    return 0;
  }
  /*
    ★★ 0.3.1 盟约「药枚实验」（桑葚）：**次数护盾** —— 完整挡下一次任意类型的伤害。

    【为什么放在这一层（闪避 / 免疫 / 无敌之后，护盾和抗性之前）？】
      · 它和"免疫一次"是同一语义：这一下**完全没造成伤害**，
        不该扣血、不该回蓝、不该触发反弹；
      · 用户写的是"抵挡一次**任意**伤害" ⇒ 真实伤害也挡，
        所以必须在下面的 `damageType === 'true'` 分支**之前**处理。

    【层数记在哪？】`statuses['shieldCharges']`（整数）。每挡一次 -1，
    归零即消失。用 statuses 而不是 buff：它没有"属性"，只有次数。
  */
  const shieldCharges = target.statuses['shieldCharges'] ?? 0;
  if (shieldCharges > 0) {
    target.statuses['shieldCharges'] = shieldCharges - 1;
    push(state, { type: 'dodge', t: state.tick, sourceId, targetId: target.id, reason: 'immune' });
    return 0;
  }

  /*
    ★ 0.1.1 藏品二版：按**距离**增伤（Blaze 的电锯 / Scout 的狙击镜）。
      · 电锯   「距离伤害来源越近受到的伤害越高（4 格 - 1 格依次增加 20%，最高 80%）」
      · 狙击镜 「距离伤害来源越远受到的伤害越高（1 格 - 4 格依次增加 20%，最高 80%）」
    所以 4 格以内每近/远 1 格多 20%，1 格（近）或 4 格（远）封顶 80%。

    【为什么放在这里（闪避之后、护盾之前）？】
    因为它改的是"这一击打出的原始伤害"，而原始伤害要**先被护盾吃**、
    再走抗性减免 —— 放在护盾之后会让"越近打护盾越疼"这条反而不成立。
    放在闪避之前又是错的：闪避的语义是"完全没打到"，被闪避掉的攻击
    不该有增伤这回事。

    【为什么真伤不吃？】真伤的定义就是"不吃任何修正"，这条也一并遵守。
    自己打自己（距离 0）也不加成，避免自伤类效果出现莫名其妙的浮动。
  */
  if (damageType !== 'true' && source && !source.dead && source.id !== target.id) {
    for (const mechanic of source.trait?.mechanics ?? []) {
      if (mechanic.kind !== 'distanceBonus') continue;
      const cells = Math.max(1, cellDistance(source.cell, target.cell, moveStyleOf(target)));
      const steps = mechanic.mode === 'near' ? Math.min(4, Math.max(0, 5 - cells)) : Math.min(4, cells);
      const hitBp = Math.min(mechanic.maxBp, steps * mechanic.perCellBp);
      if (hitBp > 0) rawAmount = Math.floor((rawAmount * (BP + hitBp)) / BP);
      break;
    }
  }

  /*
    ---- 第 1 步：护盾吸收（**不享受抗性减免**）----
    ============================================================
    ★ 这一块的顺序是你要的（改过一次，说明一下为什么）
    ============================================================
    【以前是"先减免、再让护盾吃"】
      原始 100 伤害 → 护甲减免 50% → 50 → 护盾吃 50
    这等于"护甲把护盾也一起加强了"：同样 100 点护盾，
    在 90% 减免的坦克身上能挡住 1000 点原始伤害。
    结果就是"越肉的越肉"，护盾在坦克身上强得离谱。

    【现在是"护盾先按原始伤害 1:1 吃，剩下的才走减免"】
      原始 100 伤害 → 护盾吃 100 → 没吃完的部分 → 护甲减免 → 扣血
    护盾变成一个**独立的血量池**：100 点护盾就只挡 100 点原始伤害，
    和你多肉无关。这样"护盾"和"抗性"是两个独立的维度，不会互相放大。

    【真实伤害：连护盾都挡不住】
    真实伤害的定义就是"不吃任何减免"，那它自然也不该被护盾吃掉 ——
    不然"真实"两个字就名不副实了（一个护盾照样能扛住）。
    */
  const shield = target.statuses['shield'] ?? 0;
  const shieldValue = target.statuses['shieldValue'] ?? 0;
  let absorbed = 0;
  let amount: number;

  if (damageType === 'true') {
    // 真实伤害：既不减免、也不进护盾，直接打血
    amount = rawAmount;
  } else {
    // 抗性只对"漏过护盾的那一截"生效
    let resistance =
      damageType === 'physical'
        ? effectiveArmor(target, targetMods)
        : damageType === 'magic'
          ? effectiveMagicResist(target, targetMods)
          : 0;
    /*
      ★ 0.0.3：护甲穿透（双持剑士「攻击无视对方 10% 物抗」）。
      只影响**这一次**攻击的减免计算，不改目标面板 —— 所以在这里对 resistance 打折。
      先查 hasMechanic 再算修正包，绝大多数单位没有这条机制，省掉一次合并。
    */
    if (resistance > 0 && source && !source.dead && hasMechanic(source, 'armorPen')) {
      const penBp = collectMods(state, source).armorPenBp;
      if (penBp > 0) resistance = Math.floor((resistance * Math.max(0, BP - Math.min(BP, penBp))) / BP);
    }
    if (shield > 0 && shieldValue > 0) {
      absorbed = Math.min(shieldValue, rawAmount);
      target.statuses['shieldValue'] = shieldValue - absorbed;
      // ★ 0.2：打空就走「破盾」那一处（机械师要消耗子弹补一层 + 炸一下）
      if (target.statuses['shieldValue'] <= 0) breakShield(state, target);
    }
    amount = applyReduction(rawAmount - absorbed, resistance);
  }

  /*
    ---- 第 2.5 步：藏品给的"额外百分比减伤"（0.0.3）----
    · 奇缘面具：全队受到的所有伤害 -10%（挂在队伍上）
    · 防爆盾  ：被距离自己 2 格以上的敌人**普攻**时再 -30%（挂在棋子自己身上）

    【为什么放在抗性减免之后、扣血之前？】
    因为它是"减伤"这一类，语义上和护甲完全相同（都是把伤害打折），
    放在一起玩家看到的数字才连得上：原始 -> 护盾 -> 抗性 -> 藏品 -> 扣血。

    【为什么真实伤害不吃它？】
    因为"真实伤害不吃任何减免"是这个内核已经写死的一条规则
    （护盾都挡不住它）。藏品减伤如果破例，就会出现"标的真实伤害
    被一件装备吃掉三成"这种自相矛盾的情况。所以上面 true 分支直接跳过这里。
  */
  if (damageType !== 'true') {
    // ★ 0.0.3：damageTakenBp 是"受到伤害提升"，方向和减伤相反，直接相加即可
    let keepBp = BP - targetMods.damageReductionBp + targetMods.damageTakenBp;
    const far = targetMods.farAttackReduction;
    // 「被远程打」只认**普通攻击** —— 技能本来就该打得动肉盾，不该被防爆盾护住
    if (far && source && attackType === 'attack') {
      if (cellDistance(source.cell, target.cell, moveStyleOf(target)) > far.minDistance) {
        keepBp -= far.ratioBp;
      }
    }
    /*
      ★ 0.0.3：按距离减伤（博卓卡斯替一阶段「每远 1 格 -15%，5 格封顶 -60%」）。
      距离 1 格 = 面对面，不减；以后每多 1 格多减 perCellBp，封顶 maxBp。
      和防爆盾一样只认普攻，真伤在上面那一支已经跳过。
    */
    const dist = targetMods.distanceReduction;
    if (dist && source && attackType === 'attack') {
      const cells = Math.max(0, cellDistance(source.cell, target.cell, moveStyleOf(target)) - 1);
      keepBp -= Math.min(dist.maxBp, cells * dist.perCellBp);
    }
    if (keepBp !== BP) amount = Math.floor((amount * Math.max(0, keepBp)) / BP);
  }

  // 第 3 步：扣血
  const hpBefore = target.hp;
  target.hp = Math.max(0, hpBefore - amount);
  // 「技能持续时间内不会死亡」（魔王 3 星）：剩 1 点血吊住
  if (target.hp === 0 && targetMods.cannotDie) target.hp = 1;
  const actual = hpBefore - target.hp;
  const lethal = target.hp === 0;

  push(state, {
    type: 'damage',
    t: state.tick,
    sourceId,
    targetId: target.id,
    amount: actual,
    damageType,
    attackType,
    absorbed,
    hpAfter: target.hp,
    lethal,
  });

  // 统计：只记攻击者的输出
  if (source) source.damageDealt += actual;

  /*
    ★★ 0.2 MujicaAve：「每次**造成伤害**时 fever +1」（5/7 档）。
    口径：**每一次伤害结算算 1 点**（连击 3 段 = 3 点、溅射打到 3 个人 = 3 点、
    持续伤害每跳也算一跳）—— 用户说的是"造成伤害时"，而不是"攻击时"。
    只记真的打进了血量（`actual > 0`）：被闪避/免疫/打在护盾上都不算"造成了伤害"。
  */
  if (source && actual > 0) addFeverFor(state, source, 'onDeal');

  // 第 4 步：吸血（左乐"获得 30% 吸血"）—— 只有带吸血的棋子才需要这次额外计算
  const sourceMods = source ? collectMods(state, source) : null;
  if (source && sourceMods && sourceMods.lifestealBp > 0 && actual > 0) {
    const healed = healUnit(state, source, source, Math.floor((actual * sourceMods.lifestealBp) / BP));
    /*
      ★ 0.2：累计吸血量。萨卡兹"阵亡时造成相当于 100% 吸血量的范围法术伤害"要用它。
      放在 statuses 里而不是 UnitState 上新开一个字段：statuses 本来就是
      "每个单位一个的杂项数字表"，加一条不动结构、也不影响快照/校验和。
    */
    source.statuses['vampTotal'] = (source.statuses['vampTotal'] ?? 0) + healed;
  }

  // 第 5 步：反弹伤害（星熊"反弹受到伤害的 10%，上限为自身攻击力的 200%"）
  // 只反弹**普通攻击**：把反弹伤害再被反弹一次会让两边无限互弹。
  if (targetMods.reflect && source && !source.dead && actual > 0 && attackType === 'attack') {
    let back = Math.floor((actual * targetMods.reflect.ratioBp) / BP);
    if (targetMods.reflect.capAttackBp > 0) {
      const cap = Math.floor((target.attackDamage * targetMods.reflect.capAttackBp) / BP);
      back = Math.min(back, cap);
    }
    if (back > 0) dealDamage(state, target, source, back, 'true', 'spell');
  }

  // 第 6 步：回复法力
  // 【法力的来源是**按棋子定的**】——你给的三种：攻击回复 / 受击回复 / 自动回复。
  // 所以这里要分别判断攻守双方各自的类型，而不是一律都给。
  if (source && attackType === 'attack' && source.manaSource === 'attack') {
    gainMana(state, source, source.statuses['manaPerAttack'] ?? 100);
  }
  if (target.manaSource === 'damage') {
    gainManaFromDamageTaken(state, target, actual);
  }

  // 第 7 步：死亡
  if (lethal) killUnit(state, target);

  return actual;
}

/** 把「免疫 N 次攻击」的计数器扣掉一次（同时扣运行时和当前增益包） */
function consumeImmuneCharge(target: UnitState): void {
  const runtime = target.skill;
  if (!runtime) return;
  for (let i = runtime.buffs.length - 1; i >= 0; i--) {
    const buff = runtime.buffs[i]!;
    const value = buff.stats.immuneHits;
    if (value === undefined) continue;
    const current = starValue(value, target.star);
    if (current <= 0) continue;
    // 把这一份包换成"少一次"的版本。用剩余量反推出新的星级数值写法很别扭，
    // 所以直接写成一个单元素数组 —— starValue 对单元素数组返回它本身。
    buff.stats = { ...buff.stats, immuneHits: Math.max(0, current - 1) };
    if (current - 1 <= 0) runtime.buffs.splice(i, 1);
    break;
  }
  runtime.immuneHits = Math.max(0, runtime.immuneHits - 1);
}

/**
 * 治疗。不会超过血量上限。
 *
 * 【治疗效果加成（支援羁绊）在这里生效】
 * 支援写的是「提升我方全部干员生命值和**治疗效果**」——
 * 所以治疗量要在**这一层**放大，而不是去改每个治疗技能的数据。
 * 好处是：以后新加的任何治疗技能、装备、羁绊治疗，都会自动享受到加成，
 * 不需要逐个去改。
 */
export function healUnit(state: BattleState, source: UnitState | null, target: UnitState, amount: number): number {
  if (target.dead || amount <= 0) return 0;
  /*
    ★★ 0.3.31：治疗量吃**两个**倍率，缺一不可。
      · `healingOutBp`  —— 施法者身上的「治疗量提升」（本人型羁绊，如「治疗」）
      · `healingBonusBp` —— 被治疗者身上的「受到治疗提升」（全队型羁绊，如「支援」）
    以前只读 `target` 那一份，于是「治疗」羁绊凑齐了也一点用没有
    （它挂在**医疗干员**身上，而医疗干员是被治疗的那一方才算数 ⇒ 永远不生效）。
  */
  const outBp = source ? (source.statuses['healingOutBp'] ?? 0) : 0;
  const inBp = target.statuses['healingBonusBp'] ?? 0;
  let finalAmount = amount;
  if (outBp > 0) finalAmount = Math.floor((finalAmount * (BP + outBp)) / BP);
  if (inBp > 0) finalAmount = Math.floor((finalAmount * (BP + inBp)) / BP);
  const before = target.hp;
  target.hp = Math.min(target.maxHp, before + finalAmount);
  const healed = target.hp - before;
  if (healed > 0) {
    push(state, {
      type: 'heal',
      t: state.tick,
      sourceId: source ? source.id : -1,
      targetId: target.id,
      amount: healed,
      hpAfter: target.hp,
    });
  }
  return healed;
}

/** 加护盾。护盾是「临时血量」，先于血量被扣 */
export function applyShield(state: BattleState, source: UnitState | null, target: UnitState, amount: number, durationTicks: number): void {
  if (target.dead || amount <= 0) return;
  target.statuses['shield'] = durationTicks;
  target.statuses['shieldValue'] = (target.statuses['shieldValue'] ?? 0) + amount;
  push(state, {
    type: 'shield',
    t: state.tick,
    sourceId: source ? source.id : -1,
    targetId: target.id,
    amount,
    durationTicks,
  });
}

// ============================================================
//  ★★ 0.2 护盾扩展：按已损失生命 / 自己衰减 / 破盾子弹 / 护盾期间不回技力
// ============================================================

/**
 * 按 `basis` 把「千分比」换算成实际护盾点数。
 *
 * 【为什么单独抽一个函数？】
 * 原来这段算式在 `skills.ts`（放技能）和 `rules.ts`（开局效果）里**各写了一遍**，
 * 0.2 要给左乐加「按已损失生命」，等于要同时改两处 —— 那正是最容易改漏的形状。
 * 现在只有这一处，两个调用方都走它。
 */
export function shieldAmountOf(unit: UnitState, grant: ShieldGrant): number {
  if (grant.basis === 'flat') return grant.power * FIX;
  const base = grant.basis === 'missingHp' ? Math.max(0, unit.maxHp - unit.hp) : unit.maxHp;
  return Math.floor((base * grant.power) / FIX);
}

/** 把数据表里的一条 `shield` 效果解析成「配方」（数值按**施法者**星级定死）。 */
export function shieldGrantOf(effect: Extract<SkillEffect, { kind: 'shield' }>, star: number): ShieldGrant {
  const blast = effect.breakBlast;
  return {
    basis: effect.basis ?? 'maxHp',
    power: starValue(effect.power, star),
    durationTicks: effect.durationTicks,
    decayBpPerSecond: effect.decayBpPerSecond === undefined ? 0 : starValue(effect.decayBpPerSecond, star),
    noMana: effect.noManaWhileActive === true,
    blast: blast
      ? {
          radius: blast.radius,
          shape: blast.shape ?? 'square',
          power: starValue(blast.power, star),
          basis: blast.basis ?? 'attack',
          damageType: blast.damageType,
        }
      : null,
  };
}

/**
 * 按配方上一层盾。
 *
 * ★ 「补盾」也走这里 —— 机械师破盾之后补的那层，比例和第一次完全一样，
 * 只有走同一个入口才能保证两边不会飘。
 */
export function applyShieldGrant(
  state: BattleState,
  source: UnitState | null,
  target: UnitState,
  grant: ShieldGrant,
  /**
   * ★ 0.2 新约能天使：这层盾是**技能挂上去的**，记下施法者 id，
   * 技能结束时只收掉"确实由他给的"那一层（别人的盾不受影响）。
   */
  opts?: { boundTo?: number },
): void {
  /*
    ★ 量按**施法者**算（左乐的"已损失生命"是左乐自己的）。
    表里的护盾基准一律写"自身"，所以 `source` 为空（羁绊/藏品那种没有施法者的）
    才退回目标自己 —— 和改动前 `caster.maxHp` 的口径完全一致。
  */
  const amount = shieldAmountOf(source ?? target, grant);
  if (amount <= 0) return;
  applyShield(state, source, target, amount, grant.durationTicks);
  /*
    ★ 衰减的三件套：
      · `shieldDecay`       —— 每秒掉「获得总量」的万分比（0 = 不衰减）
      · `shieldDecayAmount` —— 这一层盾**刚生成时**的总量（衰减是相对它算的）
      · `shieldDecayTick`   —— 已经过了几个 tick
    【为什么不直接存"每 tick 掉多少"？】
    因为那要整除一次：1850 血 × 10% = 185 点，15%/s ⇒ 每 tick 1.3875，
    取整成 1 就等于"15%/s 变成 10.8%/s"，实际要 9.2 秒才掉完（表里是 6.7 秒）。
    改成按**累计**算：第 e 个 tick 总共该掉 `floor(A×bp×e / (10000×20))`，
    这一 tick 掉的就是它与 e-1 那一项的差 —— 全程无累计误差，且全是整数运算。
  */
  if (grant.decayBpPerSecond > 0) {
    target.statuses['shieldDecay'] = grant.decayBpPerSecond;
    target.statuses['shieldDecayAmount'] = amount;
    target.statuses['shieldDecayTick'] = 0;
  } else {
    delete target.statuses['shieldDecay'];
    delete target.statuses['shieldDecayAmount'];
    delete target.statuses['shieldDecayTick'];
  }
  if (grant.noMana) target.statuses['shieldNoMana'] = 1;
  else delete target.statuses['shieldNoMana'];
  if (opts?.boundTo !== undefined) target.statuses['shieldBoundTo'] = opts.boundTo + 1;
}

/**
 * 卸掉护盾（以及它附带的所有状态）。
 *
 * ★★ 只在**这一处**删 `shield` 系列状态 —— 以前"被打空"和"到期"分在两个文件里
 * 各删一次（`combat-math` 打空、`movement` 到期），0.2 加了衰减与破盾子弹之后
 * 就变成三条路都要记得清 `shieldNoMana` / `shieldDecay`，迟早漏。
 */
export function clearShield(target: UnitState): void {
  delete target.statuses['shield'];
  delete target.statuses['shieldValue'];
  delete target.statuses['shieldDecay'];
  delete target.statuses['shieldDecayAmount'];
  delete target.statuses['shieldDecayTick'];
  delete target.statuses['shieldNoMana'];
  delete target.statuses['shieldBoundTo'];
}

/**
 * ★★ 0.2 机械师：护盾「破了」的那一下。
 *
 * 【什么时候算破？】`shieldValue` 归零（被打空、或被自己的衰减磨完）就算。
 *
 * 【做了什么】还没用完子弹的话：
 *   ① 消耗一颗；
 *   ② 立刻按**同一份配方**再补一层盾；
 *   ③ 对自身周围炸一次（表里的"消耗子弹时对自身周围四格敌人造成法术伤害"）。
 *
 * 【为什么先卸盾再补盾？】补盾是 `applyShieldGrant` → `applyShield`，
 * 它是**累加** `shieldValue` 的；不先清掉，残值会算进新盾里。
 */
export function breakShield(state: BattleState, unit: UnitState): void {
  const hadAny = (unit.statuses['shieldValue'] ?? 0) > 0 || (unit.statuses['shield'] ?? 0) > 0;
  clearShield(unit);
  if (!hadAny || unit.dead) return;
  const bullets = unit.skill?.shieldBullets;
  if (!bullets || bullets.left <= 0) return;
  bullets.left -= 1;
  applyShieldGrant(state, unit, unit, bullets.grant);
  const blast = bullets.grant.blast;
  if (blast) {
    // 圈里只有**敌人** —— `damageArea` 会跳过同队的，自己不会被自己炸到
    damageArea(state, unit, unit.cell, blast.power, blast.damageType, blast.radius, blast.shape, undefined, {
      basis: blast.basis,
    });
  }
}

/**
 * 每 tick 结算一次护盾：先按配方衰减，再判断"破没破 / 到没到期"。
 *
 * 【为什么从 `movement.ts` 的 `tickStatuses` 搬出来？】
 * `tickStatuses` 只会"每 tick 减 1"，做不了衰减，也不该知道"破盾要补一层"。
 * 护盾现在有四种状态（时长 / 剩余量 / 衰减速度 / 不许回蓝），
 * 放在一个专门的函数里才看得清，也只需要 rules 里多调一次。
 */
export function tickShield(state: BattleState, unit: UnitState): void {
  const ticks = unit.statuses['shield'] ?? 0;
  const value = unit.statuses['shieldValue'] ?? 0;
  if (ticks <= 0 && value <= 0) return;
  let next = value;
  const decayBp = unit.statuses['shieldDecay'] ?? 0;
  if (next > 0 && decayBp > 0) {
    const amount = unit.statuses['shieldDecayAmount'] ?? 0;
    const elapsed = (unit.statuses['shieldDecayTick'] ?? 0) + 1;
    unit.statuses['shieldDecayTick'] = elapsed;
    const span = BP * TICKS_PER_SECOND;
    // 这一 tick 应掉的量 = 累计应掉 − 上一 tick 累计应掉（见 applyShieldGrant 的说明）
    const before = Math.floor((amount * decayBp * (elapsed - 1)) / span);
    const now = Math.floor((amount * decayBp * elapsed) / span);
    next = Math.max(0, next - (now - before));
  }
  const nextTicks = ticks > 0 ? ticks - 1 : 0;
  if (next <= 0 || nextTicks <= 0) {
    breakShield(state, unit);
    return;
  }
  unit.statuses['shieldValue'] = next;
  unit.statuses['shield'] = nextTicks;
}

/**
 * 破盾爆炸用到的范围伤害 —— 实现只有下面 `damageArea` 一份。
 *
 * ★ 0.2：中心从「一个单位」改成「一个**地块**」——
 * 蕾缪安 3 星打的是 7 秒前记下来的落点，那个人可能已经走开甚至死了，
 * 没有一个"中心单位"可以传；顺带也让调用方少写一层 `center.cell`。
 */
export function damageArea(
  state: BattleState,
  caster: UnitState,
  center: Cell,
  power: number,
  damageType: 'physical' | 'magic' | 'true',
  radius: number,
  shape: SplashShape,
  /** ★ 0.2：圈里要**排除**的那个单位（妮芙的附伤不该再打主目标一遍） */
  exclude?: UnitState,
  /** ★ 0.2：倍率按什么算。默认攻击力；机械师的破盾爆炸按生命上限 */
  opts?: {
    basis?: 'attack' | 'maxHp';
    /**
     * ★ 0.3.2 表现层：这一圈范围该配哪套**专属特效**（渲染层注册表键）。
     * 来自 `SkillEffect.damage.fx`。纯表现层，不进校验和。
     */
    fx?: string;
  },
): void {
  const base = opts?.basis === 'maxHp' ? caster.maxHp : caster.attackDamage;
  const amount = Math.floor((base * power) / FIX);
  if (amount <= 0) return;
  const style = moveStyleOf(caster);
  let hitAny = false;
  for (const other of state.units) {
    if (other.dead || other.team === caster.team) continue;
    if (exclude && other.id === exclude.id) continue;
    if (!withinShape(caster.cell, center, other.cell, radius, shape, style)) continue;
    hitAny = true;
    dealDamage(state, caster, other, amount, damageType, 'spell');
  }
  // 白框的位置和半径必须和上面真正生效的范围一模一样（不然就是"画得大、打得小"）
  if (hitAny) emitZone(state, caster, center, radius, shape, 'damage', ZONE_FLASH_TICKS, opts?.fx);
}

/** 施加控制效果（目前只有眩晕）。
 *
 * ★ 这里曾经多写了一行 `target.nextActionTick += durationTicks`，
 * 造成「被连续眩晕的棋子**永远醒不过来**」，现象非常隐蔽：
 *
 *   · 眩晕时长其实记在 `statuses['stun']` 里，每 tick 减 1；
 *     rules.ts 里轮到它行动时如果还晕着，会把行动时间推到"眩晕结束那一刻"。
 *   · 再额外 `+= durationTicks` 就等于**同一段眩晕算了两遍**。
 *   · 更要命的是它是**累加**的：每挨一次眩晕，行动时间就往后多推一截。
 *     只要对方眩晕来得比"推后的时间"更频繁，这个棋子的 nextActionTick
 *     就会一路涨到天上去 —— 它再也不会行动，而且**不会报任何错**。
 *
 * 我是怎么发现的：3 星蕾缪安单挑一队时胜率 0%，逐 tick 打印才看到
 * 它的 `nextActionTick` 从 109 → 129 → 149 一路涨，法力早就满了却一次技能没放。
 * 修掉之后同一个对局的胜率才回到应有的水平。
 *
 * 现在只记状态，延迟交给 rules.ts 那一处统一处理 —— **一件事只有一个地方管**。
 */
export function applyStun(state: BattleState, source: UnitState | null, target: UnitState, durationTicks: number): void {
  if (target.dead || durationTicks <= 0) return;
  /*
    ★ 0.0.3：免疫眩晕（W「被动：免疫眩晕」）。
    静默跳过 —— 既不加状态也不记事件，因为"晕不住"这件事本身没有观感。
  */
  if (hasMechanic(target, 'stunImmune')) return;
  target.statuses['stun'] = Math.max(target.statuses['stun'] ?? 0, durationTicks);
  push(state, {
    type: 'status',
    t: state.tick,
    sourceId: source ? source.id : -1,
    targetId: target.id,
    status: 'stun',
    durationTicks,
  });
}

/**
 * 这个棋子的技能**现在还生效中**吗？
 *
 * ============================================================
 *  ★ 用途：技能生效期间不能回法力（你要求的）
 * ============================================================
 * 【为什么需要这条规则？】
 * 因为法力和技能效果同时增长会形成正反馈：
 * 一个持续 10 秒的大招期间还在攒蓝，技能一结束蓝又满了 ——
 * 变成"大招永远开着"，别的棋子完全没法打。
 * 让"技能生效期间不回蓝"之后，一个技能真正占掉的就是它自己的持续时间，
 * 强度上限就由"技能时长 / 攒蓝速度"这个比例决定，可预期、也好调。
 *
 * 【怎么判断"生效中"？】
 * 技能给出去的所有修正包（`buff`）都记着 `sourceId = 施法者`。
 * 所以只要**任何棋子身上还挂着这个施法者给的、还没过期的 buff**，
 * 就说明它这一发技能还在生效：
 *   · 给自己的增益（维什戴尔过载、耀骑士救援后的自身强化）
 *   · 给队友的增益（支援类技能的持续时间）
 *   · 光环式的自我 buff（脉冲类）
 * 全都是同一套判断，不需要每个技能单独写一遍。
 *
 * 即时伤害类技能（打完就完，没有任何 buff）自然就不受这条限制 ——
 * 那是正确的：它没有"释放期间"。
 */
export function isSkillActive(state: BattleState, unit: UnitState): boolean {
  for (const other of state.units) {
    const buffs = other.skill?.buffs;
    if (!buffs || buffs.length === 0) continue;
    for (const buff of buffs) {
      if (buff.sourceId !== unit.id || buff.ticksLeft <= 0) continue;
      /*
        ★ 常驻被动不算"技能生效"（`SkillBuff.passive` 的说明要看）。
        穿戴藏品的属性包就是这里漏进去的：它永久挂在 wearer 身上、
        sourceId 又是自己 —— 不跳过的话，这件棋子一辈子都在"技能生效中"，
        gainMana 一个蓝点都不发，技能再也放不出来。
      */
      if (buff.passive) continue;
      return true;
    }
  }
  return false;
}

/**
 * ★★ 0.2.1：**这名棋子还有没引爆的"锁定—引爆"计划**（蕾缪安 3 星「强制追思」）。
 *
 * 【这条为什么单独存在，不能靠 `isSkillActive` 顺便管？】
 *   1. 锁定是**挂在技能运行时上的计划**（`SkillRuntime.lockOn`），**不是 buff** ——
 *      `isSkillActive` 只认 buff，压根看不见它；
 *   2. 更要命的是她走的是**自动回复**，那条路特意传了 `duringSkill: true` 绕开闸门
 *      （见 `gainMana` 里 0.1.3 那段），所以就算她身上挂着 7 秒的 `noAttack` buff
 *      也拦不住 —— 实测技能那 7 秒法力照常从 0 涨到 800。
 *
 * 【判据唯一一处】`tickLockOn` 引爆的那一 tick 会把 `lockOn` 置成 undefined，
 * 所以"计划还在"就等价于"还没炸"，不需要另外记一个开关。
 */
export function hasPendingLockOn(unit: UnitState): boolean {
  return unit.skill?.lockOn !== undefined;
}

/** 增加法力。到达上限则触发技能（由 rules.ts 的 step 处理） */
export function gainMana(
  state: BattleState,
  unit: UnitState,
  amount: number,
  /**
   * ★ 0.1.3：这一次回蓝**不受"技能生效中"限制**。
   * 只有「自动回复」用它 —— 见下面那段说明。
   */
  opts: { duringSkill?: boolean } = {},
): void {
  if (unit.dead || amount <= 0) return;
  /*
    ★★ 0.2.1（用户口径）：**"锁定—引爆"没炸之前不回蓝**（蕾缪安 3 星）。
    她 7 颗弹药落下去之前技能条一格都不涨，炸完之后才开始攒 ——
    和"弹药类技能期间不回蓝"是同一条手感：子弹还在天上，技能不算放完。
    ★ 这条**连自动回复也要拦**（所以放在 `duringSkill` 那个判断**之前**）——
    她走的恰恰就是自动回复，放在后面等于没改。
    放在这个唯一入口上，攻击 / 受击 / 自动 / 队友光环四条路一起被拦住。
  */
  if (hasPendingLockOn(unit)) return;
  /*
    ★ 技能生效中不攒蓝（你要求的）。
    放在这里是因为**所有**回蓝路径最终都走这个函数：
    攻击回复、受击回复、自动回复、以及"技能给自己回蓝"。
    在唯一的入口上设闸，就不会漏掉任何一条。

    ★★ 0.1.3 例外：「自动回复」不受这条限制。
    【为什么？】自动回复是**按时间**来的（"每 10 秒开启一次"），
    技能自己持续的那一两秒里不该把这部分时间吃掉 ——
    否则 CD 会变成 10 秒 + 技能时长（锏实测 12 秒以上，用户报的就是这条）。
    ★ 而且原来还有个更隐蔽的错：`tickSkill` 里**先**扣了 `manaAccum` 再调这里，
    被拦下来之后那点法力就**凭空消失**了（玩家看到的是"技能条停在 130 好几秒不动"）。
    攻击/受击回复仍然照旧被拦（它们的节奏本来就该跟着出手走）。
  */
  /*
    ★★ 0.2.1（用户口径，别改回"弹药期也回蓝"）：
    **弹药类技能期间也不回蓝** —— 子弹打光之前技能条一格都不涨，打空之后才开始攒。
    这里的判据就是 `isSkillActive`：弹药包（`attacks: N`）也是技能生效中的一种，
    所以天然被这条闸门拦住，不需要额外判断。
  */
  if (!opts.duringSkill && isSkillActive(state, unit)) return;
  /*
    ★ 0.2 左乐：「护盾存在期间无法获得技力」。
    也放在这个唯一入口上 —— 攻击 / 受击 / 自动回复三条路一起被拦住，
    不会出现"受击回蓝被挡住、但攻击回蓝照样涨"这种半吊子。
  */
  if (unit.statuses['shieldNoMana']) return;
  /*
    ★ 0.2 赤刃明霄陈：「技能持续期间不再获得技力」。
    这里读的是**生效中的修正包**（`SkillStats.noManaGain`）——
    时长由那份包自己决定，包一到期就自动恢复回蓝，不需要任何"技能结束"钩子。
  */
  const mods = collectMods(state, unit);
  if (mods.noManaGain) return;
  /*
    ★★ 0.3.1 盟约「加急启动」（大帝）：**所有来源**的技能条获取 +15%。

    【为什么放在这个唯一入口上？】
    用户口径是"自动回复、攻击回复、受击回复都算" —— 这三条路最终都走 `gainMana`。
    在这里乘一次，就不会出现"攻击回复有加成、受击回复没有"这种半吊子。

    【为什么用整数万分比？】
    联机两边必须算出**同一个整数**。写成 `amount * 1.15` 会引入浮点误差，
    极端情况下两边差 1 点法力 ⇒ 技能释放时机不同 ⇒ 校验和不一致。
  */
  /*
    ★★ 0.3.2：技能条获取加成有**两个来源**，都在这一处乘：
      · 盟约「加急启动」（`covenantManaGainBp`）
      · 藏品「迅捷作战粮」（装备时写进 `statuses['manaGainBonusBp']`）
    以前只有盟约那一条，藏品的卡面写着"回复量 +50%"却挂成了治疗效果（描述与效果不符）。
    ★ 必须还是**整数万分比**：两边要算出同一个整数，写成浮点会引入校验和误差。
  */
  const manaGainBp =
    covenantManaGainBp(state.covenantIds?.[unit.team]) +
    (unit.statuses['manaGainBonusBp'] ?? 0) +
    /*
      ★★ 0.3.2：第三个来源 —— **技能/减益挂的修正包**（阿米娅·炉芯终曲的终曲效果
      「技能回复速度降低 99%」）。它是负数，所以下面要夹到 0（不能倒扣蓝）。
    */
    mods.manaGainBp;
  const gained =
    manaGainBp === 0 ? amount : Math.max(0, Math.floor((amount * (BP + manaGainBp)) / BP));
  const before = unit.mana;
  unit.mana = Math.min(MANA_MAX, before + gained);
  if (unit.mana !== before) {
    push(state, { type: 'mana', t: state.tick, unitId: unit.id, amount: unit.mana - before, manaAfter: unit.mana });
  }
}

/**
 * 记一条「范围效果」事件 —— 界面靠它在棋盘上画方框。
 *
 * 【为什么由内核发，而不是界面自己猜？】
 * 见 types.ts 里 zone 事件的说明：界面只读事件日志，
 * 让内核在真正生效的那一刻把范围记下来，画出来的框才**一定和实际范围一致**。
 *
 * @param kind 'damage' 画白框，'heal' 画绿框
 */
export function emitZone(
  state: BattleState,
  source: UnitState | null,
  cell: Cell,
  radius: number,
  shape: SplashShape,
  kind: 'damage' | 'heal',
  durationTicks: number,
  /**
   * ★ 0.2.1 表现层：这一圈范围该配哪套**专属特效**（渲染层注册表键）。
   * 来自 `PulseSpec.fx` / `SplashSpec.fx`。纯表现层，不进校验和；
   * 不传 = 只有白框（老行为）。
   */
  fx?: string,
): void {
  push(state, {
    type: 'zone',
    t: state.tick,
    unitId: source ? source.id : -1,
    cell: { col: cell.col, row: cell.row },
    radius,
    shape,
    kind,
    durationTicks,
    /*
      ★ 0.2：把**施法者所在的格**也记下来。
      只有 `line`（陈的"前方 3 格"）需要它 —— 直线的方向是
      "从施法者指向那个格子"，光有中心点是画不出这条线的
      （之前界面就只好把它画成一个以中心点为准的大方块，看起来像"半径 3 格"）。
      ★ 纯表现层字段：**不进校验和**（见 computeChecksum 的 zone 分支）。
    */
    from: source ? { col: source.cell.col, row: source.cell.row } : undefined,
    ...(fx ? { fx } : {}),
  });
}

/**
 * 受伤回蓝。
 *
 * ★ 0.2：**固定回 `MANA_FROM_DAMAGE_TAKEN`（100）**，和挨了多少伤害、什么伤害类型都无关。
 * 【为什么改了？】以前是 `伤害 × 万分比`（物理 20 / 法术 8），于是"充能速度取决于敌人打得多疼"：
 * 被小怪刮一下几乎不涨、被 Boss 砸一下回一大截，玩家也算不出"还差几下能开技能"。
 * 现在 `MANA_MAX = 1000` ⇒ **挨 10 次打必开一次技能**，和「每次普攻回 100」完全对称。
 *
 * ★ 仍然要求"真的挨到了伤害"（`damage > 0`）：免疫 / 闪避 / 护盾全挡下来不算挨打，
 * 不该白给法力 —— 否则带盾的受击回蓝棋子会"开着盾无限放技能"。
 */
export function gainManaFromDamageTaken(state: BattleState, unit: UnitState, damage: number): void {
  if (damage <= 0) return;
  gainMana(state, unit, MANA_FROM_DAMAGE_TAKEN);
}

/** 击杀处理：标记死亡、释放格子、记事件 */
export function killUnit(state: BattleState, unit: UnitState): void {
  if (unit.dead) return;

  /*
    ★ 野怪二阶段「重生」：血量第一次归零时不倒下。

    这里必须挡在"标记死亡"之前 —— 一旦 unit.dead 被置上，
    释放格子 / 记 death 事件 / 别人不再选它当目标，全都发生了，
    再想把它"救回来"就得一个一个回滚，那些就是最难查的 bug。
    所以判定放在最前面：要重生就地站起来，后面一律不执行。

    一场战斗只允许重生一次（rebornUsed）。
  */
  /*
    ★★ 0.2：**一次性的锁血**（若叶睦的被动「多首野兽」）。

    口径（用户原文）：「仅一次，当自身受到致命伤害时，锁定 1 点生命值，无法攻击，
    无法移动，获得嘲讽效果，持续 5s/7s/10s（此被动不受复活效果影响，复活后此被动不会刷新）」。
    ⇒ 所以：
      · 用 `statuses['defyDeathUsed']` 记"用过了"，**只有一次**（复活也不会把它清掉）；
      · 血量锁 `hp`（默认 1），不是满血站起来 —— 和「不屈」完全不是一回事；
      · 期间 `noAttack` + `noMove`（"无法攻击 / 无法移动"两个现成的闸门），
        嘲讽走 `statuses['defyDeathUntil']`（索敌那侧读它，见 movement.ts）；
      · 位置在 `reborn` **之后**：多阶段 Boss 那种"必死 -> 换形态"应该优先，
        锁血是"没有别的保命手段时"的兜底。
  */
  if (!unit.statuses['defyDeathUsed']) {
    const defy = collectMods(state, unit).defyDeath;
    if (defy) {
      unit.statuses['defyDeathUsed'] = 1;
      unit.statuses['defyDeathUntil'] = state.tick + defy.ticks;
      unit.hp = defy.hp;
      addBuff(unit, {
        /*
          ★★ 0.2 修（用户 2026-10-17「若叶睦的被动没有成功生效」）：
          这里**必须带 `cannotDie`**。原来只锁了 1 点血 + 不能攻击/移动 + 嘲讽 ——
          可是嘲讽会把所有敌人拉过来打她，而 1 点血在"同一次攻击的第二段"
          （连击 / 溅射 / 同 tick 的第二个敌人）就会被扣光，当场死掉，
          那个窗口（0.2.1 起是 1/2/3 秒）连一帧都撑不到，玩家看到的就是"被动没了"。
          带上 `cannotDie` 之后，`dealDamage` 在窗口内把致命伤害夹在 1 点血上
          （和魔王 3 星同一个闸门，全仓库只有那一处判致死豁免），窗口结束才真正会死。
        */
        stats: { noAttack: true, noMove: true, cannotDie: true },
        ticksLeft: defy.ticks,
        sourceId: unit.id,
        passive: true,
      });
      push(state, {
        type: 'rebirth',
        t: state.tick,
        unitId: unit.id,
        phase: 1,
        hpAfter: unit.hp,
        maxHp: unit.maxHp,
      });
      return;
    }
  }

  if (unit.reborn && !unit.rebornUsed) {
    unit.rebornUsed = true;
    /*
      ★ 0.0.3：有 `delayTicks` 的走"倒地等复活"（表里的「死亡后需要 3/5 秒复活，
      复活期间不能攻击不能移动」）。没有 delay 的老路径保持"立刻站起来"。
    */
    const delay = unit.reborn.delayTicks ?? 0;
    if (delay > 0) {
      unit.hp = 0;
      unit.downedUntilTick = state.tick + delay;
      // 站起来之前先把锁定它的目标清掉 —— 免得它们对着 0 血的空地继续挥拳
      unit.targetId = CELL_EMPTY;
      push(state, { type: 'downed', t: state.tick, unitId: unit.id, delayTicks: delay });
      return;
    }
    applyReborn(state, unit);
    return;
  }

  /*
    ★★ 0.3 盟约「命结之秘」：每场战斗，我方**最先阵亡的前 2 个**干员立刻原地复活一次。

    【为什么放在 `reborn` 之后、`unyielding` 之前？】
    · `reborn`（茧甲 / 多阶段 Boss）是**必定**复活，而且上面每个分支都 `return` ——
      带茧甲的棋子第一次死先走它，天然就是"藏品优先"（用户 0.2 的口径）。
    · 「命结之秘」是**队伍级的、有次数上限的必定复活**，比"概率复活"（不屈）更硬，
      所以排在它前面：先吃满这 2 次，之后才轮到掷骰子的不屈。
    · 两个都在 `return` 之前 —— 一次死亡只可能被拉起一次。

    【为什么计数在 BattleState 上？】
    "前 2 个"是**这一队**的额度，不是每只棋子各一次。
    算在棋子身上就会变成"每只干员都能复活一次"（10 只 = 10 次），完全不是这个意思。

    【为什么不需要掷骰？】
    必定复活 ⇒ 不消费随机数 ⇒ 不会影响别的概率判定（这条很重要：
    多掷一次骰子会让整场的随机序列整体错位，两边只要有一处不同就打架）。
  */
  /*
    ★★ 0.3.0 修：**召唤物不算「干员」**。
    「命结之秘 / 回收利用 / 食腐之蝶」写的都是"我方**干员**阵亡时"，
    而召唤物（维娜的兵、迷迭香的柱子…）也是 `state.units` 里的一员、也会走 `killUnit`。
    不挡掉的话：
      · 一只召唤物死掉就会白吃一次「命结之秘」的复活名额；
      · 休谟斯/卡莱莎会把召唤物的死亡算成干员死亡（攻击力可以靠送召唤物刷满）。
    这类 bug 不报错、只在特定阵容里出现，所以统一用 `isSummon` 挡住。
  */
  const covenantId = state.covenantIds?.[unit.team];
  if (!unit.isSummon && covenantId === 'cv_emengarde' && (state.covenantRevives?.[unit.team] ?? 0) < 2) {
    state.covenantRevives[unit.team] = (state.covenantRevives[unit.team] ?? 0) + 1;
    unit.hp = unit.maxHp;
    /*
      ★ 用户口径："复活后血量回满、技能状态保留" ⇒ 这里**只补血**，
      不碰 `mana` / `nextActionTick` / 身上的 buff（和「不屈」不同：
      那条会额外给攻速并重跑 battleStart）。
    */
    push(state, {
      type: 'rebirth',
      t: state.tick,
      unitId: unit.id,
      phase: 0,
      hpAfter: unit.hp,
      maxHp: unit.maxHp,
    });
    return;
  }

  /*
    ★★ 0.2 新羁绊「不屈」：阵亡时**有概率**站起来（2/3/5 人 = 30%/40%/50%）。

    【为什么偏偏放在 `reborn` 那一段**后面**？】
    用户口径："有必定复活藏品时优先判定藏品复活效果"。
    `reborn`（M3 茧甲 / 多阶段 Boss）是**必定**复活，而且上面那一段每个分支末尾都会
    `return` —— 所以带茧甲的棋子第一次死一定走茧甲，不屈留到后面那次死再判，
    天然就是"藏品优先"。优先级只在这里体现一次，不用在两处各写一遍条件。

    【★ 每次死都掷，但每成功一次概率 -10%】
    用户口径：先做成了"每场一次"，后来改成「每次死都掷，每复活一次概率 -10%」。
    所以这里记的是**成功次数**（`unyieldingRevives`）而不是一个"用过了"的布尔：
      `本次概率 = max(0, 档位概率 - 已复活次数 × UNYIELDING_CHANCE_DECAY_BP)`
    ⇒ 2 人档 30% 的实际上限是"站起来 3 次"（30/20/10），之后概率是 0、不再掷骰。
    ★ 概率归零之后**直接跳过、不掷骰**：白掷一次会把随机数序列往后推，
      让"另一个棋子的某个概率"跟着变 —— 这种耦合是最难查的那种不确定性。

    【状态记在 statuses 里】那是"每个单位一个的杂项数字表"，
    加一条不动结构、也不影响快照/校验和。

    【骰子必须走 state.rng】联机两边要掷出同一个结果（同下面 `goldOnDeath` 的理由）。
  */
  const unyielding = (unit.trait?.mechanics ?? []).find((item) => item.kind === 'unyielding');
  if (unyielding && unyielding.kind === 'unyielding') {
    const revives = unit.statuses['unyieldingRevives'] ?? 0;
    const chanceBp = Math.max(0, unyielding.chanceBp - revives * UNYIELDING_CHANCE_DECAY_BP);
    if (chanceBp > 0 && state.rng.nextInt(10000) < chanceBp) {
      unit.statuses['unyieldingRevives'] = revives + 1;
      // 满血站起来（和茧甲那条一致）
      unit.hp = unit.maxHp;
      /*
        复活后的两个效果：

        ① **攻速永久提升**：和野怪二阶段的 `applyRebornGrowth` 用同一个算法 ——
           直接乘在 `unit.attackSpeed` 上，不走限时包。理由：这是一个"整场剩下的时间都带着"
           的强化，挂成 buff 会在特效栏留一条永不消失的条目。复活几次就叠几次。
        ② **立刻释放一次技能**：把法力灌满 + 让它这一帧就行动。
           这样施法走的仍然是**正常那一处实现**（`rules.ts` 的 `actUnit` 里"法力满了先放技能"）。
           ★ 不在这儿另开一套"读技能表 → 施放"：那会变成第二处真相，
             而且 `skills.ts` 是 import 本文件的 —— 反过来 import 它就是循环依赖。
           ★ 纯被动棋子（砾 / 临光 / 伊内丝都没有主动效果）法力灌满也没东西可放，
             所以额外留一个 `reviveSkillPending` 标记：`rules.ts` 每个 tick 开头会把
             **它的开局效果（`battleStart`）重新应用一次**（砾：护盾 + 35 护甲/魔抗 刷新）。
             为什么不在这儿直接做？因为 `battleStart` 的星级解析（`skillVariantOf`）和
             护盾/增益的落地（`applyBattleStartEffect`）都在 `skills.ts` / `rules.ts` 里，
             本文件 import 不到（循环依赖），只能"留个标记让它们去办"——
             和 `phasePending`（阶段切换的一次性效果）是同一套做法。
      */
      unit.attackSpeed = Math.floor((unit.attackSpeed * (BP + unyielding.attackSpeedBp)) / BP);
      unit.mana = MANA_MAX;
      unit.nextActionTick = state.tick;
      unit.statuses['reviveSkillPending'] = 1;
      push(state, {
        type: 'rebirth',
        t: state.tick,
        unitId: unit.id,
        // 不屈是"一阶段满血站起来"，不换形态（没有 artId）
        phase: 1,
        hpAfter: unit.hp,
        maxHp: unit.maxHp,
      });
      return;
    }
  }

  unit.dead = true;
  unit.hp = 0;
  /*
    释放它占的格子，让别的棋子能走过去。

    ★ 这里曾经写死成 `row * 8 + col`（8 是早期版本的棋盘宽度）。
    棋盘改成 10 宽之后，这个下标就指到别的格子去了，后果很隐蔽：
      · 死者真正占的格子**没被释放** -> 别的棋子永远走不过去
      · 另一个无辜的格子被清空 -> 那个棋子从此对寻路"隐形"
    两个症状都像"寻路抽风"，跟"释放格子"很难联想起来。
    所以这里必须用 cellIndex()（它内部用的是 BOARD_W）。
  */
  const index = cellIndex(unit.cell.col, unit.cell.row);
  if (state.cellToUnit[index] === unit.id) state.cellToUnit[index] = CELL_EMPTY;

  let remaining = 0;
  for (const other of state.units) {
    if (!other.dead && other.team === unit.team) remaining++;
  }
  push(state, { type: 'death', t: state.tick, unitId: unit.id, team: unit.team, remaining });

  /*
    ★★ 0.3.1 盟约「回收利用」（休谟斯）：
    我方干员**真正阵亡**时，其余我方单位获得「阵亡者最大生命 × 20%」的护盾。

    【为什么放在这里？】
    上面那些分支（野怪重生 / 不屈 / 命结之秘 / 锁血）都可能把这只棋子救回来，
    它们都 `return` 了 —— 只有走到这一行才算"真的死了"。
    "阵亡收益"不该在"看起来死了但又被拉起来"的时候触发，否则会白送一次护盾。

    【为什么用 MAX_BATTLE_TICKS 而不是 FOREVER？】
    和内核里其它"持续到战斗结束"的包保持同一个口径（见 types.ts 的说明）。
  */
  const deathShieldRatioBp = unit.isSummon ? 0 : covenantDeathShieldRatioBp(state.covenantIds?.[unit.team]);
  if (deathShieldRatioBp > 0) {
    const shieldAmount = Math.floor((unit.maxHp * deathShieldRatioBp) / BP);
    if (shieldAmount > 0) {
      for (const ally of state.units) {
        if (ally.dead || ally.team !== unit.team) continue;
        applyShield(state, unit, ally, shieldAmount, MAX_BATTLE_TICKS);
      }
    }
  }

  /*
    ★★ 0.3.1 盟约「食腐之蝶」（卡莱莎）：
    我方每有一名干员被击倒，场上剩余我方单位攻击力 +15%，最多 +150%，持续到战斗结束。

    【为什么用"数已经死了几个"来封顶，而不是新加一个计数器？】
    和下面「罗德岛」那条 `deathStatTransfer` 用的是同一个办法：
    `state.units` 是按 id 排的，数一遍天然确定性，也不需要在 BattleState 上加字段。
    本次阵亡已经算进去了（上面刚把 `unit.dead` 置上），所以第 1 个死的是 1 层。

    【封顶怎么算？】`deadAllies * attackBp <= capBp` —— 10 个死亡 × 15% = 150%，
    第 11 个开始不再叠。用"次数"而不是"读现有 buff 总和"，是因为
    中途复活/驱散都可能让 buff 总数和死亡次数对不上。
  */
  const deathRage = unit.isSummon ? null : covenantDeathRage(state.covenantIds?.[unit.team]);
  if (deathRage) {
    let deadAllies = 0;
    for (const other of state.units) {
      if (other.dead && other.team === unit.team) deadAllies++;
    }
    if (deadAllies * deathRage.attackBp <= deathRage.capBp) {
      for (const ally of state.units) {
        if (ally.dead || ally.team !== unit.team) continue;
        addBuff(ally, {
          stats: { attackDamageBp: deathRage.attackBp },
          ticksLeft: MAX_BATTLE_TICKS,
          sourceId: unit.id,
          passive: true,
        });
      }
    }
  }

  /*
    ★ 0.0.3 藏品：阵亡时有概率掉金（黄沙罗盘「死亡时有 50% 概率获得一金币」）。

    【为什么必须用 state.rng 而不是 Math.random？】
    因为这个骰子决定了"这局掉不掉金"，联机两边必须掷出同一个结果 ——
    用 Math.random 会直接破坏确定性，两边钱数不一样而且查不出来。
    记成 `gold` 事件之后，客户端播完战斗照着事件加钱即可。
  */
  const deathMechanics = unit.trait?.mechanics ?? [];
  for (const mechanic of deathMechanics) {
    if (mechanic.kind !== 'goldOnDeath') continue;
    if (state.rng.nextInt(10000) >= mechanic.chanceBp) continue;
    push(state, {
      type: 'gold',
      t: state.tick,
      team: unit.team,
      amount: mechanic.gold,
      sourceId: unit.id,
      reason: 'death',
    });
  }

  /*
    ★ 0.2 萨卡兹：阵亡时对**周围 3×3（八格）**的敌人造成"累计吸血量 × ratioBp"的法术伤害。
    "累计吸血量"= 这一场里自己靠 lifestealBp 实际回复的血量（dealDamage 第 4 步累加）。
  */
  for (const mechanic of deathMechanics) {
    if (mechanic.kind !== 'deathExplosion') continue;
    const amount = Math.floor(((unit.statuses['vampTotal'] ?? 0) * mechanic.ratioBp) / BP);
    if (amount <= 0) continue;
    for (const other of state.units) {
      if (other.dead || other.team === unit.team) continue;
      if (Math.abs(other.cell.col - unit.cell.col) > 1) continue;
      if (Math.abs(other.cell.row - unit.cell.row) > 1) continue;
      dealDamage(state, unit, other, amount, 'magic', 'spell');
    }
  }

  /*
    ★ 0.2 罗德岛：战斗里**第一个**阵亡的友方，把自身数值的 ratioBp 传给"离他最近的友方"。
    "每场最多 N 次"直接数"本队已经死了几个" —— 不需要额外状态，
    而且天然确定性（state.units 是按 id 排的）。
  */
  for (const mechanic of deathMechanics) {
    if (mechanic.kind !== 'deathStatTransfer') continue;
    let deadAllies = 0;
    for (const other of state.units) {
      if (other.id !== unit.id && other.dead && other.team === unit.team) deadAllies++;
    }
    if (deadAllies >= mechanic.maxTransfers) continue;
    let nearest: UnitState | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const other of state.units) {
      if (other.dead || other.team !== unit.team || other.id === unit.id) continue;
      const distance =
        Math.abs(other.cell.col - unit.cell.col) + Math.abs(other.cell.row - unit.cell.row);
      if (distance < bestDistance) {
        bestDistance = distance;
        nearest = other;
      }
    }
    if (!nearest) continue;
    /*
      逐项换算成"对接收者而言"的等价数值：
        · 生命/护甲/魔抗是**固定值**，直接给 50% 的点数；
        · 攻击力/攻速只有"百分比"字段（SkillStats 没有 attackFlat），
          所以按接收者的当前值反算出等效百分比 ——
          给 A 加 100 点攻击 == 给"攻击 500 的 A"加 +20%，两者结果完全一致。
    */
    const ratio = mechanic.ratioBp;
    /*
      ★★ 0.2 修：`hpFlat` / `armorFlat` / `magicResistFlat` 在 `SkillStats` 里是
      **面板点数**（`collectMods` 会 `* FIX` 转成定点数），而这里的 `unit.maxHp` /
      `unit.armor` 本身就是定点数 ⇒ 必须**再除一次 FIX**，否则收件人直接拿到
      1000 倍的属性（同族事故见 `startResist`）。
    */
    const stats = {
      hpFlat: Math.floor((unit.maxHp * ratio) / (BP * FIX)),
      armorFlat: Math.floor((unit.armor * ratio) / (BP * FIX)),
      magicResistFlat: Math.floor((unit.magicResist * ratio) / (BP * FIX)),
      attackDamageBp:
        nearest.attackDamage > 0
          ? Math.floor((unit.attackDamage * ratio * BP) / (BP * nearest.attackDamage))
          : 0,
      attackSpeedBp:
        nearest.attackSpeed > 0
          ? Math.floor((unit.attackSpeed * ratio * BP) / (BP * nearest.attackSpeed))
          : 0,
    };
    addBuff(nearest, { stats, ticksLeft: MAX_BATTLE_TICKS, sourceId: unit.id, passive: true });
  }
}

/**
 * 野怪二阶段「重生」：按比例回血 + 套一层强化。
 *
 * 【为什么不做成"死亡 + 重新生成一个单位"？】
 * 因为重新生成意味着新的 unitId、新的目标引用、新的格子占用 ——
 * 所有正在打它的棋子都要重新选目标，观感和数值都会漂。
 * "原地站起来"最简单，也最符合"同一个敌人进入第二形态"的表达。
 *
 * 数值全在数据里（monster-data.ts 的 MonsterReborn）：
 * 这里只负责按倍率算，不写死任何一只野怪的具体数字。
 */
function applyReborn(state: BattleState, unit: UnitState): void {
  const reborn = unit.reborn;
  if (!reborn) return;

  // 二阶段：先换技能/被动/机制，再按复活血量站起来
  applyUnitPhase(unit, 2);
  applyRebornGrowth(unit);
  const hpBp = reborn.phase2?.reviveHpBp ?? reborn.hpBp;
  unit.hp = Math.max(1, Math.floor((unit.maxHp * hpBp) / BP));
  push(state, {
    type: 'rebirth',
    t: state.tick,
    unitId: unit.id,
    phase: 2,
    hpAfter: unit.hp,
    maxHp: unit.maxHp,
    ...(reborn.phase2?.artId ? { artId: reborn.phase2.artId } : {}),
  });
  /*
    注：`reborn.enemyId` / `phase2.artId` 只用于**换模型**，
    由客户端按 rebirth 事件自己去切素材（见 three/chibi.ts）——
    战斗内核不关心贴图，更不该让它改 defId（defId 变了，
    所有按 defId 查表的逻辑都会跟着歪）。
  */
}

/**
 * 老式的"重生强化"：表里的 `damageBp` / `attackSpeedBp`（“盛怒”二形态 +20%）。
 *
 * 【为什么单独一个函数？】
 * 因为"复活"有两条路（立刻站起来 / 倒地等几秒再站起来），
 * 两处都要套同一份强化 —— 写两遍的话，以后加字段必然漏一处。
 * 走 phase2.passive 的那几只（杰斯顿 / 博卓）不写这两个字段，互不干扰。
 */
function applyRebornGrowth(unit: UnitState): void {
  const reborn = unit.reborn;
  if (!reborn) return;
  if (reborn.damageBp) unit.attackDamage = Math.floor((unit.attackDamage * reborn.damageBp) / BP);
  if (reborn.attackSpeedBp) unit.attackSpeed = Math.floor((unit.attackSpeed * reborn.attackSpeedBp) / BP);
}

/** 倒地等待复活：到点了就站起来进二阶段 */
function reviveFromDowned(state: BattleState, unit: UnitState): void {
  unit.downedUntilTick = undefined;
  applyUnitPhase(unit, 2);
  applyRebornGrowth(unit);
  const reborn = unit.reborn;
  const hpBp = reborn?.phase2?.reviveHpBp ?? reborn?.hpBp ?? BP;
  unit.hp = Math.max(1, Math.floor((unit.maxHp * hpBp) / BP));
  // 刚站起来这一帧不要立刻出手：给一次正常的行动间隔
  unit.nextActionTick = state.tick + 1;
  push(state, {
    type: 'rebirth',
    t: state.tick,
    unitId: unit.id,
    phase: 2,
    hpAfter: unit.hp,
    maxHp: unit.maxHp,
    ...(reborn?.phase2?.artId ? { artId: reborn.phase2.artId } : {}),
  });
}

/** 每 tick 检查一次"倒地的 Boss 该站起来了吗" */
export function tickDowned(state: BattleState, unit: UnitState): void {
  if (unit.dead || unit.downedUntilTick === undefined) return;
  /*
    ★★ 0.3.2：**倒地期间的全场脉冲**（阿米娅·炉芯终曲「重生期间每秒对全场造成
    自身攻击力 100% 的真实伤害」）。

    【为什么放在这儿，而不是给它挂一条 pulse？】
    倒地的单位在 `rules.ts` 的主循环里被 `continue` 跳过了（不攻击、不移动、不回蓝），
    所以普通 pulse 根本不会跑；只有 `tickDowned()` 每 tick 还会走到它。

    ★ 用 `tick % interval === 0` 判"该跳了"，不另开 timer ——
      倒地的这几秒里不需要"上次什么时候跳的"，周期对齐就够了。
  */
  const pulse = unit.reborn?.downedPulse;
  if (pulse && pulse.intervalTicks > 0 && state.tick % pulse.intervalTicks === 0) {
    const amount = Math.floor((unit.attackDamage * starValue(pulse.power, unit.star)) / FIX);
    if (amount > 0) {
      for (const other of state.units) {
        if (other.dead || other.team === unit.team) continue;
        dealDamage(state, unit, other, amount, pulse.damageType, 'spell');
      }
    }
  }
  if (state.tick < unit.downedUntilTick) return;
  reviveFromDowned(state, unit);
}

/**
 * ★ 0.0.3：把棋子切到第 `phase` 阶段（1 = 一阶段，2 = 二阶段）。
 *
 * 【为什么先"复位"再"套覆盖"？】
 * 因为一阶段和二阶段的加成都是**相对基础值**算的：
 * 杰斯顿一阶段攻速 -30%、二阶段 +50%，如果直接在 -30% 的结果上再乘 1.5，
 * 就变成 +5% 了。所以每一步都从 `phaseBase` 快照（开战那一刻的原始值）重算。
 *
 * 【为什么不用"死亡 + 重生一个新单位"？】
 * 重新生成意味着新的 unitId、新的目标引用、新的格子占用 —— 观感和数值都会漂。
 * 原地站起来最简单，也最符合"同一个敌人进入第二形态"的表达。
 */
export function applyUnitPhase(unit: UnitState, phase: number): void {
  const base = unit.phaseBase;
  if (!base) {
    unit.phase = phase;
    return;
  }
  const reborn = unit.reborn;
  const override = phase >= 2 ? reborn?.phase2 : reborn?.phase1;

  // 1) 复位到基础值
  unit.phase = phase;
  unit.range = base.range;
  unit.attackDamage = base.attackDamage;
  unit.attackSpeed = base.attackSpeed;
  unit.armor = base.armor;
  unit.magicResist = base.magicResist;
  unit.baseMaxHp = base.baseMaxHp;
  unit.skillPassive = base.passive;
  unit.manaSource = base.manaSource;
  unit.manaPerSecond = base.manaPerSecond;
  unit.phaseSkill = {
    name: base.skillName,
    effects: base.effects,
    passive: base.passive,
    manaSource: base.manaSource,
    manaPerSecond: base.manaPerSecond,
  };
  if (unit.trait) unit.trait.mechanics = [...(unit.prePhaseMechanics ?? [])];

  // 2) 套这一阶段的覆盖
  if (override) {
    if (override.range !== undefined) unit.range = override.range;
    if (override.damageBp) unit.attackDamage = Math.floor((unit.attackDamage * override.damageBp) / BP);
    if (override.attackSpeedBp) unit.attackSpeed = Math.floor((unit.attackSpeed * override.attackSpeedBp) / BP);
    if (override.armorFlat) unit.armor = Math.max(0, unit.armor + override.armorFlat * FIX);
    if (override.magicResistFlat) unit.magicResist = Math.max(0, unit.magicResist + override.magicResistFlat * FIX);
    if (override.maxHpBp) unit.baseMaxHp = Math.floor((unit.baseMaxHp * override.maxHpBp) / BP);
    if (override.effects) unit.phaseSkill.effects = override.effects;
    if (override.skillName) unit.phaseSkill.name = override.skillName;
    if (override.passive) {
      unit.skillPassive = override.passive;
      unit.phaseSkill.passive = override.passive;
    }
    if (override.manaSource) {
      unit.manaSource = override.manaSource;
      unit.phaseSkill.manaSource = override.manaSource;
    }
    if (override.manaPerSecond !== undefined) {
      unit.manaPerSecond = override.manaPerSecond;
      unit.phaseSkill.manaPerSecond = override.manaPerSecond;
    }
    if (override.mechanics && override.mechanics.length > 0 && unit.trait) {
      unit.trait.mechanics = [...unit.trait.mechanics, ...override.mechanics];
    }
    if (override.buffs) {
      for (const buff of override.buffs) {
        addBuff(unit, { stats: buff.stats, ticksLeft: buff.durationTicks, sourceId: unit.id });
      }
    }
    /*
      ★ 0.1.3：切阶段时把**技能条**设成多少（血骑士"复活后立刻召 6 只刀刃"、
      锏"复活后获得 50% 技能条"）。
      走的是"复活 -> 满蓝 -> 下一个行动 tick 自然把技能放出来"这条现成路径 ——
      不用再造一个"进入阶段时结算一次效果"的钩子，也不会像 `effects` 那样
      把技能永久换成"召唤 6 只"（那样之后每 4 秒都会召 6 只）。
    */
    if (override.manaBp !== undefined) {
      unit.mana = Math.min(MANA_MAX, Math.floor((MANA_MAX * override.manaBp) / 10000));
    }
    /*
      ★ 0.1.3：进入这一阶段时要结算的一次性效果（血骑士"复活后召唤 6 只刀刃"）。
      这里只**挂个标记** —— 召唤需要 state / defs，而这个函数是纯改数值的，
      拿不到它们。由战斗循环在下一 tick 结算（见 rules.ts 的 step）。
    */
    if (override.onEnter && override.onEnter.length > 0) {
      unit.phasePending = [...override.onEnter];
    }
  }

  // 3) 生命上限跟着重算（maxHpBp / 被动 hpFlat 都会影响它）
  refreshMaxHp(unit);
  if (unit.hp > unit.maxHp) unit.hp = unit.maxHp;
}

/**
 * 召唤一个单位（迷迭香的柱子 / 维娜的金狮子 / 望的棋子）。
 *
 * 【召唤物和普通棋子的三点区别】
 *   1. `isSummon = true` —— 死亡不扣玩家血，也不进"剩余人数"的结算
 *   2. `expiresAtTick` —— 到点了自动消失（"持续20秒"）
 *   3. 属性可以用技能里按星级给的覆盖值（柱子 300/500/700）
 */
export function spawnSummon(
  state: BattleState,
  def: UnitDef,
  owner: UnitState,
  cell: Cell,
  options: { hp?: number; attackDamage?: number; durationTicks?: number },
): UnitState | null {
  const index = cellIndex(cell.col, cell.row);
  if (state.cellToUnit[index] !== CELL_EMPTY) return null;

  // 召唤物的 id 从 900000 起 —— 干员用的是 team*1000+序号（最大 2000 左右），
  // 两边永远不会撞。召唤顺序决定 id，所以是确定性的。
  const id = 900000 + state.nextSummonId++;
  const hp = options.hp ?? Math.floor(def.base.hp * FIX);
  const unit: UnitState = {
    id,
    team: owner.team,
    defId: def.id,
    star: owner.star,
    cell: { col: cell.col, row: cell.row },
    hp,
    maxHp: hp,
    baseMaxHp: hp,
    mana: 0,
    manaSource: def.skill.manaSource,
    manaPerSecond: def.skill.manaPerSecond ?? 0,
    armor: def.base.armor * FIX,
    magicResist: def.base.magicResist * FIX,
    attackDamage: options.attackDamage ?? Math.floor(def.base.attackDamage * FIX),
    attackSpeed: def.base.attackSpeed,
    range: def.base.range,
    nextActionTick: state.tick + 1,
    moveCooldown: 0,
    targetId: CELL_EMPTY,
    statuses: { manaPerAttack: def.base.manaPerAttack },
    isSummon: true,
    summonOwnerId: owner.id,
    expiresAtTick: options.durationTicks ? state.tick + options.durationTicks : undefined,
    damageDealt: 0,
    dead: false,
    /*
      ★★ 0.2 修：召唤物也必须带上 `def.reborn`。

      `createUnit` 一直有这一行，而 `spawnSummon` 是**手搓 UnitState** 的、漏了它 ——
      于是靠羁绊召唤出来的援军（白杨 / 血骑士 / 锏）**永远不复活**，
      而且不报任何错（`killUnit` 只是 `if (!unit.reborn)` 就往下走）。
      和"羁绊的 startSummon 没人读"是同一类问题：同一个动作被实现了两遍，
      其中一遍漏了字段。
    */
    ...(def.reborn ? { reborn: { ...def.reborn }, rebornUsed: false } : {}),
    // 被挡住的连续 tick 数与上一格（0.0.2 寻路用；召唤物同样需要初始化，
    // 否则 tryMoveToward 里的 blockedTicks++ 会变成 NaN）
    blockedTicks: 0,
    prevCell: null,
    skillPassive: def.skill.passive,
    skill: {
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
    },
  };

  /*
    ★ 0.1.1：召唤物的嘲讽**写在数据里**（支援防暴桩的假人、迷迭香的战术柱都写
    `mechanics:[{kind:'taunt'}]`）。
    【为什么调用方（createBattle）那套读不到？】因为召唤物是战斗中**临时生出来**的，
    走的是这条 spawnSummon，不经过 createBattle 那段"挂机制"的循环 ——
    所以这里补一次，数据里怎么写的就怎么生效。

    ★ 0.1.4：以前这里有一句**按 id 写死**的柱子嘲讽（`def.id` 判断），已经删掉了 ——
    「战术柱会嘲讽」现在只剩下面这一个数据驱动的入口（见 `SUMMON_DEFS.summon_pillar`）。
    ★ 判断召唤物会不会嘲讽，只看 `def.mechanics`，别再按 id 写死。
    （有源码级测试钉住：spawnSummon 里不许出现任何召唤物 id。）
  */
  /*
    ★ 0.1.3：召唤物的机制**不从 `unit.trait` 走**（那个结构是给羁绊用的、字段很多，
    召唤物拿不到一整份）。写在数据里的机制由 `actUnit` 直接查 `defs[defId].mechanics` ——
    见 rules.ts 里 escort 那一段。
    ★ taunt 还要额外设 `unit.taunt`（那是"锁敌用"的字段，不是机制本身）。
  */
  for (const mechanic of def.mechanics ?? []) {
    if (mechanic.kind !== 'taunt') continue;
    unit.taunt = true;
    unit.tauntRadius = mechanic.radius;
  }

  state.cellToUnit[index] = unit.id;
  state.units.push(unit);
  state.units.sort((a, b) => a.id - b.id);
  push(state, {
    type: 'spawn',
    t: state.tick,
    unitId: unit.id,
    team: unit.team,
    defId: unit.defId,
    star: unit.star,
    cell: { ...unit.cell },
    maxHp: unit.maxHp,
  });
  return unit;
}

/** 召唤物到期 / 陷阱爆炸后的移除。**不算击杀**（不记 death 事件里的 remaining） */
export function removeSummon(state: BattleState, unit: UnitState): void {
  if (unit.dead) return;
  unit.dead = true;
  unit.hp = 0;
  const index = cellIndex(unit.cell.col, unit.cell.row);
  if (state.cellToUnit[index] === unit.id) state.cellToUnit[index] = CELL_EMPTY;
  let remaining = 0;
  for (const other of state.units) {
    if (!other.dead && other.team === unit.team) remaining++;
  }
  push(state, { type: 'death', t: state.tick, unitId: unit.id, team: unit.team, remaining });
}

/**
 * 生成战斗校验和。
 *
 * 用途：服务器算一遍，客户端算一遍，两个数字必须完全一样。
 * 不一样就说明「确定性被破坏了」—— 这是排查联机 bug 最有效的工具，
 * 比对着日志找半天强得多。
 *
 * 【为什么要把整条事件日志都哈希进去，而不是只算最终血量？】
 * 因为两场战斗可能「过程完全不同、结局恰好一样」（比如都是队伍0 剩 1 个残血棋子）。
 * 只比对最终状态就会漏掉这种分叉 —— 而它恰恰是最危险的情况：
 * 玩家看到的战斗过程不一样，但服务器认为一切正常。
 * 所以这里把每个事件的类型、时间、目标、数值全部混进哈希。
 */
export function computeChecksum(state: BattleState, winner: 0 | 1 | null, ticks: number): number {
  let h = 2166136261 >>> 0;
  const mix = (value: number): void => {
    h = (h ^ (value >>> 0)) >>> 0;
    h = Math.imul(h, 16777619) >>> 0;
  };

  mix(ticks);
  mix(winner === null ? 0xffff : winner);

  // 事件日志：这是分叉最敏感的指纹
  for (const event of state.log) {
    /*
      ★ 0.1.3：`slash`（斩击特效）是**纯表现层**事件，直接跳过 ——
      加它前前后后战斗结果一个数都不变，所以服务端与客户端的 checksum
      仍然完全一致（不用因为"多了一种特效"就担心联机分叉）。
      和 `move.instant` 是同一个思路：给表现层的提示不参与复现。

      ★ 0.2：`bloom`（范围爆炸特效）同上 —— 它比 `slash` 更"纯"：
      连它引用的那套图都是渲染层的注册表，内核只知道数据里写了个字符串。
    */
    if (event.type === 'slash') continue;
    if (event.type === 'bloom') continue;
    // ★ 0.2.1：`attackLink`（额外目标的那条弹道）同样是纯表现层，跳过
    if (event.type === 'attackLink') continue;
    /*
      ★★ 0.2.2：蕾缪安的「锁定 / 引爆」也是纯表现 ——
      它们报的是"哪个地块被瞄准了、什么时候炸的"，一个数都不影响战斗结果。
      跳过的意义和 `slash`/`bloom` 完全一样：多播几条特效事件不能让联机两端分叉。
    */
    if (event.type === 'lockOnMark') continue;
    if (event.type === 'lockOnBlast') continue;
    /*
      ★★ 0.3.2：`executeFx`（即死叠加特效）同理 —— 它只说"这个人是怎么死的"，
      一个数都不影响战斗结果。跳过它的意义同样是不让联机两端因为"多播了特效"分叉。
    */
    if (event.type === 'executeFx') continue;
    mix(event.t);
    mix(eventTypeCode(event.type));
    switch (event.type) {
      case 'spawn':
        mix(event.unitId);
        mix(event.cell.col * 16 + event.cell.row);
        mix(event.maxHp);
        break;
      case 'move':
        mix(event.unitId);
        mix(event.to.col * 16 + event.to.row);
        break;
      case 'attack':
        mix(event.unitId);
        mix(event.targetId);
        break;
      case 'damage':
        mix(event.sourceId);
        mix(event.targetId);
        mix(event.amount);
        mix(event.absorbed);
        mix(event.hpAfter);
        break;
      case 'heal':
        mix(event.sourceId);
        mix(event.targetId);
        mix(event.amount);
        break;
      case 'shield':
        mix(event.targetId);
        mix(event.amount);
        break;
      case 'status':
        mix(event.targetId);
        mix(event.durationTicks);
        break;
      case 'dodge':
        mix(event.targetId);
        mix(event.reason === 'evade' ? 1 : 2);
        break;
      case 'zone':
        mix(event.unitId);
        mix(event.cell.col * 16 + event.cell.row);
        mix(event.radius);
        mix(event.kind === 'damage' ? 1 : 2);
        break;
      case 'buff':
        mix(event.targetId);
        mix(event.bonusBp);
        break;
      case 'mana':
        mix(event.unitId);
        mix(event.manaAfter);
        break;
      case 'cast':
        mix(event.unitId);
        mix(hashString(event.skillId));
        break;
      case 'death':
        mix(event.unitId);
        mix(event.remaining);
        break;
      case 'gold':
        // ★ 0.0.3：金币事件也要进校验和 —— 它是随机掷骰的结果，
        // 两边万一掷出不同的结果，这里就能立刻发现（否则只是"钱数对不上"，很难查）
        mix(event.team);
        mix(event.amount);
        break;
      case 'downed':
        mix(event.unitId);
        mix(event.delayTicks);
        break;
      case 'rebirth':
        mix(event.unitId);
        mix(event.phase);
        mix(event.hpAfter);
        mix(event.maxHp);
        break;
      case 'end':
        mix(event.hpBpTeam0);
        mix(event.hpBpTeam1);
        break;
    }
  }

  // 最终状态也一起混进去，双重保险
  for (const unit of state.units) {
    mix(unit.id);
    mix(unit.hp);
    mix(unit.mana);
    mix(unit.cell.col);
    mix(unit.cell.row);
    mix(unit.dead ? 1 : 0);
  }

  return h >>> 0;
}

/** 给事件类型一个稳定的数字编号，用于哈希 */
function eventTypeCode(type: string): number {
  switch (type) {
    case 'spawn': return 1;
    case 'move': return 2;
    case 'attack': return 3;
    case 'damage': return 4;
    case 'heal': return 5;
    case 'shield': return 6;
    case 'status': return 7;
    case 'buff': return 8;
    case 'mana': return 9;
    case 'cast': return 10;
    case 'death': return 11;
    case 'end': return 12;
    case 'dodge': return 13;
    case 'zone': return 14;
    case 'gold': return 15;
    // ★ 0.0.3 野怪二阶段
    case 'downed': return 16;
    case 'rebirth': return 17;
    /*
      ★ 0.1.3：`slash`（锏的斩击）是**纯表现层**事件，在主循环里已经被
      `if (event.type === 'slash') continue;` 跳过了，所以这里其实用不到它。
      仍然给它一个稳定编号，是为了防止"哪天那句 continue 被误删"时，
      它悄悄退化成 99（和所有未知类型同号）而**不报错** —— 那种失配极难查。
    */
    case 'slash': return 18;
    /*
      ★ 0.2：`bloom`（范围爆炸特效）同上 —— 主循环里已经 `continue` 掉了。
      编号照给，理由和 `slash` 完全一样：万一那句 continue 被误删，
      它不会悄悄退化成 99（和所有未知类型同号）而不报错。
    */
    case 'bloom': return 19;
    /*
      ★ 0.2.1：`attackLink`（额外目标的弹道）同上 —— 主循环里已经 `continue` 掉了。
      编号照给，理由和 `slash`/`bloom` 一模一样：万一那句 continue 被误删，
      它不会悄悄退化成 99 而不报错。
    */
    case 'attackLink': return 20;
    /*
      ★★ 0.2.2：`lockOnMark` / `lockOnBlast`（蕾缪安的锁定与引爆）同上 ——
      主循环里已经 `continue` 掉了，编号照给，理由一模一样：
      万一哪天那句 continue 被误删，它会退化成 99 而**不报错**。
    */
    case 'lockOnMark': return 21;
    case 'lockOnBlast': return 22;
    /*
      ★★ 0.3.2：`executeFx` 同上 —— 主循环里已经 `continue` 掉了，编号照给，
      理由和上面几条一模一样：万一那句 continue 被误删，它不会悄悄退化成 99 而不报错。
    */
    case 'executeFx': return 23;
    default: return 99;
  }
}

/** 字符串哈希（FNV-1a），用于把技能 id 混进校验和 */
function hashString(text: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i++) {
    h = (h ^ text.charCodeAt(i)) >>> 0;
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}
