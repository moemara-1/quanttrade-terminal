"""Read-only production PRL controls and market identity verification."""
import json
from urllib.request import urlopen
with urlopen('https://quanttrade.azurestore.shop/_quanttrade/api/public/markets?venue=lighter&marketType=perpetual',timeout=60) as response:
    markets=json.load(response)
prl=next(row for row in markets if row['symbol']=='PRL-USDC')
assert prl['maxLeverage']==3,prl['maxLeverage']
assert prl['sizeDecimals']==2 and prl['priceDecimals']==4
assert float(prl['minSize'])==5 and float(prl['minNotional'])==10
assert prl['marketId']==4097
assert all(row.get('maxLeverage') is None or 1<=row['maxLeverage']<=125 for row in markets)
print('Lighter PRL: 3x, size precision 2, price precision 4, minimum 5 PRL / 10 USDC; catalog limits validated.')
