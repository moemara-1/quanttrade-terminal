from pathlib import Path
import urllib.request, urllib.error, json, re
from decimal import Decimal, ROUND_DOWN

base='http://127.0.0.1:4317'
operator=Path('/opt/quanttrade/shared/data/operator-token').read_text().strip()
agent=Path('/opt/quanttrade/shared/data/agent-token').read_text().strip()
def request(path,token=None,body=None,origin=None):
    headers={}
    if token: headers['Authorization']='Bearer '+token
    if origin: headers['Origin']=origin
    if body is not None: headers['Content-Type']='application/json'
    req=urllib.request.Request(base+path,data=json.dumps(body).encode() if body is not None else None,headers=headers)
    try:
        with urllib.request.urlopen(req,timeout=30) as r: return r.status,r.read(),r.headers
    except urllib.error.HTTPError as e: return e.code,e.read(),e.headers

status,html,headers=request('/futures')
assert status==200 and b'CoinTrade' in html and headers.get('X-QuantTrade-Terminal')=='1'
assets=re.findall(r'(?:src|href)="(/assets/[^"\s]+)"',html.decode())
assert assets
for asset in assets: assert request(asset)[0]==200,asset
assert request('/_quanttrade/api/health')[0]==200
assert request('/_quanttrade/api/status')[0]==401
assert request('/_quanttrade/api/status',operator,origin='https://evil.example')[0]==403
status,body,_=request('/_quanttrade/api/status',operator)
assert status==200 and json.loads(body)['mode']=='paper'
assert request('/_quanttrade/api/proposals/00000000-0000-4000-8000-000000000000/approve',agent,{})[0]==403
for venue in ['hyperliquid','lighter']:
    status,body,_=request('/_quanttrade/api/public/markets?venue='+venue)
    assert status==200
    markets=json.loads(body)
    assert len(markets)>10
    print(venue+': '+str(len(markets))+' live markets')
    market=next(m for m in markets if m['symbol']=='BTC-USDC')
    size=Decimal('100')/Decimal(str(market['price']))
    size=size.quantize(Decimal(10)**(-market['sizeDecimals']),rounding=ROUND_DOWN)
    price=Decimal(str(market['price'])).quantize(Decimal(10)**(-market['priceDecimals']),rounding=ROUND_DOWN)
    if venue=='hyperliquid' and price!=price.to_integral_value():
        price=price.quantize(Decimal(10)**(price.adjusted()-4),rounding=ROUND_DOWN)
    order={'venue':venue,'symbol':'BTC-USDC','side':'buy','type':'limit','size':format(size,'f'),'price':format(price,'f'),'rationale':'Deployment verification: paper proposal only, reject without execution.'}
    status,body,_=request('/_quanttrade/api/proposals',agent,order)
    assert status==201,body
    proposal=json.loads(body)
    assert proposal['status']=='pending' and proposal['mode']=='paper'
    path='/_quanttrade/api/proposals/'+proposal['id']
    assert request(path+'/approve',agent,{})[0]==403
    status,body,_=request(path+'/reject',operator,{})
    assert status==200 and json.loads(body)['status']=='rejected'
    print(venue+': agent proposal prepared and rejected without execution')
print('Hosted SPA, referenced assets, paper mode, authentication and agent approval denial passed.')
for domain in ['azuresynthetics.com','azurestore.shop','watchtower.azurestore.shop','wholesale.azuresynthetics.com']:
    try:
        with urllib.request.urlopen('https://'+domain,timeout=30) as r: status=r.status
    except urllib.error.HTTPError as e: status=e.code
    assert status in (200,401), (domain,status)
    print(domain+': HTTP '+str(status))
