/**
 * 平衡性诊断：找出「为什么两边胜率差距这么大」。
 *
 * 这个脚本演示一种通用的平衡分析方法：
 *   构造一个「镜像对局」（两边完全是同一个棋子），连打很多场。
 *   理论上胜率应该接近 50%（先手方略占优）。偏离得越多，
 *   说明这个棋子的机制越「先手有利」，也越容易在实战里滚雪球。
 *
 * 用法：
 *   node node_modules/tsx/dist/cli.mjs scripts/balance-probe.ts
 * 或：
 *   node scripts/pnpm.mjs exec tsx scripts/balance-probe.ts
 */
import { UNIT_DEFS, simulate, mirrorSetup, type TeamSetup } from '../packages/shared/src/index.js';

const GAMES = 200;

/** 造一个「单个棋子站在自己半场中间」的阵容 */
function soloTeam(defId: string, star: number): TeamSetup {
  return { team: 0, units: [{ defId, star, cell: { col: 3, row: 2 } }] };
}

/**
 * 造一个「站在对面半场」的单棋子阵容。
 *
 * 【为什么不能直接写 col: 4？——这里踩过一次】
 * 之前这里硬编码了 `{ team: 1, cell: { col: 4, row: 2 } }`，
 * 而队伍 1 的半场是 col ≥ 5 —— 于是脚本直接抛「棋子放错半场了」，整个第 2 节跑不出来。
 * 现在统一用 mirrorSetup()（和真实联机走的是同一个函数），
 * 以后改棋盘尺寸也不会再失效。
 */
function enemySoloTeam(defId: string, star: number): TeamSetup {
  return mirrorSetup(soloTeam(defId, star));
}

/**
 * 对局统计。
 *
 * 【★ 为什么必须把"平局"单独算？—— 这里踩过一次】
 * 以前这里只数 `winner === 0`，然后除以总场数，叫它"胜率"。
 * 结果：一个**每场都打平**的坦克，显示成「胜率 0%」，
 * 看起来像"这个棋子的机制完全坏了"，实际上它只是打不死人。
 * 诊断工具报错比崩溃更危险 —— 崩溃你立刻知道，报错你还照着它去改数值。
 * 所以现在三个数分开报：胜 / 平 / 负。
 */
interface Tally {
  wins: number;
  draws: number;
  losses: number;
  games: number;
  /** 平均时长（秒） */
  seconds: number;
  /** 有多少场是打满 75 秒超时的 */
  timeouts: number;
}

function tally(team0: TeamSetup, team1: TeamSetup, games: number, seedBase = 5000, seedStep = 104729): Tally {
  let wins = 0;
  let draws = 0;
  let losses = 0;
  let totalTicks = 0;
  let timeouts = 0;

  for (let i = 0; i < games; i++) {
    const result = simulate(UNIT_DEFS, [team0, team1], seedBase + i * seedStep);
    if (result.winner === 0) wins++;
    else if (result.winner === null) draws++;
    else losses++;
    totalTicks += result.ticks;
    // 1500 tick = 75 秒是上限，打到上限说明双方都打不死对方
    if (result.ticks >= 1500) timeouts++;
  }

  return { wins, draws, losses, games, seconds: totalTicks / games / 20, timeouts };
}

function bar(rate: number, width = 20): string {
  return '█'.repeat(Math.round(rate * width)).padEnd(width, '·');
}

/** 把统计压成一行：胜率条 + 平局/超时标记 */
function summarize(t: Tally): string {
  const rate = t.wins / t.games;
  const drawRate = t.draws / t.games;
  const drawMark = drawRate > 0.02 ? ` 平${(drawRate * 100).toFixed(0)}%` : '';
  const timeoutMark = t.timeouts / t.games > 0.5 ? ' ⏱僵持' : '';
  return `${(rate * 100).toFixed(0).padStart(3)}% ${bar(rate)}${drawMark}${timeoutMark}`;
}

const ids = Object.keys(UNIT_DEFS);

console.log('\n=== 1. 镜像对局诊断（单棋子，两边完全相同，各 200 场）===');
console.log('理论上应该接近 50% 胜 / 50% 平（先手方略占优）。');
console.log('  · 胜率明显偏离 50%  => 先手优势过大（通常是"击杀太快"）');
console.log('  · 大量平局 / 僵持    => 双方都打不死对方，会一直拖到 75 秒超时');
console.log('  · 时长普遍 < 8 秒    => 伤害/血量比例失衡，战斗来不及展开\n');
console.log('棋子'.padEnd(12) + '  ' + '1星'.padEnd(36) + '3星');
console.log('-'.repeat(86));

for (const id of ids) {
  const r1 = tally(soloTeam(id, 1), mirrorSetup(soloTeam(id, 1)), GAMES);
  const r3 = tally(soloTeam(id, 3), mirrorSetup(soloTeam(id, 3)), GAMES);
  console.log(
    `${UNIT_DEFS[id]!.name.padEnd(10)}  ${summarize(r1).padEnd(34)}  ${summarize(r3)}  ${r3.seconds.toFixed(1)}秒`,
  );
}

console.log('\n=== 2. 升星收益验证（1星 打 3星，同一个棋子）===');
console.log('3星血量/攻击是 1星的 3.24 倍，应该稳定压制。1星若常赢 => 升星收益不足。\n');
const badStar: string[] = [];
for (const id of ids) {
  const t = tally(soloTeam(id, 1), enemySoloTeam(id, 3), 100, 777, 31);
  const rate = t.wins / t.games;
  const verdict = rate === 0 ? '✓ 完全压制' : rate < 0.1 ? '~ 偶尔翻盘（正常）' : '✗ 升星收益不足';
  if (rate >= 0.1) badStar.push(`${UNIT_DEFS[id]!.name}（${id}）1星胜率 ${(rate * 100).toFixed(0)}%`);
  console.log(`${UNIT_DEFS[id]!.name.padEnd(10)}  1星胜率 ${(rate * 100).toFixed(0).padStart(3)}%   ${verdict}`);
}
if (badStar.length > 0) {
  console.log('\n⚠️ 这些棋子升到 3 星后压不住 1 星，检查一下星级倍率或技能：');
  for (const item of badStar) console.log(`   ${item}`);
}

console.log('\n=== 3. 全棋子两两对抗矩阵（左上打右上，数字是"行"棋子的胜率）===');
console.log('这张表能直接看出「谁是谁的克星」，是调平衡最有用的视图。\n');
const shortName = (id: string): string => UNIT_DEFS[id]!.name.slice(0, 3);
process.stdout.write(''.padEnd(12));
for (const id of ids) process.stdout.write(shortName(id).padStart(6));
console.log('');
for (const rowId of ids) {
  process.stdout.write(UNIT_DEFS[rowId]!.name.padEnd(10) + '  ');
  for (const colId of ids) {
    if (rowId === colId) {
      process.stdout.write('  --  ');
      continue;
    }
    const t = tally(soloTeam(rowId, 2), enemySoloTeam(colId, 2), 40, 777, 31);
    process.stdout.write(`${((t.wins / t.games) * 100).toFixed(0).padStart(4)}% `);
  }
  console.log('');
}

console.log('\n=== 4. ★ 3星 4费 / 5费 的「爽点」验证 ===');
console.log('你定的目标：');
console.log('  · 3 星 4 费  = 单人有「改变战局」的实力');
console.log('  · 3 星 5 费  = 有「爽点」（一人单挑全图）');
console.log('');
console.log('【这两个目标不能用同一把尺子量，所以分开测】');
console.log('  A) 单挑：这个棋子一个人打一队，赢几成、打死了几个。');
console.log('     —— 这是"一人单挑全图"的直接度量。');
console.log('  B) 改变战局：先让一支**很弱的杂兵队**去打强敌（必输），');
console.log('     再把这一个 3 星棋子塞进去，看能不能反败为胜。');
console.log('     —— 这才是"改变战局"的准确含义：它的加入把输变成赢。');
console.log('     注意 B 组必须先确认"没有它必输"，否则这条测量是假的。\n');

/** 在一方半场里摆 N 个棋子（一列一列往前排，最多 5 列 × 10 行） */
function boardOf(team: 0 | 1, defIds: string[], star: number): TeamSetup {
  const cols = team === 0 ? [4, 3, 2, 1, 0] : [5, 6, 7, 8, 9];
  const units = defIds.map((defId, index) => ({
    defId,
    star,
    cell: { col: cols[Math.floor(index / 10)] ?? cols[0]!, row: index % 10 },
  }));
  return { team, units };
}

/** 一个"典型中期阵容"：1~2 费各来几个，2 星 */
function midBoard(): string[] {
  const cheap = Object.values(UNIT_DEFS)
    .filter((def) => def.cost <= 2 && !def.summonOnly)
    .map((def) => def.id)
    .sort();
  return [cheap[0]!, cheap[3]!, cheap[6]!, cheap[9]!, cheap[12]!, cheap[15]!];
}

/** 一个"典型后期阵容"：1~3 费混编，2 星，8 个 */
function lateBoard(): string[] {
  const pool = Object.values(UNIT_DEFS)
    .filter((def) => def.cost <= 3 && !def.summonOnly)
    .map((def) => def.id)
    .sort();
  return [pool[0]!, pool[5]!, pool[10]!, pool[15]!, pool[20]!, pool[25]!, pool[30]!, pool[34]!];
}

/** 一支"很弱的杂兵队"：3 个 1 星 1 费 */
function weakSquad(): string[] {
  const cheap = Object.values(UNIT_DEFS)
    .filter((def) => def.cost === 1 && !def.summonOnly)
    .map((def) => def.id)
    .sort();
  return [cheap[0]!, cheap[5]!, cheap[10]!];
}

/** 跑一场，返回胜率和"打死了几个敌人" */
function fight(
  mine: TeamSetup,
  theirs: TeamSetup,
  games: number,
  seedBase: number,
): { rate: number; kills: number; seconds: number } {
  const t = tally(mine, theirs, games, seedBase, 7919);
  // 单独再跑一场看打死几个（用第一场的种子）
  const state = simulate(UNIT_DEFS, [mine, theirs], seedBase);
  const enemyCount = theirs.units.length;
  const dead = enemyCount - countAliveAtEnd(state, 1);
  return { rate: t.wins / t.games, kills: dead / enemyCount, seconds: t.seconds };
}

/** 战斗结束时某一队还剩几个 —— 从日志里数（含中途召唤出来的） */
function countAliveAtEnd(state: ReturnType<typeof simulate>, team: 0 | 1): number {
  const ids = new Set<number>();
  const died = new Set<number>();
  for (const event of state.log) {
    if (event.type === 'spawn' && event.team === team) ids.add(event.unitId);
    if (event.type === 'death') died.add(event.unitId);
  }
  let alive = 0;
  for (const id of ids) if (!died.has(id)) alive++;
  return alive;
}

const fourStars = Object.values(UNIT_DEFS).filter((def) => def.cost === 4 && !def.summonOnly);
const fiveStars = Object.values(UNIT_DEFS).filter((def) => def.cost === 5 && !def.summonOnly);

/*
  ---- 先验证基线 ----
  没有这一条，"改变战局"的测量就是假的：
  如果那支杂兵队本来就能赢，那"塞进一个 3 星之后赢了"完全不能说明它有用。
*/
const midEnemies = boardOf(1, midBoard(), 2);
const weakAlone = tally(boardOf(0, weakSquad(), 1), midEnemies, 120, 31000);

/** 结论部分要用到每个棋子的两项胜率，边测边记下来（免得再跑一遍） */
const soloRates = new Map<string, number>();
const carryRates = new Map<string, number>();
console.log(
  `基线（3 个 1 星 1 费  打  6 个 2 星 1~2 费）：胜率 ${((weakAlone.wins / weakAlone.games) * 100).toFixed(0)}%` +
    `${weakAlone.wins / weakAlone.games > 0.1 ? '  ⚠️ 基线不够弱，"改变战局"这条会失真' : '  ✓ 基线很弱，这条测量有效'}`,
);
console.log('');

console.log('【A) 3 星 4 费  一人打 6 个 2 星 1~2 费】');
console.log('棋子'.padEnd(14) + '胜率' + ''.padEnd(24) + '打死'.padEnd(7) + 'B) 加它之后(3 个 1 星杂兵)');
console.log('-'.repeat(84));
for (const def of fourStars) {
  const solo: TeamSetup = { team: 0, units: [{ defId: def.id, star: 3, cell: { col: 3, row: 4 } }] };
  const soloResult = fight(solo, midEnemies, 120, 31000);
  soloRates.set(def.id, soloResult.rate);

  // B 组：3 星棋子 + 3 个 1 星杂兵
  const carried = boardOf(0, weakSquad(), 1);
  carried.units.push({ defId: def.id, star: 3, cell: { col: 3, row: 4 } });
  const carryResult = fight(carried, midEnemies, 120, 31000);
  carryRates.set(def.id, carryResult.rate);

  const soloMark = soloResult.rate >= 0.5 ? '✓' : soloResult.rate >= 0.2 ? '~' : '✗';
  const carryMark = carryResult.rate >= 0.6 ? '✓' : carryResult.rate >= 0.3 ? '~' : '✗';
  console.log(
    `${def.name.padEnd(12)}  ${summarize(tally(solo, midEnemies, 40, 31000)).padEnd(30)} ` +
      `${(soloResult.kills * 100).toFixed(0).padStart(3)}%   ${(carryResult.rate * 100).toFixed(0).padStart(3)}% ${carryMark} ${soloMark}`,
  );
}

console.log('\n【A) 3 星 5 费  一人打 8 个 2 星 1~3 费（"一人单挑全图"）】');
console.log('棋子'.padEnd(14) + '胜率' + ''.padEnd(24) + '打死'.padEnd(7) + 'B) 加它之后(3 个 1 星杂兵)');
console.log('-'.repeat(84));
const lateEnemies = boardOf(1, lateBoard(), 2);
for (const def of fiveStars) {
  const solo: TeamSetup = { team: 0, units: [{ defId: def.id, star: 3, cell: { col: 3, row: 4 } }] };
  const soloResult = fight(solo, lateEnemies, 120, 51000);
  soloRates.set(def.id, soloResult.rate);

  const carried = boardOf(0, weakSquad(), 1);
  carried.units.push({ defId: def.id, star: 3, cell: { col: 3, row: 4 } });
  const carryResult = fight(carried, lateEnemies, 120, 51000);
  carryRates.set(def.id, carryResult.rate);

  const soloMark = soloResult.rate >= 0.9 ? '✓' : soloResult.rate >= 0.5 ? '~' : '✗';
  const carryMark = carryResult.rate >= 0.8 ? '✓' : carryResult.rate >= 0.4 ? '~' : '✗';
  console.log(
    `${def.name.padEnd(12)}  ${summarize(tally(solo, lateEnemies, 40, 51000)).padEnd(30)} ` +
      `${(soloResult.kills * 100).toFixed(0).padStart(3)}%   ${(carryResult.rate * 100).toFixed(0).padStart(3)}% ${carryMark} ${soloMark}`,
  );
}

/**
 * 这个棋子的 3 星技能是"清场型"、"单体输出型"还是"辅助型"？
 *
 * 【为什么要分？】
 * 因为"一人单挑全图"这条要求**只对清场型成立**。
 * 单体狙击（蕾缪安：攻速 0.55，专打最低血量）、纯辅助（可露希尔：给队友上 buff）、
 * 复活型（新约能天使：把死掉的队友拉回 3 星）本来就不该一个人清场 ——
 * 一个人站前排被打死是**站位问题**，不是棋子弱。
 * 把它们和"真的做坏了"混在一张榜上，会让人去改本来没问题的数值。
 */
function kitKind(def: (typeof UNIT_DEFS)[string]): 'clear' | 'single' | 'support' {
  const variant = def.skill.star3 ?? { effects: def.skill.effects, passive: def.skill.passive };
  const statBags = [
    variant.passive,
    ...variant.effects.flatMap((e) => ('stats' in e && e.stats ? [e.stats] : [])),
  ].filter(Boolean) as Array<Record<string, unknown>>;

  // 能清场：范围伤害 / 连续攻击 / 多目标 / 周期性范围伤害
  const hasClear =
    statBags.some((s) => s['splash'] || s['multiHit'] || s['extraTargets'] || s['pulse']) ||
    variant.effects.some((e) => e.kind === 'trap' || (e.kind === 'damage' && (e.radius ?? 0) > 0));
  if (hasClear) return 'clear';

  // 纯辅助：只给队友上增益 / 给盾 / 复活，自己没有输出手段
  const hasSupport =
    statBags.some((s) => s['onAttackAllyBuff'] || s['allyLowHpGuard'] || s['cannotDie']) ||
    variant.effects.some((e) => e.kind === 'revive' || e.kind === 'heal' || e.kind === 'shield');
  if (hasSupport) return 'support';

  return 'single';
}

/** 打印一组结论 */
function reportBucket(title: string, rows: string[], hint: string): void {
  if (rows.length === 0) return;
  console.log(`\n${title}`);
  for (const row of rows) console.log(`   ${row}`);
  console.log(`   → ${hint}`);
}

console.log('\n--- 结论 ---');
const roleLimited: string[] = [];
const realProblem: string[] = [];
for (const def of [...fourStars, ...fiveStars]) {
  const soloNeeded = def.cost === 5 ? 0.5 : 0.2;
  const carryNeeded = def.cost === 5 ? 0.8 : 0.6;
  const solo = soloRates.get(def.id) ?? 0;
  const carry = carryRates.get(def.id) ?? 0;
  if (solo >= soloNeeded || carry >= carryNeeded) continue;
  const kind = kitKind(def);
  const kindLabel = kind === 'clear' ? '清场型' : kind === 'support' ? '辅助型' : '单体输出型';
  const line =
    `${def.name}（${def.id}·${def.cost}费·${kindLabel}）单挑 ${(solo * 100).toFixed(0)}% / 带队 ${(carry * 100).toFixed(0)}%` +
    ` —— 3 星技能：「${def.skill.star3?.name ?? def.skill.name}」`;
  if (kind === 'clear') realProblem.push(line);
  else roleLimited.push(line);
}

reportBucket(
  '⚠️ 机制决定它不该单挑（单体输出 / 纯辅助）—— 不用改',
  roleLimited,
  '它们的价值在"配合"：单体狙击负责点掉关键目标，辅助负责让队友变强。一个人站前排被打死是站位问题，不是棋子弱。',
);
reportBucket(
  '❗ 技能是清场型，但实际清不动 —— 这几个需要你决定怎么调',
  realProblem,
  '多半是"活不到技能打满"：倍率够，但前摇太长或太脆。建议先动生存（血量/护甲），别急着加倍率 —— 加倍率只会让它在能赢的对局里更碾压。',
);
if (roleLimited.length === 0 && realProblem.length === 0) {
  console.log('✅ 全部达标：每个 3 星高费要么能单挑，要么带队能反败为胜。');
}

console.log('\n=== 读表提示 ===');
console.log('  · 某一行普遍很高 => 这个棋子超模，需要削数值或加代价');
console.log('  · 某一列普遍很低 => 这个棋子是「谁都能打」的废柴');
console.log('  · 镜像胜率远离 50% => 先手优势过大，通常因为「击杀太快」');
console.log('  · 大量「僵持」=> 双方都打不死对方；实际对局里少一些（阵容是混编的），');
console.log('    但如果两个玩家都堆坦克就会每回合都拖到超时 —— 这是你该决定的设计点');
console.log('  · 战斗普遍短于 8 秒 => 应该整体提高血量，或整体降低伤害');
console.log('');
