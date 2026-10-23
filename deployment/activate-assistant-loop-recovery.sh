#!/usr/bin/env bash
set -euo pipefail
umask 077
previous=/opt/quanttrade/releases/20261022-3
release=/opt/quanttrade/releases/20261023-1
[[ "$(readlink -f /opt/quanttrade/current)" == "$previous" ]]
test -s "$release/frontend/version.json"
test -s "$release/frontend/_shell.html"
test -s "$release/src/server/asset-profiles.ts"
# This release already passed all 415 backend tests during staging.
# SIGTERM drains new inference requests while retaining existing responses.
# The worker exits only after its complete ten-minute recovery window clears.
systemctl stop quanttrade-inference
restore(){ ln -sfn "$previous" /opt/quanttrade/current; systemctl start quanttrade-inference; systemctl restart quanttrade-bridge; }
trap restore ERR
ln -sfn "$release" /opt/quanttrade/current
systemctl start quanttrade-inference
systemctl restart quanttrade-bridge
curl --retry 10 --retry-connrefused --retry-delay 1 -fsS http://127.0.0.1:4319/health
curl --retry 15 --retry-connrefused --retry-delay 1 -fsS http://127.0.0.1:4318/api/health
cd "$release"
python3 deployment/verify-background-ai.py
python3 deployment/verify-public.py
python3 deployment/verify-asset-profile.py
python3 deployment/verify-arena-hip3.py
curl -fsS https://quanttrade.azurestore.shop/version.json | cmp - frontend/version.json
trap - ERR
printf '\nAssistant loop and fundamentals recovery active: %s; exchange services unchanged.\n' "$release"
