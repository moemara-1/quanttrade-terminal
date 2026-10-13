"""Verify metadata recovery of the existing account; never submit or resume a trade."""
from pathlib import Path
import base64, hashlib, json, subprocess
import urllib.request, urllib.error

root=Path('/opt/quanttrade/current')
token=Path('/opt/quanttrade/shared/data/operator-token').read_text().strip()
agent=Path('/opt/quanttrade/shared/data/agent-token').read_text().strip()
base='http://127.0.0.1:4318'
def read(path):
    with urllib.request.urlopen(urllib.request.Request(base+path,headers={'Authorization':'Bearer '+token}),timeout=15) as response:
        return json.load(response)
before=read('/api/status')
account=before['accountName']
payload=json.dumps({'accountName':account}).encode()
for credential in (None,agent):
    headers={'Content-Type':'application/json'}
    if credential: headers['Authorization']='Bearer '+credential
    try:
        urllib.request.urlopen(urllib.request.Request(base+'/api/connections/lighter/recover',data=payload,headers=headers),timeout=10)
        raise AssertionError('Non-operator recovery permitted')
    except urllib.error.HTTPError as error:
        assert error.code in (401,403),error.code
paused={run['id'] for run in read('/api/workflow-runs') if run['status']=='paused'}
with urllib.request.urlopen(urllib.request.Request(base+'/api/connections/lighter/recover',data=payload,headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'}),timeout=65) as response:
    receipt=json.load(response)
after=read('/api/status')
assert receipt['accountName']==account and receipt['venue']=='lighter' and receipt['mode']=='live'
assert len(receipt['connectionRevision'])==64
assert after['accountName']==account and after['venueModes']==before['venueModes']
assert after['connectionRevisions']['lighter']==receipt['connectionRevision']
assert all(run['status']!='active' for run in read('/api/workflow-runs') if run['id'] in paused)
expected=hashlib.sha256((root/'deployment/quanttrade-hummingbot-connections.py').read_bytes()).hexdigest()
actual=subprocess.check_output(['docker','exec','quanttrade-hummingbot-api','sha256sum','/hummingbot-api/quanttrade_hummingbot_connections.py'],text=True).split()[0]
assert expected==actual,'Connection verifier runtime differs from release'
fields=dict(line.split('=',1) for line in Path('/opt/quanttrade/hummingbot/.env').read_text().splitlines() if '=' in line)
auth=base64.b64encode((fields['USERNAME']+':'+fields['PASSWORD']).encode()).decode()
with urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:8000/openapi.json',headers={'Authorization':'Basic '+auth}),timeout=10) as response:
    assert '/quanttrade/connections/{account_name}/{venue}/verified-revision' in json.load(response)['paths']
print('Existing live Lighter signing scope verified; revision available; no credentials replaced, orders submitted or paused plans resumed.')

# This endpoint only reviews a plan; an invalid linked exit must never reach signing.
import time, uuid
plan={'requestId':str(uuid.uuid4()),'proposedAt':int(time.time()*1000),'credentialId':'hosted-preflight-check','connectionRevision':receipt['connectionRevision'],'accountName':account,'mode':'live','venue':'lighter','marketType':'perpetual','symbol':'ZEC-USDC','grouping':'oto','leverage':1,'marginMode':'cross','legs':[{'side':'sell','type':'market','amount':'1','price':'1213','reduceOnly':False,'timeInForce':'ioc'},{'side':'buy','type':'sl-market','amount':'1','price':'1285','triggerPrice':'1285','reduceOnly':True,'timeInForce':'ioc'}]}
for credential in (None,agent,token):
    headers={'Content-Type':'application/json'}
    if credential: headers['Authorization']='Bearer '+credential
    try:
        urllib.request.urlopen(urllib.request.Request(base+'/api/terminal/lighter-native-preview',data=json.dumps(plan).encode(),headers=headers),timeout=15)
        raise AssertionError('Invalid or unauthorized preview accepted')
    except urllib.error.HTTPError as error:
        if credential==token:
            assert error.code==400,error.code
            body=json.load(error)
            assert body['submissionAttempted'] is False
            assert 'Attached exits require zero amount' in body['error'],body['error']
        else:
            assert error.code in (401,403),error.code
print('Hosted read-only preflight rejects invalid linked sizing and enforces operator access; no order submitted.')
