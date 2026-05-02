#!/usr/bin/env bash
# One-command redeploy. Run on the EC2 box from /var/www/raps.

set -euo pipefail

cd "$(dirname "$0")"

echo "=== Pulling latest =="
git fetch --all --prune
git reset --hard origin/main

echo "=== Backend deps + migrations =="
cd server
npm ci --omit=dev
npx prisma generate
npx prisma migrate deploy
cd ..

echo "=== Frontend build =="
cd client
npm ci
npm run build
cd ..

echo "=== Restarting API =="
pm2 restart raps-api --update-env

echo "=== Reloading nginx =="
sudo nginx -t && sudo systemctl reload nginx

echo "=== Done at $(date -Is) =="
pm2 status
