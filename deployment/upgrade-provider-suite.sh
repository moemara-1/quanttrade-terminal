#!/usr/bin/env bash
set -euo pipefail
umask 077
release=/opt/quanttrade/releases/20261007-2
previous=$(readlink -f /opt/quanttrade/current)
[[ "$previous" == /opt/quanttrade/releases/* && "$previous" != "$release" ]]
cd "$release"
tar --warning=no-unknown-keyword -xzf source.tar.gz
install -d -m 0755 frontend
tar --warning=no-unknown-keyword -xzf frontend.tar.gz -C frontend
test -s frontend/_shell.html
export PATH=/opt/node-v24.21.0-linux-x64/bin:$PATH
npm ci --omit=dev --no-audit --no-fund
chmod -R a+rX "$release"
runuser -u quanttrade -- node --experimental-transform-types --test --test-isolation=none tests/*.test.ts
backup=/opt/quanttrade/shared/upgrade-20261007-2
install -d -m 0700 "$backup"
cp -a /opt/quanttrade/hummingbot/accounts_service.py "$backup/accounts_service.py"
cp -a /etc/nginx/sites-available/quanttrade-public "$backup/nginx-public"
if [[ -f /opt/quanttrade/hummingbot/main.py ]]; then cp -a /opt/quanttrade/hummingbot/main.py "$backup/main.py"; fi
restore() {
    echo 'Release verification failed; restoring previous services.' >&2
    ln -sfn "$previous" /opt/quanttrade/current
    cp -a "$backup/accounts_service.py" /opt/quanttrade/hummingbot/accounts_service.py
    if [[ -f "$backup/main.py" ]]; then cp -a "$backup/main.py" /opt/quanttrade/hummingbot/main.py; fi
    cp -a "$backup/nginx-public" /etc/nginx/sites-available/quanttrade-public
    docker compose -p quanttrade-hbot --env-file /opt/quanttrade/hummingbot/.env -f "$previous/deployment/hummingbot-compose.yml" up -d
    systemctl restart quanttrade-bridge
    nginx -t && systemctl reload nginx
}
trap restore ERR
ln -sfn "$release" /opt/quanttrade/current
bash deployment/bootstrap-hummingbot.sh
# Test the deployed code with actual installed Hummingbot dependencies, using mocks.
docker exec quanttrade-hummingbot-api mkdir -p /tmp/quanttrade-release-check/deployment /tmp/quanttrade-release-check/tests /tmp/quanttrade-release-check/upstream/hummingbot-api/services
docker cp deployment/. quanttrade-hummingbot-api:/tmp/quanttrade-release-check/deployment/
docker cp tests/. quanttrade-hummingbot-api:/tmp/quanttrade-release-check/tests/
docker cp upstream/hummingbot-api/services/accounts_service.py quanttrade-hummingbot-api:/tmp/quanttrade-release-check/upstream/hummingbot-api/services/accounts_service.py
docker exec -w /tmp/quanttrade-release-check quanttrade-hummingbot-api python -m unittest discover -s tests -p 'test_hummingbot_*.py'
docker exec -i quanttrade-hummingbot-api python < deployment/verify-hummingbot-guard.py
bash deployment/publish-domain.sh
curl --retry 10 --retry-connrefused --retry-delay 1 -fsS http://127.0.0.1:4318/api/health
python3 deployment/verify-public.py
python3 deployment/verify-login.py
python3 deployment/verify-trading.py
trap - ERR
printf '
QuantTrade provider suite release active: %s
' "$release"
