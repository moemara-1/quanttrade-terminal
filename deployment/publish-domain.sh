#!/usr/bin/env bash
set -euo pipefail
umask 077
host=quanttrade.azurestore.shop
getent ahostsv4 "$host" | grep -q '^167.233.56.222 ' || { echo 'DNS does not match the server.' >&2; exit 1; }
install -d -m 0755 /var/www/quanttrade-acme
if [[ ! -f /etc/letsencrypt/live/$host/fullchain.pem ]]; then
    cat > /etc/nginx/sites-available/quanttrade-public <<'NGINX'
server {
    listen 80;
    listen [::]:80;
    server_name quanttrade.azurestore.shop;
    location ^~ /.well-known/acme-challenge/ { root /var/www/quanttrade-acme; }
    location / { return 404; }
}
NGINX
    ln -sfn /etc/nginx/sites-available/quanttrade-public /etc/nginx/sites-enabled/quanttrade-public
    nginx -t
    systemctl reload nginx
    certbot certonly --webroot -w /var/www/quanttrade-acme -d "$host" --non-interactive --agree-tos --register-unsafely-without-email
fi
python3 - <<'PY'
from pathlib import Path
import secrets,subprocess,json
credentials=Path('/opt/quanttrade/shared/web-access.json')
if not credentials.exists():
    credentials.write_text(json.dumps({'username':'quanttrade','password':secrets.token_urlsafe(24)},indent=2)+'\n')
    credentials.chmod(0o600)
auth=json.loads(credentials.read_text())
digest=subprocess.run(['openssl','passwd','-apr1','-stdin'],input=auth['password']+'\n',text=True,capture_output=True,check=True).stdout.strip()
p=Path('/etc/nginx/quanttrade.htpasswd')
p.write_text(auth['username']+':'+digest+'\n')
p.chmod(0o640)
import shutil
shutil.chown(p,user='root',group='www-data')
env=Path('/opt/quanttrade/shared/bridge.env')
settings=dict(line.split('=',1) for line in env.read_text().splitlines() if '=' in line)
settings['PAIRLENS_URL']='https://quanttrade.azurestore.shop'
settings['ALLOWED_ORIGINS']='https://quanttrade.azurestore.shop'
settings['WEB_SESSION_ORIGIN']='https://quanttrade.azurestore.shop'
settings.setdefault('WEB_SESSION_PROXY_SECRET',secrets.token_hex(32))
session=Path('/etc/nginx/quanttrade-session.conf')
session.write_text('proxy_set_header X-QuantTrade-Session-Secret '+settings['WEB_SESSION_PROXY_SECRET']+';\n')
session.chmod(0o600)
env.write_text(''.join(f'{k}={v}\n' for k,v in settings.items()))
env.chmod(0o600)
PY
install -m 0644 /opt/quanttrade/current/deployment/nginx-public.conf /etc/nginx/sites-available/quanttrade-public
nginx -t
systemctl restart quanttrade-bridge
systemctl reload nginx
install -d -m 0755 /etc/letsencrypt/renewal-hooks/deploy
printf '#!/bin/sh\nnginx -t && systemctl reload nginx\n' > /etc/letsencrypt/renewal-hooks/deploy/quanttrade-nginx.sh
chmod 0755 /etc/letsencrypt/renewal-hooks/deploy/quanttrade-nginx.sh
systemctl is-active nginx quanttrade-bridge
