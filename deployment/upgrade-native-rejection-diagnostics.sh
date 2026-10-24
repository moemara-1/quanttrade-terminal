#!/usr/bin/env bash
set -euo pipefail
umask 077
previous=$(readlink -f /opt/quanttrade/current)
release=/opt/quanttrade/releases/20261024-9
[[ "$previous" == /opt/quanttrade/releases/20261024-6 ]]
[[ ! -e "$release" ]]
mkdir "$release"
tar -C "$previous" --exclude='./node_modules' --exclude='./upstream' --exclude='./frontend' -cf - . | tar -C "$release" -xf -
ln -s "$previous/node_modules" "$release/node_modules"
tar -xzf /opt/quanttrade/native-diagnostics-source.tar.gz -C "$release"
mkdir "$release/frontend"
tar -xzf /opt/quanttrade/native-diagnostics-frontend.tar.gz -C "$release/frontend"
test -s "$release/frontend/version.json"
test -s "$release/frontend/_shell.html"
chmod a+rx "$release"
chmod -R a+rX "$release/frontend" "$release/src" "$release/tests" "$release/deployment" "$release/overlays" "$release/patches"
restore(){ ln -sfn "$previous" /opt/quanttrade/current; docker compose -p quanttrade-hbot --env-file /opt/quanttrade/hummingbot/.env -f "$previous/deployment/hummingbot-compose.yml" up -d --force-recreate --no-deps api; systemctl restart quanttrade-bridge; }
trap restore ERR
ln -sfn "$release" /opt/quanttrade/current
cd "$release"
docker compose -p quanttrade-hbot --env-file /opt/quanttrade/hummingbot/.env -f "$release/deployment/hummingbot-compose.yml" up -d --force-recreate --no-deps api
systemctl restart quanttrade-bridge
curl --retry 20 --retry-connrefused --retry-delay 1 -fsS http://127.0.0.1:4318/api/health
python3 - <<'PY'
import time, urllib.request, base64
from pathlib import Path
env={}
for line in Path('/opt/quanttrade/shared/bridge.env').read_text().splitlines():
    if '=' in line and not line.startswith('#'):
        k,v=line.split('=',1);env[k]=v.strip().strip('"').strip("'")
auth=base64.b64encode((env['HUMMINGBOT_USERNAME']+':'+env['HUMMINGBOT_PASSWORD']).encode()).decode()
for attempt in range(60):
    try:
        req=urllib.request.Request(env.get('HUMMINGBOT_URL','http://127.0.0.1:8000')+'/accounts/desk/credentials',headers={'Authorization':'Basic '+auth})
        with urllib.request.urlopen(req,timeout=2) as response:
            if response.status==200:break
    except (OSError,ValueError):pass
    time.sleep(1)
else:raise SystemExit('Hummingbot did not become ready; rolling back')
print('Authenticated Hummingbot account read is ready; no execution request sent.')
PY
python3 deployment/verify-public.py
python3 deployment/verify-background-ai.py
python3 deployment/verify-news-coverage.py
curl -fsS https://quanttrade.azurestore.shop/version.json | cmp - frontend/version.json
trap - ERR
printf '\nNative rejection diagnostics active: %s; inference worker unchanged.\n' "$release"
