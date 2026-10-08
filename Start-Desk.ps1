param([switch]$CopyToken)
& (Join-Path $PSScriptRoot 'Start-QuantTrade.ps1') -CopyToken:$CopyToken
