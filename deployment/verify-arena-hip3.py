"""Read-only release checks. Never starts a bot or submits an exchange action."""
import base64
import json
from pathlib import Path
from urllib.request import Request, urlopen

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
assert arena['capabilities'] == {'paper': True, 'live': False}
assert isinstance(arena['bots'], list)
assert read('/llm-arena/models')['models']
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
paper = next(row for row in official['universe'] if row['name'] == 'para:PAPER')
assert any(row['symbol'] == 'para:PAPER-USDC' for row in markets) is not bool(paper.get('isDelisted'))
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
print('Paper-only arena, TIA news coverage, active builder quotes/candles and exact connector readiness verified; PAPER delisting respected; no bot or order started.')
