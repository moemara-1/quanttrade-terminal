"""Verify hosted settings sync authorization without changing user settings."""
import base64,json
from pathlib import Path
from urllib.request import Request,urlopen
from urllib.error import HTTPError
base='https://quanttrade.azurestore.shop'
auth=json.loads(Path('/opt/quanttrade/shared/web-access.json').read_text())
basic='Basic '+base64.b64encode((auth['username']+':'+auth['password']).encode()).decode()
def request(path,method='GET',headers=None,payload=None):
    combined={'Content-Type':'application/json',**(headers or {})}
    data=None if payload is None else json.dumps(payload).encode()
    try:
        with urlopen(Request(base+path,data=data,headers=combined,method=method),timeout=45) as response:
            return response.status,response.read(),response.headers
    except HTTPError as failure:
        return failure.code,failure.read(),failure.headers
assert request('/_quanttrade/api/sync-state')[0]==401
agent=Path('/opt/quanttrade/shared/data/agent-token').read_text().strip()
assert request('/_quanttrade/api/sync-state',headers={'Authorization':'Bearer '+agent})[0]==403
status,body,headers=request('/_quanttrade/api/session','POST',{'Authorization':basic,'Origin':base},{})
assert status==200
cookie=headers['Set-Cookie'].split(';')[0]
operator={'Authorization':basic,'Cookie':cookie,'Origin':base}
status,body,_=request('/_quanttrade/api/sync-state',headers=operator)
assert status==200 and isinstance(json.loads(body)['entries'],dict)
assert request('/_quanttrade/api/sync-state','PUT',operator,{'entries':{}})[0]==200
assert request('/_quanttrade/api/sync-state','PUT',{'Cookie':cookie},{'entries':{}})[0]==403
assert request('/_quanttrade/api/sync-state','PUT',operator,{'entries':{'security.lock':{'value':{},'updatedAt':0}}})[0]==400
status,wordmark,_=request('/quanttrade-wordmark.svg',headers={'Authorization':basic})
assert status==200 and b'CoinTrade' in wordmark
print('Hosted settings sync: authenticated reads and empty merge pass; anonymous, agent, missing origin and blocked keys denied. CoinTrade wordmark verified. No user settings changed.')
