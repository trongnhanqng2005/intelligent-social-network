@echo off
setlocal
set "REPO_ROOT=%~dp0.."
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0dev-launcher.ps1" -Action Start -Root "%REPO_ROOT%"
if errorlevel 1 (
  echo.
  echo Launcher stopped with an error. Read the message above and the retained logs under .artifacts\local-dev-launcher.
  pause
)
endlocal
