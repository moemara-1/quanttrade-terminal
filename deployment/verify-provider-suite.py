"""Read-only HTTPS provider release verification. No orders or provider charges."""
from hosted_login import login_headers
headers=login_headers()
import base64, hashlib, json
from pathlib import Path
from urllib.request import Request, urlopen
origin = 'https://quanttrade.azurestore.shop'
frontend = Path('/opt/quanttrade/current/frontend')
paths = ['posters/hyperliquid-market-connector.png', 'posters/lighter-market-connector.svg', 'posters/nanogpt-inference.svg']
paths += ['assets/'+p.name for p in sorted((frontend/'assets').glob('*.js'), key=lambda p:p.stat().st_size, reverse=True)[:3]]
for path in paths:
    with urlopen(Request(origin+'/'+path, headers=headers),timeout=90) as response:
        content=response.read()
    assert hashlib.sha256(content).digest()==hashlib.sha256((frontend/path).read_bytes()).digest(),path
print('Official provider logos and three largest JavaScript assets match over HTTPS.')
for query in ['venue=hyperliquid&action=market-stats&coin=BTC&limit=2','venue=lighter&action=funding-rates&limit=2']:
    with urlopen(origin+'/_quanttrade/api/public/research?'+query,timeout=30) as response:
        result=json.load(response)
    assert result['data'] and result['observedAt'] and result['venue']
print('Hosted Hyperliquid and Lighter research endpoints returned current data. No trades placed.')
