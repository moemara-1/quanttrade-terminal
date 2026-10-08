$ErrorActionPreference = 'Stop'
$workspacePath = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $workspacePath
$sources = Get-Content -Raw -LiteralPath 'upstream-lock.json' | ConvertFrom-Json
New-Item -ItemType Directory -Force -Path 'upstream' | Out-Null
foreach ($entry in $sources.PSObject.Properties) {
    $checkoutPath = Join-Path 'upstream' $entry.Name
    if (Test-Path -LiteralPath $checkoutPath) {
        Write-Host "Keeping existing checkout: $checkoutPath"
        continue
    }
    git init $checkoutPath
    if ($LASTEXITCODE -ne 0) { throw "Cannot create $checkoutPath" }
    git -C $checkoutPath remote add origin $entry.Value.url
    if ($LASTEXITCODE -ne 0) { throw 'Cannot add upstream remote.' }
    git -C $checkoutPath fetch --depth 1 origin $entry.Value.revision
    if ($LASTEXITCODE -ne 0) { throw 'Cannot fetch pinned revision.' }
    git -C $checkoutPath checkout --detach FETCH_HEAD
    if ($LASTEXITCODE -ne 0) { throw 'Cannot check out pinned revision.' }
}
& (Join-Path $PSScriptRoot 'apply-quanttrade-overlay.ps1')
