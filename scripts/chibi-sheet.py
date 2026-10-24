#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""把每个小人的某个动作拼成一张联络表，方便一眼看取景是否一致。

【为什么每格都要画两个框？】
  · 外框 = 画布（PNG 的单格）。它只保证"动作不被裁"，每个干员大小不一。
  · 内框 = 设计框。它才对应卡片上的立绘区，**所有干员的内框是一样大的** ——
    所以"卡片上一排小人是不是一样大"要看内框，不能看外框。
    第一版没画内框，结果没人看得出画布被撑大过。

用法：
    python scripts/chibi-sheet.py                 # 全部待机，输出 chibi-sheet-idle.png
    python scripts/chibi-sheet.py --anim attack    # 换动作
    python scripts/chibi-sheet.py --tag op12 op02  # 只看几个
    python scripts/chibi-sheet.py --zoom 4         # 放大倍数
"""
import json
import os
import sys
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHIBI = os.path.join(ROOT, "apps", "web", "public", "assets", "chibi")

def arg(name, default=None):
    if f"--{name}" in sys.argv:
        i = sys.argv.index(f"--{name}")
        if i + 1 < len(sys.argv) and not sys.argv[i + 1].startswith("--"):
            return sys.argv[i + 1]
    return default

def main():
    anim = arg("anim", "idle")
    zoom = int(arg("zoom", "3"))
    tags = []
    if "--tag" in sys.argv:
        i = sys.argv.index("--tag")
        tags = [a for a in sys.argv[i + 1:] if not a.startswith("--")]

    def_ids = sorted(x for x in os.listdir(CHIBI)
                     if x.startswith("op") and os.path.isdir(os.path.join(CHIBI, x)))
    if tags:
        def_ids = [d for d in def_ids if d in tags]

    items = []
    for d in def_ids:
        mf = os.path.join(CHIBI, d, "manifest.json")
        if not os.path.exists(mf):
            continue
        with open(mf, encoding="utf-8") as f:
            man = json.load(f)
        meta = man["animations"].get(anim)
        if not meta:
            continue
        cw, ch = man["cell"]["w"], man["cell"]["h"]
        box = man.get("box") or {"x": 0, "y": 0, "w": cw, "h": ch}
        with Image.open(os.path.join(CHIBI, d, meta["file"])) as im:
            fr = im.crop((0, 0, cw, ch)).convert("RGBA")
        items.append((d, fr, cw, ch, box))

    if not items:
        print("没有素材。")
        return 1

    # 画布尺寸每个干员可能不一样，统一按最大的那张摆，各自居中
    maxw = max(i[2] for i in items)
    maxh = max(i[3] for i in items)
    tiles = []
    for d, fr, cw, ch, box in items:
        pad_l = (maxw - cw) // 2
        pad_t = (maxh - ch) // 2
        tile = Image.new("RGBA", (maxw, maxh), (0, 0, 0, 0))
        tile.alpha_composite(fr, (pad_l, pad_t))
        tiles.append((d, tile, cw, ch, box, pad_l, pad_t))

    cols = 10
    rows = (len(tiles) + cols - 1) // cols
    pad = 8
    label_h = 20
    tw = maxw * zoom
    th = maxh * zoom + label_h
    W = cols * tw + (cols + 1) * pad
    H = rows * th + (rows + 1) * pad
    sheet = Image.new("RGBA", (W, H), (245, 246, 248, 255))
    draw = ImageDraw.Draw(sheet)
    for i, (d, tile, cw, ch, box, pad_l, pad_t) in enumerate(tiles):
        r, c = divmod(i, cols)
        x = pad + c * (tw + pad)
        y = pad + r * (th + pad)
        # 格子底：浅色棋盘，方便看透明区
        cell = Image.new("RGBA", (tw, maxh * zoom), (255, 255, 255, 255))
        cd = ImageDraw.Draw(cell)
        step = zoom * 16
        for yy in range(0, maxh * zoom, step):
            for xx in range(0, tw, step):
                if ((xx // step) + (yy // step)) % 2 == 0:
                    cd.rectangle([xx, yy, xx + step - 1, yy + step - 1], fill=(232, 235, 240, 255))
        cell.alpha_composite(tile.resize((tw, maxh * zoom), Image.NEAREST))
        sheet.paste(cell, (x, y))
        # 画布边界（虚线感的浅灰）：每个干员不一样大是正常的
        draw.rectangle([x, y, x + cw * zoom - 1, y + ch * zoom - 1], outline=(120, 190, 120, 255))
        # 设计框边界（红）：这才对应卡片立绘区，**所有干员应该一样大**
        bx0 = x + (pad_l + box["x"]) * zoom
        by0 = y + (pad_t + box["y"]) * zoom
        draw.rectangle([bx0, by0, bx0 + box["w"] * zoom - 1, by0 + box["h"] * zoom - 1],
                       outline=(220, 60, 60, 255))
        draw.text((x + 2, y + maxh * zoom + 4), f"{d} {cw}×{ch}", fill=(30, 34, 40, 255))
    out = os.path.join(ROOT, f"chibi-sheet-{anim}.png")
    sheet.save(out)
    print(f"写出 {out}  ({W}×{H}, {len(tiles)} 个)")
    print(f"格子底 {maxw}×{maxh}（最大画布） 绿框=画布 红框=设计框")
    return 0

if __name__ == "__main__":
    sys.exit(main())
