@echo off
rem Restart Wallpaper Engine (for the G1 key). Closes it cleanly, then starts it
rem again through Steam, the same way Steam normally launches it.
if not "%~1"=="min" ( start "" /min "%~f0" min & exit /b )
set "WE=C:\Program Files (x86)\Steam\steamapps\common\wallpaper_engine"
set "EXE=wallpaper64.exe"
tasklist /fi "imagename eq wallpaper32.exe" | find /i "wallpaper32.exe" >nul && set "EXE=wallpaper32.exe"
rem ask it to close first (saves its settings), force only if it hasn't gone
taskkill /im %EXE% >nul 2>&1
timeout /t 4 /nobreak >nul
taskkill /f /im wallpaper64.exe /im wallpaper32.exe /im webwallpaper32.exe >nul 2>&1
timeout /t 1 /nobreak >nul
start "" "steam://rungameid/431960"
exit
