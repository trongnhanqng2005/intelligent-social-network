@echo off
setlocal
set "REPO_ROOT=%~dp0.."
set "LAUNCHER=%~dp0dev-launcher.ps1"
if not "%~1"=="" (
  set "REPO_ROOT=%~1"
  set "LAUNCHER=%~1\scripts\dev-launcher.ps1"
)
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%LAUNCHER%" -Action Stop -Root "%REPO_ROOT%"
set "LAUNCHER_EXIT=%ERRORLEVEL%"
if not "%LAUNCHER_EXIT%"=="0" (
  echo.
  pause
)
endlocal & exit /b %LAUNCHER_EXIT%
