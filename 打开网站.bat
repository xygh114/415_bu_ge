@echo off
rem Open the site with the default browser. No install, no network needed.
setlocal
set "HERE=%~dp0"
if exist "%HERE%buge\index.html" (
  start "" "%HERE%buge\index.html"
) else (
  echo Cannot find buge\index.html next to this file.
  pause
  exit /b 1
)
