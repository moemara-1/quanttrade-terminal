param([switch]$CopyToken, [switch]$BuildOnly)
& (Join-Path $PSScriptRoot 'Start-QuantTrade.ps1') @PSBoundParameters
