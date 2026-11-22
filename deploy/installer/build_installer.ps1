# Builds the LGU-SDSS installer (run BUILD-INSTALLER.bat on the development PC).
# Needs: internet, PostgreSQL 18 (already on this PC), Inno Setup 6 (installed automatically if missing).
#
#   BUILD-INSTALLER.bat            -> LGU-SDSS-Setup.exe            EMPTY: no CBMS data. After
#                                     installing, the CBMS files are imported in the system
#                                     (Households -> Import CBMS files).
#   BUILD-INSTALLER-WITH-DATA.bat  -> LGU-SDSS-Setup-with-data.exe  the current database and
#                                     analysis files copied in (the old behaviour).
param([switch]$WithData)
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$root  = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)   # repo root (this script is in deploy\installer)
$work  = Join-Path $env:LOCALAPPDATA "LGU-SDSS-build"
$stage = Join-Path $work "stage"
$cache = Join-Path $work "cache"
Set-Location $root

function Stop-Here($msg) { Write-Host ""; Write-Host "PROBLEM: $msg" -ForegroundColor Red; exit 1 }
function Step($n, $msg) { Write-Host ""; Write-Host "[$n] $msg" -ForegroundColor Cyan }
function Copy-Tree($from, $to, [string[]]$xd = @(), [string[]]$xf = @()) {
  $a = @($from, $to, '/E', '/NFL', '/NDL', '/NJH', '/NJS', '/NP')
  if ($xd.Count) { $a += '/XD'; $a += $xd }
  if ($xf.Count) { $a += '/XF'; $a += $xf }
  & robocopy @a | Out-Null
  if ($LASTEXITCODE -ge 8) { Stop-Here "Copying $from failed." }
}

Write-Host "============================================================"
Write-Host "  Build the LGU-SDSS installer  (10-20 minutes)"
if ($WithData) { Write-Host "  Edition: WITH DATA (the current database and CBMS files are copied in)" }
else           { Write-Host "  Edition: EMPTY (no CBMS data - import the CBMS files after installing)" -ForegroundColor Yellow }
Write-Host "============================================================"

# ---- tools -----------------------------------------------------------------
Step "1/7" "Checking the tools ..."
$pgdir = Get-ChildItem "C:\Program Files\PostgreSQL" -Directory -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -match '^\d+$' -and (Test-Path (Join-Path $_.FullName 'bin\pg_ctl.exe')) } |
  Sort-Object { [int]$_.Name } -Descending | Select-Object -First 1
if (-not $pgdir) { Stop-Here "PostgreSQL was not found under C:\Program Files\PostgreSQL." }
Write-Host "  PostgreSQL $($pgdir.Name): $($pgdir.FullName)"

function Find-Iscc {
  foreach ($p in @("${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe", "$env:ProgramFiles\Inno Setup 6\ISCC.exe",
                   "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe")) { if (Test-Path $p) { return $p } }
  return $null
}
$iscc = Find-Iscc
if (-not $iscc -and (Get-Command winget -ErrorAction SilentlyContinue)) {
  Write-Host "  Installing Inno Setup 6 (free) with winget ..."
  & winget install --id JRSoftware.InnoSetup -e --silent --accept-package-agreements --accept-source-agreements --scope user | Out-Host
  $iscc = Find-Iscc
}
if (-not $iscc) { Stop-Here "Inno Setup 6 is needed. Install it from https://jrsoftware.org/isdl.php and run this again." }
Write-Host "  Inno Setup: $iscc"

if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Force -Path $stage, $cache, "$stage\db", "$stage\launcher" | Out-Null

# ---- database copy -----------------------------------------------------------
$pgbin = Join-Path $pgdir.FullName "bin"
$dump = Join-Path $stage "db\lgu_masterdata.sql"
if ($WithData) {
  Step "2/7" "Copying the database ..."
  $sec = Read-Host "Type your PostgreSQL (postgres user) password  (or just press Enter to reuse deploy\initdb\lgu_masterdata.sql)" -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
  $env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  if ($env:PGPASSWORD) {
    & "$pgbin\pg_dump.exe" -U postgres -h localhost --no-owner --no-privileges --encoding=UTF8 -f $dump lgu_masterdata
    if ($LASTEXITCODE -ne 0) { $env:PGPASSWORD = $null; Stop-Here "pg_dump failed (wrong password, or PostgreSQL is not running)." }
    $v = (& "$pgbin\psql.exe" -U postgres -h localhost -d lgu_masterdata -tAc "show server_version_num").Trim()
    if ([int]$v.Substring(0, 2) -gt [int]$pgdir.Name) { Stop-Here "The database runs on a newer PostgreSQL than $($pgdir.FullName)." }
  } else {
    if (-not (Test-Path "deploy\initdb\lgu_masterdata.sql")) { Stop-Here "No password given and deploy\initdb\lgu_masterdata.sql does not exist." }
    Copy-Item "deploy\initdb\lgu_masterdata.sql" $dump
    Write-Host "  Reusing deploy\initdb\lgu_masterdata.sql"
  }
  $env:PGPASSWORD = $null
  Write-Host ("  Saved ({0:N0} MB)" -f ((Get-Item $dump).Length / 1MB))
} else {
  Step "2/7" "Preparing an EMPTY database (tables, the 24 barangays and the user accounts - no households) ..."
  $sec = Read-Host "Type your PostgreSQL (postgres user) password  (or just press Enter to use deploy\installer\empty_db.sql)" -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
  $env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  if ($env:PGPASSWORD) {
    # 1) every table, view and sequence, without rows (old *_backup_* tables left out)
    & "$pgbin\pg_dump.exe" -U postgres -h localhost --schema-only --no-owner --no-privileges --encoding=UTF8 `
        --exclude-table='*_backup_*' -f $dump lgu_masterdata
    if ($LASTEXITCODE -ne 0) { $env:PGPASSWORD = $null; Stop-Here "pg_dump failed (wrong password, or PostgreSQL is not running)." }
    # 2) the reference rows the system needs before any import: barangays, user accounts, settings
    $ref = Join-Path $work "reference_rows.sql"
    & "$pgbin\pg_dump.exe" -U postgres -h localhost --data-only --no-owner --no-privileges --encoding=UTF8 `
        -t 'tbl_barangays*' -t 'tbl_users*' -t 'tbl_system_settings*' -f $ref lgu_masterdata
    if ($LASTEXITCODE -ne 0) { $env:PGPASSWORD = $null; Stop-Here "pg_dump of the barangays and user accounts failed." }
    $utf8 = New-Object Text.UTF8Encoding($false)   # no BOM in the middle of the file
    [IO.File]::AppendAllText($dump, [IO.File]::ReadAllText($ref, $utf8), $utf8)
    [IO.File]::AppendAllText($dump, "`nUPDATE public.tbl_users SET failed_attempts = 0, locked_until = NULL, last_login = NULL;`n", $utf8)
    Remove-Item $ref
    $v = (& "$pgbin\psql.exe" -U postgres -h localhost -d lgu_masterdata -tAc "show server_version_num").Trim()
    if ([int]$v.Substring(0, 2) -gt [int]$pgdir.Name) { Stop-Here "The database runs on a newer PostgreSQL than $($pgdir.FullName)." }
  } else {
    if (-not (Test-Path "deploy\installer\empty_db.sql")) { Stop-Here "No password given and deploy\installer\empty_db.sql does not exist." }
    Copy-Item "deploy\installer\empty_db.sql" $dump
    Write-Host "  Using deploy\installer\empty_db.sql"
  }
  $env:PGPASSWORD = $null
  if (Select-String -Path $dump -Pattern '^COPY public\.tbl_households ' -Quiet) { Stop-Here "The empty database still contains households." }
  Write-Host ("  Saved ({0:N1} MB)" -f ((Get-Item $dump).Length / 1MB))
}
# a Gemini key saved in Account Settings on this PC is personal: never ship it
[IO.File]::AppendAllText($dump, "`nDELETE FROM public.tbl_system_settings WHERE key = 'gemini_api_key';`n", (New-Object Text.UTF8Encoding($false)))
Set-Content -Path (Join-Path $stage "db\EDITION.txt") -Value $(if ($WithData) { "with-data" } else { "empty" }) -Encoding ASCII

# ---- private Python ----------------------------------------------------------
Step "3/7" "Preparing a private Python 3.12 ..."
$pyzip = $null
foreach ($ver in @('3.12.10', '3.12.9', '3.12.8')) {
  $f = Join-Path $cache "python-$ver.zip"
  if (-not (Test-Path $f)) {
    try {
      Write-Host "  Downloading Python $ver ..."
      Invoke-WebRequest -UseBasicParsing "https://www.nuget.org/api/v2/package/python/$ver" -OutFile "$f.part"
      Move-Item "$f.part" $f -Force
    } catch { Remove-Item "$f.part" -ErrorAction SilentlyContinue; continue }
  }
  $pyzip = $f; break
}
if (-not $pyzip) { Stop-Here "Could not download Python from nuget.org (check the internet connection)." }
$tmpx = Join-Path $work "pyx"
if (Test-Path $tmpx) { Remove-Item $tmpx -Recurse -Force }
Expand-Archive $pyzip $tmpx
Move-Item (Join-Path $tmpx "tools") "$stage\python"
Remove-Item $tmpx -Recurse -Force
$vc = @('vcruntime140.dll', 'vcruntime140_1.dll', 'msvcp140.dll', 'msvcp140_1.dll', 'msvcp140_2.dll', 'concrt140.dll')
foreach ($d in $vc) {
  $s = Join-Path "$env:WINDIR\System32" $d
  if ((Test-Path $s) -and -not (Test-Path "$stage\python\$d")) { Copy-Item $s "$stage\python\" }
}
$py = "$stage\python\python.exe"
$env:PYTHONNOUSERSITE = "1"; $env:PYTHONPATH = $null; $env:PYTHONHOME = $null
& $py -E -s -m pip --version | Out-Null
if ($LASTEXITCODE -ne 0) { & $py -E -s -m ensurepip --default-pip | Out-Host }

Step "4/7" "Installing the Python packages (5-10 minutes) ..."
& $py -E -s -m pip install --disable-pip-version-check --no-warn-script-location --cache-dir "$cache\pip" -r "deploy\installer\requirements-lock.txt"
if ($LASTEXITCODE -ne 0) { Stop-Here "Installing the Python packages failed." }
& $py -E -s -c "import flask, psycopg2, pandas, geopandas, pyogrio, shapely, pyproj, matplotlib, kmodes, waitress, networkx, bcrypt, openpyxl; print('  packages OK')"
if ($LASTEXITCODE -ne 0) { Stop-Here "The Python packages do not load." }

# ---- private PostgreSQL ------------------------------------------------------
Step "5/7" "Copying PostgreSQL $($pgdir.Name) ..."
foreach ($d in @('bin', 'lib', 'share')) {
  Copy-Tree (Join-Path $pgdir.FullName $d) "$stage\pgsql\$d" @('pgxs', 'doc', 'pgAdmin 4', 'stackbuilder') @('*.pdb', 'stackbuilder*.exe', 'pgAdmin*')
}
foreach ($d in $vc) {
  $s = Join-Path "$env:WINDIR\System32" $d
  if ((Test-Path $s) -and -not (Test-Path "$stage\pgsql\bin\$d")) { Copy-Item $s "$stage\pgsql\bin\" }
}
& "$stage\pgsql\bin\postgres.exe" --version
if ($LASTEXITCODE -ne 0) { Stop-Here "The copied PostgreSQL does not run." }

# ---- the system --------------------------------------------------------------
Step "6/7" "Copying the system ..."
if ($WithData) {
  Copy-Tree "backend" "$stage\backend" @('__pycache__', 'venv', '.venv') @('.env', '*.pyc')
  Copy-Tree "data" "$stage\data" @('__pycache__', 'imports', 'CDRA') @('*.pyc')
} else {
  # code only: no score files or CBMS-derived tables from this PC
  Copy-Tree "backend" "$stage\backend" @('__pycache__', 'venv', '.venv', 'domain_pipeline_outputs') @('.env', '*.pyc', '*.csv')
  # reference data only: barangay boundaries, hazard maps, roads, facility points (backend\facility_reference.json)
  Copy-Tree "data\geojson" "$stage\data\geojson" @() @('housing_units.geojson')
  Copy-Tree "data\spatial" "$stage\data\spatial"
  Copy-Item "data\*.py" "$stage\data\"
  $bad = @(Get-ChildItem "$stage\data", "$stage\backend" -Recurse -File -Include *.csv, *.xlsx, *.xls, *.sqlite)
  if ($bad.Count) { Stop-Here ("CBMS data files ended up in the empty installer: " + ($bad.FullName -join ", ")) }
}
Copy-Item "deploy\serve.py" "$stage\backend\serve.py"
Copy-Item "deploy\installer\launcher\lgu_sdss.py", "deploy\installer\lgu.ico" "$stage\launcher\"

# website: rebuild from the current source when Node is available, else use frontend_dist
$built = $false
if (Get-Command npm -ErrorAction SilentlyContinue) {
  Write-Host "  Building the website from the current source ..."
  $web = Join-Path $work "web"
  if (Test-Path $web) { Remove-Item $web -Recurse -Force }
  Copy-Tree "frontend" $web @('dist', 'node_modules') @()  # fresh npm ci: a copied node_modules can be incomplete (OneDrive)
  Get-ChildItem "$web\src" -Recurse -Include *.js, *.jsx, *.ts, *.tsx | ForEach-Object {
    $t = [IO.File]::ReadAllText($_.FullName)
    $n = [regex]::Replace($t, 'https?://(127\.0\.0\.1|localhost):5000', '')
    if ($n -ne $t) { [IO.File]::WriteAllText($_.FullName, $n, (New-Object Text.UTF8Encoding($false))) }
  }
  Push-Location $web
  if (-not (Test-Path "node_modules")) { & npm ci --no-audit --no-fund | Out-Host }
  & npm run build | Out-Host
  $ok = ($LASTEXITCODE -eq 0) -and (Test-Path "dist\index.html")
  Pop-Location
  if ($ok) { Copy-Tree "$web\dist" "$stage\frontend_dist"; $built = $true }
  else { Write-Host "  Website build failed - using the prebuilt frontend_dist instead." -ForegroundColor Yellow }
}
if (-not $built) {
  if (-not (Test-Path "frontend_dist\index.html")) { Stop-Here "No website: install Node.js or keep the frontend_dist folder." }
  Copy-Tree "frontend_dist" "$stage\frontend_dist"
}

# quick self-test: the backend imports with the private Python
Push-Location "$stage\backend"
& $py -E -s -c "import serve; print('  backend OK')"
$ok = $LASTEXITCODE -eq 0
Pop-Location
if (-not $ok) { Stop-Here "The backend does not start with the private Python (see the error above)." }
Get-ChildItem $stage -Recurse -Directory -Filter "__pycache__" | Where-Object { $_.FullName -notlike "*\python\*" } | Remove-Item -Recurse -Force

# ---- installer ---------------------------------------------------------------
Step "7/7" "Packing LGU-SDSS-Setup.exe (5-10 minutes) ..."
$ver = Get-Date -Format "yyyy.MM.dd"
$outName = if ($WithData) { "LGU-SDSS-Setup-with-data" } else { "LGU-SDSS-Setup" }
& $iscc /Qp "/DStage=$stage" "/DOutDir=$root" "/DAppVersion=$ver" "/DOutName=$outName" "deploy\installer\lgu_sdss.iss"
if ($LASTEXITCODE -ne 0) { Stop-Here "Inno Setup could not build the installer." }
$exe = Join-Path $root "$outName.exe"
Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host ("  Done: {0}  ({1:N0} MB)" -f $exe, ((Get-Item $exe).Length / 1MB)) -ForegroundColor Green
if ($WithData) { Write-Host "  It contains REAL CBMS household data - share it privately." }
else {
  Write-Host "  EMPTY edition: no household data inside. After installing, sign in and"
  Write-Host "  import the CBMS files (Households -> Import CBMS files)."
}
Write-Host "============================================================" -ForegroundColor Green
Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
