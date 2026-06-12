#!/usr/bin/env bash
# RAPS-ERP — EC2 Bootstrap (single-instance: app + Postgres on same box)
# Run this ON the EC2 instance after setup-infra.sh has provisioned it.
#
# Usage:
#   bash bootstrap.sh <DB_PASSWORD>
#
# What it does:
#   1. Installs Node.js 20, Postgres 16, Nginx, PM2, AWS CLI
#   2. Creates 4 GB swap (needed for Vite build on 2 GB RAM box)
#   3. Creates local Postgres user + database
#   4. Clones repo and writes .env
#   5. Builds backend + frontend
#   6. Starts API with PM2 + configures Nginx
#   7. Installs weekly DB backup cron

set -euo pipefail

DB_PASSWORD="${1:?Usage: bash bootstrap.sh <DB_PASSWORD>}"
DB_NAME="raps"
DB_USER="rapsadmin"
REPO="https://github.com/AlajangiAdithya/ERP.git"
APP_DIR="/var/www/raps"

echo "================================================"
echo "  RAPS-ERP Bootstrap (single-EC2 mode)"
echo "================================================"

# ── 1. System packages ─────────────────────────────
echo ""
echo "[1/8] Installing system packages..."
sudo apt-get update -qq
sudo DEBIAN_FRONTEND=noninteractive apt-get upgrade -y -qq
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
  curl git nginx postgresql-16 postgresql-client-16 jq unzip

# Node.js 20
if ! node -v 2>/dev/null | grep -q "v20"; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nodejs
fi

sudo npm install -g pm2 --silent

# AWS CLI (for S3 backup uploads)
if ! command -v aws &> /dev/null; then
  ARCH=$(uname -m)
  curl -sS "https://awscli.amazonaws.com/awscli-exe-linux-${ARCH}.zip" -o /tmp/awscli.zip
  unzip -q /tmp/awscli.zip -d /tmp
  sudo /tmp/aws/install
  rm -rf /tmp/aws /tmp/awscli.zip
fi

echo "  Node $(node -v) | PM2 $(pm2 -v) | Postgres $(psql --version | awk '{print $3}')"

# ── 2. Swap ─────────────────────────────────────────
echo ""
echo "[2/8] Setting up 4 GB swap..."
if [ ! -f /swapfile ]; then
  sudo fallocate -l 4G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab > /dev/null
fi

# ── 3. Local Postgres ──────────────────────────────
echo ""
echo "[3/8] Configuring local Postgres..."
sudo systemctl enable --now postgresql

# Create role + database if missing (idempotent)
sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'" | grep -q 1 \
  || sudo -u postgres psql -c "CREATE ROLE ${DB_USER} LOGIN PASSWORD '${DB_PASSWORD}';"

sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1 \
  || sudo -u postgres createdb -O "${DB_USER}" "${DB_NAME}"

sudo -u postgres psql -c "ALTER ROLE ${DB_USER} WITH PASSWORD '${DB_PASSWORD}';" > /dev/null

# Make sure Postgres listens only on localhost (no external exposure)
PG_CONF="/etc/postgresql/16/main/postgresql.conf"
sudo sed -i "s/^#listen_addresses.*/listen_addresses = 'localhost'/" "$PG_CONF"
sudo systemctl restart postgresql
echo "  Postgres ready @ localhost:5432 (db=${DB_NAME}, user=${DB_USER})"

# ── 4. Clone repo ──────────────────────────────────
echo ""
echo "[4/8] Getting source code..."
sudo mkdir -p /var/www
sudo chown ubuntu:ubuntu /var/www

if [ -d "$APP_DIR/.git" ]; then
  cd "$APP_DIR" && git pull origin main
else
  [ -d "$APP_DIR" ] && sudo rm -rf "$APP_DIR"
  git clone "$REPO" "$APP_DIR"
fi
cd "$APP_DIR"

# ── 5. Environment files ───────────────────────────
echo ""
echo "[5/8] Writing .env files..."
JWT_SECRET=$(openssl rand -hex 64)
JWT_REFRESH_SECRET=$(openssl rand -hex 64)
ENCODED_PW=$(python3 -c "import urllib.parse; print(urllib.parse.quote('${DB_PASSWORD}', safe=''))")
PUBLIC_IP=$(curl -s http://169.254.169.254/latest/meta-data/public-ipv4 || echo "localhost")

# Backup bucket: matches the convention used by deploy/setup-infra.sh + deploy/backup.sh.
# The API's s3Browse service reads S3_BACKUP_BUCKET to power the SUPERADMIN Backups page.
AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text 2>/dev/null || echo "unknown")
S3_BACKUP_BUCKET="raps-backups-${AWS_ACCOUNT_ID}"
AWS_REGION_FOR_S3="${AWS_REGION:-ap-south-1}"

# Web Push (VAPID) keys — generated once per install; regenerating later
# invalidates every browser push subscription, so they live in .env forever.
VAPID_JSON=$(npx --yes web-push generate-vapid-keys --json)
VAPID_PUBLIC_KEY=$(echo "$VAPID_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)['publicKey'])")
VAPID_PRIVATE_KEY=$(echo "$VAPID_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)['privateKey'])")

cat > server/.env <<EOF
DATABASE_URL="postgresql://${DB_USER}:${ENCODED_PW}@127.0.0.1:5432/${DB_NAME}?schema=public"
DIRECT_URL="postgresql://${DB_USER}:${ENCODED_PW}@127.0.0.1:5432/${DB_NAME}?schema=public"
JWT_SECRET="${JWT_SECRET}"
JWT_REFRESH_SECRET="${JWT_REFRESH_SECRET}"
PORT=4000
NODE_ENV="production"
CLIENT_URL="http://${PUBLIC_IP}"
S3_BACKUP_BUCKET="${S3_BACKUP_BUCKET}"
AWS_REGION="${AWS_REGION_FOR_S3}"
VAPID_PUBLIC_KEY="${VAPID_PUBLIC_KEY}"
VAPID_PRIVATE_KEY="${VAPID_PRIVATE_KEY}"
VAPID_SUBJECT="mailto:sunnytest2506@gmail.com"
EOF

echo "VITE_API_URL=http://${PUBLIC_IP}" > client/.env.production

# ── 6. Backend + frontend build ────────────────────
echo ""
echo "[6/8] Backend deps + migrations..."
cd "$APP_DIR/server"
npm ci --omit=dev --silent
npx prisma generate
npx prisma migrate deploy

echo ""
echo "[7/8] Building frontend (2-3 min)..."
cd "$APP_DIR/client"
npm ci --silent
npm run build
echo "  Build size: $(du -sh dist | cut -f1)"

# ── 7. PM2 + Nginx ─────────────────────────────────
echo ""
echo "[8/8] Starting services..."
sudo mkdir -p /var/log/pm2
sudo chown ubuntu:ubuntu /var/log/pm2

cd "$APP_DIR"
pm2 delete raps-api 2>/dev/null || true
pm2 start deploy/pm2.config.js
pm2 save

STARTUP_CMD=$(pm2 startup systemd -u ubuntu --hp /home/ubuntu 2>/dev/null | grep '^sudo' || true)
[ -n "$STARTUP_CMD" ] && eval "$STARTUP_CMD"

sleep 2
echo "  API health: $(curl -sf http://127.0.0.1:4000/api/health || echo 'STARTING...')"

# Nginx
sudo cp "$APP_DIR/deploy/nginx.conf" /etc/nginx/sites-available/raps
sudo ln -sf /etc/nginx/sites-available/raps /etc/nginx/sites-enabled/raps
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx

# ── Backups ────────────────────────────────────────
sudo cp "$APP_DIR/deploy/backup.sh" /usr/local/bin/raps-backup
sudo chmod 755 /usr/local/bin/raps-backup
sudo cp "$APP_DIR/deploy/backup.cron" /etc/cron.d/raps-backup
sudo chmod 644 /etc/cron.d/raps-backup
sudo touch /var/log/raps-backup.log
# Restore script is invoked manually only (sudo bash /var/www/raps/deploy/restore.sh ...)
# — no symlink, no cron. Lives in the repo so it can be edited and version-controlled.

# ── Done ────────────────────────────────────────────
echo ""
echo "================================================"
echo "  RAPS-ERP is live!"
echo "================================================"
echo ""
echo "  URL:   http://${PUBLIC_IP}"
echo "  API:   http://${PUBLIC_IP}/api/health"
echo ""
echo "  Future redeploy (after git push):"
echo "    ssh -i <key>.pem ubuntu@${PUBLIC_IP} 'cd ${APP_DIR} && ./deploy.sh'"
echo ""
echo "================================================"
