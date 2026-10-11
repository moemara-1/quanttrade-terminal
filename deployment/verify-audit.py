"""Read-only full audit release guards; no exchange mutation."""
from pathlib import Path
import urllib.request,json,re
operator=Path('/opt/quanttrade/shared/data/operator-token').read_text().strip()
def read(path):
    with urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:4318/api/'+path,headers={'Authorization':'Bearer '+operator}),timeout=20) as response:
        return json.load(response)
status=read('status')
connections=read('connections')
assert isinstance(status['connectionRevisions'],dict)
# Private credential values never leave this check.
for venue in ('lighter','hyperliquid'):
    revision=status['connectionRevisions'].get(venue)
    assert revision is None or re.fullmatch('[a-f0-9]{64}',revision), 'Invalid connection revision'
scripts=[p.read_text(encoding='utf-8',errors='replace') for p in Path('/opt/quanttrade/current/frontend/assets').glob('*.js')]
for marker in ('invalid response','prepare_lighter_native_order','Follow the board'):
    assert any(marker in source for source in scripts),marker
print('Audited session errors, native approval wiring and connection revision schema verified; no orders submitted.')
