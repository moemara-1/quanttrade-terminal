"""Obtain a short-lived verification session without trading or printing secrets."""
import json
from pathlib import Path
from urllib.request import Request, urlopen
ORIGIN='https://quanttrade.azurestore.shop'
def login_headers():
    credentials=json.loads(Path('/opt/quanttrade/shared/web-access.json').read_text())
    request=Request(ORIGIN+'/_quanttrade/api/login',data=json.dumps({**credentials,'remember':False}).encode(),headers={'Content-Type':'application/json','Origin':ORIGIN})
    with urlopen(request,timeout=30) as response:
        assert response.status==200 and json.load(response)=={'ok':True}
        cookie=response.headers['Set-Cookie']
        assert all(flag in cookie for flag in ('HttpOnly','Secure','SameSite=Strict','Path=/'))
        return {'Cookie':cookie.split(';')[0]}
