/**
 * 自走棋战斗内核 —— 命令行调试工具
 *
 * 用法：
 *   npm run sim                     跑一场预设对战
 *   npm run sim -- --seed 42        指定随机种子
 *   npm run sim -- --best-of 20     连打 20 个种子，统计双方胜率（调平衡用）
 *   npm run sim -- --stats          打印输出/承伤统计
 *   npm run sim -- --board          打印棋盘站位
 *   npm run sim -- --help
 */

import {
  TEAM_ASSASSINS,
  TEAM_KNIGHTS,
  UNIT_DEFS,
  createBattle,
  renderBattleStats,
  renderBattleText,
  renderBoard,
  simulate,
  type BattleResult,
  type TeamSetup,
} from '../../shared/src/index.js';

interface Args {
  seed: number;
  stats: boolean;
  board: boolean;
  bestOf: number;
  quiet: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { seed: 20250101, stats: false, board: false, bestOf: 0, quiet: false };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    switch (token) {
      case '--seed':
        args.seed = Number(argv[++i] ?? 0) | 0;
        break;
      case '--best-of':
        args.bestOf = Number(argv[++i] ?? 0);
        break;
      case '--stats':
        args.stats = true;
        break;
      case '--board':
        args.board = true;
        break;
      case '--quiet':
        args.quiet = true;
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
        break;
      default:
        if (token && token.startsWith('--seed=')) args.seed = Number(token.split('=')[1]) | 0;
        break;
    }
  }
  return args;
}

function printHelp(): void {
  console.log(`
自走棋战斗内核 —— 命令行调试工具

  --seed <n>      指定随机种子（同一个种子必然打出完全一样的战斗）
  --best-of <n>   用 n 个不同种子连打，统计胜率（调平衡用）
  --stats         打印每个棋子的输出 / 承伤 / 治疗
  --board         打印棋盘站位（A=队伍0，B=队伍1，后面数字是星级）
  --quiet         连打模式下只输出统计表
  -h, --help      显示帮助
`);
}

/** 给棋子取个人类可读的名字，例如 [A1]铁壁骑士（A=队伍0，B=队伍1，数字是队内序号） */
function buildNames(teams: [TeamSetup, TeamSetup]): Record<number, string> {
  const names: Record<number, string> = {};
  for (const setup of teams) {
    setup.units.forEach((placement, index) => {
      const id = setup.team * 1000 + index + 1;
      const def = UNIT_DEFS[placement.defId];
      // 加上队内序号：同名棋子（比如两个铁壁骑士）在统计表里才能区分开
      names[id] = `[${setup.team === 0 ? 'A' : 'B'}${index + 1}]${def?.name ?? placement.defId}`;
    });
  }
  return names;
}

function runBestOf(teams: [TeamSetup, TeamSetup], count: number, quiet: boolean): void {
  let team0Wins = 0;
  let team1Wins = 0;
  let draws = 0;
  let totalTicks = 0;
  const pickRate = new Map<string, { games: number; wins: number }>();

  // 记录每个棋子上场时它所在队伍的胜负，用来粗略看强度
  const rosterOf = (setup: TeamSetup): string[] => setup.units.map((u) => `${u.defId}${u.star}星`);

  for (let i = 0; i < count; i++) {
    // 用连续的种子，保证结果可复现（同样的 count 永远得到同样的统计）
    const seed = 1000 + i * 7919;
    const result = simulate(UNIT_DEFS, teams, seed);
    totalTicks += result.ticks;
    if (result.winner === 0) team0Wins++;
    else if (result.winner === 1) team1Wins++;
    else draws++;

    for (const defId of rosterOf(teams[0])) {
      const entry = pickRate.get(defId) ?? { games: 0, wins: 0 };
      entry.games++;
      if (result.winner === 0) entry.wins++;
      pickRate.set(defId, entry);
    }
    for (const defId of rosterOf(teams[1])) {
      const entry = pickRate.get(defId) ?? { games: 0, wins: 0 };
      entry.games++;
      if (result.winner === 1) entry.wins++;
      pickRate.set(defId, entry);
    }
  }

  const pct = (n: number): string => `${((n / count) * 100).toFixed(1)}%`;

  console.log(`\n=== 连打 ${count} 场（种子 1000 起，步长 7919）===`);
  console.log(`  队伍0（骑士阵）  胜 ${String(team0Wins).padStart(3)} 场  ${pct(team0Wins)}`);
  console.log(`  队伍1（刺客阵）  胜 ${String(team1Wins).padStart(3)} 场  ${pct(team1Wins)}`);
  console.log(`  平局             ${String(draws).padStart(3)} 场  ${pct(draws)}`);
  console.log(`  平均战斗时长     ${(totalTicks / count / 20).toFixed(1)} 秒`);

  console.log('\n  出场棋子胜率（同一棋子可能两边都出场，所以两边都要看）：');
  const rows = [...pickRate.entries()].sort((a, b) => b[1].wins / b[1].games - a[1].wins / a[1].games);
  for (const [name, entry] of rows) {
    const rate = ((entry.wins / entry.games) * 100).toFixed(1);
    const bar = '█'.repeat(Math.round((entry.wins / entry.games) * 20));
    console.log(`    ${name.padEnd(18, ' ')} ${rate.padStart(5)}%  ${bar}`);
  }
  console.log('');
}

function runSingle(teams: [TeamSetup, TeamSetup], args: Args): void {
  const names = buildNames(teams);

  if (args.board) {
    const state = createBattle(UNIT_DEFS, teams, args.seed);
    console.log('\n=== 开局站位 ===');
    console.log(renderBoard(state));
  }

  const result: BattleResult = simulate(UNIT_DEFS, teams, args.seed);

  console.log(`\n=== 战斗过程（seed=${args.seed}）===\n`);
  console.log(renderBattleText(result, UNIT_DEFS, names));

  if (args.stats) {
    console.log('\n=== 战斗统计 ===');
    console.log(renderBattleStats(result, UNIT_DEFS, names));
  }

  console.log(`\n提示：换个种子看看不同结果 ->  npm run sim -- --seed ${args.seed + 1}`);
  console.log('      同一个种子跑两次，上面每个字都会完全相同 —— 这就是联机的基石。\n');
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const teams: [TeamSetup, TeamSetup] = [TEAM_KNIGHTS, TEAM_ASSASSINS];

  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║   AIRNIGHT 自走棋 —— 确定性战斗内核调试台        ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log(`棋子库共 ${Object.keys(UNIT_DEFS).length} 个棋子：${Object.values(UNIT_DEFS).map((d) => `${d.name}(${d.cost}费)`).join('、')}`);

  if (args.bestOf > 0 && !args.quiet) runSingle(teams, args);
  if (args.bestOf > 0) runBestOf(teams, args.bestOf, args.quiet);
  else if (!args.quiet) runSingle(teams, args);
}

main();
