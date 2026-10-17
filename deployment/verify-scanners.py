"""Read-only scanner contract and source checks; never touches account state."""
import json
import math
import time
from pathlib import Path
from urllib.request import Request, urlopen

with urlopen('http://127.0.0.1:4318/api/public/scanners', timeout=45) as response:
    assert response.status == 200
    result = json.load(response)
assert abs(time.time()*1000-result['asOf']) < 90000
assert result['refreshAfterMs'] == 30000
sources = {row['id']: row for row in result['sources']}
for venue in ('hyperliquid', 'lighter'):
    assert sources[venue]['status'] == 'ok' and sources[venue]['count'] > 0
    assert any(row['venue'] == venue for row in result['markets'])
for row in result['markets']:
    assert row['symbol'] == row['base']+'-USDC'
    assert row['price'] > 0 and math.isfinite(row['price'])
    assert row['oiToVolume'] is None or math.isfinite(row['oiToVolume'])
for row in result['comparisons']:
    a, b = row['hyperliquid'], row['lighter']
    assert a['base'] == b['base'] == row['base']
    assert abs(a['observedAt']-b['observedAt']) <= 30000
    assert math.isclose(row['markGapPct'], abs(a['price']-b['price'])/((a['price']+b['price'])/2)*100, rel_tol=1e-9, abs_tol=1e-9)
    if row['longVenue'] is not None:
        assert row[row['longVenue']]['fundingHourly'] < row[row['shortVenue']]['fundingHourly']
assert any(row['status'] == 'ok' for row in result['options']['sources'] if row['id'].endswith('-trades'))
assert result['options']['overview']
for row in result['options']['trades']:
    assert row['blockId'] and row['currency'] in ('BTC', 'ETH')
    if row['premiumUsd'] is not None:
        assert math.isclose(row['premiumUsd'], row['price']*row['amount']*row['indexPrice'])
root = Path('/opt/quanttrade/current')
scripts = [p.read_text(errors='replace') for p in (root/'frontend/assets').glob('*.js')]
for marker in ('scan_markets', 'fundingGapHourly', 'Deribit', 'Discovery scanners', 'Back to Discover'):
    assert any(marker in script for script in scripts), marker
print('Scanner sources:', ', '.join(f"{row['id']}={row['status']} ({row['count']})" for row in result['sources']+result['options']['sources']))
print(f"Verified {len(result['markets'])} venue markets, {len(result['comparisons'])} exact-base comparisons and {len(result['options']['trades'])} sampled block legs; no account actions.")
