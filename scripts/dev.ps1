param([switch]$Stop)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$runtimeDir = Join-Path $projectRoot '.run'
$pidFile = Join-Path $runtimeDir 'processes.json'
if ($Stop) {
    if (Test-Path -LiteralPath $pidFile) {
        $entries = Get-Content -LiteralPath $pidFile -Raw | ConvertFrom-Json
        foreach ($entry in $entries) {
            try { $process = Get-Process -Id $entry.pid -ErrorAction Stop }
            catch [Microsoft.PowerShell.Commands.ProcessCommandException] { continue }
            $recordedTicks = if ($entry.started_ticks) { [long]$entry.started_ticks }
                elseif ($entry.started -is [datetime]) { $entry.started.ToUniversalTime().Ticks }
                else { [DateTimeOffset]::Parse($entry.started).UtcDateTime.Ticks }
            if ($process.StartTime.ToUniversalTime().Ticks -eq $recordedTicks) {
                # A PID alone is not sufficient: do not stop a process which reused it.
                & taskkill.exe /PID $process.Id /T /F | Out-Null
                if ($LASTEXITCODE -ne 0) { throw "Could not stop ORACLE process $($process.Id)." }
            }
        }
        Remove-Item -LiteralPath $pidFile
    }
    Write-Host 'ORACLE launch processes stopped.'
    exit
}
if (Test-Path -LiteralPath $pidFile) {
    throw 'A launch record exists. Run scripts/dev.ps1 -Stop before starting again.'
}
foreach ($port in @(8011, 5181)) {
    # Loopback probing needs no WMI privileges and must not hide an access error.
    $probe = [System.Net.Sockets.TcpClient]::new()
    try {
        $connection = $probe.ConnectAsync('127.0.0.1', $port)
        $occupied = $connection.Wait(500) -and $probe.Connected
    } catch { $occupied = $false }
    finally { $probe.Dispose() }
    if ($occupied) {
        throw "Port $port is occupied. Stop the existing ORACLE instance or configure alternate ports."
    }
}
$pythonPath = Join-Path $projectRoot '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $pythonPath)) { throw 'Install the backend .venv first. See README.md.' }
$nodePath = (Get-Command node -ErrorAction Stop).Source
$vitePath = Join-Path $projectRoot 'frontend\node_modules\vite\bin\vite.js'
if (-not (Test-Path -LiteralPath $vitePath)) { throw 'Run pnpm install in frontend first.' }
New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null
$backendProcess = Start-Process -FilePath $pythonPath -ArgumentList @('-m', 'uvicorn', 'oracle.api:app', '--host', '127.0.0.1', '--port', '8011') -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $runtimeDir 'backend.log') -RedirectStandardError (Join-Path $runtimeDir 'backend-error.log') -PassThru
try {
    $quotedVitePath = '"' + $vitePath + '"'
    $frontendProcess = Start-Process -FilePath $nodePath -ArgumentList @($quotedVitePath, '--host', '127.0.0.1') -WorkingDirectory (Join-Path $projectRoot 'frontend') -WindowStyle Hidden -RedirectStandardOutput (Join-Path $runtimeDir 'frontend.log') -RedirectStandardError (Join-Path $runtimeDir 'frontend-error.log') -PassThru
} catch {
    & taskkill.exe /PID $backendProcess.Id /T /F | Out-Null
    throw
}
# Save ownership before validation, so failed cleanup still has a recoverable PID record.
@($backendProcess, $frontendProcess) | ForEach-Object {
    @{ pid = $_.Id; started_ticks = $_.StartTime.ToUniversalTime().Ticks.ToString() }
} | ConvertTo-Json | Set-Content -LiteralPath $pidFile -Encoding utf8
# Detect failed binding / early exit before claiming the application has started.
Start-Sleep -Milliseconds 750
$backendProcess.Refresh()
$frontendProcess.Refresh()
if ($backendProcess.HasExited -or $frontendProcess.HasExited) {
    foreach ($process in @($backendProcess, $frontendProcess)) {
        if (-not $process.HasExited) { & taskkill.exe /PID $process.Id /T /F | Out-Null }
    }
    throw 'ORACLE startup failed. Inspect .run/backend-error.log and .run/frontend-error.log.'
}
Write-Host 'ORACLE: http://127.0.0.1:5181 · API: http://127.0.0.1:8011/docs'
Write-Host 'Logs: .run/ · Stop: ./scripts/dev.ps1 -Stop'
