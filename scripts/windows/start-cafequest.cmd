@echo off
rem CafeQuest launcher for the cafe's Windows PC. Double-click it (or use the
rem shortcuts from install-shortcuts.cmd): it builds, starts the server (:3000)
rem and the dashboard (:5173) in two minimized windows, and opens the dashboard.
rem Each window restarts its process if it stops; close both to stop CafeQuest.
setlocal
cd /d "%~dp0..\.."
if "%~1"=="--run" goto :run

where npm >nul 2>nul || (
  echo Node.js was not found. Install Node.js 22 or newer, then try again.
  pause
  exit /b 1
)

netstat -ano | findstr /r /c:":3000 .*LISTENING" >nul && (
  echo CafeQuest is already running.
  goto :open
)

if not exist node_modules (
  echo Installing dependencies...
  call npm install --no-audit --no-fund || goto :failed
)
echo Building CafeQuest...
call npm run build -w shared -w server -w dashboard || goto :failed

start "CafeQuest Server" /min "%~f0" --run server
start "CafeQuest Dashboard" /min "%~f0" --run dashboard

:open
rem Through the dashboard's proxy, so both halves are up before the browser opens.
for /l %%i in (1,1,60) do (
  curl -sf -o nul http://localhost:5173/api/health && goto :browser
  timeout /t 1 /nobreak >nul
)
echo The dashboard did not answer within 60 seconds; check the CafeQuest windows.
pause
exit /b 1

:browser
start "" http://localhost:5173
exit /b 0

:failed
echo.
echo CafeQuest could not be built. Fix the error above, then run this again.
pause
exit /b 1

rem One window per process: run it, and restart it 5 s after it stops.
:run
if not exist logs mkdir logs
:again
if "%~2"=="server" (
  call npm start -w server
) else (
  call npm run preview -w dashboard
)
set "code=%errorlevel%"
>>logs\restarts.log echo [%date% %time%] %~2 stopped with exit code %code%
echo.
echo [%date% %time%] CafeQuest %~2 stopped (exit code %code%). Restarting in 5 seconds; close this window to stop it.
timeout /t 5 /nobreak >nul
goto :again
