"""Read-only check of hosted DASH matching and explicit feed coverage."""
import json
import urllib.request

url = 'https://quanttrade.azurestore.shop/_quanttrade/api/news?tickers=CRYPTO%3ADASH&limit=5'
with urllib.request.urlopen(url, timeout=30) as response:
    assert response.status == 200
    result = json.load(response)
coverage = result['coverage']
assert coverage['normalizedTickers'] == ['CRYPTO:DASH']
assert coverage['matchingStatus'] == 'supported'
assert coverage['unsupportedTickers'] == []
assert coverage['exhaustive'] is False
assert coverage['archiveSearched'] is False
assert coverage['articleBodiesSearched'] is False
assert coverage['cachedArticleCount'] >= len(result['articles'])
print('Hosted DASH identity and bounded headline-feed coverage verified; no execution requests.')
