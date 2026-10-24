# -*- coding: utf-8 -*-
"""
思源黑体子集化（把 17.7 MB 的可变字体裁成 1.9 MB 的 woff2）。

用法：
    python scripts/subset-font.py

依赖：
    pip install fonttools brotli

【为什么需要它】
界面字体是自托管的（`apps/web/public/fonts/NotoSansSC.woff2`），不能靠玩家机器上装没装。
但整个思源黑体 17.7 MB，而游戏实际只用到几千个字 —— 子集化后 1.9 MB。

【什么时候要重跑】
改了界面文案、加了生僻字（比如新干员名里有生僻字）之后如果那片字显示成方框，
重跑一次即可：脚本会重新扫一遍源码里出现的所有字符，再生成一次 woff2。

【字符集怎么定的】
  · ASCII 全部
  · GB2312 全部（6763 汉字 + 全角标点）—— 玩家昵称基本落在这个范围里
  · 常见 UI 符号（★ ● ▲ 箭头等）
  · 源码里出现的所有非 ASCII 字符（兜底干员名/技能描述里的生僻字）
子集里没有的字会回落到系统字体 —— 只是长得不一样，不会变方框。
"""
import os, subprocess, sys
ROOT = r'E:/AIRNIGHT/版本文件/0.3.0测试版'
SRC = r'C:/Windows/Fonts/NotoSansSC-VF.ttf'
OUTDIR = os.path.join(ROOT, 'apps/web/public/fonts')
os.makedirs(OUTDIR, exist_ok=True)

chars = set()
for c in range(0x20, 0x7F):
    chars.add(chr(c))
# GB2312 全部（6763 汉字 + 全角标点）
for hi in range(0xA1, 0xFF):
    for lo in range(0xA1, 0xFF):
        try:
            chars.add(bytes([hi, lo]).decode('gb2312'))
        except Exception:
            pass
# 常见 UI 符号
chars.update('★☆●○◆◇■□▲▼◀▶←→↑↓✓✕·—“”‘’…、。，《》〈〉【】（）！？：；％＋－×÷°′″€¥')

# 扫源码里出现的所有字符（兜底：干员名等生僻字）
scanned = 0
for base, dirs, files in os.walk(ROOT):
    dirs[:] = [d for d in dirs if d not in ('node_modules', 'dist', 'dist-tmp', '.git', '.fx-proposal', 'tmp-assets')]
    for fn in files:
        if not fn.endswith(('.ts', '.tsx', '.html', '.css', '.txt', '.json', '.cmd', '.mjs')):
            continue
        try:
            with open(os.path.join(base, fn), encoding='utf-8') as fh:
                text = fh.read()
        except Exception:
            continue
        for ch in text:
            if ord(ch) > 0x7E:
                chars.add(ch)
        scanned += 1

out_txt = os.path.join(ROOT, 'scripts', 'font-charset.txt')
with open(out_txt, 'w', encoding='utf-8') as fh:
    fh.write(''.join(sorted(chars)))
print('charset chars =', len(chars), 'files scanned =', scanned)

out_woff2 = os.path.join(OUTDIR, 'NotoSansSC.woff2')
cmd = [
    sys.executable, '-m', 'fontTools.subset', SRC,
    f'--text-file={out_txt}',
    f'--output-file={out_woff2}',
    '--flavor=woff2',
    '--layout-features=*',
    '--no-hinting',
    '--desubroutinize',
    '--name-IDs=*',
    '--drop-tables+=FFTM',
]
r = subprocess.run(cmd, capture_output=True, text=True)
print('rc=', r.returncode)
print(r.stdout[-800:])
print(r.stderr[-800:])
if os.path.exists(out_woff2):
    print('woff2 size = %.2f MB' % (os.path.getsize(out_woff2) / 1048576))
