@echo off
rem EDDO OS / Loupedeck controller: install any new packages, then restart the
rem controller so it picks up the changes. Safe to run any time.
cd /d "%~dp0"
echo Installing packages (npm install)...
call npm install
if errorlevel 1 (
  echo.
  echo npm install reported a problem - see above.
  pause
  exit /b 1
)
echo.
echo Restarting the controller...
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -like '*src/main.ts*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force; 'Stopped controller (pid ' + $_.ProcessId + ') - it restarts by itself in a few seconds.' }"
echo.
echo Done. Reload the wallpaper to see the battery levels.
timeout /t 8
