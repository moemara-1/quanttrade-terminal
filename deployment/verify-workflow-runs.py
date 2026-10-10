"""Read-only hosted workflow/auth checks. No plan registration or trade calls."""
from pathlib import Path
import urllib.request, urllib.error, json
token=Path('/opt/quanttrade/shared/data/operator-token').read_text().strip()
request=urllib.request.Request('http://127.0.0.1:4318/api/workflow-runs',headers={'Authorization':'Bearer '+token})
with urllib.request.urlopen(request,timeout=10) as response: runs=json.load(response)
assert isinstance(runs,list)
for run in runs:
    assert run['status'] in ('active','paused','completed','cancelled')
for path in ('/api/workflow-runs','/api/workflow-runs/not-a-real-run/cancel'):
    request=urllib.request.Request('http://127.0.0.1:4318'+path,data=b'{}',headers={'Content-Type':'application/json'})
    try:
        urllib.request.urlopen(request,timeout=10)
        raise AssertionError('Unauthenticated workflow write allowed')
    except urllib.error.HTTPError as error: assert error.code==401
scripts=[path.read_text(errors='replace') for path in Path('/opt/quanttrade/current/frontend/assets').glob('*.js')]
for marker in ('Prepare with AI','Stop future workflow steps','get_workflow_runs','Workflow registered on server','Pair sibling TP/SL exits as exchange-native OCO','Before you can submit','Total workflow order budget','protective exits','before the scheduled entries','Check execution','entry fills verified','protective submission recorded; fill not verified'):
    assert any(marker in script for script in scripts),marker
print('Persistent workflow reads, private write guards and approval/run controls verified; no workflows started.')
