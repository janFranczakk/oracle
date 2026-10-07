param([switch]$Smoke, [string]$Root)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$pythonPath = Join-Path $projectRoot '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $pythonPath)) { throw 'Install the locked backend and CPU ML dependencies first. See README.' }
if (-not $Root) { $Root = $projectRoot }
$profile = if ($Smoke) { 'smoke' } else { 'demo' }
& $pythonPath -m oracle.setup_demo --root $Root --profile $profile
if ($LASTEXITCODE -ne 0) { throw 'Demo setup failed; existing artifacts were preserved.' }
