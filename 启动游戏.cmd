@echo off
REM ============================================================
REM  AIRNIGHT launcher  --  double click this file to play
REM
REM  NOTE: this file must stay ASCII-only.
REM  cmd.exe parses .cmd files using the current code page, so any
REM  non-ASCII byte here becomes a garbage command and the whole
REM  thing fails with "is not recognized as an internal or external
REM  command".  All Chinese text is printed by scripts/launch.ts.
REM ============================================================
chcp 65001 >nul
title AIRNIGHT
cd /d "%~dp0"

node "node_modules\tsx\dist\cli.mjs" "scripts\launch.ts" %*
set EXITCODE=%ERRORLEVEL%

REM Only hold the window open when something went wrong, so a normal
REM Ctrl+C stop just closes the window.
if not "%EXITCODE%"=="0" (
  echo.
  pause >nul
)
exit /b %EXITCODE%
