"""Read the actual activity sources; never submit, stop or cancel a plan."""
from pathlib import Path
import json
from urllib.request import Request, urlopen
from urllib.error import HTTPError

root = Path('/opt/quanttrade/current')
data = Path('/opt/quanttrade/shared/data')
token = (data / 'operator-token').read_text().strip()
agent = (data / 'agent-token').read_text().strip()
base = 'http://127.0.0.1:4318/api/'
def read(path, body=None):
    headers = {'Authorization': 'Bearer ' + token}
    if body is not None:
        headers['Content-Type'] = 'application/json'
    with urlopen(Request(base + path, data=None if body is None else json.dumps(body).encode(), headers=headers), timeout=45) as response:
        return json.load(response)
status = read('status')
runs = read('workflow-runs')
assert isinstance(runs, list)
for run in runs:
    assert isinstance(run['states'], list) and run['plan']['accountName']
    assert run['plan'].get('input') or run['plan'].get('steps')
assert isinstance(read('chase-plans')['runs'], list)
native = read('terminal/native-twap-runs')
assert native['scope'] == 'quanttrade-accepted-native-twap-receipts'
assert native['complete'] is False and isinstance(native['runs'], list)
orders = read('terminal/open-orders', {'venue': 'lighter', 'marketType': 'perpetual'})
assert orders['accountName'] == status['accountName']
assert orders['connectionRevision'] == status['connectionRevisions']['lighter']
assert isinstance(orders['orders'], list)
for credential in (None, agent):
    try:
        with urlopen(Request(base + 'terminal/native-twap-runs', headers={} if credential is None else {'Authorization': 'Bearer ' + credential}), timeout=10):
            raise AssertionError('Non-operator native receipt access permitted')
    except HTTPError as error:
        assert error.code in (401, 403)
scripts = '\n'.join(path.read_text() for path in (root / 'frontend/assets').glob('*.js'))
assert 'Orders & plans' in scripts
assert 'Native TWAP receipts' in scripts
assert 'quanttrade-live-workflows' in scripts
assert 'quanttrade-live-orders' in scripts
print('Live Activity bundle and actual server run/native order sources verified; no orders or plans changed.')
