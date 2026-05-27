#!/usr/bin/env bash
# RAPS-ERP — One-shot HTTPS setup. Run ON the EC2 box.
# Usage:  sudo ./deploy/enable-https.sh your-domain.com you@example.com

set -euo pipefail

DOMAIN="${1:-}"
EMAIL="${2:-}"

if [[ -z "$DOMAIN" || -z "$EMAIL" ]]; then
  echo "Usage: sudo $0 <domain> <email>"
  echo "Example: sudo $0 raps.example.com admin@example.com"
  exit 1
fi

echo "[1/5] installing certbot"
if ! command -v certbot >/dev/null 2>&1; then
  apt-get update
  apt-get install -y certbot python3-certbot-nginx
fi

echo "[2/5] writing nginx config for $DOMAIN"
SITE_FILE="/etc/nginx/sites-available/raps"
sed "s/YOUR_DOMAIN/$DOMAIN/g" /var/www/raps/deploy/nginx-https.conf > "$SITE_FILE"
ln -sf "$SITE_FILE" /etc/nginx/sites-enabled/raps
rm -f /etc/nginx/sites-enabled/default

echo "[3/5] testing & reloading nginx (HTTP-only first, for ACME challenge)"
# Temporarily comment out the 443 server block so nginx can start before cert exists
sed -i 's/^    listen 443/    # listen 443/' "$SITE_FILE"
nginx -t && systemctl reload nginx

echo "[4/5] obtaining cert (certbot will edit $SITE_FILE)"
# Restore the 443 listen line; certbot --nginx adds ssl_certificate lines
sed -i 's/^    # listen 443/    listen 443/' "$SITE_FILE"
certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --redirect

echo "[5/5] reload + verify"
nginx -t && systemctl reload nginx

echo ""
echo "Done. Visit: https://$DOMAIN"
echo "Auto-renew test: sudo certbot renew --dry-run"
