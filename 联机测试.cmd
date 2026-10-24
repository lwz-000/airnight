@echo off
REM ============================================================
REM  AIRNIGHT netplay self-test  --  simulates several players
REM  fighting a full match against a real server, then reports
REM  whether pairings / HP loss / battle playback are correct.
REM
REM  ASCII-only on purpose (see the note in the game launcher).
REM ============================================================
chcp 65001 >nul
title AIRNIGHT - netplay test
cd /d "%~dp0"

echo.
echo ==========================================================
echo   Running the multiplayer self-test (4 players, 3 rounds).
echo   This takes about half a minute.  Ignore the server logs,
echo   only the summary at the very bottom matters.
echo ==========================================================
echo.

node "node_modules\tsx\dist\cli.mjs" "scripts\netplay-playtest.ts" --players 4 --rounds 3
set EXITCODE=%ERRORLEVEL%

echo.
if "%EXITCODE%"=="0" (
  echo   ALL GOOD - the multiplayer logic passed.
) else (
  echo   PROBLEM FOUND - please screenshot the lines above
  echo   and send them to me.
)
echo.
pause >nul
exit /b %EXITCODE%
