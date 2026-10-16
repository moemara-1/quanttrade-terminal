"""Read-only hosted relay authorization checks. Never sends a provider key."""
import json
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from hosted_login import login_headers

origin = 'https://quanttrade.azurestore.shop'
nginx = Path('/etc/nginx/sites-available/quanttrade-public').read_text()
relay_location = nginx.split('location ^~ /_quanttrade/api/ai/nanogpt/ {', 1)[1].split('}', 1)[0]
for directive in ('proxy_http_version 1.1;', 'proxy_request_buffering off;', 'client_body_buffer_size 2m;'):
    assert directive in relay_location, 'Inference request bodies must not be buffered to proxy temp files'
path = '/_quanttrade/api/ai/nanogpt/jobs/00000000-0000-4000-8000-000000000000?offset=0'
for headers, expected in [({}, 401), (login_headers(), 404)]:
    try:
        with urlopen(Request(origin + path, headers=headers), timeout=30) as response:
            raise AssertionError('Unknown job unexpectedly readable: ' + str(response.status))
    except HTTPError as error:
        assert error.code == expected, (error.code, expected)
        assert isinstance(json.load(error), dict)
scripts = [p.read_text(errors='replace') for p in Path('/opt/quanttrade/current/frontend/assets').glob('*.js')]
assert any('/_quanttrade/api/ai/nanogpt/jobs' in source for source in scripts)
assert any('serverBacked' in source for source in scripts)
print('Opt-in resumable NanoGPT transport and hosted job authorization verified; no provider or trade requests.')
