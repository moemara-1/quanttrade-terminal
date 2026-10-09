#!/usr/bin/env bash
set -euo pipefail
umask 077
previous=$(readlink -f /opt/quanttrade/current)
release=/opt/quanttrade/releases/20261009-11
[[ "$previous" == /opt/quanttrade/releases/20261009-10 ]]
test ! -e "$release"
mkdir "$release"
tar -C "$previous" --exclude='./frontend-before-*' --exclude='./node_modules' --exclude='./upstream' -cf - . | tar -C "$release" -xf -
cd "$release"
tar -xzf /opt/quanttrade/persistent-login-source.tar.gz
export PATH=/opt/node-v24.21.0-linux-x64/bin:$PATH
npm ci --omit=dev --no-audit --no-fund
chmod -R a+rX "$release"
runuser -u quanttrade -- node --experimental-transform-types --test --test-isolation=none tests/*.test.ts
backup=/opt/quanttrade/shared/nginx-before-persistent-login.conf
cp -a /etc/nginx/sites-available/quanttrade-public "$backup"
restore(){ ln -sfn "$previous" /opt/quanttrade/current; cp -a "$backup" /etc/nginx/sites-available/quanttrade-public; docker compose -p quanttrade-hbot --env-file /opt/quanttrade/hummingbot/.env -f "$previous/deployment/hummingbot-compose.yml" up -d --force-recreate --no-deps api; systemctl restart quanttrade-bridge; nginx -t && systemctl reload nginx; }
trap restore ERR
install -o quanttrade -g quanttrade -m 0600 /opt/quanttrade/shared/web-access.json /opt/quanttrade/shared/data/web-login.json
if ! grep -q '^WEB_LOGIN_FILE=' /opt/quanttrade/shared/bridge.env; then printf '\nWEB_LOGIN_FILE=/opt/quanttrade/shared/data/web-login.json\n' >> /opt/quanttrade/shared/bridge.env; fi
ln -sfn "$release" /opt/quanttrade/current
install -m 0644 deployment/nginx-public.conf /etc/nginx/sites-available/quanttrade-public
nginx -t
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
printf '\nQuantTrade persistent password sign-in active: %s\n' "$release"
