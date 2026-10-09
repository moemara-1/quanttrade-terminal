"""Verify public recorded liquidation history without credentials or orders."""
import json
import time
from urllib.request import urlopen
from urllib.error import HTTPError

base = 'https://quanttrade.azurestore.shop/api/liquidations'
for venue in ('binance-futures', 'bybit-futures'):
    deadline = time.monotonic() + 120
    while True:
        try:
            with urlopen(f'{base}?venue={venue}&pair=BTC-USDT-USDT&hours=1', timeout=20) as response:
                assert response.headers.get('WWW-Authenticate') is None
                body = json.load(response)
            break
        except HTTPError as error:
            assert error.headers.get('WWW-Authenticate') is None
            refusal = json.load(error)
            assert error.code == 503 and refusal.get('reason') == 'collecting', refusal
            if time.monotonic() >= deadline:
                raise AssertionError(f'{venue} stream never became ready') from error
            time.sleep(3)
    for hours in (1, 6, 24, 72):
        with urlopen(f'{base}?venue={venue}&pair=BTC-USDT-USDT&hours={hours}', timeout=20) as response:
            assert response.status == 200
            assert response.headers.get('WWW-Authenticate') is None
            body = json.load(response)
        assert body['venue'] == venue and body['pairKey'] == 'BTC-USDT-USDT'
        assert body['connected'] is True
        assert body['completeness'] == ('sampled' if venue == 'binance-futures' else 'complete')
        assert 0 < body['trackedSince'] <= body['coverageThrough'] <= int(time.time() * 1000) + 5000
        assert body['retentionMs'] == 72 * 3600000
        assert isinstance(body['buckets'], list) and isinstance(body['coverageGaps'], list)
        print(f'{venue} {hours}h: connected, {len(body["buckets"])} recorded buckets')
print('Public liquidation collector verified; no orders submitted.')
