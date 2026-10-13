@echo off
setlocal
set "REPO_ROOT=%~dp0.."
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0dev-launcher.ps1" -Action Stop -Root "%REPO_ROOT%"
if errorlevel 1 (
  echo.
  pause
)
endlocal
