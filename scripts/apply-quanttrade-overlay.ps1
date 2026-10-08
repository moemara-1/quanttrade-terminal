$ErrorActionPreference = 'Stop'
$workspacePath = Split-Path -Parent $PSScriptRoot
$checkoutPath = Join-Path $workspacePath 'upstream/pairlens'
$patchPath = Join-Path $workspacePath 'patches/quanttrade.patch'
if (-not (Test-Path -LiteralPath $patchPath)) { return }
$previousPreference = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
git -C $checkoutPath apply --reverse --check $patchPath 2>$null
$alreadyApplied = $LASTEXITCODE -eq 0
$ErrorActionPreference = $previousPreference
if (-not $alreadyApplied) {
    git -C $checkoutPath apply --check $patchPath
    if ($LASTEXITCODE -ne 0) { throw 'QuantTrade patch conflicts with this checkout. Existing work was preserved.' }
    git -C $checkoutPath apply $patchPath
    if ($LASTEXITCODE -ne 0) { throw 'Could not apply QuantTrade patch.' }
}
$additions = Get-Content -Raw -LiteralPath (Join-Path $workspacePath 'patches/quanttrade-files.json') | ConvertFrom-Json
foreach ($relativePath in $additions) {
    $sourcePath = Join-Path $workspacePath ('overlays/pairlens/' + $relativePath)
    $destinationPath = Join-Path $checkoutPath $relativePath
    if (Test-Path -LiteralPath $destinationPath) {
        if ((Get-FileHash -LiteralPath $sourcePath).Hash -ne (Get-FileHash -LiteralPath $destinationPath).Hash) {
            throw "Existing local edit differs from saved overlay: $relativePath. Save the overlay before reinstalling."
        }
        continue
    }
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destinationPath) | Out-Null
    Copy-Item -LiteralPath $sourcePath -Destination $destinationPath
}
