#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
把 Q 版小人的渲染帧裁成棋子的**卡面立绘**。

============================================================
  什么时候需要它？
============================================================
官方立绘（`scripts/fetch-portraits.ts` 从 prts 抓的「半身像_」「头像_」）
只覆盖**图鉴里有立绘的干员**。有些棋子本来就没有：

  · 敌方 Boss 当棋子用（阿米娅的升变终态「炉芯终曲」= `enemy_2092_skzamy`）；
  · 召唤物 / 装置；
  · 彩蛋棋子（用的是别人的皮肤）。

这些棋子如果 `assets/units/<id>.png` 和 `assets/stand/<id>.png` 都不存在，
界面会退到"程序化占位色块"（棋盘立绘三级降级的最后一级）——
看起来就像"这棋子没做美术"。所以从已经渲染好的 Q 版小人里裁一张出来。

============================================================
  输出规格（必须和 fetch-portraits 一致，别自己发明尺寸）
============================================================
  assets/units/<id>.png   180×180   卡面 / 备战席 / 顶栏头像（正方形）
  assets/stand/<id>.png   180×360   棋盘立绘（竖长）

============================================================
  用法
============================================================
  python scripts/chibi-portrait.py --only op_amiya_core
  python scripts/chibi-portrait.py --all-missing          # 所有缺立绘的棋子
  python scripts/chibi-portrait.py --only x --force       # 覆盖已有文件

★ 默认**跳过已有文件**：官方立绘永远比 Q 版截的好，不能顺手覆盖掉。
★ 需要 Pillow（用系统那个 Python 3.14，`.workbuddy/binaries` 里的没有）。
"""
import argparse
import io
import json
import os
import sys

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
ASSETS = os.path.join(ROOT, 'apps', 'web', 'public', 'assets')
CHIBI = os.path.join(ASSETS, 'chibi')

UNIT_SIZE = 180
STAND_W, STAND_H = 180, 360

# 透明像素的判定阈值：低于它的当成"没画东西"。
# 别用 0 —— spine 渲染出来的边缘有一圈 alpha=1~3 的杂点，会把 bbox 撑到整格。
ALPHA_MIN = 8


def alpha_bbox(images):
    """所有帧的并集包围盒（用并集而不是第一帧：披风/武器会飘，单帧会切掉）"""
    box = None
    for im in images:
        b = im.split()[3].point(lambda v: 255 if v >= ALPHA_MIN else 0).getbbox()
        if not b:
            continue
        box = b if box is None else (
            min(box[0], b[0]), min(box[1], b[1]),
            max(box[2], b[2]), max(box[3], b[3]),
        )
    return box


def load_idle_cells(def_id):
    """读出 idle 动画的每一帧（横向序列帧，按 cell 尺寸切）"""
    folder = os.path.join(CHIBI, def_id)
    manifest_path = os.path.join(folder, 'manifest.json')
    if not os.path.exists(manifest_path):
        return None, None
    manifest = json.load(io.open(manifest_path, encoding='utf-8'))
    anims = manifest.get('animations') or {}
    # 优先 idle；没有就退到第一个动作（有些敌人骨架没有 Idle）
    key = 'idle' if 'idle' in anims else (next(iter(anims), None))
    if not key:
        return None, manifest
    anim = anims[key]
    strip = Image.open(os.path.join(folder, anim['file'])).convert('RGBA')
    cw = manifest['cell']['w']
    ch = manifest['cell']['h']
    frames = min(int(anim.get('frames', 1)), strip.width // cw)
    cells = [strip.crop((i * cw, 0, (i + 1) * cw, ch)) for i in range(max(1, frames))]
    return cells, manifest


def fit(img, box_w, box_h):
    """等比缩放到能**放得下**的最大尺寸（contain：整只都在画面里）"""
    scale = min(box_w / img.width, box_h / img.height)
    w = max(1, round(img.width * scale))
    h = max(1, round(img.height * scale))
    return img.resize((w, h), Image.LANCZOS)


def fit_cover(img, box_w, box_h):
    """
    等比放大到**铺满**整个框（cover：多出来的部分裁掉）。

    ★ 棋盘立绘要的是"半身像"效果 —— 用 contain 的话 Q 版全身塞进 1:2 的画布里
      只有一半高，站在格子上会是个小矮人，和别的棋子的半身像完全不在一个观感上。
    """
    scale = max(box_w / img.width, box_h / img.height)
    w = max(1, round(img.width * scale))
    h = max(1, round(img.height * scale))
    scaled = img.resize((w, h), Image.LANCZOS)
    left = max(0, (w - box_w) // 2)
    top = max(0, (h - box_h) // 2)
    return scaled.crop((left, top, left + box_w, top + box_h))


def compose(cell_box, canvas_w, canvas_h, max_w, max_h, pad_bottom, cover=False):
    """
    把裁出来的人物放进画布：等比缩放 → 水平居中 → **脚底对齐**。
    脚底对齐很关键：棋盘上一排棋子是站在同一条线上的，
    按垂直居中的话高的矮的会像在飘。

    cover=True 时忽略 pad_bottom（铺满整块画布）。
    """
    art = fit_cover(cell_box, canvas_w, canvas_h) if cover else fit(cell_box, max_w, max_h)
    canvas = Image.new('RGBA', (canvas_w, canvas_h), (0, 0, 0, 0))
    if cover:
        canvas.alpha_composite(art, (0, 0))
        return canvas
    x = (canvas_w - art.width) // 2
    y = canvas_h - pad_bottom - art.height
    canvas.alpha_composite(art, (max(0, x), max(0, y)))
    return canvas


def build(def_id, force=False):
    cells, _manifest = load_idle_cells(def_id)
    if not cells:
        print(f'  - {def_id}: 没有小人素材（跳过）')
        return False

    box = alpha_bbox(cells)
    if not box:
        print(f'  - {def_id}: idle 全透明（跳过）')
        return False

    unit_path = os.path.join(ASSETS, 'units', f'{def_id}.png')
    stand_path = os.path.join(ASSETS, 'stand', f'{def_id}.png')

    made = []
    if force or not os.path.exists(unit_path):
        # ★ 卡面（units）= **头肩特写**，铺满正方形。
        #   理由：卡面框是个小方块，其他棋子那里放的都是官方半身像（头+肩占满）；
        #   塞一整只小人进去会变成"小矮人站中间"，一排卡面里一眼就看出来不搭。
        #   但 Q 版的分辨率只有 ~140px 宽，铺满 180 会轻微发虚 —— 这是素材上限，
        #   所以**不放大到 360**（棋盘立绘那边就用整只，见下）。
        #   ★ 裁切基准用**第 0 帧自己的框**，不用全部帧的并集：
        #     并集会被别的帧的飘带/特效撑高，起点一高就裁到第一帧头顶上面的空气。
        first = alpha_bbox([cells[0]]) or box
        top = first[1]
        cut = top + round((first[3] - first[1]) * 0.60)
        src = cells[0].crop((first[0], top, first[2], cut))
        compose(src, UNIT_SIZE, UNIT_SIZE, UNIT_SIZE, UNIT_SIZE, 0, cover=True).save(unit_path)
        made.append('units')
    if force or not os.path.exists(stand_path):
        # ★ 棋盘立绘（stand）= **整只**，等比放得下就好，脚底对齐。
        #   这里刻意不用 cover：放大 3 倍去填 1:2 的画布会糊成一片（实测过），
        #   而棋盘上那一格本来也不大，整只小人的辨识度比"填满"重要。
        src = cells[0].crop(box)
        compose(src, STAND_W, STAND_H, STAND_W - 10, STAND_H - 12, 6).save(stand_path)
        made.append('stand')

    print(f'  ✓ {def_id}: {", ".join(made) if made else "已有，跳过"}')
    return True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--only', default='', help='逗号分隔的棋子 id')
    ap.add_argument('--all-missing', action='store_true', help='所有有人物素材但缺立绘的棋子')
    ap.add_argument('--force', action='store_true', help='覆盖已有文件')
    args = ap.parse_args()

    ids = [x for x in args.only.split(',') if x]
    if not ids and args.all_missing:
        if not os.path.isdir(CHIBI):
            sys.exit('找不到 apps/web/public/assets/chibi')
        ids = sorted(
            d for d in os.listdir(CHIBI)
            if os.path.isdir(os.path.join(CHIBI, d))
            and os.path.exists(os.path.join(CHIBI, d, 'manifest.json'))
        )
    if not ids:
        sys.exit('没指定棋子：用 --only <id> 或 --all-missing')

    os.makedirs(os.path.join(ASSETS, 'units'), exist_ok=True)
    os.makedirs(os.path.join(ASSETS, 'stand'), exist_ok=True)
    print(f'从 Q 版小人裁立绘：{len(ids)} 个')
    ok = sum(1 for d in ids if build(d, args.force))
    print(f'完成 {ok} / {len(ids)}')


if __name__ == '__main__':
    main()
