@echo off
setlocal EnableExtensions
title LGU-SDSS
cd /d "%~dp0"

echo ============================================================
echo   LGU-SDSS - starting
echo ============================================================

where docker >nul 2>nul || (
  echo Docker Desktop is not installed.
  echo Install it from https://www.docker.com/products/docker-desktop/ , restart the PC, then run start.bat again.
  pause & exit /b 1
)
docker info >nul 2>nul || (
  echo Docker Desktop is not running.
  echo Open Docker Desktop, wait until it says "Engine running", then run start.bat again.
  pause & exit /b 1
)
docker compose version >nul 2>nul || (
  echo This Docker version has no "docker compose". Update Docker Desktop and try again.
  pause & exit /b 1
)

rem --- first run: create .env with random passwords -------------------------
if not exist ".env" (
  echo First run: creating the settings file .env ...
  powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$r={-join((48..57)+(65..90)+(97..122)|Get-Random -Count 32|%%{[char]$_})};" ^
    "$k=Read-Host 'Paste the Gemini API key for Ask the Data (or just press Enter to skip)';" ^
    "Set-Content -Encoding ascii .env ('DB_PASSWORD='+(&$r)),('JWT_SECRET_KEY='+(&$r)+(&$r)),('GEMINI_API_KEY='+$k.Trim()),'APP_PORT=8080'"
  if not exist ".env" ( echo Could not create .env & pause & exit /b 1 )
)

rem --- which port -----------------------------------------------------------
set APP_PORT=8080
for /f "usebackq tokens=1,* delims==" %%a in (".env") do if /i "%%a"=="APP_PORT" set APP_PORT=%%b

rem --- PostgreSQL version the database was exported from ----------------------
set PG_VERSION=17
if exist "..\pg_version.txt" set /p PG_VERSION=<"..\pg_version.txt"

if not exist "..\initdb\*.sql" (
  echo.
  echo WARNING: no database copy found in deploy\initdb\
  echo The system will start with an EMPTY database. On the developer PC run deploy\make_package.bat.
  echo.
  pause
)

echo.
echo Building and starting (PostgreSQL %PG_VERSION%, port %APP_PORT%).
echo The FIRST time takes 5-15 minutes and needs internet. Later starts take seconds.
echo.
docker compose up -d --build
if errorlevel 1 (
  echo.
  echo Start failed - see the messages above.
  echo Tip: send a screenshot of this window, or run:  docker compose logs
  pause & exit /b 1
)

echo.
echo Waiting for the database and the website (first time: the database copy is being restored)...
powershell -NoProfile -Command ^
  "for($i=0;$i -lt 300;$i++){try{$r=Invoke-WebRequest -UseBasicParsing ('http://localhost:%APP_PORT%/api/health') -TimeoutSec 3; if($r.StatusCode -eq 200){exit 0}}catch{}; Start-Sleep 2}; exit 1"
if errorlevel 1 (
  echo.
  echo The website did not answer yet. Showing the last log lines:
  docker compose logs --tail 40 db app
  echo.
  echo If the database is still restoring, wait a minute and open http://localhost:%APP_PORT%
  pause & exit /b 1
)

start "" http://localhost:%APP_PORT%
echo.
echo ============================================================
echo   LGU-SDSS is running:  http://localhost:%APP_PORT%
echo   Other PCs on the same network: http://%COMPUTERNAME%:%APP_PORT%
echo   Log in with the same accounts as on the developer PC.
echo   To stop it: stop.bat      (your data is kept)
echo ============================================================
pause
