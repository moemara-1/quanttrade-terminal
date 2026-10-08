"""Verify public published data contracts without any trading requests."""
import json
from urllib.request import urlopen
base='https://quanttrade.azurestore.shop'
paths=['/api/news?limit=10','/api/news?tickers=CRYPTO%3ABTC%2CCRYPTO%3AETH&limit=10','/api/earnings-calendar?days=7','/api/ipo-calendar?days=92','/api/economic-calendar?days=31']
for path in paths:
    with urlopen(base+path,timeout=120) as response:
        assert response.status==200
        assert response.headers.get('WWW-Authenticate') is None
        body=json.load(response)
    key='articles' if path.startswith('/api/news') else 'entries'
    assert isinstance(body[key],list) and body['fetchedAt']
    assert body[key], 'Current feed unexpectedly empty: '+path
    print(path.split('?')[0]+': '+str(len(body[key]))+' real entries')
print('News, crypto news, earnings, IPO and macro feeds verified over HTTPS; no trades placed.')
