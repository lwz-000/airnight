#!/usr/bin/env node
/**
 * ============================================================
 *  内网穿透体检 —— 「朋友连不上」的时候先跑这个
 * ============================================================
 *
 * 【为什么需要它？】
 * 「朋友打不开」这句话里藏着至少 7 种完全不同的原因，症状却长得一模一样。
 * 靠猜会一轮一轮白折腾。这个脚本把「朋友的浏览器要走的那条路」从头走一遍，
 * 每一步都打印出来，最后给一句人话结论。
 *
 * ============================================================
 *  ★ 核心手法：同一个 IP:端口，只换 Host 头 / SNI，跑一组对照
 * ============================================================
 *
 *      Host: 你的域名          -> ?
 *      Host: 纯 IP             -> ?   （隧道到底在不在这个端口上）
 *      Host: www.baidu.com     -> ?   （已备案域名的对照组）
 *
 * 三条一对比，就能把责任分到具体的某一环上：
 *
 *   · 纯IP 通了、域名被拦、baidu 通  -> **节点机房有"域名白名单"过滤器**，
 *                                        你的配置没问题，是域名过不去
 *   · 三条都通                       -> 隧道是好的，直接给朋友的链接
 *   · 纯IP 回 501                    -> 自动 HTTPS 开着（正常，用 https 访问）
 *   · 纯IP 也连不上                  -> 隧道没开 / 端口抄错 / 本地服务没起
 *
 * 只看一条结果的话，你根本分不清"隧道没开"和"域名被拦" —— 会白白重开隧道。
 *
 * 用法：
 *   node scripts/check-tunnel.mjs frp-top.com:64512
 *   node scripts/pnpm.mjs tunnel -- 你的子域.nyat.app:64512
 *
 * 它只做**读取**：解析域名、连 TCP、发几个 GET、握几次 TLS。
 * 不会动你的隧道，也不会改任何配置。
 */
import { lookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { connect as netConnect } from 'node:net';
import { networkInterfaces } from 'node:os';
import { connect as tlsConnect } from 'node:tls';

const C = {
  reset: '\u001b[0m',
  dim: '\u001b[2m',
  green: '\u001b[32m',
  cyan: '\u001b[36m',
  yellow: '\u001b[33m',
  red: '\u001b[31m',
  bold: '\u001b[1m',
};

const target = process.argv.slice(2).find((item) => !item.startsWith('--'));
if (!target) {
  console.error('用法：node scripts/check-tunnel.mjs <域名或IP>:<端口>');
  console.error('例如：node scripts/check-tunnel.mjs 你的子域.nyat.app:64512');
  process.exit(2);
}

const [host, portText] = target.split(':');
const port = Number(portText);
if (!host || !Number.isInteger(port) || port <= 0 || port > 65535) {
  console.error(`看不懂这个地址：${target}   （应该是 域名:端口）`);
  process.exit(2);
}

function step(title) {
  console.log(`\n${C.bold}${title}${C.reset}`);
}
function ok(text) {
  console.log(`  ${C.green}✓${C.reset} ${text}`);
}
function bad(text) {
  console.log(`  ${C.red}✗${C.reset} ${text}`);
}
function info(label, value) {
  console.log(`  ${C.dim}${label.padEnd(22)}${C.reset}${value}`);
}

function lanAddresses() {
  const out = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const item of list ?? []) {
      if (item.family !== 'IPv4' || item.internal) continue;
      if (item.address.startsWith('169.254.')) continue;
      out.push(item.address);
    }
  }
  return out;
}

/**
 * 用**裸 socket** 发一个 HTTP 请求，拿回原始字节。
 *
 * 【为什么不用 node:http？】
 * 因为拦截页和设备回包经常**不符合 HTTP 规范** —— 比如状态行用 `\n` 而不是 `\r\n`。
 * 这时候 node:http 会直接抛 `HPE_CR_EXPECTED`，把正文全丢了，
 * 而正文里恰好写着"是谁拦的、为什么拦"。所以这里必须看原始字节。
 *
 * 【又一个坑：别用 latin1 去匹配中文】
 * 第一版我存的是 `chunk.toString('latin1')`，然后去匹配 `自动 HTTPS`、`备案` 这些中文。
 * latin1 是一字节一字符，UTF-8 的中文会被拆成一堆乱码字符，
 * 于是**一个都匹配不上**，所有响应都被归成"未知" —— 工具自己把结论弄丢了。
 * 现在保留 Buffer，按 UTF-8 解码给文本匹配用，二进制判断则看首字节。
 */
function rawGet(connectHost, hostHeader, timeout = 8000) {
  return new Promise((resolve) => {
    const socket = netConnect({ host: connectHost, port });
    const chunks = [];
    let settled = false;
    const finish = (note) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      const buffer = Buffer.concat(chunks);
      resolve({ buffer, text: buffer.toString('utf8'), note });
    };
    socket.once('connect', () => {
      socket.write(
        `GET / HTTP/1.1\r\nHost: ${hostHeader}\r\nUser-Agent: check-tunnel\r\nConnection: close\r\n\r\n`,
      );
    });
    socket.on('data', (chunk) => chunks.push(chunk));
    socket.once('close', () => finish('对端关闭'));
    socket.once('error', (error) => finish(`${error.code ?? ''} ${error.message}`.trim()));
    setTimeout(() => finish('超时'), timeout);
  });
}

/** 把一段原始响应翻译成"谁在回话" */
function classifyRaw(response) {
  if (!response || response.buffer.length === 0) return { kind: 'empty', label: '一个字节都没回' };
  const { text, buffer } = response;

  // TLS 记录：0x15 = Alert，0x16 = Handshake，0x17 = 应用数据。
  // 看到这个说明"对面在说 TLS，而我们在说 HTTP"。
  if (buffer[0] === 0x15 || buffer[0] === 0x16 || buffer[0] === 0x17) {
    return { kind: 'binary', label: `TLS 记录（0x${buffer[0].toString(16)}）= 这个端口在做 TLS` };
  }
  if (/自动 ?HTTPS/.test(text) || /Not Implemented/.test(text)) {
    return { kind: 'frp', label: 'frp 本体：隧道在这里（501，它要求用 HTTPS）' };
  }
  if (/过白/.test(text)) return { kind: 'blocked', label: '机房「域名过白」拦截页' };
  if (/备案|无法进行访问/.test(text)) return { kind: 'blocked', label: '机房「未备案」拦截页（403）' };
  if (/AIRNIGHT/.test(text)) return { kind: 'game', label: '★ 我们的游戏页面' };
  if (/^HTTP/.test(text)) {
    return { kind: 'http', label: `HTTP 响应（${text.split(/\r?\n/)[0].trim()}）` };
  }
  return { kind: 'binary', label: '非 HTTP 数据' };
}

/** 把 OpenSSL 那一长串错误裁成第一段（`ERR_XXX F003...:error:...` -> `ERR_XXX`） */
function shortError(text) {
  return String(text ?? '').split(' ')[0].slice(0, 46);
}

/** 是不是纯 IP 字面量（给 IP 设 SNI 不合法，Node 会警告，所以要跳过） */
function isIpLiteral(value) {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(String(value ?? ''));
}

function tlsTry(servername, connectHost = host) {
  return new Promise((resolve) => {
    const socket = tlsConnect(
      {
        host: connectHost,
        port,
        servername: isIpLiteral(servername) ? undefined : servername,
        rejectUnauthorized: false,
        timeout: 7000,
      },
      () => {
        const cert = socket.getPeerCertificate();
        const result = {
          ok: true,
          authorized: socket.authorized,
          error: socket.authorizationError,
          cn: cert.subject?.CN,
          issuer: cert.issuer?.CN ?? cert.issuer?.O,
          san: cert.subjectaltname,
        };
        socket.destroy();
        resolve(result);
      },
    );
    socket.once('error', (error) =>
      resolve({ ok: false, error: `${error.code ?? ''} ${error.message}`.trim() }),
    );
  });
}

console.log(`\n${C.bold}=== 内网穿透体检：${target} ===${C.reset}`);
console.log(`${C.dim}只读检查，不会改你的隧道配置${C.reset}`);

// ============================================================
step('① 本机 5173 在不在（隧道要转发到这里）');
// ============================================================
const localOk = await new Promise((resolve) => {
  const req = httpRequest({ host: '127.0.0.1', port: 5173, path: '/', method: 'GET', timeout: 4000 }, (res) => {
    let body = '';
    res.on('data', (c) => (body += c));
    res.on('end', () => resolve(res.statusCode === 200 ? body.length : false));
  });
  req.on('timeout', () => {
    req.destroy();
    resolve(false);
  });
  req.on('error', () => resolve(false));
  req.end();
});
if (localOk) ok(`正常，网页 ${localOk} 字节`);
else {
  bad('本机 5173 打不开');
  info('要先做的事', '双击「启动游戏.cmd」，或 node scripts/pnpm.mjs static');
}

// ============================================================
step('② 域名解析');
// ============================================================
let resolved = [];
try {
  resolved = await lookup(host, { all: true });
  for (const item of resolved) info('解析到', `${item.address} (IPv${item.family})`);
} catch (error) {
  bad(`解析不了 ${host}：${error.message}`);
  console.log(`\n${C.red}结论：域名解析不了，和隧道无关。检查地址有没有打错。${C.reset}\n`);
  process.exit(0);
}
const address = resolved[0]?.address ?? host;

// ============================================================
step('③ 端口能不能连上');
// ============================================================
const tcpOk = await new Promise((resolve) => {
  const socket = netConnect({ host, port });
  const timer = setTimeout(() => {
    socket.destroy();
    bad('5 秒内没连上（隧道没启动 / 端口填错 / 网络被拦）');
    resolve(false);
  }, 5000);
  socket.once('connect', () => {
    clearTimeout(timer);
    ok(`TCP 连上了 ${socket.remoteAddress}:${socket.remotePort}`);
    socket.destroy();
    resolve(true);
  });
  socket.once('error', (error) => {
    clearTimeout(timer);
    bad(`连不上：${error.code ?? ''} ${error.message}`);
    resolve(false);
  });
});
if (!tcpOk) {
  console.log(
    `\n${C.red}结论：端口连不上。${C.reset}去 SakuraFRP 面板看隧道在不在线、\n` +
      `      本地端口填的是不是 ${C.bold}5173${C.reset}。\n`,
  );
  process.exit(0);
}

// ============================================================
step('④ ★ 对照组：同一个 IP:端口，只换 Host 头（每种打多次，因为这个拦截器不稳定）');
// ============================================================
/*
  【为什么要打多次？】
  这台机房的拦截设备是**时通时不通**的：同一个请求连打 15 次，
  "带域名"那组有 11 次被换成拦截页、4 次居然放行。
  只打一次的话，同一套配置跑两遍会给出两种不同结论 ——
  诊断工具自相矛盾比不给结论更糟。所以这里取样本，报"x/N 被拦"。
*/
async function sample(hostHeader, times) {
  let reached = 0;
  let blocked = 0;
  let other = 0;
  let lastKind = 'empty';
  for (let i = 0; i < times; i++) {
    const classified = classifyRaw(await rawGet(address, hostHeader));
    lastKind = classified.kind;
    if (classified.kind === 'frp' || classified.kind === 'game' || classified.kind === 'http') reached++;
    else if (classified.kind === 'blocked') blocked++;
    else other++;
  }
  return { reached, blocked, other, times, lastKind };
}

const sampleDomain = await sample(`${host}:${port}`, 5);
const sampleIp = await sample(`${address}:${port}`, 3);
const sampleBaidu = await sample('www.baidu.com', 3);

function describeSample(result, label) {
  const parts = [];
  if (result.reached > 0) parts.push(`到 frp ${result.reached}/${result.times}`);
  if (result.blocked > 0) parts.push(`被拦 ${result.blocked}/${result.times}`);
  if (result.other > 0) parts.push(`其它 ${result.other}/${result.times}`);
  console.log(`  ${C.dim}${label.padEnd(22)}${C.reset}${parts.join('   ') || '没有响应'}`);
}

describeSample(sampleDomain, 'Host = 你的域名');
describeSample(sampleIp, 'Host = 纯 IP');
describeSample(sampleBaidu, 'Host = www.baidu.com');

const domainEverBlocked = sampleDomain.blocked > 0;
const domainEverReached = sampleDomain.reached > 0;
const ipWorks = sampleIp.reached > 0;
const baiduWorks = sampleBaidu.reached > 0;

// ============================================================
step('⑤ TLS 握手（自动 HTTPS 靠它）');
// ============================================================
const tlsDomain = await tlsTry(host, address);
if (tlsDomain.ok) {
  ok('用你的域名握手成功');
  info('证书 CN', String(tlsDomain.cn ?? '(无)'));
  info('覆盖域名', String(tlsDomain.san ?? '').slice(0, 120));
  info('浏览器会信任吗', tlsDomain.authorized ? '✓ 会' : `✗ 不会（${shortError(tlsDomain.error)}）`);
} else {
  bad(`用你的域名握手失败：${shortError(tlsDomain.error)}`);
}
const tlsBaidu = await tlsTry('www.baidu.com', address);
info(
  '用 www.baidu.com 握手',
  tlsBaidu.ok ? '✓ 成功（对照：说明它只挑域名）' : `✗ ${shortError(tlsBaidu.error)}`,
);

// ============================================================
step('⑥ 结论');
// ============================================================
const lan = lanAddresses();
const frpReached = ipWorks || baiduWorks || domainEverReached;
const gameReached = sampleDomain.lastKind === 'game' || sampleIp.lastKind === 'game';
/** 走的是哪一个分支（用来决定要不要再补一句"没摸到 frp"的提示） */
let branch = 'unknown';

if (gameReached) {
  branch = 'works';
  console.log(`  ${C.green}隧道通了，网页能拿到。${C.reset}把这个发给朋友：`);
  console.log(`    ${C.cyan}http://${target}/?server=${target}${C.reset}`);
} else if (frpReached && domainEverBlocked && baiduWorks) {
  branch = 'domain-blocked';
  /*
    这是最难查、也最容易白折腾的一类：**你的配置全对，但域名过不去**。
    证据是三条对照：纯 IP 和已备案域名都能到 frp，只有你的域名会被换成拦截页。
  */
  console.log(`  ${C.red}★ 你的配置没问题，是"这个域名过不去"。${C.reset}`);
  console.log('');
  console.log('    证据（同一个 IP:端口，只换 Host 头，每种打多次）：');
  console.log(
    `      Host = 你的域名        -> 被拦 ${sampleDomain.blocked}/${sampleDomain.times}，` +
      `放行 ${sampleDomain.reached}/${sampleDomain.times}`,
  );
  console.log(`      Host = 纯 IP           -> 到 frp ${sampleIp.reached}/${sampleIp.times}`);
  console.log(
    `      Host = www.baidu.com   -> 到 frp ${sampleBaidu.reached}/${sampleBaidu.times}` +
      `${C.dim}（已备案域名的对照组）${C.reset}`,
  );
  if (domainEverReached && domainEverBlocked) {
    console.log('');
    console.log(
      `    ${C.yellow}注意：你的域名是"时通时不通"（上面前一组两个数都不为 0）——`,
    );
    console.log('    说明那台拦截设备本身不稳定。这种"偶尔能进"最坑人：');
    console.log(`    你会以为是浏览器缓存或者自己手气问题，而不是被拦。${C.reset}`);
  }
  console.log('');
  console.log('    纯 IP 和已备案域名都能到 frp，只有你的域名会被换成拦截页 ——');
  console.log('    这是**节点机房的「域名白名单/备案」过滤器**在起作用，典型文案是');
  console.log('    「根据工信部相关法规，您未进行备案」或「请联系机房域名过白」。');
  console.log(`    TLS 那一层更狠：SNI 带你的域名是**次次**被重置（见上面第 ⑤ 步）。`);
  console.log('    它在**域名**上做判断，所以：');
  console.log(`      ${C.dim}· 朋友的浏览器一定会带你的域名 -> 他必然打不开`);
  console.log(`      · 你在面板里怎么改都绕不过去（不是配置问题）${C.reset}`);
  console.log('');
  console.log(`    ${C.bold}能用的办法（按便宜到贵排）${C.reset}`);
  console.log(`    ${C.bold}① 最快：改用纯 IP:端口，并把「自动 HTTPS」关掉${C.reset}`);
  console.log(`       面板 → 隧道设置 → 自动 HTTPS = 关闭 → ★ 重启隧道`);
  console.log(`       发给朋友： ${C.cyan}http://${address}:${port}/?server=${address}:${port}${C.reset}`);
  console.log(`       ${C.dim}为什么必须关掉自动 HTTPS？因为证书是给你的域名签的，`);
  console.log(`       用 IP 访问会证书不匹配 —— 网页也许能"继续前往"，`);
  console.log(`       但 WebSocket 连接会直接失败，表现就是"一直正在重连"。`);
  console.log(`       而且"不带域名"的请求在上面是 ${sampleIp.reached}/${sampleIp.times} 放行的。${C.reset}`);
  console.log(`    ${C.bold}② 推荐：换一个【海外节点】${C.reset}`);
  console.log('       海外节点不做备案/白名单过滤，绑定的 nyat.app 子域就能正常用。');
  console.log('       海外节点只需要实名认证，不需要 ICP 备案。换完节点端口会变，重跑本脚本。');
  console.log(`    ${C.bold}③ 备选：换服务商，或改用虚拟局域网${C.reset}`);
  console.log('       （Tailscale / 蒲公英这类，朋友装个小客户端，完全没有备案问题）');
} else if (byIp.kind === 'frp') {
  branch = 'need-https';
  console.log(`  ${C.yellow}隧道在线，而且「自动 HTTPS」开着。${C.reset}`);
  console.log('    （frp 回的是"您已为本隧道启用 自动 HTTPS"，这其实说明配置是对的）');
  console.log('    而且你的域名也一路通到了 frp —— 域名这一层没问题。检查：');
  console.log('      ① 朋友是不是把链接抄全了（包括 ?server= 那一段）');
  console.log('      ② 证书有没有签发好（frpc 日志里应有「已从服务器为 … 加载证书」）');
  console.log('         —— 注意 nyat.app 开了 HSTS，证书没好时页面是直接打不开的');
  console.log('      ③ 换一台设备/网络试一次，排除单个浏览器的问题');
} else if (!ipWorks) {
  branch = 'no-tunnel';
  console.log(`  ${C.red}★ 连纯 IP 都没拿到 frp 的正常响应。${C.reset}`);
  console.log('    去面板确认：隧道在线吗？远程端口真的是这个吗？本地端口填的是 5173 吗？');
} else {
  branch = 'unknown';
  console.log(`  ${C.yellow}没得到明确结论，看上面的原始输出。${C.reset}`);
}

/*
  只有在**还没有走到"隧道没在跑"这个结论**的时候，才补这句提示。
  第一版我在成功分支后面也无条件打了这句，于是同一屏里出现了
  "隧道通了" 和 "隧道很可能没在跑" 两个互相矛盾的结论 ——
  诊断工具自相矛盾比不给结论更糟。
*/
if (!frpReached && branch !== 'works' && branch !== 'no-tunnel') {
  console.log('');
  console.log(`  ${C.dim}提示：没有任何一条请求摸到 frp 本体，说明隧道很可能没在跑。${C.reset}`);
}

console.log('');
console.log(`  ${C.bold}退路（同一 WiFi / 同一网络时，完全不用穿透）：${C.reset}`);
if (lan.length > 0) {
  for (const item of lan) {
    console.log(`    ${C.cyan}http://${item}:5173/?server=${item}:5173${C.reset}`);
  }
} else {
  console.log(`    ${C.dim}（没检测到局域网 IP）${C.reset}`);
}
if (!localOk) console.log(`  ${C.yellow}注意：本机 5173 现在没开，上面这条链接也进不去。${C.reset}`);
console.log('');
console.log(`  ${C.dim}官方文档：https://doc.natfrp.com/bestpractice/domain-bind.html${C.reset}`);
console.log(`  ${C.dim}          https://doc.natfrp.com/faq/site-inaccessible.html${C.reset}`);
console.log('');
