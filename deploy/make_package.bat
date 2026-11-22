@echo off
setlocal EnableExtensions
title Make the LGU-SDSS package
cd /d "%~dp0.."
echo ============================================================
echo   Make the LGU-SDSS package (run this on YOUR PC)
echo   1. copies your database into deploy\initdb\
echo   2. zips the system into LGU-SDSS-package.zip in this folder
echo ============================================================
echo.

rem --- find PostgreSQL tools --------------------------------------------------
set "PGBIN="
for /d %%d in ("C:\Program Files\PostgreSQL\*") do if exist "%%d\bin\pg_dump.exe" set "PGBIN=%%d\bin"
if not defined PGBIN (
  echo PostgreSQL was not found under C:\Program Files\PostgreSQL
  pause & exit /b 1
)
echo Using PostgreSQL tools in: %PGBIN%

set /p "PGPASSWORD=Type your PostgreSQL (postgres user) password and press Enter: "

rem --- which PostgreSQL version holds the database -----------------------------
set "SVN="
for /f "usebackq delims=" %%v in (`""%PGBIN%\psql.exe" -U postgres -h localhost -d lgu_masterdata -tAc "show server_version_num""`) do set "SVN=%%v"
if not defined SVN (
  echo.
  echo Could not connect to the lgu_masterdata database. Check the password and that PostgreSQL is running.
  pause & exit /b 1
)
set "PGMAJOR=%SVN:~0,2%"
echo Database server: PostgreSQL %PGMAJOR%

rem --- 1. database copy ---------------------------------------------------------
if not exist "deploy\initdb" mkdir "deploy\initdb"
echo.
echo [1/2] Copying the database...
"%PGBIN%\pg_dump.exe" -U postgres -h localhost --no-owner --no-privileges --encoding=UTF8 -f "deploy\initdb\lgu_masterdata.sql" lgu_masterdata
if errorlevel 1 ( echo Database copy failed. & pause & exit /b 1 )
<nul set /p "=%PGMAJOR%" > "deploy\pg_version.txt"
findstr /i /c:"CREATE EXTENSION" "deploy\initdb\lgu_masterdata.sql" >nul && (
  echo NOTE: the database uses an extension:
  findstr /i /c:"CREATE EXTENSION" "deploy\initdb\lgu_masterdata.sql"
)
for %%f in ("deploy\initdb\lgu_masterdata.sql") do echo       saved deploy\initdb\lgu_masterdata.sql  (%%~zf bytes)
set "PGPASSWORD="

rem --- 2. copy the project without the heavy / private parts, then zip ------------
set "STAGE=%TEMP%\LGU-SDSS"
if exist "%STAGE%" rmdir /s /q "%STAGE%"
echo.
echo [2/2] Collecting the files...
robocopy "%CD%" "%STAGE%" /E /NFL /NDL /NJH /NJS /NP ^
  /XD node_modules dist __pycache__ .git venv .venv "Claude outputs" database backups imports CDRA ^
  /XF .env *.pyc LGU-SDSS-package.zip LGU-SDSS-Setup.exe >nul
if errorlevel 8 ( echo Copying failed. & pause & exit /b 1 )
if not exist "%STAGE%\deploy\initdb\lgu_masterdata.sql" ( echo The database copy is missing from the package. & pause & exit /b 1 )

set "ZIP=%CD%\LGU-SDSS-package.zip"
if exist "%ZIP%" del "%ZIP%"
echo Zipping (this can take a minute)...
powershell -NoProfile -Command "Compress-Archive -Path \"$env:STAGE\*\" -DestinationPath \"$env:ZIP\" -CompressionLevel Optimal"
if not exist "%ZIP%" ( echo Zipping failed. & pause & exit /b 1 )
rmdir /s /q "%STAGE%"
for %%f in ("%ZIP%") do set "ZSIZE=%%~zf"

echo.
echo ============================================================
echo   Done:  %ZIP%   (%ZSIZE% bytes)
echo.
echo   Send it to your friend with START-HERE.txt's steps.
echo   It contains REAL CBMS household data and your login accounts:
echo   share it privately (USB / private link), not publicly.
echo   Your .env files (passwords, Gemini key) are NOT included.
echo ============================================================
pause
