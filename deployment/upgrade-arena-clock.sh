#!/usr/bin/env bash
set -euo pipefail
umask 077
previous=$(readlink -f /opt/quanttrade/current)
release=/opt/quanttrade/releases/20261020-3
[[ "$previous" == /opt/quanttrade/releases/20261020-2 ]]
[[ ! -e "$release" ]]
mkdir "$release"
tar -C "$previous" --exclude='./node_modules' --exclude='./upstream' --exclude='./frontend' -cf - . | tar -C "$release" -xf -
ln -s "$previous/node_modules" "$release/node_modules"
ln -s "$previous/frontend" "$release/frontend"
tar -xzf /opt/quanttrade/arena-hip3-repair-source.tar.gz -C "$release"
chmod a+rx "$release"
chmod -R a+rX "$release/src" "$release/tests" "$release/deployment"
export PATH=/opt/node-v24.21.0-linux-x64/bin:$PATH
cd "$release"
runuser -u quanttrade -- node --experimental-transform-types --test --test-isolation=none tests/*.test.ts
restore(){ ln -sfn "$previous" /opt/quanttrade/current; systemctl restart quanttrade-bridge; }
trap restore ERR
ln -sfn "$release" /opt/quanttrade/current
systemctl restart quanttrade-bridge
curl --retry 10 --retry-connrefused --retry-delay 1 -fsS http://127.0.0.1:4318/api/health
python3 deployment/verify-arena-hip3.py
python3 deployment/verify-background-ai.py
python3 deployment/verify-hyperliquid-connection.py
trap - ERR
printf '\nArena seconds-based candle freshness fix active: %s; exchange service unchanged.\n' "$release"
