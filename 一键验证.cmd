@echo off
REM ============================================================
REM  AIRNIGHT full check  --  type check + data check + all tests
REM  + a sample battle.  Run this after changing any code.
REM
REM  ASCII-only on purpose (see the note in the game launcher).
REM ============================================================
chcp 65001 >nul
title AIRNIGHT - verify
cd /d "%~dp0"

node "scripts\verify.mjs"
set EXITCODE=%ERRORLEVEL%

echo.
if "%EXITCODE%"=="0" (
  echo   ALL GOOD.
) else (
  echo   SOMETHING FAILED - see the output above.
)
echo.
pause >nul
exit /b %EXITCODE%
