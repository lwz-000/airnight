/**
 * ============================================================
 *  一键启动 —— 双击「启动游戏.cmd」时真正跑的就是这个文件
 * ============================================================
 *
 * 【为什么要单独写一个启动器，而不是让 cmd 里写两行命令？】
 * 因为"和朋友联机"其实需要**三件事同时发生**，缺一件就玩不了：
 *   1. 打包网页            （不然改过的代码不会生效）
 *   2. 起游戏服务器        8787（联机对战、牌库、回合推进都靠它）
 *   3. 起一体化网页服务器  5173（发网页 + 把 WebSocket 转给 8787）
 *
 * 而且它们有**先后依赖**：服务器要先起来，网页才转发得通。
 * 写在一个 Node 进程里，好处是：
 *   · 只有一个窗口，关掉窗口 = 全部停止，不会留下"僵尸进程占着端口"
 *   · 端口被占用、依赖没装、打包失败这些情况能给出**人话**的提示
 *   · 地址和链接按你的网卡自动算出来，不用自己查 IP
 *
 * ============================================================
 *  ★ 为什么中文提示都写在 Node 里，而不是写在 .cmd 里？
 * ============================================================
 * 因为 **cmd.exe 读 .cmd 文件是按当前代码页逐行解释的**。
 * 文件存成 UTF-8 时，里面任何一个中文都会被解析成乱码命令，
 * 直接报 `'??启动游戏' is not recognized as an internal or external command`。
 * （这不是猜的 —— 这个项目里已经实测踩过一次。）
 * 所以 .cmd 里只有纯 ASCII 的几行，所有中文一律由 Node 输出
 * （.cmd 开头会先 `chcp 65001`，Node 的 UTF-8 输出就能正常显示）。
 *
 * 用法：
 *   node node_modules/tsx/dist/cli.mjs scripts/launch.ts
 *   ... scripts/launch.ts --no-build     跳过打包（快速重启）
 *   ... scripts/launch.ts --no-open      不自动开浏览器
 *   ... scripts/launch.ts --port=5173 --game=8787
 *   ... scripts/launch.ts --hidden       无控制台模式（双击「启动游戏.vbs」时用这个）：
 *                                        输出写进「游戏日志.txt」、日志不带颜色码
 *
 * ============================================================
 *  ★ 0.3.2：端口被占时**自动往后顺延**
 * ============================================================
 * 以前 5173/8787 被占就直接报错退出（文案是"看看任务栏里有没有另一个黑色窗口"）。
 * 黑框藏起来之后那句提示就没用了，而且"我的浏览器 / 别的程序正好占着这个端口"
 * 本来也不该让人开不了游戏。现在两个端口都会从默认值往上找第一个能开的
 * （最多试 20 个），并且**打印出来的地址用的是真实端口**。
 * ★ 只对 EADDRINUSE 顺延：没权限之类的错误照旧直接报，不能被"试了 20 个都不行"盖住。
 *
 * ============================================================
 *  ★ 0.3.2：单实例 —— 双击第二次只是"把浏览器叫回来"
 * ============================================================
 * 端口会自动顺延之后，"端口被占"就不再是"你已经开着一个"的信号了，
 * 所以另存一个运行标记 `.airnight-run.json`（pid + 两个端口 + 地址）：
 *   · 进程还活着、端口也真的在听 ⇒ 直接打开浏览器，不再起第二份；
 *   · 标记在但进程没了（被任务管理器杀了）⇒ 当成过期标记，正常启动。
 */
import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { randomBytes } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');

const argv = process.argv.slice(2);
function flagValue(name: string, fallback: number): number {
  const hit = argv.find((item) => item.startsWith(`--${name}=`));
  return hit ? Number(hit.slice(name.length + 3)) : fallback;
}
/** 端口被占时最多往上试几个（5173 → 5192，8787 → 8806） */
const PORT_SCAN_TRIES = 20;
const WEB_PORT = flagValue('port', 5173);
const GAME_PORT = flagValue('game', 8787);
const SKIP_BUILD = argv.includes('--no-build');
const NO_OPEN = argv.includes('--no-open');
/** 无控制台模式：由「启动游戏.vbs」传进来（没有窗口 ⇒ 输出必须落文件） */
const HIDDEN = argv.includes('--hidden');

/** 运行标记：单实例判定 + 「正在跑的到底是哪一份」 */
const RUN_FILE = join(repoRoot, '.airnight-run.json');
/**
 * ★ 0.3.3：应用窗口的**专属浏览器档案**。
 *
 * 【为什么放在包目录里，而不是 %APPDATA%？】
 * 这个包里本来就要写 `游戏日志.txt` / `.airnight-run.json`，说明"解压到哪儿，
 * 哪儿就是可写的"。放在包内还有个好处：整个文件夹复制走 = 连窗口位置一起带走，
 * 也不会在玩家机器上留一堆找不到出处的缓存。
 */
const WINDOW_PROFILE = join(repoRoot, '.window-profile');
/** 隐藏模式下的日志（每次启动覆盖：一次启动一份，方便"出问题就把这份发我"） */
const LOG_FILE = join(repoRoot, '游戏日志.txt');

/**
 * 能开「应用窗口」的浏览器（只有 Chromium 系认 `--app`）。
 * ★ 顺序就是优先级：Windows 上 Edge 一定有，而且不占玩家自己装的 Chrome 的档案。
 */
const APP_BROWSERS: Array<{ label: string; paths: string[] }> = [
  {
    label: 'Edge',
    paths: [
      'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
      'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    ],
  },
  {
    label: 'Chrome',
    paths: [
      'C:/Program Files/Google/Chrome/Application/chrome.exe',
      'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    ],
  },
];

/** 一扇"我们自己打开的窗口" —— 能不能感知它被关掉了 */
interface AppWindowHandle {
  label: string;
  /** 浏览器进程退出时 resolve：值是它活了多久（毫秒） */
  exited: Promise<number>;
  kill: () => void;
}

/**
 * ★ 隐藏模式不能带颜色码：那些 `\u001b[32m` 写进 txt 会变成一堆乱码方块。
 * 所以干脆把颜色表清空 —— 调用处一个都不用改。
 */
const C = (HIDDEN || process.env.NO_COLOR !== undefined
  ? { reset: '', dim: '', green: '', cyan: '', yellow: '', red: '', bold: '' }
  : {
      reset: '\u001b[0m',
      dim: '\u001b[2m',
      green: '\u001b[32m',
      cyan: '\u001b[36m',
      yellow: '\u001b[33m',
      red: '\u001b[31m',
      bold: '\u001b[1m',
    }) as Record<'reset' | 'dim' | 'green' | 'cyan' | 'yellow' | 'red' | 'bold', string>;



/**
 * 一个"给玩家看的"错误。
 *
 * 【为什么要专门弄一个类型？】
 * 因为"端口被占用"和"代码写崩了"要给完全不同的提示：
 * 前者是操作问题（关掉另一个窗口就好），后者要贴报错给我。
 * 混在一起的话，玩家看到一大段调用栈只会更慌。
 */
class FriendlyError extends Error {}

/** 收集本机的局域网 IPv4（用来生成"同一个 WiFi 就能进"的链接） */
function lanAddresses(): string[] {
  const out: string[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const info of list ?? []) {
      if (info.family !== 'IPv4' || info.internal) continue;
      if (info.address.startsWith('169.254.')) continue; // 没连上网时的自分配地址
      out.push(info.address);
    }
  }
  return out;
}

/** 出问题后别让窗口一闪而过（否则玩家根本看不到原因） */
function waitForEnter(): Promise<void> {
  if (!process.stdin.isTTY) return Promise.resolve();
  process.stdout.write(`\n${C.dim}按回车键关闭这个窗口…${C.reset}`);
  return new Promise((resolve) => {
    process.stdin.resume();
    process.stdin.once('data', () => resolve());
  });
}

// ============================================================
//  隐藏模式
// ============================================================

/**
 * 把 console 的输出重定向到日志文件（隐藏模式下没有窗口可看）。
 *
 * ★ 为什么连 `console.error` 也要接？因为启动失败的**原因**就在那几行里
 *   —— 「启动游戏.vbs」弹窗让玩家"打开日志"，打开的必须是这份。
 *
 * ★★ 为什么用 `appendFileSync` 而不是 WriteStream？
 *   写文件是流 = 异步的，而启动失败那条路是 `process.exit(1)` ——
 *   退出会丢掉还在缓冲区里的那几行，于是"出问题的时候日志是空的"。
 *   这一条是真踩出来的：隐藏模式打包失败，日志文件连创建都没来得及。
 *   日志量本来就极小（只在建房/开打/掉线这类事件打一行，不是每帧），
 *   用同步写换来"写到就是落盘"，非常划算。
 */
let logTarget: string | null = null;

/** 一行日志怎么变成字符串（Error 要带上调用栈，否则等于没写） */
function logText(item: unknown): string {
  if (typeof item === 'string') return item;
  if (item instanceof Error) return item.stack ?? `${item.name}: ${item.message}`;
  return String(item);
}

function redirectOutputToFile(file: string): void {
  logTarget = file;
  try {
    writeFileSync(file, '', 'utf8');
  } catch {
    /* 建不出文件也不能让游戏起不来 */
  }
  const wrap =
    (prefix: string) =>
    (...args: unknown[]): void => {
      const target = logTarget;
      if (!target) return;
      try {
        appendFileSync(target, prefix + args.map(logText).join(' ') + '\n', 'utf8');
      } catch {
        /* 同上 */
      }
    };
  console.log = wrap('');
  console.error = wrap('[错误] ');
  console.warn = wrap('[警告] ');
}

// ============================================================
//  端口：被占就往后顺延
// ============================================================

type OpenAttempt<T> =
  | { ok: true; value: T; port: number }
  | { ok: false; code?: string; error?: Error };

/**
 * 从 `start` 开始往上找第一个能监听的端口。
 *
 * 【为什么只对 EADDRINUSE 顺延？】
 * "端口被别的程序占了"和"这台机器不允许监听 / 地址不可用"是两回事。
 * 后者要是也被吞进"试了 20 个都不行"里，真正的原因就永远查不出来了。
 */
async function openOnFirstFreePort<T>(
  start: number,
  label: string,
  open: (port: number) => Promise<OpenAttempt<T>>,
): Promise<{ value: T; port: number; shifted: number }> {
  for (let i = 0; i < PORT_SCAN_TRIES; i++) {
    const port = start + i;
    if (port > 65535) break;
    const result = await open(port);
    if (result.ok) return { value: result.value, port, shifted: i };
    if ((result.code ?? '') !== 'EADDRINUSE') {
      throw new FriendlyError(`${label}起不来：${result.error?.message ?? '未知错误'}`);
    }
  }
  throw new FriendlyError(
    `从 ${start} 开始试了 ${PORT_SCAN_TRIES} 个端口，全都被占用了。\n` +
      '  关掉占用端口的那几个程序，或者直接指定一个：\n' +
      `      ${C.cyan}启动游戏.cmd --port=6000${C.reset}\n` +
      `      ${C.cyan}启动游戏.cmd --port=6000 --game=6001${C.reset}`,
  );
}

/** 某个端口上有没有人在听（单实例判定用；连上就算，不看内容） */
function portListening(port: number, host = '127.0.0.1'): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ port, host });
    const done = (result: boolean): void => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(600, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

// ============================================================
//  打开浏览器 / 运行标记
// ============================================================

/**
 * 用**系统默认浏览器**打开一个地址。
 *
 * ★ Windows 上为什么不用 `cmd /c start`？
 *   它会给自己开一个 conhost —— 无控制台模式（双击 .vbs）下会**闪一下黑框**，
 *   正好把"隐藏黑框"这件事做废。`rundll32 url.dll,FileProtocolHandler`
 *   是系统自带的"用默认程序打开 URL"，不经过 cmd，没有窗口。
 */
/**
 * 打开游戏窗口。
 *
 * ============================================================
 *  ★★ 0.3.3：从"开一个浏览器标签页"改成"开一个**应用窗口**"（用户口径）
 * ============================================================
 * 以前是 `rundll32 url.dll,FileProtocolHandler <url>` —— 系统默认浏览器 +
 * 一个普通标签页：有地址栏、有标签条、任务栏是浏览器的图标、Alt+Tab 显示的是浏览器。
 * 玩家一眼就看得出"这是个网页"。
 *
 * 现在优先用 **Edge / Chrome 的 `--app=<url>` 模式**：
 *   · 窗口里**只有页面**，没有地址栏 / 标签页 / 书签栏；
 *   · `--user-data-dir` 指到包内的 `.window-profile` ⇒ 一个**专属浏览器档案**：
 *     任务栏独立、Alt+Tab 显示游戏标题、窗口尺寸/位置会被记住，
 *     也不会和你平时浏览网页的那个窗口互相干扰；
 *   · favicon 就是任务栏图标（见 `scripts/make-app-icon.py`）；
 *   · 关掉这扇窗 = 浏览器进程退出，启动器据此停掉后台（见下面 `exited`）。
 *
 * 找不到 Chromium 系浏览器就退回原来的默认浏览器 —— 宁可有地址栏，
 * 也不能让玩家打不开游戏。
 *
 * @returns 句柄（能感知"窗口关了"）；退回默认浏览器时返回 null。
 */
function openAppWindow(url: string): AppWindowHandle | null {
  /*
    ★ 只对 Windows 做应用窗口。macOS / Linux 上退回默认浏览器：
    这条分支没有真机验证过，不写"看起来能跑但没人试过"的代码。
  */
  if (process.platform !== 'win32') return null;
  if (argv.includes('--no-app-window')) return null;

  const browser = APP_BROWSERS.find((item) => item.paths.some((path) => existsSync(path)));
  if (!browser) return null;
  const exe = browser.paths.find((path) => existsSync(path));
  if (!exe) return null;

  const startedAt = Date.now();
  const child = spawn(
    exe,
    [
      `--app=${url}`,
      /*
        ★ 专属档案目录。三个作用：
        ① 独立任务栏条目 / 独立窗口位置记忆；
        ② 不碰玩家平时那个浏览器（书签、扩展、登录态都不会被带进来）；
        ③ 第二次启动时能用"这个目录被占用了吗"判断窗口是否还开着。
      */
      `--user-data-dir=${WINDOW_PROFILE}`,
      // 第一次兜底尺寸（之后浏览器会记住玩家自己拖的大小）
      '--window-size=1440,900',
      // 游戏要一直在前台跑：别因为窗口失焦就把 rAF / 定时器降频
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-background-mode',
      // 背景音乐自动播放（否则玩家第一次进游戏要先点一下页面）
      '--autoplay-policy=no-user-gesture-required',
      // 干净的游戏窗口：不要首次运行向导、不要默认浏览器检查、不要翻译条
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-features=Translate,MediaRouter',
    ],
    // detached：Ctrl+C 停启动器时不要把玩家的窗口一起带走（停止走 stop()，那里会单独收尾）
    { detached: true, stdio: 'ignore' },
  );

  const exited = new Promise<number>((resolve) => {
    child.once('exit', () => resolve(Date.now() - startedAt));
    child.once('error', () => resolve(0));
  });

  return {
    label: browser.label,
    exited,
    kill: () => {
      try {
        child.kill();
      } catch {
        /* 已经退了就算了 */
      }
    },
  };
}

/** 退回系统默认浏览器（找不到 Edge/Chrome，或玩家加了 --no-app-window） */
function openBrowser(url: string): void {
  try {
    if (process.platform === 'win32') {
      spawn('rundll32', ['url.dll,FileProtocolHandler', url], { detached: true, stdio: 'ignore' }).unref();
    } else if (process.platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
    }
  } catch {
    console.log(`${C.yellow}（没能自动打开浏览器，手动把上面的地址粘进去就行）${C.reset}`);
  }
}

interface RunRecord {
  pid: number;
  webPort: number;
  gamePort: number;
  url: string;
  at: number;
}

function readRunFile(): RunRecord | null {
  try {
    if (!existsSync(RUN_FILE)) return null;
    const raw = JSON.parse(readFileSync(RUN_FILE, 'utf8')) as Partial<RunRecord>;
    if (typeof raw.pid !== 'number' || typeof raw.webPort !== 'number') return null;
    return {
      pid: raw.pid,
      webPort: raw.webPort,
      gamePort: Number(raw.gamePort ?? 0),
      url: String(raw.url ?? ''),
      at: Number(raw.at ?? 0),
    };
  } catch {
    return null;
  }
}

function writeRunFile(record: RunRecord): void {
  try {
    writeFileSync(RUN_FILE, JSON.stringify(record), 'utf8');
  } catch {
    /* 落盘失败不影响运行 */
  }
}

/**
 * 删掉运行标记。
 *
 * @param onlyPid 只删"这个 pid 写的"那份。
 *   ★ 为什么需要这个参数？`--force` 可以同时开两份，这时候标记只描述**最后启动**的那份。
 *     如果先启动的那份退出时无脑删，就会把还在跑的那份的标记也删掉 ——
 *     之后双击「关闭游戏.vbs」会说"现在没有正在运行的游戏"，而它明明在跑。
 */
function clearRunFile(onlyPid?: number): void {
  try {
    if (!existsSync(RUN_FILE)) return;
    if (onlyPid !== undefined) {
      const current = readRunFile();
      if (current && current.pid !== onlyPid) return;
    }
    rmSync(RUN_FILE, { force: true });
  } catch {
    /* ignore */
  }
}

/** 进程还活着吗（EPERM = 活着但不许我发信号，也算活着） */
function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * 专属档案是不是还被那个浏览器进程占着 —— 也就是「窗口很可能还开着」。
 *
 * 【为什么要判断这件事？】
 * 双击第二次时如果无脑再开一扇 `--app` 窗口，两扇窗**同源同档案**：
 * 后开的那扇会认领本机会话，把先开的那扇踢回主界面（`本机另一个标签页接管了这一局`）。
 * 玩家正打到一半、手滑双击了一下启动器 = 对局没了 —— 这个绝对不能发生。
 *
 * 判断依据是 Chromium 在档案目录里留下的 `SingletonLock`（内容是 `主机名-pid`）：
 *   · 有锁 + 进程还活着 ⇒ 认定窗口开着，只提示、不再开第二扇；
 *   · 没锁 / 进程已死（被任务管理器杀了会留假锁）⇒ 当成"窗口没了"，正常开一扇新的。
 */
function windowProfileInUse(): boolean {
  for (const name of ['SingletonLock', 'lockfile']) {
    const path = join(WINDOW_PROFILE, name);
    if (!existsSync(path)) continue;
    try {
      const raw = readFileSync(path, 'utf8').trim();
      const pid = Number(raw.split('-').pop());
      if (Number.isFinite(pid) && pid > 0) return pidAlive(pid);
    } catch {
      /* 读不到内容（有的版本是符号链接）—— 有锁就当占用，宁可少开一扇 */
    }
    return true;
  }
  return false;
}


// ============================================================
//  第 -1 步：已经开着一份了吗？
// ============================================================
/**
 * 如果本机已经有一份在跑，就把浏览器叫回来并返回 true。
 *
 * 以前靠"端口被占用"来发现这件事。现在端口会自动顺延，
 * 所以改成读运行标记：进程还活着 + 网页端口真的在听 ⇒ 认定是同一份。
 *
 * ★ 两个条件缺一不可。只看标记：进程被任务管理器杀了会留下假标记；
 *   只看端口：可能撞上别的程序正好占着那个号。
 * ★ 这种情况**不再起第二份** —— 双击两次的人想要的本来就是
 *   "给我打开游戏"，不是"再开一份"。
 * ★★ 必须排在"接管日志"**之前**跑：隐藏模式下接管日志会**清空**日志文件，
 *   而第二份实例不该把第一份正在用的日志擦了。
 */
async function tryAttachToRunningInstance(): Promise<boolean> {
  if (argv.includes('--force')) return false;
  const prev = readRunFile();
  if (prev && pidAlive(prev.pid) && (await portListening(prev.webPort))) {
    /*
      ★★ 0.3.3：这里**不再无脑再开一扇窗**。
      窗口还开着的时候再开一扇，两扇同源窗口会抢"本机唯一玩家"的会话，
      后开的那扇会把正在打的那一局踢回主界面（详见 `windowProfileInUse` 的注释）。
      所以：锁在 = 窗口大概开着，只提示；锁没了 = 窗口确实不在，补开一扇（不退出后台）。
    */
    if (prev.url && !windowProfileInUse()) {
      const reopened = openAppWindow(prev.url);
      if (reopened) {
        console.log(`${C.green}游戏已经开着${C.reset}（端口 ${prev.webPort}），已经重新打开窗口。`);
      } else {
        openBrowser(prev.url);
        console.log(`${C.green}游戏已经开着${C.reset}（端口 ${prev.webPort}），已经把页面叫回来了。`);
      }
    } else {
      console.log(`${C.green}游戏已经开着${C.reset}（端口 ${prev.webPort}），窗口应该还在任务栏里。`);
      console.log(
        `${C.dim}如果真的找不到窗口：双击「关闭游戏.vbs」把后台停掉，再重新启动一次。${C.reset}`,
      );
    }
    console.log(`${C.dim}想强制再开一份就加 --force（不推荐，两份会抢同一个后台）。${C.reset}`);
    return true;
  }
  // 标记过期（进程没了 / 端口没在听）⇒ 清掉，当没开过
  if (prev) clearRunFile();
  return false;
}

if (await tryAttachToRunningInstance()) {
  process.exit(0);
}

// ============================================================
//  隐藏模式：先把输出接过来，再干任何事
// ============================================================
/*
  ★ 为什么放在这里（函数都定义完之后）？
    因为 `logTarget` 是 `let` —— 在它自己那行执行之前是"暂时性死区"，
    在更早的地方调用 `redirectOutputToFile` 会直接 ReferenceError。
    而所有真正的输出都发生在 `main()` 里面，放这儿一样能全接住。
  ★ 顺序：必须在**任何** console 调用之前。
    之后启动失败的报错也会落进「游戏日志.txt」，.vbs 弹窗让玩家打开的就是它。
*/
if (HIDDEN) {
  redirectOutputToFile(LOG_FILE);
  console.log(`失序协议 启动日志   ${new Date().toLocaleString('zh-CN')}`);
  console.log('');
}

async function main(): Promise<void> {

  // ==========================================================
  // 第 0 步：前置检查 —— 依赖装了没有
  // ==========================================================
  if (
    !existsSync(join(repoRoot, 'node_modules', 'vite')) ||
    !existsSync(join(repoRoot, 'node_modules', 'tsx'))
  ) {
    throw new FriendlyError(
      '还没装依赖（找不到 node_modules）。\n' +
        '  先在项目文件夹里执行一次：\n' +
        `      ${C.cyan}node scripts\\pnpm.mjs install${C.reset}`,
    );
  }

  // ==========================================================
  // 第 1 步：打包网页
  // ==========================================================
  if (!SKIP_BUILD) {
    console.log(`${C.dim}正在打包网页（几秒钟）…${C.reset}`);
    /*
      ★ stdio 用 'inherit' 而不是 pipe：vite 的输出直接写到当前控制台，
        我们那层 console 接管不到它（所以它不会进「游戏日志.txt」）。
        这是有意的 —— 便携包里这一步**已经被整段去掉**，
        只有开发仓库里才会 build，而开发仓库里跑隐藏模式没有意义。
    */
    const viteEntry = join(repoRoot, 'node_modules', 'vite', 'bin', 'vite.js');
    const built = spawnSync(
      process.execPath,
      [viteEntry, 'build', '--config', join(repoRoot, 'apps', 'web', 'vite.config.ts')],
      { cwd: repoRoot, stdio: 'inherit' },
    );
    if (built.status !== 0) {
      throw new FriendlyError(
        '打包失败 —— 上面那几行就是原因（通常是代码有语法错误）。\n' +
          '  修好之后重新双击启动即可。',
      );
    }
  }

  const distIndex = join(repoRoot, 'apps', 'web', 'dist', 'index.html');
  if (!existsSync(distIndex)) {
    // 路径写进提示里：开发仓库和便携包（web/index.html）的产物位置不一样
    throw new FriendlyError(`找不到打包产物 ${distIndex}。`);
  }

  // ==========================================================
  // 第 2 步：起游戏服务器（默认 8787，被占自动顺延）
  // ==========================================================
  process.env.AIRNIGHT_NO_AUTOSTART = '1';
  const { startServer } = await import('../packages/server/src/main.js');
  const { createCombinedServer } = await import('./serve-static.mjs');

  /*
    ★ 退出令牌：「退出游戏」按钮要用它。
    随机生成，只写进**本机那条地址**；服务端收到退出请求时还会再查一次
    "是不是从本机发来的" —— 两道一起卡，所以
      · 局域网里的朋友（页面也开着）点不到；
      · 你随便逛的某个网页偷偷 POST（CSRF）也关不掉。
  */
  const quitToken = randomBytes(8).toString('hex');
  /** 真正的退出函数：下面"优雅退出"那一段才会填上（网页按钮通过它回调） */
  let stop: () => void = () => {};

  const gameOpen = await openOnFirstFreePort(GAME_PORT, '游戏服务器', async (port) => {
    const server = startServer(port, '0.0.0.0');
    const failed = await new Promise<Error | null>((resolve) => {
      server.wss.once('listening', () => resolve(null));
      server.wss.once('error', (error: Error) => resolve(error));
    });
    if (!failed) return { ok: true, value: server, port };
    // 起不来就收拾干净：失败后 wss 还会再抛一次，先挂个空处理器免得变成未捕获异常
    server.wss.on('error', () => {});
    try {
      server.close();
    } catch {
      /* 没起来，关失败无所谓 */
    }
    return { ok: false, code: (failed as NodeJS.ErrnoException).code, error: failed };
  });
  const game = gameOpen.value;
  const gamePort = gameOpen.port;

  // ==========================================================
  // 第 3 步：起一体化网页服务器（网页 + WebSocket 转发）
  // ==========================================================
  const webOpen = await openOnFirstFreePort(WEB_PORT, '网页服务器', async (port) => {
    const server = createCombinedServer({ gamePort, quitToken, onQuit: () => stop() });
    const failed = await new Promise<Error | null>((resolve) => {
      server.once('error', (error: Error) => resolve(error));
      server.listen(port, '0.0.0.0', () => resolve(null));
    });
    if (!failed) return { ok: true, value: server, port };
    try {
      server.close();
    } catch {
      /* ignore */
    }
    return { ok: false, code: (failed as NodeJS.ErrnoException).code, error: failed };
  });
  const web = webOpen.value;
  const webPort = webOpen.port;
  /** 网页和联机是同一个端口 —— 客户端拿这个地址既发页面也连 WebSocket */
  const webHost = `localhost:${webPort}`;

  // ==========================================================
  // 地址
  // ==========================================================
  /*
    ★ 为什么本机链接也要带 `?server=`？

    客户端找服务器的顺序是：网址参数 -> localStorage 里存过的 -> 同主机的 8787。
    你之前用樱花联机时如果手动填过隧道地址，它会**存在浏览器里**，
    于是这次打开 `localhost:5173` 会去连那个早就关掉的隧道，
    表现为"一直重连"，而且看起来像服务器没开 —— 极难排查。
    带上 `?server=` 就让参数永远优先，把这段历史彻底绕开。

    ★ `?quit=` 只给本机这条：带令牌的页面才会显示「退出游戏」按钮。
  */
  const localUrl = `http://localhost:${webPort}/?server=${webHost}&quit=${quitToken}`;
  const lan = lanAddresses();

  console.log('');
  console.log(`${C.bold}${C.green}════════════════════════════════════════════════════════${C.reset}`);
  console.log(`${C.bold}${C.green}  失序协议 已经启动，可以玩了${C.reset}`);
  console.log(`${C.bold}${C.green}════════════════════════════════════════════════════════${C.reset}`);
  console.log('');
  console.log(`  ${C.bold}自己玩${C.reset}（浏览器会自动打开这个地址）：`);
  console.log(`      ${C.cyan}http://localhost:${webPort}/${C.reset}`);
  console.log('');
  if (webOpen.shifted > 0 || gameOpen.shifted > 0) {
    console.log(`  ${C.yellow}注意：默认端口被占用了，这次实际用的是 ${webPort} / ${gamePort}${C.reset}`);
    console.log(`  ${C.dim}（上面的地址已经是真实端口；穿透隧道要指着 ${webPort}）${C.reset}`);
    console.log('');
  }

  /*
    ★ 0.1.1：同一 WiFi 的提示改成"报房间号"。
    【为什么改？】0.0.3 末起联机已经能**局域网自动发现**了（服务器互相广播 UDP，
    客户端拿房间号去问"该连哪台机器"），所以同一个 WiFi 下朋友只要
    自己双击他那份「启动游戏.cmd」、点「加入房间」、填房间号就能进 ——
    不用再复制那条又长又容易漏尾巴的链接。
    链接只在"朋友没装游戏 / 不在同一个网络"时才需要（那种情况下面单独说了）。
  */
  if (lan.length > 0) {
    console.log(`  ${C.bold}同一个 WiFi 的朋友${C.reset}（让他自己双击他那份「启动游戏.cmd」，`);
    console.log(`  ${C.bold}                  然后「加入房间」填你报给他的 6 位房间号就行）：`);
    for (const address of lan) {
      console.log(`      ${C.dim}（他如果没装游戏，才需要发这条链接给他）${C.reset}`);
      console.log(`      ${C.cyan}http://${address}:${webPort}/?server=${address}:${webPort}${C.reset}`);
    }
    console.log('');
  } else {
    console.log(`  ${C.yellow}没检测到局域网 IP（可能没连 WiFi），同一 WiFi 的朋友可能找不到房间。${C.reset}`);
    console.log('');
  }

  console.log(`  ${C.bold}不在同一个网络的朋友${C.reset}（樱花联机）：`);
  console.log(`      1. 穿透隧道指向${C.bold}本机端口 ${webPort}${C.reset}（不是 ${gamePort}！两条路已经合并了）`);
  console.log('      2. 打开「自动 HTTPS」，并绑一个免费子域');
  console.log(`      3. 发给他的链接： ${C.cyan}https://你的隧道地址/?server=你的隧道地址${C.reset}`);
  console.log(`      ${C.dim}（隧道怎么配看 docs/需求清单.md 第 37 节）${C.reset}`);
  console.log('');

  console.log(`  ${C.dim}两个端口的分工：`);
  console.log(`    ${webPort}  网页 + 联机（穿透只需要这一条）`);
  console.log(`    ${gamePort}  游戏服务器（只在本机，网页会自动把联机转发过去）${C.reset}`);
  console.log('');
  /*
    ★ 0.3.3：现在有三条退出路，按"最自然"的顺序写：
    ★ 关掉游戏窗口（以前关标签页不算退出，现在算了）、页面里的「退出游戏」、关闭游戏.vbs。
    （隐藏模式没有窗口，Ctrl+C 那半句也得去掉 —— 说了也做不到。）
  */
  console.log(
    `  ${C.bold}停止${C.reset}：${C.bold}直接关掉游戏窗口${C.reset}就停了；` +
      `也可以点网页主界面工具条上的「${C.bold}退出游戏${C.reset}」` +
      (HIDDEN ? '，或者双击包里的「关闭游戏.vbs」' : '，或者在这个窗口按 Ctrl+C'),
  );
  console.log(`${C.dim}  （以前的版本关掉页面不算退出、后台还在跑；0.3.3 起关窗口 = 关后台）${C.reset}`);
  console.log('');

  /*
    记下"这一份在跑"：双击第二次时靠它判定"已经开着"，直接把浏览器叫回来，
    而不是再起一份（端口会自动顺延，所以不能再靠端口冲突来判断）。
  */
  writeRunFile({ pid: process.pid, webPort, gamePort, url: localUrl, at: Date.now() });

  // ==========================================================
  // 打开游戏窗口（★ 0.3.3：优先"应用窗口"，找不到 Chromium 才退回默认浏览器）
  // ==========================================================
  const appWindow = NO_OPEN ? null : openAppWindow(localUrl);
  if (!NO_OPEN) {
    if (appWindow) {
      console.log(`  已用 ${C.bold}${appWindow.label}${C.reset} 的应用窗口打开（没有地址栏，关掉窗口就停止）。`);
    } else if (process.platform === 'win32' && !argv.includes('--no-app-window')) {
      console.log(
        `${C.yellow}  没找到 Edge / Chrome，改用系统默认浏览器打开${C.reset}` +
          `${C.dim}（会有地址栏；关掉标签页不会停止后台，请用「退出游戏」）${C.reset}`,
      );
      openBrowser(localUrl);
    } else {
      openBrowser(localUrl);
    }
  }

  /*
    ★★ 0.3.3「关窗口 = 关游戏」。
    `--app` 窗口是我们自己起的浏览器进程（专属档案 ⇒ 关掉最后一扇窗，进程就退）。
    它一退，这里就把后台也停掉 —— 不再需要玩家去找「关闭游戏.vbs」。
    ★ 少于 1.5 秒就退了 = 大概是把命令行交给了**已经在跑的那份浏览器**
      （或者起来就崩），不能当成"玩家关了窗口"，否则会误杀后台。
  */
  void appWindow?.exited.then((lived) => {
    if (lived < 1500) return;
    console.log(`\n${C.dim}窗口已关闭，正在停止后台…${C.reset}`);
    stop();
  });

  // ==========================================================
  // 优雅退出
  // ==========================================================
  /*
    ★ 这里是**赋值**给上面那个 `let stop`，不是再声明一个同名的 const。
      （网页「退出游戏」按钮就是通过 `onQuit: () => stop()` 回调进来的 ——
      服务端起在第 3 步，那时候这个函数还没定义，所以只能先占个空壳。）
  */
  let stopping = false;
  stop = (): void => {
    if (stopping) return;
    stopping = true;
    console.log('');
    console.log(`${C.dim}正在停止…${C.reset}`);
    /*
      ★ 先删运行标记再关服务：
        否则「关闭游戏.vbs」/ 双击第二次有可能读到一份"进程还在、端口却在关"的标记。
    */
    clearRunFile(process.pid);
    for (const server of [web, game]) {
      try {
        server.close();
      } catch {
        /* 已经关了就算了 */
      }
    }
    /*
      ★ 0.3.3：把游戏窗口也收掉。
      不然点了「退出游戏」之后，那扇窗还开着、页面连不上后台，
      玩家看到的是一个"卡住的游戏" —— 比没有窗口更糟。
      （窗口被我们杀掉会触发它自己的 exit 回调，那时 `stopping` 已经是 true，
        不会再进来一次。）
    */
    appWindow?.kill();
    console.log(`${C.green}已停止。${C.reset}`);
    // 日志是同步写的（见 redirectOutputToFile），所以这里直接退不会丢东西
    process.exit(0);
  };

  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  /* 窗口被直接关掉 / 任务管理器结束任务时也尽量留下干净的现场 */
  process.on('exit', () => clearRunFile(process.pid));
}

await main().catch(async (error: unknown) => {
  console.error('');
  if (error instanceof FriendlyError) {
    console.error(`${C.red}✗ ${error.message}${C.reset}`);
  } else {
    console.error(`${C.red}✗ 启动时出了点问题，把下面这段截图发给我：${C.reset}`);
    console.error('');
    console.error(error);
  }
  await waitForEnter();
  process.exit(1);
});
