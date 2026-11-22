# LGU-SDSS - one-time setup WITHOUT Docker (Windows PowerShell 5.1 or newer)
# 'Continue': native tools (psql) write to stderr; every step checks its own result.
$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)   # repo root (this script is in deploy\no-docker)
Set-Location $root

function Stop-Here($msg) {
  Write-Host ""
  Write-Host $msg -ForegroundColor Red
  Write-Host ""
  Read-Host "Press Enter to close"
  exit 1
}
function Step($n, $msg) { Write-Host ""; Write-Host "[$n] $msg" -ForegroundColor Cyan }

Write-Host "============================================================"
Write-Host "  LGU-SDSS setup (no Docker) - run this ONCE"
Write-Host "============================================================"

# ---- 1. Python -------------------------------------------------------------
Step "1/5" "Looking for Python 3.10 - 3.13 ..."
$py = $null
$candidates = @(
  @{ exe = 'py'; args = @('-3.12') }, @{ exe = 'py'; args = @('-3.13') },
  @{ exe = 'py'; args = @('-3.11') }, @{ exe = 'py'; args = @('-3.10') },
  @{ exe = 'python'; args = @() }
)
foreach ($c in $candidates) {
  if (-not (Get-Command $c.exe -ErrorAction SilentlyContinue)) { continue }
  try {
    $v = & $c.exe @($c.args) -c "import sys;print('%d.%d' % sys.version_info[:2])" 2>$null
    if ($LASTEXITCODE -eq 0 -and $v -match '^3\.(10|11|12|13)$') { $py = $c; $pyver = $v; break }
  } catch { }
}
if (-not $py) {
  Stop-Here @"
Python 3.12 was not found (the Microsoft Store 'python' shortcut does not count).
Install it from  https://www.python.org/downloads/windows/  (choose 3.12, 'Windows installer 64-bit').
IMPORTANT: on the first installer screen, tick 'Add python.exe to PATH'.
Then close this window and run SETUP-NO-DOCKER.bat again.
"@
}
Write-Host "  Found Python $pyver"

# ---- 2. PostgreSQL ---------------------------------------------------------
Step "2/5" "Looking for PostgreSQL 18 ..."
$pgbin = $null; $pgmajor = 0
Get-ChildItem "C:\Program Files\PostgreSQL" -Directory -ErrorAction SilentlyContinue | ForEach-Object {
  $m = 0
  if ([int]::TryParse($_.Name, [ref]$m) -and (Test-Path (Join-Path $_.FullName "bin\psql.exe")) -and $m -gt $pgmajor) {
    $pgmajor = $m; $pgbin = Join-Path $_.FullName "bin"
  }
}
$need = 18
if (Test-Path "deploy\pg_version.txt") { $need = [int]((Get-Content "deploy\pg_version.txt" -Raw).Trim()) }
if (-not $pgbin -or $pgmajor -lt $need) {
  Stop-Here @"
PostgreSQL $need (or newer) was not found.
Install it from  https://www.enterprisedb.com/downloads/postgres-postgresql-downloads  (Windows x86-64, version $need).
- Keep the default folder, port 5432 and components.
- When it asks for a password for the 'postgres' user, type one and REMEMBER IT (you need it below).
- You can skip 'Stack Builder' at the end.
Then close this window and run SETUP-NO-DOCKER.bat again.
"@
}
Write-Host "  Found PostgreSQL $pgmajor in $pgbin"
$psql = Join-Path $pgbin "psql.exe"

# make sure the service is running
Get-Service -Name "postgresql*" -ErrorAction SilentlyContinue | Where-Object { $_.Status -ne 'Running' } | ForEach-Object {
  try { Start-Service $_.Name; Start-Sleep 3 } catch { }
}

# ---- password + connection test --------------------------------------------
$env:PGCLIENTENCODING = 'UTF8'
$plain = $null
for ($try = 1; $try -le 3; $try++) {
  $sec = Read-Host "Type the PostgreSQL 'postgres' password you chose when installing PostgreSQL" -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
  $cand = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  $env:PGPASSWORD = $cand
  $out = & $psql -U postgres -h localhost -p 5432 -d postgres -tAc "select 1" 2>&1
  if ($LASTEXITCODE -eq 0) { $plain = $cand; break }
  Write-Host "  Could not log in ($out). Try again." -ForegroundColor Yellow
}
if (-not $plain) { Stop-Here "Could not connect to PostgreSQL. Check that the PostgreSQL service is running and the password is right." }

# ---- 3. database -----------------------------------------------------------
Step "3/5" "Loading the LGU-SDSS database ..."
$exists = (& $psql -U postgres -h localhost -d postgres -tAc "select 1 from pg_database where datname='lgu_masterdata'").Trim()
$loaded = $false
if ($exists -eq '1') {
  $n = (& $psql -U postgres -h localhost -d lgu_masterdata -tAc "select count(*) from information_schema.tables where table_schema='public'").Trim()
  if ([int]$n -gt 5) { $loaded = $true; Write-Host "  Database lgu_masterdata is already loaded ($n tables) - keeping it." }
  else { & $psql -U postgres -h localhost -d postgres -q -c "DROP DATABASE lgu_masterdata" | Out-Null; $exists = '' }
}
if (-not $loaded) {
  $dump = Join-Path $root "deploy\initdb\lgu_masterdata.sql"
  if (-not (Test-Path $dump)) { Stop-Here "The database file deploy\initdb\lgu_masterdata.sql is missing from the package." }
  & $psql -U postgres -h localhost -d postgres -q -c "CREATE DATABASE lgu_masterdata ENCODING 'UTF8' TEMPLATE template0" | Out-Null
  if ($LASTEXITCODE -ne 0) { Stop-Here "Could not create the database." }
  Write-Host "  Restoring (about a minute) ..."
  $log = Join-Path $root "deploy\no-docker\restore.log"
  & $psql -U postgres -h localhost -d lgu_masterdata -q -v ON_ERROR_STOP=1 -f $dump *> $log
  if ($LASTEXITCODE -ne 0) {
    & $psql -U postgres -h localhost -d postgres -q -c "DROP DATABASE IF EXISTS lgu_masterdata" | Out-Null
    Stop-Here "Loading the database failed. Send the file deploy\no-docker\restore.log to the developer."
  }
  Remove-Item $log -ErrorAction SilentlyContinue
  $h = (& $psql -U postgres -h localhost -d lgu_masterdata -tAc "select count(*) from tbl_households").Trim()
  Write-Host "  Done: $h households loaded."
}

# ---- 4. Python packages ----------------------------------------------------
Step "4/5" "Installing the Python packages (5-10 minutes the first time, needs internet) ..."
if (-not (Test-Path ".venv\Scripts\python.exe")) {
  & $py.exe @($py.args) -m venv .venv
  if ($LASTEXITCODE -ne 0) { Stop-Here "Could not create the Python environment." }
}
$vpy = Join-Path $root ".venv\Scripts\python.exe"
& $vpy -m pip install --disable-pip-version-check --upgrade pip 2>&1 | Out-Null
& $vpy -m pip install --disable-pip-version-check -r backend\requirements.txt -r requirements-docker.txt
if ($LASTEXITCODE -ne 0) { Stop-Here "Installing the Python packages failed. Check the internet connection and run this again." }

# ---- 5. settings -----------------------------------------------------------
Step "5/5" "Saving the settings ..."
$envFile = Join-Path $root "backend\.env"
if (Test-Path $envFile) {
  Write-Host "  backend\.env already exists - updating the database password only."
  $lines = Get-Content $envFile | Where-Object { $_ -notmatch '^DB_(HOST|PORT|NAME|USER|PASSWORD)=' }
} else {
  $rng = New-Object Security.Cryptography.RNGCryptoServiceProvider
  $b = New-Object byte[] 32; $rng.GetBytes($b)
  $jwt = -join ($b | ForEach-Object { $_.ToString('x2') })
  $k = Read-Host "Paste the Gemini API key if you were given one (or just press Enter to skip)"
  $lines = @("JWT_SECRET_KEY=$jwt", "GEMINI_API_KEY=$k")
}
$lines += @("DB_HOST=localhost", "DB_PORT=5432", "DB_NAME=lgu_masterdata", "DB_USER=postgres", ('DB_PASSWORD="' + ($plain -replace '\\','\\\\' -replace '"','\"') + '"'))
[IO.File]::WriteAllText($envFile, (($lines -join "`r`n") + "`r`n"), (New-Object Text.UTF8Encoding($false)))
$env:PGPASSWORD = $null

Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host "  Setup finished." -ForegroundColor Green
Write-Host "  From now on just double-click  RUN-NO-DOCKER.bat"
Write-Host "============================================================" -ForegroundColor Green
$go = Read-Host "Start LGU-SDSS now? (Y/n)"
if ($go -notmatch '^[nN]') { & (Join-Path $PSScriptRoot "run.ps1") }
