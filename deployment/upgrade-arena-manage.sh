#!/usr/bin/env bash
set -euo pipefail
umask 077
previous=$(readlink -f /opt/quanttrade/current)
release=/opt/quanttrade/releases/20261021-2
[[ "$previous" == /opt/quanttrade/releases/20261021-1 ]]
[[ ! -e "$release" ]]
mkdir "$release"
tar -C "$previous" --exclude='./node_modules' --exclude='./upstream' --exclude='./frontend' -cf - . | tar -C "$release" -xf -
ln -s "$previous/node_modules" "$release/node_modules"
tar -xzf /opt/quanttrade/arena-manage-source.tar.gz -C "$release"
mkdir "$release/frontend"
tar -xzf /opt/quanttrade/arena-manage-frontend.tar.gz -C "$release/frontend"
test -s "$release/frontend/version.json"
test -s "$release/frontend/_shell.html"
chmod a+rx "$release"
chmod -R a+rX "$release/frontend" "$release/src" "$release/tests" "$release/deployment" "$release/overlays" "$release/patches"
restore(){ ln -sfn "$previous" /opt/quanttrade/current; }
trap restore ERR
ln -sfn "$release" /opt/quanttrade/current
cd "$release"
python3 deployment/verify-public.py
python3 deployment/verify-background-ai.py
python3 deployment/verify-arena-hip3.py
curl -fsS https://quanttrade.azurestore.shop/version.json | cmp - frontend/version.json
trap - ERR
printf '\nLM Arena mobile management active: %s; services unchanged.\n' "$release"
