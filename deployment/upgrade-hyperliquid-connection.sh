#!/usr/bin/env bash
set -euo pipefail
umask 077
previous=$(readlink -f /opt/quanttrade/current)
release=/opt/quanttrade/releases/20261017-2
[[ "$previous" == /opt/quanttrade/releases/20261017-1 ]]
[[ ! -e "$release" ]]
(( $(df -Pk /opt/quanttrade | awk 'NR==2 {print $4}') >= 524288 ))
mkdir "$release"
tar -C "$previous" --exclude='./node_modules' --exclude='./upstream' --exclude='./frontend-before-*' -cf - . | tar -C "$release" -xf -
ln -s "$previous/node_modules" "$release/node_modules"
tar -xzf /opt/quanttrade/hyperliquid-connection.tar.gz -C "$release"
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
python3 deployment/verify-hyperliquid-connection.py
python3 deployment/verify-background-ai.py
python3 deployment/verify-public.py
python3 deployment/verify-journal-spot.py
python3 deployment/verify-workflow-runtime.py
python3 deployment/verify-assistant-execution-repair.py
trap - ERR
printf '\nHyperliquid connection parity active: %s; exchange service unchanged.\n' "$release"
