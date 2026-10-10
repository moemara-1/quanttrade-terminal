"""Read-only native order wiring and unauthorized-write checks; no live submission."""
from pathlib import Path
import urllib.request, urllib.error, json
url='http://127.0.0.1:4318/api/terminal/lighter-native-orders'
for name in ('operator-token', 'agent-token'):
    headers={'Content-Type':'application/json'}
    if name=='agent-token':
        headers['Authorization']='Bearer '+Path('/opt/quanttrade/shared/data/agent-token').read_text().strip()
    try:
        urllib.request.urlopen(urllib.request.Request(url,data=b'{}',headers=headers),timeout=10)
        raise AssertionError('Unattended native order request accepted')
    except urllib.error.HTTPError as error:
        assert error.code in (401,403), error.code
operator=Path('/opt/quanttrade/shared/data/operator-token').read_text().strip()
with urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:4318/api/status',headers={'Authorization':'Bearer '+operator}),timeout=10) as response:
    status=json.load(response)
assert 'lighter' in status['connectionRevisions']
scripts=[path.read_text(errors='replace') for path in Path('/opt/quanttrade/current/frontend/assets').glob('*.js')]
for marker in ('prepare_lighter_native_order','lighter-native-orders','connectionRevision','Confirm native order','Native submission accepted','nativeClientOrderIds'):
    assert any(marker in script for script in scripts), marker
print('Native Lighter approval wiring, revision status and private write guards verified; no orders submitted.')
