"""Read only Lighter snapshot DTO field names. Never submits an order or prints account values."""
from pathlib import Path
import json, urllib.request
operator=Path('/opt/quanttrade/shared/data/operator-token').read_text().strip()
request=urllib.request.Request('http://127.0.0.1:4318/api/terminal/snapshot',data=json.dumps({'venue':'lighter','marketType':'perpetual','symbol':'GRAM-USDC'}).encode(),headers={'Authorization':'Bearer '+operator,'Content-Type':'application/json'})
with urllib.request.urlopen(request,timeout=45) as response: snapshot=json.load(response)
assert snapshot['connector_name']=='lighter_perpetual' and snapshot['trading_pair']=='GRAM-USDC'
accounts=snapshot['account']['accounts']
assert len(accounts)==1 and 'index' in accounts[0]
print('Native Lighter owned account uses index; snapshot connector and pair match. No account values printed, no orders submitted.')
