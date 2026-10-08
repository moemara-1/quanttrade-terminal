param([switch]$Token,[switch]$Hummingbot)
$ErrorActionPreference='Stop'
$sshArgs=@('-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','IdentitiesOnly=yes','-o','ExitOnForwardFailure=yes','-o','ServerAliveInterval=30','-o','UserKnownHostsFile=C:/Users/User/Documents/AzureSynthetics/.hetzner-ssh/known_hosts_azure_prod_02','-i','C:/Users/User/Documents/AzureSynthetics/.hetzner-ssh/codex_azure_prod_ed25519')
if ($Token) {
    $operatorToken=& ssh @sshArgs root@167.233.56.222 'cat /opt/quanttrade/shared/data/operator-token'
    if ($LASTEXITCODE -ne 0) {throw 'Could not retrieve the operator token.'}
    Set-Clipboard -Value ($operatorToken -join '').Trim()
    Write-Host 'Operator token copied to clipboard. Paste it into QuantTrade Agent Inbox or exchange credentials.'
    exit
}
Write-Host 'Hetzner QuantTrade: http://127.0.0.1:4317 . Keep this window open.'
$forwardArgs=@('-N','-L','127.0.0.1:4317:127.0.0.1:4317')
if ($Hummingbot) {
    $forwardArgs+=@('-L','127.0.0.1:8000:127.0.0.1:8000')
    Write-Host 'Private Hummingbot API documentation: http://127.0.0.1:8000/docs'
}
& ssh @sshArgs @forwardArgs root@167.233.56.222
if ($LASTEXITCODE -ne 0) {throw 'SSH tunnel failed; check whether port 4317 is already in use.'}
