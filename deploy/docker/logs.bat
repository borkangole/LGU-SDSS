@echo off
cd /d "%~dp0"
echo Showing the system's messages (close this window to stop watching).
docker compose logs -f --tail 100
