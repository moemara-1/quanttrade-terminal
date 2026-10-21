"""Bounded public reads only; no accounts, credentials or execution."""
import json
from urllib.request import urlopen

for window in ('1d', '7d', '30d'):
    url = 'http://127.0.0.1:4318/api/public/scanners/strength-history?venue=lighter&symbols=BTC-USDC,ETH-USDC&window=' + window
    with urlopen(url, timeout=90) as response:
        result = json.load(response)
    assert result['window'] == window
    assert result['windowEnd'] > result['windowStart']
    assert [row['symbol'] for row in result['series']] == ['BTC-USDC', 'ETH-USDC']
    assert all(row['status'] in ('ok', 'partial') and len(row['points']) > 1 for row in result['series'])
    print('Lighter observed strength history verified: ' + window)
