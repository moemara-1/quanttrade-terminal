"""Read-only live Hyperliquid connection checks. Never sends an order."""
import json
import re
from urllib.request import Request, urlopen
from hosted_login import login_headers

origin = 'https://quanttrade.azurestore.shop'
headers = {**login_headers(), 'Origin': origin, 'Content-Type': 'application/json'}

def read(path, body=None):
    request = Request(origin + '/_quanttrade/api/' + path,
                      data=None if body is None else json.dumps(body).encode(), headers=headers)
    with urlopen(request, timeout=60) as response:
        assert response.status == 200
        return json.load(response)

connections = read('connections')
connection = next(row for row in connections if row['venue'] == 'hyperliquid')
assert connection['connected'] and connection['spotConnected'] and connection['mode'] == 'live'
status = read('status')
assert re.fullmatch('[a-f0-9]{64}', status['connectionRevisions']['hyperliquid'])
for market in ('perpetual', 'spot'):
    balances = read('connections/hyperliquid/balances?marketType=' + market)
    assert isinstance(balances, list)
    orders = read('terminal/open-orders', {'venue': 'hyperliquid', 'marketType': market})
    assert orders['accountName'] == connection['accountName']
    assert orders['connectionRevision'] == status['connectionRevisions']['hyperliquid']
    assert isinstance(orders['orders'], list)
    if market == 'spot':
        assert orders['scope'] == 'all-spot-markets' and orders['complete']
    else:
        assert orders['scope'] == 'standard-perpetual-markets'
        assert not orders['complete'] and orders.get('error')
    print('Hyperliquid ' + market + ': verified connection, balances and native order read; no orders submitted.')
