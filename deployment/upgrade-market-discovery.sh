#!/usr/bin/env bash
set -euo pipefail
release=/opt/quanttrade/releases/20261006-3
previous=$(readlink -f /opt/quanttrade/current)
[[ "$previous" == /opt/quanttrade/releases/* ]]
[[ "$release" != "$previous" ]]
[[ ! -e "$release" ]]
# Keep the unchanged bridge and its dependencies with the new frontend release.
cp -a "$previous" "$release"
tar --warning=no-unknown-keyword -xzf /opt/quanttrade/frontend-markets.tar.gz -C "$release/frontend"
tar --warning=no-unknown-keyword -xzf /opt/quanttrade/market-source.tar.gz -C "$release"
test -s "$release/frontend/_shell.html"
chmod -R a+rX "$release"
restore() { ln -sfn "$previous" /opt/quanttrade/current; }
trap restore ERR
ln -sfn "$release" /opt/quanttrade/current
curl -fsS http://127.0.0.1:4317/futures >/dev/null
curl -fsS http://127.0.0.1:4318/api/health >/dev/null
trap - ERR
printf 'Market discovery frontend active: %s\n' "$release"
