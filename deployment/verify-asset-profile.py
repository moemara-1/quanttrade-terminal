"""Verify hosted, read-only fundamentals without sending an inference or order request."""
import json
import urllib.request
from pathlib import Path

token = Path('/opt/quanttrade/shared/data/operator-token').read_text().strip()
url = 'https://quanttrade.azurestore.shop/_quanttrade/api/asset-profile?action=profile&id=zcash'
request = urllib.request.Request(url, headers={'Authorization': 'Bearer ' + token})
with urllib.request.urlopen(request, timeout=12) as response:
    assert response.status == 200
    result = json.load(response)
assert result['id'] == 'zcash' and result['symbol'].lower() == 'zec'
assert isinstance(result.get('market_data'), dict)
assert result['market_data'].get('last_updated') or result.get('last_updated')
print('Hosted asset profile verified: exact Zcash identity and provider timestamp; no account or execution requests.')
