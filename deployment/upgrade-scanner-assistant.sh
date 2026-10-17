#!/usr/bin/env bash
set -euo pipefail
umask 077
previous=$(readlink -f /opt/quanttrade/current)
release=/opt/quanttrade/releases/20261018-1
[[ "$previous" == /opt/quanttrade/releases/20261017-6 ]]
[[ ! -e "$release" ]]
(( $(df -Pk /opt/quanttrade | awk 'NR==2 {print $4}') >= 524288 ))
mkdir "$release"
tar -C "$previous" --exclude='./node_modules' --exclude='./upstream' --exclude='./frontend' --exclude='./frontend-before-*' -cf - . | tar -C "$release" -xf -
ln -s "$previous/node_modules" "$release/node_modules"
tar -xzf /opt/quanttrade/scanner-assistant-source.tar.gz -C "$release"
mkdir "$release/frontend"
tar -xzf /opt/quanttrade/scanner-assistant-frontend.tar.gz -C "$release/frontend"
test -s "$release/frontend/version.json"
test -s "$release/frontend/_shell.html"
chmod a+rx "$release"
chmod -R a+rX "$release/frontend" "$release/deployment" "$release/overlays" "$release/patches"
restore(){ ln -sfn "$previous" /opt/quanttrade/current; }
trap restore ERR
ln -sfn "$release" /opt/quanttrade/current
cd "$release"
python3 deployment/verify-scanner-assistant.py
python3 deployment/verify-public.py
python3 deployment/verify-background-ai.py
python3 deployment/verify-hyperliquid-connection.py
python3 deployment/verify-journal-spot.py
curl -fsS https://quanttrade.azurestore.shop/version.json | cmp - frontend/version.json
trap - ERR
printf '\nScanner assistant and polished reports active: %s; services unchanged.\n' "$release"
