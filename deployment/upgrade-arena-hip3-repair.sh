#!/usr/bin/env bash
set -euo pipefail
umask 077
previous=$(readlink -f /opt/quanttrade/current)
release=/opt/quanttrade/releases/20261020-2
[[ "$previous" == /opt/quanttrade/releases/20261019-3 ]]
[[ ! -e "$release" ]]
(( $(df -Pk /opt/quanttrade | awk 'NR==2 {print $4}') >= 524288 ))
mkdir "$release"
tar -C "$previous" --exclude='./node_modules' --exclude='./upstream' --exclude='./frontend' --exclude='./frontend-before-*' -cf - . | tar -C "$release" -xf -
ln -s "$previous/node_modules" "$release/node_modules"
tar -xzf /opt/quanttrade/arena-hip3-repair-source.tar.gz -C "$release"
mkdir "$release/frontend"
tar -xzf /opt/quanttrade/arena-hip3-repair-frontend.tar.gz -C "$release/frontend"
test -s "$release/frontend/version.json"
test -s "$release/frontend/_shell.html"
chmod a+rx "$release"
chmod -R a+rX "$release/frontend" "$release/src" "$release/tests" "$release/deployment" "$release/overlays" "$release/patches"
export PATH=/opt/node-v24.21.0-linux-x64/bin:$PATH
cd "$release"
runuser -u quanttrade -- node --experimental-transform-types --test --test-isolation=none tests/*.test.ts
recreate_api(){ docker compose -p quanttrade-hbot --env-file /opt/quanttrade/hummingbot/.env -f "$1/deployment/hummingbot-compose.yml" up -d --force-recreate --no-deps api; }
restore(){ ln -sfn "$previous" /opt/quanttrade/current; recreate_api "$previous"; systemctl restart quanttrade-bridge; }
trap restore ERR
ln -sfn "$release" /opt/quanttrade/current
recreate_api "$release"
python3 deployment/verify-workflow-runtime.py
systemctl restart quanttrade-bridge
curl --retry 10 --retry-connrefused --retry-delay 1 -fsS http://127.0.0.1:4318/api/health
python3 deployment/verify-scanner-opportunities.py
python3 deployment/verify-scanners.py
python3 deployment/verify-public.py
python3 deployment/verify-background-ai.py
python3 deployment/verify-hyperliquid-connection.py
python3 deployment/verify-journal-spot.py
python3 deployment/verify-arena-hip3.py
curl -fsS https://quanttrade.azurestore.shop/version.json | cmp - frontend/version.json
trap - ERR
printf '\nPaper arena, builder catalogs, news and AI recovery active: %s. No financial actions submitted.\n' "$release"
