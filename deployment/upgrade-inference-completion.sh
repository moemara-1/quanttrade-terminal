#!/usr/bin/env bash
set -euo pipefail
umask 077
previous=$(readlink -f /opt/quanttrade/current)
release=/opt/quanttrade/releases/20261020-6
[[ "$previous" == /opt/quanttrade/releases/20261020-5 ]]
[[ ! -e "$release" ]]
mkdir "$release"
tar -C "$previous" --exclude='./node_modules' --exclude='./upstream' --exclude='./frontend' -cf - . | tar -C "$release" -xf -
ln -s "$previous/node_modules" "$release/node_modules"
ln -s "$previous/frontend" "$release/frontend"
tar -xzf /opt/quanttrade/inference-completion-source.tar.gz -C "$release"
chmod a+rx "$release"
chmod -R a+rX "$release/src" "$release/tests" "$release/deployment"
export PATH=/opt/node-v24.21.0-linux-x64/bin:$PATH
cd "$release"
runuser -u quanttrade -- node --experimental-transform-types --test --test-isolation=none tests/*.test.ts
# Do not discard accepted jobs or their resumable output to deploy a repair.
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
        print('Waiting for accepted inference responses to finish their resume window.',flush=True)
    time.sleep(1)
else:
    raise SystemExit('Inference is still in use; deployment deferred without stopping it.')
PY
restore(){ systemctl stop quanttrade-inference; ln -sfn "$previous" /opt/quanttrade/current; systemctl start quanttrade-inference; }
trap restore ERR
systemctl stop quanttrade-inference
ln -sfn "$release" /opt/quanttrade/current
systemctl start quanttrade-inference
curl --retry 10 --retry-connrefused --retry-delay 1 -fsS http://127.0.0.1:4319/health
python3 deployment/verify-background-ai.py
python3 deployment/verify-public.py
trap - ERR
printf '\nComplete-response inference active: %s; bridge and exchange services unchanged.\n' "$release"
