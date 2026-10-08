@echo off
setlocal
cd /d "%~dp0"
node launch.mjs
if errorlevel 1 pause
endlocal
