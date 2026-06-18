#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# setup-https.sh — put automatic HTTPS in front of the RAPS ERP Node app.
#
# WHY: browsers block service workers + web push on http:// (the "Needs HTTPS —
# push is blocked" banner). Web push ONLY works on https:// (or localhost).
# This installs Caddy as a reverse proxy that auto-obtains a free Let's Encrypt
# certificate and forwards https://<host>  ->  http://localhost:<APP_PORT>.
#
# RUN ON THE EC2 BOX (not your PC):
#   sudo bash deploy/setup-https.sh
#
# With your own domain (point its DNS A-record to this EC2's public IP first):
#   DOMAIN=erp.yourcompany.com sudo -E bash deploy/setup-https.sh
#
# ⚠ BEFORE RUNNING: in the AWS console open this instance's Security Group
#   inbound rules for  TCP 80  AND  TCP 443  (Source 0.0.0.0/0). Without 443
#   open, the cert can't be issued and nobody can reach https.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root:  sudo bash deploy/setup-https.sh"; exit 1
fi

APP_PORT="${APP_PORT:-5001}"

# Repo dir = parent of this script's dir, so we can patch server/.env later.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$REPO_DIR/server/.env"

# ── 1. Decide the hostname the certificate is issued for ─────────────────────
if [ -n "${DOMAIN:-}" ]; then
  HOST="$DOMAIN"
else
  IP="$(curl -fsS https://checkip.amazonaws.com 2>/dev/null || curl -fsS ifconfig.me)"
  IP="$(echo "$IP" | tr -d '[:space:]')"
  if [ -z "$IP" ]; then echo "Could not detect public IP. Pass DOMAIN=... instead."; exit 1; fi
  # sslip.io resolves <ip>.sslip.io -> <ip>, so Let's Encrypt can validate it
  # without you owning a domain.
  HOST="${IP}.sslip.io"
fi
echo ">> HTTPS host : $HOST"
echo ">> Proxy to   : localhost:$APP_PORT"

# ── 2. Install Caddy (arch-aware static binary — works on Ubuntu & Amazon Linux) ─
if ! command -v caddy >/dev/null 2>&1 && [ ! -x /usr/local/bin/caddy ]; then
  ARCH=amd64; case "$(uname -m)" in aarch64|arm64) ARCH=arm64;; esac
  echo ">> Downloading Caddy ($ARCH)…"
  curl -fsSL "https://caddyserver.com/api/download?os=linux&arch=$ARCH" -o /usr/local/bin/caddy
  chmod +x /usr/local/bin/caddy
fi
CADDY_BIN="$(command -v caddy || echo /usr/local/bin/caddy)"

# Dedicated service user + dirs for cert storage.
id caddy >/dev/null 2>&1 || useradd --system --shell /usr/sbin/nologin --home /var/lib/caddy caddy 2>/dev/null || useradd --system caddy 2>/dev/null || true
mkdir -p /etc/caddy /var/lib/caddy
chown -R caddy:caddy /var/lib/caddy 2>/dev/null || true

# ── 3. Caddyfile ─────────────────────────────────────────────────────────────
cat > /etc/caddy/Caddyfile <<EOF
$HOST {
    encode gzip
    reverse_proxy localhost:$APP_PORT
}
EOF
echo ">> Wrote /etc/caddy/Caddyfile"

# ── 4. systemd service ───────────────────────────────────────────────────────
cat > /etc/systemd/system/caddy.service <<EOF
[Unit]
Description=Caddy (RAPS ERP HTTPS)
After=network.target

[Service]
User=caddy
Group=caddy
ExecStart=$CADDY_BIN run --config /etc/caddy/Caddyfile --adapter caddyfile
ExecReload=$CADDY_BIN reload --config /etc/caddy/Caddyfile --adapter caddyfile
Restart=on-failure
AmbientCapabilities=CAP_NET_BIND_SERVICE
LimitNOFILE=1048576

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now caddy
sleep 2
systemctl restart caddy

# ── 5. Point the app's CORS origin at the new https host, then restart it ─────
if [ -f "$ENV_FILE" ]; then
  if grep -q '^CLIENT_URL=' "$ENV_FILE"; then
    sed -i "s#^CLIENT_URL=.*#CLIENT_URL=\"https://$HOST\"#" "$ENV_FILE"
  else
    echo "CLIENT_URL=\"https://$HOST\"" >> "$ENV_FILE"
  fi
  echo ">> Set CLIENT_URL=https://$HOST in server/.env"
fi
if command -v pm2 >/dev/null 2>&1; then
  pm2 restart all --update-env >/dev/null 2>&1 || true
  echo ">> Restarted pm2 apps"
fi

echo ""
echo "════════════════════════════════════════════════════════════"
echo " DONE.  Open:   https://$HOST"
echo "  • First load may take ~10s while the certificate is issued."
echo "  • If it doesn't load: confirm Security Group allows 80 + 443."
echo "  • Then in the app: Notifications → Enable → Send test."
echo "  • Tell everyone to use the https:// URL from now on."
echo "════════════════════════════════════════════════════════════"
echo " Caddy logs:  journalctl -u caddy -f"
