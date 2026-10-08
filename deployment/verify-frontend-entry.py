"""Verify the actual protected shell and its referenced production chunks."""
import base64, hashlib, json, re
from pathlib import Path
from urllib.request import Request, urlopen
root=Path('/opt/quanttrade/current/frontend')
auth=json.loads(Path('/opt/quanttrade/shared/web-access.json').read_text())
headers={'Authorization':'Basic '+base64.b64encode((auth['username']+':'+auth['password']).encode()).decode()}
with urlopen(Request('https://quanttrade.azurestore.shop/futures',headers=headers),timeout=60) as response:
    shell=response.read()
assert hashlib.sha256(shell).digest()==hashlib.sha256((root/'_shell.html').read_bytes()).digest()
paths=set(re.findall(r'(?:src|href)="/([^"?]+\.(?:js|css))"',shell.decode()))
assert paths
for path in paths:
    with urlopen(Request('https://quanttrade.azurestore.shop/'+path,headers=headers),timeout=90) as response:
        blob=response.read()
    assert hashlib.sha256(blob).digest()==hashlib.sha256((root/path).read_bytes()).digest(),path
assert any('venue-switch-catalog' in p.read_text(errors='replace') for p in (root/'assets').glob('*.js'))
print('Active terminal shell and '+str(len(paths))+' referenced scripts/styles match release files; catalog switch code is bundled.')
