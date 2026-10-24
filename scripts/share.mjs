#!/usr/bin/env node
/**
 * 「怎么让朋友进来玩」助手。
 *
 * 用法：
 *   node scripts/pnpm.mjs share
 *   node scripts/pnpm.mjs share --server=frp.example.com:23456
 *
 * ============================================================
 *  它到底在解决什么问题？
 * ============================================================
 * 这个游戏是**网页游戏**，朋友不需要下载任何东西 —— 他们只要打开一个网址。
 * 但"网址是什么"取决于你们的网络情况，而且**失败原因基本只有两个**：
 *   1. 服务没在跑（终端关了 / 崩了）
 *   2. Windows 防火墙把端口拦了
 * 这两件事都不报错、只是"朋友打不开"，所以这个脚本把能自动查的都查了，
 * 剩下的（防火墙）直接把命令抄给你。
 *
 * 【为什么不用把局域网 IP 写死在文档里？】
 * 因为 IP 是路由器每次分配的，换一次网络就变。写死的文档第二天就失效了，
 * 而且失效的样子是"朋友打不开"，你会先去怀疑游戏坏了。
 */
import { connect } from 'node:net';
import { networkInterfaces } from 'node:os';

/** 网页（Vite 开发服务器 / 静态服务器）的端口 */
const WEB_PORT = Number(process.env.WEB_PORT ?? 5173);
/** 游戏服务器（WebSocket）的端口 */
const GAME_PORT = Number(process.env.GAME_PORT ?? 8787);

const args = process.argv.slice(2);
const serverArg = args.find((item) => item.startsWith('--server='))?.slice('--server='.length);
const webArg = args.find((item) => item.startsWith('--web='))?.slice('--web='.length);

/**
 * 找出本机的局域网 IPv4 地址。
 *
 * 【为什么要过滤？】
 * 一台机器上通常有好几个网卡：回环（127.0.0.1）、虚拟机网卡（169.254 那种自动私有地址）、
 * VPN 网卡……随手取第一个很可能拿到一个朋友根本连不上的地址，
 * 而且你会以为是"游戏的问题"。所以这里把明显不能用的排掉。
 */
function lanAddresses() {
  const out = [];
  for (const [name, list] of Object.entries(networkInterfaces())) {
    for (const info of list ?? []) {
      if (info.family !== 'IPv4' || info.internal) continue;
      if (info.address.startsWith('169.254.')) continue; // 自动私有地址：网卡没拿到 IP 时的兜底
      out.push({ name, address: info.address });
    }
  }
  return out;
}

/**
 * 试着连一下某个端口，看有没有人在听。
 *
 * 【为什么要"真的连一下"，而不是查一行文本？】
 * 因为 `netstat` 的输出格式在不同 Windows 版本上不一样，解析它很容易出错；
 * 而且"端口在监听"和"服务真的活着"是两件事（进程卡死时端口照样listen）。
 * 直接握手一次最接近"朋友能不能连上"这个真实问题。
 */
function canConnect(port, host = '127.0.0.1', timeoutMs = 700) {
  return new Promise((resolve) => {
    const socket = connect({ port, host });
    const done = (ok) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

const webUp = await canConnect(WEB_PORT);
const gameUp = await canConnect(GAME_PORT);

const addresses = lanAddresses();
const primary = addresses.find((item) => !/vmware|virtualbox|hyper-v|loopback/i.test(item.name)) ?? addresses[0];

function line(text = '') {
  console.log(text);
}
function ok(text) {
  console.log(`  ✅ ${text}`);
}
function bad(text) {
  console.log(`  ❌ ${text}`);
}

line('');
line('════════════════════════════════════════════════════════');
line('  让朋友进来玩');
line('════════════════════════════════════════════════════════');
line('');
line('先记住一件事：**这是网页游戏，朋友不用下载任何东西** ——');
line('他们只要有浏览器 + 你发的那个网址。你要做的是"让那个网址能打开"。');
line('');

line('--- 本机的服务状态 ---');
if (webUp) ok(`网页服务在跑（端口 ${WEB_PORT}）`);
else bad(`网页服务没在跑 —— 另开一个终端运行： node scripts/pnpm.mjs web`);
if (gameUp) ok(`游戏服务器在跑（端口 ${GAME_PORT}）`);
else bad(`游戏服务器没在跑 —— 另开一个终端运行： node scripts/pnpm.mjs server`);
line('');

if (addresses.length === 0) {
  bad('没找到局域网地址 —— 你可能没连 WiFi / 网线。');
} else {
  line('--- 本机地址 ---');
  for (const item of addresses) line(`  ${item.address}   (网卡：${item.name})`);
  line('');
}

// ============================================================
// 情况一：同一个 WiFi（最简单，零配置）
// ============================================================
line('【情况一】朋友们和你连**同一个 WiFi**（最简单，什么都不用配）');
line('');
if (primary && webUp) {
  const lanUrl = `http://${primary.address}:${WEB_PORT}${serverArg ? `/?server=${serverArg}` : ''}`;
  line('  把下面这条发给朋友，他们用浏览器打开就行：');
  line('');
  line(`      ${lanUrl}`);
} else if (!primary) {
  line('  （先连上 WiFi 再看这里）');
} else {
  line(`  先把上面显示"没在跑"的服务启动起来，然后重新运行本命令。`);
}
line('');
line('  · 手机也能玩：把同一条链接发到群里，手机浏览器打开即可');
line('  · 你的电脑要保持开着、终端窗口不能关');
line('');

// ============================================================
// 情况二：不同网络（需要内网穿透）
// ============================================================
line('【情况二】朋友和你**不在同一个网络**（需要内网穿透，比如 SakuraFRP）');
line('');
line(`  ★ 推荐做法：用「一体化服务器」把网页和联机合到**一个端口**，只建**一条隧道**。`);
line('');
line(`      node scripts/pnpm.mjs build     # 打包网页`);
line(`      node scripts/pnpm.mjs static    # 一个端口同时发网页 + 转发 WebSocket 到 ${GAME_PORT}`);
line(`      node scripts/pnpm.mjs server    # 另一个终端：游戏服务器`);
line('');
line(`    然后建**一条隧道**（TCP 或 HTTPS 都行），本地端口填 **${WEB_PORT}**（不是 ${GAME_PORT}！）。`);
line('');
if (serverArg) {
  line(`  你给的隧道地址： ${serverArg}`);
  line('');
  line('  发给朋友的链接 = 网页地址 + ?server=同一个地址：');
  line('');
  line(`      https://${serverArg}/?server=${serverArg}`);
  line('');
  line('  （如果你的隧道只支持 HTTP，就把 https 换成 http；');
  line('    但 SakuraFRP 现在对 HTTP 访问会拦（501），所以基本都得用 https。）');
} else {
  line('  建好隧道后重新运行本命令，把地址带上，它会帮你把链接拼好：');
  line('');
  line('      node scripts/pnpm.mjs share --server=你的隧道地址');
}
line('');
line('  ⚠️ **隧道本地端口要填 ' + WEB_PORT + '，不是 ' + GAME_PORT + '**。');
line(`     填 ${GAME_PORT} 的话：朋友能连上游戏、但打不开网页（那个端口上只有 WebSocket，没有网页）。`);
line('');
line('  ⚠️ **一个很容易踩的坑**：免费托管（Cloudflare Pages / Vercel）和 SakuraFRP 的');
line('     HTTPS 隧道都是 **HTTPS**，而浏览器**禁止 HTTPS 网页连 ws://**（混合内容，直接拦掉）。');
line('     一体化方案没有这个问题 —— 网页和服务器是同一个地址，客户端会自动用 wss://。');
line('     但如果你还是分开两条隧道，就只能是这两种组合：');
line('       网页 HTTP  + ws://              ✅');
line('       网页 HTTPS + wss://（隧道支持 TLS） ✅');
line('       网页 HTTPS + ws://             ❌ 一定连不上');
line('');

// ============================================================
// 情况三：把网页发布出去（朋友不用你在场也能打开）
// ============================================================
line('【发布】把网页打包成静态文件（丢到任何免费托管，或者用一体化服务器）');
line('');
line('      node scripts/pnpm.mjs build      打包 -> 产出 apps/web/dist/');
line(`      node scripts/pnpm.mjs static     一个端口同时发网页 + 转发联机（推荐）`);
line('');
line('  apps/web/dist/ 整个文件夹可以上传到 Cloudflare Pages / Vercel / GitHub Pages，');
line('  路径用的是相对地址，放根目录或子目录都能用。');
line('');
line('  ⚠️ 注意：如果网页放**免费托管**（HTTPS）而服务器还是分开的隧道，');
line('     那就必须用支持 TLS 的隧道、地址写 wss:// —— 这正是"一体化"要解决的问题。');
line('');

// ============================================================
// 打不开怎么办
// ============================================================
line('--- 朋友打不开？按顺序排查这三条 ---');
line('');
line('  1) **八成是防火墙或端口填错**。先说端口：');
line(`     用一体化服务器时，**隧道本地端口要填 ${WEB_PORT}**（网页+联机都在这个端口上）。`);
line(`     填成 ${GAME_PORT} 的话朋友能连上游戏、却打不开网页。`);
line('     再说防火墙：它默认拦"从外面连进来"的端口，而且拦了**不报错**。');
line('     用**管理员身份**打开 PowerShell，粘这两行（只需做一次）：');
line('');
line(`        netsh advfirewall firewall add rule name="AIRNIGHT-网页" dir=in action=allow protocol=TCP localport=${WEB_PORT}`);
line(`        netsh advfirewall firewall add rule name="AIRNIGHT-游戏服" dir=in action=allow protocol=TCP localport=${GAME_PORT}`);
line('');
line('  2) **确认真的在同一个 WiFi**。手机连的是流量、或者连的是"访客网络"，');
line('     都会连不上（很多路由器把访客网络和主网络隔开）。');
line('');
line('  3) **服务是不是被你关了**。这个终端一关，所有人的联机都会断。');
line('     重跑本命令看两个 ✅ 还在不在。');
line('');
line('  自己先在自己浏览器里打开一次那个链接 —— 你能打开、朋友打不开，');
line('  就基本可以确定是防火墙或网络隔离，而不是游戏的问题。');
line('');
