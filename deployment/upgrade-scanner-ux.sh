#!/usr/bin/env bash
set -euo pipefail
umask 077
previous=$(readlink -f /opt/quanttrade/current)
release=/opt/quanttrade/releases/20261021-4
[[ "$previous" == /opt/quanttrade/releases/20261021-2 ]]
[[ ! -e "$release" ]]
python3 - <<'PY'
import json
from pathlib import Path
from urllib.request import Request, urlopen
token = Path('/opt/quanttrade/shared/data/operator-token').read_text().strip()
request = Request('http://127.0.0.1:4318/api/llm-arena', headers={'Authorization': 'Bearer ' + token})
with urlopen(request, timeout=15) as response:
    arena = json.load(response)
if any(bot['status'] == 'running' for bot in arena['bots']):
    raise SystemExit('An Arena agent is running; existing service left unchanged.')
PY
mkdir "$release"
tar -C "$previous" --exclude='./node_modules' --exclude='./upstream' --exclude='./frontend' -cf - . | tar -C "$release" -xf -
ln -s "$previous/node_modules" "$release/node_modules"
tar -xzf /opt/quanttrade/scanner-ux-source.tar.gz -C "$release"
mkdir "$release/frontend"
tar -xzf /opt/quanttrade/scanner-ux-frontend.tar.gz -C "$release/frontend"
test -s "$release/frontend/version.json"
test -s "$release/frontend/_shell.html"
chmod a+rx "$release"
chmod -R a+rX "$release/frontend" "$release/src" "$release/tests" "$release/deployment" "$release/overlays" "$release/patches"
export PATH=/opt/node-v24.21.0-linux-x64/bin:$PATH
cd "$release"
runuser -u quanttrade -- node --experimental-transform-types --test --test-isolation=none tests/*.test.ts
restore(){ ln -sfn "$previous" /opt/quanttrade/current; systemctl restart quanttrade-bridge; }
trap restore ERR
ln -sfn "$release" /opt/quanttrade/current
systemctl restart quanttrade-bridge
curl --retry 15 --retry-connrefused --retry-delay 1 -fsS http://127.0.0.1:4318/api/health
python3 deployment/verify-public.py
python3 deployment/verify-background-ai.py
python3 deployment/verify-arena-hip3.py
python3 deployment/verify-scanner-history.py
curl -fsS https://quanttrade.azurestore.shop/version.json | cmp - frontend/version.json
trap - ERR
printf '\nScanner comparison UX active: %s; inference and exchange services unchanged.\n' "$release"
