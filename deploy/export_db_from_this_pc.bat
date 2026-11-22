@echo off
REM Run this on YOUR development PC (not the friend's PC).
REM It exports your local lgu_masterdata database into deploy\initdb\lgu_masterdata.sql
cd /d "%~dp0.."
if not exist deploy\initdb mkdir deploy\initdb
set PGBIN=
for /d %%d in ("C:\Program Files\PostgreSQL\*") do if exist "%%d\bin\pg_dump.exe" set PGBIN=%%d\bin
if "%PGBIN%"=="" (echo pg_dump not found under C:\Program Files\PostgreSQL. & pause & exit /b 1)
echo Using %PGBIN%
"%PGBIN%\pg_dump.exe" -U postgres -h localhost --no-owner --no-privileges -f deploy\initdb\lgu_masterdata.sql lgu_masterdata
if errorlevel 1 (echo Export failed. & pause & exit /b 1)
echo Saved deploy\initdb\lgu_masterdata.sql
pause
