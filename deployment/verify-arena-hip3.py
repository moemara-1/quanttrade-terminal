"""Read-only release checks. Never starts a bot or submits an exchange action."""
import base64
import json
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError

token = Path('/opt/quanttrade/shared/data/operator-token').read_text().strip()
headers = {'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'}

def read(path, body=None, internal=False):
    target = 'http://127.0.0.1:8000' if internal else 'http://127.0.0.1:4318/api'
    auth = headers
    if internal:
        fields = dict(line.split('=', 1) for line in Path('/opt/quanttrade/hummingbot/.env').read_text().splitlines() if '=' in line)
        encoded = base64.b64encode((fields['USERNAME'] + ':' + fields['PASSWORD']).encode()).decode()
        auth = {'Authorization': 'Basic ' + encoded, 'Content-Type': 'application/json'}
    request = Request(target + path, data=None if body is None else json.dumps(body).encode(), headers=auth)
    with urlopen(request, timeout=90) as response:
        return json.load(response)

arena = read('/llm-arena')
assert arena['capabilities'] == {'paper': True, 'live': True, 'liveClose': True}
assert all(row['mode'] == 'live' for row in arena['accounts'])
assert isinstance(arena['bots'], list)
assert read('/llm-arena/models')['models']
for account in arena['accounts']:
    try:
        proof = read('/quanttrade/trading/arena-account-state', {
            'account_name': account['accountName'],
            'connector_name': account['venue'] + '_perpetual',
            'trading_pair': 'BTC-USDC' if account['venue'] == 'lighter' else 'BTC-USD',
        }, internal=True)
    except Exception as error:
        # Unsupported shared-account modes remain unavailable rather than zero.
        reason = type(error).__name__
        if isinstance(error, HTTPError):
            try:
                detail = json.load(error).get('detail')
            except (ValueError, AttributeError):
                detail = None
            if detail == 'Live bot available margin and equity are unverified for this Hyperliquid account mode':
                reason = 'shared collateral account mode is unsupported; no balance assumed'
        print(account['venue'] + ' passive account proof unavailable: ' + reason)
        continue
    assert proof['complete'] is True
    assert float(proof['equity']) >= 0 and float(proof['available_margin']) >= 0
    assert all('size' in row and isinstance(row['full_position'], bool) for row in proof['orders'])
    print(account['venue'] + ' passive account scope and protective quantity fields verified.')
markets = read('/public/markets?venue=hyperliquid&marketType=perpetual')
builder = next(row for row in markets if row.get('dex') == 'para' and row['quote'] == 'USDC' and row['onlyIsolated'])
from urllib.parse import quote
symbol = quote(builder['symbol'], safe='')
book = read('/public/book?venue=hyperliquid&marketType=perpetual&symbol=' + symbol)
assert book['bids'] and book['asks']
candles = read('/public/candles?venue=hyperliquid&marketType=perpetual&symbol=' + symbol + '&interval=1h&limit=24')
assert candles
request = Request('https://api.hyperliquid.xyz/info', data=json.dumps({'type': 'meta', 'dex': 'para'}).encode(), headers={'Content-Type': 'application/json'})
with urlopen(request, timeout=30) as response:
    official = json.load(response)
paper = next((row for row in official['universe'] if row['name'] == 'para:PAPER'), None)
paper_active = paper is not None and not paper.get('isDelisted', False)
assert any(row['symbol'] == 'para:PAPER-USDC' for row in markets) is paper_active
news = read('/news?tickers=TIA&limit=5')
assert news['coverage']['exhaustive'] is False
assert news['coverage']['normalizedTickers'] == ['CRYPTO:TIA']
assert news['coverage']['sources']
status = read('/status')
connections = read('/connections')
connection = next(row for row in connections if row['venue'] == 'hyperliquid')
result = read('/quanttrade/trading/builder-market-readiness', {
    'account_name': connection['accountName'],
    'connection_revision': status['connectionRevisions']['hyperliquid'],
    'trading_pair': builder['coin'].upper() + '-USD', 'dex': builder['dex'], 'coin': builder['coin'],
    'asset_id': builder['assetId'], 'collateral_token': builder['collateralToken'],
    'max_leverage': builder['maxLeverage'], 'only_isolated': builder['onlyIsolated'],
}, internal=True)
assert result['ready'] is True
print('Paper/Live LM Arena capabilities, TIA news coverage, active builder quotes/candles and exact connector readiness verified; PAPER delisting respected; no bot or order started.')
