#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
把发布目录打成 zip（中文文件名不乱码）。

【为什么不用 bsdtar / 7z 命令行？】
`bsdtar` 写进去的文件名按 UTF-8 存但不设 UTF-8 标志位，Windows 资源管理器
解压出来是乱码（这个项目 0.2 踩过）；`7z` 又不一定装在别人的机器上。
Python 的 zipfile 会正确设置 `0x800`（UTF-8）标志，各版本 Windows 都能正确解。

【为什么要先写 .new 再改名？】
打包中途失败（磁盘满、文件被占用）会留下一个**半截 zip** ——
而它看起来和正常的没区别，发出去对方解压到一半报错。
所以：写 `.new` → `testzip()` 全量校验 → `os.replace()` 原子替换。

用法：
  python scripts/zip-release.py <源目录> <目标 zip>
"""
import os
import sys
import zipfile

if len(sys.argv) != 3:
    raise SystemExit('用法：python scripts/zip-release.py <源目录> <目标 zip>')

src = os.path.abspath(sys.argv[1])
dst = os.path.abspath(sys.argv[2])
if not os.path.isdir(src):
    raise SystemExit(f'源目录不存在：{src}')

tmp = dst + '.new'
if os.path.exists(tmp):
    os.remove(tmp)

# ============================================================
#  ★ 这些**运行期文件绝不能进包**（哪怕打包流程顺序变了）
# ============================================================
#  · `.window-profile/` —— 应用窗口的浏览器档案（几百个文件、几十 MB，
#    而且是"这台机器上的窗口位置"，换台机器就是垃圾）
#  · `启动游戏.lnk`    —— 由 .vbs 在**玩家机器上**按当时的绝对路径生成；
#    打包时带一个走，解压到别处就是"指向不存在的目标"
#  · 会话/运行标记/日志 —— 都是本机运行痕迹
SKIP_DIRS = {'.window-profile', '.airnight-run', 'node_modules'}
SKIP_FILES = {
    '启动游戏.lnk',
    '游戏日志.txt',
    '.airnight-run.json',
    '.airnight-session.json',
    '.airnight-closing',
}


def wanted(dirname, name):
    if name in SKIP_DIRS or name in SKIP_FILES:
        return False
    return True

# 压缩级别 6：解压快、体积和 9 差不多（这些文件大多是 png/mp3，本来就是压缩过的）
with zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as z:
    for root, dirs, files in os.walk(src):
        # 就地裁掉要跳过的目录（这样 os.walk 不会往里走）
        dirs[:] = sorted(d for d in dirs if wanted(d, d))
        files.sort()
        for name in files:
            if not wanted(dirname=root, name=name):
                continue
            path = os.path.join(root, name)
            # 归档名带上顶层目录（解压出来就是一个文件夹，不会散一地）
            arc = os.path.relpath(path, os.path.dirname(src)).replace(os.sep, '/')
            z.write(path, arc)

    count = len(z.namelist())

# 全量校验：CRC 不对/文件截断都会在这里暴露
with zipfile.ZipFile(tmp) as z:
    bad = z.testzip()
if bad is not None:
    os.remove(tmp)
    raise SystemExit(f'zip 校验失败：{bad}')

os.replace(tmp, dst)
size_mb = os.path.getsize(dst) / 1024 / 1024
print(f'ok -> {dst}（{count} 个文件，{size_mb:.0f} MB）')
