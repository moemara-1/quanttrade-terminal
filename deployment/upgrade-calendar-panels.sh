#!/usr/bin/env bash
set -euo pipefail
umask 077
previous=$(readlink -f /opt/quanttrade/current)
release=/opt/quanttrade/releases/20261012-1
[[ "$previous" == /opt/quanttrade/releases/20261011-5 ]]
test ! -e "$release"
mkdir "$release"
tar -C "$previous" --exclude='./frontend-before-*' --exclude='./upstream' -cf - . | tar -C "$release" -xf -
cd "$release"
tar -xzf /opt/quanttrade/calendar-panels-source.tar.gz
rm -rf frontend
mkdir frontend
tar -xzf /opt/quanttrade/calendar-panels-frontend.tar.gz -C frontend
chmod -R a+rX "$release"
restore(){ ln -sfn "$previous" /opt/quanttrade/current; }
trap restore ERR
ln -sfn "$release" /opt/quanttrade/current
python3 deployment/verify-data-feeds.py
python3 deployment/verify-login.py
python3 deployment/verify-public.py
python3 deployment/verify-frontend-entry.py
python3 deployment/verify-remaining-integration.py
curl -fsS https://quanttrade.azurestore.shop/version.json | cmp - frontend/version.json
trap - ERR
printf '\nCalendar panels release active: %s\n' "$release"
