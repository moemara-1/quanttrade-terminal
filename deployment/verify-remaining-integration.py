"""Read-only advanced execution contract checks; no valid trade/cancel requests."""
from pathlib import Path
import urllib.request, urllib.error, base64, json, hashlib, subprocess
root=Path('/opt/quanttrade/current')
operator=Path('/opt/quanttrade/shared/data/operator-token').read_text().strip()
agent=Path('/opt/quanttrade/shared/data/agent-token').read_text().strip()
for token in (None,agent):
    headers={'Content-Type':'application/json'}
    if token: headers['Authorization']='Bearer '+token
    try:
        urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:4318/api/terminal/native-twap-policy',data=b'{}',headers=headers,method='PUT'),timeout=10)
        raise AssertionError('Agent permitted native risk update')
    except urllib.error.HTTPError as error:
        assert error.code in (401,403),error.code
with urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:4318/api/status',headers={'Authorization':'Bearer '+operator}),timeout=10) as response:
    assert isinstance(json.load(response)['nativeTwapRiskAllowed'],bool)
for path in ('hyperliquid-twap','chase-plans','chase-cancel'):
    for token in (None,agent):
        headers={'Content-Type':'application/json'}
        if token: headers['Authorization']='Bearer '+token
        try:
            urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:4318/api/terminal/'+path,data=b'{}',headers=headers),timeout=10)
            raise AssertionError('Unattended advanced execution accepted')
        except urllib.error.HTTPError as error:
            assert error.code in (401,403),error.code
with urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:4318/api/chase-plans',headers={'Authorization':'Bearer '+operator}),timeout=10) as response:
    assert isinstance(json.load(response)['runs'],list)
fields=dict(line.split('=',1) for line in Path('/opt/quanttrade/hummingbot/.env').read_text().splitlines() if '=' in line)
auth=base64.b64encode((fields['USERNAME']+':'+fields['PASSWORD']).encode()).decode()
with urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:8000/openapi.json',headers={'Authorization':'Basic '+auth}),timeout=10) as response:
    document=json.load(response)
for path in ('hyperliquid-twap','hyperliquid-twap-cancel','hyperliquid-twap-evidence','settled-order-evidence'):
    assert '/quanttrade/trading/'+path in document['paths'],path
expected=hashlib.sha256((root/'deployment/quanttrade-hummingbot-trading.py').read_bytes()).hexdigest()
actual=subprocess.check_output(['docker','exec','quanttrade-hummingbot-api','sha256sum','/hummingbot-api/quanttrade_hummingbot_trading.py'],text=True).split()[0]
assert expected==actual,'Signer runtime hash mismatch'
scripts=[p.read_text(encoding='utf-8',errors='replace') for p in (root/'frontend/assets').glob('*.js')]
for marker in ('prepare_advanced_execution','get_native_twap_evidence','get_advanced_order_capabilities','Confirm complete plan','chase-cancel','Refresh status','Prepare cancellation','native-twap-policy'):
    assert any(marker in script for script in scripts),marker
print('Native TWAP, managed Chase, fill evidence, runtime hash and human-only approval guards verified; no orders or cancellations submitted.')
