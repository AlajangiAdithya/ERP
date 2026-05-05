#!/usr/bin/env bash
# RAPS-ERP — EC2 Bootstrap Script
# Run this ON the EC2 instance after launch.
#
# Usage:
#   bash ec2-setup.sh <RDS_ENDPOINT> <DB_PASSWORD> [DOMAIN]
#
# Examples:
#   bash ec2-setup.sh raps-prod.xxx.ap-south-1.rds.amazonaws.com MyP@ssw0rd
#   bash ec2-setup.sh raps-prod.xxx.ap-south-1.rds.amazonaws.com MyP@ssw0rd erp.example.com

set -euo pipefail

RDS_ENDPOINT="${1:?Usage: $0 <RDS_ENDPOINT> <DB_PASSWORD> [DOMAIN]}"
DB_PASSWORD="${2:?Usage: $0 <RDS_ENDPOINT> <DB_PASSWORD> [DOMAIN]}"
DOMAIN="${3:-}"
DB_NAME="raps"
DB_USER="rapsadmin"
REPO_URL="https://github.com/AlajangiAdithya/RAPS-ERP.git"
APP_DIR="/var/www/raps"
REGION="ap-south-1"

echo "============================================="
echo "  RAPS-ERP EC2 Bootstrap"
echo "============================================="

# ─── Step 1: System Update ──────────────────────────────────────────────────
echo ""
echo "[1/10] Updating system packages..."
sudo apt update && sudo DEBIAN_FRONTEND=noninteractive apt upgrade -y

# ─── Step 2: Install Dependencies ───────────────────────────────────────────
echo ""
echo "[2/10] Installing Node.js 20, Nginx, PostgreSQL client, tools..."
sudo DEBIAN_FRONTEND=noninteractive apt install -y curl git nginx postgresql-client jq unzip

curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo DEBIAN_FRONTEND=noninteractive apt install -y nodejs

sudo npm install -g pm2

# AWS CLI v2
if ! command -v aws &> /dev/null; then
  ARCH=$(uname -m)
  curl -sS "https://awscli.amazonaws.com/awscli-exe-linux-${ARCH}.zip" -o awscliv2.zip
  unzip -q awscliv2.zip
  sudo ./aws/install
  rm -rf aws awscliv2.zip
fi

echo "  Node: $(node -v) | NPM: $(npm -v) | PM2: $(pm2 -v) | AWS: $(aws --version | cut -d' ' -f1)"

# ─── Step 3: Create Swap (critical for Vite build on t3.micro) ──────────────
echo ""
echo "[3/10] Setting up 4GB swap..."
if [ ! -f /swapfile ]; then
  sudo fallocate -l 4G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab > /dev/null
  echo "  Swap enabled: $(free -h | grep Swap | awk '{print $2}')"
else
  echo "  Swap already exists."
fi

# ─── Step 4: Clone Repository ───────────────────────────────────────────────
echo ""
echo "[4/10] Cloning repository..."
sudo mkdir -p /var/www
sudo chown ubuntu:ubuntu /var/www

if [ -d "$APP_DIR/.git" ]; then
  echo "  Repo exists, pulling latest..."
  cd "$APP_DIR" && git pull origin main
else
  if [ -d "$APP_DIR" ]; then
    sudo rm -rf "$APP_DIR"
  fi
  git clone "$REPO_URL" "$APP_DIR"
fi
cd "$APP_DIR"

# ─── Step 5: Create Environment Files ───────────────────────────────────────
echo ""
echo "[5/10] Creating .env files..."
JWT_SECRET=$(openssl rand -hex 64)
JWT_REFRESH_SECRET=$(openssl rand -hex 64)

# URL-encode password for connection string
ENCODED_PASSWORD=$(python3 -c "import urllib.parse; print(urllib.parse.quote('${DB_PASSWORD}', safe=''))")

if [ -n "$DOMAIN" ]; then
  CLIENT_URL="https://${DOMAIN}"
else
  ELASTIC_IP=$(curl -s http://169.254.169.254/latest/meta-data/public-ipv4 || echo "localhost")
  CLIENT_URL="http://${ELASTIC_IP}"
fi

cat > server/.env <<EOF
DATABASE_URL="postgresql://${DB_USER}:${ENCODED_PASSWORD}@${RDS_ENDPOINT}:5432/${DB_NAME}?sslmode=require&schema=public"
DIRECT_URL="postgresql://${DB_USER}:${ENCODED_PASSWORD}@${RDS_ENDPOINT}:5432/${DB_NAME}?sslmode=require&schema=public"
JWT_SECRET="${JWT_SECRET}"
JWT_REFRESH_SECRET="${JWT_REFRESH_SECRET}"
PORT=4000
NODE_ENV="production"
CLIENT_URL="${CLIENT_URL}"
EOF

echo "VITE_API_URL=${CLIENT_URL}" > client/.env.production

echo "  server/.env created (CLIENT_URL=${CLIENT_URL})"

# ─── Step 6: Install Dependencies & Build ────────────────────────────────────
echo ""
echo "[6/10] Installing backend dependencies..."
cd "$APP_DIR/server"
npm ci --omit=dev

echo "  Generating Prisma client..."
npx prisma generate

echo "  Running database migrations..."
npx prisma migrate deploy

echo ""
echo "[7/10] Building frontend (may take 2-3 min on t3.micro)..."
cd "$APP_DIR/client"
npm ci
npm run build
echo "  Frontend built: $(du -sh dist | cut -f1)"

# ─── Step 8: Start with PM2 ─────────────────────────────────────────────────
echo ""
echo "[8/10] Starting backend with PM2..."
sudo mkdir -p /var/log/pm2
sudo chown ubuntu:ubuntu /var/log/pm2

cd "$APP_DIR"
pm2 delete raps-api 2>/dev/null || true
pm2 start deploy/ecosystem.config.js
pm2 save

STARTUP_CMD=$(pm2 startup systemd -u ubuntu --hp /home/ubuntu 2>/dev/null | grep '^sudo' || true)
if [ -n "$STARTUP_CMD" ]; then
  eval "$STARTUP_CMD"
fi

sleep 2
echo "  Health check: $(curl -sf http://127.0.0.1:4000/api/health || echo 'FAILED — check pm2 logs raps-api')"

# ─── Step 9: Configure Nginx ────────────────────────────────────────────────
echo ""
echo "[9/10] Configuring Nginx..."
sudo cp "$APP_DIR/deploy/nginx-raps.conf" /etc/nginx/sites-available/raps

if [ -n "$DOMAIN" ]; then
  sudo sed -i "s/erp.yourdomain.com/${DOMAIN}/g" /etc/nginx/sites-available/raps
else
  sudo sed -i "s/server_name erp.yourdomain.com;/server_name _;/" /etc/nginx/sites-available/raps
  # Disable SSL redirect when no domain
  sudo sed -i '/listen 80/,/^}/{ s/return 301/#return 301/ }' /etc/nginx/sites-available/raps
fi

sudo ln -sf /etc/nginx/sites-available/raps /etc/nginx/sites-enabled/raps
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
echo "  Nginx configured."

# SSL setup if domain provided
if [ -n "$DOMAIN" ]; then
  echo "  Installing Certbot for SSL..."
  sudo DEBIAN_FRONTEND=noninteractive apt install -y certbot python3-certbot-nginx
  echo "  Run this after DNS is pointed to this server:"
  echo "    sudo certbot --nginx -d ${DOMAIN} --agree-tos -m admin@${DOMAIN} --no-eff-email --redirect"
fi

# ─── Step 10: Setup Quarterly Backups ────────────────────────────────────────
echo ""
echo "[10/10] Setting up quarterly backup cron..."
sudo cp "$APP_DIR/deploy/raps-backup.sh" /usr/local/bin/raps-backup.sh
sudo chmod 755 /usr/local/bin/raps-backup.sh
sudo cp "$APP_DIR/deploy/raps-backup-cron" /etc/cron.d/raps-backup
sudo chmod 644 /etc/cron.d/raps-backup
sudo touch /var/log/raps-backup.log

echo "  Backup cron installed (quarterly: Jan/Apr/Jul/Oct 1st at 00:30 IST)."

# ─── Done ────────────────────────────────────────────────────────────────────
echo ""
echo "============================================="
echo "  RAPS-ERP is live!"
echo "============================================="
echo ""
echo "  App URL:  ${CLIENT_URL}"
echo "  API:      ${CLIENT_URL}/api/health"
echo ""
echo "  Useful commands:"
echo "    pm2 status                    # check backend"
echo "    pm2 logs raps-api --lines 50  # view logs"
echo "    cd ${APP_DIR} && ./deploy.sh  # redeploy after git push"
echo ""
if [ -n "$DOMAIN" ]; then
  echo "  SSL: run certbot after DNS propagates:"
  echo "    sudo certbot --nginx -d ${DOMAIN}"
fi
echo "============================================="
