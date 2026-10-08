@echo off
setlocal
cd /d "%~dp0.."
node start.mjs %*
if errorlevel 1 pause
endlocal
