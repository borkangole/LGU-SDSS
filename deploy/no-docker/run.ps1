# LGU-SDSS - start the system (no Docker)
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)   # repo root (this script is in deploy\no-docker)
Set-Location $root
$vpy = Join-Path $root ".venv\Scripts\python.exe"
if (-not (Test-Path $vpy) -or -not (Test-Path "backend\.env")) {
  Write-Host "Run SETUP-NO-DOCKER.bat first (one time)." -ForegroundColor Red
  Read-Host "Press Enter to close"; exit 1
}
if (-not (Test-Path "frontend_dist\index.html")) {
  Write-Host "The folder frontend_dist is missing from the package." -ForegroundColor Red
  Read-Host "Press Enter to close"; exit 1
}
Get-Service -Name "postgresql*" -ErrorAction SilentlyContinue | Where-Object { $_.Status -ne 'Running' } | ForEach-Object {
  try { Start-Service $_.Name; Start-Sleep 3 } catch { Write-Host "Could not start PostgreSQL ($($_.Name)). Start it from Services." -ForegroundColor Yellow }
}
$port = 8080
$busy = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
if ($busy) {
  try { Invoke-WebRequest -UseBasicParsing "http://localhost:$port/api/health" -TimeoutSec 3 | Out-Null
        Write-Host "LGU-SDSS is already running. Opening it ..."; Start-Process "http://localhost:$port"; exit 0 } catch { }
  $port = 8090
}
$env:PORT = "$port"
$env:HOST = "127.0.0.1"
$env:FRONTEND_DIST = Join-Path $root "frontend_dist"
$env:PYTHONPATH = Join-Path $root "backend"
$env:PYTHONIOENCODING = "utf-8"
$env:MPLBACKEND = "Agg"
$env:TZ = "Asia/Manila"

Write-Host "Starting LGU-SDSS ... keep this window open while you use it (close it to stop)."
$null = Start-Job -ArgumentList $port -ScriptBlock {
  param($p)
  for ($i = 0; $i -lt 90; $i++) {
    try { Invoke-WebRequest -UseBasicParsing "http://localhost:$p/api/health" -TimeoutSec 2 | Out-Null; Start-Process "http://localhost:$p"; return } catch { Start-Sleep 2 }
  }
}
Set-Location (Join-Path $root "backend")
& $vpy (Join-Path $root "deploy\serve.py")
Write-Host ""
Write-Host "LGU-SDSS stopped (see the messages above if this was unexpected)." -ForegroundColor Yellow
Read-Host "Press Enter to close"
