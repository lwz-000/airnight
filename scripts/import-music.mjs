#!/usr/bin/env node
/**
 * ============================================================
 *  把本地的音乐库导入进游戏（转码 + 生成曲目索引）
 * ============================================================
 *
 *   node scripts/import-music.mjs
 *   node scripts/import-music.mjs --src="G:/塞壬下载器/music"
 *   node scripts/import-music.mjs --bitrate=192 --force
 *
 * 【为什么需要转码，不能直接扔进去？】
 * 塞壬下载器下的是母带级 FLAC（实测平均 1648 kbps，比 CD 还高），
 * 62 首就 2.0 GB —— 游戏本体才 362 MB，直接塞进去会让"发给朋友"这件事
 * 变得非常痛苦。转成 192 kbps MP3 后约 300 MB，听感在游戏背景音乐这个
 * 场景基本没差别。
 *
 * 【为什么输出文件名是 t001.mp3 而不是原曲名？】
 * 原始文件名/目录名里有中文、括号、方括号、空格（例如
 * "(Believed Believes) Believing.flac"、"众生行记OST/The Birth.flac"）。
 * 这些名字进 URL 要转义、进 zip 要小心编码、在别人的系统上还可能乱码。
 * 统一编成 ASCII 短名，再让 tracks.json 保存展示用的曲名/专辑名 ——
 * 展示和存储分开，谁都不会因为编码问题挂掉。
 *
 * 【输出】
 *   apps/web/public/music/t001.mp3 … tNNN.mp3   音频本体（vite 会自动拷进 dist/）
 *   apps/web/public/music/tracks.json           曲目索引（曲名 / 专辑 / 时长 / 文件）
 *
 * 这两个东西就是"音乐纳入游戏本体"的全部 —— 打包发给朋友时
 * dist 里已经带着它们，对方不需要任何额外文件。
 */
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  openSync,
  closeSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, extname, join, resolve } from 'node:path';

// ---------------------------------------------------------------- 参数

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const has = (name) => argv.includes(`--${name}`);

const repoRoot = resolve(import.meta.dirname, '..');
const SRC = resolve(flag('src', 'G:/塞壬下载器/music'));
const OUT = resolve(flag('out', join(repoRoot, 'apps', 'web', 'public', 'music')));
const BITRATE = Number(flag('bitrate', '192'));
const FORCE = has('force');

const AUDIO_EXT = new Set(['.flac', '.mp3', '.wav', '.m4a', '.aac', '.ogg', '.opus', '.wma']);

/**
 * ★ 在本机跑外部命令必须"重定向到文件"，不能用管道。
 *
 * `spawnSync(exe, args, { encoding: 'utf8' })` 的默认 stdio 是 'pipe'，
 * 而当前环境的沙箱禁止创建管道 —— 症状是**连 `cmd.exe /c echo hi` 都会**
 * 返回 `{ status: null, error: EBUSY }`，stdout 永远是空串，
 * 看起来像"那个 exe 有问题"，其实是 spawn 本身没跑起来。
 * （`scripts/pnpm.mjs` 之所以没事，是因为它用的是 stdio: 'inherit'。）
 *
 * 绕法：把 stdout/stderr 都接到一个临时文件的 fd 上，完全不碰管道。
 */
const LOG = join(tmpdir(), 'airnight-ffmpeg.log');

function runFfmpeg(args) {
  const fd = openSync(LOG, 'w');
  const result = spawnSync(ffmpeg.exe, args, { stdio: ['ignore', fd, fd] });
  closeSync(fd);
  let log = '';
  try {
    log = readFileSync(LOG, 'utf8');
  } catch {
    /* 读不到就算了，下面只看 status */
  }
  return { status: result.status, error: result.error, log };
}

/**
 * 找 ffmpeg。
 *
 * 本机 PATH 里没有 ffmpeg，但好几个软件自带了一份 —— 直接借用即可，
 * 省掉一次 80 MB 的下载（实测这个网络下要 2.8 小时）。
 * 顺序：--ffmpeg 显式指定 → PATH → 已知的自带位置（塞壬下载器 / bilibili / oopz）。
 */
function findFfmpeg() {
  const explicit = flag('ffmpeg', null);
  const candidates = [
    explicit,
    'ffmpeg',
    join(process.env.APPDATA ?? '', 'com.nuthx.siren-downloader', 'bin', 'ffmpeg.exe'),
    join(process.env.APPDATA ?? '', 'bilibili', 'ffmpeg', 'ffmpeg.exe'),
    'D:/oopz/ffmpeg.exe',
  ].filter(Boolean);

  for (const candidate of candidates) {
    // 这里不能调 runFfmpeg（它闭包了 ffmpeg 变量），先手搓一次探测
    const fd = openSync(LOG, 'w');
    const probe = spawnSync(candidate, ['-version'], { stdio: ['ignore', fd, fd] });
    closeSync(fd);
    if (probe.status !== 0) continue;
    let out = '';
    try {
      out = readFileSync(LOG, 'utf8');
    } catch {
      continue;
    }
    if (/^ffmpeg version/m.test(out)) {
      return { exe: candidate, version: (out.split('\n')[0] ?? '').trim() };
    }
  }
  return null;
}

// ---------------------------------------------------------------- 工具

/** 递归收集音频文件，返回 { file, album }（album 取相对于源目录的第一层目录名） */
function collect(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      for (const sub of collect(full)) {
        out.push({ ...sub, album: sub.album || entry.name });
      }
    } else if (entry.isFile() && AUDIO_EXT.has(extname(entry.name).toLowerCase())) {
      out.push({ file: full, album: '' });
    }
  }
  return out;
}

/** 从 ffmpeg 的 stderr 里抠出输入时长（秒）；解析不到就返回 0 */
function parseDuration(stderr) {
  const hit = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr);
  if (!hit) return 0;
  return Number(hit[1]) * 3600 + Number(hit[2]) * 60 + Number(hit[3]);
}

const mb = (bytes) => (bytes / 1048576).toFixed(1);

// ---------------------------------------------------------------- 主流程

const ffmpeg = findFfmpeg();
if (!ffmpeg) {
  console.error(
    '找不到 ffmpeg。\n' +
      '  · 用 --ffmpeg="C:\\路径\\ffmpeg.exe" 指定一个\n' +
      '  · 或者装一个：winget install Gyan.FFmpeg',
  );
  process.exit(1);
}
if (!existsSync(SRC)) {
  console.error(`音乐源目录不存在：${SRC}\n用 --src="<目录>" 指定。`);
  process.exit(1);
}

console.log(`ffmpeg   ${ffmpeg.exe}`);
console.log(`         ${ffmpeg.version}`);
console.log(`源目录   ${SRC}`);
console.log(`输出     ${OUT}`);
console.log(`码率     ${BITRATE} kbps MP3`);
console.log('');

const tracks = collect(SRC).sort((a, b) => {
  const ka = `${a.album}\u0000${basename(a.file)}`;
  const kb = `${b.album}\u0000${basename(b.file)}`;
  return ka.localeCompare(kb, 'zh');
});

if (tracks.length === 0) {
  console.error('源目录里没有找到任何音频文件。');
  process.exit(1);
}

mkdirSync(OUT, { recursive: true });

const index = [];
let done = 0;
let skipped = 0;
let failed = 0;
let outBytes = 0;

/**
 * 读上一次生成的索引。
 * 跳过转码的曲目要**沿用原来的时长** —— 否则重复运行一次，
 * 所有"跳过"的曲子时长就全变成 0 了（只有真转过的那首才有解析结果）。
 */
const previous = new Map();
try {
  const old = JSON.parse(readFileSync(join(OUT, 'tracks.json'), 'utf8'));
  for (const t of old.tracks ?? []) previous.set(t.file, t);
} catch {
  /* 第一次运行没有旧索引，正常 */
}

tracks.forEach((track, i) => {
  const seq = String(i + 1).padStart(3, '0');
  const name = `t${seq}.mp3`;
  const target = join(OUT, name);
  const rel = `music/${name}`;
  const title = basename(track.file, extname(track.file));
  const album = track.album;
  const srcSize = statSync(track.file).size;

  // 已存在且比源文件新 → 跳过（重复运行不会白白重转一遍）
  if (!FORCE && existsSync(target) && statSync(target).mtimeMs >= statSync(track.file).mtimeMs) {
    const old = previous.get(rel);
    skipped++;
    const size = statSync(target).size;
    outBytes += size;
    index.push({ seq, file: rel, title, album, duration: old?.duration ?? 0, size });
    process.stdout.write(`\r  跳过 ${seq}/${String(tracks.length).padStart(3, '0')}（已转过）   `);
    return;
  }

  /*
    -vn            丢掉封面图（有些 OST 带一张 1MB 的封面，白占体积）
    -map_metadata  保留标题/专辑等标签，播放器能显示
    -ar 44100      源是 96 kHz 母带，而 MP3 只支持 32/44.1/48 kHz，必须重采样
    -joint_stereo  联合立体声，同码率下比纯 stereo 好一点
  */
  const result = runFfmpeg([
    '-hide_banner',
    '-nostdin',
    '-y',
    '-i', track.file,
    '-vn',
    '-c:a', 'libmp3lame',
    '-b:a', `${BITRATE}k`,
    '-ar', '44100',
    '-joint_stereo', '1',
    '-id3v2_version', '3',
    target,
  ]);

  if (result.status !== 0 || !existsSync(target)) {
    failed++;
    console.log(`\n  ✗ ${name}  ${title}  —— 转码失败`);
    console.log(result.log.split('\n').slice(-4).join('\n'));
    return;
  }

  const size = statSync(target).size;
  outBytes += size;
  done++;
  index.push({
    seq,
    file: rel,
    title,
    album,
    duration: Math.round(parseDuration(result.log)),
    size,
  });
  process.stdout.write(
    `\r  转码 ${seq}/${String(tracks.length).padStart(3, '0')}  ${mb(size).padStart(6)} MB` +
      `  (源 ${mb(srcSize).padStart(6)} MB)  ${title.slice(0, 24).padEnd(24)}`,
  );
});

// ---------------------------------------------------------------- 索引

const payload = {
  generatedAt: new Date().toISOString(),
  bitrate: BITRATE,
  count: index.length,
  tracks: index.map((t) => ({
    file: t.file,
    title: t.title,
    album: t.album,
    duration: t.duration,
  })),
};
writeFileSync(join(OUT, 'tracks.json'), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

console.log('\n');
console.log(`转码 ${done} 首 · 跳过 ${skipped} 首 · 失败 ${failed} 首`);
console.log(`输出总量 ${mb(outBytes)} MB（源 ${mb(tracks.reduce((s, t) => s + statSync(t.file).size, 0))} MB）`);
console.log(`索引已写入 ${join(OUT, 'tracks.json')}`);
rmSync(LOG, { force: true });
if (failed > 0) process.exit(1);
