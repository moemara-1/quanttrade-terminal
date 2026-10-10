"""Read-only production checks; never submit exchange credentials or orders."""
from pathlib import Path
import urllib.request, urllib.error, urllib.parse, json
private_paths=['/quanttrade/trading/lighter-native-orders','/quanttrade/trading/bracket-orders','/quanttrade/trading/entry-bracket-orders','/quanttrade/trading/order-evidence','/quanttrade/trading/market-orders','/quanttrade/trading/leverage','/quanttrade/trading/margin','/quanttrade/trading/trigger-orders','/quanttrade/trading/cancel-order','/quanttrade/trading/amend-order','/quanttrade/trading/snapshot','/quanttrade/connections/desk/lighter']
for path in private_paths:
    req=urllib.request.Request('http://127.0.0.1:8000'+path,data=b'{}',headers={'Content-Type':'application/json'})
    try:
        urllib.request.urlopen(req,timeout=10)
        raise AssertionError('Unauthenticated extension accepted a request: '+path)
    except urllib.error.HTTPError as error:
        assert error.code==401,(path,error.code)
print(f'All {len(private_paths)} private extension routes require authentication.')
base='http://127.0.0.1:4318/api/public'
for venue in ['hyperliquid','lighter']:
    for market_type in ['perpetual','spot']:
        query='venue='+venue+'&marketType='+market_type
        with urllib.request.urlopen(base+'/markets?'+query,timeout=30) as response: markets=json.load(response)
        assert markets and all(m.get('marketType','perpetual')==market_type for m in markets)
        chosen=markets[0]['symbol']
        params=query+'&symbol='+urllib.parse.quote(chosen)+'&interval=1h'
        for route in ['book','candles']:
            with urllib.request.urlopen(base+'/'+route+'?'+params,timeout=30) as response: body=json.load(response)
            assert body
            if route=='book':assert body['bids'] and body['asks']
        print(venue+' '+market_type+': '+str(len(markets))+' markets; book and candles verified for '+chosen)
frontend=Path('/opt/quanttrade/current/frontend/assets')
assert any('nanogpt-inference' in path.read_text(errors='replace') for path in frontend.glob('*.js'))
print('Production frontend contains the NanoGPT provider. No trades placed.')
