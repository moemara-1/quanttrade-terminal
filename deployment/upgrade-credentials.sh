#!/usr/bin/env bash
set -euo pipefail
umask 077
release=/opt/quanttrade/releases/20261006-2
previous=$(readlink -f /opt/quanttrade/current)
[[ "$previous" == /opt/quanttrade/releases/* ]]
[[ "$release" != "$previous" ]]
cd "$release"
tar --warning=no-unknown-keyword -xzf source.tar.gz
install -d -m 0755 frontend
tar --warning=no-unknown-keyword -xzf frontend.tar.gz -C frontend
python3 - <<'PY'
from pathlib import Path
for p in Path('deployment').iterdir():
    if p.is_file(): p.write_bytes(p.read_bytes().replace(b'\r\n',b'\n'))
PY
test -s frontend/_shell.html
export PATH=/opt/node-v24.21.0-linux-x64/bin:$PATH
npm ci --omit=dev --no-audit --no-fund
# This release contains code/assets only; private keys and state live outside it.
chmod -R a+rX "$release"
runuser -u quanttrade -- node --experimental-transform-types --test --test-isolation=none tests/*.test.ts
python3 -m unittest discover -s tests -p test_hummingbot_validation.py
restore() {
    ln -sfn "$previous" /opt/quanttrade/current
    systemctl restart quanttrade-bridge
}
trap restore ERR
ln -sfn "$release" /opt/quanttrade/current
bash deployment/bootstrap-hummingbot.sh
docker exec -i quanttrade-hummingbot-api python < deployment/verify-hummingbot-guard.py
bash deployment/publish-domain.sh
curl --retry 10 --retry-connrefused --retry-delay 1 -fsS http://127.0.0.1:4318/api/health
python3 deployment/verify-public.py
trap - ERR
printf '\nQuantTrade exchange credential release active: %s\n' "$release"
