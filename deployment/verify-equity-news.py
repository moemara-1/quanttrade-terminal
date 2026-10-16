"""Read-only hosted equities news scope and text verification."""
import json
import re
from pathlib import Path
from urllib.request import urlopen

for topics in ('financial_markets', 'financial_markets%2Cearnings'):
    with urlopen('https://quanttrade.azurestore.shop/api/news?topics=' + topics + '&limit=50', timeout=60) as response:
        result = json.load(response)
    if topics == 'financial_markets':
        assert result['articles'], 'Equities wire returned no current headlines'
    for article in result['articles']:
        tags = {topic['topic'] for topic in article['topics']}
        assert 'financial_markets' in tags
        if '%2C' in topics:
            assert 'earnings' in tags
        assert article['sourceDomain'] in ('marketwatch.com', 'cnbc.com')
        assert not re.search(r'&#(?:x[0-9a-f]+|\d+);', article['title'], re.I)
    print(topics + ': ' + str(len(result['articles'])) + ' current publisher headlines')
scripts = [p.read_text(errors='replace') for p in Path('/opt/quanttrade/current/frontend/assets').glob('*.js')]
assert any('financial_markets,earnings' in script for script in scripts)
print('Equities scope and headline decoding verified. Earnings can be empty in the current RSS window; no private reads or trading requests.')
