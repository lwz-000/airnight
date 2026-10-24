/**
 * ============================================================
 *  ★★ 0.2 MujicaAve：fever（热度）
 * ============================================================
 *
 * 【它是什么？】本作第一个**跨回合的玩家级资源**：
 *   攒 → 布阵时选「保留 / 消耗」→ 消耗了下一场全员开局强行放一次技能（窗口内不会死）
 *   → 那一场打输按档位退一部分回来。
 *
 * 【为什么单独一个文件？】
 * 因为它的"形状"要被**三方**共享，而这三方分属不同包：
 *   · 客户端（`apps/web/src/game/state.ts`）：算 fever、弹窗、消耗；
 *   · 协议（`protocol.ts` 的 `SubmittedTeam.fever`）：跟着阵容上报；
 *   · 服务端（`server/main.ts` 存、`server/room.ts` 组阵容）。
 * 形状 + 那两条"必须两边算得一模一样"的规则（`feverSkillOf` / `sanitizeFever`）
 * 放在这里，谁都不用抄第二遍 —— 抄第二遍的那一天就是"客户端算了、服务端没算"的 bug。
 *
 * ★ 数值一律在数据表里（`trait-data.ts` 的 `mujica`，`kind: 'fever'`），这里一个数都不写死。
 */

/** fever 的完整状态（跨回合，存在玩家身上） */
export interface FeverState {
  /** 当前总额。★ 跨回合保留，羁绊关掉也不清零 */
  total: number;
  /** 已消耗、等那一场打完再按胜负处理的额度（0 = 这一场没消耗过） */
  spent: number;
  /** 消耗后武装的**下一场**特殊技能窗口时长（tick）；0 = 没武装 */
  armedTicks: number;
  /** 收获过的宝藏档位（掉落表还没给，先记账） */
  treasures: number[];
  /** 布阵阶段要弹的那张「保留 / 消耗」的档位；null = 不弹 */
  prompt: number | null;
  /**
   * ★★ 0.2（用户 2026-10-17）：**已经消耗、但还没结算奖励的那一档**。
   *
   * 【用户口径】「获得奖励应该是在选择消耗 fever 后、战斗获胜后才能获得」。
   * 所以宝藏不发在"跨档"那一刻，而是：点「消耗」时把它记在这里 →
   * 下一场**打赢了**才真的发（输了 / 那场是野怪回合 -> 直接作废）。
   *
   * ★ 和 `spent` 的关系：`spent` 管"退多少 fever"，`pendingTier` 管"该发哪一档的宝藏"。
   * 两个字段一起在那一场结算完清掉。
   */
  pendingTier: number | null;
  /**
   * ★ 0.2：**已经弹过**的最高档位（null = 还没弹过任何档，或已经掉到所有档以下）。
   *
   * 【为什么需要它？—— 否则每回合都会重复弹同一个档】
   * 用户口径：「弹窗只弹最高档……第 4 回合 150 点弹 100 档，第 5 回合 170 点不弹，
   * 第 6 回合 400 点弹 300 档，第 7 回合 460 点也不弹」。
   * 也就是说：**只有跨过比上次更高的档才弹**；在同一个档里来回涨，
   * 一律不再打扰玩家。
   *
   * 【什么时候会"重新弹"？】
   * fever 掉到那一档**下面**之后又涨回来。所以这个数必须**跟着 total 一起往下走**
   * （见 `nextFeverPrompt`），否则玩家消耗掉全部 fever、重新攒到 100 时就不会再被问了。
   */
  promptedTier: number | null;
}

export function createFeverState(): FeverState {
  return { total: 0, spent: 0, armedTicks: 0, treasures: [], prompt: null, pendingTier: null, promptedTier: null };
}

/**
 * 由 fever 状态推出"这一场要不要武装特殊技能"。
 *
 * ★★ **客户端组阵容和服务端组阵容都必须调这一个函数** ——
 * 服务端要拿同一份 `TeamSetup` 算校验和，两边只要有一个字段不一样，
 * 整场战斗就会被判"校验和不一致"（玩家看到的症状是"打完卡住不结算"）。
 */
export function feverSkillOf(fever: FeverState | undefined): { durationTicks: number } | undefined {
  const ticks = Math.floor(fever?.armedTicks ?? 0);
  return ticks > 0 ? { durationTicks: ticks } : undefined;
}

/**
 * 已经跨过的**最高**档位（一个都没到 -> null）。
 *
 * ★ 这是纯粹的"按当前总额能到哪一档"，**不记任何历史** ——
 * "要不要真的弹"由下面的 `nextFeverPrompt` 决定（它要跟 `promptedTier` 比）。
 * 拆成两个函数是因为服务端 / 界面都可能只想知道"现在到哪一档了"。
 */
export function reachedFeverThreshold(
  total: number,
  thresholds: readonly number[],
): number | null {
  let best: number | null = null;
  for (const value of thresholds) {
    if (total >= value && (best === null || value > best)) best = value;
  }
  return best;
}

/**
 * ★★ 0.2：**这一次布阵该不该弹窗、弹哪一档** —— 唯一实现。
 *
 * 【用户口径（原话）】
 *   「弹窗是只弹最高档，比如第三回合到了 50 点不弹，第四回合 150 点弹 100 档的；
 *     第五回合 170 点不弹；第六回合 400 点弹 300 档的；第七回合 460 点也不弹，依此类推。
 *     除非是 fever 点数下降到每档的下面，后面 fever 重新升上去才会重新弹窗。」
 *
 * 翻译成规则：`top = 当前能到的最高档`，和 `promptedTier`（上次弹过的最高档）比 ——
 *   · `top` 比 `promptedTier` **高**  -> 弹 `top`（跨过更高的档了，值得问一次）
 *   · 其它情况（相等 / 更低）        -> 不弹
 * 并且**无论如何都把 `promptedTier` 更新成 `top`**：
 *   · `top === promptedTier`（比如 150 -> 170）→ 原地不动，继续不弹；
 *   · `top < promptedTier`（比如 400 掉到 150）→ **跟着降**。
 *     这一步是"掉到某档下面之后涨回来要重新弹"能成立的关键：
 *     掉到 100 档就把上次弹过的记成 100，将来再涨回 300 档时才算"跨过更高的档"。
 *   · `top === null`（掉到最低档以下）→ 归 null，等于"重新来过"。
 *
 * @param prompt        这次要弹的档位（null = 这次不弹）
 * @param promptedTier  **回写**给 `FeverState.promptedTier` 的值
 */
export function nextFeverPrompt(
  total: number,
  thresholds: readonly number[],
  promptedTier: number | null,
  options: { repeatAtMax?: boolean } = {},
): { prompt: number | null; promptedTier: number | null } {
  const top = reachedFeverThreshold(total, thresholds);
  if (top === null) return { prompt: null, promptedTier: null };
  /*
    ★★ 0.2（用户 2026-10-17）：「fever 达到最高档位后，后面每一回合（不含野怪回合）都弹窗」。

    【为什么要单独加这一条？】原来只认"跨过更高的档"，到了最高档就没有"更高"了 ——
    于是玩家攒到顶之后**再也弹不出来**，而消耗 fever 换特殊技能窗口才是这个羁绊的核心玩法，
    攒满反而用不了。现在只要还站在最高档（`total >= 最高档位`）就每回合都问一次。
    · 野怪回合不弹：由调用方（`applyFeverAfterBattle` / 界面）跳过，不在这里判 ——
      这里只回答"如果这一回合该问，问哪一档"。
    · 消耗之后总额归零 -> `top === null`，自然就不弹了（重新攒到最高档再问）。
  */
  const maxThreshold = thresholds.length > 0 ? Math.max(...thresholds) : 0;
  if (options.repeatAtMax === true && maxThreshold > 0 && top >= maxThreshold) {
    return { prompt: maxThreshold, promptedTier: top };
  }
  if (promptedTier === null || top > promptedTier) return { prompt: top, promptedTier: top };
  // top <= promptedTier：不弹，但把"上次弹过"跟着降到 top
  return { prompt: null, promptedTier: top };
}

/**
 * 服务端侧的自检（客户端上报的东西一律夹一遍，态度和 `sanitizeTraitStacks` 一致）。
 *
 * 这里**不校验"这个数合不合理"**（服务端没有击杀账本，算不出来），
 * 只保证形状对、数字有限、不会把负数/NaN 带进战斗。
 * 上限 1e6 是随手拍的一个远高于任何真实玩法的值 —— 它只防"客户端发疯"。
 */
export function sanitizeFever(raw: unknown): FeverState | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const input = raw as Record<string, unknown>;
  const num = (value: unknown, max: number): number => {
    const n = Math.floor(Number(value));
    if (!Number.isFinite(n) || n <= 0) return 0;
    return Math.min(max, n);
  };
  const treasures: number[] = [];
  if (Array.isArray(input.treasures)) {
    for (const item of input.treasures) {
      const value = num(item, 1_000_000);
      if (value > 0 && !treasures.includes(value)) treasures.push(value);
    }
  }
  const promptRaw = Math.floor(Number(input.prompt));
  const prompt = Number.isFinite(promptRaw) && promptRaw > 0 ? Math.min(1_000_000, promptRaw) : null;
  // ★ 0.2：「消耗了、等这一场打赢才发奖励」的那一档（正整数或 null，同一套夹法）
  const pendingRaw = Math.floor(Number(input.pendingTier));
  const pendingTier = Number.isFinite(pendingRaw) && pendingRaw > 0 ? Math.min(1_000_000, pendingRaw) : null;
  // ★ 0.2：「上次弹过的最高档」。和 prompt 同一套夹法（正整数或 null）
  const promptedRaw = Math.floor(Number(input.promptedTier));
  const promptedTier =
    Number.isFinite(promptedRaw) && promptedRaw > 0 ? Math.min(1_000_000, promptedRaw) : null;
  const out: FeverState = {
    total: num(input.total, 1_000_000),
    spent: num(input.spent, 1_000_000),
    armedTicks: num(input.armedTicks, 100_000),
    treasures,
    prompt,
    pendingTier,
    promptedTier,
  };
  // 全空就等于没上报（老客户端 / 从没攒过）——别在玩家身上挂一个空壳
  if (
    out.total === 0 &&
    out.spent === 0 &&
    out.armedTicks === 0 &&
    out.treasures.length === 0 &&
    out.prompt === null &&
    out.pendingTier === null &&
    out.promptedTier === null
  ) {
    return undefined;
  }
  return out;
}
