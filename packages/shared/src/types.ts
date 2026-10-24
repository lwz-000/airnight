import type { Rng } from './rng.js';

// ============================================================
// 棋盘
// ============================================================

/** 棋盘坐标。col = 列（0..7），row = 行（0..5） */
export interface Cell {
  col: number;
  row: number;
}

/**
 * 棋子在场上的实例。
 * 注意 hp 等数值的单位是「千分之一」（FIX），见 constants.ts
 */
/**
 * 棋子的移动方式。
 *
 * 【为什么要做成"可配置"，而不是直接写死四方向？】
 * 因为你的设计里有「改变移动方式的技能」（突进、传送、飞行、斜走…）。
 * 如果现在把"只能上下左右"硬编码进移动循环，以后加这类技能就得把它拆掉重写。
 * 做成一个字段之后：
 *   · 现在所有棋子都是 `orthogonal`（上下左右）
 *   · 以后技能只要把某个棋子的 moveStyle 改成 `any`（八方向），移动逻辑一行都不用改
 *
 * 注意：**移动方式和"攻击距离怎么算"是绑定的**。
 * 只能上下左右走的棋子，攻击距离也用曼哈顿距离（横 + 竖），
 * 否则会出现"斜着站在旁边就能砍到人、但一步也走不过去"的怪现象。
 */
export type MoveStyle = 'orthogonal' | 'any';

export interface UnitState {
  /** 全场唯一 id。例如 team0 的第 3 个棋子是 1003。用于确定性排序 */
  id: number;
  /** 归属队伍：0 = 左侧玩家，1 = 右侧玩家 */
  team: 0 | 1;
  /** 棋子库存 id，对应 unitDefs 表里的 key（如 'knight'） */
  defId: string;
  /** 星级 1/2/3 */
  star: number;
  /** 场上位置。战斗中会随移动变化 */
  cell: Cell;
  /** 当前血量（FIX） */
  hp: number;
  /** 血量上限（FIX），由「基础值 × 星级倍率」算出 */
  maxHp: number;
  /**
   * 不含临时加成的血量上限。
   *
   * 【为什么需要它？】
   * 维娜·维多利亚 3 星会给我方全体「生命值增加 1000%」，10 秒后要收回去。
   * 如果直接改 maxHp，技能到点时就不知道"原本是多少"了。
   * 所以把它存下来，maxHp 每次都由 baseMaxHp 重算（见 refreshMaxHp）。
   */
  baseMaxHp: number;
  /** 当前法力（0..MANA_MAX） */
  mana: number;
  /**
   * 这个棋子的法力怎么攒。
   * 你给的三种：攻击回复 / 受击回复 / 自动回复。
   * 注意是**只有这一种**来源 —— 攻击回复的棋子挨打不回蓝，
   * 这是为了让"谁先放技能"变得可预期（也是你明确要的规则）。
   */
  manaSource: ManaSource;
  /** 自动回复时每秒回多少法力 */
  manaPerSecond: number;
  /** 护甲（FIX 尺寸的数值，如 30 点护甲存 30000） */
  armor: number;
  /** 魔法抗性（同护甲） */
  magicResist: number;
  /** 攻击力（FIX） */
  attackDamage: number;
  /** 攻速原始值，1200 = 1.2 次/秒 */
  attackSpeed: number;
  /** 攻击距离（格）。度量方式和 moveStyle 绑定：四方向走 = 曼哈顿距离 */
  range: number;
  /**
   * 移动方式。不写就是 `orthogonal`（上下左右）。
   * 以后"改变移动方式"的技能改这个字段即可。
   */
  moveStyle?: MoveStyle;
  /**
   * 羁绊机制的运行时状态（开战时由 createBattle 挂上）。
   * 战斗循环只读它，不需要知道任何羁绊的名字。
   */
  trait?: UnitTraitRuntime;
  /**
   * 技能的运行时状态（限时增益 / 剩余免疫次数）。
   *
   * 【为什么和 trait 分开？】
   * trait 是「羁绊给的、开战时定好就不变的机制」；
   * 这里是「战斗中随时会增删的临时修正」。两者的生命周期完全不同，
   * 混在一起会让"技能到点了要不要清掉羁绊加成"这种问题变得含糊。
   */
  skill?: UnitSkillRuntime;
  /**
   * 这只棋子在**当前星级**下的被动修正。
   *
   * 【为什么要存一份，而不是每次去查 def？】
   * 因为"3 星专属技能会整个替换掉 1/2 星技能"这条规则。
   * 开战时解析一次、存在棋子上，之后战斗循环读到的就永远是"这个棋子
   * 这个星级真正该有的被动"，不用在每个读它的地方都重算一遍星级。
   */
  skillPassive?: SkillStats;
  /** 召唤物的主人 id（召唤物死亡不扣玩家血，也不参与结算统计） */
  summonOwnerId?: number;
  /** 召唤物的消失时间（tick）。到点了自动移除 —— 迷迭香的柱子"持续20秒" */
  expiresAtTick?: number;
  /**
   * ★ 0.2 MujicaAve：**特殊技能窗口**还剩下的时间（绝对 tick）。
   *
   * 消耗 fever 之后的那一场，带 fever 机制的棋子开局就被强行放一次技能，
   * 并且在这段窗口里"受到致命伤害不会死亡"（走 `cannotDie`，和魔王 3 星同一套）。
   * 窗口到点时**把技力条一次性回满**（用户的注意事项 3）。
   *
   * 【为什么用一个绝对 tick，而不是"再挂一条定时包"？】
   * 免死那段必须走 `cannotDie` 修正包（全仓库只有那一处判死亡豁免），
   * 而"结束回满技力"是个**一次性动作**，包被顶掉/棋子中途死了都不该漏跑。
   * 所以两件事拆开：免死靠包（时长一致），回蓝靠这个 tick 比对
   * （见 `tickFeverWindows`）。不写 = 这场没有特殊技能窗口。
   */
  feverSkillUntilTick?: number;
  /**
   * 陷阱（望放下的棋子）：敌人靠近就爆炸。
   * 单独一个字段而不是复用 statuses，是因为它带三个值，塞进
   * `Record<string, number>` 里会变成三个魔法字符串键，很难看出是一体的。
   *
   * ★ 0.2：`radius` 按**方形**（切比雪夫）算 —— `1` 就是"周围 8 格"。
   * 判定在 `tickTraps` 里走 `withinShape(..., 'square')`（别自己写距离函数，
   * 见那里的注释：曾经用 `cellDistance` + 四方向移动 ⇒ 斜角踩不到雷）。
   */
  trap?: { radius: number; power: number; damageType: DamageType };
  /**
   * 这个单位是"嘲讽"的：敌人优先打它（迷迭香的柱子 / 游击队盾卫）。
   * `tauntRadius` 不写 = 全场嘲讽；写了就只影响这个半径内的敌人
   * （盾卫的表里写的是"周围 3 格"）。
   */
  taunt?: boolean;
  tauntRadius?: number;
  /** 距离下次行动还有多少 tick，归零则行动 */
  nextActionTick: number;
  /** 距离可以再次移动还有多少 tick */
  moveCooldown: number;
  /**
   * ★ 连续几次"想走一步但走不动"了（0 = 上一次成功移动过）。
   *
   * 【为什么需要它？—— 它修的是"棋子卡在后面罚站"】
   * 现在的索敌规则是"打最近的敌人"。但"最近"不等于"走得到"：
   * 后排的近战可能被自己人堵住，最近的那个敌人**几何上**很近、
   * **路径上**却永远走不到。老逻辑会一直锁着它，于是这个棋子
   * 一次都不出手、也不挪窝 —— 玩家看到的就是"挂机"。
   *
   * 所以这里数一下"连续挪不动"的次数，超过阈值就换一个
   * **真的走得到**的敌人（见 movement.ts 的 selectReachableTarget）。
   */
  blockedTicks: number;
  /**
   * 上一次是从哪个格子走过来的（没移动过就是 null）。
   * 用来避免"这一步走回去、下一步再走回来"的来回摆动。
   */
  prevCell?: Cell | null;
  /** 当前锁定的目标单位 id，-1 表示没有 */
  targetId: number;
  /** 状态效果，例如 "stun" -> 剩余 tick 数 */
  statuses: Record<string, number>;
  /** 是否是召唤物（召唤物死亡不扣玩家血） */
  isSummon: boolean;
  /** 累计造成的伤害（FIX），用于结算统计 */
  damageDealt: number;
  /**
   * ★★ 0.2.2 剑士：这一枚棋子**从羁绊拿到的**攻击力 / 攻速加成（万分比）。
   *
   * 【为什么要单独记一份？】
   * 羁绊加成在 `createUnit` 里就被折进 `unit.attackDamage / attackSpeed` 了，
   * 之后完全看不出"其中有多少是羁绊给的"。
   * 而「瞬移后羁绊加成翻倍」只能翻**羁绊那部分**（不能连藏品/技能一起翻），
   * 所以创建时把这两个 bp 抄一份留在这里（没给的项是 0）。
   */
  traitBonusBp?: { attackDamageBp: number; attackSpeedBp: number };
  /** ★★ 0.2.2 剑士：羁绊加成已经翻过倍了吗（每场只翻一次，不叠加） */
  traitBonusDoubled?: boolean;
  /** 本场战斗是否已经死亡 */
  dead: boolean;
  /**
   * 二阶段「重生」（野怪专用，从 UnitDef.reborn 抄下来一份，战斗内核不再回头查表）。
   * 没有这个字段的棋子就是普通单位，死一次就没了。
   */
  reborn?: UnitDef['reborn'];
  /**
   * ★★ 0.3.2 阿米娅·炉芯终曲「无言的期盼」：**技能期间的周期性即死**。
   *
   * 【为什么挂在施法者身上，而不是给每个敌人挂个定时器？】
   * 因为它是"我每隔 2 秒抹掉一个**还活着**的敌人" —— 目标每次现挑，
   * 挂到具体某个人身上反而要处理"它死了怎么办"。
   * 推进点在 `tickSkill`（每 tick 对每个单位跑），和技能本体同一个生命周期。
   */
  executePlan?: { ticksLeft: number; intervalTicks: number; timer: number; count: number; fx?: string };
  /** 重生用掉了没有 —— 一场战斗只允许重生一次 */
  rebornUsed?: boolean;
  /**
   * ★ 0.0.3：当前处在第几阶段（野怪的多阶段形态）。
   *
   * 【为什么需要它？】
   * 杰斯顿 / 博卓卡斯替 / 奎隆 这些 Boss 的「一阶段 / 二阶段」技能与被动**不一样**，
   * 而且表里写明"不同时生效"—— 所以复活之后必须把一阶段那套**换掉**，
   * 不能像最早的 reborn 那样只是"再强化一层"。
   * 1 = 一阶段（默认），2 = 二阶段（复活后）。
   */
  phase?: number;
  /**
   * ★ 0.0.3：野怪的"倒地等待复活"—— 表里的「死亡后需要 3/5 秒复活
   * （复活期间不能攻击不能移动）」。
   *
   * 【为什么不用 dead = true？】
   * 因为它**没有真的死**：还要站起来，而且这一局它仍然算"在场"。
   * 一旦置 dead，格子会被释放、剩余人数会 -1、胜负可能当场判定 ——
   * 那就会变成"Boss 被打倒的一瞬间玩家直接赢了"，与设计不符。
   * 所以单独一个状态：占着格子、不能被选中、不行动，到点站起来。
   */
  downedUntilTick?: number;
  /**
   * ★ 0.1.3：**进入新阶段时待结算的一次性效果**（血骑士复活后召唤 6 只凝血之刃）。
   *
   * 【为什么要绕这一下？】`applyUnitPhase` 是纯函数式的"改数值"，
   * 拿不到 state / defs —— 而召唤必须要有它们。所以切阶段时先把效果**挂在这儿**，
   * 由战斗循环在下一个 tick 结算掉（见 rules.ts 的 step）。
   */
  phasePending?: SkillEffect[];
  /**
   * ★ 0.0.3：这个棋子的机制里"与阶段无关"的那一半（羁绊 + 藏品）。
   * 换阶段时用 `[...prePhaseMechanics, ...二阶段机制]` 重建，见 applyUnitPhase。
   */
  prePhaseMechanics?: ScopedMechanic[];
  /**
   * ★ 0.0.3：本阶段生效的技能（effects + 被动 + 法力回复）。
   * 不写就回退到数据表里那套 —— 只有多阶段野怪会在复活时换掉它。
   */
  phaseSkill?: {
    name: string;
    effects: SkillEffect[];
    passive?: SkillStats;
    manaSource: ManaSource;
    manaPerSecond: number;
  };
  /** ★ 0.0.3：开战那一刻的原始值快照 —— 换阶段时从它重算（见 applyUnitPhase） */
  phaseBase?: UnitPhaseBase;
}

/** ★ 0.0.3：多阶段野怪的"基础形态"快照（换阶段时用来复位） */
export interface UnitPhaseBase {
  range: number;
  attackDamage: number;
  attackSpeed: number;
  armor: number;
  magicResist: number;
  baseMaxHp: number;
  passive?: SkillStats;
  effects: SkillEffect[];
  skillName: string;
  manaSource: ManaSource;
  manaPerSecond: number;
}

// ============================================================
// 棋子数据表（你可以把这些理解成「策划表格」）
// ============================================================

/**
 * 挂在棋子身上的一个限时（或按次数）修正包。
 *
 * `ticksLeft` 用 MAX_BATTLE_TICKS 表示"本场战斗永久"（被动和永久叠层用）。
 * `attackCharges` 有值时改成按**攻击次数**消耗（"下面 6 次攻击…"）。
 */
export interface SkillBuff {
  stats: SkillStats;
  ticksLeft: number;
  attackCharges?: number;
  sourceId: number;
  /**
   * ★ 0.0.3 末：这包是**常驻被动**，不是哪次技能放出来的效果。
   *
   * 【为什么需要它？】
   * 穿戴藏品的属性包（createBattle 里"每件藏品挂一个永久修正包"）、
   * "开局全队免疫 N 次"、以及**藏品的开局效果**（奥数法阵的"开局 +10 魔抗 15 秒"）
   * 都是用 addBuff 承载的 —— 形状和技能 buff 一模一样，
   * 区别只有一个：它们不是技能。`isSkillActive`（技能生效中不攒蓝的那道闸）
   * 必须跳过它们，否则穿过藏品的棋子会长时间处于"技能生效中"，
   * 一点法力都回不上 —— 技能再也放不出来（用户报的 bug）。
   *
   * ★ 注意边界：**干员自己技能里**的开局效果（砾的入场护盾、
   * 玛恩纳的"开局立刻开启技能并持续 100 秒"）**不**打这个标记 ——
   * 那确实是在"技能生效中"，不该让它在持续期间攒蓝再放一次。
   */
  passive?: boolean;
  /**
   * ★ 0.1.4：这包是**技能效果**落下来的（而不是机制/藏品落下来的）。
   *
   * 【为什么要单独记？—— 「弹药」要认得出自己人】
   * 「接下来 N 次攻击 +X%」这类技能效果，从 0.1.4 起在卡面上统一显示成**弹药**。
   * 但**同样形状**的包还有两个来源：藏品的 `everyNthAttack`（"每 3 击强化下一击"）
   * 和野怪的周期性强化 —— 它们也写成 `attackCharges`，光看修正包分不出来。
   * 而"弹药"这个词只适合技能：藏品/野怪的蓄力叫弹药会让人误会。
   * 所以由**技能这一侧**显式打标记（见 `skills.ts` 的 `case 'buff'`），
   * 界面只认这个标记（`liveBuffEffects`）。
   */
  fromSkill?: true;
  /**
   * ★ 0.2 新约能天使 3 星：打一次消耗几发弹药（默认 1）。
   * "攻击变成五连击并消耗五发弹药" ⇒ 5。
   */
  chargesPerAttack?: number;
}

/** 技能的运行时状态 */
export interface UnitSkillRuntime {
  /** 当前生效的所有修正包。每次攻击/被攻击都会重新合并一遍 */
  buffs: SkillBuff[];
  /** 还要免疫几次攻击（机械师） */
  immuneHits: number;
  /** 周期性脉冲的计时器（tick）。换了一次脉冲来源就会归零 */
  pulseTimer: number;
  /**
   * ★★ 0.2 可露希尔 Q.E.D：这一轮脉冲已经**跳过几次**（全局跳数，用来判"9 次之后换倍率"）。
   * 新一包带脉冲的增益挂上来时归零（见 `mods.ts` 的 `addBuff`）。
   */
  pulseHits: number;
  /** ★★ 0.2：已经被这份脉冲减益打过的目标 id（"单个目标仅生效一次"） */
  pulseDebuffed: number[];
  /** 挂在身上的持续伤害 / 持续治疗 */
  timed: TimedEffect[];
  /** 耀骑士那种"每场最多生效 N 次"的已用次数 */
  guardUses: number;
  /** 技能自己的攻击计数器（可露希尔"每2次攻击"、伊内斯"每次攻击"） */
  attackCount: number;
  /** 用来判断"修正包变过了"，变了就重置脉冲计时 */
  version: number;
  /** 自动回蓝的余数（每秒要回 N 点，但 tick 比秒细，所以要攒余数） */
  manaAccum: number;
  /**
   * ★★ 0.2 机械师：「破盾子弹」。
   *
   * 【为什么要存在棋子上，而不是挂在 shield 状态里？】
   * 因为「子弹」和「当前这层盾」不是一回事：盾被打空 → 消耗一颗 → **再补一层新盾**。
   * 如果把配方写在 `statuses` 里，补盾那一刻就得先把旧配方读出来再删掉，很别扭；
   * 而 `statuses` 只放得下数字，配方里还有 basis/shape 这种非数字字段。
   * 所以：状态放在 statuses，**配方**放在这里。盾还在不在都不影响它。
   */
  shieldBullets?: { left: number; grant: ShieldGrant };
  /**
   * ★★ 0.2 蕾缪安 3 星「强制追思」：**先停攻 7 秒、每秒锁定一名敌人的地块，
   * 7 秒后把 7 颗弹药一次性全部打在那些地块上**（每颗打 3×3）。
   *
   * 【为什么地块要"每秒现锁"而不是开局一次算完？】
   * 因为敌人会走。表里写的是"期间每秒锁定一名目标地块" ——
   * 锁的是**那一刻**它站在哪，之后它跑了也没用。
   * 开局一次算完就等于"7 秒后打每个人 7 秒前的位置"，站桩和走位没区别了。
   */
  lockOn?: LockOnPlan;
  /**
   * ★★ 0.2 新约能天使：「**技能结束时，友方减益恢复，所给予的剩余护盾消失**」。
   *
   * 【为什么不给友方那份 buff/护盾写个固定秒数？】
   * 因为她的技能**没有秒数** —— 时长由 30 发弹药打完决定。
   * 想在放技能那一刻就知道"还有多久结束"是算不出来的，
   * 只能反过来：技能结束时**由施法者主动去收**。
   *
   * `armed`：必须先确认"自己身上确实挂过技能包"再开始判结束。
   * 不设这一位的话，一个只有"给队友上盾"、自己没有技能包的技能
   * 会在放完的下一 tick 就立刻把刚给的盾收走。
   */
  skillAttachments?: { unitIds: number[]; armed: boolean };
}

/** ★★ 0.2：蕾缪安 3 星的"锁定—引爆"计划（数值在放技能那一刻按星级定死）。 */
export interface LockOnPlan {
  /** 还剩几颗弹药（= 还要锁几个地块） */
  locksLeft: number;
  /** 下一个地块的锁定时刻 */
  nextLockTick: number;
  /** 锁定间隔（tick） */
  intervalTicks: number;
  /** 已经锁过的目标 id（表里："每个目标只会锁定一次"） */
  lockedIds: number[];
  /** 锁定的地块（按锁定先后） */
  cells: Cell[];
  /** 一起引爆的时刻 */
  blastAtTick: number;
  radius: number;
  shape: SplashShape;
  /** 每颗弹药的倍率（千分比 × 施法者攻击力） */
  power: number;
  damageType: DamageType;
  /**
   * ★ 0.2.2：锁定/引爆那两套演出的样式 id（纯表现，见 `SkillEffect.lockOn.fx`）。
   * 存进计划里是因为引爆发生在 7 秒后 —— 那时候已经拿不到当初那条 effect 了。
   */
  fx?: string;
}

/**
 * ★★ 0.2：一层护盾的「配方」。数值都已经按**施法者星级**解析成整数。
 *
 * 把它单独抽出来，是为了让"第一次上盾"和"破盾后补盾"走**同一份**数值 ——
 * 表里两处的比例是一样的（机械师 10%/15%/20%），分成两份写迟早会飘。
 */
export interface ShieldGrant {
  basis: 'maxHp' | 'missingHp' | 'flat';
  /** basis='flat' 时是「点 × FIX」，否则是千分比 */
  power: number;
  durationTicks: number;
  /** 每秒掉的量（按「获得总量」的万分比）—— 0 = 不衰减，靠 durationTicks 到期 */
  decayBpPerSecond: number;
  /** 护盾存在期间不许回技力 */
  noMana: boolean;
  /** 破盾时对自身周围的伤害（机械师） */
  blast: ResolvedBlast | null;
}

/** ★★ 0.2：破盾爆炸的配方（数值已按星级解析）。 */
export interface ResolvedBlast {
  radius: number;
  shape: SplashShape;
  power: number;
  /** 'attack' = 千分比 × 施法者攻击力；'maxHp' = 千分比 × 施法者生命上限 */
  basis: 'attack' | 'maxHp';
  damageType: DamageType;
}

/**
 * 持续伤害 / 持续治疗。
 *
 * 【为什么把施法者当时的数值快照下来？】
 * 因为"每秒受到截云 20% 攻击力"里的 20% 攻击力，指的是**施法那一刻**的攻击力。
 * 如果之后施法者被加了 buff 或者死了，这个 DoT 的每跳伤害不该跟着变 ——
 * 否则"先手放 DoT 再自杀"这种操作会变得莫名其妙。
 */
export interface TimedEffect {
  kind: 'dot' | 'hot';
  sourceId: number;
  /** 每跳的数值（FIX） */
  amount: number;
  damageType: DamageType;
  intervalTicks: number;
  ticksLeft: number;
  timer: number;
  /**
   * ★ 0.1.3：**范围**持续伤害（锏的"2 秒内每 0.2 秒斩一次"）。
   *
   * 写了 radius 之后，每跳不再只打宿主，而是以**宿主当前的位置**为中心
   * 打一圈敌人 —— 所以它走到哪刀就斩到哪。
   * 不写 = 老行为（只打宿主自己）。
   */
  radius?: number;
  shape?: SplashShape;
  /** ★ 0.1.3：每跳命中后给对方挂的负面包（锏的"被打的敌人战栗 4 秒"） */
  debuff?: { stats: SkillStats; durationTicks: number };
  /**
   * ★ 0.2：持续效果的**标记**，用来认人。
   *   · `'burn'`（炎国羁绊的燃烧）—— 要能"数层数（最多 5 层）"和"重新附着时刷新时长"；
   *   · `'rift'`（截云的裂痕）—— 要能"**不叠加**、上一份结束了才能再附着"。
   * 不写 = 普通 dot/hot，互不影响。
   */
  tag?: 'burn' | 'rift';
}

/**
 * 星级数值。
 *
 * 【为什么需要它？】
 * 你表格里的技能大多是「50%/100%/130%」这种**三个数**写法 ——
 * 那就是 1 星 / 2 星 / 3 星 的三个数值。
 * 所以技能的每个数值都可以写成一个数（三星通用）或三个数（分星级）。
 *
 * 例：`power: [500, 1000, 1300]` = 1星 50%、2星 100%、3星 130%。
 * 只写两个数时，第三个沿用第二个（表格里有些技能只填了 1/2 星）。
 */
export type StarValue = number | readonly number[];

/** 技能的法力回复方式（你给的三种） */
export type ManaSource =
  /** 攻击回复：每次普通攻击命中回法力 */
  | 'attack'
  /** 受击回复：每次受到伤害回法力 */
  | 'damage'
  /** 自动回复：按时间回法力（用 manaPerSecond 控制快慢） */
  | 'auto'
  /**
   * ★ 0.2：**不回法力**。表格「法力回复」列写「无」的那些用它。
   *
   * 【为什么不是"随便填一个但反正不放技能"？】
   * 因为三种既有来源各自有真实的副作用：攻击回复会跟着出手节奏涨、
   * 受击回复会跟着挨打涨、自动回复是按时间涨。填错任何一个，
   * 棋子都会"莫名其妙在充能"，详情页的"下次技能还差多久"也会跟着错。
   * 显式写 `'none'` 才能让界面和内核都说得出"这人不攒蓝"。
   */
  | 'none';

/** 溅射范围形状 */
export type SplashShape =
  /** 方形：半径 1 = 3×3、半径 2 = 5×5（"周围8格""3*3""5*5"） */
  | 'square'
  /** 十字：半径 1 = 上下左右 4 格（"周围4格"） */
  | 'cross'
  /** 直线：从自己朝目标方向推出去的一条线（陈"对前方 3 格所有敌人"） */
  | 'line'
  /**
   * ★ 0.3.2：**矩形**（阿米娅·慈悲愿景"前方 3 格且往旁边延伸一格"）。
   *
   * 量法是「宽 3 格 × 深 `radius` 格」，从施法者自己那一格开始、朝**目标方向**铺出去，
   * 横向按该方向旋转（打右方就是 3 行高，打上方就是 3 列宽）。
   * ★ 和 `line` 的区别：那个只有 1 格宽；和 `square` 的区别：那个以目标为中心。
   */
  | 'rect'
  /**
   * ★ 0.1.3：**星形** = 3×3 方块 **并上** 上下左右各 2 格的十字。
   * 锏的「对周围 8 格加前后左右 2 格处」就是它。
   *
   * 【为什么不拆成两次 square(1) + cross(2) 叠着打？】
   * 因为那样距离 1 的那 4 格会被打**两遍** —— 玩家数一下就知道次数和描述对不上。
   */
  | 'star';

/**
 * 「一次治疗回多少」的一条基准。
 *
 * ★ 0.2 新增：治疗量可以是**多条基准相加**（写成数组）——
 *   芙蓉「自身攻击力 110/120/125% **+** 目标生命上限 3%/6%/10%」、
 *   夜莺「目标生命上限 1%/3%/5% **+** 自身攻击力 50%/70%/100%」。
 *   ★ 计算只有一处实现：`skills.ts` 的 `pulseBasisAmount()`，谁也别自己再算一遍。
 */
export interface HealSpec {
  /**
   * attack = 施法者攻击力；casterMaxHp = 施法者生命上限；targetMaxHp = 目标生命上限。
   *
   * ★ 0.2 赤刃明霄陈：`missingHp` = 目标**已损失**生命（"缓慢恢复已损失生命值 15%/30%"）。
   * 折算本身在 `mods.ts` 的 `basisAmount()` 里，那里早就有这一档了 ——
   * 这里只是把类型打开，不再另写一个只认 missingHp 的旁路。
   */
  basis: 'attack' | 'casterMaxHp' | 'targetMaxHp' | 'missingHp';
  /** 万分比。三条 1/2/3 星 */
  ratioBp: StarValue;
}

/**
 * 一个「属性 / 攻击修正包」。
 *
 * 【为什么被动和限时增益共用一个结构？】
 * 因为「被动：攻击范围 +3，平A倍率 +300%」和「技能开启后攻击范围 +3」
 * 对战斗循环来说完全是一回事，只是持续时间不同（永久 vs 若干秒）。
 * 共用一个结构之后，performAttack 里只需要读一份「当前生效的修正」，
 * 不用写两条路径。
 */
export interface SkillStats {
  /** 攻击力加成（万分比） */
  attackDamageBp?: StarValue;
  /** 攻速加成（万分比）。可以是负数（远牙"攻击速度减30%"） */
  attackSpeedBp?: StarValue;
  /** 护甲（绝对值） */
  armorFlat?: StarValue;
  /** 魔抗（绝对值） */
  magicResistFlat?: StarValue;
  /** 血量上限（绝对值，单位是游戏里的"点"，玛恩纳"生命值提升1000"） */
  hpFlat?: StarValue;
  /**
   * 血量上限（万分比，限时）。
   * 例：维娜·维多利亚 3 星"我方所有干员生命值增加 1000%"。
   * 到期后 maxHp 会降回去，当前血量跟着夹住 —— 所以在 UnitState 上
   * 另存了一个 baseMaxHp，maxHp 每次都由它重算。
   */
  hpBp?: StarValue;
  /** 攻击距离（格） */
  rangeFlat?: StarValue;
  /** 攻击距离变成"全场"（澄闪/蕾缪安 3 星）。优先级高于 rangeFlat */
  rangeUnlimited?: boolean;
  /** 一次移动可以走几格（隐德来希 3 星"每次移动格数增加3格"） */
  moveStepFlat?: StarValue;
  /** 吸血（造成伤害的万分比） */
  lifestealBp?: StarValue;
  /**
   * ★★ 0.3 「近卫」：攻击**射程 ≥ minRange** 的干员时，这一击的伤害**提升到** `totalBp`。
   * 万分比：`12000` = 提升到 120%（也就是 +20%）。
   * ★ 为什么用"提升到"而不是"附加"？因为数据表里写的就是
   * 「伤害提升至 120%/130%/150%」—— 内核里换算成 `(BP + (totalBp - BP))`。
   */
  rangeAmp?: { minRange: StarValue; totalBp: StarValue };
  /**
   * 攻击附带的额外伤害（萨卡兹那种"附带已造成伤害的 X%"、
   * 法术那种"附带目标最大生命的 X%"、蕾缪安那种"已损失生命的 X%"）
   */
  /**
   * 攻击附带一段额外伤害。`source` = 按什么算这一段的强度：
   *   · `dealt`     —— 这一击实际打出的伤害
   *   · `maxHp`     —— 目标最大生命
   *   · `missingHp` —— 目标已损失生命
   *   · ★ 0.2 `attack` —— **自身攻击力**（予愿安洁莉娜"额外造成相当于自身攻击力 25% 的法术伤害"）
   */
  bonusDamage?: { source: 'dealt' | 'maxHp' | 'missingHp' | 'attack'; ratioBp: StarValue; damageType: DamageType };
  /** 攻击变成范围伤害（空爆/夕/天火/维什戴尔…） */
  splash?: {
    radius: number;
    shape?: SplashShape;
    ratioBp: StarValue;
    damageType: DamageType;
    /**
     * ★ 0.0.3 彩蛋：范围打**几段**（默认 1 = 老行为）。
     * 例：维维美「对周围 8 格造成 2 次攻击力 50% 的连击」-> hits: 2。
     */
    hits?: StarValue;
    /**
     * ★ 0.0.3 彩蛋：伤害的**基准**（默认 'dealt' = 老行为）。
     *   · 'dealt'  —— 以"这次攻击打出的总伤害"为基数（连击 3 段就是 3 倍的量）
     *   · 'attack' —— 以**攻击力**为基数（和连击段数无关，写 50% 就是 50%）
     *
     * 【为什么需要它？】彩蛋被动是"3 连击 100% + 周围 8 格 2 次 50%"，
     * 那个 50% 说的是**攻击力**的 50%，不是"总伤害"的 50%。
     * 用 'dealt' 的话，3 连击会让范围伤害变成 150% 攻击力 —— 直接翻三倍。
     */
    basis?: 'dealt' | 'attack';
    /**
     * ★ 0.2：这一发范围伤害该播**哪一套特效**（表现层标记）。
     *
     * 【为什么写在数据里，而不是让渲染层按干员 id 判断？】
     * 因为"这个溅射是不是维什戴尔的 5×5 大招"这件事，数据表里已经有一份权威说法了；
     * 渲染层再按 `defId === 'op45' && star === 3` 写一遍，就是第二处真相 ——
     * 以后改了星级、换了技能，特效会继续播（或者该播的不播）。
     * 写在这里还有一个好处：同一个 `fx` 可以被多个干员共用，也能一个干员配多段特效。
     *
     * ★ 取值是**渲染层的注册表键**（见 `apps/web/src/three/vishdal-bloom.ts` 的
     *   `BLOOM_FX`）。不写 = 只闪一下范围白框（老行为），不播专属特效。
     */
    fx?: string;
  };
  /** 一次攻击额外攻击 N 个敌人 */
  extraTargets?: StarValue;
  /** 一次攻击打出 N 次伤害（维什戴尔"攻击造成3次伤害"、风笛"3次连续攻击"） */
  multiHit?: StarValue;
  /**
   * ★ 0.1.3：连击**每一段**的伤害比例（万分比，9000 = 90%）。
   * 不写 = 每段都是满额（100%，老行为）。
   * 锏的被动「普通攻击造成 2 次攻击力 90% 的连击」= `multiHit: 2` + 这里写 9000。
   */
  multiHitBp?: StarValue;
  /**
   * ★ 0.1.3：**战栗** —— 期间不能进行**普通攻击**，移动 / 放技能都不受限制。
   *
   * 【和 `noAttack` 有什么区别？】
   * `noAttack` 是"这个棋子根本打不出伤害"（夜莺），连走位都跳过 —— 走过去没意义。
   * 战栗是"手被按住"：人照样走位、照样攒蓝放技能，只是普攻那一下出不来。
   */
  disarmed?: boolean;
  /**
   * ★ 0.1.3：攻击命中时给目标挂**战栗**（锏的被动：10% 概率，连击单独判定）。
   * 形状和 `stunOnHit` 完全一样，只是挂上去的东西不同。
   */
  disarmOnHit?: { chanceBp: StarValue; durationTicks: StarValue; perHit?: boolean };
  /**
   * ★ 0.2：每次攻击给**目标**挂一份减益（伊内丝的「每次都削目标攻速」）。
   * 和 `disarmOnHit` / `stunOnHit` 同构，区别是它挂的是**任意属性**。
   *
   * ★★ 星级按**施法者**解析：`collectMods` 在收集时就把 `stats` 里的星级数值定死成数字，
   * 而不是留给 `addBuff` 之后按**目标**星级解析 —— 否则 1 星伊内丝打 3 星敌人，
   * 削的攻速会按敌人自己的星级算，莫名其妙翻几倍。
   */
  debuffOnHit?: { chanceBp?: StarValue; stats: SkillStats; durationTicks: StarValue };
  /** 把普通攻击的伤害类型改成这个（拉普兰德"攻击变为法术攻击"、凯尔希 3 星真实伤害） */
  damageTypeOverride?: DamageType;
  /**
   * ★★ 0.2：把**普通攻击**整个换成"自定义弹道"（丰川祥子的音符 / 祐天寺若麦的五连击）。
   *
   * 【为什么不能只用 `multiHit` + `multiHitBp`？】
   * 那两个只能表达"每段倍率都一样"。而这两位是：
   *   · 若麦：前 4 段 5%/10%/15%、第 5 段 100%/105%/110%；
   *   · 祥子：一个音符物理、一个音符法术（**每段的伤害类型都不一样**）。
   * 所以需要一条"每段各自带倍率和类型"的结构。
   *
   * 【和限时增益怎么配合？】
   * `collectMods` 对它是**后者覆盖前者**（后挂的 buff 赢）——
   * 于是祥子的 3 星技能可以直接用一份限时 buff 把她的被动（穿透音符）换成
   * "两发单体音符"，不需要给技能加任何特判。
   */
  attackProfile?: AttackProfile;
  /** 攻击距离自身超过 minDistance 格的敌人时，附加伤害（予愿安洁莉娜） */
  farBonus?: { minDistance: number; ratioBp: StarValue; damageType: DamageType };
  /** 攻击命中时的控制（梅/澄闪的眩晕概率、天火/惊蛰的必晕） */
  stunOnHit?: {
    chanceBp: StarValue;
    durationTicks: StarValue;
    /**
     * ★ 0.0.3 彩蛋：**每一段连击各判定一次**（默认 false = 整次攻击只判定一次）。
     * 维维美写的是「30%（连击单独计算）概率眩晕」，3 连击就是 3 次独立掷骰 ——
     * 至少中一次的概率约 65.7%，而不是 30%。
     */
    perHit?: boolean;
  };
  /**
   * 普通攻击改成治疗队友（芙蓉"攻击改为治疗血量最低的队友 10% 生命值"）。
   * basis: 治多少 —— 按目标最大生命比例，还是按施法者攻击力比例。
   *
   * ★ 0.2：允许写**多条**（数组），治疗量 = 各条相加。
   *   芙蓉的新口径是「自身攻击力 110/120/125% **加上** 目标生命上限 3%/6%/10%」——
   *   两个基准相加，单条表达不了。夜莺的 `pulse.heal` 同理。
   */
  attackHeals?: HealSpec | readonly HealSpec[];
  /** 对某个标签的敌人增伤 / 减伤（熔泉"对非萨卡兹敌人伤害增加"） */
  vsTraitDamageBp?: { trait: string; exclude?: boolean; ratioBp: StarValue };
  /** 不进行普通攻击（夜莺；玛恩纳"没有技能时不进行主动移动和攻击"） */
  noAttack?: boolean;
  /** 不主动移动（玛恩纳、魔王） */
  noMove?: boolean;
  /**
   * ★★ 0.2 赤刃明霄陈：「**技能持续期间不再获得技力**」。
   *
   * 【和左乐的 `noManaWhileActive` 有什么区别？】
   * 那个挂在**护盾**上（盾在就不回蓝，盾没时长）；
   * 这个挂在**任意修正包**上（包在就不回蓝），所以时长由那份包自己决定。
   * 判据都在 `combat-math.ts` 的 `gainMana()` 这一个入口上，
   * 攻击 / 受击 / 自动回复三条路一起拦，不会出现"受击回了、攻击没回"。
   */
  noManaGain?: boolean;
  /**
   * ★★ 0.2 蕾缪安：「攻速恒定」—— 面板攻速不再被任何加成改变。
   * 那些加成不会白丢，见 `attackSpeedToAttackRatioBp`。
   */
  attackSpeedLocked?: boolean;
  /**
   * ★★ 0.2 蕾缪安：「每额外获得 1% 的攻速转化为 X 的攻击力」。
   * 万分比含义：`1000` ⇒ 100% 攻速 → 10% 攻击力（表里的 1% → 0.1%）。
   * 只折算**额外获得**的那部分（负数既不加成也不倒扣）。
   */
  attackSpeedToAttackRatioBp?: StarValue;
  /**
   * ★★ 0.3.2：**技力获取倍率**（万分比，`-9900` = 只剩 1%）。
   * 终曲「技能回复速度降低 99%」。判据在 `gainMana()` 那一个入口上（和 noManaGain 同一处）。
   */
  manaGainBp?: StarValue;
  /**
   * ★★ 0.3.2：**每次普通攻击**顺带给队友治疗（阿米娅·慈悲愿景的被动）。
   *
   * 【和 `attackHeals` 的区别】那个是"攻击**改成**治疗"（芙蓉：不打人、只奶人）；
   * 这个是"照常打，同时奶一口"。两件事，不能共用一个字段。
   */
  healOnAttack?: HealSpec;
  /**
   * ★★ 0.2 可露希尔：「我方全体友方防御力 +15%/+30%，攻击力 +10%/+15%，
   * 技能持续 10s；（**此数值每有 10 金币额外增加 1%，最高上限 5%**）」。
   *
   * 把"按金币换来的那一份百分比"加到这份属性包里**所有万分比字段**上 ——
   * 表里的"此数值"指的是整份加成（防御力和攻击力一起涨），不是只给攻击力。
   * 金币取自 `BattleState.playerGold`（开局由 `TeamSetup.playerContext` 灌进来）。
   *
   * 【为什么只加 `*Bp` 字段？】`armorFlat`/`hpFlat` 那种是**点数**，
   * 给它们加"1% 的指点数"没有意义（会变成每 10 金币 +1 点护甲）。
   */
  goldBonusBp?: { perGold: number; bpPerStep: number; maxBp: number };
  /** 闪避概率（焰尾"75%闪避伤害"） */
  evasionBp?: StarValue;
  /** 反弹受到伤害的比例，capAttackBp = 上限为自身攻击力的倍数（星熊） */
  reflect?: { ratioBp: StarValue; capAttackBp?: number };
  /**
   * 隐匿（原「隐秘」）：不会被普攻锁敌、也不会被走向，**但仍会被范围技能打到**。
   * 完整口径见 `movement.ts` 的 `canTargetUnit`；判据唯一实现在 `isUntargetable`。
   */
  untargetable?: boolean;
  /** 技能期间不会死亡（魔王 3 星） */
  cannotDie?: boolean;
  /** 优先攻击血量最低的敌人（远牙/蕾缪安） */
  preferLowestHp?: boolean;
  /**
   * ★ 0.2：**我活着的时候，给我的主人挂一份状态**（维什戴尔"魂灵之影在场时，自身获得隐匿"）。
   *
   * 写在**召唤物自己**的 `skill.passive` 上，由 `tickSkill` 每 tick 给主人续一份短时长被动包 ——
   * 召唤物一死就不再续，主人身上那份最多几 tick 后自然失效，**不需要手动摘**。
   * ★ 为什么不写在主人的 buff 上？因为"召唤物死了要摘掉"这件事没有回调点，
   * 续时长的做法是这里唯一不用新增死亡钩子的写法。
   */
  ownerAura?: { stats: SkillStats };
  /**
   * ★ 0.2：**每次攻击都随机挑一个射程内的敌人**（维什戴尔"每次攻击都随机攻击攻击范围内的敌人"）。
   *
   * 和 `preferLowestHp`（优先打残血）的区别：那个仍然**锁定一个人**打，
   * 这个是每一下都重新掷骰换人 —— 所以它改的是"这一击打谁"，不是"索敌偏好"。
   * 随机只用 `state.rng`，确定性不受影响。
   */
  randomAttackTarget?: boolean;
  /**
   * ★★ 0.2：**低存在感**（八幡海铃的被动）。
   *
   * 语义：敌人索敌时，**如果射程内还有别的可选目标，就先打别人** ——
   * 也就是"只有当它是唯一目标时才被优先考虑"。
   * 判据只写在 `movement.ts` 的 `selectTarget`（索敌的唯一实现）里。
   */
  lowPresence?: boolean;
  /**
   * ★★ 0.2：一次性的锁血被动（若叶睦）。见 `DefyDeathSpec`。
   * 写在 `skill.passive` 上 = 入场就带着；用完记在 `statuses['defyDeathUsed']`，不再刷新。
   */
  defyDeath?: DefyDeathSpec;
  /**
   * ★ 0.2：这份属性**只在星级 ≥ `minStar` 时生效**（予愿安洁莉娜"三星时获得隐匿"）。
   *
   * 【为什么需要它？】表里有的技能写着"三星时**额外**获得 X"，但技能名/介绍那一列是"（无）"——
   * 也就是**不该**单独写一套 3 星技能（那会让界面显示出一个不存在的 3 星技能名），
   * 而 1/2 星又不该白拿。给那份包挂个门槛是最省事、也最不容易被误解的写法。
   * 判据在 `mods.ts` 的 `mergeStats` **最前面**：不满足就整份跳过。
   */
  minStar?: number;
  /** 免疫接下来的 N 次攻击（机械师） */
  immuneHits?: StarValue;
  /**
   * 周期性"脉冲"：每 N tick 对周围一圈做一件事。
   *
   * 这一个结构覆盖了三种设计：
   *   · 夜莺「不会攻击，每秒回复范围内友军 5% 生命值」（治疗脉冲）
   *   · 魔王「范围内我方每秒回血 + 加攻击力」（治疗 + 增益脉冲）
   *   · 隐德来希「每 0.5 秒对周围 8 格敌人造成 70% 攻击力的法术伤害」（伤害脉冲）
   *
   * 挂在被动上就是"一直存在"，挂在限时增益上就是"技能期间才有"。
   */
  pulse?: PulseSpec;
  /** 每次攻击后给队友上增益（可露希尔"每2次攻击使随机1名干员…"） */
  onAttackAllyBuff?: {
    every: number;
    target: TargetRule;
    stats?: SkillStats;
    /**
     * ★ 0.2：basis 的口径与 `HealSpec` 统一（以前这里叫 'casterAttack'，
     *   是同一个东西的两个名字），并且支持多条相加。
     */
    heal?: HealSpec | readonly HealSpec[];
    durationTicks: number;
  };
  /** 血量最低的队友掉到阈值时触发一次救援（耀骑士临光） */
  allyLowHpGuard?: {
    thresholdBp: number;
    shieldBasisCasterMaxHp: StarValue;
    selfAttackBp: StarValue;
    selfBuffTicks: number;
    maxUses: StarValue;
  };
  /** 有敌人进入半径内时临时加攻击力（号角"当有敌人进入周围8格时，攻击力增加20%"） */
  nearbyEnemyAttackBp?: { radius: number; ratioBp: StarValue };
  /**
   * 玩家每有 10 金币加攻击力（老鲤）。这个是**开局按金币折算成固定加成**的，见 synergies.ts
   *
   * ★ 0.2：`maxGold` = **折算用的金币上限**（可选）。
   *   策划表 R111 的散文列写了「当金币达到 100 时达到最大值」，但结构化列没写 ——
   *   用户拍板**要这个封顶**（不加的话屯金到 200+ 就是 +600% 攻击力，失控）。
   *   放在数据里而不是写死在 `goldScalingAttackBpOf` 里：这是**这一条被动**的
   *   设计参数，不是"金币成长"这条机制的固有规则（别的棋子要用同一机制时，
   *   该不该封顶、封多少，是各自的数据问题）。
   */
  goldScalingAttackBp?: { perGold: number; ratioBp: StarValue; maxGold?: number };
  /**
   * ★ 0.2：**按场上某个羁绊/职业的人数**加攻击距离（空弦"每上场 2 名阵营为[远射]的干员，攻击距离 +2 格"）。
   *
   * 【为什么和老鲤那条一样要在开局烘死？】
   * 因为"场上有几个远射"是**队伍级**信息 —— `collectMods` 只看得到单个棋子。
   * 折算出来是一个固定的 `rangeFlat`，挂成常驻修正包，走既有链路。
   *
   * 步数 = `floor(人数 / per)`，距离 = 步数 × 该星级的 `rangeFlat`。
   * 人数据 `UnitDef.traits` 里有没有这个 trait 来数（**含自己**）。
   */
  allyTraitRangeFlat?: { trait: string; per: number; rangeFlat: StarValue };
  /** 带次数的增益在"这一击击杀目标"时刷新次数（赤刃明霄陈 3 星） */
  onKillRefresh?: boolean;
  /**
   * ★ 0.2：普通攻击命中时给目标附一份**持续伤害**（截云的「裂痕」）。
   *
   * 【和 `debuffOnHit` 的区别】那条挂的是负面包（可叠加/可刷新）；
   * 这条是 dot，而且口径是「**不叠加**、上一份结束了才能再附着」——
   * 所以挂之前要先看目标身上有没有我这条（靠 `TimedEffect.tag: 'rift'` 认）。
   */
  onHitDot?: { power: StarValue; damageType: DamageType; durationTicks: StarValue; intervalTicks?: number };
  /**
   * ★ 0.2：技能持续期间**每击杀 1 名目标，这一包额外延长这么多 tick**（洛洛"额外增加 1s"）。
   * 值就是 tick 数（1 秒 = 20）。
   */
  onKillExtendTicks?: number;
  /**
   * ★ 0.2：这一包**过期时**结算一次伤害（洛洛"技能结束后对目标造成一次相当于攻击力的 X% 法术伤害"）。
   *
   * 【为什么写在修正包上、而不是新加一个"技能结束"钩子？】
   * 因为"技能结束"就是"这一包到期回收"，而回收点全仓库只有一个
   * （`tickSkill` 里的倒计时循环）。在那里顺手结算，就不用额外处理
   * "棋子中途死了""包被顶掉"这些边角。
   * 打谁：**当前锁定的目标**（`unit.targetId`）。
   */
  onExpireDamage?: { power: StarValue; damageType: DamageType };
  // ============================================================
  //  ★ 0.0.3 野怪技能新增
  // ============================================================
  /**
   * 攻击时**无视目标这么多比例的护甲**（万分比）。
   * 双持剑士「攻击无视对方 10% 物抗」→ 1000。
   * 只影响这一次攻击的护甲减免计算，不改目标面板。
   */
  /**
   * ★ 0.2：**每第 N 次攻击**额外结算一次伤害（克洛丝 / 芳汀的"每第三次攻击"）。
   *
   * `source: 'attack'` = 按**攻击力**算（"额外造成相当于攻击力 105% 的伤害"）；
   * `source: 'dealt'`  = 按这一击**实际打出的伤害**算。
   *
   * 【为什么它和 `extraTargets` 是两件事？】
   * `extraTargets` 是"同一次攻击多打几个人"；这个是"多打**一下**"。
   * 芳汀两者都要（"额外攻击一个目标 + 额外造成一次法术伤害"），所以分开写。
   */
  everyNthAttack?: {
    every: number;
    /**
     * 额外结算的那一段伤害。★ 0.2 起**可以不写** ——
     * 可露希尔的被动只有"多打一个人"，没有多打一段伤害。
     */
    bonusDamage?: { source: 'attack' | 'dealt'; ratioBp: StarValue; damageType: DamageType };
    /**
     * ★★ 0.2 可露希尔：「每 2 次攻击**额外攻击 1 名目标**」。
     *
     * 【为什么和 `extraTargets`（一直被动的那个字段）分开？】
     * `extraTargets` 是**每一次**攻击都多打 N 个；这个是"每第 N 次攻击"那一击才多打。
     * 判据和 `bonusDamage` 共用一处（`rules.ts` 的 `isEveryNthAttackHit`）。
     */
    extraTargets?: number;
  };
  armorPenBp?: StarValue;
  /**
   * 护甲 / 魔抗的**百分比**修正（万分比，可以是负数 = 破甲）。
   * 例：奎隆「全部敌方单位物抗降 50%」→ magicResistBp: -5000。
   * 注意它和 armorFlat 的区别：armorFlat 是绝对值，这个是乘算百分比。
   */
  armorBp?: StarValue;
  magicResistBp?: StarValue;
  /**
   * 受到的伤害**提升**这么多（万分比）。
   * 例：博卓卡斯替二阶段「受到的伤害提升 50%」→ 5000。
   * 与 damageReductionBp 方向相反，二者相加后由 dealDamage 统一应用。
   */
  damageTakenBp?: StarValue;
  /**
   * 无敌：期间受到的任何伤害都变成 0（但**还可以被选中**）。
   * 例：“复仇者”二阶段「复活后无敌 8 秒」。
   */
  invulnerable?: boolean;
  // ============================================================
  //  ★ 0.1.1 藏品新增
  // ============================================================
  /**
   * **只对物理伤害**生效的闪避（万分比）。
   * 例：设计师量尺「装备者获得 15% 物理闪避」→ 1500。
   *
   * 【和 evasionBp 的分工】`evasionBp` 是"通用闪避"（物理法术都躲），
   * 它们是**相加后各自判定**的：一次物理攻击要躲过 evasionBp + evasionPhysicalBp，
   * 一次法术攻击要躲过 evasionBp + evasionMagicBp。见 combat-math.ts 的第 0 步。
   */
  evasionPhysicalBp?: StarValue;
  /** **只对法术伤害**生效的闪避（万分比）。法术杀手「15% 法术闪避」→ 1500 */
  evasionMagicBp?: StarValue;
  /**
   * 开局法力条直接给到"最大值"的这么多（万分比）。
   * 例：高卢银行支票「回合开始时初始能量条为最大值的一半」→ 5000；
   *     《第二经济改革法》「初始能量条为最大值」→ 10000。
   *
   * 【为什么不是"加 N 点法力"？】因为面板上写的是"一半 / 满"，
   * 按比例写就与 MANA_MAX 的具体数值解耦 —— 以后调 MANA_MAX 不用改藏品数据。
   */
  initialManaBp?: StarValue;
}

/**
 * ★★ 0.2：**自定义普攻弹道**（丰川祥子的音符 / 祐天寺若麦的五连击）。
 *
 * 一次普攻按 `hits` 依次结算，每段可以有**自己的倍率和伤害类型** ——
 * 这是 `multiHit` + `multiHitBp`（每段一样）表达不了的那一半。
 */
export interface AttackProfile {
  /** 按顺序结算的每一段 */
  hits: AttackProfileHit[];
  /**
   * 这一段最多打几个敌人（穿透）。不写 = 1（打到第一个就停）。
   * 祥子的被动音符是 3（直线穿过去，最多 3 个）。
   */
  maxTargets?: number;
  /**
   * 直线穿透长度（格）。写了才沿"自己 → 目标"的方向往后数格子；
   * 不写 = 只打目标那一格。
   */
  pierceLength?: number;
  /** 每一段都**重新**随机挑一个射程内的敌人（若麦的技能里有这一条） */
  randomTarget?: boolean;
  /**
   * 表现层标记（渲染层注册表键）：`'note'` = 音符弹道。
   * 不写 = 用普通攻击特效。
   */
  fx?: string;
}

export interface AttackProfileHit {
  /** 这一段的伤害比例（万分比，9000 = 90% 攻击力）。按星级可以写三个数 */
  bp: StarValue;
  /** 这一段的伤害类型。不写 = 沿用平时的（物理 / 术士改成法术那套） */
  damageType?: DamageType;
}

/**
 * ★★ 0.2：**一次性的锁血被动**（若叶睦「多首野兽」的被动）。
 *
 * 效果：受到致命伤害时**不倒下**，血量锁 `hp`，并且
 *   · 期间不能攻击、不能移动（`disarmed` + `rooted`）；
 *   · 身上带嘲讽（把敌人拉过来）；
 *   · 持续 `durationTicks`（按星级）。
 *
 * 【和「不屈」的区别】不屈是**概率**、且能触发多次（概率递减）、满血站起来；
 * 这个是**必定**触发、**只一次**、只有 1 点血。所以不走同一条路。
 *
 * 【"不受复活效果影响、复活后不刷新"】用 `statuses['defyDeathUsed']` 记住用过了 ——
 * 之后不管是别的复活还是再次濒死，都不会再触发。
 */
export interface DefyDeathSpec {
  /** 锁到几点血（默认 1） */
  hp?: number;
  durationTicks: StarValue;
  /** 期间是否带嘲讽（默认 true） */
  taunt?: boolean;
}

/** 脉冲：每 intervalTicks 对周围 radius 格的单位做一件事 */
export interface PulseSpec {
  intervalTicks: number;
  /**
   * ★ 0.2.1 表现层：这条脉冲该配哪套**专属特效**（渲染层注册表键，原样塞进 `zone` 事件）。
   * 隐德来希的「血镰」用它 —— 每 0.5 秒一报 ⇒ 渲染层刷新一次"血镰环绕"，看起来是连着的。
   * ★ 不进校验和；不写 = 只有白框。
   */
  fx?: string;
  /**
   * ★ 0.2：间隔改成**跟着自己的攻速走**（夜莺"按照攻击频率对友方治疗"）。
   *
   * 【为什么用开关而不是直接写 `intervalTicks: 'attack'`？】
   * 因为 `intervalTicks` 是这个结构的主字段，把它变成联合类型会让所有
   * 读它的地方都要先判一次类型。加一个可选开关，老数据一个字节都不用动
   * （不写 = 还是固定的 `intervalTicks`）。
   * 实际间隔 = `round(TICKS_PER_SECOND / 攻速)`，下限 1 tick。
   */
  intervalFromAttackSpeed?: boolean;
  /** 半径。不写 = 2（大概"范围内"） */
  radius?: number;
  /**
   * 对敌人还是对友军。
   * ★ 0.2：新增 `'both'` —— 三角初华的技能是"**同一跳**里既打一个敌人、
   * 又奶一个队友"，拆成两条脉冲做不到（一个棋子只有一条脉冲）。
   */
  affect: 'enemies' | 'allies' | 'both';
  /**
   * ★ 0.2：每一跳只挑**一个**目标（初华："随机一名敌人 / 血量最低的一名友方"）。
   * 不写 = 老行为：范围内所有符合条件的单位全吃。
   */
  single?: boolean;
  /**
   * ★ 0.2：治疗时**优先**治这个 defId 的队友（初华："若我方上场[丰川祥子]，则优先治疗她"）。
   * 不在场 / 血量满 / 不在范围内就退回"血量最低"。
   */
  healPreferDefId?: string;
  /**
   * ★ 0.2：伤害时**优先**打这个 defId 的敌人（初华："若对方存在[丰川祥子]，
   * 则技能开启期间优先锁敌攻击[丰川祥子]"）。
   * 对面没有 / 不在范围内就退回"随机一名"。
   */
  attackPreferDefId?: string;
  /** 伤害。basis: attack=施法者攻击力比例，maxHp=目标最大生命比例，missingHp=目标已损失生命比例 */
  damage?: { basis?: 'attack' | 'maxHp' | 'missingHp'; ratioBp: StarValue; damageType: DamageType };
  /**
   * 治疗。basis: attack=施法者攻击力比例，casterMaxHp=施法者最大生命比例，targetMaxHp=目标最大生命比例。
   * ★ 0.2：可以写数组 ⇒ 治疗量是各条之和（夜莺 = 目标生命上限 % + 自身攻击力 %）。
   */
  heal?: HealSpec | readonly HealSpec[];
  /** 顺便挂一个增益（魔王的光环加攻击力） */
  buff?: SkillStats;
  buffDurationTicks?: number;
  /**
   * ★★ 0.2 可露希尔 Q.E.D：「造成 **9 次**伤害后，后续时间造成 …180%」。
   *
   * 计数口径 = **全局跳数**（每 `firePulse` 一次算一跳，不管这一跳打到几个人），
   * 与用户的拍板一致。超过 `hits` 跳之后，伤害倍率换成 `ratioBp`。
   */
  rampAfterHits?: { hits: number; ratioBp: StarValue };
  /**
   * ★★ 0.2 可露希尔 Q.E.D：「被锁定目标攻速 -50%（**此效果单个目标仅生效一次，持续 5s**）」。
   *
   * 【为什么不是普通的 `buff`？】`buff` 是每次脉冲都往上叠/刷新 ——
   * 0.5 秒一跳、10 秒能把一个目标刷 20 遍，"仅生效一次"就没了。
   * 所以这份减益只对**还没吃过的人**挂一次，名单记在施法者的 `pulseDebuffed` 上。
   */
  pulseDebuffOnce?: { stats: SkillStats; durationTicks: number };
}

/** 3 星专属技能：有它的时候，3 星**只生效它**（1/2 星技能不再生效） */
export interface SkillVariant {
  name: string;
  desc: string;
  effects: SkillEffect[];
  /** 3 星自带的被动（伊内丝 3 星就是纯被动） */
  passive?: SkillStats;
  /** 3 星的开局类效果（玛恩纳"回合开始后立刻开启技能"） */
  battleStart?: SkillEffect[];
  /** ★ 0.2.1：这一套技能释放时播哪套特效（渲染层注册表键），不写 = 沿用技能本体的 */
  castFx?: string;
}

/** 技能定义 */
export interface SkillDef {
  id: string;
  name: string;
  /** 简短描述，会显示在 UI 上 */
  desc: string;
  /** 攒满法力后释放的效果（被动技能留空） */
  effects: SkillEffect[];
  /**
   * 3 星专属技能。
   *
   * 【规则（你定的）】
   * 「有三星技能的角色，到达三星只生效三星技能，不生效 1、2 星的技能」。
   * 所以这里填了东西之后，3 星棋子会**完全替换**掉上面那套 effects，
   * 而不是叠加。
   */
  star3?: SkillVariant;
  /**
   * 被动技能：入场就生效、一直存在、不攒法力也不释放。
   * 数值写在这里，开战时直接并进棋子的「当前修正」。
   */
  passive?: SkillStats;
  /** 开局一次性生效的效果（砾"入场后获得护盾"、见行者"开局给最近的队友加攻速"） */
  battleStart?: SkillEffect[];
  /** 法力回复方式：攻击回复 / 受击回复 / 自动回复 */
  manaSource: ManaSource;
  /** manaSource === 'auto' 时，每秒回复多少法力（10 秒充满 = 100） */
  manaPerSecond?: number;
  /**
   * ★ 0.1.3：**开局时**技能条有多少（万分比，10000 = 一开场就能放）。
   *
   * "左手"的被动「入场时立刻开启一次技能」就是它。
   * 【为什么不写成 battleStart 里再抄一遍同样的效果？】
   * 那样同一份效果会在两个地方各有一份，以后改数值必然漏掉一处
   * （这个仓库里"同一个动作两处实现"栽过好几次）。
   */
  startManaBp?: StarValue;
  /**
   * ★★ 0.2.1：这套技能**释放时**播哪套特效（渲染层 `three/sequence-fx.ts` 的 `SKILL_FX` 注册表键）。
   *
   * 一个 key 可以带三组图：`self`（施法者脚下）/ `target`（正前方落点）/
   * `attack`（技能生效期间每一刀），另外还有 `castOnce`（只放一次的枪口）与 `loop`（循环层）。
   * 3 星变体可以在 `star3.castFx` 里换一套。
   *
   * ★ **纯表现层**：只进 `cast` 事件的 `fx`，不进校验和。
   *   不写 = 只有通用那圈金色符文环（`skill-cast-fx.ts`），和现在完全一样。
   */
  castFx?: string;
}

/** 技能效果的种类。想加新技能就在这里加一种，然后在 skills.ts 里实现它 */
export type SkillEffect =
  /** 一次性伤害。radius>0 表示范围伤害，hits>1 表示连续多次 */
  | {
      kind: 'damage';
      target: TargetRule;
      fallback?: FallbackRule;
      power: StarValue;
      damageType: DamageType;
      radius?: number;
      shape?: SplashShape;
      hits?: StarValue;
      /** 命中后把目标往后退 N 格（妮芙） */
      knockback?: StarValue;
      /**
       * ★ 0.2：**击退路线上**的敌人一并眩晕 + 附伤（见行者「指引」）。
       *
       * 【触发条件】路线上真的站着至少 1 个敌人时整条才生效 ——
       *   一个都没有就只是"普通击退 + 本条主伤害"，不白送控制。
       * 【谁吃什么】目标自己 + 路线上的敌人 ⇒ 都眩晕 `durationTicks`；
       *   `power` 的额外伤害**只打路线上的敌人**（目标已经吃过本条的主伤害了）。
       * 【路线怎么算】从目标当前格出发、沿"远离施法者"的方向数 `knockback` 格，
       *   不含目标自己那一格。方向的计算和 `knockback()` 共用一处实现。
       */
      pathStun?: { durationTicks: StarValue; power: StarValue; damageType: DamageType };
      /**
       * ★ 0.2：命中后对**目标周围**额外结算一份**另一个倍率**的伤害（妮芙"对目标造成
       * 90%/95%/105% 攻击力的法术伤害，并对目标周围四格的敌人额外造成 80%/85%/95% 的法术伤害"）。
       *
       * 【和上面 `radius` 的区别】`radius` 是"把这一次伤害变成范围"——**威力相同**；
       * 这个是"主伤害 + 一圈**另一份倍率**的伤害"，两个倍率不同。
       * ★ 圈里**不含主目标自己**（主目标已经吃过主伤害了，不该吃两段）。
       */
      splash?: { power: StarValue; radius: number; shape?: SplashShape; damageType: DamageType };
      /**
       * ★ 0.3.2 表现层：这一发范围伤害命中后，让内核把 `fx` 原样带进 `zone` 事件
       * （渲染层查自己的注册表决定画什么）。不写 = 只有那个白色范围框（老行为）。
       *
       * ★ 和 `splash.fx` 的区别：那个是"主伤害 + 一圈附伤"的**附伤圈**特效，
       * 这个是"本条伤害本身就是范围"的圈。慈悲愿景的 3×4 矩形走的是后者。
       */
      fx?: string;
      /**
       * ★ 0.1.3：这条伤害一次挑几个目标（`target` 是 `highestAttackEnemies` 这类
       * "若干名"的规则时才需要）。不写 = 1。
       */
      count?: StarValue;
      /**
       * ★ 0.1.3：**命中后**给被打到的敌人挂上的负面包（锏「被打的敌人获得 4 秒战栗」）。
       * 只对这条伤害直接命中的目标生效，范围伤害不会顺着溅射传染。
       */
      debuff?: { stats: SkillStats; durationTicks: StarValue };
    }
  /** 持续伤害（截云：5 秒内每秒受到 X% 攻击力的法术伤害） */
  | {
      kind: 'dot';
      target: TargetRule;
      fallback?: FallbackRule;
      power: StarValue;
      /**
       * ★ 0.3.2：`power` 的基数。
       * 默认 `'attack'`（按施法者攻击力的千分比，老行为）；
       * `'targetMaxHp'` = 按**被打的人自己的生命上限**（终曲"每秒 5% 最大生命真实伤害"）。
       */
      powerBasis?: 'attack' | 'targetMaxHp';
      damageType: DamageType;
      durationTicks: number;
      intervalTicks?: number;
      /**
       * ★ 0.1.3：写了就变成**范围**持续伤害（锏：「2 秒内对周围造成 10 次 60% 的斩击」=
       * `durationTicks: 40`（2 秒）+ `intervalTicks: 4`（每 0.2 秒一跳）+ 星形范围）。
       * 一般是给自己挂（`target: 'self'`），这样"人在哪、范围就在哪"。
       */
      radius?: number;
      shape?: SplashShape;
      /** ★ 0.1.3：每跳命中后给对方挂的负面包（战栗就是用这个） */
      debuff?: { stats: SkillStats; durationTicks: StarValue };
    }
  /** 治疗。basis: 按施法者攻击力（默认）还是按目标最大生命比例（古米"回复30%生命值"） */
  | {
      kind: 'heal';
      target: TargetRule;
      fallback?: FallbackRule;
      power: StarValue;
      /**
       * ★ 0.2：新增 `'missingHp'` —— 按**目标已损失的生命**算（若叶睦
       * "立刻回复已损失生命值的 10%/15%/20%"）。`healAmount` 里本来就实现了这一支，
       * 只是类型没放出来。
       */
      basis?: 'attack' | 'casterMaxHp' | 'targetMaxHp' | 'missingHp';
    }
  /** 持续治疗 */
  | {
      kind: 'healOverTime';
      target: TargetRule;
      power: StarValue;
      basis?: 'attack' | 'casterMaxHp' | 'targetMaxHp' | 'missingHp';
      /**
       * ★ 0.2：改成 `StarValue` —— 「恢复速率 20%/s，总量 15%/30%」这种
       * **总量按星级变、速率固定**的写法需要时长跟着星级走
       * （赤刃明霄陈：0.75 秒 / 1.5 秒）。施加时用**施法者**的星级解析。
       */
      durationTicks: StarValue;
      intervalTicks?: number;
    }
  /**
   * 护盾。
   *
   * · `basis`：'maxHp'（默认，按施法者生命上限的百分比）/ 'missingHp'（★ 0.2 左乐：
   *   按施法者**已损失**生命）/ 'flat'（固定点数）。
   * · `power`：basis='flat' 时是「点 × FIX」；否则是**千分比**（800 ⇒ 80%）。
   *
   * ★★ 0.2 机械师带来的三件新东西（都只在写了才有行为，老数据零影响）：
   *   · `decayBpPerSecond`：护盾**自己往下掉**，速度是「获得总量」的万分比/秒
   *     （1500 ⇒ 15%/s ⇒ 这层盾 6.67 秒自然消失）。
   *   · `bullets` + `breakBlast`：「破盾子弹」—— 盾被打空（或衰减完）时
   *     消耗一颗，**再补一层同样的盾**，并对自身周围炸一次 `breakBlast`。
   *   · `noManaWhileActive`：护盾存在期间**无法获得任何技力**（左乐）。
   */
  | {
      kind: 'shield';
      target: TargetRule;
      power: StarValue;
      basis?: 'maxHp' | 'missingHp' | 'flat';
      durationTicks: number;
      decayBpPerSecond?: StarValue;
      bullets?: StarValue;
      breakBlast?: {
        radius: number;
        shape?: SplashShape;
        power: StarValue;
        /** 默认 'attack'（千分比 × 攻击力）；机械师写 'maxHp'（千分比 × 生命上限） */
        basis?: 'attack' | 'maxHp';
        damageType: DamageType;
      };
      noManaWhileActive?: boolean;
      /**
       * ★ 0.2 新约能天使：这层盾是"技能挂上去的"——
       * 技能结束时（弹药打光 / 施法者阵亡）剩余的盾要一起消失。
       */
      skillBound?: boolean;
    }
  /**
   * ★ 0.2：`durationTicks` 改成 `StarValue` —— 八幡海铃"眩晕 1.5/2/10 秒"要按星级取。
   * 施加时用**施法者**的星级解析（和别的 `StarValue` 同一个口径）。
   */
  | { kind: 'stun'; target: TargetRule; fallback?: FallbackRule; durationTicks: StarValue }
  /**
   * ★★ 0.3.2 阿米娅·炉芯终曲「无言的期盼」：技能期间**周期性随机即死**。
   *
   * 【为什么要单独一个 kind，不能复用 damage？】
   * 因为它要**无视一切保命**：无敌、重生（茧甲 / 多阶段 Boss）、免死（魔王 3 星）、
   * 不屈、`cannotDie`…… 这些都在 `killUnit` 里按优先级挡伤害，
   * 而"即死"是设计上明确要穿透它们的（表里原话："无视无敌，重生，免死等一系列效果"）。
   * 所以它走 `killUnit(..., { force: true })` 这一条独立通道。
   *
   * @param count          每次杀几个（终曲是 1）
   * @param intervalTicks  每隔多久杀一次（终曲 2 秒 = 40）
   * @param durationTicks  这个"收割窗口"持续多久（终曲和 debuff 同为 10 秒）
   */
  | {
      kind: 'execute';
      target: TargetRule;
      count: StarValue;
      intervalTicks: number;
      durationTicks: number;
      /**
       * ★ 0.3.2 表现层：即死**成功那一刻**在该敌人身上叠的那套特效（渲染层注册表键）。
       *
       * 【为什么不能靠 `death` 事件凑合？】`death` 分不清"被打死"和"被即死"，
       * 后者要的是"人凭空被抹掉"的读感（黑红破碎），前者是普通阵亡。
       * 所以内核在 `tickExecute` 真正抹掉一个人的那一 tick 多报一条 `executeFx`。
       * 纯表现层，**不进校验和**。
       */
      fx?: string;
    }
  /**
   * 给目标挂一个限时修正包。
   * `attacks` 有值时表示「接下来 N 次攻击」而不是按时间（耀骑士临光/维什戴尔）。
   */
  | {
      kind: 'buff';
      target: TargetRule;
      stats: SkillStats;
      /**
       * ★ 0.2：改成 `StarValue` —— 支持"5/7/10 秒"这种**按星级变时长**的写法
       * （予愿安洁莉娜的"技能持续 5s/7s/10s"）。施加时用**施法者**的星级解析。
       */
      durationTicks: StarValue;
      attacks?: StarValue;
      /**
       * ★ 0.2 新约能天使 3 星：「攻击变成五连击并**消耗五发弹药**」——
       * 每打一次消耗几发（默认 1）。
       */
      chargesPerAttack?: number;
    }
  /** 给敌人挂负面修正（塑心"降低攻击力"） */
  | {
      kind: 'debuff';
      target: TargetRule;
      fallback?: FallbackRule;
      stats: SkillStats;
      durationTicks: number;
      /** ★ 0.1.3：一次给几个目标挂（配合 `highestAttackEnemies` 这类规则，默认 1） */
      count?: StarValue;
      /** ★ 0.2 新约能天使：跟"技能结束"绑定，技能一结束就摘掉（见 `skillAttachments`） */
      skillBound?: boolean;
    }
  /** 召唤（迷迭香的柱子 / 维纳维多利亚的金狮子） */
  | {
      kind: 'summon';
      summonId: string;
      count: StarValue;
      /** ★ 0.2：允许按星级不同（迷迭香的柱子 5/6/7 秒） */
      durationTicks: StarValue;
      place: SummonPlace;
      /**
       * 场上**同时存在**的上限（维娜 8 只 / 迷迭香 1 只）。
       * 不写就是不限 —— 但同一种召唤物一般都要有上限，
       * 否则"次数多了就是人海"会把棋盘塞满、也会把帧数拖下去。
       */
      max?: number;
      /** 召唤物的血量/攻击力按施法者星级走（迷迭香柱子 300/500/700） */
      hp?: StarValue;
      attackDamage?: StarValue;
    }
  /** 瞬移（耀骑士临光 / 赤刃明霄陈） */
  | { kind: 'teleport'; target: TargetRule; fallback?: FallbackRule }
  /**
   * ★★ 0.2 蕾缪安 3 星「强制追思」：锁定若干地块，稍后一次性引爆。
   *
   * 【为什么不直接用 `damage` + `radius`？】
   * 因为它是"**先记下**、7 秒后才打"，而且打的是**地块**不是人 ——
   * 目标这 7 秒里可能死了、可能走开了，落点却不变。
   * 普通的 `damage` 是"选中目标 → 立刻以它为中心结算"，形状就不一样。
   */
  | {
      kind: 'lockOn';
      /** 一共几颗弹药（= 锁几个地块） */
      count: StarValue;
      /** 每隔多久锁一个（tick） */
      intervalTicks: number;
      /** 从放技能算起，过多少 tick 一起引爆 */
      blastTicks: number;
      radius: number;
      shape?: SplashShape;
      /** 每颗弹药的倍率（千分比 × 施法者攻击力） */
      power: StarValue;
      damageType: DamageType;
      /**
       * ★ 0.2.2：**纯表现** —— 锁定/引爆那两套特效的样式 id。
       * 渲染层查 `three/lockon-fx.ts` 的注册表（狙击镜 + 收缩光环 + 粉色爆破），
       * 内核完全不关心它长什么样。不认识 id 时按默认样式画。
       */
      fx?: string;
    }
  /** 复活已经阵亡的棋子（新约能天使 3 星） */
  | {
      kind: 'revive';
      count: number;
      star?: number;
      /**
       * ★ 0.2：「并使其回复 100% 的技力」。
       * 万分比口径（10000 = 满技力），复活那一刻把它写进去。
       */
      manaBp?: number;
    }
  /** 在指定位置放一个"陷阱棋子"（望：放棋子，敌人靠近就爆炸） */
  | {
      kind: 'trap';
      trapId: string;
      place: TrapPlace;
      count: StarValue;
      power: StarValue;
      damageType: DamageType;
      radius?: number;
      durationTicks: number;
    }
  | { kind: 'gainMana'; target: TargetRule; amount: number };

/** 召唤物放在哪 */
export type SummonPlace =
  /** 自己身边的空格 */
  | 'besideSelf'
  /** 敌人旁边（迷迭香的柱子要贴着脸） */
  | 'besideEnemy'
  /** 自己周围 8 格的空格（维纳维多利亚的金狮子） */
  | 'emptyAroundSelf'
  /** 全场随机空格 */
  | 'randomEmpty'
  /**
   * ★ 0.1.3：从**场地最外圈**（棋盘四边那一圈）里随机挑一个空格。
   * 血骑士的凝血之刃「在随机场地边缘生成」—— 它得从外面慢慢走进来。
   */
  | 'randomEdge';

/** 陷阱放在哪（望的棋子） */
export type TrapPlace =
  /** 攻击范围最末端的格子（沿着朝敌人的方向推到底） */
  | 'rangeEdge'
  /** 全场随机 N 个位置 */
  | 'randomSpread'
  /**
   * ★ 0.2（望·连星）：某名敌人**旁边**的空格。
   *   · `besideHighestHpRatioEnemy` = 攻击范围内**百分比**血量最高的那名敌人；
   *   · `besideLowestHpEnemy`       = 全场血量最低的那名敌人。
   * 挑不到人、或那人周围没空格时**退回 `rangeEdge`**（数据表写明的兜底）。
   */
  | 'besideHighestHpRatioEnemy'
  | 'besideLowestHpEnemy';

/** 技能选谁当目标 */
export type TargetRule =
  | 'currentTarget' // 我当前正在打的那个人
  | 'nearestEnemy' // 离我最近的敌人
  | 'farthestEnemy' // 离我最远的敌人
  | 'lowestHpEnemy' // 血量最低的敌人（斩杀用）
  | 'highestHpEnemy' // 血量最高的敌人
  /** ★ 0.1.3：攻击力最高的若干名敌人（要几个看效果的 `count`，血骑士的对手还没用、先给"左手"用） */
  | 'highestAttackEnemies'
  | 'allEnemies' // 全体敌人
  | 'enemiesInRadius3' // 我周围 3 格内的所有敌人
  /**
   * ★ 0.2：**我自己攻击范围内**的所有敌人（八幡海铃"攻击范围内的敌人眩晕"）。
   * 和 `enemiesInRadius3` 的区别：那个是写死 3 格，这个跟着自己的射程（能吃到射程加成）。
   */
  | 'enemiesInRange'
  | 'enemiesAroundTarget' // 我当前目标周围的敌人（范围伤害用）
  | 'randomEnemies' // 随机几个敌人
  | 'self' // 自己
  | 'lowestHpAlly' // 血量最低的队友（治疗用）
  /**
   * ★ 0.2：按**百分比**血量最低（不是绝对值）。
   * 凯尔希「攻击范围内百分比生命值最低的一名队友」、蕾缪安「优先攻击百分比生命值最低的敌人」。
   * 和上面两个的区别：血量 100/1000（10%）比 300/10000（3%）**更健康**。
   */
  | 'lowestHpRatioAlly'
  | 'lowestHpRatioEnemy'
  | 'nearestAlly' // 离我最近的队友（不包括自己）
  | 'randomAlly' // 随机一个队友
  | 'allAllies'; // 全体队友

/**
 * 目标兜底规则。
 *
 * 【为什么需要这个东西？】
 * 自走棋里最常见的「手感问题」就是技能空放：
 * 比如「对当前目标造成 220% 伤害」，但放技能那一瞬间目标刚好被打死了，
 * 技能就白放了 —— 玩家会觉得自己的棋子很蠢。
 *
 * 所以每个指向单体的技能都应该写一个 fallback：
 * 首选目标不在了，就退而求其次打别人。
 */
export type FallbackRule = Exclude<TargetRule, 'currentTarget'>;

/**
 * 攻击类型与伤害类型分离是关键设计：
 * - physical 走护甲减免，magic 走魔抗减免，true 无视防御
 * - 攻击类型决定法力回复/暴击/吸血等「攻击特效」是否触发
 *   （法术造成的伤害不会给对方回太多法力，这是自走棋的常见平衡手段）
 */
export type DamageType = 'physical' | 'magic' | 'true';
export type AttackType = 'attack' | 'spell';

/**
 * 棋子定义：一张「策划表格」的行
 */
export interface UnitDef {
  id: string;
  name: string;
  /** 费用 1-5 费 */
  cost: number;
  /** 种族 / 职业标签，用于羁绊。例如 ['night', 'assassin'] */
  traits: string[];
  /** 一星基础属性 */
  base: {
    hp: number;
    attackDamage: number;
    attackSpeed: number;
    armor: number;
    magicResist: number;
    range: number;
    manaPerAttack: number;
  };
  /** 每升一星，属性乘算的倍率（bp）。默认 1.8 倍 */
  starHpBp: number;
  starDamageBp: number;
  skill: SkillDef;
  /** 3D 场景里用的颜色（先用色块代替模型，后面换成贴图/模型） */
  color: string;
  /** 2D 立绘用哪个 sprite。先用名字占位 */
  sprite: string;
  /**
   * 官方干员 ID（`char_002_amiya` 这种）。
   *
   * 【为什么必须显式写，不能按名字猜？】
   * 因为 `id`（op07）是**按名单行号生成的**：在名单中间插一个干员，
   * 后面所有 id 全部位移。如果拿 `op07` 去挂官方素材，
   * 每次改名单都会把素材挂错人，而且错得悄无声息。
   * 写成显式映射之后，插行只会影响新那一行。
   *
   * 没有这个字段的棋子（比如召唤物、没对上官方名的干员）
   * 继续用 `stand/` 半身像 —— 这条链路必须永远能回退。
   */
  charId?: string;
  /**
   * 这只棋子**只能被技能召唤出来**，不会出现在商店/牌库/敌人波次里
   * （迷迭香的柱子、维纳维多利亚的金狮子…）。
   *
   * 【为什么把召唤物放进同一张 UNIT_DEFS，而不是单独一张表？】
   * 因为 `createBattle(defs, ...)` 只认一张表。单独开一张表就意味着
   * 战斗内核、协议、联机广播都要多带一个参数。
   * 放进同一张表 + 一个标记，代价只是"抽牌的地方要记得过滤" ——
   * 而抽牌的地方就那么几处，测试会把它们钉住。
   */
  summonOnly?: boolean;
  /** 召唤物的召唤者 defId（UI 显示用） */
  summonOf?: string;
  /**
   * ★ 0.2：这只召唤物的卡面**不画血条**（用户口径）。
   *
   * 【为什么要做成数据开关，而不是在渲染层按 id 认人？】
   * 因为"哪只召唤物的血量值得看"是**设计问题**，不是渲染问题：
   * 迷迭香的柱子 / 防暴桩假人有真实血量、会被打，血条有意义；
   * 而望的「棋子」只有 1 点血、还不可被选中（它只是"踩上去就炸的地雷"），
   * 卡面上挂一条永远是"满格"的血条只会误导玩家"它能扛几下"。
   * ⇒ 谁不画，写在数据里（`summon_trap`），渲染层只读这个标记。
   *
   * ★ 判定只允许一处实现：`sprite-graphics.ts` 的 `canShowHpBar()`，
   * 创建（createUnitSprite）和换人（restyleUnitSprite）都走它。
   */
  hideHpBar?: boolean;
  /**
   * ★★ 0.2.1：**普攻的贴图特效**（渲染层 `three/sequence-fx.ts` 的 `COMBAT_FX` 注册表键）。
   *
   * 【为什么是数据，而不是渲染层认人？】
   * "这个干员的枪口火光长什么样"是**美术资产归属**，跟 op 编号无关 ——
   * 名字一旦写进渲染层，改名单/插行就会静默挂错人（`charId` 那条注释里记过同样的坑）。
   * 所以数据里写个字符串，内核原样塞进 `attack` 事件（`muzzleFx`/`hitFx`/`heavyFx`），
   * 渲染层只查表。
   *
   * ★ **纯表现层**：不进校验和（`computeChecksum` 的 attack 分支只混 unitId/targetId）。
   *   不写 = 用原来那套程序化攻击特效（弧 + 爆点），行为一个字节不变。
   */
  combatFx?: string;
  /**
   * ★★ 0.2.1：**普攻弹道**的贴图特效（渲染层 `three/bolt-tracer-fx.ts` 的 `TRACER_FX` 注册表键）。
   * 写了它，这个干员的远程普攻就不再画那根白线，而是播这套弹道（澄闪的粉色闪电 = `'bolt_pink'`）。
   *
   * ★ 长度跟着实际距离走、粗细不跟着变；纯表现层，不进校验和。
   *   近战（射程 1）不会用到它 —— 弹道只对远程攻击有意义。
   */
  tracerFx?: string;
  /**
   * ★ 0.2.1：**治疗时的流光**（渲染层 `three/bolt-tracer-fx.ts` 的 `TRACER_FX` 注册表键）。
   * 写了它，这个干员给别人回血时会从**自己身上**朝**被治疗的那名队友**射一条光
   * （古米 / 芙蓉的绿色流光就是这么来的）。
   *
   * ★ 与 `tracerFx` 的区别：那条是"打人的弹道"，这条是"奶人的光"，
   *   两者互不影响（一个人可以既打人又奶人）。
   * ★ 纯表现层：不进校验和。不写 = 治疗只有绿框 + 数字，行为完全不变。
   */
  healFx?: string;
  /**
   * ★★ 0.2.1：**回血光环**（渲染层 `three/heal-halo-fx.ts` 的配色表键）。
   * 写了它，这个干员**每次成功治疗队友**（含治自己）都会在自己脚下刷新一圈光环，
   * 并往上飘几个符号（夜莺的绿色 `+++` / 魔王的粉色 `🗡+`）。
   *
   * ★ 与 `healFx` 的区别：那条是"从甲射到乙的一道流光"，这条是"甲脚下的一圈光"。
   *   一个人可以两个都有；不写 = 什么都没有（老行为）。
   * ★ 为什么挂在 `heal` 事件上而不是 `zone`：魔王 3 星的治疗是"全体每秒回血"，
   *   发出来的是半径 0 的框 —— 照那个半径画光环会只剩脚下一小圈。
   * ★ 纯表现层：不进校验和。
   */
  healHaloFx?: string;
  /**
   * ★★ 0.2.1：**这套普攻表现只在"普通攻击"里播**（技能生效期间的攻击换技能自己的表现）。
   *
   * 【为什么需要它？】
   * 炮手那几个人的技能不一样：
   *   · 号角 / 灰毫 / 空爆 —— 技能只是给自己加攻/加攻速，出手还是同一种炮弹
   *     ⇒ 技能期间**继续**用 `combatFx` / `tracerFx`；
   *   · 菲亚梅塔 —— 技能把普攻变成 5×5 范围轰击，那一发该有自己的表现
   *     ⇒ 技能期间**让位**，退回程序化特效（等她的专属技能图做好再接）。
   *
   * ★ 判据只有一个：`isSkillActive(state, unit)`（和"技能期间不回蓝"同一个函数）。
   *   纯表现层，不进校验和。
   */
  combatFxBasicOnly?: boolean;
  /**
   * 这只棋子是**野怪**：只在「野怪回合」由系统生成，
   * 商店 / 牌库 / 单机敌方干员阵营**都不会**出现它。
   *
   * 和 `summonOnly` 一样，统一由 `isPlayableDef()` 排除 ——
   * 抽牌的地方只调那一个函数，不要各自再写一遍过滤条件。
   */
  monsterOnly?: boolean;
  /** 野怪的级别（小怪 / 普通 / 精英 / 小领袖 / Boss）。只有 monsterOnly 的棋子有 */
  monsterTier?: 'minion' | 'normal' | 'elite' | 'leader' | 'boss' | 'special';
  /**
   * ★ 彩蛋棋子：**没有星级机制**。
   *
   * 【这个标记改变了什么？】
   *   · 三张不合一（`mergeAllUnits` / `mergeBench` 都跳过它）
   *   · 卡面上不画星级标记（`hasStarBadge` 返回 false）
   *   · 星级倍率恒 1000（数据里写成 `starHpBp/starDamageBp: 10000`）
   *
   * 【为什么不用现成的 `monsterOnly`？】
   * 野怪是"三路都不要"（商店 / 牌库 / 敌方阵营），而彩蛋**恰恰要出现在商店里**
   * （只不过是靠那条 1/1500 的特殊概率），也要能被买、能被穿装备。
   * 两者只有一个共同点（都不参与合成），语义完全不同 —— 合用一个字段
   * 会让以后想改其中一边的人踩到另一边。
   */
  noStar?: boolean;
  /**
   * ★ 0.1.1 藏品二版：**卡面上不画背景卡片**（小人 + 血条照常画）。
   *
   * 【为什么要有它？】
   * 「天师锦囊」召唤的【炎佑】在设计稿里点名"不要背景卡片" ——
   * 它是一个飘在场上、体积很大的机械（原作的"宣瑞之明灯"），
   * 套上那张卡框之后会显得被切成方块。
   *
   * 【和 monsterOnly 是什么关系？】
   * 野怪也是"无卡面"，但野怪是**一整套设定**（不可穿装备、不画星级、
   * 不走牌库…）。炎佑是正常棋子（有羁绊、能吃光环），只有"画不画卡面"这一条一样。
   * 所以拆成两个标记 —— 拿 monsterOnly 去凑的话，
   * 以后想改野怪的任何一条规则都会顺手把炎佑改掉。
   */
  noCard?: boolean;
  /**
   * ★★ 0.3.2：**只能由升变产生**的棋子（阿米娅的三个形态）。
   *
   * 和 `summonOnly` / `monsterOnly` 同一个套路：靠 `isPlayableDef()` 把它们
   * 排除在商店、牌库、招募、掉落之外。单独开一个标记（而不是借用 `summonOnly`），
   * 是为了让语义清楚 —— 它们既不是召唤物，也不是野怪，只是"不能买"。
   */
  ascendOnly?: boolean;
  /**
   * ★ 0.2：**这只棋子的模型（小人）该放大多少倍**（1 = 原尺寸，不写 = 1）。
   *
   * 【为什么需要它？】小人的世界尺寸原本只有"野怪按级别/逐只调"这一条路
   * （`monster-data.ts` 的 `monsterModelScaleOf`，而它对 `monsterOnly !== true` 一律返回 1）。
   * 但召唤物也会遇到"模型画出来太大/太小"的问题 —— 魂灵之影就是：
   * 官方那套骨架按统一高度铺到一格上显得比维什戴尔还壮，压小 35% 才像"影子"。
   *
   * 【为什么不直接塞进野怪那张表？】那张表的判据是 `monsterOnly`，
   * 把召唤物塞进去就得放宽那个判断 —— 之后"野怪"这个概念会连带被污染
   * （`noCard` 那条注释里已经踩过一次同类的坑）。
   * 所以这里做成**棋子自己的**一个字段：谁都能写，和"是不是野怪"无关。
   *
   * ★ 乘在**世界高度**上，脚底锚点不动 ⇒ 是"从地面往上缩小/放大"，不会浮起来。
   * ★ 只影响观感（模型大小），不影响占格、碰撞、射程、血条位置。
   */
  modelScale?: number;
  /**
   * 二阶段「重生」：血量第一次归零时站起来并强化。
   * 定义在 monster-data.ts 的 MonsterReborn，这里只声明形状，避免循环引用。
   */
  reborn?: {
    hpBp: number;
    damageBp?: number;
    attackSpeedBp?: number;
    enemyId?: string;
    /**
     * ★ 0.0.3：倒地等待复活的时长（tick）。表里的「死亡后需要 3/5 秒复活」。
     * 不写 = 立刻站起来（最早的即时重生）。
     */
    delayTicks?: number;
    /**
     * ★ 0.0.3：倒地演出的播放速度倍数（纯观感，不影响数值）。
     * 杰斯顿的阵亡动作有 4 秒、倒地只等 3 秒，所以它写了 2（两倍速）。
     */
    downedAnimSpeed?: number;
    /**
     * ★★ 0.3.2：**倒地等复活期间**每隔 `intervalTicks` 对全场敌人造成一次伤害
     * （阿米娅·炉芯终曲「重生期间每秒对全场造成自身攻击力 100% 的真实伤害」）。
     *
     * 【为什么挂在 reborn 上、而不是做成一条 pulse？】
     * pulse 只对"活着在行动"的单位跑；倒地那一支在 `rules.ts` 里被 `continue` 掉了，
     * 只有 `tickDowned()` 每 tick 还会走到它。所以这里单独给一份，
     * 由 `tickDowned` 负责（见 combat-math.ts 里的说明）。
     */
    downedPulse?: { intervalTicks: number; power: StarValue; damageType: DamageType };
    /** ★ 一阶段覆盖（复活前生效）。不写 = 用 def 里那套。 */
    phase1?: UnitPhaseOverride;
    /** ★ 二阶段覆盖（复活后生效，一阶段那套被换掉）。 */
    phase2?: UnitPhaseOverride;
    desc: string;
  };
  /**
   * ★ 0.0.3：野怪自带的**战斗中机制**（嘲讽 / 定期落雷 / 流血 / 残血增伤…）。
   *
   * 【为什么放在 UnitDef 上，而不走羁绊那条 unitMechanics？】
   * 因为野怪没有羁绊（traits 为空）。但战斗循环里那些机制是"同一个东西"，
   * 所以类型复用 `ScopedMechanic`，只是来源换成"棋子数据表自己带的"。
   * createBattle 会把它们和羁绊/藏品的机制合并进 `unit.trait.mechanics`。
   */
  mechanics?: ScopedMechanic[];
}

/**
 * ★ 0.0.3：棋子「换阶段」时对一只棋子的覆盖（野怪的一阶段 / 二阶段）。
 *
 * 【为什么是数据、而不是写死代码？】
 * 因为哪只 Boss 二阶段变什么，全是要调的数值（射程 1→3、攻速 +30%、
 * 血量 -30%、机制换一套…）。写在数据里之后，战斗内核只负责"照着换"。
 */
export interface UnitPhaseOverride {
  /** 射程覆盖 */
  range?: number;
  /** 攻击力乘算（万分比，10000 = 不变） */
  damageBp?: number;
  /** 攻速乘算（万分比） */
  attackSpeedBp?: number;
  /** 护甲 / 魔抗 的**加减**（绝对值，正 = 加，负 = 减） */
  armorFlat?: number;
  magicResistFlat?: number;
  /** 生命上限乘算（万分比。奎隆二阶段「最大生命值 -30%」→ 7000） */
  maxHpBp?: number;
  /**
   * 复活/切阶段时把血量设成生命上限的多少（万分比）。
   * “复仇者”二阶段「血量重置在最大生命的 49%」→ 4900。不写 = 满血。
   */
  reviveHpBp?: number;
  /** 替换掉的**被动**（一阶段那套不再生效）。不写 = 沿用一阶段 */
  passive?: SkillStats;
  /** 替换掉的**技能效果** */
  effects?: SkillEffect[];
  /** 替换后的技能名 / 描述（只给界面看） */
  skillName?: string;
  skillDesc?: string;
  /** 替换后的法力回复（auto + manaPerSecond 用来表达"每 5 秒 / 每 10 秒"） */
  manaSource?: ManaSource;
  manaPerSecond?: number;
  /** 切到本阶段后**额外挂上**的限时增益（“复仇者”二阶段的无敌 8 秒） */
  buffs?: { stats: SkillStats; durationTicks: number }[];
  /**
   * ★ 0.1.3：切到本阶段时把**技能条**设成最大值的多少（万分比，10000 = 满）。
   *
   * 血骑士「复活后召唤 6 只凝血之刃」和锏「复活后获得 50% 技能条」都用它：
   * 复活即满蓝（或半蓝）-> 下一个行动 tick 自然就把技能放出来了，
   * 不需要为此再造一个"进入阶段时结算一次效果"的钩子。
   */
  manaBp?: number;
  /**
   * ★ 0.1.3：**进入这一阶段时立刻结算一次**的技能效果（血骑士复活后召唤 6 只刀刃）。
   *
   * 【为什么不能写进 `effects`？】`effects` 是"替换掉技能效果" ——
   * 写进去之后复活之后每 4 秒都会再召 6 只，和"每 4 秒 1 只"的原设计冲突。
   */
  onEnter?: SkillEffect[];
  /** 切到本阶段后**替换**掉"阶段机制"那一层（一阶段的机制不再生效） */
  mechanics?: ScopedMechanic[];
  /** 出图用的阶段标识（客户端切素材：'mn_skzdd_2' 这种）。不写 = 不换素材 */
  artId?: string;
  /** 给界面/日志用的一句话 */
  desc: string;
}

// ============================================================
// 羁绊（种族 / 职业）
// ============================================================

/** 标签的类别：种族还是职业。UI 上会分组显示 */
export type TraitKind = 'race' | 'class';

/**
 * 一个羁绊的「档位」。
 *
 * 自走棋的羁绊都是「凑够 N 个同标签棋子就生效」，
 * 而且往往是分档的：2 个一个小效果，4 个一个更强的效果。
 * 所以每个羁绊有一串档位，从少到多。
 */
export interface TraitTier {
  /** 需要几个同标签的棋子才触发这一档 */
  count: number;
  /** 这一档的加成 */
  effects: TraitEffect[];
  /** 界面上显示的一句话说明，例如「全体骑士 +25 护甲」 */
  desc: string;
  /**
   * 这一档的**战斗中机制**（可选）。
   * 属性加成之外的行为都写在这里 —— 见 TraitMechanic 的说明。
   * 每条机制都可以用 `scope` 单独指定"给谁"（不写就跟随羁绊）。
   */
  mechanics?: ScopedMechanic[];
}

/**
 * 羁绊加成的种类。
 *
 * 【重要：目前全部是「属性加成」，没有「战斗中的特殊机制」】
 * 这是刻意的第一版范围。属性加成能覆盖绝大多数经典羁绊
 * （+护甲、+攻速、+法强、+血、+魔抗），而且实现起来干净、
 * 不会污染战斗主循环。
 *
 * 像「死亡时爆炸」「开局召唤随从」「每回合给装备」这类机制型羁绊，
 * 需要在战斗循环里加钩子，属于下一步。
 * 如果你的设计里有这类羁绊，告诉我，我来加钩子。
 */
export type TraitEffectType =
  /** 加攻击力，value 是「百分之几」，2500 = +25% */
  | 'attackDamageBp'
  /** 加攻速，value 是「万分之几」，2000 = +20% */
  | 'attackSpeedBp'
  /** 加血量上限，value 是「百分之几」，1000 = +10% */
  | 'hpBp'
  /** 加护甲，value 是绝对值，25 = +25 护甲 */
  | 'armorFlat'
  /** 加魔抗，value 是绝对值 */
  | 'magicResistFlat'
  /** 加法力回复速度，value 是万分比，3000 = 每次普攻多回 30% 法力 */
  | 'manaGainBp'
  /**
   * **每回合多给多少金币**（经济类效果，不参与战斗计算）。
   * value 是绝对金币数，3 = 每回合 +3 金。
   *
   * 【为什么羁绊表里会有"经济"效果？】
   * 因为「奸商」这种羁绊本来就是经济向的 —— 它不改变战斗数值，
   * 而是让你更快攒钱、更快成型。用属性加成硬凑一个数值反而说不通。
   * 实现上它走经济那条路（economy.ts），战斗内核完全看不到它。
   */
  | 'goldPerRound'
  /** 加护甲，value 是**百分比**，5000 = +50% 护甲（和 armorFlat 的区别见下） */
  | 'armorBp'
  /** 加魔抗，value 是百分比 */
  | 'magicResistBp'
  /**
   * 攻击距离 +N 格（绝对值）。炮手 +2、术士 +1。
   *
   * 【为什么要单独一个"距离"加成？】
   * 距离不是"属性"，它直接改变棋子的行为（站着不动就能打到更远的人）。
   * 它是所有加成里**观感最强**的一个 —— 玩家一眼就能看出"我的远程打得更远了"。
   */
  | 'rangeFlat'
  /** 治疗效果提升，value 是百分比，3000 = 治疗量 +30% */
  | 'healingBp'
  /**
   * **全部属性**提升，value 是百分比。
   * 会同时加到攻击力、攻速、生命上限、护甲、魔抗上。
   * 龙羁绊用的就是这个（"每有一个三星干员，所有干员提升 N% 全部属性"）。
   */
  | 'allStatsBp';

/**
 * 羁绊的「战斗中机制」。
 *
 * 【为什么不能只用属性加成？】
 * 你给的 16 个羁绊里，一大半不是"开局加个数值"，而是**战斗中触发的事情**：
 *   · 萨卡兹：攻击时附带法术伤害
 *   · 炎：攻击斩杀残血敌人
 *   · 炮手：攻击溅射周围 3×3
 *   · 术士：攻击额外打 1/2/3 个敌人
 *   · 剑士／远射：每攻击 N 次叠攻速
 *   · 拉特兰：累计攻击 N 次后对全体敌人来一发
 *   · 维多利亚：血量掉到一半时爆发攻速
 *   · 罗德岛：血最高的那个攻击力提升，死了传给下一个
 *   · 支援：开局给我方全体上护盾
 *   · 重装：把重装护甲总和的一部分分给全队
 *   · 领导人：只有一个领导人时才生效的全队光环
 *   · 龙：按三星干员数量提升全部属性
 *   · 奸商：回合结束时按存活数量给金币
 *
 * 这些**必须在战斗循环里挂钩子**。所以引入这个类型：
 * 每个羁绊的每一档可以带一组 mechanic，开战时解析成棋子身上的"运行时行为"，
 * 战斗循环在固定位置读一下有没有这个行为 —— 战斗主循环本身不需要知道任何羁绊的名字。
 */
export type TraitMechanic =
  /**
   * 攻击时附加伤害。
   *   scale='dealt'       按"这次攻击打出的伤害"的百分比（萨卡兹）
   *   scale='targetMaxHp' 按"**目标**最大生命的百分比"（法术）
   *   scale='selfMaxHp'   按"**自己**最大生命的百分比"（0.0.3 A 版的重装）
   */
  | {
      kind: 'onHitDamage';
      ratioBp: number;
      damageType: DamageType;
      scale: 'dealt' | 'targetMaxHp' | 'selfMaxHp';
    }
  /** 攻击时对目标周围 radius 格内的其他敌人造成溅射（炮手：半径 1 的十字 / 3×3 方块） */
  | { kind: 'splash'; ratioBp: number; radius: number; damageType: DamageType; shape?: SplashShape }
  /** 攻击斩杀：目标血量低于阈值（万分比）时直接击杀（炎） */
  | { kind: 'execute'; thresholdBp: number }
  /** 攻击时额外攻击 N 个最近的敌人（术士） */
  | { kind: 'extraTargets'; count: number }
  /** 每攻击 every 次，永久提升攻速 bonusBp（剑士：每 3 次 +10%） */
  | { kind: 'attackCounterSpeed'; every: number; bonusBp: number; maxStacks: number }
  /** 每次攻击都永久提升攻速 perAttackBp（远射：每次 +2%） */
  | { kind: 'rampSpeed'; perAttackBp: number; maxStacks: number }
  /**
   * 累计攻击 every 次，对全体敌人造成一次伤害（拉特兰）。
   *
   * 【两种算法，数据里二选一】
   *   · `totalAttackBp`：占"全部拉特兰攻击力总和"的万分比（0.0.2 的旧口径）
   *   · `flatDamage`   ：**固定值**（面板单位，不吃任何加成）
   * 0.0.3「干员调整A版」第 6 条明确写了"（固定值）"，
   * 所以现在正式数据走 flatDamage；百分比那条路留着没删，
   * 以后想改回去只动数据表、不用碰引擎。
   *
   * ★★ 0.2.1：`fx` = 发动时播哪套**全场层**特效（渲染层注册表的 id，
   * 见 `board-volley-fx.ts` 的 `BOARD_VOLLEY`）。不写 = 只掉血、不放特效（老行为）。
   * 【为什么挂在"机制"上而不是"档位"上？】因为触发这件事的就是这条机制 ——
   * 三档的齐射是同一套演出、只是伤害不同，特效写在这里三档各写一次即可，
   * 而"哪一档"不影响演出。渲染层只认 id，不认识"拉特兰"。
   */
  | {
      kind: 'attackCountNuke';
      every: number;
      totalAttackBp?: number;
      flatDamage?: number;
      /** 发动时播的全场层特效 id（见 `board-volley-fx.ts`） */
      fx?: string;
    }
  /**
   * 血量首次跌破阈值时，攻速（可选还有攻击力）大幅提升。
   *   · 维多利亚：只有攻速，且有时限
   *   · 寻仇者 / “复仇者”：攻速 + 攻击力，**不限时**（durationTicks 不写 = 永久）
   */
  | {
      kind: 'lowHpSurge';
      hpThresholdBp: number;
      speedBp: number;
      /** 0.0.3：同时提升的攻击力（万分比）。不写 = 不加 */
      attackDamageBp?: number;
      /** 时长（tick）。不写 = 触发后永久生效 */
      durationTicks?: number;
      /**
       * ★ 0.2 维多利亚：触发时同时"每秒回复自身生命上限 regenBp"，持续 `regenTicks`。
       * 不写 = 只加攻速（老行为）。
       * ★ 它和 `durationTicks` 是**两个独立时长** —— 攻速只持续 5 秒、
       * 回血却能持续 10 秒（数据表里就是这么写的），所以不能共用一个字段。
       */
      regenBp?: number;
      regenTicks?: number;
    }
  /** 开局给自己一个相当于生命上限百分比的护盾（支援） */
  | { kind: 'startShield'; hpBp: number; durationTicks: number }
  /** 队伍里血量最高的成员获得攻击力加成；他死了由下一个继承（罗德岛） */
  | { kind: 'highestHpCarrier'; attackDamageBp: number }
  /** 把"某属性的全队总和"按比例分给全队（重装：护甲总和的 20%/30%） */
  | { kind: 'auraFromSum'; source: 'armor' | 'magicResist'; ratioBp: number }
  /** 只有当队伍里恰好有 N 个带这个标签的棋子时才生效（领导人：恰好 1 个） */
  | { kind: 'soloRequires'; exactly: number }
  /**
   * 每有 1 个三星干员，全队提升一定比例的全部属性（龙）。
   *
   * 【为什么 values 是一个数组？】
   * 你写的龙是「每有一个 3 星干员，所有干员提升 **20%/30%/50%** 的全部属性」，
   * 而"开启人数"只有一档（3 人）。
   * 也就是说这三个百分比不是三档门槛，而是**第 1/2/3 个三星干员分别对应的加成**。
   * 用数组存最直接，也不用去猜"是累计还是递增"。
   */
  | { kind: 'allStatsByTriple'; values: number[] }
  /**
   * ★ 0.0.3 A 版：每有 1 个"带这个羁绊的三星干员"，我方**全部干员攻击力**提升
   * `perTripleBp`（万分比）。龙专用。
   *
   * 【和 allStatsByTriple 的三点区别（别混用）】
   *   · 数的是**带这个羁绊的三星**（龙三星），不是全队任意三星；
   *   · 只加攻击力，不是全部属性；
   *   · 每个三星都是同一个固定值（不是"第 1/2/3 个分别 20/30/50%"）。
   * 靠 mechanic 上自动填的 `traitId` 认"谁是龙"（见 rules.ts）。
   */
  | { kind: 'attackByTripleTrait'; perTripleBp: number }
  /**
   * ★★ 0.3（用户口径）：按**场上这个羁绊干员的星级总和**提升我方全部干员攻击力。
   *
   * 「重复干员只计算最高星级的一个」⇒ 先按 defId 分组取 max(star)，再把星级加起来；
   * 最后 `攻击力 += 攻击力 × (perStarBp × 星级总和)`。
   * 每星 2% / 3% / 5%（= 200 / 300 / 500）由各档自己写。
   *
   * 【和 `attackByTripleTrait` 的区别】那条数的是"有几个三星"，一条 12%；
   * 这条数的是"一共几颗星"，一颗 2/3/5% —— 两星干员也算，只是算 2 颗。
   */
  | { kind: 'attackByTraitStars'; perStarBp: number }
  /** 回合结束时，每有一个未阵亡的干员给金币（奸商） */
  | { kind: 'goldPerSurvivor'; goldEach: number }
  /**
   * **飞行单位**：攻击距离不超过 `immuneToRangeAtMost` 的敌方单位**打不到它**。
   *
   * 【为什么写成"免疫到某个距离"而不是写死"近战打不到"？】
   * 因为"近战"这个词在数据里没有对应字段 —— 只有 `range` 这个数字。
   * 写成阈值之后：你的设计是"攻击距离为 1 的打不到"（= 1），
   * 以后想改成"距离 ≤2 的打不到"只要改一个数字，不用动代码。
   *
   * 【注意用的是"加成之后的射程"】
   * 炮手羁绊会给炮手 +2 射程。所以判断时看的是棋子**当前**的射程，
   * 而不是它数据表里的基础射程 —— 否则"被羁绊加成成远程的近战"会被误判。
   */
  | { kind: 'airborne'; immuneToRangeAtMost: number }
  // ============================================================
  //  ★ 0.2 羁绊改版新增的机制
  // ============================================================
  /**
   * 每次攻击有 `chanceBp` 概率追加一次同样的普攻（剑士）。
   * ★ 追加的那一击**不会**再触发本机制（"连击不会再次触发连击效果"）。
   */
  | { kind: 'probDoubleAttack'; chanceBp: number }
  /**
   * 每次攻击给目标叠一层「燃烧」（炎）。
   * 每层每秒造成目标**最大生命** `perSecondBp` 的法术伤害，最多 `maxStacks` 层；
   * 每次被附着都会把持续时间重置成 `durationTicks`。
   */
  | { kind: 'burnStack'; perSecondBp: number; maxStacks: number; durationTicks: number }
  /**
   * 队伍级：每 `intervalTicks` 给**全体友方**回 `manaBp`（万分比）的技力（法术羁绊）。
   * 同一支队伍里多条同种机制只跑一条（由 id 最小的那名干员驱动）。
   */
  | { kind: 'teamManaRegen'; intervalTicks: number; manaBp: number }
  /**
   * ★ 0.2 MujicaAve：带这条机制的棋子**自己**每 `intervalTicks` 回复
   * `manaBp`（万分比）的技力。
   *
   * 【和 `teamManaRegen` 的区别（别混用）】
   *   · `teamManaRegen` 是**队伍级**：一条机制让**全体友方**一起回（法术羁绊），
   *     所以它必须"只让 id 最小的持有者驱动一次"，否则人手一份会回 N 倍；
   *   · 这一条是**成员级**：谁的机制谁自己回，各回各的（MujicaAve 写的是
   *     "**MujicaAve 干员**每秒回复 X% 的技力"，只给成员）。
   * 所以它不需要"发言人"，就挂在周期计时器上各自跑。
   */
  | { kind: 'selfManaRegen'; intervalTicks: number; manaBp: number }
  /**
   * ★★ 0.2 MujicaAve：**fever（热度）**。
   *
   * 这是本项目第一个"**跨回合的玩家级资源**"，所以一条机制里同时装着
   * 「战斗侧要用的」和「回合侧要用的」两半参数 —— 分开写两张表只会让
   * "3 档到底是多少"必须去两个地方对照。
   *
   * ---- 战斗侧（内核读）----
   *   · `onHit`  自己**受到一次攻击**时，给本方加多少点（三档都是 1）；
   *   · `onDeal` 自己**造成一次伤害**时给本方加多少点（3 档 0、5/7 档 1）；
   *   · `skillDurationTicks` 消耗 fever 后那一场的"特殊技能窗口"时长（5/10/15 秒）。
   *
   * ---- 回合侧（客户端 / 服务端的回合流程读）----
   *   · `lossMultiplierBp` 打输时，**这一场获得的 fever** 乘多少（15000 = ×1.5）；
   *   · `winDecayBp` 打赢时从**当前总额**里扣掉的比例（3000 = 30%；7 档 0 = 不扣）；
   *   · `refundBp` 打输时把**上次消耗掉的那一笔**退回来多少（5000/7000/10000）；
   *   · `doubleAtRoundEnd` 7 档：回合结束时把当前 fever 翻倍；
   *   · `thresholds` 达到哪些数字时弹「保留 / 消耗」（100/300/500/1000/1500/2000/3000）。
   *
   * ★ 数值一律万分比（`*Bp`），别写成百分数 —— 这是本项目头号事故源。
   */
  | {
      kind: 'fever';
      onHit: number;
      onDeal: number;
      skillDurationTicks: number;
      lossMultiplierBp: number;
      winDecayBp: number;
      refundBp: number;
      doubleAtRoundEnd?: boolean;
      thresholds: number[];
    }
  /**
   * 每 `intervalTicks` 检查一次：**当前没有护盾**时，获得"已损失生命 × missingHpBp"的护盾（重装）。
   * 护盾存在期间不会再次获得（时间到了会重新攒计时器）。
   */
  | { kind: 'periodicShield'; intervalTicks: number; missingHpBp: number }
  /**
   * 自己阵亡时，对周围 3×3（8 格）的敌人造成相当于"累计吸血量 × ratioBp"的法术伤害（萨卡兹）。
   * 累计吸血量 = 这场战斗里自己靠 `lifestealBp` 实际回复的血量总和。
   */
  | { kind: 'deathExplosion'; ratioBp: number }
  /**
   * 战斗中**第一个**阵亡的友方，把自己 `ratioBp` 的数值（生命/攻击/攻速/双抗）传给最近的友方（罗德岛）。
   * `maxTransfers` = 每场最多传几次（第一、二、三个阵亡者……依次触发）。
   */
  | { kind: 'deathStatTransfer'; ratioBp: number; maxTransfers: number }
  /**
   * 普攻造成"攻击力 × attackBp"的**法术**伤害，而不是原来的物理伤害（术士）。
   * `slashBp` 不写时按 10000（= 攻击力 100%）走。
   */
  | { kind: 'magicAttack'; attackBp: number }
  /** 开局给全队一份限时的双抗百分比加成（支援）。value 是万分比 */
  | { kind: 'startResist'; armorBp: number; magicResistBp: number; durationTicks: number }
  /**
   * ★ 0.2：开局给自己挂一个**常驻被动**修正包（`passive: true`，不挡回蓝）。
   *
   * 【为什么闪避/全能吸血不走 effects 而走这里？】
   * 因为 `applyTraitBonuses` 只能改「基础属性」那一层（血/攻/双抗/射程…），
   * 而闪避走的是 `mods.evasionPhysicalBp` / `evasionMagicBp`、
   * 全能吸血走的是 `mods.lifestealBp` —— 它们都是**战斗修正包**里的字段。
   * 走 addBuff(passive) 这条既有通路，collectMods 一汇总就生效，
   * 也天然吃得到"任何方式造成伤害都吸血"（dealDamage 第 4 步统一结算）。
   *
   * 卡西米尔（物理/法术闪避）与萨卡兹（全能吸血）用它。
   */
  | { kind: 'startSelfBuff'; stats: SkillStats }
  /**
   * 回合胜利时给带标签的干员叠一层"生命上限 + 攻击力"（罗德岛）。
   * ★ 这是**跨回合**的：层数存在 client 的 GameState 里随阵容上报（见 traitStackOf）。
   */
  | { kind: 'roundTraitStack'; hpBp: number; attackDamageBp: number; maxStacks: number }
  // ============================================================
  //  ★ 0.0.3 藏品新增的机制
  // ============================================================
  /**
   * 【为什么藏品的机制直接加到这里，而不是另开一个 ItemMechanic？】
   * 因为对战斗循环来说它们和羁绊机制**是同一回事** ——
   * 都是"挂在某个棋子身上、在固定触发点读一下"的行为。
   * 分开的话 rules.ts 的每个触发点都要写两遍同样的循环，而且以后
   * 加一个机制就得记得改两处（正是记忆里那条"同一个动作只允许一处实现"）。
   * 所以共用这一个联合类型，只是注释里标清楚"哪些是藏品用的"。
   */
  /** 每攻击 every 次，给自己挂一个限时/限次修正包（突袭手雷：每 3 击下一击 +70%） */
  | { kind: 'everyNthAttack'; every: number; stats: SkillStats; attacks?: number; durationTicks?: number }
  /** 被**距离自己 minDistance 格以上**的敌人攻击时，受到的伤害降低 ratioBp（防爆盾） */
  | { kind: 'farAttackReduction'; minDistance: number; ratioBp: number }
  /** 受到的所有伤害降低 ratioBp（奇缘面具，全队型） */
  | { kind: 'damageReduction'; ratioBp: number }
  /** ★ 队伍级：每 intervalTicks 给**全体**我方存活干员回复 amount 点生命（急救药箱） */
  | { kind: 'teamRegen'; intervalTicks: number; amount: number }
  /** 击杀敌人时，有 chanceBp 概率立刻获得 gold 金币（铳骑之威） */
  | { kind: 'goldOnKill'; chanceBp: number; gold: number }
  /** 自己阵亡时，有 chanceBp 概率立刻获得 gold 金币（黄沙罗盘） */
  | { kind: 'goldOnDeath'; chanceBp: number; gold: number }
  /**
   * ★ 0.2 新羁绊「不屈」：阵亡时**有概率站起来**。
   *
   * 【和 `reborn`（野怪二阶段 / M3 茧甲）是什么关系？】
   * 两条平行的复活来源，但**优先级不同**（用户口径）：
   *   · `reborn`（**必定**复活，茧甲 / 多阶段 Boss）**先判**；
   *   · 这一条是**概率**复活，排在 `reborn` 之后当兜底。
   * 所以带茧甲的棋子第一次死一定走茧甲那条，不屈留给后面那次死 —— 见 `killUnit`。
   *
   * 【★ 每次死都掷，但每成功一次概率递减】
   * 用户口径：「改成每次死都掷，但是加一个限制，每复活一次复活概率 -10%」。
   * 递减量是全局常量 `UNYIELDING_CHANCE_DECAY_BP`（1000 = 10 个百分点），
   * 所以 `chanceBp` 写的是**第一次**的概率，后面的由内核按成功次数递减：
   *   `本次概率 = max(0, chanceBp - 已复活次数 × 1000)`
   * ⇒ 2/3/5 人档实际上分别能站起来最多 3 / 4 / 5 次。
   *
   * 【复活之后给什么？】
   *   · `attackSpeedBp` 的攻速（**永久**、复活几次叠几次；和野怪二阶段的 `attackSpeedBp`
   *     同一个算法：直接乘在 `unit.attackSpeed` 上，不走限时包，所以不会在特效栏里留一条永不消失的 buff）；
   *   · **立刻释放一次技能** —— 实现方式是"把法力灌满 + 让它这一帧就行动"，
   *     于是走的是**正常的施法那一处实现**（不另开一套施法逻辑，见 `killUnit` 的注释）。
   */
  | {
      kind: 'unyielding';
      /** **第一次**复活概率（万分比，3000 = 30%）；之后每次成功 -1000 */
      chanceBp: number;
      /** 每次复活后永久增加的攻速（万分比，2000 = +20%） */
      attackSpeedBp: number;
    }
  /** 开启技能时给自己挂一个限时修正包（骑士戒律：+50% 攻击力/攻速，10 秒） */
  | { kind: 'onCastBuff'; stats: SkillStats; durationTicks: number }
  /** ★ 队伍级开局：敌方所有单位护甲/魔抗降低 armorBp（万分比，奇缘面具不是它，是迷迭香之拥） */
  | { kind: 'startEnemyShred'; armorBp: number; magicResistBp: number }
  /**
   * ★ 队伍级开局：我方所有单位获得 hits 次"免疫伤害"（药枚"回合开始获得一次免疫护盾"）。
   * 复用已有的 immuneHits 机制 —— 每次挨打消耗一次，不扣血也不吃护盾。
   */
  | { kind: 'startTeamImmunity'; hits: number }
  // ============================================================
  //  ★ 0.0.3 野怪技能新增（19 只野怪的被动 / 周期效果）
  // ============================================================
  /** 攻击时无视目标 ratioBp 的护甲（双持剑士「无视 10% 物抗」） */
  | { kind: 'armorPen'; ratioBp: number }
  /**
   * 攻击命中时给目标挂"流血"：每 intervalTicks 扣目标**最大生命**的 ratioBp，
   * 持续 durationTicks。拾荒者「5 秒内每秒扣最大生命 1%」。
   */
  | { kind: 'bleed'; ratioBp: number; intervalTicks: number; durationTicks: number }
  /**
   * 对**残血目标**增伤：目标血量百分比 ≤ hpThresholdBp 时，造成的伤害 ×(1 + ratioBp)。
   * “盛怒”「攻击生命值低于一半的干员时伤害 +50%」。
   */
  | { kind: 'executeBonus'; hpThresholdBp: number; ratioBp: number }
  /** 免疫眩晕（W「被动：免疫眩晕」） */
  /**
   * ★ 0.1.3：**护送型召唤物**（血骑士的凝血之刃）。
   *
   * 行为完全由这个机制接管：**不索敌、不攻击**，只朝 `targetDefId` 那个单位走；
   * 走到 `range` 格内就"送达"——给主人治疗 + 挂一份限时属性包，然后自己消失。
   * 主人阵亡则自己一起消失（「若血骑士死亡，则场地上所有凝血之刃一起死亡」）。
   *
   * 【为什么不用 `noAttack` + 普通 AI？】
   * `noAttack` 会连走位一起跳过（那是给"根本打不出伤害的棋子"用的），
   * 而刀刃必须**朝主人走**；普通 AI 又是"朝最近的敌人走"—— 两个都不对。
   */
  | {
      kind: 'escort';
      targetDefId: string;
      /** 贴到主人多少格内算"送达" */
      range: number;
      /** 送达时给主人的治疗（按主人最大生命的万分比，800 = 8%） */
      healBp?: number;
      /** 送达时给主人挂的属性包 */
      stats?: SkillStats;
      /** 上面那份包的持续时间（tick，200 = 10 秒） */
      buffTicks?: number;
    }
  /** 免疫眩晕（小领袖 / Boss 自动附带，见 monster-data 的 STUN_IMMUNE_TIERS） */
  | { kind: 'stunImmune' }
  /** 击杀敌人时回复自身最大生命的 hpBp（W「击杀干员时回复自身 10% 生命值」） */
  | { kind: 'healOnKill'; hpBp: number }
  /**
   * 「场上有某只同伴才生效」（深池伙友影刃 / 卫队精英是一对）。
   *   · damageType  ：有同伴时把自己的普通攻击改成这个伤害类型（影刃 → 法术）
   *   · selfHealBp  ：有同伴时每隔 intervalTicks 回复自身最大生命的 selfHealBp
   */
  | {
      kind: 'pairRequires';
      requiresDefId: string;
      damageType?: DamageType;
      intervalTicks?: number;
      selfHealBp?: number;
    }
  /**
   * 嘲讽：敌人优先攻击它。
   *
   * ★★ 0.2（用户口径 2）：**所有嘲讽一律只影响周围 2 格**（`movement.ts` 的 `TAUNT_RADIUS`，
   * `selectTarget` 里还会再夹一次上限）。以前"不写 = 全场"（迷迭香的柱子），
   * 一个柱子能把全地图的仇恨都吸走 —— 那条老行为已经没有了。
   * `radius` 现在只是为了"数据自己看得懂"，写什么都会被夹到 2 以内。
   */
  | { kind: 'taunt'; radius?: number }
  /**
   * 周期性效果（不看攻击、也不看法力，到点就触发）。
   * 和 `pulse` 的区别：pulse 是"以自己为中心的一圈"，这里是"全场 / 随机格 / 召唤"。
   */
  | { kind: 'periodic'; intervalTicks: number; effect: PeriodicEffect }
  /**
   * 按**距离**减伤：被距离自己 N 格的敌人攻击时，每远 1 格减 perCellBp，
   * 最多减 maxBp（博卓卡斯替一阶段「每远 1 格 -15%，5 格封顶 -60%」）。
   * 真伤无视它（和 farAttackReduction 同一条规矩）。
   */
  | { kind: 'distanceReduction'; perCellBp: number; maxBp: number }
  // ============================================================
  //  ★ 0.1.1 藏品二版新增的机制（全部复用这个联合类型，理由同上）
  // ============================================================
  /**
   * 残血时**一次性**获得一个护盾（染血辞典「生命值低于 10% 时，仅一次立刻
   * 获得最大生命 50% 的护盾（持续 10 秒）」）。
   *
   * 【为什么单独一个 kind，不写成 battleStart 的护盾？】
   * 因为它的触发时机不是"开局"，而是"血量第一次掉到阈值以下" ——
   * 必须每 tick 盯着血量，且**整场只触发一次**（`used` 标记）。
   */
  | { kind: 'lowHpShield'; hpBelowBp: number; shieldBp: number; durationTicks: number }
  /**
   * 血量越低攻击力越高，到 hpThresholdBp 时达到 maxBonusBp（热辣可可）。
   * 例：「30% 生命值时达到最大可提升攻击力 +100%」→ threshold 3000, max 10000。
   *
   * 【线性插值】bonus = maxBonusBp × (1 - hp/maxHp) / (1 - threshold)，
   * 满血时为 0、到达阈值时正好等于 maxBonusBp，再低也不会超过它。
   */
  | { kind: 'lowHpAttack'; hpThresholdBp: number; maxBonusBp: number }
  /** 血量越低攻速越快（紧急活性剂，+80%）。语义同 lowHpAttack */
  | { kind: 'lowHpSpeed'; hpThresholdBp: number; maxBonusBp: number }
  /**
   * 血量越低**技力（法力）回复越快**（止痛片，30% 生命值时 +2/s）。
   * 单位是"每秒多少点法力"（法力上限 100，见 MANA_MAX）。
   */
  | { kind: 'lowHpManaRegen'; hpThresholdBp: number; maxPerSecond: number }
  /**
   * 对**距离不同**的敌人伤害不同（Blaze 的电锯 / Scout 的狙击镜）。
   *   · mode 'near'：离得**越近**伤害越高（4 格 - 1 格依次 +20%，最高 80%）
   *   · mode 'far' ：离得**越远**伤害越高（1 格 - 4 格依次 +20%，最高 80%）
   *
   * 【为什么一个 kind 覆盖两件藏品？】它们是同一条曲线的两个方向，
   * 分两个 kind 会让"按距离加成"这段计算写两遍（而两份实现早晚会不一致）。
   */
  | { kind: 'distanceBonus'; mode: 'near' | 'far'; perCellBp: number; maxBp: number }
  /**
   * 开局按**周围友军数量**折算成一份固定加成（岩角号「周围 4 格每有一名干员，
   * 攻击力 +10%，战斗开始后增益不会变动」）。
   *
   * 【为什么在开局就折算成固定值，而不是每次攻击现算？】
   * 用户明确写了"战斗开始后增益不会变动" —— 也就是说开局数完就锁死，
   * 之后队友死了也不掉。现算的话会随着人死掉而缩水，不符合描述。
   */
  | { kind: 'startSurroundAttack'; perAllyBp: number; shape?: 'cross' | 'square' }
  /**
   * 战斗开始时，把这份加成挂到**随机一名**我方干员身上（生还者合约）。
   * `scaleBp` 是层数带来的放大（10000 = ×1）。
   */
  | { kind: 'startRandomAllyBuff'; stats: SkillStats; scaleBp?: number }
  /**
   * 每次**开启技能**给自己永久叠一层攻击力（拳经三问「每使用过一次技能，
   * 自身的攻击力 +5%，最多叠加 20 层」）。只在本场战斗内累计。
   */
  | { kind: 'onCastRamp'; perCastBp: number; maxStacks: number }
  /**
   * ★★ 0.2.2 剑士：**开启技能的那一刻**瞬移到「血量最少的敌人」面前那一格，
   * 并让那个敌人眩晕 `stunTicks`（20 tick = 1 秒）。
   *
   * 【"面前那一格"怎么算？】
   * 交给 `findEmptyNear(state, 敌人.格子, 自己的移动方式, { nearerTo: 自己.格子 })`：
   * 它的既定口径就是"先找攻击距离内的空格、同样在距离内时选离发起者最近的"
   * —— 正好是"站到敌人朝我这一面"，而不是越过去绕到背后。
   * 一格都找不到（被围死）时它会退到"离目标最近的空格"，也就是需求里的
   * 「若无位置则找最近的位置」。
   *
   * 【为什么写成"技能触发时机"的机制，而不是写进某个干员的技能？】
   * 这是**羁绊**给全体剑士的效果，走 `caster.trait.mechanics` 才是唯一实现；
   * 写进技能表就得给每个剑士干员各复制一份，早晚有人漏。
   */
  | {
      kind: 'onCastBlinkStrike';
      /** 目标规则，默认 `lowestHpEnemy`（当前生命值最低的敌人） */
      target?: TargetRule;
      /** 一个目标都没有时的兜底规则（默认不兜底） */
      fallback?: TargetRule;
      /** 眩晕 tick 数（20 tick = 1 秒），各档自己写 */
      stunTicks: number;
    }
  /**
   * ★★ 0.2.2 剑士（**只有 6 / 9 人档**）：**瞬移之后**，这一档羁绊给的
   * **攻击力提升 / 攻击速度提升翻倍**（仅限羁绊那部分，不含藏品/技能的加成），
   * 本场战斗内一直有效，每个棋子只翻一次。
   *
   * 【为什么要单独一种机制，而不是直接给个 +30% 的 buff？】
   * 因为"翻倍"要按**这一档实际给的 bp** 去算：6 人档是 +30%/+40%，
   * 9 人档是 +55%/+60%，写死一个数就会出现"某一档翻错了"。
   * 实现见 `skills.ts` 的 `doubleTraitBonusAfterBlink`（读 `UnitState.traitBonusBp`）。
   *
   * 【3 人档为什么不给？】用户明确要求「3 剑士不加这个效果」——
   * 3 人就能凑齐的羁绊再送一个翻倍，前期强度会失控。
   */
  | { kind: 'blinkDoublesTraitBonus' }
  /**
   * 玩家金币达到 goldAtLeast 时，每 intervalTicks 对**全场敌人**造成 damage 点
   * 法术伤害并眩晕 stunTicks（苍桐「金币为 70 及以上时，每隔 10 秒对全场敌人造成
   * 一次 100 点法术伤害和 1.5 秒的晕眩」）。
   *
   * 【为什么把"金币门槛"放进战斗内核？】
   * 因为金币是**开场就固定**的（备战期不变化），解析时折成一个布尔值即可
   * （`active`），战斗循环只读它。所以这里存的是"已判定过的结论"。
   */
  | { kind: 'goldThresholdNuke'; goldAtLeast: number; active: boolean; intervalTicks: number; damage: number; damageType: DamageType; stunTicks: number }
  /**
   * ★ 队伍级：全队"受到的治疗 / 生命回复"提升 ratioBp（活玫瑰 +8% / 涌动之餐 +30%）。
   * 和 A 类的 `combat.healingBp` 是同一件事，只是作用范围是全队。
   */
  | { kind: 'teamHealingBp'; ratioBp: number }
  /**
   * ★ 队伍级开局召唤（支援防暴桩的假人 / 天师锦囊的炎佑）。
   *
   * 【为什么血量/攻击力写在机制里，而不是让内核回表里取？】
   * 因为这两只召唤物的数值**随回合数成长**（假人 1000→1900，炎佑 500→1000），
   * 而战斗内核根本不知道现在是第几回合。所以由 `resolveSharedItems`
   * 在组阵容时按回合算好，塞进这条机制里；内核只管照数召唤。
   */
  | {
      kind: 'startSummon';
      summonId: string;
      count: number;
      hp?: number;
      attackDamage?: number;
      /**
       * ★ 0.2 卡西米尔援军：「战斗开始在生命值最高的友方旁边召唤」。
       * 不写 = 旧行为（自己半场最靠前线那一列往里找空格），藏品用的就是默认值。
       */
      placement?: 'frontColumn' | 'besideHighestHpAlly';
    };

/** 周期性效果的种类（配合 TraitMechanic 的 `periodic` 使用） */
export type PeriodicEffect =
  /** 对**全体敌人**造成一次伤害：数值 = 自己攻击力 × attackBp */
  | { type: 'allEnemiesDamage'; attackBp: number; damageType: DamageType }
  /**
   * 对**场上随机若干格**落雷：对每格里的所有单位（不分敌我）造成 power 点伤害。
   * `cells` 不写 = 1 格。奎隆是"每 4 秒随机 5 格"。
   */
  | { type: 'randomCellStrike'; power: number; damageType: DamageType; cells?: number }
  /** 召唤若干只（放在自己所在列的最上/最下两端） */
  | { type: 'summon'; defId: string; count: number };

/**
 * ★ 0.1.1：状态效果的**种类**。
 *
 * 【它是什么？】
 * 战斗里"棋子身上正生效着哪些效果"的统一分类 —— 流血 / 隐匿 / 无敌 / 飞行 /
 * 嘲讽 / 眩晕 / 护盾 …。每一种的中文名、图标、颜色、说明都登记在
 * `status-effects.ts` 的 `EFFECT_DEFS` 里（那才是唯一真相）。
 *
 * 【为什么类型放在这里，表放在那里？】
 * 因为这里的类型要给**数据表**用（新效果要能写进机制/被动），
 * 而表本身只是"给人看的元数据"，和战斗逻辑无关 —— 放一起会让内核
 * 白白依赖一堆界面文案。和 `ItemSlot` / `ItemRarity` 的分工是同一个思路。
 */
export type EffectKind =
  | 'bleed'
  | 'dot'
  /**
   * ★ 0.2：**燃烧**（炎国羁绊"每次攻击附着"的那个减益）。
   *
   * 【为什么不并进 `dot`？】因为燃烧是**可叠加**的（最多 5 层），
   * 而 dot 是"一个持续伤害"，界面上按种类去重后只留一条 ——
   * 于是 5 层燃烧和 1 层长得一模一样，玩家看不出有没有叠上去（用户报的就是这个）。
   * 单独一类之后，界面上可以显示"燃烧 ×5 · 剩 5 秒"。
   */
  | 'burn'
  | 'stun'
  /** ★ 0.1.3：战栗 —— 不能普通攻击（还能走位、还能放技能），和眩晕不是一回事 */
  | 'disarm'
  | 'downed'
  | 'debuff'
  | 'stealth'
  | 'invincible'
  | 'shield'
  | 'immune'
  | 'cannotDie'
  | 'evade'
  | 'reflect'
  | 'lifesteal'
  | 'regen'
  | 'buff'
  | 'ammo'
  /**
   * ★★ 0.2 机械师：「破盾子弹」——攒着的几层备用护盾。
   * 盾被打空时消耗一颗、再补一层，同时炸一下周围。
   * 和 `ammo`（按次数消耗的攻击强化）不是一回事：那个改的是攻击倍率，
   * 这个换的是护盾层数。
   */
  | 'bullets'
  | 'airborne'
  | 'taunt'
  | 'revive'
  | 'stunImmune'
  | 'damageReduction'
  | 'aura';

/**
 * 上面那些机制里，可以指定"给谁"的（不写就跟随羁绊的 scope）。
 * 用一个交叉类型加上可选字段，避免在每个成员里重复写一遍。
 */
export type ScopedMechanic = TraitMechanic & {
  scope?: TraitScope;
  /**
   * 这条机制是哪个羁绊给的（解析羁绊时自动填上）。
   *
   * 【为什么要记？】
   * 战斗循环里的机制是"拍平"的 —— 一个棋子身上可能同时挂着拉特兰和剑士两条机制。
   * 但界面上的「羁绊详情日志」要按羁绊分组显示（"拉特兰：已累计 12/30 次"），
   * 所以事件里需要带上羁绊 id。数据表里不用写，resolveUnitMechanics 会填。
   */
  traitId?: string;
};

/**
 * 一个棋子身上**已经在开战时解析好**的羁绊机制。
 *
 * 【为什么要"解析好"再存到棋子上？】
 * 因为战斗循环里每一步都要检查"这个棋子有没有某个机制"。
 * 如果每次都回去查羁绊表、数标签、算档位，一是慢，二是很容易
 * 把"谁受益"算错（那正是之前踩过的坑）。
 * 开战时一次性算清楚、挂在棋子上，战斗循环只读这里 ——
 * **战斗主循环完全不需要知道任何羁绊的名字**。
 */
export interface UnitTraitRuntime {
  /** 这个棋子身上的机制（数值都已经按档位算好） */
  mechanics: ScopedMechanic[];
  /** 已经攻击了几次（剑士 / 远射 / 拉特兰用） */
  attackCount: number;
  /** 已经叠了多少层攻速（剑士 / 远射用） */
  speedStacks: number;
  /** **永久**叠加的攻速加成（万分比）：剑士每 3 次 +10%、远射每次 +2% */
  bonusAttackSpeedBp: number;
  /**
   * **临时**的攻速加成（万分比）和它还剩多少 tick（维多利亚的低血爆发）。
   *
   * 【为什么要和 bonusAttackSpeedBp 分开存？】
   * 因为它们的生命周期完全不同：一个是永久叠层，一个是"触发后持续 N 秒"。
   * 混在一个数字里，到期时就得反推"该减掉多少" ——
   * 而那个反推一旦算错，攻速就再也回不到正确值（而且很难查）。
   * 分开存之后，到期只要把 surgeSpeedBp 清零就行。
   */
  surgeSpeedBp: number;
  /** ★ 0.0.3：低血爆发同时给的攻击力加成（万分比，寻仇者 / “复仇者”） */
  surgeAttackBp: number;
  surgeTicks: number;
  /** 低血爆发是否已经触发过（每个棋子只触发一次） */
  surgeUsed: boolean;
  /**
   * ★ 0.0.3：周期类机制（`periodic`）各自的计时器，下标和 mechanics 对齐。
   * 每次 tick 各自 +1，到 intervalTicks 归零并触发。
   */
  periodicTimers: number[];
  /**
   * 上一次触发"累计攻击核爆"时的攻击次数。
   *
   * 【注意：拉特兰的计数已经改成队伍共享了】（你报的第 8 条）
   * 现在实际生效的计数在 `BattleState.nukeAttackCount` / `nukeLastAt` 上，
   * 这个字段保留只是为了不动已有数据结构（剑士/远射仍在用 attackCount）。
   */
  lastNukeAt: number;
  /**
   * ★ 0.1.1 藏品二版：残血护盾（染血辞典）是否已经触发过。
   * 设计稿写的是"仅一次"，所以整场只允许触发一次。
   */
  lowHpShieldUsed?: boolean;
  /**
   * ★ 0.1.1 藏品二版：已经开过几次技能（拳经三问「每使用过一次技能攻击力 +5%」）。
   * 每场战斗从 0 开始，上限由 mechanic.maxStacks 决定。
   */
  castStacks?: number;
  /**
   * ★ 0.1.1 藏品二版：止痛片的"低血回蓝"小数累加器。
   *
   * 【为什么不在 tickSkill 里复用 `skill.manaAccum`？】
   * 那个累加器属于"棋子自带的回蓝方式"（manaSource:'auto'），
   * 混在一起的话，一个既能自动回蓝又带止痛片的棋子会互相吃掉余数。
   */
  manaRegenAccum?: number;
}

/** 某个羁绊当前生效到第几档 */
export interface ActiveTraitLevel {
  traitId: string;
  /** 场上带这个标签的棋子数 */
  count: number;
  /** 生效的档位下标（-1 表示一档都没到） */
  tierIndex: number;
}

export interface TraitEffect {
  type: TraitEffectType;
  /** 数值。单位取决于 type，见上面每种类型的说明 */
  value: number;
  /**
   * 这一条加成给谁。不写就跟随所属羁绊的 scope。
   *
   * 【为什么允许单条覆盖？】
   * 因为有些羁绊是"混合"的。比如重装：
   *   · 「重装干员提升 50% 防御力」-> 只给自己人
   *   · 「将重装防御力总和的 20% 分给所有我方干员」-> 全队
   * 一个 scope 表达不了，所以在效果这一层再给一次机会。
   */
  scope?: TraitScope;
}

/**
 * 羁绊定义：世界书里的一条羁绊。
 *
 * 【这张表和新棋子表一样，是给「策划」填的】
 * 你只需要写：叫什么名字、是种族还是职业、几档、每档什么效果。
 * 代码会自动统计场上每个标签有几个棋子，然后算出该给哪些棋子加什么。
 */
export interface TraitDef {
  id: string;
  name: string;
  kind: TraitKind;
  /** 从少到多排列的档位。比如 [{count:2,...},{count:4,...}] */
  tiers: TraitTier[];
  /**
   * 加成给谁。**这一条决定了羁绊是"自己人受益"还是"全队受益"**。
   *
   *  - `'members'`（默认）：只有带这个标签的棋子吃到加成。
   *    例：「剑士 3 个 → 剑士 +30% 攻击力」，法师不吃。
   *    这是自走棋羁绊的常规做法，也是绝大多数羁绊该用的。
   *  - `'team'`：全队都吃到加成，不管有没有这个标签。
   *    例：「领导人 2 个 → 全队 +10% 生命」。适合"光环型"羁绊。
   *
   * 【为什么一开始没这个字段，后来又加了？】
   * 最早的实现把一支队伍所有羁绊的效果合并成一个扁平列表，
   * 再套到**每一个**棋子上 —— 于是「全体重装 +30 护甲」实际变成了「全队 +30 护甲」。
   * 数字上看不出来（棋子确实变强了），但描述和数据表对不上，是错的。
   * 现在加成按「给谁」分开算，两种羁绊都能正确表达。
   */
  scope?: TraitScope;
  /**
   * ★ 0.2：**不需要凑够档位**就生效的机制 —— 只要棋子带这个标签就吃。
   *
   * 术士那条"即使不激活术士羁绊，普通攻击也会造成等同于攻击力 100% 的法术伤害"
   * 就是这种：它不属于任何一档，而是这个**标签本身**的固有性质。
   *
   * 【为什么不直接在 rules.ts 里判断 `traits.includes('caster')`？】
   * 因为那是"按 id 写死"——以后给新干员挂上术士标签时，代码不会自动跟上，
   * 而且这个规则会散落在战斗循环里。写成数据之后，
   * "谁有这个固有性质"完全由羁绊表决定（见 trait-data.ts 的 caster.innate）。
   */
  innate?: TraitMechanic[];
}

/** 羁绊加成的作用范围 */
export type TraitScope = 'members' | 'team';

/** 羁绊定义表：key 是标签 id（和 UnitDef.traits 里的词对应） */
export type TraitDefTable = Record<string, TraitDef>;

/**
 * 一支队伍实际吃到的羁绊加成。
 *
 * 这是「一次性算好的结果」，会被塞进 TeamSetup 一起参与战斗。
 * 之所以存成数据而不是让战斗循环自己去算，是因为：
 *   · 战斗循环只关心「棋子属性是多少」，不关心属性是怎么来的
 *   · 联机时这份数据会跟着阵容一起广播，客户端不需要重算一遍羁绊逻辑
 *   · 想验证「到底吃到了什么加成」时，直接看这份数据就行，不用推
 */
export interface TraitBonus {
  traitId: string;
  effect: TraitEffectType;
  /** 和 TraitEffect.value 同单位 */
  value: number;
  /**
   * ★ 0.3.31：这条加成的作用范围（`computeTraitBonuses` = team /
   *   `computeUnitTraitBonuses` = members）。
   *
   * 【为什么必须带出去？】
   * 因为 `healingBp` 这一个效果有两种完全不同的含义，只看 `effect` 分不出来：
   *   · 全队型（支援）—— **受到**的治疗 +X%（跟着"被治疗的人"走）
   *   · 本人型（治疗）—— **打出去**的治疗 +X%（跟着"治疗干员"走）
   * 以前没带范围，内核只好一律当成"受治疗"，于是"治疗"羁绊被静默丢弃、凑齐了也没效果。
   */
  scope?: TraitScope;
}

/** 羁绊在界面上的展示信息（给客户端画面板用） */
export interface TraitStatus {
  traitId: string;
  name: string;
  kind: TraitKind;
  /** 场上这个标签有几个棋子 */
  count: number;
  /** 当前生效的是哪一档（需要几个）；没生效则为 null */
  activeAt: number | null;
  /** 下一档需要几个；已满级则为 null */
  nextAt: number | null;
  /** 当前生效档位的说明 */
  activeDesc: string | null;
  /**
   * ★ 0.1.4：「恰好 N 名才生效」的条件（目前只有领导人）。
   *
   * 【为什么界面需要知道这件事？】
   * 这种羁绊"数量够了反而失效"，而 `count / tier.count` 是表达不出这一点的 ——
   * 上 2 个领导人会显示成 "2/1"，玩家只会以为界面坏了。
   * 拿到 `ok === false` 之后才能写人话：「已失效：必须恰好 1 名（当前 2 名）」。
   */
  solo?: { exactly: number; ok: boolean };
}

// ============================================================
// 战斗事件日志（BattleLog）
// ============================================================

/**
 * 战斗过程被记录成一串「事件」。
 *
 * 这是本项目最核心的设计：
 *   - 服务器的战斗就是「算出这串事件」
 *   - 客户端的演出就是「按顺序播放这串事件」（第 t 个 tick 发生的事，就在动画里演出来）
 *   - 录像回放 = 把这串事件存下来重新播
 *   - 单元测试 = 断言这串事件符合预期
 * 一份数据，四种用途。
 */

interface EventBase {
  /** 发生在第几个 tick */
  t: number;
}

export type BattleEvent =
  | (EventBase & { type: 'spawn'; unitId: number; team: 0 | 1; defId: string; star: number; cell: Cell; maxHp: number })
  /**
   * 棋子挪了一格（或"被挪"了几格）。
   *
   * ★ 0.0.3：`instant` 用来区分**走路**和**强制位移**。
   *   · 不写  = 走路（`tryMoveToward` 一格一格挪）——
   *     客户端会把它演成一段平滑滑行 + 走路动作；
   *   · `true` = 强制位移（技能瞬移 / 击退 / 开局站位的瞬移）——
   *     客户端按"原本那套快速归位"处理，**不播走路动画**。
   *
   * 【为什么不放进校验和？】
   * 校验和只混 `unitId` 与 `to`（见 computeChecksum 的 move 分支）——
   * 这个字段纯粹是"给表现层的提示"，不参与战斗复现，
   * 所以加了它，服务端与客户端的 checksum 一个数都不会变（有测试钉住）。
   */
  | (EventBase & { type: 'move'; unitId: number; from: Cell; to: Cell; instant?: true })
  /**
   * ★ 0.2：`fx` 是**纯表现层**的弹道标记（来自 `attackProfile.fx`，例如祥子的 `'note'`），
   * 渲染层据此决定"这一下画成音符还是普通火花"。
   * ★ 它**不进校验和**（`computeChecksum` 的 attack 分支只混 unitId/targetId）——
   *   和 `slash` 事件同一个思路：加了它，联机两边的 checksum 一个数都不会变。
   */
  | (EventBase & {
      type: 'attack';
      unitId: number;
      targetId: number;
      attackType: AttackType;
      fx?: string;
      /**
       * ★ 0.2.1：普攻的贴图特效（来自 `UnitDef.combatFx`）。
       * 渲染层拿这个 key 查 `three/sequence-fx.ts` 的 `COMBAT_FX`，决定枪口/命中/击杀三张图。
       * ★ 纯表现层：不进校验和（attack 分支只混 unitId/targetId），不写 = 用原来那套程序化特效。
       */
      combatFx?: string;
      /**
       * ★ 0.2.1：**这一次攻击里是第几段**（连击才写，从 0 开始；单发不写）。
       *
       * 【为什么需要？】
       * `multiHit: 3`（维什戴尔 1/2 星）会在**同一 tick 连报 3 条 attack** ——
       * 3 张命中爆炸会在同一帧叠在一起，看起来只有一次。
       * 渲染层拿这个序号把第 2/3 段的命中特效**依次延后几十毫秒**，
       * 才能看到"连续炸三下"。
       *
       * ★ 纯表现层：不进校验和（attack 分支只混 unitId/targetId）。
       */
      hitIndex?: number;
    })
  | (EventBase & { type: 'damage'; sourceId: number; targetId: number; amount: number; damageType: DamageType; attackType: AttackType; absorbed: number; hpAfter: number; lethal: boolean })
  | (EventBase & { type: 'heal'; sourceId: number; targetId: number; amount: number; hpAfter: number })
  | (EventBase & { type: 'shield'; sourceId: number; targetId: number; amount: number; durationTicks: number })
  | (EventBase & { type: 'status'; sourceId: number; targetId: number; status: 'stun'; durationTicks: number })
  /**
   * 攻击被闪避 / 被免疫掉了（焰尾"75%闪避伤害"、机械师"免疫3次攻击"）。
   *
   * 【为什么要单独一种事件，而不是记一条 0 伤害？】
   * 因为界面上"闪避"和"打了个 0"是完全不同的信息：
   * 前者说明这个棋子有闪避机制，后者看起来像数值算错了。
   * 而且回放时要能一眼看出"这一下为什么没伤害"。
   */
  | (EventBase & { type: 'dodge'; sourceId: number; targetId: number; reason: 'evade' | 'immune' })
  /**
   * 一次「范围效果」发生了 —— 用来在棋盘上画一个方框。
   *
   * 【为什么要单独记一条事件，而不是让界面自己算？】
   * 因为界面（回放）**只读事件日志**，它不知道也不该知道"溅射半径是多少"
   * "这次是治疗还是伤害"。让战斗内核在真正生效的那一刻把范围记下来，
   * 界面照着画就行 —— 这样画出来的框**一定和实际生效的范围一致**，
   * 不会出现"框画得很大但只打到一个人"这种骗人的表现。
   *
   *   kind: 'damage' -> 白色方框（维什戴尔 3 星的 5×5、炮手溅射、范围技能）
   *   kind: 'heal'   -> 绿色方框（夜莺/魔王的回血光环）
   */
  | (EventBase & {
      type: 'zone';
      /** 施法者/来源（画框时也要知道是谁放的） */
      unitId: number;
      /** 范围中心（格子） */
      cell: Cell;
      /** 半径：1 = 3×3、2 = 5×5 */
      radius: number;
      /** 形状（十字和直线也记下来，免得界面把 4 格画成 3×3） */
      shape: SplashShape;
      kind: 'damage' | 'heal';
      /** 方框显示多久（tick）。光环类会一直刷，所以框也就一直亮着 */
      durationTicks: number;
      /**
       * ★ 0.2：施法者**所在的格**。
       *
       * 【为什么只有 `line` 需要它？】直线的方向是"从施法者指向 `cell`"——
       * 光有中心点画不出这条线；之前界面只能按"以中心点为圆心、半径 radius"
       * 画一个大方块，看起来就像"陈的技能是半径 3 格"（用户报的就是这个）。
       * 有了 `from` 就能画出"从施法者朝目标推出去的那 3 格"。
       *
       * ★ 纯表现层：**不进校验和**。`source` 为空（比如某些光环）时是 `undefined`，
       * 界面遇到没有 `from` 的 `line` 会退回画方块（老行为）。
       */
      from?: Cell;
      /**
       * ★ 0.2.1：这一圈范围该配哪套专属特效（`PulseSpec.fx` / `SplashSpec.fx`）。
       * 渲染层拿它查注册表（隐德来希的血镰环绕 / 血镰横扫）。纯表现层，不进校验和。
       */
      fx?: string;
    })
  /**
   * ★ 0.1.3：一次「斩击」挥出去了（锏的疯狂斩击 —— 2 秒 10 刀）。
   *
   * 【为什么不让界面自己按 0.2 秒一拍去估？】
   * 那只是**猜节奏**：技能被打断、棋子中途死了、以后改了跳数，
   * 界面画出来的刀就和真正打出去的伤害对不上（多挥或少挥）。
   * 让内核在**每一跳真正结算的那一刻**记一条，界面照着画就一定对得上 ——
   * 和 `zone` 事件同一个道理。
   *
   * ★ **不进校验和**：它纯属表现层，加了它战斗结果一个数都不会变。
   * 见 `computeChecksum` 里那句 `if (event.type === 'slash') continue;`
   * （和 `move.instant` 同一个思路：给表现层的提示不参与复现）。
   */
  | (EventBase & {
      type: 'slash';
      /** 挥刀的人 —— 特效挂在他身上 */
      unitId: number;
      /** 这一刀的半径（界面拿它决定"刀有多长"、命中火花撒多远） */
      radius: number;
      shape: SplashShape;
    })
  /**
   * ★ 0.2：一次「范围爆炸」炸开了（维什戴尔的 5×5 大招）。
   *
   * 【和 `zone` 有什么区别？为什么不再发一条事件？】
   * `zone` 事件已经带了 `cell` / `radius` / `shape`，渲染层理论上能据此画出爆炸。
   * 但它缺两样：
   *   1. **这是不是技能大招** —— 炮手羁绊的溅射、彩蛋的范围伤害也走同一条路，
   *      它们不该播"维什戴尔 5×5 爆炸"（那套图是量着 5×5 画的，套到 3×3 上就糊了）；
   *   2. **具体播哪一套** —— 不同干员的爆炸长得不一样，得由**数据**说了算。
   * 所以由内核在"数据里写了 `fx`"的那一发上多报一条，渲染层照着注册表取图。
   * 判断只在**内核一处**做（数据里有没有写 `fx`），渲染层不用去推断"这是谁的技能"。
   *
   * ★ **不进校验和**：它纯属表现层，加了它战斗结果一个数都不会变
   * （见 `computeChecksum` 里那句 `if (event.type === 'bloom') continue;`）。
   */
  | (EventBase & {
      type: 'bloom';
      /** 爆炸的中心格（= 被直接命中的那个目标所在格） */
      cell: Cell;
      /** 覆盖几格（维什戴尔的大招是 2 = 周围两格 = 5×5） */
      radius: number;
      shape: SplashShape;
      /** 播哪一套特效（= 数据表 `splash.fx` 的原值，渲染层按它查注册表） */
      fx: string;
    })
  /**
   * ★★ 0.3.2：一个人被**即死**抹掉了（炉芯终曲「无言的期盼」）。
   *
   * 【为什么不复用 `death`？】
   * `death` 是"阵亡"，被即死只是其中一种死法。渲染层需要区分，因为两者读感不同：
   * 普通阵亡是"打完最后一下倒了"，即死是**人凭空被抹掉**（暗心 + 熔红裂隙 + 碎片外飞）。
   * 而 `death` 事件里没有任何字段能区分"这一下是打死还是抹掉"——
   * 加字段等于往战斗事件里塞表现含义，不如单独报一条。
   *
   * 【触发时机】`tickExecute` 里"这一 tick 真的抹掉了人"的那一刻，
   * 每个人一条（`count: 2` 就是两条）。所以它就是离散的 5 次，不是持续。
   *
   * ★ **不进校验和**：纯表现层，加了它战斗结果一个数都不会变
   * （见 `computeChecksum` 里那句 `if (event.type === 'executeFx') continue;`）。
   */
  | (EventBase & {
      type: 'executeFx';
      /** 被抹掉的那个人 —— 特效就挂在他那一格 */
      unitId: number;
      /** 播哪一套（= 数据表 `execute.fx` 的原值；不写则渲染层不播） */
      fx?: string;
    })
  | (EventBase & {
      type: 'buff';
      sourceId: number;
      targetId: number;
      stat: 'attackSpeed' | 'attackDamage';
      bonusBp: number;
      durationTicks: number;
      /**
       * ★ 0.1.1：这条增益是**哪件藏品**给的（只有藏品给的才有）。
       *
       * 【为什么要记？】
       * 生还者合约的「开局随机强化一名干员」是**随机挑一个人**挂上去的 ——
       * 界面要知道"这一场抽到谁了"，只能从这个事件里读 targetId。
       * 光看"身上有个 +20% 攻击的包"是认不出它是藏品给的还是技能给的。
       */
      itemId?: string;
    })
  /**
   * 羁绊给的"光环型"属性加成（重装：把重装护甲总和的一部分分给全队）。
   * 单独一种事件是因为它有两个特点：
   *   · 它**不是技能**，没有施法者也没有持续时间，是永久加成
   *   · 它的数值要等"所有人的属性都算完"才能定，所以只能开局单独结算
   * 记成事件而不是直接改属性，是为了让战斗日志、伤害统计、界面显示
   * 都能看到"这个棋子吃到了多少光环加成"。
   */
  | (EventBase & { type: 'aura'; unitId: number; stat: 'armor' | 'magicResist'; amount: number })
  | (EventBase & { type: 'mana'; unitId: number; amount: number; manaAfter: number })
  /**
   * ★ 0.2.1：一次攻击**额外打到**的那些目标（"额外攻击 1/2 名敌人"）。
   *
   * 【为什么要单独一种事件，而不是多报一条 `attack`？】
   * `attack` 事件参与校验和（混 `unitId`/`targetId`），多报一条就等于改了战斗指纹；
   * 而且其它读 `attack` 的地方（攻击计数、羁绊进度、吸血统计）会**当成又打了一下**。
   * 而这里要的只是"渲染层顺手再连一条弹道" —— 纯表现，所以照 `slash`/`bloom` 的做法：
   * 新开一种事件，`computeChecksum` 里 `continue` 跳过。
   */
  | (EventBase & {
      type: 'attackLink';
      /** 打人的人 */
      sourceId: number;
      /** 额外被打中的那个 */
      targetId: number;
      /** 沿用主人那条攻击事件的弹道样式（数据里的 `tracerFx`） */
      fx?: string;
    })
  /**
   * ★★ 0.2.2：蕾缪安 3 星「强制追思」——**锁住一个地块**（纯表现）。
   *
   * 【为什么内核要专门报这一条？】
   * 那条技能的"锁定"完全是内核内部的账（`SkillRuntime.lockOn.cells`），
   * 渲染层**看不到** —— 没有这条事件，屏幕上就只有 7 秒后突然掉血，
   * 前面那 7 秒是干等的（用户要的正是"被瞄准着"的那段演出）。
   *
   * ★ 和 `slash`/`bloom`/`attackLink` 一样是**纯表现事件**：
   *   `computeChecksum` 里 `continue` 跳过，服务端与客户端指纹完全一致。
   * ★ 只报"锁在哪个格子"，不报"锁的是谁" —— 人可能马上就走开了，
   *   而落点是不动的（技能打的就是地块）。
   */
  | (EventBase & {
      type: 'lockOnMark';
      /** 施法者（画哪一套样式由它的数据决定） */
      unitId: number;
      /** 被锁住的地块 */
      cell: Cell;
      /** 这是第几个落点（从 0 开始）/ 一共几个 —— 界面可用来做"逐个亮起"的节奏 */
      index: number;
      total: number;
      /** 距离引爆还剩多少 tick（渲染层据此决定瞄准镜活多久） */
      ticksLeft: number;
      /** 样式 id（`SkillEffect.lockOn.fx`）；不认识就按默认样式画 */
      fx?: string;
    })
  /**
   * ★★ 0.2.2：同上，**引爆一个落点**（纯表现）。7 个落点各报一条。
   *
   * 为什么不直接复用 `zone`？`zone` 是"范围白框"，它只在**打中了人**的时候才发
   * （`damageArea` 里 `hitAny` 才 `emitZone`）—— 落点空了就一条都不发，
   * 于是"炸了但没打到人"在画面上完全看不见。爆炸演出不能依赖"有没有打到人"。
   */
  | (EventBase & {
      type: 'lockOnBlast';
      unitId: number;
      cell: Cell;
      /** 这一发的影响半径（格）—— 只用来定爆炸尺寸 */
      radius: number;
      shape: SplashShape;
      fx?: string;
    })
  /**
   * ★ 0.2.1：`fx` 是**纯表现层**的特效 id（来自 `SkillDef.castFx` / `star3.castFx`），
   * 渲染层据此播那一套施法演出（见 `three/sequence-fx.ts` 的 `SKILL_FX`）。
   * ★ 不进校验和：`computeChecksum` 的 cast 分支只混 unitId。
   *
   * ★★ 0.2.1 追加：`traitCast` / `boardFx` —— **羁绊级施法**（拉特兰齐射）。
   * 它借用了 `cast` 这个"某一刻发生了件大事"的通道，但**根本不是棋子放技能**：
   *   · `traitCast: true` ⇒ 渲染层不弹通用施法环、**不清空技能条**（法力一点没动）、
   *     战斗日志也不记"XX 释放技能"（那一发由 `trait.trigger` 单独播报）；
   *   · `boardFx` ⇒ 要播的**全场层**特效 id（`board-volley-fx.ts` 的 `BOARD_VOLLEY`）。
   * 两个字段都是纯表现，同样不进校验和。
   */
  | (EventBase & {
      type: 'cast';
      unitId: number;
      skillId: string;
      fx?: string;
      /** 这一发是羁绊/系统级的，不是棋子放技能 */
      traitCast?: boolean;
      /** 羁绊级施法要播的全场层特效 id */
      boardFx?: string;
    })
  /**
   * ★ 羁绊的"进行时"事件（你报的第 6 条：羁绊详情日志）。
   *
   * 【三种 kind 分别在记什么？】
   *   · progress：计数推进了（拉特兰：又打了一下，累计到第 12 次 / 需要 30 次）
   *   · trigger ：计数攒满，效果发动（拉特兰：全体齐射）
   *   · carrier ：吃加成的"人"换了（罗德岛：攻击力加成现在在谁身上）
   *
   * 【为什么不干脆让界面自己数？】
   * "累计了几次攻击"这种事界面当然也能自己数 attack 事件，
   * 但那样界面就得知道"谁是拉特兰成员""阈值是 30 还是 20 还是 10"
   * —— 等于把羁绊规则在界面里重写一遍，改数值时必然漏掉一边。
   * 让内核把"当前进度"如实记下来，界面只负责显示。
   */
  | (EventBase & {
      type: 'trait';
      /** 羁绊 id（laterano / rhodes / …） */
      traitId: string;
      /** 相关的棋子（progress = 计数归属者；carrier = 当前持有者；trigger = 发动者） */
      unitId: number;
      kind: 'progress' | 'trigger' | 'carrier';
      /**
       * progress = **距离下次发动已累计**的次数（发动后归零，界面直接显示 12/30）；
       * carrier  = 加成的万分比；
       * trigger  = 这一次发动**实际造成的伤害总和**（FIX 定点数，已经扣过护盾/护甲/闪避）。
       *            0.0.2 追加：以前记的是"每名敌人吃到的伤害"，界面没法直接显示总和，
       *            所以内核改成累加 dealDamage 的返回值，界面直接 formatDamage 出来就行。
       */
      value: number;
      /** progress 专用：攒到多少次就发动 */
      target?: number;
    })
  | (EventBase & { type: 'death'; unitId: number; team: 0 | 1; remaining: number })
  /**
   * ★ 0.0.3：Boss「倒地等复活」。它**不是死亡**（remaining 不减、格子不释放），
   * 只是接下来 delayTicks 里不能攻击不能移动。回放据此播倒地动画。
   */
  | (EventBase & { type: 'downed'; unitId: number; delayTicks: number })
  /**
   * ★ 0.0.3：Boss 站起来进入新阶段。回放据此把小人换成二阶段素材 / 动作。
   * `artId` 是出图时给的阶段标识（不写 = 沿用本体素材）。
   */
  | (EventBase & {
      type: 'rebirth';
      unitId: number;
      phase: number;
      hpAfter: number;
      /** 换阶段可能改了生命上限（奎隆二阶段 -30%），界面血条要按它算 */
      maxHp: number;
      artId?: string;
    })
  /**
   * ★ 0.0.3：战斗**进行中**产生了一笔金币（藏品：铳骑之威击杀掉金 / 黄沙罗盘阵亡掉金）。
   *
   * 【为什么金币要有自己的事件，而不是打完再算？】
   * 因为这两件藏品都是**概率触发**的，而概率必须走战斗自己的随机数
   * （否则联机两边算出来的不一样）。也就是说"掉没掉金"是战斗过程的一部分，
   * 只有在战斗里掷完骰子才知道结果 —— 所以它必须记进事件流，
   * 让客户端播完战斗后照着事件把金币加上去。
   */
  | (EventBase & {
      type: 'gold';
      /** 拿到这笔钱的是哪一队 */
      team: 0 | 1;
      amount: number;
      /** 触发者（掉金的那件装备的主人） */
      sourceId: number;
      /** 触发原因，只用于日志文案 */
      reason: 'kill' | 'death';
    })
  | (EventBase & { type: 'end'; winner: 0 | 1 | null; reason: 'eliminated' | 'timeout'; hpBpTeam0: number; hpBpTeam1: number });

// ============================================================
// 战斗结果
// ============================================================

export interface BattleState {
  /** 随机数发生器。技能里的概率、暴击都从这里取，保证可复现 */
  rng: Rng;
  /**
   * 棋子定义表。
   *
   * 【为什么战斗状态里要带一份定义表？】
   * 因为有些判断需要"这个棋子是什么"才能做 ——
   * 比如熔泉的"对**非萨卡兹**敌人伤害增加"要查目标的标签，
   * 召唤/陷阱要按 id 找到要生成的那只棋子。
   * 它是只读的，所以不影响确定性（联机两边是同一份数据）。
   */
  defs: UnitDefTable;
  /** 本场战斗的种子，会写进结果里方便排查 */
  seed: number;
  /** 所有棋子，按 id 升序排列（顺序固定 = 确定性） */
  units: UnitState[];
  /** 棋盘占用表：cellToUnit[row * BOARD_W + col] = unitId 或 CELL_EMPTY */
  cellToUnit: number[];
  /** 事件日志 */
  log: BattleEvent[];
  /** 当前 tick */
  tick: number;
  /**
   * 下一个召唤物用哪个 id。
   *
   * 【为什么不用 `units.length`？】
   * 因为单位会被移除（死亡不移除、但召唤物到期会移除），
   * 用长度当 id 迟早会撞车。用一个只增不减的计数器最稳，而且顺序确定。
   */
  nextSummonId: number;
  /** 已经结束了吗 */
  over: boolean;
  winner: 0 | 1 | null;
  /**
   * ★ 拉特兰（累计攻击类羁绊）的**队伍共享**计数器：`[队伍0, 队伍1]`。
   *
   * 【为什么放在 BattleState 上，而不是每只棋子自己记？】（你报的第 8 条）
   * 原来的实现是 `unit.trait.attackCount` —— 每只拉特兰干员**各打各的**：
   * 3 个拉特兰干员各打 10 下，谁都没到 30 下，一次齐射都不发动。
   * 但羁绊的语义是"**这一队**攒了多少下"，所以计数必须是队伍级的：
   * 全队所有拉特兰干员的普攻都往同一个数上加，任意一个人攻击时统一判定。
   * 这样"拉特兰 12 / 30"这条实时进度也才是玩家真正看到的那个数。
   */
  nukeAttackCount: [number, number];
  /** 上一次发动齐射时，该队的共享计数是多少（用来算"距离下次还差几下"） */
  nukeLastAt: [number, number];
  /**
   * ★★ 0.2：开局时每队玩家手里的金币，`[队伍0, 队伍1]`。
   *
   * 【为什么战斗内核需要知道钱？】
   * 因为可露希尔的**技能**写着「（此数值每有 10 金币额外增加 1%，最高上限 5%）」——
   * 而技能是战斗中随时可能放的，没法像老鲤的被动那样"开局烘成固定值"。
   * 金币在备战期之后不会再变，所以开局灌一次、整场读同一个数就行。
   *
   * 【为什么用数组而不是一个数？】两支队伍的玩家各有各的钱，
   * 而战斗内核只知道 team 号 —— 读的时候按施法者的队伍取。
   */
  playerGold: [number, number];
  /**
   * ★ 0.0.3：**队伍级**的"进行时"机制（B 类藏品给的），每队一组。
   *
   * 【为什么不能像羁绊机制那样挂在每个棋子上？】
   * 因为「每 3 秒给**全体**我方回复 100 血」这种效果如果挂在每个棋子上，
   * 8 个干员就会各自触发一次 —— 变成每 3 秒回 800 血。
   * 队伍级的东西必须只有一个**唯一的**执行者，所以单独放在这里、每队一份。
   */
  teamMechanics?: [TeamMechanicRuntime[], TeamMechanicRuntime[]];
  /**
   * ★ 0.2 MujicaAve：本场战斗里**每队攒到的 fever**，`[队伍0, 队伍1]`。
   *
   * 【为什么在战斗里数，而不是去数事件日志？】
   * 因为"受到攻击""造成伤害"的判定分散在 `performAttack` / `dealDamage` 两处，
   * 而事件日志里没有"这队有没有这条羁绊"这个信息 —— 事后数事件等于把那两条
   * 判定再写一遍（而且很容易和真正的结算口径走散）。
   * 所以内核在**真正发生的那一刻**往上加，结果通过 `BattleResult.feverGained` 交出去。
   *
   * ★ 野怪回合不参与：那由回合流程（`isMonsterRound`）拦截，内核不关心。
   */
  feverGained: [number, number];
  /**
   * ★★ 0.3 盟约「命结之秘」：本场战斗里每队**已经用掉几次**"阵亡即复活"，`[队伍0, 队伍1]`。
   *
   * 口径：每场战斗，我方**最先阵亡的前 2 个**干员立刻原地复活一次（各一次）。
   * 所以这是一个**队伍级**的计数器（不是每只棋子一个"used"标记）——
   * 一只棋子复活过之后，它再死还可以再排进"前 2 个"吗？不行：
   * 计数是按**次数**算的，用满 2 次为止，和是谁死的无关。
   */
  covenantRevives: [number, number];
  /** 这一场每队的盟约 id（`undefined` = 没带盟约）。目前只有「命结之秘」在内核里读它 */
  covenantIds: [string | undefined, string | undefined];
}

/** 队伍级机制 + 它自己的计时器（周期类机制要有地方记录"过了多久"） */
export interface TeamMechanicRuntime {
  mechanic: ScopedMechanic;
  /** 距离下次触发还有多少 tick（只对周期类机制有意义） */
  timer: number;
}

export interface BattleResult {
  /** 战斗种子，客户端拿它 + 双方阵容就能完整复现整场战斗 */
  seed: number;
  winner: 0 | 1 | null;
  /** 结束原因：打光了 还是 超时判定 */
  reason: 'eliminated' | 'timeout';
  /** 结束时的 tick 数，可用于做「战斗快慢」的平衡性统计 */
  ticks: number;
  /** 事件日志 */
  log: BattleEvent[];
  /** 双方剩余总血量百分比（bp），用于主循环扣血 */
  hpBpTeam0: number;
  /** 同上 */
  hpBpTeam1: number;
  /** 全场校验和。服务端和客户端各算一次，不一致就说明有同步 bug */
  checksum: number;
  /**
   * ★ 0.2 MujicaAve：这一场每队攒到的 fever（`[队伍0, 队伍1]`）。
   *
   * 回合流程拿它去结算（乘失败倍数、加进玩家的 fever 总额）。
   * ★ **不进校验和**：它是由确定性战斗推出来的副产物，两边算出来一定一样，
   * 混进 checksum 只会让"以后调 fever 数值"变成一次版本级不兼容。
   */
  feverGained: [number, number];
  /**
   * ★ 0.0.3：**属性时间线**（可选）—— 每个棋子"真实数值"的变化点，供详情页显示。
   *
   * 【为什么不是"基线 + buff 事件"？】
   * 详情页以前是自己拿开战基线叠 `buff` 事件算的，那条路有个绕不开的毛病：
   * **只有上报了事件的地方才算得出来**。而战斗中改属性的写法有很多种 ——
   * 技能 buff、藏品增益、羁绊光环、野怪换阶段（直接乘属性）、
   * 「罗德岛」换持有者（直接加攻击）……漏一处，面板就是错数字，
   * 而且不报错、只是"看起来没变"（用户报的"开技能后面板没变"）。
   *
   * 所以改成在内核**每 tick 之后顺手采一次**（值没变就不记），
   * 面板直接读真值 —— 无论属性被谁、怎么改过，都一定是对的。
   *
   * 默认**不采集**（服务端只对校验和感兴趣，不必背这份数据）。
   * 客户端调 `simulate(..., { statsTimeline: true })` 才有。纯给界面看，不参与校验和。
   */
  statsTimeline?: BattleStatsSample[];
}

/**
 * 一条属性快照（单位都是内核单位：攻速 1/1000 刻度、攻击/护甲/魔抗/生命上限是 FIX 定点数）。
 *
 * 【为什么不在内核里就换算成面板单位？】
 * 内核里出现浮点数是大忌（联机确定性的地基）。这里全整数，
 * 除以 FIX / 1000 的换算放在界面层做（和 replay 里原来的算法一致）。
 */
export interface BattleStatsSample {
  /** 第几 tick 生效（t=0 = 开战那一刻） */
  t: number;
  unitId: number;
  /** 攻速（1/1000 刻度：1200 = 每秒 1.2 次） */
  attackSpeed: number;
  attackDamage: number;
  armor: number;
  magicResist: number;
  range: number;
  maxHp: number;
  /**
   * ★ 0.1.1 藏品二版：这条快照生效时，棋子身上**正生效的状态效果**（见 status-effects.ts）。
   *
   * 【为什么和属性一起采，而不是界面自己去日志里推？】
   * "身上有哪些效果"这件事分散在四处（修正包 / statuses / 限时效果 / 机制），
   * 界面靠自己从事件日志反推只能覆盖到**上报了事件的那几种**（护盾、眩晕、
   * 攻速/攻击 buff、闪避），隐匿 / 无敌 / 免死 / 流血 / 飞行这些根本推不出来。
   * 内核这里刚好什么都有（`collectMods` + 真实的 `UnitState`），
   * 所以顺手采一条 —— 和属性时间线是同一个思路、同一个位置。
   *
   * 【为什么 `ticksLeft` 不放进去做变化判据？】
   * 剩余 tick 每一 tick 都在变，拿它当判据会变成"每 tick 每个棋子一条"，
   * 十来个棋子打 20 秒就是几千条。所以**只在"效果集合"变了时才记一条**，
   * 界面按 `ticksLeft - (当前tick - t)` 自己往下数。
   */
  effects?: BattleEffectSample[];
}

/** 一条"正生效的效果"的紧凑快照（完整元数据在 status-effects.ts 的 EFFECT_DEFS 里） */
export interface BattleEffectSample {
  /** 效果种类（EffectKind） */
  kind: string;
  /** 这一条的具体数值说明（"每秒 1% 最大生命"），没有就不写 */
  detail?: string;
  /** 还剩多少 tick（**按时间**的效果才有；界面自己按"现在减采样时刻"往下数） */
  ticksLeft?: number;
  /**
   * ★ 0.1.3：还剩几次（**按次数**消耗的效果才有，如"接下来 6 次攻击"）。
   *
   * 【为什么它不能像 ticksLeft 那样让界面自己数？】
   * 因为"次数"是**离散**的 —— 它只在攻击的那一刻 -1，跟时间没关系，
   * 界面没法用"过了多少秒"推出来。所以内核在次数变化时**重新采一条**，
   * 界面直接读最新那条（见 rules.ts 里 effectKey 把 countLeft 算进变化判据）。
   */
  countLeft?: number;
}

// ============================================================
// 玩家阵容（准备阶段提交给战斗的输入）
// ============================================================

/**
 * ★ 0.1.2（测试模式）：一枚棋子的**基础数值覆盖**。
 *
 * ============================================================
 *  【这是什么、给谁用】
 * ============================================================
 * 测试模式的修改器里有一个「数值修改」开关：打开后布阵阶段点场上的干员，
 * 弹的不是详情页而是"基础属性编辑面板"，改完保存，**只改这一张卡**。
 * 调数值的时候就不用去改数据表 + 重打包了。
 *
 * 【单位是"面板单位"，不是内核定点数】
 * 界面看到的、填的就是这里的值（血量 4500、攻速 1.2、射程 3）；
 * 换算成 FIX 定点数这件事**只在 `rules.ts` 的 createUnit 里做一次** ——
 * 内核以外的地方一旦自己乘 FIX，就等着出现"填 4500 实际生效 4.5"这类错。
 *
 * 【它盖的是哪一层？】
 * 盖的是「基础值 × 星级（+ 3 星质变加血）」这一层 —— 也就是详情页里
 * 用来做 ▲▼ 对比的那个**白板值**。羁绊、藏品的加法加成照旧叠在它上面，
 * 所以这里改 4500 之后，吃到羁绊仍然会更高。
 *
 * 【没填的字段 = 不改】
 * 只覆盖你真正改过的项。全都不填等于没有覆盖（客户端会直接把这条记录删掉）。
 */
export interface UnitStatOverride {
  /** 面板生命上限（整数，例如 4500） */
  hp?: number;
  /** 面板攻击力（整数） */
  attackDamage?: number;
  /** 每秒攻击次数（1.2 = 每秒 1.2 下；**不是**内核那个 1200） */
  attackSpeed?: number;
  /** 面板护甲（整数） */
  armor?: number;
  /** 面板魔法抗性（整数） */
  magicResist?: number;
  /** 射程（格，整数） */
  range?: number;
}

export interface UnitPlacement {
  defId: string;
  star: number;
  cell: Cell;
  /**
   * ★ 0.0.3：装备在这枚棋子身上的 **A 类藏品** id（每个干员最多 2 件）。
   *
   * 【为什么挂在 placement 上，而不是像羁绊那样按 defId 存？】
   * 因为羁绊是"看标签生效"的 —— 同名的两个棋子一定吃到同样的羁绊加成。
   * 但藏品是**按棋子实例**装备的：同名干员 A 装了双模机械臂、B 没装，
   * 两者就该不一样。按 defId 存会让没装的那个白嫖到加成。
   * 所以挂在 placement 上，`createBattle` 逐个棋子解析（见 resolveWearerItems）。
   */
  items?: string[];
  /**
   * ★ 0.2：这枚棋子身上**每一件**藏品的跨回合成长层数，和 `items` 一一对应。
   *
   * 【为什么不是一张 `{藏品id: 层数}` 的表？】
   * 因为**同一个人可以拥有多件相同藏品**（两个干员各装一件「佣兵的饰物」、
   * 共享装备位里放两件「圆石祭坛」）。按 id 记的话它们会共享同一个层数，
   * 只涨一份、也只生效一份 —— 用户报的就是这个 bug：
   * "有些单独穿戴的叠层藏品，我有多个时层数会共享，改为相同藏品单独也要叠层"。
   * 所以层数改成**跟着这一件副本走**（和 `items` 同下标），合成时求和。
   *
   * 【它参与战斗计算吗？】参与 —— 通过 `resolveWearerItems` 的 `itemLayers` 参数
   * 乘进"每层属性"里。不写 = 全部按 0 层（老数据、测试都吃这个默认值）。
   */
  itemLayers?: number[];
  /**
   * ★ 0.1.2：这枚棋子**占牌库几张**（不写 = 按星级算）。
   *
   * 【内核读它吗？】不读 —— 战斗内核只认 defId / star / cell / items。
   * 它是给**断线重连**用的：重连（尤其是刷新页面之后）要把服务器手里那份
   * `SubmittedTeam` 装回本地棋盘，而"白送的棋子（占 0 张）"这件事只存在于
   * 客户端 —— 不跟着上报就恢复不出来，卖它的时候会凭空往牌库多还几张牌。
   * 换算的唯一入口仍然是 `economy.ts` 的 `poolCopiesOf()` / `freeFlagFor()`。
   */
  free?: boolean | number;
  /**
   * ★ 0.1.3：这枚棋子**额外**获得的羁绊标签（转职藏品给的）。
   *
   * 【为什么它跟着 placement 走？】
   * 和 `items` 同一个理由：转职是"装在**这一枚**棋子上"的，
   * 同名干员 A 装了、B 没装，两者的羁绊成员资格就该不一样。
   *
   * 【它是独立状态吗？】不是。客户端只有 `items` 这一个真相，
   * 组阵容时用 `extraTraitsOf()` 从 items 现推出来上报（内核不认识藏品）。
   * 内核算人数 / 发成员加成时把它与 `def.traits` 合并，见 `traitsOfPlacement`。
   *
   * 【为什么同名干员之间会互相影响？】见 `computeUnitTraitBonuses` 的说明 ——
   * 羁绊加成本来就是"给**这种棋子**"的（按 defId 去重），这是既有规则。
   */
  extraTraits?: string[];
  /**
   * ★ 0.1.2（测试模式）：这张卡的**基础数值覆盖**（见 UnitStatOverride）。
   * 正常对局永远是 undefined —— 只有测试模式打开「数值修改」才会出现。
   * 跟着阵容一起上报，所以联机测试房里两边算出来的也是同一份数值。
   */
  statOverride?: UnitStatOverride;
}


export interface TeamSetup {
  team: 0 | 1;
  units: UnitPlacement[];
  /**
   * ★ 0.2：羁绊的**跨回合叠层**（羁绊 id -> 层数），由客户端上报、原样带进战斗。
   * 罗德岛用它（"回合胜利时 +2.25% 生命与攻击，最多 10 层"）。
   * 不写 = 没有层数（0 层），老数据不受影响。
   */
  traitStacks?: Record<string, number>;
  /**
   * ★ 0.2 MujicaAve：这一场**消耗过 fever**（已武装特殊技能）时带上窗口时长。
   *
   * 【为什么要从外面传进来，而不是内核自己看数据？】
   * 因为"这一场有没有消耗 fever"是**跨回合的玩家决定**，数据表里没有这个信息。
   * 回合流程在消耗的那一刻把 `{ durationTicks }` 记在玩家身上，组阵容时原样带进来，
   * 内核照着"给带 fever 机制的棋子挂免死窗口 + 立刻放一次技能"。
   * 不写 = 这一场没有特殊技能（绝大多数回合）。
   */
  feverSkill?: { durationTicks: number };
  /**
   * **全队**都吃到的羁绊加成（`scope: 'team'` 的羁绊）。
   *
   * 【为什么放在这里，而不是让战斗循环自己去算？】
   * 因为战斗循环应该只关心「棋子属性是多少」，不关心属性从哪来。
   * 把羁绊算好之后塞进这里，战斗内核完全不知道有羁绊这回事 ——
   * 于是 rules.ts 一行都不用改，而且联机时这份数据跟着阵容一起广播，
   * 客户端不需要重算羁绊，天然不会算错。
   */
  traitBonuses?: TraitBonus[];
  /**
   * ★★ 0.3：这一队带的盟约 id（没带就不写）。
   *
   * 【为什么盟约要进 TeamSetup？】
   * 因为「命结之秘」（前 2 个阵亡的我方干员立刻复活）是**战斗内核**里的事 ——
   * 它得在 `killUnit` 那一刻决定"这次死要不要拉起来"。
   * 而"这个玩家选了哪个盟约"只有组阵容的那一层知道，所以跟着 TeamSetup 进内核。
   * ★ 服务端 `Room.buildTeamSetup` 与客户端 `toTeamSetup` **必须填同一个值**
   *   （= 玩家的 covenantId），否则两边的复活结果不同 ⇒ 校验和对不上。
   */
  covenantId?: string;
  /**
   * **只给某几种棋子**的羁绊加成（`scope: 'members'`，默认）。
   * key 是棋子 id（defId），value 是那种棋子吃到的加成。
   *
   * 【为什么按 defId 而不是按"第几个棋子"？】
   * 因为羁绊是看标签生效的，同一支队伍里所有同名棋子一定吃到同样的加成。
   * 按 defId 存既省空间，也不会因为棋子顺序变化而算错。
   */
  unitTraitBonuses?: Record<string, TraitBonus[]>;
  /**
   * 这支队伍**生效到第几档**的羁绊清单。
   *
   * 【为什么光有 traitBonuses 不够？】
   * traitBonuses 是"已经摊平的属性加成"，够战斗算数值用。
   * 但羁绊的**战斗中机制**（攻击附带伤害、斩杀、溅射、开局护盾…）
   * 需要知道"是哪个羁绊、生效到第几档"才能解析出来。
   * 所以把档位信息也一起带上 —— 它跟着阵容广播，联机两边算出来的完全一样。
   */
  activeTraits?: ActiveTraitLevel[];
  /**
   * 每个棋子身上应该挂哪些**战斗中机制**（`defId -> 机制列表`）。
   *
   * 【为什么和 activeTraits 分开传？】
   * activeTraits 说"哪个羁绊生效到第几档"，是**队伍级**的信息；
   * 这个是**棋子级**的结论（已经解析成"这个棋子有哪些行为"）。
   * 战斗内核只需要后者 —— 它连羁绊叫什么名字都不用知道。
   * 两者都由 synergies.ts 从同一份阵容算出来，联机时跟着阵容一起广播。
   */
  unitMechanics?: Record<string, ScopedMechanic[]>;
  /**
   * ★ 0.0.3：装备在**共享装备位**里的 B 类藏品 id。
   *
   * 【为什么放在队伍这一层？】
   * B 类藏品的语义就是"全队受益"，它不属于任何一个棋子。
   * 和 traitBonuses 一样，它跟着阵容一起广播 —— 战斗内核只管读，
   * 不需要知道这些加成是藏品给的还是羁绊给的。
   */
  sharedItems?: string[];
  /**
   * ★ 0.2：共享装备位里**每一件**藏品的成长层数，和 `sharedItems` 一一对应。
   *
   * 理由同 `UnitPlacement.itemLayers`：两个「圆石祭坛」并排放着时，
   * 各叠各的层数，而不是共享一份（用户口径"相同藏品单独也要叠层"）。
   */
  sharedItemLayers?: number[];
  /**
   * ★ 0.0.3：玩家的场外信息（金币 / 血量 / 永久藏品效果）。
   *
   * 【为什么战斗内核要关心玩家的钱和血？】
   * 因为有两件藏品是**按玩家状态给全队加成**的：
   *   · 金酒之杯「每有 5 金币，全部干员 +3% 攻速，上限 200%」
   *   · 皇帝的新枪「血量低于 30 时，全部干员攻击力/攻速 +30%」
   * 这类加成在**组阵容那一刻**就能算成固定值（金币和血量在备战期不会变），
   * 所以这里只用来"算一次"，战斗循环本身还是只读属性。
   */
  playerContext?: { gold: number; hp: number };
  /** ★ 0.1.1：当前回合号（御三家召唤物 / 藏品按回合成长要用）。不写 = 第 1 回合 */
  round?: number;
  /**
   * ★ 0.1.1 藏品二版：客户端的「跨回合藏品状态」。
   *
   * 【为什么不在服务端算？】
   * 因为"上一场赢没赢、击倒了几个人、现在是第几回合、藏品栏还剩几个空位"
   * 这些**只存在于客户端那一局的状态里**（服务端只管配对和广播结果）。
   * 和 `playerContext`（金币 / 血量）是同一个思路：客户端把结论交上来，
   * 服务端只负责把它原样放进 `createBattle`。
   *
   * ★★ 新增字段一定要在 `server/src/main.ts` 的提交白名单里放行 ——
   *    那里是"手挑字段"的写法，漏一个就会被**静默丢掉**（备战席踩过这个坑）。
   */
  itemState?: {
    /** 每件藏品的成长层数（key = 藏品 id） */
    growth?: Record<string, number>;
    /** 藏品栏里**还没装载**的藏品数量（悲伤的红用） */
    unequipped?: number;
    /** ★ 0.1.4：藏品栏本体（存放区），断线重连时用来把背包原样装回来 */
    bag?: ItemBagSnapshot;
  };
}

/**
 * ★ 0.1.4：藏品栏**快照**（`SubmittedTeam.itemState.bag`）。
 *
 * ============================================================
 *  【它修的 bug】"断线重连之后，没装载的藏品全消失了"
 * ============================================================
 * `SubmittedTeam` 原来只带得出"装着的"那几件：
 *   · `units[].items`     —— 穿在干员身上的 A 类；
 *   · `sharedItems`       —— 共享装备位里的 B 类（4 格）；
 *   · `itemState.growth`  —— 成长**层数**（按藏品 id 记）。
 * 而**存放区**（`aSlots` 10 格 / `bSlots` 5 格，也就是"攒着还没装"的那些）
 * 一个字段都没报上去。刷新页面重连时 `applySubmittedTeam` 会重建本地状态，
 * 藏品栏按"空"来建 —— 成长层数还在，**东西没了**。
 *
 * 【为什么 permanent / gainedRound 也在里面？】
 * 它们同样"只存在于客户端这一局"，少一个就有一处表现不对：
 *   · `permanent.lostKey`     —— 失落之钥装上即销毁本体、只留永久效果；
 *   · `permanent.lostKeyPaid` —— 十级奖励发过没有（丢了会**再发一次** 50 金）；
 *   · `gainedRound`           —— 剑锤「2 回合后未装载自动销毁」的计时起点。
 *
 * ★ 服务端只当它是**原始输入**：存下来、做一次合法性夹取（见 `sanitizeItemState`），
 *   真正的加成永远由服务端拿它重算 —— 和 `sharedItems` 是同一个态度。
 */
export interface ItemBagSnapshot {
  /** A 类存放区（10 格；`null` = 空格子） */
  a?: (string | null)[];
  /** B 类存放区（5 格） */
  b?: (string | null)[];
  /**
   * ★ 0.3.2 升变之证**专用栏位**（3 格，固定顺序：青色 / 慈悲 / 终曲）。
   *
   * 为什么快照里也要带上？重连之后证得还在 —— 它不像普通藏品那样能从
   * "成长层数 + 数量"还原出来（它是任务发的，没有别的来源）。
   */
  cert?: (string | null)[];
  /** 本局永久效果的状态（失落之钥） */
  permanent?: { lostKey?: boolean; lostKeyPaid?: boolean };
  /** 藏品 id -> 它是第几回合拿到的（剑锤的销毁计时用） */
  gainedRound?: Record<string, number>;
}

/** 棋子定义表：key 是棋子 id。由 unit-data.ts 提供 */
export type UnitDefTable = Record<string, UnitDef>;

// ============================================================
// 藏品（装备）
// ============================================================

/** 藏品稀有度：普通 / 进阶 */
export type ItemRarity = 'normal' | 'advanced';

/**
 * 藏品的类型 —— 决定它装在哪儿、给谁加成。
 *
 *   A（代号 A 类，界面上叫「穿戴藏品」）：拖到**干员**身上，
 *     只强化这一个干员，每个干员最多 2 件
 *   B（代号 B 类，界面上叫「共享藏品」）：拖到**共享装备位**，
 *     全队受益，最多 4 件
 *
 * ★ A / B 只是分类代号，**不要**直接拼进给玩家看的字符串：
 *   界面文案统一走 `item-text.ts` 的 ITEM_SLOT_SHORT / ITEM_SLOT_LABEL
 *   和 `apps/web/src/game/items.ts` 的 zoneLabel()。
 */
export type ItemSlot = 'A' | 'B';

/** 装备条件（不满足就不允许装备） */
export interface ItemRequire {
  /** 最低星级（博士投影：只能装备给 1 星干员 -> minStar/maxStar = 1） */
  minStar?: number;
  maxStar?: number;
}

/** 备战类效果：装备那一刻对**棋子本身**做的操作（不走战斗内核，走客户端状态层） */
export type ItemPrep =
  /** 拟态物质：立刻获得一只与装备者同款的一星干员（不占牌库，需备战席有空位） */
  | { kind: 'cloneOneStar' }
  /** 博士投影：装备者升到 2 星（多出来的干员不计入牌库） */
  | { kind: 'upgradeStar' }
  /** 突变细胞：装备者变成"同星级、高一费"的随机干员（5 费仍是随机 5 费） */
  | { kind: 'transformCostUp' }
  /**
   * ★ 0.1.1：随机招募一名指定费用区间的干员（人事部铜印 1-3 费 / 博士银印 4-5 费）。
   * 招募到的干员直接进**备战席**（和商店买牌同一套落位规则）。
   */
  | { kind: 'recruitRandom'; minCost: number; maxCost: number }
  /**
   * ★ 0.1.3：变形同构体 —— 装备后立刻销毁，并按装备者**已有的羁绊**等概率
   * 随机产出一件对应的「转职藏品」，放进**穿戴藏品存放栏**（A 栏）。
   *
   * 【为什么产出的东西进存放栏、而不是直接装上？】
   * 用户口径：变形同构体只负责"变成对应的那个转职"，
   * 要不要现在就占掉那个干员的装备位，交给玩家自己决定。
   * （代价是 A 栏满的时候用不了 —— 那一条在客户端拦，见 prepNeedsStorageSlot。）
   */
  | { kind: 'morphRelic' };

/** 装备那一刻立即结算的效果（「立刻销毁」类藏品走这里） */
export interface ItemOnEquip {
  /** 立刻销毁：结算完就从格子里消失，不占位置 */
  consume?: boolean;
  /** 只能装备给满足条件的干员（A 类才有意义） */
  require?: ItemRequire;
  /** 加金币（古旧残币 +10 / 无瑕宝玉 +30） */
  gold?: number;
  /** 加玩家血量（热水壶 +5 / 血魔的寝床 +15） */
  hp?: number;
  /** 加人口上限（地形图 +1） */
  popCap?: number;
  /**
   * 永久效果（本局一直生效，不可再次获得）：
   *   lostKey = 失落之钥：「金币升级时额外 +1 经验，到达十级后 +50 金币」
   */
  permanent?: 'lostKey';
  /** 备战类效果（复制 / 升星 / 变身） */
  prep?: ItemPrep;
  /**
   * ★★ 0.3.2 盟约「阿米娅 · 不容拒绝」：**升变之证** ——
   * 装到指定形态的阿米娅身上，把她换成另一个棋子（本藏品同时被消耗）。
   *
   * 【为什么做成"藏品"而不是自动升变？】
   * 用户口径：升变要用**专属藏品**触发（只有选了这条盟约的玩家拿得到）。
   * 好处是玩家有"什么时候用"的决策权，也复用了装备那一整套成熟链路
   * （拖拽、校验、消耗、提示都不用另写）。
   */
  ascend?: ItemAscend;
}

/**
 * ★ 0.3.2：升变关系（`onEquip.ascend` 的载荷）。
 *
 * `from` 是**允许被升变的形态白名单** —— 不是阿米娅的棋子装不上，
 * 已经是终态的也装不上（白名单里没有它）。
 */
export interface ItemAscend {
  /** 这些形态可以被升变（`op07` = 1 费阿米娅；3 费形态各自一条） */
  from: readonly string[];
  /** 升变成哪个形态（`ASCEND_DEFS` 的 key） */
  to: string;
  /** 要求的最低星级（炉芯终曲要 3 星）；不写 = 1 星即可 */
  minStar?: number;
}

/**
 * 藏品的战斗加成。
 *
 * A 类作用于**装备者**，B 类作用于**全队**（B 类的条件/规模部分另见 teamConditional）。
 */
export interface ItemCombat {
  /** 无条件的属性加成（复用技能那套 SkillStats，`collectMods` 直接认得） */
  stats?: SkillStats;
  /**
   * 条件属性：**装备者带某个羁绊**时才追加。
   * 例：炎国短刃「若装备者为炎羁绊，额外提升 8% 攻击力」。
   */
  selfTraitStats?: { trait: string; stats: SkillStats };
  /**
   * 条件机制：**装备者带某个羁绊**时才追加的机制。
   * 例：铳骑之威「装备者为拉特兰羁绊时，攻击额外斩杀生命低于 5% 的敌人」。
   */
  selfTraitMechanics?: { trait: string; mechanics: ScopedMechanic[] };
  /** 战斗中的机制（复用羁绊机制那套 kind，见 TraitMechanic 的「藏品新增」部分） */
  mechanics?: ScopedMechanic[];
  /** 开局类效果（复用技能效果，如「回合开始额外 +10 魔抗，持续 15 秒」） */
  battleStart?: SkillEffect[];
  /**
   * 「治疗效果提升」万分比。
   *
   * 【为什么不用 SkillStats 表达？】
   * 因为它不住在修正包里，而是住在 `unit.statuses['healingBonusBp']` ——
   * 治疗结算（combat-math.ts 的 healUnit）直接读那个状态，不看修正包。
   * 所以装备时把它直接写进状态即可，运行时零开销。
   */
  healingBp?: number;
  /**
   * ★★ 0.3.2「迅捷作战粮」：**技力回复量**提升（万分比）。
   *
   * 三条回蓝路（攻击回复 / 受击回复 / 自动回复）最终都走 `gainMana` 这一个入口，
   * 所以这里只需要把数值写进 `unit.statuses['manaGainBonusBp']`，
   * 由 `gainMana` 在唯一的乘算点读它 —— 和 `healingBp` 完全同一个套路。
   *
   * 【为什么不再用 healingBp？】
   * 这件藏品的卡面写的是"攻击 / 受击 / 技能回复量 +50%"，那是**技力**，
   * 不是治疗量。以前数据里写成了 `healingBp`，描述和效果对不上（用户报的）。
   */
  manaGainBp?: number;
  /**
   * 阵亡时原地站起来一次（M3茧甲）。
   *
   * 【为什么复用野怪的 reborn？】
   * 因为「血量第一次归零时不倒下」这件事战斗内核已经实现得很稳了
   * （见 combat-math.ts 的 killUnit/applyReborn），而且它挡在"标记死亡"之前，
   * 是唯一不会留下各种半死状态的位置。藏品只是"把 reborn 挂到普通干员身上"。
   */
  revive?: { hpBp: number; desc: string };
}

/**
 * B 类（共享）藏品的**条件 / 规模**加成。
 *
 * 【为什么单独一组，而不是塞进 ItemCombat.stats？】
 * 因为这些加成不是"无脑加给全队"，而是要看**每个干员自己的属性**
 * （费用多少、射程多远），或者看**玩家的场外状态**（激活了几个羁绊、
 * 有多少钱、还剩多少血）。它们全都在**组阵容那一刻**算成固定值。
 */
export type ItemTeamConditional =
  /** 只有费用 ≤ cost 的干员吃到（皇帝的恩宠：1/2/3 费 +20% 攻击力） */
  | { kind: 'costAtMost'; cost: number; stats: SkillStats }
  /** 只有攻击距离 > range 的干员吃到（银餐叉：射程 >3 的 +20% 攻击力） */
  | { kind: 'rangeGreaterThan'; range: number; stats: SkillStats }
  /** 每激活一个**不同的羁绊**，全队 +stats（老蒲扇：每个羁绊 +10% 攻击力） */
  | { kind: 'perActiveTrait'; stats: SkillStats }
  /** 玩家每有 perGold 金币，全队 +stats；总加成不超过 capBp（金酒之杯） */
  | { kind: 'perGold'; perGold: number; stats: SkillStats; capBp?: number }
  /** 玩家血量低于 hpBelow 时，全队 +stats（皇帝的新枪） */
  | { kind: 'lowHp'; hpBelow: number; stats: SkillStats }
  /**
   * ★ 0.1.1：玩家血量**不低于** hpAtLeast 时，全队 +stats（魔王的旗帜「生命值大于 70 时
   * 所有干员的攻击速度 +50%」）。
   *
   * 【为什么和 lowHp 分成两个 kind，而不是加一个取反的开关？】
   * 因为这两个门槛的语义完全不同：lowHp 是"残血翻盘"，hpAbove 是"健康时才有"。
   * 用同一个 kind 加开关的话，读数据的人要靠猜才知道 `hpBelow` 字段在取反时
   * 到底是什么含义。两个 kind、两个字段名，一眼就懂。
   */
  | { kind: 'hpAbove'; hpAbove: number; stats: SkillStats }
  /**
   * ★ 0.1.1：**无条件**给全队加一份属性（剑锤「所购买的干员攻击力、防御力和生命 +50%」）。
   *
   * 【为什么不直接用 `combat.stats`？】
   * 因为 B 类藏品的效果一律走 `resolveSharedItems` 那条路（转成 traitBonuses
   * 再并进棋子属性），`combat` 是 A 类的字段 —— 写在那里会被静默忽略。
   * 「无条件」也是一种条件，所以放进同一个联合类型里，读代码的人一眼就知道
   * 这个字段是"全队加成"的唯一出口。
   */
  | { kind: 'always'; stats: SkillStats };

/** B 类藏品的每回合经济效果（装在共享装备位期间一直生效） */
export interface ItemPerRound {
  /** 每回合固定 +金（至宝指环 +1） */
  gold?: number;
  /** 处于连败时，每回合额外 +金（幸运硬币 +1） */
  goldOnLossStreak?: number;
  /**
   * ★ 0.1.1：野怪回合掉落的金币提升（万分比）。
   * 骑士长枪专业版「野怪回合更高概率获得更多的金币（掉落金币 +50%）」→ 5000。
   * 只在野怪回合结算掉落时读它。
   */
  monsterGoldBp?: number;
  /**
   * ★ 0.1.1：按"成长层数"给的**概率额外金币**（黑流树海笔记
   * 「每回合叠加 1 层，每 5 层使战斗胜利后有 1% 概率额外获得 1 金币」）。
   *
   * 【为什么写成"每多少层 → 多少百分比"而不是写死 5 和 1？】
   * 因为这样数据表改数字就能调平衡，代码里不出现"5"和"1"这两个魔数。
   * 判定发生在**战斗胜利后**的回合结算里（输的那一方没有）。
   */
  growthGoldChance?: { layersPerStep: number; percentPerStep: number; gold?: number };
}

/**
 * ★ 0.1.1 藏品二版：跨回合"成长层数"。
 *
 * 【要解决什么？】
 * 二版里有一批藏品是"越打越强"的：仇名录（每击倒一名敌人永久 +1% 攻击力）、
 * 佣兵的饰物（每次胜利 +5%）、黑流树海笔记（每回合 +1 层）、
 * 悲伤的红（按未装载藏品数给加成）。
 * 这些层数**不在战斗里产生**，而是"上一场战斗的结果" —— 战斗内核完全不知道
 * 第几回合、刚才赢没赢、击倒了几个人。
 *
 * 【所以怎么算？】
 * 层数由**客户端**在自己的状态里累计（那里才知道"这一场赢没赢、杀了几个"），
 * 组阵容时把整张 `{藏品 id: 层数}` 表塞进 `TeamSetup.itemState.growth`，
 * 由 `resolveWearerItems` / `resolveSharedItems` 折成属性 —— 和"共享藏品的
 * 条件加成"是同一条路：**战斗内核只读结果，不知道层数从哪来**。
 */
export interface ItemGrowth {
  /**
   * 层数从哪来（只决定客户端该在什么时机 +1，不影响战斗计算）：
   *   · kill      —— 每击倒一名敌人（野怪不算）累加
   *   · win       —— 每次战斗胜利累加
   *   · round     —— 每回合累加
   *   · emptySlot —— 不累加，直接用"藏品栏里未装载的藏品数"
   */
  source: 'kill' | 'win' | 'round' | 'battle' | 'emptySlot';
  /**
   * 每一层额外给的属性（万分比 / 绝对值）。**不写**表示这份成长只用来放大机制
   * （生还者合约：层数放大的是 `startRandomAllyBuff` 的倍率，不是全队属性）。
   */
  perLayer?: SkillStats;
  /**
   * ★ 0.1.1：**战斗结算时按概率涨层**（`source === 'battle'` 才用，圆石祭坛 3.25%）。
   *
   * 【为什么写进数据，而不是像以前那样写死在代码里？】
   * 以前 `applyItemGrowthAfterBattle` 里直接写 `% 10000 < 325` ——
   * 以后再加一件"按概率成长"的藏品（概率不是 3.25%）就会**静默沿用 3.25%**，
   * 而且从藏品数据上看不出概率是多少。这种事只该有一个来源。
   */
  chanceBp?: number;
  /** 最大层数（超出不再加）。空藏品数用 `maxStacks` 封顶 */
  maxStacks: number;
  /** 初始层数（不写 = 0）。生还者合约写 1（开局就有那 +20%） */
  base?: number;
  /** 一句话说明这份成长怎么来的，供界面显示 */
  label: string;
  /**
   * ★ 0.1.1：**卸下装备时清零**（仇名录「装备被卸下时加成失效并重置」、
   * 佣兵的饰物 / 圆石祭坛 / 家常小炒 / 生还者合约 / 黑流树海笔记 都写了这句）。
   */
  resetOnUnequip?: boolean;
  /** ★ 0.1.1：**战斗失败时清零**（生还者合约「失败后层数重新叠加」） */
  resetOnLoss?: boolean;
}

/**
 * 藏品定义：一条「策划表格」的行。
 *
 * 【数据是唯一真相】
 * 想在游戏里出现一件新藏品、或者调一件藏品的数值，
 * 只需要往 `item-data.ts` 的 ITEM_DEFS 里加/改一行，不用动任何逻辑代码。
 */
export interface ItemDef {
  id: string;
  name: string;
  rarity: ItemRarity;
  slot: ItemSlot;
  /** 图标资源名（对应 assets/items/<icon>.png）。找不到图片时回退成"首字色块" */
  icon: string;
  /** 设计稿原文描述，直接显示在 UI 上 */
  desc: string;

  /** 装备那一刻立即结算（「立刻销毁」类走这里） */
  onEquip?: ItemOnEquip;
  /**
   * ★★ 0.3.2：**盟约专属**藏品 —— 不进商店、不进野怪掉落、不进招募 / 拟态，
   * 只能由对应盟约的机制发放（目前只有「阿米娅 · 不容拒绝」的升变之证）。
   *
   * 判据只在 `NORMAL_ITEMS` / `ADVANCED_ITEMS` / `itemsOf()` 三个地方过滤：
   * 商店货架、凯瑟琳「定向投放」、掉落表都从这几个清单取，
   * 所以这里挡住一次，所有"随机获取"的口子就都挡住了。
   */
  covenantOnly?: boolean;
  /** 战斗加成（A 类给装备者，B 类给全队） */
  combat?: ItemCombat;
  /** B 类专属：条件 / 规模加成 */
  teamConditional?: ItemTeamConditional[];
  /** B 类专属：全队战斗机制 */
  teamMechanics?: ScopedMechanic[];
  /** B 类专属：每回合经济效果 */
  perRound?: ItemPerRound;
  /**
   * ★ 0.1.1 藏品二版：跨回合成长（层数 → 额外属性）。见 `ItemGrowth` 的说明。
   *
   * 【为什么 A / B 都写在同一个字段？】
   * 因为"层数怎么折成属性"这件事两边完全一样（都是并进 `statsList` /
   * `teamBonuses`）。分开写两个字段只会让 `resolveWearerItems` 和
   * `resolveSharedItems` 各多一段几乎相同的代码。
   */
  growth?: ItemGrowth;
  /**
   * ★ 0.1.1：这件藏品让"购买干员的花费"变化多少（剑锤 +2）。
   * 不写 = 0。客户端在算商店价格时读它，战斗内核完全用不到。
   */
  shopCostDelta?: number;
  /**
   * ★ 0.1.1：获得后经过这么多回合还没装载就自动销毁（剑锤写 2）。
   * 不写 = 不会自动销毁。纯客户端行为。
   */
  selfDestructAfterRounds?: number;
  /**
   * ★ 0.1.3：**转职藏品** —— 装在干员身上，让他额外获得这个羁绊标签。
   *
   * 【为什么只写一个标签 id，不写"怎么生效"？】
   * 因为生效路径完全复用已有的两条：
   *   · 凑人数 —— 客户端组阵容时折成 `UnitPlacement.extraTraits`，
   *     `countTraits` 把它和 `def.traits` 一起数；
   *   · 吃加成 —— 同一条通道进 `computeUnitTraitBonuses` 的"成员"判定。
   * 战斗内核因此完全不知道"转职藏品"这回事，一行都不用改。
   *
   * 【装不上的情况】干员**本来就有**这个羁绊时拒绝装备
   * （用户口径：星熊装不了大炎转职和重装转职）—— 那是客户端的闸门。
   */
  grantsTrait?: string;
  /**
   * ★ 0.1.1：开局召唤物的数值**按回合数成长**（支援防暴桩的假人 / 天师锦囊的炎佑）。
   *
   * 【为什么数值写在这里，而不是让内核回单位表里取？】
   * 因为战斗内核根本不知道现在是第几回合 —— 所以由 `resolveSharedItems`
   * 在组阵容时按回合算好，写进 `startSummon` 机制里；内核只管照数召唤。
   * 数值单位都是**面板单位**（1000 = 1000 血），换算成定点数是解析层的事。
   */
  summonGrowth?: {
    /** 基础血量（面板单位） */
    hp: number;
    /** 基础攻击力（面板单位） */
    attackDamage: number;
    /** 里程碑：回合数 ≥ atRound 时累计加上这些值 */
    milestones: Array<{ atRound: number; hp?: number; attackDamage?: number }>;
    /** 血量硬顶（不写 = 不限） */
    maxHp?: number;
    /**
     * 最终再乘一个倍率（万分比）。炎佑写 13000 ——
     * 天师锦囊那句「【炎佑】属性 +30%」就是它。
     * 不写 = 10000（不变）。
     */
    statBp?: number;
    /**
     * ★ 0.1.1：`statBp` 的**前提** —— 只有这个羁绊在本队激活时才套那个倍率
     * （天师锦囊写 `'yan'`：大炎羁绊开着，炎佑才 +30%）。
     *
     * 【为什么是"条件"而不是"让炎佑去凑羁绊"？】
     * 用户口径：**棋子不参与羁绊的构建**（召唤物不算人数、也吃不到羁绊给成员的加成），
     * 大炎的开关由玩家自己的阵容决定；炎佑只是"大炎开着时自己变强"。
     * 不写 = 无条件套 `statBp`（支援防暴桩的假人就是这种）。
     */
    requireTrait?: string;
  };
}

/** 藏品定义表：key 是藏品 id */
export type ItemDefTable = Record<string, ItemDef>;
