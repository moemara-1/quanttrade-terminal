#!/usr/bin/env bash
set -euo pipefail
envfile=/opt/quanttrade/hummingbot/.env
backup=/opt/quanttrade/shared/hummingbot-before-sdk114.env
compose=/opt/quanttrade/current/deployment/hummingbot-compose.yml
image=quanttrade-hummingbot-api:lighter-sdk-1.1.4
docker image inspect "$image" >/dev/null
docker run --rm --network none --entrypoint python -v /opt/quanttrade/current/deployment/verify-lighter-signer.py:/tmp/verify.py:ro "$image" /tmp/verify.py
cp -a "$envfile" "$backup"
rollback(){ cp -a "$backup" "$envfile"; docker compose -p quanttrade-hbot --env-file "$envfile" -f "$compose" up -d --no-deps api; }
trap rollback ERR
python3 - <<'PY'
from pathlib import Path
path=Path('/opt/quanttrade/hummingbot/.env')
lines=path.read_text().splitlines()
path.write_text('\n'.join('HUMMINGBOT_IMAGE=quanttrade-hummingbot-api:lighter-sdk-1.1.4' if line.startswith('HUMMINGBOT_IMAGE=') else line for line in lines)+'\n')
path.chmod(0o600)
PY
docker compose -p quanttrade-hbot --env-file "$envfile" -f "$compose" up -d --no-deps api
python3 - <<'PY'
from pathlib import Path
import urllib.request,base64,json,time
fields=dict(line.split('=',1) for line in Path('/opt/quanttrade/hummingbot/.env').read_text().splitlines() if '=' in line)
auth=base64.b64encode((fields['USERNAME']+':'+fields['PASSWORD']).encode()).decode()
for attempt in range(60):
    try:
        request=urllib.request.Request('http://127.0.0.1:8000/accounts/',headers={'Authorization':'Basic '+auth})
        with urllib.request.urlopen(request,timeout=5) as response: accounts=json.load(response)
        assert 'desk' in accounts
        print('Updated Hummingbot API authenticated readiness passed; no orders sent.')
        break
    except Exception:
        if attempt==59: raise RuntimeError('Updated Hummingbot API failed readiness')
        time.sleep(2)
PY
docker exec quanttrade-hummingbot-api python -c 'import importlib.metadata as m; assert m.version("lighter-sdk")=="1.1.4"; print("Installed Lighter SDK 1.1.4 verified")'
trap - ERR
