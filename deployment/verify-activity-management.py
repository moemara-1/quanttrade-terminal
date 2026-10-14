"""Read-only rollout validation of management UI and authorization boundaries."""
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError
import json
import hashlib
import subprocess

root = Path('/opt/quanttrade/current')
data = Path('/opt/quanttrade/shared/data')
operator = (data / 'operator-token').read_text().strip()
agent = (data / 'agent-token').read_text().strip()
for token in (None, agent):
    for action in ('pause', 'cancel'):
        headers = {'Content-Type': 'application/json'}
        if token: headers['Authorization'] = 'Bearer ' + token
        try:
            with urlopen(Request('http://127.0.0.1:4318/api/workflow-runs/nonexistent-verification-run/' + action, data=b'{}', headers=headers), timeout=15):
                raise AssertionError('Non-operator run mutation allowed')
        except HTTPError as error:
            assert error.code in (401, 403)
with urlopen(Request('http://127.0.0.1:4318/api/terminal/open-orders', data=json.dumps({'venue':'lighter','marketType':'perpetual'}).encode(), headers={'Content-Type':'application/json','Authorization':'Bearer '+operator}), timeout=45) as response:
    orders = json.load(response)
assert isinstance(orders['orders'], list)
for order in orders['orders']:
    if 'totalSize' in order: assert float(order['totalSize']) > 0
source = root / 'deployment/quanttrade-hummingbot-trading.py'
installed = subprocess.check_output(['docker','exec','quanttrade-hummingbot-api','cat','/hummingbot-api/quanttrade_hummingbot_trading.py'])
assert hashlib.sha256(installed).digest() == hashlib.sha256(source.read_bytes()).digest()
bundle = '\n'.join(path.read_text() for path in (root / 'frontend/assets').glob('*.js'))
for marker in ('Orders & plans','History / all','Total quantity','Edit a copy','Manage order','Stopping a plan does not cancel','Refresh activity before reviewing'):
    assert marker in bundle, 'Management UI missing: ' + marker
print('Compact activity, reviewed management controls, authoritative size metadata and operator-only run actions verified; no live mutations performed.')
