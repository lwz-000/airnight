#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
把现有的特效贴图**按原形状重新上色**（不重画）。

============================================================
  为什么是"改色"而不是"重画"？
============================================================
项目里的斩击贴图（`slash_single` / `slash_red` / `slash_gold`）本来就是
**同一套形状、只换配色**（尺寸和帧数完全一致，`fx-registry.test.ts` 钉着）。
新做一套特效如果重新画弧线，很难和现有的手感对齐（粗细、弧度、帧数都要重新调）；
而"读旧图 → 按亮度重新映射颜色"可以保证**逐像素一致**，只换色。

============================================================
  两种上色模式（对应两种混合方式）
============================================================
· `add`   —— **加色混合**（`AdditiveBlending`）。黑在这里是不可见的，
             所以只能是"某种颜色 × 原图强度"。用于青色 / 红色这类发光层。
· `ink`   —— **普通混合**（`NormalBlending`）。这才是"能看见的黑"：
             底色填深墨，只让原图最强的那一小撮像素透出一点冷色边，
             于是看起来是"一块黑墨 + 冷光刃口"。纯黑在加色下什么都不是，
             这就是为什么黑色特效必须走这一档（见 MEMORY-特效.md 第 7 节）。

============================================================
  ★ "强度"从哪来？（`--by`，这是三色分层的关键）
============================================================
这套斩击图（`slash_*`）的**形状与浓淡全在 alpha 里**，RGB 基本已经是饱和的近白
（实测 43% 的可见像素亮度 > 0.9）—— 所以按亮度分层切不出层次。
改按 **alpha** 分层后，同一个形状被切成**嵌套的三档**：
    · 整片 alpha        → 黑墨主体（普通混合，铺面，给"这一刀的重量"）
    · alpha^1.6         → 青色刃口（加色，勾边，让黑刃在暗棋盘上看得见）
    · alpha^3.2         → 红色爆点（加色，只有最浓的那一点芯，"怒火"）
三档共用**同一条刀的形状**，只是各占一段浓度 ⇒ 天生协调，不会互相打架。

用法：
  python scripts/fx-recolor.py add  apps/web/public/assets/fx/slash_single.png \
      apps/web/public/assets/fx/slash_cyan.png   "#3fd8ff" --gamma=1.6
  python scripts/fx-recolor.py ink  .../slash_single.png .../slash_black.png \
      "#05070b" --rim="#2ec8f0" --gamma=1.4 --by=alpha

★ 需要 Pillow（用系统那个 Python 3.14）。
"""
import argparse
import sys

from PIL import Image


def parse_hex(text: str) -> tuple[int, int, int]:
    value = text.strip().lstrip('#')
    if len(value) != 6:
        raise SystemExit(f'颜色要写成 #rrggbb：{text}')
    return int(value[0:2], 16), int(value[2:4], 16), int(value[4:6], 16)


def recolor_add(
    image: Image.Image,
    color: tuple[int, int, int],
    gamma: float,
    gain: float,
    by: str,
) -> Image.Image:
    """
    加色层：`rgb = 颜色 × (强度^gamma) × gain`，alpha 原样保留。

    ★ alpha 必须保留：原图的 alpha 就是"这一帧的形状"（弧线在哪里、有多粗）。
      把它抹平成 1 会让整块矩形都亮起来。
    """
    pixels = image.load()
    width, height = image.size
    for y in range(height):
        for x in range(width):
            r, g, b, a = pixels[x, y]
            if a == 0:
                continue
            lum = max(r, g, b) / 255.0
            k = (intensity_of(lum, a / 255.0, by) ** gamma) * gain
            pixels[x, y] = (
                min(255, int(color[0] * k)),
                min(255, int(color[1] * k)),
                min(255, int(color[2] * k)),
                a,
            )
    return image


def intensity_of(lum: float, alpha: float, by: str) -> float:
    """
    这一像素的"强度"⇒ 决定它落到哪一档颜色里。

    ★ 默认 `alpha`：这些特效图的浓淡是 alpha 画的（RGB 早就饱和成近白了），
      按亮度切等于全图一档。见文件头的说明。
    """
    if by == 'lum':
        return lum
    if by == 'both':
        return lum * alpha
    return alpha


def recolor_ink(
    image: Image.Image,
    base: tuple[int, int, int],
    rim: tuple[int, int, int],
    gamma: float,
    rim_gain: float,
    alpha_scale: float,
    by: str,
    alpha_gamma: float,
) -> Image.Image:
    """
    普通混合层（"能看见的黑"）：底色是深墨，只有原图**最浓**的那部分透出冷色边。

    `gamma` 越大 -> 亮边越窄（越像"硬边墨块"）；越小 -> 亮边越宽（越像烟雾）。
    `alpha_gamma` < 1 时把半透明部分补满 —— 黑身太淡就调它（加色层不用这参数）。
    """
    pixels = image.load()
    width, height = image.size
    for y in range(height):
        for x in range(width):
            r, g, b, a = pixels[x, y]
            if a == 0:
                continue
            lum = max(r, g, b) / 255.0
            # 亮边强度：只有最浓的那一缕才给颜色，其余一律吃墨
            edge = intensity_of(lum, a / 255.0, by) ** gamma
            out_a = a / 255.0
            if alpha_gamma != 1.0:
                out_a = out_a ** alpha_gamma
            pixels[x, y] = (
                min(255, int(base[0] + rim[0] * edge * rim_gain)),
                min(255, int(base[1] + rim[1] * edge * rim_gain)),
                min(255, int(base[2] + rim[2] * edge * rim_gain)),
                max(0, min(255, int(out_a * alpha_scale * 255))),
            )
    return image


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('mode', choices=['add', 'ink'])
    ap.add_argument('src')
    ap.add_argument('dst')
    ap.add_argument('color', help='add 模式=发光色；ink 模式=墨底色')
    ap.add_argument('--rim', default='#ffffff', help='ink 模式的亮边颜色')
    ap.add_argument('--gamma', type=float, default=1.0)
    ap.add_argument('--gain', type=float, default=1.0, help='add 模式的整体亮度倍数')
    ap.add_argument('--rim-gain', type=float, default=1.0)
    ap.add_argument('--alpha-scale', type=float, default=1.0)
    ap.add_argument(
        '--alpha-gamma',
        type=float,
        default=1.0,
        help='输出 alpha = 原 alpha^此值（<1 补满淡部，墨层黑身太淡时用）',
    )
    ap.add_argument(
        '--by',
        choices=['alpha', 'lum', 'both'],
        default='alpha',
        help='按什么当"强度"分层（默认 alpha —— 特效图的浓淡画在 alpha 里）',
    )
    args = ap.parse_args()

    image = Image.open(args.src).convert('RGBA')
    if args.mode == 'add':
        out = recolor_add(image, parse_hex(args.color), args.gamma, args.gain, args.by)
    else:
        out = recolor_ink(
            image,
            parse_hex(args.color),
            parse_hex(args.rim),
            args.gamma,
            args.rim_gain,
            args.alpha_scale,
            args.by,
            args.alpha_gamma,
        )
    out.save(args.dst)
    print(f'ok {args.dst} {out.size[0]}x{out.size[1]} ({args.mode})')


if __name__ == '__main__':
    main()
