#!/usr/bin/env bash
# RAPS-ERP — EC2 Bootstrap
# Run this ON the EC2 instance after infrastructure is created.
#
# Usage:
#   bash bootstrap.sh <RDS_ENDPOINT> <DB_PASSWORD>
#
# What it does:
#   1. Installs Node.js 20, Nginx, PM2, AWS CLI
#   2. Creates swap (needed for Vite build)
#   3. Clones repo and sets up .env
#   4. Builds everything and starts the app
#   5. Configures Nginx reverse proxy
#   6. Sets up weekly backups

set -euo pipefail

RDS_ENDPOINT="${1:?Usage: bash bootstrap.sh <RDS_ENDPOINT> <DB_PASSWORD>}"
DB_PASSWORD="${2:?Usage: bash bootstrap.sh <RDS_ENDPOINT> <DB_PASSWORD>}"
DB_NAME="raps"
DB_USER="rapsadmin"
REPO="https://github.com/AlajangiAdithya/RAPS-ERP.git"
APP_DIR="/var/www/raps"

echo "================================================"
echo "  RAPS-ERP Bootstrap"
echo "================================================"

# ── 1. System packages ─────────────────────────────
echo ""
echo "[1/8] Installing system packages..."
sudo apt-get update -qq
sudo DEBIAN_FRONTEND=noninteractive apt-get upgrade -y -qq
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
  curl git nginx postgresql-client jq unzip

# Node.js 20
if ! node -v 2>/dev/null | grep -q "v20"; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nodejs
fi

# PM2
sudo npm install -g pm2 --silent

# AWS CLI
if ! command -v aws &> /dev/null; then
  ARCH=$(uname -m)
  curl -sS "https://awscli.amazonaws.com/awscli-exe-linux-${ARCH}.zip" -o /tmp/awscli.zip
  unzip -q /tmp/awscli.zip -d /tmp
  sudo /tmp/aws/install
  rm -rf /tmp/aws /tmp/awscli.zip
fi

echo "  Node $(node -v) | PM2 $(pm2 -v) | AWS $(aws --version | cut -d' ' -f1)"

# ── 2. Swap ─────────────────────────────────────────
echo ""
echo "[2/8] Setting up swap..."
if [ ! -f /swapfile ]; then
  sudo fallocate -l 4G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab > /dev/null
  echo "  4 GB swap enabled"
else
  echo "  Swap already exists"
fi

# ── 3. Clone repo ──────────────────────────────────
echo ""
echo "[3/8] Getting source code..."
sudo mkdir -p /var/www
sudo chown ubuntu:ubuntu /var/www

if [ -d "$APP_DIR/.git" ]; then
  echo "  Repo exists, pulling latest..."
  cd "$APP_DIR" && git pull origin main
else
  [ -d "$APP_DIR" ] && sudo rm -rf "$APP_DIR"
  git clone "$REPO" "$APP_DIR"
fi
cd "$APP_DIR"

# ── 4. Environment files ───────────────────────────
echo ""
echo "[4/8] Creating .env files..."
JWT_SECRET=$(openssl rand -hex 64)
JWT_REFRESH_SECRET=$(openssl rand -hex 64)
ENCODED_PW=$(python3 -c "import urllib.parse; print(urllib.parse.quote('${DB_PASSWORD}', safe=''))")
PUBLIC_IP=$(curl -s http://169.254.169.254/latest/meta-data/public-ipv4 || echo "localhost")

cat > server/.env <<EOF
DATABASE_URL="postgresql://${DB_USER}:${ENCODED_PW}@${RDS_ENDPOINT}:5432/${DB_NAME}?sslmode=require&schema=public"
DIRECT_URL="postgresql://${DB_USER}:${ENCODED_PW}@${RDS_ENDPOINT}:5432/${DB_NAME}?sslmode=require&schema=public"
JWT_SECRET="${JWT_SECRET}"
JWT_REFRESH_SECRET="${JWT_REFRESH_SECRET}"
PORT=4000
NODE_ENV="production"
CLIENT_URL="http://${PUBLIC_IP}"
EOF

echo "VITE_API_URL=http://${PUBLIC_IP}" > client/.env.production
echo "  .env files created (IP: ${PUBLIC_IP})"

# ── 5. Backend ──────────────────────────────────────
echo ""
echo "[5/8] Setting up backend..."
cd "$APP_DIR/server"
npm ci --omit=dev --silent
npx prisma generate
npx prisma migrate deploy
echo "  Backend ready"

# ── 6. Frontend ─────────────────────────────────────
echo ""
echo "[6/8] Building frontend (2-3 min)..."
cd "$APP_DIR/client"
npm ci --silent
npm run build
echo "  Frontend built: $(du -sh dist | cut -f1)"

# ── 7. PM2 + Nginx ─────────────────────────────────
echo ""
echo "[7/8] Starting services..."
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
sudo sed -i "s/server_name _;/server_name _;/" /etc/nginx/sites-available/raps
sudo ln -sf /etc/nginx/sites-available/raps /etc/nginx/sites-enabled/raps
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
echo "  Nginx configured"

# ── 8. Backups ──────────────────────────────────────
echo ""
echo "[8/8] Setting up weekly backups..."
sudo cp "$APP_DIR/deploy/backup.sh" /usr/local/bin/raps-backup
sudo chmod 755 /usr/local/bin/raps-backup
sudo cp "$APP_DIR/deploy/backup.cron" /etc/cron.d/raps-backup
sudo chmod 644 /etc/cron.d/raps-backup
sudo touch /var/log/raps-backup.log
echo "  Weekly backup cron installed"

# ── Done ────────────────────────────────────────────
echo ""
echo "================================================"
echo "  RAPS-ERP is live!"
echo "================================================"
echo ""
echo "  URL:   http://${PUBLIC_IP}"
echo "  API:   http://${PUBLIC_IP}/api/health"
echo ""
echo "  Commands:"
echo "    pm2 status                    # check backend"
echo "    pm2 logs raps-api --lines 50  # view logs"
echo "    cd ${APP_DIR} && ./deploy.sh  # redeploy after git push"
echo ""
echo "================================================"
