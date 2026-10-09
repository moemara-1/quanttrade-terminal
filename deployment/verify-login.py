"""Verify background polling cannot trigger HTTP Basic login dialogs.

Run on the deployment host after reloading the public Nginx configuration.
No exchange credentials are read and no trading endpoints are called.
"""
import json
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import urlopen

ORIGIN = "https://quanttrade.azurestore.shop"


def request(path):
    try:
        response = urlopen(ORIGIN + path, timeout=90)
    except HTTPError as error:
        response = error
    with response:
        return response.status, response.headers, response.read()


status, headers, body = request("/api/news?topics=earnings&sort=LATEST")
assert status == 200, f"News route returned {status}"
assert headers.get("WWW-Authenticate") is None, "News polling prompts for login"
assert isinstance(json.loads(body)["articles"], list), "News must return the native feed contract"

status, headers, body = request("/version.json")
assert status == 200, f"Build metadata returned {status}"
assert headers.get("WWW-Authenticate") is None, "Updater prompts for login"
assert json.loads(body) == json.loads(
    Path("/opt/quanttrade/current/frontend/version.json").read_text()
), "Public metadata must be the actual build artifact"

status, headers, _ = request("/futures")
assert status == 200 and b'Sign in' in _, f"Terminal navigation must show login: {status}"
assert headers.get("WWW-Authenticate") is None, "Browser password challenge remains"

print("Login regression checks passed: no background challenges; normal login page protects the terminal.")

from hosted_login import login_headers
from urllib.request import Request
cookie=login_headers()['Cookie']
with urlopen(Request(ORIGIN+'/_quanttrade/api/session',headers={'Cookie':cookie}),timeout=30) as response:
    assert response.status==200
with urlopen(Request(ORIGIN+'/_quanttrade/api/session',method='DELETE',headers={'Cookie':cookie,'Origin':ORIGIN}),timeout=30) as response:
    assert response.status==200
try:
    urlopen(Request(ORIGIN+'/_quanttrade/api/status',headers={'Cookie':cookie}),timeout=30)
    raise AssertionError('Logout did not revoke session')
except HTTPError as failure:
    assert failure.code==401 and failure.headers.get('WWW-Authenticate') is None
for path in ('/login.js','/login.css'):
    status,headers,body=request(path)
    assert status==200 and headers.get('WWW-Authenticate') is None and body
print('Password login, logout revocation and challenge-free sign-in assets verified; no trades placed.')
