#!/usr/bin/env bash
set -euo pipefail
umask 077
install -d -m 0700 /opt/quanttrade/hummingbot /opt/quanttrade/hummingbot/bots /opt/quanttrade/shared
install -d -m 0700 /opt/quanttrade/hummingbot/bots/credentials/master_account/connectors
python3 - <<'PY'
from pathlib import Path
import secrets
p=Path('/opt/quanttrade/hummingbot/.env')
if not p.exists():
    fields={'USERNAME':'quanttrade','PASSWORD':secrets.token_hex(32),'CONFIG_PASSWORD':secrets.token_hex(32),'BROKER_USERNAME':'quanttrade','BROKER_PASSWORD':secrets.token_hex(32),'BROKER_DASHBOARD_PASSWORD':secrets.token_hex(32),'POSTGRES_PASSWORD':secrets.token_hex(24)}
    p.write_text(''.join(f'{k}={v}\n' for k,v in fields.items()))
    p.chmod(0o600)
fields=dict(line.split('=',1) for line in p.read_text().splitlines() if '=' in line)
csv=Path('/opt/quanttrade/hummingbot/auth-bootstrap.csv')
csv.write_text('user_id,password,is_superuser\n'+fields['BROKER_USERNAME']+','+fields['BROKER_PASSWORD']+',false\n')
# EMQX runs as its own uid and needs to read this read-only mount; parent stays private.
csv.chmod(0o644)
bridge=Path('/opt/quanttrade/shared/bridge.env')
settings=dict(line.split('=',1) for line in bridge.read_text().splitlines() if '=' in line) if bridge.exists() else {'DESK_MODE':'paper','HUMMINGBOT_ACCOUNT':'desk','PAIRLENS_URL':'http://127.0.0.1:4317','ALLOWED_ORIGINS':''}
settings.update(HUMMINGBOT_URL='http://127.0.0.1:8000',HUMMINGBOT_USERNAME=fields['USERNAME'],HUMMINGBOT_PASSWORD=fields['PASSWORD'])
bridge.write_text(''.join(f'{k}={v}\n' for k,v in settings.items()))
bridge.chmod(0o600)
PY
if ! grep -q '^HUMMINGBOT_IMAGE=' /opt/quanttrade/hummingbot/.env; then
    docker pull hummingbot/hummingbot-api:latest
    image=$(docker image inspect --format '{{index .RepoDigests 0}}' hummingbot/hummingbot-api:latest)
    [[ "$image" == hummingbot/hummingbot-api@sha256:* ]]
    printf 'HUMMINGBOT_IMAGE=%s\n' "$image" >> /opt/quanttrade/hummingbot/.env
fi
# Derive the private API override from the pinned image; never patch an unknown source.
image=$(python3 - <<'PY'
from pathlib import Path
fields=dict(line.split('=',1) for line in Path('/opt/quanttrade/hummingbot/.env').read_text().splitlines() if '=' in line)
print(fields['HUMMINGBOT_IMAGE'])
PY
)
source_container=$(docker create "$image")
trap 'docker rm "$source_container" >/dev/null 2>&1 || true' EXIT
docker cp "$source_container":/hummingbot-api/services/accounts_service.py /opt/quanttrade/hummingbot/accounts_service.original.py
docker cp "$source_container":/hummingbot-api/main.py /opt/quanttrade/hummingbot/main.original.py
python3 /opt/quanttrade/current/deployment/patch-hummingbot-main.py /opt/quanttrade/hummingbot/main.original.py /opt/quanttrade/hummingbot/main.py
python3 /opt/quanttrade/current/deployment/patch-hummingbot-validation.py /opt/quanttrade/hummingbot/accounts_service.original.py /opt/quanttrade/hummingbot/accounts_service.py
chmod 0600 /opt/quanttrade/hummingbot/accounts_service.original.py /opt/quanttrade/hummingbot/accounts_service.py
chmod 0600 /opt/quanttrade/hummingbot/main.original.py /opt/quanttrade/hummingbot/main.py
docker rm "$source_container" >/dev/null
trap - EXIT
docker compose -p quanttrade-hbot --env-file /opt/quanttrade/hummingbot/.env -f /opt/quanttrade/current/deployment/hummingbot-compose.yml up -d
python3 - <<'PY'
from pathlib import Path
import urllib.request,base64,json,time
fields=dict(line.split('=',1) for line in Path('/opt/quanttrade/hummingbot/.env').read_text().splitlines() if '=' in line)
auth=base64.b64encode((fields['USERNAME']+':'+fields['PASSWORD']).encode()).decode()
for attempt in range(90):
    try:
        req=urllib.request.Request('http://127.0.0.1:8000/connectors/',headers={'Authorization':'Basic '+auth})
        with urllib.request.urlopen(req,timeout=5) as r: connectors=json.load(r)
        missing={'hyperliquid','lighter','hyperliquid_perpetual','lighter_perpetual'}-set(connectors)
        if missing: raise RuntimeError('Required connectors absent: '+','.join(sorted(missing)))
        req=urllib.request.Request('http://127.0.0.1:8000/accounts/',headers={'Authorization':'Basic '+auth})
        with urllib.request.urlopen(req,timeout=10) as r: accounts=json.load(r)
        if 'desk' not in accounts:
            req=urllib.request.Request('http://127.0.0.1:8000/accounts/add-account?account_name=desk',data=b'',headers={'Authorization':'Basic '+auth},method='POST')
            with urllib.request.urlopen(req,timeout=10) as r: json.load(r)
        print('Hummingbot API authenticated readiness passed; Hyperliquid and Lighter connectors present.')
        break
    except Exception as e:
        if attempt==89: raise RuntimeError('Hummingbot readiness failed; inspect private service logs') from e
        time.sleep(2)
PY
