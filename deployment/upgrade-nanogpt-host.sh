#!/usr/bin/env bash
set -euo pipefail
umask 077
previous=$(readlink -f /opt/quanttrade/current)
release=/opt/quanttrade/releases/20261021-1
[[ "$previous" == /opt/quanttrade/releases/20261020-8 ]]
[[ ! -e "$release" ]]
mkdir "$release"
tar -C "$previous" --exclude='./node_modules' --exclude='./upstream' --exclude='./frontend' -cf - . | tar -C "$release" -xf -
ln -s "$previous/node_modules" "$release/node_modules"
tar -xzf /opt/quanttrade/nanogpt-host-source.tar.gz -C "$release"
mkdir "$release/frontend"
tar -xzf /opt/quanttrade/nanogpt-host-frontend.tar.gz -C "$release/frontend"
test -s "$release/frontend/version.json"
test -s "$release/frontend/_shell.html"
chmod a+rx "$release"
chmod -R a+rX "$release/frontend" "$release/src" "$release/tests" "$release/deployment" "$release/overlays" "$release/patches"
export PATH=/opt/node-v24.21.0-linux-x64/bin:$PATH
cd "$release"
runuser -u quanttrade -- node --experimental-transform-types --test --test-isolation=none tests/*.test.ts
# Retained responses must finish their resume window before replacing a worker.
python3 - <<'PY'
import json, time, urllib.request
from pathlib import Path
token=Path('/opt/quanttrade/shared/data/operator-token').read_text().strip()
for attempt in range(661):
    request=urllib.request.Request('http://127.0.0.1:4319/status',headers={'Authorization':'Bearer '+token})
    with urllib.request.urlopen(request,timeout=5) as response:
        state=json.load(response)
    if state['retained']==0:
        break
    if attempt%30==0:
        print('Waiting for retained assistant responses: active=%d retained=%d' % (state['active'],state['retained']),flush=True)
    time.sleep(1)
else:
    raise SystemExit('Assistant responses are still retained; existing service left running.')
PY
restore(){ systemctl stop quanttrade-inference; ln -sfn "$previous" /opt/quanttrade/current; systemctl start quanttrade-inference; systemctl restart quanttrade-bridge; }
trap restore ERR
systemctl stop quanttrade-inference
ln -sfn "$release" /opt/quanttrade/current
systemctl start quanttrade-inference
systemctl restart quanttrade-bridge
curl --retry 10 --retry-connrefused --retry-delay 1 -fsS http://127.0.0.1:4319/health
python3 deployment/verify-background-ai.py
python3 deployment/verify-public.py
python3 deployment/verify-arena-hip3.py
curl -fsS https://quanttrade.azurestore.shop/version.json | cmp - frontend/version.json
trap - ERR
printf '\nDocumented NanoGPT host active: %s; exchange services unchanged.\n' "$release"
