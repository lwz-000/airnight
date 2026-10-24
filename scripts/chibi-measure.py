#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
量一下每个干员小人在自己的设计框里占了多大、有没有被画布切边。

为什么需要这个：小人是从 Spine 骨架离线画出来的，取景是靠"量像素"自动对齐的。
自动的东西就一定会有一两个偏的，肉眼看 49 张图很费劲，所以让脚本把
「内容高度 / 设计框高度」算出来，偏小的、贴边的、空的一眼就能挑出来。

【两个尺寸别搞混，这是这份脚本最容易写错的地方】
  · cell = 画布（PNG 单格的像素尺寸）。它是**裁剪边界**，贴到它才算真被切。
  · box  = 设计框（画布内一块区域，一一对应卡片上的立绘区）。
    它才是"卡片上看起来多大"的基准 —— 高度占比要按 box 算，
    按 cell 算的话，画布为了装溢出动作撑大的干员会被误判成"偏小"。

用法：
    python scripts/chibi-measure.py                # 看汇总
    python scripts/chibi-measure.py --detail       # 每个干员逐动作列出来
    python scripts/chibi-measure.py --tag op07     # 只看某个干员
"""

import json
import os
import sys
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHIBI = os.path.join(ROOT, "apps", "web", "public", "assets", "chibi")

# 判定阈值
OK_LOW, OK_HIGH = 0.72, 0.99   # 待机高度占比落在这个区间算合适（相对设计框）
EDGE = 1                       # 内容离画布边 < 这个像素数就算"贴边"（可能被切）
EMPTY_INK = 12                 # 单帧不透明像素少于这个数算空帧


def alpha_bbox(im):
    """返回 (l, t, r, b, ink)，全透明返回 None。

    【阈值必须和渲染器一致（alpha > 8）】
    不能直接用 `a.getbbox()` —— 那是"alpha > 0"，会把 alpha=1~8 的
    抗锯齿边缘也算成内容。渲染器量盒子时用的是 alpha > 8，
    两边口径不一致的话，这份脚本会**虚报一大片"贴边"**：
    明明只是几层几乎看不见的羽化像素蹭到了边，却报成"被裁切了"。
    """
    if im.mode != "RGBA":
        im = im.convert("RGBA")
    a = im.getchannel("A")
    mask = a.point(lambda v: 255 if v > 8 else 0)
    bbox = mask.getbbox()
    if bbox is None:
        return None
    ink = sum(mask.crop(bbox).histogram()[255:])
    return (bbox[0], bbox[1], bbox[2], bbox[3], ink)


def analyse(def_id, detail=False):
    d = os.path.join(CHIBI, def_id)
    mf = os.path.join(d, "manifest.json")
    if not os.path.exists(mf):
        return None
    with open(mf, encoding="utf-8") as f:
        man = json.load(f)
    cw, ch = man["cell"]["w"], man["cell"]["h"]
    box = man.get("box") or {"x": 0, "y": 0, "w": cw, "h": ch}
    bw, bh = box["w"], box["h"]

    rows = []
    idle_box = None
    union = None
    for anim, meta in man["animations"].items():
        png = os.path.join(d, meta["file"])
        if not os.path.exists(png):
            continue
        n = int(meta["frames"])
        ua = None
        with Image.open(png) as im:
            for i in range(n):
                fr = im.crop((i * cw, 0, (i + 1) * cw, ch))
                bb = alpha_bbox(fr)
                if bb is None:
                    continue
                l, t, r, b, ink = bb
                # 贴边按**画布**算（画布外没有像素，贴着就是被切了）
                touch = l <= EDGE or t <= EDGE or r >= cw - EDGE or b >= ch - EDGE
                rows.append((anim, i, l, t, r - l, b - t, ink, touch, ink < EMPTY_INK))
                if ua is None:
                    ua = [l, t, r, b]
                else:
                    ua = [min(ua[0], l), min(ua[1], t), max(ua[2], r), max(ua[3], b)]
        # 动作盒换算到**设计框坐标**，并集与占比都按设计框算
        if ua:
            ab = [ua[0] - box["x"], ua[1] - box["y"], ua[2] - ua[0], ua[3] - ua[1]]
            if anim == "idle":
                idle_box = ab
            if union is None:
                union = list(ab)
            else:
                union = [min(union[0], ab[0]), min(union[1], ab[1]),
                         max(union[2], ab[0] + ab[2]), max(union[3], ab[1] + ab[3])]

    if union is None or not rows:
        return {"defId": def_id, "empty": True, "cell": (cw, ch), "box": (bw, bh), "rows": rows}

    ul, ut = union[0], union[1]
    uw, uh = union[2] - ul, union[3] - ut
    iw, ih = (idle_box[2], idle_box[3]) if idle_box else (uw, uh)
    return {
        "defId": def_id,
        "empty": False,
        "cell": (cw, ch),
        "box": (bw, bh),
        "union": (ul, ut, uw, uh),
        "idle": (iw, ih),
        "hRatio": ih / bh,          # 待机高度占设计框高度 = 卡片上的大小
        "wRatio": iw / bw,
        "uRatioH": uh / bh,
        "touch": any(r[7] for r in rows),
        "blank": any(r[8] for r in rows),
        "frames": len(rows),
        "rows": rows,
    }


def main():
    detail = "--detail" in sys.argv
    tag = None
    if "--tag" in sys.argv:
        tag = sys.argv[sys.argv.index("--tag") + 1]

    if not os.path.isdir(CHIBI):
        print("找不到小人素材目录：" + CHIBI)
        return 1

    def_ids = sorted(x for x in os.listdir(CHIBI)
                     if x.startswith("op") and os.path.isdir(os.path.join(CHIBI, x)))
    if tag:
        def_ids = [x for x in def_ids if tag in x]

    results = []
    for did in def_ids:
        r = analyse(did)
        if r:
            results.append(r)

    if not results:
        print("没有可分析的小人。")
        return 1

    if detail:
        for r in results:
            print(f"\n{r['defId']}  画布 {r['cell'][0]}×{r['cell'][1]}  设计框 {r['box'][0]}×{r['box'][1]}  帧 {r.get('frames', 0)}")
            if r["empty"]:
                print("   ✗ 整份素材都是空的")
                continue
            ul, ut, uw, uh = r["union"]
            iw, ih = r["idle"]
            print(f"   待机 {iw}×{ih}  占设计框高 {r['hRatio']:.1%}（卡片上就按这个大小）")
            print(f"   全动作并集 设计框坐标 x{ul} y{ut} {uw}×{uh}  （高占 {r['uRatioH']:.1%}）"
                  f"{'  ⚠贴画布边' if r['touch'] else ''}{'  ⚠有空帧' if r['blank'] else ''}")
            for anim, i, l, t, w, h, ink, touch, blank in r["rows"]:
                flags = (" 贴画布边" if touch else "") + (" 空" if blank else "")
                print(f"     {anim:7s} #{i:<2d} x{l:<3d} y{t:<3d} {w}×{h}  ink={ink}{flags}")
        return 0

    small, big, touch, blank = [], [], [], []
    for r in results:
        if r["empty"]:
            print(f"✗ {r['defId']} 空素材")
            continue
        if r["hRatio"] < OK_LOW:
            small.append(r)
        elif r["hRatio"] > OK_HIGH:
            big.append(r)
        if r["touch"]:
            touch.append(r)
        if r["blank"]:
            blank.append(r)

    ratios = sorted(r["hRatio"] for r in results if not r["empty"])
    print(f"共 {len(results)} 个干员小人有素材")
    if ratios:
        med = ratios[len(ratios) // 2]
        print(f"待机高度占设计框：最小 {min(ratios):.1%}  中位 {med:.1%}  最大 {max(ratios):.1%}")
    print(f"合适区间 {OK_LOW:.0%}~{OK_HIGH:.0%}（这一列越齐 = 卡片上一排小人越一样大）")
    print()

    print(f"偏小（<{OK_LOW:.0%}）：{len(small)} 个")
    for r in sorted(small, key=lambda x: x["hRatio"]):
        print(f"  {r['defId']}  {r['hRatio']:.1%}  待机 {r['idle'][0]}×{r['idle'][1]}")
    print()
    print(f"偏大/可能溢出（>{OK_HIGH:.0%}）：{len(big)} 个")
    for r in sorted(big, key=lambda x: -x["hRatio"]):
        print(f"  {r['defId']}  {r['hRatio']:.1%}  待机 {r['idle'][0]}×{r['idle'][1]}")
    print()
    print(f"贴画布边（真被切了）：{len(touch)} 个  →  {' '.join(r['defId'] for r in touch) if touch else '无'}")
    print(f"有空帧：{len(blank)} 个  →  {' '.join(r['defId'] for r in blank) if blank else '无'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
