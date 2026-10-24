#!/usr/bin/env node
/**
 * ============================================================
 *  生成便携包里的三个启动文件
 * ============================================================
 *  用法：node scripts/write-launcher-vbs.mjs <目标目录>
 *    例：node scripts/write-launcher-vbs.mjs "E:/AIRNIGHT/版本文件/失序协议-网页版-0.3.2正式版"
 *
 * 产出（都会**覆盖**目标目录里的同名文件）：
 *    启动游戏.vbs    ← 双击这个（无黑框）
 *    关闭游戏.vbs    ← 双击这个（关掉后台）
 *    启动游戏.cmd    ← 排障用：有窗口、能看报错、能带参数
 *
 * ============================================================
 *  ★ 为什么 .vbs 要由脚本生成，而不是手写两个文件放进包里？
 * ============================================================
 * 因为**编码**。Windows Script Host 默认按系统代码页（简体中文机器上是 GBK）
 * 读 .vbs，所以存成 UTF-8 的中文在 MsgBox 里会变成一堆问号。
 * 正确做法是存成 **UTF-16 LE + BOM** —— 但仓库里的文件都是 UTF-8，
 * 手写一份 UTF-16 的东西进去，以后既不好读也不好改（编辑器一保存就变回去）。
 * 所以：内容写在这里（JS 源文件本身就是 UTF-8，中文没问题），
 * 生成时统一转 UTF-16 LE + BOM。**只有一处实现**。
 *
 * ★ 换行必须 CRLF：WSH 对纯 LF 的 .vbs 容错不好（行号报错会错位）。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const outDir = process.argv[2];
if (!outDir) {
  console.error('用法：node scripts/write-launcher-vbs.mjs <目标目录>');
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });

/** 统一转成 CRLF，再按需要的编码落盘 */
function writeText(file, text, encoding) {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');
  if (encoding === 'utf16le-bom') {
    // BOM 让 WSH 知道"这是 Unicode 文件"，否则它按 GBK 解，中文全烂
    writeFileSync(file, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(normalized, 'utf16le')]));
  } else {
    writeFileSync(file, normalized, 'utf8');
  }
  console.log(`ok -> ${file}`);
}

// ============================================================
//  启动游戏.vbs
// ============================================================
const START_VBS = `Option Explicit
' ============================================================
'  失序协议 启动器（无黑框）
'
'  ★ 这个文件由 scripts/write-launcher-vbs.mjs 生成，别手改。
'  ★ 编码必须是 UTF-16 LE + BOM：Windows Script Host 默认按系统代码页
'    (GBK) 读 .vbs，用 UTF-8 存的中文会变成一堆问号。
'
'  它做的事就一件：把 app\\launch.mjs 以 --hidden 跑起来。
'  黑框没了，所以：
'    · 输出写进「游戏日志.txt」（每次启动覆盖一次）
'    · 启动失败会弹窗，并把日志用记事本打开
'    · 想退出游戏用网页主界面那个「退出游戏」，或者双击「关闭游戏.vbs」
'    · 想看报错 / 想指定端口，改用「启动游戏.cmd」（有窗口，能带参数）
'    · ★ 0.3.3：每次启动顺手把旁边的「启动游戏.lnk」刷新成带游戏图标的快捷方式
'      （双击它和双击本文件一模一样，只是图标是那个「失」）
'
'  ★★ 为什么 rc <> 0 时还要看一个「主动关闭」标记？
'    这个脚本是**等着**游戏进程的（隐藏模式下没有窗口，成败只能靠退出码）。
'    而「关闭游戏.vbs」是用 taskkill /F 杀的 —— 强杀的退出码也是非 0，
'    于是"我自己点关闭"会弹出一个"游戏没能启动"的假错误。
'    所以关闭器动手前先放一个 .airnight-closing 标记，这里看到它就当"正常退出"。
' ============================================================
Dim fso, sh, here, nodeExe, logFile, closingFlag, runCmd, rc, lnkPath, icoPath, lnk
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")

here = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = here

logFile = fso.BuildPath(here, "游戏日志.txt")
closingFlag = fso.BuildPath(here, ".airnight-closing")
nodeExe = fso.BuildPath(here, "runtime\\node.exe")
' 压缩包里没带 runtime 时退回本机装的 Node.js
If Not fso.FileExists(nodeExe) Then nodeExe = "node"

' 上一次异常退出可能留下这个标记，开新的一局前先清掉
On Error Resume Next
If fso.FileExists(closingFlag) Then fso.DeleteFile closingFlag, True
Err.Clear
On Error GoTo 0

' ============================================================
'  ★ 0.3.3：给自己刷一个**带图标的快捷方式**（第一次双击后文件夹里会多出「启动游戏」）
'
'  【为什么不在打包时放一个现成的 .lnk？】
'  .lnk 里存的是**绝对路径**。这个包是 zip 解压出来的，玩家解压到哪儿不确定 ——
'  打包时写死的路径一解压就失效（双击只会说"找不到目标"）。
'  所以改成"每次启动刷新一次"：路径永远对着自己所在的位置，整个文件夹挪走也能自愈。
'
'  ★★ 整段 On Error Resume Next：快捷方式是锦上添花，**绝不能影响开游戏**。
'     有的机器（企业策略）不允许建 .lnk，那种情况静默跳过就好。
' ============================================================
On Error Resume Next
lnkPath = fso.BuildPath(here, "启动游戏.lnk")
icoPath = fso.BuildPath(here, "游戏图标.ico")
Set lnk = sh.CreateShortcut(lnkPath)
lnk.TargetPath = fso.BuildPath(here, "启动游戏.vbs")
lnk.WorkingDirectory = here
lnk.Description = "失序协议"
If fso.FileExists(icoPath) Then lnk.IconLocation = icoPath & ",0"
lnk.Save
Set lnk = Nothing
Err.Clear
On Error GoTo 0

runCmd = """" & nodeExe & """ """ & fso.BuildPath(here, "app\\launch.mjs") & """ --hidden"

' 0 = 窗口完全隐藏；True = 等它退出。
' ★ 必须等 —— 隐藏模式下没有窗口可看，成败只能靠退出码判断。
On Error Resume Next
rc = sh.Run(runCmd, 0, True)
If Err.Number <> 0 Then
  MsgBox "没有找到可以运行游戏的 Node.js。" & vbCrLf & vbCrLf & _
         "请把压缩包整个重新解压一次（不要只拖单个文件出来）。", 16, "失序协议"
  WScript.Quit 1
End If
On Error GoTo 0

If rc <> 0 Then
  ' 是「关闭游戏.vbs」动的手 ⇒ 正常退出，不要弹窗吓人
  If fso.FileExists(closingFlag) Then
    On Error Resume Next
    fso.DeleteFile closingFlag, True
    On Error GoTo 0
    WScript.Quit 0
  End If
  MsgBox "游戏没能启动（或者被意外结束了）。" & vbCrLf & vbCrLf & _
         "原因写在「游戏日志.txt」里 —— 把这个文件发给我就能定位。", 48, "失序协议"
  If fso.FileExists(logFile) Then
    On Error Resume Next
    sh.Run "notepad.exe """ & logFile & """", 1, False
  End If
End If
`;

// ============================================================
//  关闭游戏.vbs
// ============================================================
const STOP_VBS = `Option Explicit
' ============================================================
'  失序协议 关闭器
'
'  ★ 这个文件由 scripts/write-launcher-vbs.mjs 生成，别手改。
'
'  黑框藏起来之后，"关掉那个黑色窗口"这条路就没了，
'  所以给一个能**直接停掉后台进程**的入口：
'    读启动器写下的 .airnight-run.json，拿到 pid，taskkill /T /F 连子进程一起收掉。
'
'  ★ 为什么不是"关了浏览器就算关"？
'    浏览器关掉只是断线，后台两个端口还占着、还在广播房间 ——
'    再双击启动会判定"已经开着一份"，直接把浏览器叫回来，看起来像"关不掉"。
'
'  ★★ 动手前先放一个 .airnight-closing 标记：
'    「启动游戏.vbs」在等进程，强杀的退出码是非 0，它会误判成"启动失败"并弹窗。
'    那个脚本看到这个标记就知道"是我自己点的关闭"。
' ============================================================
Dim fso, sh, here, runFile, closingFlag, text, pidValue, rc
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")

here = fso.GetParentFolderName(WScript.ScriptFullName)
runFile = fso.BuildPath(here, ".airnight-run.json")
closingFlag = fso.BuildPath(here, ".airnight-closing")

If Not fso.FileExists(runFile) Then
  MsgBox "现在没有正在运行的游戏。", 64, "失序协议"
  WScript.Quit 0
End If

text = ""
On Error Resume Next
Dim ts
Set ts = fso.OpenTextFile(runFile, 1)
text = ts.ReadAll
ts.Close
On Error GoTo 0

pidValue = PidOf(text)

If pidValue = "" Then
  DeleteQuiet runFile
  MsgBox "运行记录已经损坏（可能游戏早就关掉了）。" & vbCrLf & vbCrLf & _
         "如果任务管理器里还有 node.exe 在跑，手动结束它就行。", 48, "失序协议"
  WScript.Quit 0
End If

' ★ 标记必须在 taskkill **之前**放下去，否则「启动游戏.vbs」那边可能先醒过来
WriteFlag closingFlag

rc = 1
On Error Resume Next
rc = sh.Run("taskkill /PID " & pidValue & " /T /F", 0, True)
On Error GoTo 0

' 不管成没成，先把这个标记删掉 —— 它只描述"上一次启动"
DeleteQuiet runFile

If rc = 0 Then
  MsgBox "游戏已关闭。", 64, "失序协议"
Else
  MsgBox "没能关掉（可能已经关了，或者被系统拒绝）。" & vbCrLf & vbCrLf & _
         "可以打开任务管理器，结束名为 node.exe 的进程。", 48, "失序协议"
End If

' 从 run 标记里抠出 pid（只有几百字节，不值得为了它引入 JSON 解析）
Function PidOf(t)
  Dim re, hits
  PidOf = ""
  If Len(t) = 0 Then Exit Function
  Set re = New RegExp
  re.Pattern = """pid""\\s*:\\s*(\\d+)"
  re.IgnoreCase = True
  re.Global = False
  Set hits = re.Execute(t)
  If hits.Count > 0 Then PidOf = hits(0).SubMatches(0)
End Function

Sub WriteFlag(path)
  On Error Resume Next
  Dim f
  Set f = fso.CreateTextFile(path, True)
  f.Write "closing"
  f.Close
  On Error GoTo 0
End Sub

Sub DeleteQuiet(path)
  On Error Resume Next
  If fso.FileExists(path) Then fso.DeleteFile path, True
  On Error GoTo 0
End Sub
`;

// ============================================================
//  启动游戏.cmd（排障入口，必须纯 ASCII）
// ============================================================
const START_CMD = `@echo off
REM ============================================================
REM  AIRNIGHT portable launcher (console version)
REM
REM  Normal players should double click the .vbs file instead --
REM  that one runs without any black console window.
REM  This .cmd is the troubleshooting entry: it keeps the window
REM  open so you can read the error, and it accepts arguments:
REM      launch.cmd --port=6000 --game=6001     custom ports
REM      launch.cmd --no-open                   do not open browser
REM
REM  NOTE: this file must stay ASCII-only. cmd.exe reads .cmd files
REM  using the current code page, so any non-ASCII byte becomes a
REM  garbage command. All Chinese text is printed by app\\launch.mjs.
REM ============================================================
chcp 65001 >nul
title AIRNIGHT
cd /d "%~dp0"

set NODE_EXE=runtime\\node.exe
if exist "%NODE_EXE%" goto run

REM No bundled runtime -- fall back to a Node.js installed on this PC.
where node >nul 2>nul
if errorlevel 1 goto nonode
set NODE_EXE=node

:run
"%NODE_EXE%" "app\\launch.mjs" %*
if errorlevel 1 pause >nul
exit /b 0

:nonode
echo.
echo   [!] Cannot start: runtime\\node.exe is missing and Node.js is not installed.
echo.
echo   Please extract the WHOLE zip again and keep every folder together
echo   (do not move single files out of the package).
echo.
pause >nul
exit /b 1
`;

// ============================================================
//  启动说明.txt（给玩家看的一页纸）
// ============================================================
/*
  ★ 为什么"双击哪个文件"要单独写一份说明？
  因为包里现在同时有「启动游戏.vbs」「关闭游戏.vbs」「启动游戏.cmd」三个，
  光看名字分不清哪个该点、关浏览器算不算退出。这三件事不写清楚，
  玩家会双击 .cmd（看到黑框，以为没修好），或者关掉浏览器就以为退出了。
*/
const START_README = `失序协议 —— 怎么启动、怎么退出
================================================

① 想玩：双击「启动游戏.vbs」
------------------------------------------------
· 不会有黑色窗口，游戏会以独立窗口打开（没有地址栏 / 标签页，
  任务栏上是这个游戏自己的图标）。
· 第一次双击之后，文件夹里会多出一个带图标的「启动游戏」快捷方式 ——
  以后点那个就行（图标是黑底 + 荧光「失」，和游戏窗口那个一样）。
  它是每次启动自动刷新的，整个文件夹挪到别处也不会失效。
· 第一次运行 Windows 可能弹「防火墙」提示（TCP 和 UDP 两条），
  都点「允许访问」，否则同一个 WiFi 的朋友找不到你的房间。
· 双击第二次不会再开一扇窗：如果窗口还在，它会告诉你去看任务栏。

② 想退出：直接关掉游戏窗口
------------------------------------------------
· 关窗口 = 连后台一起停掉（0.3.3 起）。以前关掉页面后台还在跑、端口还占着，
  必须再点一次「关闭游戏.vbs」——现在不用了。
· 也可以在网页主界面工具条上点「退出游戏」——它会先问你一次
  （联机时它会让整个房间掉线）。
· 想安静地关掉后台（窗口卡住了之类）：双击「关闭游戏.vbs」。

③ 端口
------------------------------------------------
· 默认：网页 5173、游戏服务器 8787。
· 被别的程序占了会自动往后顺延（最多试 20 个），网页上显示的地址永远是真实端口。
· 想固定端口，改用「启动游戏.cmd」（有窗口的那份）：
      启动游戏.cmd --port=6000 --game=6001
· 没装 Edge / Chrome 的机器会自动退回系统默认浏览器（会有地址栏，
  这种模式下关窗口不会停后台，请用「退出游戏」）。

④ 出问题了怎么办
------------------------------------------------
· 双击「启动游戏.cmd」——它有窗口，报错会留在窗口里，看得见。
· 隐藏模式（.vbs）下的所有输出都写在「游戏日志.txt」；
  启动失败会弹窗并自动用记事本打开它。把这份发过来就能定位。

⑤ 联机
------------------------------------------------
· 同一个 WiFi / Radmin / UU 组网：你「创建房间」，把 6 位房间号报给朋友，
  他点「加入房间」填进去就行（不用发链接）。
· 不在同一个网络：用内网穿透，隧道指向本机 5173（不是 8787），
  然后把 https://隧道地址/?server=隧道地址 发给他。
`;

writeText(join(outDir, '启动游戏.vbs'), START_VBS, 'utf16le-bom');
writeText(join(outDir, '关闭游戏.vbs'), STOP_VBS, 'utf16le-bom');
writeText(join(outDir, '启动游戏.cmd'), START_CMD, 'utf8');
writeText(join(outDir, '启动说明.txt'), START_README, 'utf8');
console.log(`\n生成完毕：${resolve(outDir)}`);
