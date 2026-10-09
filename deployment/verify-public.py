from pathlib import Path
import urllib.request,urllib.error,json,base64

from hosted_login import login_headers
login=login_headers()
base='https://quanttrade.azurestore.shop'
auth=json.loads(Path('/opt/quanttrade/shared/web-access.json').read_text())
basic='Basic '+base64.b64encode((auth['username']+':'+auth['password']).encode()).decode()
operator=Path('/opt/quanttrade/shared/data/operator-token').read_text().strip()
agent=Path('/opt/quanttrade/shared/data/agent-token').read_text().strip()
def request(path,authorization=None,origin=None,body=None,cookie=None):
    headers={}
    if authorization: headers['Authorization']=authorization
    if origin: headers['Origin']=origin
    if cookie: headers['Cookie']=cookie
    if body is not None: headers['Content-Type']='application/json'
    req=urllib.request.Request(base+path,headers=headers,data=json.dumps(body).encode() if body is not None else None)
    try:
        with urllib.request.urlopen(req,timeout=30) as r: return r.status,r.read(),r.headers
    except urllib.error.HTTPError as e: return e.code,e.read(),e.headers
assert request('/futures')[0]==200 and b'Sign in' in request('/futures')[1]
status,body,headers=request('/futures',cookie=login['Cookie'])
assert status==200 and b'QuantTrade Terminal' in body
assert headers.get('Strict-Transport-Security')=='max-age=31536000'
assert request('/_quanttrade/api/health')[0]==200
assert request('/_quanttrade/api/status')[0]==401
status,body,_=request('/_quanttrade/api/status','Bearer '+operator,base)
assert status==200 and json.loads(body)['mode'] in ['paper','live']
assert json.loads(body)['pairlensUrl']==base
assert request('/_quanttrade/api/status','Bearer '+operator,'https://evil.example')[0]==403
assert request('/_quanttrade/api/proposals/00000000-0000-4000-8000-000000000000/approve','Bearer '+agent,base,{})[0]==403
print('Public HTTPS certificate validation, session-protected SPA, operator authorization, exact origin and agent approval denial passed; no execution requests sent.')
status,body,headers=request('/_quanttrade/api/session',None,base,{},login['Cookie'])
assert status==200 and json.loads(body)=={'ok':True}
cookie=login['Cookie']
status,body,_=request('/_quanttrade/api/connections',basic,base,cookie=cookie)
assert status==200
connections=json.loads(body)
assert len(connections)==2 and all(c['mode'] in ['paper','live'] and c['accountName']=='desk' for c in connections)
assert request('/_quanttrade/api/connections','Bearer '+agent,base,cookie=cookie)[0]==403
payload={'venue':'lighter','credentials':{'lighter_perpetual_api_private_key':'synthetic-secret-never-save'}}
status,body,_=request('/_quanttrade/api/connections',basic,base,payload,cookie)
assert status==400 and b'synthetic-secret-never-save' not in body
assert request('/_quanttrade/api/connections',basic,None,payload,cookie)[0]==403
print('Hosted browser session and cookie credential access passed; invalid keys rejected and agent credentials denied without exchange execution.')
