"""Read current native orders and access guards without cancelling anything."""
from pathlib import Path
import json
import urllib.request
import urllib.error

base = 'http://127.0.0.1:4318'
token = Path('/opt/quanttrade/shared/data/operator-token').read_text().strip()
agent = Path('/opt/quanttrade/shared/data/agent-token').read_text().strip()
payload = json.dumps({'venue': 'lighter', 'marketType': 'perpetual'}).encode()
for credential in (None, agent, token):
    headers = {'Content-Type': 'application/json'}
    if credential:
        headers['Authorization'] = 'Bearer ' + credential
    request = urllib.request.Request(base + '/api/terminal/open-orders', data=payload, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=45) as response:
            result = json.load(response)
        assert credential == token, 'Non-operator access permitted'
        assert result['venue'] == 'lighter' and result['marketType'] == 'perpetual'
        assert result['accountName'] and len(result['connectionRevision']) == 64
        assert isinstance(result['complete'], bool) and isinstance(result['orders'], list)
        for order in result['orders']:
            assert order['exchangeOrderId'].isdigit() and int(order['exchangeOrderId']) > 0
            assert order['symbol'].endswith('-USDC')
        assert result['complete'], 'Native market identities could not all be mapped'
    except urllib.error.HTTPError as error:
        assert credential != token, 'Operator native order read failed: HTTP ' + str(error.code)
        assert error.code in (401, 403), error.code
print('Fresh native Lighter open-order discovery and operator access verified; no orders cancelled or created.')
