"""Verify public scanner history and operator read access without placing orders."""
import json
import math
import time
from urllib.request import Request, urlopen
from hosted_login import ORIGIN, login_headers

with urlopen('http://127.0.0.1:4318/api/public/scanners/detail?base=BTC&venue=all', timeout=50) as response:
    result = json.load(response)
assert result['base'] == 'BTC'
assert abs(time.time()*1000-result['asOf']) < 90000
assert {row['venue'] for row in result['venues']} == {'lighter', 'hyperliquid'}
for row in result['venues']:
    funding = row['funding']
    assert funding['sampleCount'] == len(funding['samples'])
    assert len({point['time'] for point in funding['samples']}) == funding['sampleCount']
    if funding['status'] == 'ok':
        assert funding['sampleCount'] == funding['expectedSamples'] == 24
        assert math.isclose(funding['actual24h'], sum(point['rate'] for point in funding['samples']), abs_tol=1e-12)
    else:
        assert funding['actual24h'] is None
    if row['currentFundingHourly'] is not None:
        assert math.isclose(row['projected24hFunding'], row['currentFundingHourly']*24, abs_tol=1e-12)
    points = row['price']['points']
    assert points and all(point['close'] > 0 for point in points)
    assert all(point['relativeStrengthPp'] is None or abs(point['relativeStrengthPp']) < 1e-9 for point in points)
    print(row['venue'], 'funding:', funding['status'], funding['sampleCount'], 'price points:', len(points))
with urlopen(Request(ORIGIN+'/_quanttrade/api/arbitrage', headers=login_headers()), timeout=30) as response:
    assert response.status == 200
    json.load(response)
print('Scanner history and authenticated paired-plan reads verified; no order actions.')
