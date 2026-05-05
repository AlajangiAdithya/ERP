#!/usr/bin/env bash
# RAPS-ERP — Weekly database backup to S3
# Runs every Sunday at 00:30 IST via cron.
# Keeps: last 4 weeks in S3 Standard, older in Glacier (via bucket lifecycle).

set -euo pipefail

APP_DIR="/var/www/raps"
REGION="${AWS_REGION:-ap-south-1}"
LOG="/var/log/raps-backup.log"
DATE=$(date +%Y-%m-%d)
DUMP="/tmp/raps-${DATE}.sql.gz"

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text 2>/dev/null || echo "unknown")
S3_BUCKET="${S3_BUCKET:-raps-backups-${ACCOUNT_ID}}"
S3_KEY="backups/${DATE}.sql.gz"

DB_URL=$(grep '^DATABASE_URL=' "${APP_DIR}/server/.env" | sed 's/^DATABASE_URL="//' | sed 's/"$//')

if [ -z "$DB_URL" ]; then
  echo "$(date -Is) ERROR: DATABASE_URL not found" >> "$LOG"
  exit 1
fi

{
  echo "──────────────────────────────────────"
  echo "$(date -Is) Backup starting: ${DATE}"

  pg_dump "$DB_URL" --no-owner --no-acl --format=plain --compress=9 > "$DUMP"
  echo "$(date -Is) Dump: $(du -h "$DUMP" | cut -f1)"

  aws s3 cp "$DUMP" "s3://${S3_BUCKET}/${S3_KEY}" --region "$REGION" --only-show-errors
  echo "$(date -Is) Uploaded: s3://${S3_BUCKET}/${S3_KEY}"

  rm -f "$DUMP"

  # Delete local S3 backups older than 90 days (Glacier handles long-term)
  CUTOFF=$(date -d "90 days ago" +%Y-%m-%d 2>/dev/null || date -v-90d +%Y-%m-%d 2>/dev/null || echo "skip")
  if [ "$CUTOFF" != "skip" ]; then
    aws s3api list-objects-v2 --bucket "$S3_BUCKET" --prefix "backups/" --region "$REGION" \
      --query "Contents[?LastModified<='${CUTOFF}'].Key" --output text 2>/dev/null | \
      tr '\t' '\n' | while read -r key; do
        [ -n "$key" ] && [ "$key" != "None" ] && \
          aws s3api delete-object --bucket "$S3_BUCKET" --key "$key" --region "$REGION" 2>/dev/null
      done
    echo "$(date -Is) Old backups cleaned (before ${CUTOFF})"
  fi

  echo "$(date -Is) Backup complete"
} >> "$LOG" 2>&1
