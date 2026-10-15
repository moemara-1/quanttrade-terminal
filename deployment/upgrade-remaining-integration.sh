#!/usr/bin/env bash
set -euo pipefail
umask 077
previous=$(readlink -f /opt/quanttrade/current)
release=/opt/quanttrade/releases/20261015-1
[[ "$previous" == /opt/quanttrade/releases/20261014-6 ]]
available_kb=$(df -Pk /opt/quanttrade | awk 'NR==2 {print $4}')
if (( available_kb < 524288 )); then
    printf 'Deployment blocked: at least 512 MiB free disk space is required. Clear obsolete build caches first.\n' >&2
    exit 1
fi
if test -e "$release"; then
    # A failed, rolled-back candidate may be rebuilt; never overwrite current.
    [[ "$(readlink -f /opt/quanttrade/current)" != "$release" ]]
    test -d "$release"
else
    mkdir "$release"
fi
tar -C "$previous" --exclude='./frontend-before-*' --exclude='./node_modules' --exclude='./upstream' -cf - . | tar -C "$release" -xf -
cd "$release"
tar -xzf /opt/quanttrade/remaining-integration-source.tar.gz
rm -rf frontend
mkdir frontend
tar -xzf /opt/quanttrade/remaining-integration-frontend.tar.gz -C frontend
export PATH=/opt/node-v24.21.0-linux-x64/bin:$PATH
npm ci --omit=dev --no-audit --no-fund
chmod -R a+rX "$release"
runuser -u quanttrade -- node --experimental-transform-types --test --test-isolation=none tests/*.test.ts
backup=/opt/quanttrade/shared/nginx-before-remaining-integration.conf
cp -a /etc/nginx/sites-available/quanttrade-public "$backup"
cap_env_backup=''
if [[ "${QUANTTRADE_DISABLE_NOTIONAL_CAPS:-0}" == 1 ]]; then
    cap_env_backup=/opt/quanttrade/shared/env-before-notional-off
    cp -p /opt/quanttrade/shared/bridge.env "$cap_env_backup"
fi
restore(){ if [[ -n "$cap_env_backup" ]]; then cp -p "$cap_env_backup" /opt/quanttrade/shared/bridge.env; fi; ln -sfn "$previous" /opt/quanttrade/current; cp -a "$backup" /etc/nginx/sites-available/quanttrade-public; docker compose -p quanttrade-hbot --env-file /opt/quanttrade/hummingbot/.env -f "$previous/deployment/hummingbot-compose.yml" up -d --force-recreate --no-deps api; systemctl restart quanttrade-bridge; nginx -t && systemctl reload nginx; }
trap restore ERR
if [[ -n "$cap_env_backup" ]]; then python3 deployment/configure-notional-limits.py; fi
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
python3 deployment/verify-remaining-integration.py
python3 deployment/verify-native-preparation-repair.py
python3 deployment/verify-assistant-open-orders.py
python3 deployment/verify-assistant-market-scan.py
python3 deployment/verify-live-activity.py
python3 deployment/verify-assistant-execution-repair.py
python3 deployment/verify-activity-management.py
python3 deployment/verify-chart-connector.py
if [[ -n "$cap_env_backup" ]]; then python3 deployment/verify-notional-limits-off.py; fi
curl -fsS https://quanttrade.azurestore.shop/version.json | cmp - frontend/version.json
trap - ERR
printf '\nQuantTrade single-approval plans active: %s\n' "$release"
