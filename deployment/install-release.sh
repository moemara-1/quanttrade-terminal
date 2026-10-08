#!/usr/bin/env bash
set -euo pipefail
release=/opt/quanttrade/releases/20261006-1
cd "$release"
tar --warning=no-unknown-keyword -xzf source.tar.gz
mkdir -p frontend
tar --warning=no-unknown-keyword -xzf frontend.tar.gz -C frontend
test -s frontend/_shell.html
python3 - <<'PY'
from pathlib import Path
for p in Path('deployment').iterdir():
    if p.is_file(): p.write_bytes(p.read_bytes().replace(b'\r\n',b'\n'))
PY
export PATH=/opt/node-v24.21.0-linux-x64/bin:$PATH
npm ci --omit=dev --no-audit --no-fund
node --experimental-transform-types --test --test-isolation=none tests/*.test.ts
id quanttrade >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin quanttrade
install -d -m 0700 -o quanttrade -g quanttrade /opt/quanttrade/shared /opt/quanttrade/shared/data
if [[ ! -f /opt/quanttrade/shared/bridge.env ]]; then
    printf 'DESK_MODE=paper\nHUMMINGBOT_ACCOUNT=desk\nPAIRLENS_URL=http://127.0.0.1:4317\nALLOWED_ORIGINS=\n' > /opt/quanttrade/shared/bridge.env
    chmod 600 /opt/quanttrade/shared/bridge.env
fi
ln -sfn "$release" /opt/quanttrade/current
install -m 0644 deployment/quanttrade-bridge.service /etc/systemd/system/quanttrade-bridge.service
install -m 0644 deployment/nginx-private.conf /etc/nginx/sites-available/quanttrade-private
ln -sfn /etc/nginx/sites-available/quanttrade-private /etc/nginx/sites-enabled/quanttrade-private
nginx -t
systemctl daemon-reload
systemctl enable --now quanttrade-bridge
systemctl reload nginx
systemctl is-active quanttrade-bridge
curl --retry 10 --retry-connrefused --retry-delay 1 -fsS http://127.0.0.1:4317/_quanttrade/api/health
