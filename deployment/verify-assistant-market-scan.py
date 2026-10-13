"""Verify actual native catalog/candle reads without any trading request."""
import json
from urllib.parse import urlencode
from urllib.request import urlopen

base = 'http://127.0.0.1:4318/api/public/'
with urlopen(base + 'markets?' + urlencode({'venue': 'lighter', 'marketType': 'perpetual'}), timeout=30) as response:
    catalog = json.load(response)
for asset in ('BTC', 'SOL', 'ZEC', 'GRAM', 'PRL', 'MEGA', 'STRK', 'GRASS'):
    matches = [row for row in catalog if row['base'] == asset]
    assert len(matches) == 1, 'Missing or ambiguous Lighter asset: ' + asset
    symbol = matches[0]['symbol']
    assert symbol == asset + '-USDC', 'Unexpected native symbol'
    with urlopen(base + 'candles?' + urlencode({'venue': 'lighter', 'marketType': 'perpetual', 'symbol': symbol, 'interval': '1h', 'limit': 30}), timeout=30) as response:
        candles = json.load(response)
    assert isinstance(candles, list) and len(candles) >= 2, 'Insufficient native candle history: ' + asset
print('Native Lighter catalog and hourly candles verified for the eight requested assets; no foreign venue data or trading requests.')
