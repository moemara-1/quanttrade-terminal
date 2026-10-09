"""Verify protected published product branding and every brand asset."""
import base64
import hashlib
import json
import struct
from pathlib import Path
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

root = Path('/opt/quanttrade/current/frontend')
base = 'https://quanttrade.azurestore.shop'
auth = json.loads(Path('/opt/quanttrade/shared/web-access.json').read_text())
headers = {'Authorization': 'Basic ' + base64.b64encode((auth['username'] + ':' + auth['password']).encode()).decode()}

def asset(path):
    with urlopen(Request(base + path, headers=headers), timeout=60) as response:
        blob = response.read()
    local = root / urlsplit(path).path.lstrip('/')
    assert hashlib.sha256(blob).digest() == hashlib.sha256(local.read_bytes()).digest(), path
    return blob

with urlopen(Request(base + '/futures', headers=headers), timeout=60) as response:
    shell = response.read()
assert b'QuantTrade Terminal' in shell and b'CoinTrade Terminal' not in shell
for path in ('/quanttrade-wordmark.svg?v=quanttrade-1', '/quanttrade-mark.svg?v=quanttrade-1'):
    blob = asset(path)
    assert b'QuantTrade' in blob and b'CoinTrade' not in blob and b'<script' not in blob
manifest = json.loads(asset('/manifest.json?v=quanttrade-1'))
assert manifest['name'] == manifest['short_name'] == 'QuantTrade'
for item in manifest['icons']:
    blob = asset(item['src'])
    assert blob[:8] == b'\x89PNG\r\n\x1a\n'
    width, height = struct.unpack('>II', blob[16:24])
    assert item['sizes'] == f'{width}x{height}'
for path in ('/favicon.ico?v=quanttrade-1', '/apple-touch-icon.png?v=quanttrade-1', '/wordmark.webp', '/splashscreen.html'):
    asset(path)
scripts = [path.read_text(errors='replace') for path in (root / 'assets').glob('*.js')]
assert any('QuantTrade Core' in script for script in scripts)
assert any('QuantTrade Intelligence' in script for script in scripts)
assert not any('CoinTrade' in script for script in scripts)
print('QuantTrade title, wordmark, Q mark, favicon, PWA/mobile icons, splash and bundled plugin names verified over HTTPS.')
