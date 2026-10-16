"""Verify both native Lighter order scopes and the local journal bundle; read-only."""
import json
from pathlib import Path
from urllib.request import Request, urlopen

root = Path('/opt/quanttrade/current')
token = Path('/opt/quanttrade/shared/data/operator-token').read_text().strip()
for kind in ('perpetual', 'spot'):
    request = Request('http://127.0.0.1:4318/api/terminal/open-orders',
                      data=json.dumps({'venue': 'lighter', 'marketType': kind}).encode(),
                      headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token})
    with urlopen(request, timeout=45) as response:
        result = json.load(response)
    assert result['complete'] is True and isinstance(result['orders'], list)
    assert result['marketType'] == kind and result['scope'] == f'all-{kind}-markets'
scripts = [p.read_text(errors='replace') for p in (root / 'frontend/assets').glob('*.js')]
for marker in ('quanttrade:device-trade-journal:v1', 'manually-logged-trades', 'completeExchangeHistory'):
    assert any(marker in script for script in scripts), marker
print('Lighter spot/perpetual order reads complete and device-only manual journal bundle verified; no orders or journal entries changed.')
