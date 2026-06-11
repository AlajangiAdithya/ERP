#!/usr/bin/env bash
# RAPS-ERP — Redeploy after a git push.
# Run ON the EC2 box:  cd /var/www/raps && ./deploy/deploy.sh

set -euo pipefail

APP_DIR="/var/www/raps"
cd "$APP_DIR"

echo "[1/6] git pull"
git pull origin main

echo "[2/6] backend deps"
cd "$APP_DIR/server"
npm ci --omit=dev --silent

echo "[3/6] prisma"
npx prisma generate
# db push keeps the schema in sync without needing a clean migration history
npx prisma db push --accept-data-loss

echo "[4/6] frontend build"
cd "$APP_DIR/client"
npm ci --silent
npm run build

echo "[5/6] restart api"
cd "$APP_DIR"
pm2 restart raps-api --update-env
pm2 save

echo "[6/6] reload nginx"
sudo nginx -t && sudo systemctl reload nginx

sleep 2
echo ""
echo "Health: $(curl -sf http://127.0.0.1:4000/api/health || echo 'FAILED')"
echo "Done."
