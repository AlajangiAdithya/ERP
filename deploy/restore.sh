#!/usr/bin/env bash
# RAPS-ERP — Restore a backup from S3 to the running system.
#
# Usage (on EC2):
#   sudo bash /var/www/raps/deploy/restore.sh FY2025-26/monthly/2026-april.tar.gz
#
# This will:
#   1. Download the bundle from S3
#   2. Show what's inside (date, table count, file count)
#   3. Ask for confirmation
#   4. STOP the API (so writes don't interfere)
#   5. Replace the database with the dump from the backup
#   6. Replace /server/uploads with the files from the backup
#   7. START the API again
#
# This OVERWRITES current data. There is no automatic undo.

set -euo pipefail

if [ -z "${1:-}" ]; then
  echo "Usage: sudo bash restore.sh <s3-key>"
  echo "  e.g. sudo bash restore.sh FY2025-26/monthly/2026-april.tar.gz"
  exit 1
fi

S3_KEY="$1"
APP_DIR="/var/www/raps"
REGION="${AWS_REGION:-ap-south-1}"
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text 2>/dev/null || echo "unknown")
S3_BUCKET="${S3_BUCKET:-raps-backups-${ACCOUNT_ID}}"
WORK="/tmp/raps-restore-work"

DB_URL=$(grep '^DATABASE_URL=' "${APP_DIR}/server/.env" | sed 's/^DATABASE_URL="//' | sed 's/"$//')
UPLOAD_DIR="${APP_DIR}/server/uploads"

if [ -z "$DB_URL" ]; then
  echo "ERROR: DATABASE_URL not found in ${APP_DIR}/server/.env"
  exit 1
fi

mkdir -p "$WORK"; rm -rf "${WORK:?}"/*

echo "──────────────────────────────────────"
echo "  RAPS Restore"
echo "──────────────────────────────────────"
echo "  Source : s3://${S3_BUCKET}/${S3_KEY}"
echo ""

# 1. Download
echo "[1/5] Downloading from S3..."
aws s3 cp "s3://${S3_BUCKET}/${S3_KEY}" "${WORK}/bundle.tar.gz" --region "$REGION"

# 2. Peek
echo ""
echo "[2/5] Inspecting bundle..."
tar -xzf "${WORK}/bundle.tar.gz" -C "$WORK"
if [ -f "${WORK}/metadata.json" ]; then
  echo "  $(cat "${WORK}/metadata.json" | python3 -c "import json,sys; m=json.load(sys.stdin); print('Date:', m.get('date')); print('FY:', m.get('fy')); print('Tier:', m.get('tier')); print('Tables:', len(m.get('tables', []))); print('Files:', m.get('filesCount', 0)); print('DB size:', m.get('dbBytes', 0), 'bytes')" 2>/dev/null || cat "${WORK}/metadata.json")"
else
  echo "  (no metadata.json found in this bundle)"
fi

# 3. Confirm
echo ""
echo "⚠️  This will REPLACE all current data with what was in this backup."
echo "    The API will be stopped for ~1 minute during the restore."
read -rp "Type 'yes' to continue: " CONFIRM
if [ "$CONFIRM" != "yes" ]; then
  echo "Aborted."
  rm -rf "$WORK"
  exit 1
fi

# 4. Stop API
echo ""
echo "[3/5] Stopping API..."
sudo -u ubuntu pm2 stop raps-api 2>/dev/null || pm2 stop raps-api 2>/dev/null || true

# 5. Restore DB
echo ""
echo "[4/5] Restoring database..."
# Drop & recreate public schema so we land in a clean state
psql "$DB_URL" <<'SQL'
DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;
SQL
gunzip -c "${WORK}/db.sql.gz" | psql "$DB_URL"

# 6. Restore files
echo ""
echo "[5/5] Restoring uploaded files..."
if [ -s "${WORK}/files.tar.gz" ]; then
  rm -rf "$UPLOAD_DIR"
  tar -xzf "${WORK}/files.tar.gz" -C "$(dirname "$UPLOAD_DIR")"
  echo "  Files restored to ${UPLOAD_DIR}"
else
  echo "  (no files in this backup — uploads untouched)"
fi

# 7. Start API
echo ""
echo "Starting API..."
sudo -u ubuntu pm2 start raps-api 2>/dev/null || pm2 start raps-api 2>/dev/null || true

# Cleanup
rm -rf "$WORK"

echo ""
echo "──────────────────────────────────────"
echo "  Restore complete."
echo "──────────────────────────────────────"
