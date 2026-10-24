/**
 * ============================================================
 *  ★★ 0.2.1：隐德来希（op40）「血镰」特效
 * ============================================================
 *
 * 【两种形态、两个数据开关】
 *   · 1/2 星「绯红壁合」= 每 0.5 秒一发的**光环脉冲** ⇒ 数据 `pulse.fx = 'leto_scythe_aura'`
 *     ⇒ 施法者脚下血泊 + **两把血镰绕着他转**，每跳"猛扫"一下（转和收割是同一个动作）。
 *   · 3 星「灵与欲的惜别」= 每次攻击的**溅射** ⇒ 数据 `splash.fx = 'leto_scythe_sweep'`
 *     ⇒ 被打的那一格横着一刀血红月牙。
 *
 * 【为什么不是序列帧？】
 * 这是**连续旋转**的东西 —— 序列帧要么帧数爆炸，要么转起来一顿一顿。
 * 血镰的形状（弯刃 + 近白刃口）、血泊的径向渐变都是**画出来的**（canvas → CanvasTexture），
 * 旋转由 `rotation.z` 每帧推进 ⇒ 任意帧率下都是顺的（和 `skill-cast-fx.ts` 同一个做法）。
 *
 * 【口径对齐（照提案稿 `.fx-proposal/leto-scythe.html`）】
 *   · 世界半径 **R = (radius + 0.5) 格** —— 和范围白框 `squareRect` 同一个公式
 *     （radius 1 ⇒ 3×3、R = 1.5 格），所以血镰绝不会扫出白框外。
 *   · 刀尖轨迹半径 = R ⇒ 单把镰刀的画布边长 = 2 × 0.94R（刃长 0.94R，刀尖正好落在 R）。
 *   · 血泊半径压到 1.12R，**不盖过白框**。
 *   · 一个周期（= 内核 `intervalTicks` 换算出的秒数）里：前 68% 慢转 40°、后 32% 猛扫 120°，
 *     并在猛扫开头闪一下刃口。
 *   · 亮度上限写在 `LETO_CAP` 里（防光污染，和技能光环同一套规矩）。
 */
import {
  AdditiveBlending,
  CanvasTexture,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  NormalBlending,
  PlaneGeometry,
  SRGBColorSpace,
  Sprite,
  SpriteMaterial,
  type Object3D,
  type Texture,
} from 'three';
import { zoneWorldRadius } from '../game/grid.js';
import { RENDER_ORDER_FX } from './card-layout.js';

/** 血色调色板（用户口径：**红黑色**的镰刀 —— 暗红近黑当刃背，亮血红当刃口） */
export const LETO_BLOOD = {
  edge: '#ffd9cf',
  hi: '#ff6a4a',
  main: '#c1121f',
  deep: '#7a0a12',
  dark: '#2b0206',
  mist: '#961a22',
} as const;

/** 各层亮度上限（防光污染的总闸门） */
export const LETO_CAP = { pool: 0.5, blade: 0.92, edge: 0.85, arc: 0.55, mist: 0.3 } as const;

/**
 * 绕着人转的**血色月牙带**有几条（用户给的参考图是两条大弧交错，形成一个环）。
 * ★ 不是"一圈小镰刀"了：贴地的小镰刀在 45° 俯视下会被压扁、被卡面挡住。
 */
export const LETO_RIBBON_COUNT = 3;

/* 三条比例（全部相对"环半径 R"）—— 改一个就整体缩放 */
/** 每条月牙的贴图在世界里占多宽（= 2 × 弧半径 + 边距） */
export const LETO_RIBBON_SIZE_OVER_R = 2.05;
/** 两条弧在圆上的**偏移**半径（0 = 完全同心；留一点偏移才看得出"交错"） */
export const LETO_RIBBON_OFFSET_OVER_R = 0;
/** 整圈转一圈要几秒（太慢像静止，太快像风扇） */
export const LETO_SPIN_SECONDS = 2.6;
/** 环心抬多高（相对 R）：抬到胸口，绕着"人"转而不是绕着地面那一点转 */
export const LETO_RIBBON_CENTER_OVER_R = 0.46;

/** 血镰一圈转多久（= 内核脉冲间隔 0.5 秒；数据改了这里跟着改） */
export const LETO_HARVEST_SECONDS = 0.5;
/** 一个周期里"猛扫"占的比例 */
export const LETO_SWEEP_RATIO = 0.32;
/** 光环尾巴：脉冲每 0.5 秒一报，所以活 0.6 秒 ⇒ 首尾相接，看着是连续在转 */
export const LETO_AURA_LIFE = 0.6;
/** 召唤（涨起来）多久 */
export const LETO_SUMMON_SECONDS = 0.35;
/** 横扫月牙活多久 */
export const LETO_SWEEP_SECONDS = 0.45;
/** 同时在场的上限（防极端情况下堆积） */
export const LETO_MAX_AURA = 4;
export const LETO_MAX_SWEEP = 24;

/** 注册表：数据里写的 fx id → 这个 id 是哪种形态 */
export const LETO_SCYTHE_FX: Record<string, 'aura' | 'sweep'> = {
  leto_scythe_aura: 'aura',
  leto_scythe_sweep: 'sweep',
};

export function letoScytheModeOf(fx: string): 'aura' | 'sweep' | null {
  return LETO_SCYTHE_FX[fx] ?? null;
}

/** 世界半径（格）= radius + 0.5 —— 和范围白框同一个公式（唯一实现在 `game/grid.ts`） */
export function letoRingRadius(radius: number): number {
  return zoneWorldRadius(radius);
}

// ============================================================
//  贴图（白色/彩色的形状画一次，全局共享）
// ============================================================

const TEX = 512;
let poolTex: CanvasTexture | null = null;
let ribbonTex: CanvasTexture | null = null;
let arcTex: CanvasTexture | null = null;

function makeCanvas(size: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas 不可用');
  return { canvas, ctx };
}

function toTexture(canvas: HTMLCanvasElement): CanvasTexture {
  const texture = new CanvasTexture(canvas);
  // ★ 不写色彩空间颜色会被冲淡（同 unit-aura / skill-cast-fx 的说明）
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/** 血泊：暗红尘土的径向渐变（**普通混合** —— 加色混合下"黑"等于不存在，压不暗地面） */
export function letoPoolTexture(): CanvasTexture {
  if (poolTex) return poolTex;
  const { canvas, ctx } = makeCanvas(256);
  const c = 128;
  const g = ctx.createRadialGradient(c, c, 0, c, c, 124);
  g.addColorStop(0, 'rgba(110,10,18,0.92)');
  g.addColorStop(0.42, 'rgba(150,26,34,0.62)');
  g.addColorStop(0.75, 'rgba(110,10,18,0.28)');
  g.addColorStop(1, 'rgba(110,10,18,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(c, c, 124, 0, Math.PI * 2);
  ctx.fill();
  // 几道放射状"血丝"，让它不像一个干净的圆
  ctx.globalCompositeOperation = 'source-over';
  for (let i = 0; i < 9; i++) {
    const ang = (i / 9) * Math.PI * 2 + 0.4;
    const len = 60 + ((i * 37) % 11) / 11 * 58;
    ctx.beginPath();
    ctx.strokeStyle = `rgba(110,10,18,${0.18 + ((i * 13) % 7) / 7 * 0.14})`;
    ctx.lineWidth = 3 + ((i * 7) % 5);
    ctx.moveTo(c + Math.cos(ang) * 22, c + Math.sin(ang) * 22);
    ctx.lineTo(c + Math.cos(ang) * len, c + Math.sin(ang) * len);
    ctx.stroke();
  }
  poolTex = toTexture(canvas);
  return poolTex;
}

/**
 * ★★ 0.2.1 第三版：**血色月牙带**（用户给的参考图：两道通红的大月牙绕着人扫成一个环）。
 *
 * 【为什么又换了？】
 * 之前一版是"一圈小红黑镰刀"。真机上看着像一排小旗子 —— 参考图要的是
 * **大弧面的血色光带**：内侧近乎白热的刃口、外侧散成暗红，端头收细。
 * 所以这里直接用"两条大月牙"包住整个棋子，而不是 8 把小镰刀。
 *
 * 【怎么画】
 * 沿圆弧采样，算一条**中间粗、两头收尖**的带子（外半径 + 内半径之间填色），
 * 再在内侧压一条近白的细弧当"开刃"，外侧叠一层低透明度的暗红当"血雾"。
 * 贴图是 512 见方、弧半径 0.40 边长 —— 实际大小由 `LETO_RIBBON_SIZE_OVER_R` 定。
 */
export function letoRibbonTexture(): CanvasTexture {
  if (ribbonTex) return ribbonTex;
  const size = 512;
  const { canvas, ctx } = makeCanvas(size);
  const c = size / 2;
  const radius = size * 0.40;

  /** 沿弧画一条"中间粗、两头收尖"的带子（t: 0..1） */
  const ribbonPath = (from: number, to: number, halfWidth: number): void => {
    const steps = 72;
    ctx.beginPath();
    // 先走外沿
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const angle = from + (to - from) * t;
      // sin 的 0.62 次方：中段厚、两头迅速收细（像挥出去的一道血迹）
      const w = halfWidth * Math.pow(Math.sin(Math.PI * t), 0.62);
      const r = radius + w;
      const x = c + Math.cos(angle) * r;
      const y = c + Math.sin(angle) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    // 再沿内沿回来
    for (let i = steps; i >= 0; i--) {
      const t = i / steps;
      const angle = from + (to - from) * t;
      const w = halfWidth * Math.pow(Math.sin(Math.PI * t), 0.62);
      ctx.lineTo(c + Math.cos(angle) * (radius - w), c + Math.sin(angle) * (radius - w));
    }
    ctx.closePath();
  };

  // ① 外层血雾（宽、暗红、低透明度）
  ribbonPath(-2.6, 1.0, size * 0.115);
  ctx.fillStyle = 'rgba(120,6,14,0.38)';
  ctx.fill();

  // ② 主体：亮血红
  ribbonPath(-2.45, 0.85, size * 0.052);
  ctx.fillStyle = 'rgba(214,16,26,0.95)';
  ctx.fill();

  // ③ 内芯：深一层，让带子有厚度（不是一张平的纸）
  ribbonPath(-2.3, 0.7, size * 0.022);
  ctx.fillStyle = 'rgba(255,60,44,0.95)';
  ctx.fill();

  /*
    ④ 开刃：**沿着带子内轮廓**画一条近白的热线。
    ★ 不能用固定半径的 arc —— 带子两头是收尖的，固定半径会横切过去，看着像一根白线穿过去。
  */
  ctx.lineCap = 'round';
  for (const [width, alpha, inset] of [[size * 0.013, 0.32, 0.9], [size * 0.006, 0.8, 0.98]] as const) {
    const steps = 72;
    ctx.beginPath();
    for (let i = 0; i <= steps; i++) {
      const tt = i / steps;
      const angle = -2.45 + (0.85 - -2.45) * tt;
      const w = size * 0.052 * Math.pow(Math.sin(Math.PI * tt), 0.62);
      const r = radius - w * inset;
      const x = c + Math.cos(angle) * r;
      const y = c + Math.sin(angle) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = `rgba(255,232,226,${alpha})`;
    ctx.lineWidth = width;
    ctx.stroke();
  }

  // ⑤ 甩出去的两撮血丝（端头细、越远越淡）
  for (const [from, to, w] of [[0.75, 1.42, 0.020], [-2.5, -3.1, 0.016]] as const) {
    const steps = 26;
    ctx.beginPath();
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const angle = from + (to - from) * t;
      const r = radius * (1 + 0.16 * t);
      const x = c + Math.cos(angle) * r;
      const y = c + Math.sin(angle) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = `rgba(255,70,52,${w * 40})`;
    ctx.lineWidth = size * w * (1 - 0.5);
    ctx.stroke();
  }

  ribbonTex = toTexture(canvas);
  return ribbonTex;
}

/** 横扫月牙（一把扫过去的弧）：中间亮、两端渐隐 */
export function letoArcTexture(): CanvasTexture {
  if (arcTex) return arcTex;
  const { canvas, ctx } = makeCanvas(TEX);
  const c = TEX / 2;
  const R = TEX * 0.46;

  const strokes: Array<[number, number, string, number]> = [
    [R, TEX * 0.075, LETO_BLOOD.dark, 0.7],
    [R, TEX * 0.042, LETO_BLOOD.main, 0.92],
    [R * 0.96, TEX * 0.016, LETO_BLOOD.edge, 0.98],
  ];
  for (const [radius, width, color, alpha] of strokes) {
    ctx.save();
    ctx.beginPath();
    // 从左下扫到右上（-140° → 40°），像一刀横着抹过去
    const g = ctx.createLinearGradient(0, 0, TEX, TEX);
    g.addColorStop(0, `rgba(${hexToRgb(color)},0)`);
    g.addColorStop(0.28, `rgba(${hexToRgb(color)},${alpha})`);
    g.addColorStop(0.72, `rgba(${hexToRgb(color)},${alpha})`);
    g.addColorStop(1, `rgba(${hexToRgb(color)},0)`);
    ctx.strokeStyle = g;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.arc(c, c, radius, -2.44, 0.7);
    ctx.stroke();
    ctx.restore();
  }

  arcTex = toTexture(canvas);
  return arcTex;
}

function hexToRgb(hex: string): string {
  const value = hex.replace('#', '');
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `${r},${g},${b}`;
}

/** 开局把三张图先画出来（画布生成很快，但别在第一次开技能那一帧做） */
export function preloadLetoScytheTextures(): void {
  letoPoolTexture();
  letoRibbonTexture();
  letoArcTexture();
}

// ============================================================
//  场景里的实例
// ============================================================

interface AuraInstance {
  unitKey: string;
  group: Group;
  /** 贴地血泊（唯一一层贴地的） */
  pool: { mesh: Mesh; geometry: PlaneGeometry; material: MeshBasicMaterial };
  /** 绕着他转的血色月牙（Sprite = 永远正对镜头，屏幕空间里各自再转一点） */
  ribbons: Array<{ sprite: Sprite; material: SpriteMaterial; baseRotation: number }>;
  /** 已经涨开多久（秒）—— 决定召唤/收尾的透明度 */
  age: number;
  /** 还能活多久（秒）—— 每次脉冲刷新 */
  life: number;
  /** 转过的总角度（弧度） */
  spin: number;
  /** 一个"转一圈"的周期（秒）= 内核脉冲间隔 */
  harvest: number;
}

interface SweepInstance {
  group: Group;
  mesh: Mesh;
  geometry: PlaneGeometry;
  material: MeshBasicMaterial;
  texture: Texture;
  age: number;
  life: number;
  radius: number;
  /** 出生时定的那个角度（每次更新都从它算起，不然累加会越转越快） */
  baseRot: number;
}

let root: Object3D | null = null;
const auras = new Map<string, AuraInstance>();
const sweeps: SweepInstance[] = [];

/** 把特效挂到哪个根节点上（`replay.ts` 初始化时调一次） */
export function attachLetoScytheRoot(scene: Object3D): void {
  root = scene;
}

function fadeIn(k: number): number {
  const t = Math.min(1, Math.max(0, k));
  return t * t * (3 - 2 * t);
}

function easeOut(k: number): number {
  return 1 - Math.pow(1 - Math.min(1, Math.max(0, k)), 3);
}

/**
 * 召唤/刷新一圈「血镰环绕」。
 *
 * ★ 同一个施法者只留**一个**实例（脉冲每 0.5 秒来一次，重复创建会让画面闪）。
 *   每次调用刷新 `life`，于是"技能一直在" ⇒ 光一直亮；技能一断，0.6 秒后自己收尾。
 */
export function spawnLetoAura(unitKey: string, x: number, z: number, radius: number, harvestSeconds = LETO_HARVEST_SECONDS): void {
  if (!root) return;

  const existing = auras.get(unitKey);
  if (existing) {
    existing.life = LETO_AURA_LIFE;
    existing.group.position.set(x, 0, z);
    return;
  }

  // 超上限先把最老的挤掉（极端情况，正常一轮最多 8 个人）
  if (auras.size >= LETO_MAX_AURA) {
    const oldest = auras.keys().next().value;
    if (oldest !== undefined) disposeAura(oldest);
  }

  const R = letoRingRadius(radius);
  const group = new Group();
  group.position.set(x, 0, z);

  // ① 血泊（贴地、普通混合：这是唯一能"压暗"地面的一层）
  const poolGeometry = new PlaneGeometry(R * 2.24, R * 2.24);
  const poolMaterial = new MeshBasicMaterial({
    map: letoPoolTexture(),
    transparent: true,
    opacity: 0,
    blending: NormalBlending,
    side: DoubleSide,
    depthWrite: false,
  });
  const poolMesh = new Mesh(poolGeometry, poolMaterial);
  poolMesh.rotation.x = -Math.PI / 2;
  poolMesh.position.y = 0.001;
  poolMesh.renderOrder = RENDER_ORDER_FX;
  group.add(poolMesh);

  /*
    ② 两条**血色月牙带**绕着人扫（用户给的参考图：通红的大月牙绕成一个环）。

    ★ 用 Sprite（永远正对镜头），而不是贴地平面 —— 45° 俯视会把贴地的东西压成扁椭圆，
      卡面又正好压在圆心，看起来只剩"几道歪掉的红线"。
    ★ 两条弧各自在**屏幕空间**里再转一点（`material.rotation`），
      所以它们不是两个静止的半圆，而是"一前一后甩过去的刀光"。
  */
  const size = R * LETO_RIBBON_SIZE_OVER_R;
  const offset = R * LETO_RIBBON_OFFSET_OVER_R;
  const ribbons: Array<{ sprite: Sprite; material: SpriteMaterial; baseRotation: number }> = [];
  for (let i = 0; i < LETO_RIBBON_COUNT; i++) {
    const material = new SpriteMaterial({
      map: letoRibbonTexture(),
      transparent: true,
      opacity: 0,
      // ★ 加色混合：参考图里那道红光是"发亮"的（普通混合会变成一块死红）
      blending: AdditiveBlending,
      depthWrite: false,
      /*
        ★★ 必须关深度测试（用户报"只显示了 1 半"的根因）：
        这是一张**正对镜头**的大贴片，圆心如果放在地面，下半张就跑到地板**底下**去了，
        被不透明的地板挡住 ⇒ 只剩上面半个环。关掉深度测试之后它是"贴在最前面的一层光"，
        整个环都看得见（它只有 2~3 格大、只挂在这一个棋子身上，不会盖住全场）。
      */
      depthTest: false,
    });
    const sprite = new Sprite(material);
    sprite.scale.set(size, size, 1);
    // 两条弧错开 180°，各自再偏一点点，看起来是"交错"而不是"对齐"
    const angle = (i / LETO_RIBBON_COUNT) * Math.PI * 2 + 0.35;
    // 圆心抬到胸口高度：绕"人"转，而不是绕"地面那一点"转
    sprite.position.set(Math.cos(angle) * offset, R * LETO_RIBBON_CENTER_OVER_R, Math.sin(angle) * offset);
    const baseRotation = angle + Math.PI / 2 + (i === 0 ? 0 : 0.5);
    material.rotation = baseRotation;
    sprite.renderOrder = RENDER_ORDER_FX;
    group.add(sprite);
    ribbons.push({ sprite, material, baseRotation });
  }

  const instance: AuraInstance = {
    unitKey,
    group,
    pool: { mesh: poolMesh, geometry: poolGeometry, material: poolMaterial },
    ribbons,
    age: 0,
    life: LETO_AURA_LIFE,
    spin: 0,
    harvest: Math.max(0.1, harvestSeconds),
  };
  root.add(group);
  auras.set(unitKey, instance);
}

/** 一格横着一刀（3 星溅射） */
export function spawnLetoSweep(x: number, z: number, radius: number): void {
  if (!root) return;
  if (sweeps.length >= LETO_MAX_SWEEP) {
    const oldest = sweeps.shift();
    if (oldest) disposeSweep(oldest);
  }
  const R = letoRingRadius(radius);
  const geometry = new PlaneGeometry(R * 2, R * 2);
  const texture = letoArcTexture();
  const material = new MeshBasicMaterial({
    map: texture,
    transparent: true,
    opacity: 0,
    blending: AdditiveBlending,
    side: DoubleSide,
    depthWrite: false,
  });
  const mesh = new Mesh(geometry, material);
  mesh.rotation.x = -Math.PI / 2;
  // 每刀换个角度，不然连着砍像同一张图在闪
  const baseRot = ((sweeps.length * 0.7) % Math.PI) - 0.5;
  mesh.rotation.z = baseRot;
  mesh.position.y = 0.006;
  mesh.renderOrder = RENDER_ORDER_FX;
  const group = new Group();
  group.position.set(x, 0, z);
  group.add(mesh);
  root.add(group);
  sweeps.push({ group, mesh, geometry, material, texture, age: 0, life: LETO_SWEEP_SECONDS, radius, baseRot });
}

/**
 * 每帧推进（旋转 + 呼吸 + 到期回收）。
 * `deltaSeconds` 是**回放时钟**的增量 ⇒ 两倍速/看录像自动正确（同其它特效模块）。
 */
export function updateLetoScytheFx(deltaSeconds: number): void {
  // ---- 环绕 ----
  for (const [key, aura] of [...auras]) {
    aura.age += deltaSeconds;
    aura.life -= deltaSeconds;
    if (aura.life <= 0) {
      disposeAura(key);
      continue;
    }
    const harvest = aura.harvest;
    /*
      ★ 0.2.1：整圈**匀速转**（`LETO_SPIN_SECONDS` 一圈）——
      8 把立着的镰刀绕着施法者转，就是"镰刀组成的圆环在旋转"。
    */
    aura.spin += (deltaSeconds / LETO_SPIN_SECONDS) * Math.PI * 2;
    aura.group.rotation.y = aura.spin;

    // 收尾：最后 0.25 秒淡出（脉冲断了才会走到这里）
    const fadeOut = Math.min(1, Math.max(0, aura.life) / 0.25);
    const grow = fadeIn(aura.age / LETO_SUMMON_SECONDS);
    const alpha = grow * fadeOut;

    // 血泊：涨开 + 淡出
    aura.pool.mesh.scale.setScalar(0.34 + 0.66 * easeOut(aura.age / LETO_SUMMON_SECONDS));
    aura.pool.material.opacity = alpha * LETO_CAP.pool;

    /*
      一圈月牙：随整圈转（父节点绕 Y）再各自在**屏幕空间**里转 ——
      两层旋转叠起来才是"甩过去的刀光"，只转一层会像一张纸在平移。
    */
    const phase = ((aura.age / harvest) % 1 + 1) % 1;
    const flash =
      phase > 1 - LETO_SWEEP_RATIO
        ? Math.pow((phase - (1 - LETO_SWEEP_RATIO)) / LETO_SWEEP_RATIO, 0.6)
        : 0;
    for (const ribbon of aura.ribbons) {
      ribbon.material.opacity = alpha * LETO_CAP.blade * (0.72 + 0.28 * flash);
      ribbon.material.rotation = ribbon.baseRotation + aura.spin * 1.35;
    }
  }

  // ---- 横扫 ----
  for (let i = sweeps.length - 1; i >= 0; i--) {
    const sweep = sweeps[i]!;
    sweep.age += deltaSeconds;
    if (sweep.age >= sweep.life) {
      disposeSweep(sweep);
      sweeps.splice(i, 1);
      continue;
    }
    const k = sweep.age / sweep.life;
    // 先涨后收：刀扫过去的同时变薄
    sweep.mesh.scale.setScalar(0.72 + 0.42 * easeOut(k));
    sweep.material.opacity = LETO_CAP.arc * Math.pow(1 - k, 1.6) * fadeIn(k / 0.18);
    // 顺带再扫一点角度（从出生角度算起，不累加）
    sweep.mesh.rotation.z = sweep.baseRot + k * 1.6;
  }
}

function disposeAura(key: string): void {
  const aura = auras.get(key);
  if (!aura) return;
  aura.group.parent?.remove(aura.group);
  aura.pool.geometry.dispose();
  aura.pool.material.dispose();
  for (const ribbon of aura.ribbons) ribbon.material.dispose();
  // ★ 贴图是模块级共享的（画一次）—— 别 dispose，否则下一个就没图了
  aura.group.clear();
  auras.delete(key);
}

function disposeSweep(sweep: SweepInstance): void {
  sweep.group.parent?.remove(sweep.group);
  sweep.geometry.dispose();
  sweep.material.dispose();
  sweep.group.clear();
}

/** 清空（重开一局必须调，否则血泊和镰刀会留在棋盘上） */
export function clearLetoScytheFx(): void {
  for (const key of [...auras.keys()]) disposeAura(key);
  for (const sweep of sweeps) disposeSweep(sweep);
  sweeps.length = 0;
}

/** 测试/排查用：现在有几圈环绕、几道横扫 */
export function letoScytheLiveCount(): { auras: number; sweeps: number } {
  return { auras: auras.size, sweeps: sweeps.length };
}
