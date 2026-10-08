#!/usr/bin/env bash
set -euo pipefail
if command -v docker >/dev/null && docker compose version >/dev/null; then exit 0; fi
. /etc/os-release
if [[ "$ID" != ubuntu ]]; then echo 'This bootstrap expects Ubuntu.' >&2; exit 1; fi
export DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=l
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
printf 'deb [arch=%s signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu %s stable\n' "$(dpkg --print-architecture)" "$VERSION_CODENAME" > /etc/apt/sources.list.d/quanttrade-docker.list
apt-get update
apt-get install -y --no-install-recommends docker-ce docker-ce-cli containerd.io docker-compose-plugin
systemctl enable --now docker
docker --version
docker compose version
