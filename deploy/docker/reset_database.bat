@echo off
cd /d "%~dp0"
echo This DELETES the database inside Docker and restores it again from deploy\initdb\
echo (use it after putting a newer database copy there). Data added since then is lost.
set /p OK=Type YES to continue: 
if /i not "%OK%"=="YES" (echo Cancelled. & pause & exit /b 0)
docker compose down -v
call start.bat
