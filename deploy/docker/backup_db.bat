@echo off
cd /d "%~dp0"
if not exist ..\..\backups mkdir ..\..\backups
for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd_HHmm"') do set TS=%%i
docker compose exec -T db pg_dump -U postgres --no-owner --no-privileges lgu_masterdata > "..\..\backups\lgu_masterdata_%TS%.sql"
if errorlevel 1 (echo Backup failed - is the system running? & pause & exit /b 1)
echo Backup saved to backups\lgu_masterdata_%TS%.sql
pause
