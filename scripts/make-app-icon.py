#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
生成游戏图标（`apps/web/public/favicon.ico` + `apple-touch-icon.png`）。

============================================================
  为什么需要它？（0.3.3）
============================================================
启动器改成用 **Edge/Chrome 的 `--app` 模式**开一个独立窗口之后，
窗口标题栏和任务栏的图标来自**网页的 favicon** —— 没有 favicon 就是
Chromium 那个默认的灰地球，一眼又变回"网页"。
所以这里出两枚：

  · `favicon.ico`          —— 多尺寸（16/24/32/48/64/128/256），Windows 任务栏/标题栏用；
  · `apple-touch-icon.png` —— 180×180，顺手给"添加到桌面"用。

============================================================
  图案口径
============================================================
黑底 + 荧光黄绿（`#C9FA43`，和界面里的系统高亮同一个色）+ 一个「失」字：
    · 16px 下也要认得出来 ⇒ 只有**一个字 + 一圈框**，不放任何小细节；
    · 框画成四条边各自留缺口（十字准星语汇），和游戏界面的图形语言一致；
    · 字用微软雅黑 Bold（系统里一定有）；取不到就退回纯几何图形（不留白板）。

用法：
  python scripts/make-app-icon.py
"""
import os

from PIL import Image, ImageDraw, ImageFont

# ---- 品牌色（和 theme-ark.css 的 --hl / --bg 对齐，改那边记得改这里）----
BG = (10, 12, 15)
HL = (201, 250, 67)

OUT_DIR = os.path.join(os.path.dirname(__file__), '..', 'apps', 'web', 'public')
SIZES = [16, 24, 32, 48, 64, 128, 256]

# 微软雅黑的几个常见落点（Windows 一定有其中一个）
FONT_CANDIDATES = [
    r'C:\Windows\Fonts\msyhbd.ttc',
    r'C:\Windows\Fonts\msyh.ttc',
    r'C:\Windows\Fonts\simhei.ttf',
]


def load_font(px: int) -> ImageFont.FreeTypeFont | None:
    for path in FONT_CANDIDATES:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, px)
            except OSError:
                continue
    return None


def draw_icon(size: int) -> Image.Image:
    """
    按目标尺寸现画（不是把 256 缩小 —— 16px 缩小会糊成一团）。

    ★ 边距、线宽、字号全部按比例算，所以每个尺寸都是"同一张图的不同大小"。
    """
    # 4 倍超采样后缩小：小尺寸下边缘才不抖
    scale = 4
    s = size * scale
    img = Image.new('RGBA', (s, s), BG + (255,))
    d = ImageDraw.Draw(img)

    # ---- 1. 四角框（每条边各留一个缺口，读作"取景框 / 十字准星"）----
    pad = round(s * 0.10)
    gap = round(s * 0.16)
    lw = max(scale, round(s * 0.035))
    corners = [
        # (起点, 终点)
        ((pad, pad), (s - pad, pad)),          # 上
        ((pad, s - pad), (s - pad, s - pad)),  # 下
        ((pad, pad), (pad, s - pad)),          # 左
        ((s - pad, pad), (s - pad, s - pad)),  # 右
    ]
    for (x0, y0), (x1, y1) in corners:
        if y0 == y1:  # 横线：从两端各缩进 gap
            d.line([(x0, y0), (x0 + gap, y0)], fill=HL, width=lw)
            d.line([(x1 - gap, y1), (x1, y1)], fill=HL, width=lw)
        else:  # 竖线
            d.line([(x0, y0), (x0, y0 + gap)], fill=HL, width=lw)
            d.line([(x1, y1 - gap), (x1, y1)], fill=HL, width=lw)

    # ---- 2. 「失」字 ----
    font = load_font(round(s * 0.52))
    if font is not None:
        d.text((s / 2, s / 2), '失', font=font, fill=HL, anchor='mm')
    else:
        # 取不到字体也别留白板：画一个实心菱形（方舟那套图形语汇里最基础的一个）
        r = s * 0.22
        cx = cy = s / 2
        d.polygon([(cx, cy - r), (cx + r, cy), (cx, cy + r), (cx - r, cy)], fill=HL)

    return img.resize((size, size), Image.LANCZOS)


def main() -> None:
    frames = [draw_icon(size) for size in SIZES]
    ico_path = os.path.join(OUT_DIR, 'favicon.ico')
    frames[-1].save(ico_path, format='ICO', sizes=[(s, s) for s in SIZES])
    print(f'ok {ico_path}  ({", ".join(str(s) for s in SIZES)})')

    touch_path = os.path.join(OUT_DIR, 'apple-touch-icon.png')
    draw_icon(180).save(touch_path, format='PNG')
    print(f'ok {touch_path} (180x180)')

    # 顺手出一张 256 的 PNG，方便在文档/商店页里直接用
    preview_path = os.path.join(OUT_DIR, 'app-icon.png')
    frames[-1].save(preview_path, format='PNG')
    print(f'ok {preview_path} (256x256)')


if __name__ == '__main__':
    main()
