/**
 * ============================================================
 *  「战斗中的真实数值」—— 属性时间线的读取与换算
 * ============================================================
 *
 * 【这份数据从哪来？】
 * 内核 `simulate(..., { statsTimeline: true })` 会在每 tick 之后
 * 把每个棋子的真实属性采一条（值没变就不记），存进 `result.statsTimeline`。
 * 采集口径和战斗内核真正用的完全同一套函数（collectMods + effective*），
 * 所以面板上看到的数字 = 实际打出来的数字。
 *
 * 【为什么不在 replay.ts 里算？】
 * replay.ts 是 three.js 那一层的，单测要拖进 WebGL/DOM 才能跑。
 * 这里是纯函数：给一串采样 + 一个 tick，返回面板要显示的数值 —— 好测、也好复用。
 *
 * ★ 单位换算（内核是整数，界面要人话）
 *   · 攻速：内核 1/1000 刻度（1200 = 每秒 1.2 次）→ 除以 1000
 *   · 攻击 / 护甲 / 魔抗：内核定点数（FIX = ×1000）→ 除以 FIX
 *   · 射程：本来就是格数
 */
import {
  EFFECT_DEFS,
  FIX,
  type ActiveEffect,
  type BattleStatsSample,
  type EffectDuration,
  type EffectKind,
} from '../../../../packages/shared/src/index.js';

/** 面板要显示的数值（单位已经是人话） */
export interface PanelStats {
  /** 每秒攻击次数（1.2 = 每秒 1.2 下） */
  attackSpeed: number;
  attackDamage: number;
  armor: number;
  magicResist: number;
  range: number;
  /** 相对"开战那一刻"涨/跌了多少（万分比），界面用它标 ▲/▼ */
  bonusSpeedBp: number;
  bonusDamageBp: number;
}

/** 把一条采样换算成面板数值（`start` 传开战那条，用来算涨跌） */
export function panelStatsFromSample(sample: BattleStatsSample, start: BattleStatsSample = sample): PanelStats {
  const ratioBp = (now: number, then: number): number =>
    then === 0 ? (now === 0 ? 0 : 10000) : Math.round(((now - then) / then) * 10000);
  return {
    attackSpeed: sample.attackSpeed / 1000,
    attackDamage: sample.attackDamage / FIX,
    armor: sample.armor / FIX,
    magicResist: sample.magicResist / FIX,
    range: sample.range,
    bonusSpeedBp: ratioBp(sample.attackSpeed, start.attackSpeed),
    bonusDamageBp: ratioBp(sample.attackDamage, start.attackDamage),
  };
}

/** 把时间线按棋子分组（同一个棋子的采样按时间递增，内核就是这么推的） */
export function groupStatsTimeline(
  samples: readonly BattleStatsSample[] | undefined,
): Map<number, BattleStatsSample[]> {
  const grouped = new Map<number, BattleStatsSample[]>();
  for (const sample of samples ?? []) {
    const list = grouped.get(sample.unitId);
    if (list) list.push(sample);
    else grouped.set(sample.unitId, [sample]);
  }
  return grouped;
}

/**
 * 取"第 tick 刻生效的那条采样"。
 *
 * 【为什么要二分，而不是往前走一个指针？】
 * 播放器支持往回拖（seek）：指针式扫描只在"一直往前播"时是对的，
 * 往回拖就会停在未来的那条上，面板显示成"几分钟后的数值"。
 */
export function statsSampleAt(samples: readonly BattleStatsSample[], tick: number): BattleStatsSample {
  let lo = 0;
  let hi = samples.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (samples[mid]!.t <= tick) lo = mid;
    else hi = mid - 1;
  }
  return samples[lo]!;
}

/** 一步到位：某个棋子此刻的面板数值（没有它的采样就返回 null） */
export function panelStatsAt(
  grouped: Map<number, BattleStatsSample[]>,
  unitId: number,
  tick: number,
): PanelStats | null {
  const samples = grouped.get(unitId);
  if (!samples || samples.length === 0) return null;
  return panelStatsFromSample(statsSampleAt(samples, tick), samples[0]!);
}

/**
 * ★ 0.1.1 藏品二版：某个棋子此刻**正生效的状态效果**（登记表的元数据 + 这一条的具体情况）。
 *
 * 【剩余时间为什么要在这里减？】
 * 内核只在"效果集合变了"的时候才记一条（见 BattleStatsSample.effects），
 * 免得每个 tick 每个棋子都写一条。所以采样里那个 `ticksLeft` 是**采样那一刻**的值，
 * 界面按 `ticksLeft - (现在 - 采样tick)` 往下数，得到的就是此刻真正还剩多久。
 * 减到 0 说明这一条已经过期 —— 直接丢掉（新的采样马上就来了）。
 *
 * 【为什么要判 `everAppeared`？】
 * 如果这个效果从来出现过、且这条采样里的剩余时间已经数完，
 * 那它就是在"这条采样之后"的某个时刻消失的（不然内核早就该记新采样了），
 * 所以丢掉它是对的；反过来，效果还在（ticksLeft 还有）就照常显示。
 */
export function effectsAt(
  grouped: Map<number, BattleStatsSample[]>,
  unitId: number,
  tick: number,
): ActiveEffect[] {
  const samples = grouped.get(unitId);
  if (!samples || samples.length === 0) return [];
  const sample = statsSampleAt(samples, tick);
  const out: ActiveEffect[] = [];
  for (const effect of sample.effects ?? []) {
    const meta = EFFECT_DEFS[effect.kind as EffectKind];
    if (!meta) continue;
    let duration: EffectDuration | undefined;
    if (effect.ticksLeft !== undefined) {
      // 按时间的：用"现在 - 采样时刻"往下数
      const ticksLeft = effect.ticksLeft - (tick - sample.t);
      if (ticksLeft <= 0) continue; // 已经过期，等内核下一条采样
      duration = { kind: 'time', ticksLeft };
    } else if (effect.countLeft !== undefined) {
      /*
        ★ 0.1.3：按**次数**的**不能**像时间那样往下数 ——
        它只在攻击那一刻 -1，跟"过了多少秒"没关系。
        内核在次数变化时会补一条采样（见 rules.ts 的 effectKey），
        所以这里直接用最新那条采样里的值就是准的。
      */
      if (effect.countLeft <= 0) continue;
      duration = { kind: 'count', left: effect.countLeft };
    }
    out.push({
      ...meta,
      ...(effect.detail ? { detail: effect.detail } : {}),
      ...(duration ? { duration } : {}),
    });
  }
  return out;
}
