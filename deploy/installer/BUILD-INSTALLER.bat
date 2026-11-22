@echo off
title Build the LGU-SDSS installer (EMPTY - no CBMS data)
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build_installer.ps1"
pause
