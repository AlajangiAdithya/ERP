#!/usr/bin/env bash
# RAPS-ERP — Quarterly database backup to S3
# Creates a compressed pg_dump and uploads to S3 with lifecycle tiering.
#
# Schedule (via cron): Jan 1, Apr 1, Jul 1, Oct 1 at 00:30 IST
# S3 lifecycle: Standard (0-90d) → Glacier Instant (90-365d) → Deep Archive (365d+)
#
# Requires:
#   - PostgreSQL client (pg_dump) installed
#   - AWS CLI with S3 write access (via EC2 IAM role)
#   - DATABASE_URL in /var/www/raps/server/.env

set -euo pipefail

APP_DIR="/var/www/raps"
REGION="${AWS_REGION:-ap-south-1}"
LOGFILE="/var/log/raps-backup.log"
TIMESTAMP=$(date +%Y-%m-%d_%H%M)
QUARTER="Q$(( ($(date +%-m) - 1) / 3 + 1 ))"
YEAR=$(date +%Y)
BACKUP_NAME="raps-${YEAR}-${QUARTER}-${TIMESTAMP}"
DUMP_FILE="/tmp/${BACKUP_NAME}.sql.gz"

# Resolve S3 bucket name
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text 2>/dev/null || echo "unknown")
S3_BUCKET="${S3_BUCKET:-raps-erp-backups-${ACCOUNT_ID}}"
S3_KEY="quarterly/${YEAR}/${BACKUP_NAME}.sql.gz"

# Extract DATABASE_URL from .env
DB_URL=$(grep '^DATABASE_URL=' "${APP_DIR}/server/.env" | sed 's/^DATABASE_URL="//' | sed 's/"$//')

if [ -z "$DB_URL" ]; then
  echo "$(date -Is) ERROR: DATABASE_URL not found in ${APP_DIR}/server/.env" >> "$LOGFILE"
  exit 1
fi

{
  echo "================================================================"
  echo "$(date -Is) - Starting quarterly backup: ${BACKUP_NAME}"
  echo "  Bucket: s3://${S3_BUCKET}/${S3_KEY}"

  # Create compressed dump
  echo "$(date -Is) - Running pg_dump..."
  pg_dump "$DB_URL" \
    --no-owner --no-acl \
    --format=plain \
    --compress=9 \
    > "$DUMP_FILE"

  DUMP_SIZE=$(du -h "$DUMP_FILE" | cut -f1)
  echo "$(date -Is) - Dump created: ${DUMP_SIZE}"

  # Upload to S3
  echo "$(date -Is) - Uploading to S3..."
  aws s3 cp "$DUMP_FILE" "s3://${S3_BUCKET}/${S3_KEY}" \
    --region "$REGION" \
    --storage-class STANDARD \
    --only-show-errors

  echo "$(date -Is) - Upload complete."

  # Verify upload
  S3_SIZE=$(aws s3api head-object \
    --bucket "$S3_BUCKET" --key "$S3_KEY" --region "$REGION" \
    --query "ContentLength" --output text 2>/dev/null || echo "0")

  if [ "$S3_SIZE" -gt 0 ] 2>/dev/null; then
    echo "$(date -Is) - Verified: ${S3_SIZE} bytes in S3."
  else
    echo "$(date -Is) - WARNING: Could not verify S3 upload."
  fi

  # Cleanup local dump
  rm -f "$DUMP_FILE"
  echo "$(date -Is) - Local dump cleaned up."

  # List recent backups
  echo ""
  echo "Recent backups in S3:"
  aws s3 ls "s3://${S3_BUCKET}/quarterly/" --recursive --region "$REGION" | tail -8

  echo ""
  echo "$(date -Is) - Backup ${BACKUP_NAME} complete."
} >> "$LOGFILE" 2>&1
