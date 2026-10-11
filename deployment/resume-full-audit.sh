#!/usr/bin/env bash
set -euo pipefail
umask 077
previous=/opt/quanttrade/releases/20261010-8
release=/opt/quanttrade/releases/20261011-1
[[ "$(readlink -f /opt/quanttrade/current)" == "$previous" ]]
cd "$release"
backup=/opt/quanttrade/shared/nginx-before-full-audit.conf
cp -a /etc/nginx/sites-available/quanttrade-public "$backup"
restore(){ ln -sfn "$previous" /opt/quanttrade/current; cp -a "$backup" /etc/nginx/sites-available/quanttrade-public; docker compose -p quanttrade-hbot --env-file /opt/quanttrade/hummingbot/.env -f "$previous/deployment/hummingbot-compose.yml" up -d --force-recreate --no-deps api; systemctl restart quanttrade-bridge; nginx -t && systemctl reload nginx; }
trap restore ERR
ln -sfn "$release" /opt/quanttrade/current
install -m 0644 deployment/nginx-public.conf /etc/nginx/sites-available/quanttrade-public
nginx -t
systemctl reload nginx
docker compose -p quanttrade-hbot --env-file /opt/quanttrade/hummingbot/.env -f "$release/deployment/hummingbot-compose.yml" up -d --force-recreate --no-deps api
systemctl restart quanttrade-bridge
curl --retry 10 --retry-connrefused --retry-delay 1 -fsS http://127.0.0.1:4318/api/health
python3 deployment/verify-workflow-runtime.py
python3 deployment/verify-liquidations.py
python3 deployment/verify-data-feeds.py
python3 deployment/verify-login.py
python3 deployment/verify-public.py
python3 deployment/verify-provider-suite.py
python3 deployment/verify-trading.py
python3 deployment/verify-market-controls.py
python3 deployment/verify-hosted-sync.py
python3 deployment/verify-frontend-entry.py
python3 deployment/verify-assistant-diagnostics.py
python3 deployment/verify-unified-ticket.py
python3 deployment/verify-workflow-runs.py
python3 deployment/verify-native-lighter.py
python3 deployment/verify-lighter-fill-schema.py
python3 deployment/verify-workflow-runtime.py
python3 deployment/verify-quanttrade-brand.py
python3 deployment/verify-audit.py
curl -fsS https://quanttrade.azurestore.shop/version.json | cmp - frontend/version.json
trap - ERR
printf '\nQuantTrade full app audit repairs active: %s\n' "$release"
