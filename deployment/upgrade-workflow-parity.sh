#!/usr/bin/env bash
set -euo pipefail
umask 077
previous=$(readlink -f /opt/quanttrade/current)
release=/opt/quanttrade/releases/20261009-10
[[ "$previous" == /opt/quanttrade/releases/20261009-9 ]]
test ! -e "$release"
cp -a "$previous" "$release"
cd "$release"
tar -xzf /opt/quanttrade/workflow-parity-source.tar.gz
mv frontend frontend-before-workflow-parity
mkdir frontend
tar -xzf /opt/quanttrade/workflow-parity-frontend.tar.gz -C frontend
export PATH=/opt/node-v24.21.0-linux-x64/bin:$PATH
npm ci --omit=dev --no-audit --no-fund
chmod -R a+rX "$release"
runuser -u quanttrade -- node --experimental-transform-types --test --test-isolation=none tests/*.test.ts
backup=/opt/quanttrade/shared/nginx-before-workflow-parity.conf
cp -a /etc/nginx/sites-available/quanttrade-public "$backup"
restore(){ ln -sfn "$previous" /opt/quanttrade/current; cp -a "$backup" /etc/nginx/sites-available/quanttrade-public; docker compose -p quanttrade-hbot --env-file /opt/quanttrade/hummingbot/.env -f "$previous/deployment/hummingbot-compose.yml" up -d --force-recreate --no-deps api; systemctl restart quanttrade-bridge; nginx -t && systemctl reload nginx; }
trap restore ERR
ln -sfn "$release" /opt/quanttrade/current
install -m 0644 deployment/nginx-public.conf /etc/nginx/sites-available/quanttrade-public
nginx -t
docker compose -p quanttrade-hbot --env-file /opt/quanttrade/hummingbot/.env -f deployment/hummingbot-compose.yml up -d --force-recreate --no-deps api
python3 deployment/verify-workflow-runtime.py
systemctl restart quanttrade-bridge
systemctl reload nginx
curl --retry 10 --retry-connrefused --retry-delay 1 -fsS http://127.0.0.1:4318/api/health
python3 deployment/verify-liquidations.py
python3 deployment/verify-data-feeds.py
python3 deployment/verify-login.py
python3 deployment/verify-public.py
python3 deployment/verify-provider-suite.py
python3 deployment/verify-trading.py
python3 deployment/verify-market-controls.py
python3 deployment/verify-hosted-sync.py
python3 deployment/verify-frontend-entry.py
python3 deployment/verify-unified-ticket.py
python3 deployment/verify-workflow-runs.py
python3 deployment/verify-quanttrade-brand.py
trap - ERR
printf '\nQuantTrade original workflow graph and native OCO support active: %s\n' "$release"
