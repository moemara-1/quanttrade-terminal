param([switch]$CopyToken, [switch]$BuildOnly)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Install Node.js 24 or later first.' }
if ([int]((node --version).TrimStart('v').Split('.')[0]) -lt 24) { throw 'Node.js 24 or later is required.' }
if (-not (Test-Path -LiteralPath 'node_modules/tsx/dist/cli.mjs')) {
    npm.cmd ci --no-fund
    if ($LASTEXITCODE -ne 0) { throw 'Bridge dependency installation failed.' }
}
if (-not (Test-Path -LiteralPath 'upstream/pairlens/package.json')) { & (Join-Path $PSScriptRoot 'scripts/fetch-upstreams.ps1') }
$bunPath = Join-Path $PSScriptRoot '.tools/node_modules/bun/bin/bun.exe'
if (-not (Test-Path -LiteralPath $bunPath)) {
    npm.cmd install --prefix .tools --no-fund --no-audit bun@1.3.8
    if ($LASTEXITCODE -ne 0) { throw 'Bun installation failed.' }
}
$env:PATH = (Split-Path -Parent $bunPath) + [IO.Path]::PathSeparator + $env:PATH
$env:PAIRLENS_STANDALONE = '1'
$terminalPath = Join-Path $PSScriptRoot 'upstream/pairlens'
Push-Location -LiteralPath $terminalPath
try {
    if (-not (Test-Path -LiteralPath 'apps/terminal/node_modules/vite/bin/vite.js')) {
        & $bunPath install --frozen-lockfile
        if ($LASTEXITCODE -ne 0) { throw 'Terminal dependency installation failed.' }
    }
    if ($BuildOnly) {
        & $bunPath run build:terminal
        if ($LASTEXITCODE -ne 0) { throw 'QuantTrade terminal build failed.' }
        return
    }
} finally { Pop-Location }
function Test-LocalService([string]$Url, [switch]$Bridge) {
    try {
        $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3
        if ($Bridge) { $health = $response.Content | ConvertFrom-Json; return $health.ok -eq $true -and $health.service -eq 'quanttrade-bridge' }
        return $response.StatusCode -eq 200 -and ($response.Content -match 'QuantTrade' -or $response.Headers['X-QuantTrade-Terminal'] -eq '1')
    } catch { return $false }
}
function Assert-FreePort([int]$Port) {
    if (Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue) { throw "Port $Port is occupied by an unrecognized service. Stop it before starting QuantTrade." }
}
function Wait-LocalService([string]$Url, [System.Diagnostics.Process]$Process, [switch]$Bridge) {
    $deadline = (Get-Date).AddSeconds(60)
    do {
        if (Test-LocalService $Url -Bridge:$Bridge) { return }
        if ($Process.HasExited) { throw 'QuantTrade process exited. See data/logs for details.' }
        Start-Sleep -Milliseconds 500
    } while ((Get-Date) -lt $deadline)
    throw 'QuantTrade startup timed out. See data/logs for details.'
}
New-Item -ItemType Directory -Force -Path (Join-Path $PSScriptRoot 'data/logs') | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
if (-not (Test-LocalService 'http://127.0.0.1:4318/api/health' -Bridge)) {
    Assert-FreePort 4318
    $bridge = Start-Process -FilePath (Get-Command node).Source -ArgumentList @('--experimental-transform-types', 'src/server/index.ts') -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $PSScriptRoot "data/logs/bridge-$stamp.log") -RedirectStandardError (Join-Path $PSScriptRoot "data/logs/bridge-$stamp.error.log")
    Wait-LocalService 'http://127.0.0.1:4318/api/health' $bridge -Bridge
}
if (-not (Test-LocalService 'http://127.0.0.1:4317')) {
    Assert-FreePort 4317
    $terminal = Start-Process -FilePath $bunPath -ArgumentList @('run', 'dev', '--host', '127.0.0.1', '--port', '4317', '--strictPort') -WorkingDirectory (Join-Path $terminalPath 'apps/terminal') -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $PSScriptRoot "data/logs/terminal-$stamp.log") -RedirectStandardError (Join-Path $PSScriptRoot "data/logs/terminal-$stamp.error.log")
    Wait-LocalService 'http://127.0.0.1:4317' $terminal
}
if ($CopyToken) {
    Set-Clipboard -Value (Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot 'data/operator-token')).Trim()
    Write-Host 'Operator token copied to clipboard. Keep it private; never give it to agents.'
}
Write-Host 'QuantTrade: http://127.0.0.1:4317'
Write-Host 'Bridge runs locally in the background. Logs: data/logs. Operator token: data/operator-token.'
