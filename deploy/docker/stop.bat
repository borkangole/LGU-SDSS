@echo off
cd /d "%~dp0"
docker compose stop
echo LGU-SDSS stopped. Your data is kept. Run start.bat to start again.
pause
