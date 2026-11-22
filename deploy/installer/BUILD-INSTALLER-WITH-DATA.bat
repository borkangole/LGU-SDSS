@echo off
title Build the LGU-SDSS installer (WITH the current data)
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build_installer.ps1" -WithData
pause
