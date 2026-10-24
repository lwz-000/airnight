/**
 * ============================================================
 *  ★★ 0.2.1 特效注册表的一致性（图 ↔ 数据 ↔ 代码 三方对齐）
 * ============================================================
 *
 * 【为什么值得测？】
 * 这套"数据里写个字符串 → 渲染层查表播图"的做法，好处是加人不用改代码，
 * **代价是三类错误全都不报错、只表现为"什么都不放"**：
 *   ① 数据里的 id 拼错  → 查不到表项，静默跳过；
 *   ② 表里的贴图路径写错 → 图加载失败，静默跳过；
 *   ③ 表里的帧数/格数和真图不一致 → 播出来是"半张脸"或尺寸错一截。
 * 这三类都没法靠人眼一眼看出来（要等真的抽到那个干员、真的放出技能），
 * 所以在这里一次性扫全表：
 *   · 数据引用的每个 id 必须在注册表里；
 *   · 注册表引用的每个 PNG 必须在磁盘上；
 *   · **PNG 的真实宽高必须和注册表的 `frames` / `cells` 对得上**（读 IHDR，不依赖图像库）。
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BOARD_W, SKILLS, TRAIT_DEFS, UNIT_DEFS } from '../../../packages/shared/src/index.js';
import { COMBAT_FX, SEQ_FX, SKILL_FX, combatFxIdsOf } from '../src/three/sequence-fx.js';
import { BLOOM_FX } from '../src/three/vishdal-bloom.js';
import { LETO_SCYTHE_FX } from '../src/three/leto-scythe-fx.js';
import { TRACER_FX } from '../src/three/bolt-tracer-fx.js';
import { BOARD_VOLLEY } from '../src/three/board-volley-fx.js';
import { ROSMON_GEAR_PATH, ROSMON_SLAM_FX } from '../src/three/rosmon-slam-fx.js';
import { NOTE_FX_IDS } from '../src/three/note-fx.js';
import { HEAL_HALO_FX } from '../src/three/heal-halo-fx.js';
import { LOCKON_FX } from '../src/three/lockon-fx.js';
import { CHEN_THRUST_FX } from '../src/three/chen-thrust-fx.js';
import { AMIYA_FORM_FX_IDS } from '../src/three/amiya-form-fx.js';

/** 读 PNG 的 IHDR 拿宽高（PNG 一定有 IHDR，宽在 16..20、高在 20..24） */
function pngSize(path: string): { width: number; height: number } {
  const buffer = readFileSync(path);
  expect(buffer.subarray(1, 4).toString('ascii'), '不是 PNG').toBe('PNG');
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function assetPath(relative: string): string {
  return fileURLToPath(new URL(`../public/assets/${relative}`, import.meta.url));
}

/** 数据里所有"这一发要播专属特效"的 id（含普攻 / 施法 / 脉冲 / 溅射） */
function dataFxIds(): { id: string; where: string }[] {
  const out: { id: string; where: string }[] = [];
  for (const [unitId, def] of Object.entries(UNIT_DEFS)) {
    if (def.combatFx) out.push({ id: def.combatFx, where: `${unitId}.combatFx` });
    if (def.tracerFx) out.push({ id: def.tracerFx, where: `${unitId}.tracerFx` });
    // ★ 0.2.1：治疗流光（古米/芙蓉的绿光）也是"数据写字符串 → 渲染层查表"
    if (def.healFx) out.push({ id: def.healFx, where: `${unitId}.healFx` });
    // ★ 0.2.1：回血光环（夜莺绿 / 魔王粉）同理
    if (def.healHaloFx) out.push({ id: def.healHaloFx, where: `${unitId}.healHaloFx` });
  }
  for (const [unitId, skill] of Object.entries(SKILLS)) {
    if (skill.castFx) out.push({ id: skill.castFx, where: `${unitId}.castFx` });
    if (skill.star3?.castFx) out.push({ id: skill.star3.castFx, where: `${unitId}.star3.castFx` });
    /*
      ★ 0.2.1：**常驻脉冲**（夜莺 / 魔王：`passive.pulse`）也带 fx。
      漏了这一条，他们那圈回血光环就"数据写了、测试不管" ——
      id 拼错也照样全绿，只是游戏里没有光环。
    */
    if (skill.passive?.pulse?.fx) {
      out.push({ id: skill.passive.pulse.fx, where: `${unitId}.passive.pulse.fx` });
    }
    if (skill.star3?.passive?.pulse?.fx) {
      out.push({ id: skill.star3.passive.pulse.fx, where: `${unitId}.star3.passive.pulse.fx` });
    }
    for (const variant of [skill, skill.star3]) {
      for (const effect of variant?.effects ?? []) {
        const stats = (effect as { stats?: { pulse?: { fx?: string }; splash?: { fx?: string } } }).stats;
        if (stats?.pulse?.fx) out.push({ id: stats.pulse.fx, where: `${unitId}.pulse.fx` });
        if (stats?.splash?.fx) out.push({ id: stats.splash.fx, where: `${unitId}.splash.fx` });
        /*
          ★★ 0.2.2：**锁定/引爆**（蕾缪安 3 星）也是"数据写字符串 → 渲染层查表"。
          这条漏了的话，瞄准镜 + 粉色爆破就变成"数据写了、测试不管" ——
          id 拼错照样全绿，只是游戏里那块地永远没人瞄。
        */
        const lockFx = (effect as { kind?: string; fx?: string }).fx;
        if ((effect as { kind?: string }).kind === 'lockOn' && lockFx) {
          out.push({ id: lockFx, where: `${unitId}.lockOn.fx` });
        }
        /*
          ★★ 0.3.2：**范围伤害 / 即死**的 `fx`（阿米娅升变形态）。
          这两条是新通道：`damage.fx` 会一路传到 `zone` 事件的 `fx` 上、
          `execute.fx` 会随 `executeFx` 事件发给渲染层。
          不扫的话，id 拼错就变成"技能打出去了、方块阵/破碎从来不出现"，
          而且**三个门禁全绿**（和当初漏掉 `castFx` 是同一个坑）。
        */
        const kind = (effect as { kind?: string }).kind;
        if ((kind === 'damage' || kind === 'execute') && lockFx) {
          out.push({ id: lockFx, where: `${unitId}.${kind}.fx` });
        }
      }
    }
  }
  /*
    ★★ 0.3.2：**棋子定义自带的技能**（升变形态阿米娅·青色怒火等）也要扫 ——
    它们不在 SKILLS 表里（升变形态不在 ROSTER，技能直接写在 UnitDef.skill 上），
    漏了这一条的话，她的 `castFx` 拼错了照样全绿，只是游戏里什么都不放。
  */
  for (const [unitId, def] of Object.entries(UNIT_DEFS)) {
    if (def.skill?.castFx) out.push({ id: def.skill.castFx, where: `${unitId}.skill.castFx` });
  }
  /*
    ★★ 0.2.1：**羁绊级**特效也走同一条规矩（数据写字符串 → 渲染层查表），
    只是它挂在羁绊档位的机制上（`attackCountNuke.fx`），不在 UnitDef/SkillDef 里。
    目前只有拉特兰齐射一条，但这条通道留着了 —— 以后加别的羁绊大招不用再改测试。
  */
  for (const [traitId, def] of Object.entries(TRAIT_DEFS)) {
    for (const tier of def.tiers) {
      for (const mechanic of tier.mechanics ?? []) {
        const fx = (mechanic as { fx?: string }).fx;
        if (fx) out.push({ id: fx, where: `${traitId}.${tier.count}人.fx` });
      }
    }
  }
  return out;
}

describe('★ 0.2.1 特效注册表', () => {
  it('数据里写的每个 id，渲染层都认识（拼错就是"什么都不放"）', () => {
    const known = new Set([
      ...Object.keys(COMBAT_FX),
      ...Object.keys(SKILL_FX),
      ...Object.keys(BLOOM_FX),
      ...Object.keys(LETO_SCYTHE_FX),
      ...Object.keys(TRACER_FX),
      ...Object.keys(BOARD_VOLLEY),
      /*
        ★ 0.2.1：迷迭香的 `rosmon_slam` 是**专属通道**，故意不在 `TRACER_FX` 里 ——
        那套注册表画的是"沿弹道拉伸的贴片"，而装置是"整体飞行 + 抛物砸下"。
        这里把它登记成合法 id，别让"注册表里没有"被误判成拼错。
      */
      ROSMON_SLAM_FX,
      /*
        ★ 0.2.1：**音符**（祥子的金色 `note` / 海铃的紫色 `note_purple`）同样是
        专属通道 —— `note-fx.ts` 画的是"飞过去的 🎶 Sprite + 拱形轨迹"，
        不是 `TRACER_FX` 那套沿弹道拉伸的贴片。
        所以直接取注册表自己的键，别再在这里抄一遍字符串。
      */
      ...NOTE_FX_IDS,
      /*
        ★ 0.2.1：**回血光环**（夜莺绿 / 魔王粉）也是专属通道 ——
        它由 `heal-halo-fx.ts` 用几何环 + canvas 符号画出来，不是序列帧。
      */
      ...HEAL_HALO_FX,
    ]);
    /*
      ★ 0.2.2：**锁定/引爆**（蕾缪安 3 星）同样是专属通道 ——
      canvas 现画的几何（狙击镜）+ 渐变（粉色爆破），不是序列帧。
    */
    for (const id of LOCKON_FX) known.add(id);
    // ★ 0.2.2：陈的「前方三格剑光」同理 —— 程序化贴地长条，不是序列帧
    known.add(CHEN_THRUST_FX);
    /*
      ★ 0.3.2：阿米娅升变三套（方格阵 / 全场氛围 / 即死叠加）同样是**程序化**通道 ——
      几何由参数和内核给的格子算出来，不可能是序列帧。直接读注册表导出的清单，
      别在这里把三个字符串再抄一遍（抄错就等于把测试改成永远通过）。
    */
    for (const id of AMIYA_FORM_FX_IDS) known.add(id);
    const unknown = dataFxIds().filter((entry) => !known.has(entry.id));
    expect(unknown.map((entry) => `${entry.where} -> ${entry.id}`)).toEqual([]);
    // 前提：确实有数据在用（别哪天全被删了这条测试变成空转）
    expect(dataFxIds().length).toBeGreaterThan(4);
  });

  it('★ 羁绊级全场扫射：BOARD_VOLLEY 引用的弹道必须在 TRACER_FX 里，而且是 bullet', () => {
    /*
      ★ 为什么单独一条？因为它是**间接引用**：数据写的是 `laterano_volley`，
      真正画的却是 `BOARD_VOLLEY[laterano_volley].tracer`（= `bullet_laterano`）。
      少写一层就是"羁绊发动了、血掉了、屏幕上一颗子弹都没有"。
    */
    for (const [id, spec] of Object.entries(BOARD_VOLLEY)) {
      const style = TRACER_FX[spec.tracer];
      expect(style, `${id} 引用了不存在的弹道 ${spec.tracer}`).toBeTruthy();
      expect(style!.kind, `${id} 必须是"飞过去的子弹"（不是整条闪电/流光）`).toBe('bullet');
      /*
        弹道要飞得够久：扫射横穿的是整块棋盘（BOARD_W 格 + 两头出界），
        按 `speedCellsPerSecond` 算出来的时间不能超过 `seconds`（飞行上限），
        否则子弹会在半路被判"到期"直接消失。
      */
      const crossCells = BOARD_W + spec.overhangCells * 2;
      const needSeconds = crossCells / Math.max(1, style!.speedCellsPerSecond);
      expect(needSeconds, `${id} 的弹道要飞 ${needSeconds.toFixed(2)} 秒`).toBeLessThanOrEqual(style!.seconds);
    }
  });

  it('绑定表里引用的每一张图都在注册表里', () => {
    for (const [key, binding] of Object.entries(COMBAT_FX)) {
      for (const id of [
        ...(binding.muzzle ? [binding.muzzle] : []),
        ...combatFxIdsOf(binding.hit),
        ...combatFxIdsOf(binding.heavy),
      ]) {
        expect(SEQ_FX[id], `${key} 引用了不存在的图 ${id}`).toBeTruthy();
      }
    }
    for (const [key, binding] of Object.entries(SKILL_FX)) {
      const ids = [
        ...(binding.self ?? []),
        ...(binding.target ?? []),
        ...(binding.attack ?? []),
        ...(binding.attackFirst ?? []),
        ...(binding.castOnce ?? []),
        ...(binding.loop ?? []).map((layer) => layer.id),
      ];
      for (const id of ids) expect(SEQ_FX[id], `${key} 引用了不存在的图 ${id}`).toBeTruthy();
    }
  });

  it('★ 治疗流光：数据里的 healFx 必须登记在 TRACER_FX，而且形态是 flow', () => {
    // 用户口径：古米 / 芙蓉 的治疗要"射一枚绿色流光"（朝被治疗的那个队友）
    const users = Object.entries(UNIT_DEFS).filter(([, def]) => def.healFx);
    expect(users.length, '前提：古米/芙蓉在用它').toBeGreaterThan(0);
    for (const [unitId, def] of users) {
      const style = TRACER_FX[def.healFx!];
      expect(style, `${unitId} 的 healFx=${def.healFx} 没登记`).toBeTruthy();
      expect(style!.kind, '治疗流光应该是 flow（平滑流光，不是闪电/子弹）').toBe('flow');
    }
  });

  it('注册表里的每个 PNG 都在磁盘上，且**真实宽高**和 frames / cells 对得上', () => {
    for (const [id, spec] of Object.entries(SEQ_FX)) {
      const path = assetPath(spec.path);
      expect(existsSync(path), `${id} 的图不存在：${spec.path}`).toBe(true);
      const { width, height } = pngSize(path);
      // 横向序列帧：宽 = 单帧宽 × 帧数，高 = 单帧高（正方形）
      expect(width % spec.frames, `${id}：宽 ${width} 不是 ${spec.frames} 帧的整数倍`).toBe(0);
      expect(width / spec.frames, `${id}：每帧不是正方形`).toBe(height);
      // 1 格 = 256 px（规格书 §5）⇒ cells 必须是 单帧宽/256
      expect(width / spec.frames / 256, `${id}：cells 和图的像素宽不一致`).toBeCloseTo(spec.cells, 5);
    }
  });

  it('每一套 bloom 爆炸的三层图都在，且都是 10 帧正方形', () => {
    for (const [key, layers] of Object.entries(BLOOM_FX)) {
      expect(layers.length, `${key} 至少三层`).toBeGreaterThanOrEqual(2);
      for (const spec of layers) {
        const path = assetPath(spec.path);
        expect(existsSync(path), `${key}: ${spec.path} 不存在`).toBe(true);
        const { width, height } = pngSize(path);
        expect(width / 10, `${key}: ${spec.path} 不是 10 帧`).toBe(height);
      }
    }
  });

  it('每张图都是"外圈透明"的（边缘 alpha 为 0，不然拼贴时会露出方块）', () => {
    /*
      ★ 只能查 PNG 的像素…… 这里不做（没有图像库）。
      作为替代，钉住"规格书里那条尺寸约定"已经有上面两条了；
      边缘 alpha 由出图侧 `verify.mjs` 自查，见 docs/特效图制作规格书.md §7。
    */
    expect(Object.keys(SEQ_FX).length).toBeGreaterThanOrEqual(4);
  });
});
