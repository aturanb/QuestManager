@echo off
rem Adds a "CafeQuest" shortcut to the Desktop and to this user's Startup folder,
rem so CafeQuest starts when this Windows user signs in. Run it once; to stop
rem starting at sign-in, delete CafeQuest from the Startup folder (Win+R, shell:startup).
setlocal
set "CQ_TARGET=%~dp0start-cafequest.cmd"
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$shell = New-Object -ComObject WScript.Shell;" ^
  "foreach ($folder in 'Desktop', 'Startup') {" ^
  "  $link = $shell.CreateShortcut((Join-Path ([Environment]::GetFolderPath($folder)) 'CafeQuest.lnk'));" ^
  "  $link.TargetPath = $env:CQ_TARGET;" ^
  "  $link.WorkingDirectory = Split-Path $env:CQ_TARGET;" ^
  "  $link.Save();" ^
  "  Write-Host ('Created ' + $link.FullName) }" || (
  echo Could not create the shortcuts.
  pause
  exit /b 1
)
pause
