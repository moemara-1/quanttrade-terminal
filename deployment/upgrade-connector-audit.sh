#!/usr/bin/env bash
set -euo pipefail
umask 077
previous=/opt/quanttrade/releases/20261023-2
release=/opt/quanttrade/releases/20261024-1
[[ "$(readlink -f /opt/quanttrade/current)" == "$previous" ]]
[[ ! -e "$release" ]]
mkdir "$release"
tar -C "$previous" --exclude='./node_modules' --exclude='./upstream' --exclude='./frontend' -cf - . | tar -C "$release" -xf -
ln -s "$previous/node_modules" "$release/node_modules"
tar -xzf /opt/quanttrade/connector-audit-source.tar.gz -C "$release"
mkdir "$release/frontend"
tar -xzf /opt/quanttrade/connector-audit-frontend.tar.gz -C "$release/frontend"
test -s "$release/frontend/version.json"
test -s "$release/frontend/_shell.html"
chmod a+rx "$release"
chmod -R a+rX "$release/frontend" "$release/src" "$release/tests" "$release/deployment" "$release/overlays" "$release/patches"
restore(){ ln -sfn "$previous" /opt/quanttrade/current; systemctl restart quanttrade-bridge; }
trap restore ERR
ln -sfn "$release" /opt/quanttrade/current
# The unchanged inference worker retains its active and recoverable responses.
systemctl restart quanttrade-bridge
curl --retry 15 --retry-connrefused --retry-delay 1 -fsS http://127.0.0.1:4318/api/health
cd "$release"
python3 deployment/verify-public.py
python3 deployment/verify-background-ai.py
python3 deployment/verify-news-coverage.py
curl -fsS https://quanttrade.azurestore.shop/version.json | cmp - frontend/version.json
trap - ERR
printf '\nConnector audit and bounded assistant recovery active: %s; inference worker unchanged.\n' "$release"
