#!/usr/bin/env bash
# RAPS-ERP — FY-aligned tiered backup to S3.
#
# Runs every Sunday 00:30 IST via cron. Bundles (Postgres dump + /server/uploads
# + metadata.json) into one .tar.gz and promotes it through tiers:
#
#   weekly       — only ever 1 file (overwritten each Sunday)
#   monthly      — last Sunday of each calendar month; keeps up to 3 in a quarter
#   quarterly    — last Sunday of FY-quarter month (Jun/Sep/Dec/Mar); keeps 2 per half
#   half-yearly  — last Sunday of Sep or Mar; keeps 2 per FY
#   yearly       — last Sunday of March (FY end); kept forever
#
# When a backup is promoted to a higher tier the files at the lower tier
# (which it consumed) are deleted from S3.
#
# Indian Financial Year: 1 Apr → 31 Mar. Folder name = "FY<startYY>-<endYY>".

set -euo pipefail

APP_DIR="/var/www/raps"
REGION="${AWS_REGION:-ap-south-1}"
LOG="/var/log/raps-backup.log"
WORK="/tmp/raps-backup-work"
DATE_ISO=$(date +%Y-%m-%d)
TODAY_EPOCH=$(date +%s)

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text 2>/dev/null || echo "unknown")
S3_BUCKET="${S3_BUCKET:-raps-backups-${ACCOUNT_ID}}"

DB_URL=$(grep '^DATABASE_URL=' "${APP_DIR}/server/.env" | sed 's/^DATABASE_URL="//' | sed 's/"$//')
UPLOAD_DIR="${APP_DIR}/server/uploads"

if [ -z "$DB_URL" ]; then
  echo "$(date -Is) ERROR: DATABASE_URL not found in ${APP_DIR}/server/.env" | tee -a "$LOG"
  exit 1
fi

mkdir -p "$WORK"
rm -rf "${WORK:?}"/*

log() { echo "$(date -Is) $*" | tee -a "$LOG"; }

# ───────────────────────────────────────────────────────────
# 1. Compute Indian Financial Year folder + tier flags
# ───────────────────────────────────────────────────────────
YEAR=$(date +%Y)
MONTH=$(date +%-m)         # 1..12
DAY=$(date +%-d)

# FY runs Apr → Mar. If month ≥ 4 then current FY is YEAR-(YEAR+1); else (YEAR-1)-YEAR.
if [ "$MONTH" -ge 4 ]; then
  FY_START=$YEAR
  FY_END=$((YEAR + 1))
else
  FY_START=$((YEAR - 1))
  FY_END=$YEAR
fi
FY_LABEL="FY${FY_START: -2}-${FY_END: -2}"   # e.g. FY25-26
S3_FY_PREFIX="${FY_LABEL}"

# Is today the LAST Sunday of this calendar month?
NEXT_SUNDAY_EPOCH=$((TODAY_EPOCH + 7 * 86400))
NEXT_SUNDAY_MONTH=$(date -d "@${NEXT_SUNDAY_EPOCH}" +%-m 2>/dev/null || date -r "${NEXT_SUNDAY_EPOCH}" +%-m)
if [ "$NEXT_SUNDAY_MONTH" != "$MONTH" ]; then
  IS_LAST_SUN_OF_MONTH=1
else
  IS_LAST_SUN_OF_MONTH=0
fi

# FY-quarter month-ends: Jun (Q1), Sep (Q2), Dec (Q3), Mar (Q4)
IS_LAST_SUN_OF_QUARTER=0
QUARTER_NUM=""
if [ "$IS_LAST_SUN_OF_MONTH" = "1" ]; then
  case "$MONTH" in
    6)  IS_LAST_SUN_OF_QUARTER=1; QUARTER_NUM=1 ;;
    9)  IS_LAST_SUN_OF_QUARTER=1; QUARTER_NUM=2 ;;
    12) IS_LAST_SUN_OF_QUARTER=1; QUARTER_NUM=3 ;;
    3)  IS_LAST_SUN_OF_QUARTER=1; QUARTER_NUM=4 ;;
  esac
fi

# Half-year ends: Sep (H1) and Mar (H2)
IS_LAST_SUN_OF_HALF=0
HALF_NUM=""
if [ "$IS_LAST_SUN_OF_QUARTER" = "1" ]; then
  case "$MONTH" in
    9) IS_LAST_SUN_OF_HALF=1; HALF_NUM=1 ;;
    3) IS_LAST_SUN_OF_HALF=1; HALF_NUM=2 ;;
  esac
fi

# FY end = last Sunday of March
IS_LAST_SUN_OF_FY=0
if [ "$IS_LAST_SUN_OF_HALF" = "1" ] && [ "$MONTH" = "3" ]; then
  IS_LAST_SUN_OF_FY=1
fi

MONTH_NAME=$(date +%B | tr '[:upper:]' '[:lower:]')

# ───────────────────────────────────────────────────────────
# 2. Build the backup bundle
# ───────────────────────────────────────────────────────────
log "──────────────────────────────────────"
log "Backup starting  date=${DATE_ISO}  FY=${FY_LABEL}  lastSunMonth=${IS_LAST_SUN_OF_MONTH}  lastSunQtr=${IS_LAST_SUN_OF_QUARTER}  lastSunHalf=${IS_LAST_SUN_OF_HALF}  lastSunFY=${IS_LAST_SUN_OF_FY}"

DB_DUMP="${WORK}/db.sql.gz"
FILES_TAR="${WORK}/files.tar.gz"
META_JSON="${WORK}/metadata.json"

# DB dump
pg_dump "$DB_URL" --no-owner --no-acl --format=plain --compress=9 > "$DB_DUMP"
DB_SIZE=$(du -b "$DB_DUMP" | cut -f1)
log "DB dump: $(du -h "$DB_DUMP" | cut -f1)"

# Uploads tar
if [ -d "$UPLOAD_DIR" ]; then
  tar -czf "$FILES_TAR" -C "$(dirname "$UPLOAD_DIR")" "$(basename "$UPLOAD_DIR")"
  FILES_SIZE=$(du -b "$FILES_TAR" | cut -f1)
  FILES_COUNT=$(find "$UPLOAD_DIR" -type f 2>/dev/null | wc -l)
else
  : > "$FILES_TAR"
  FILES_SIZE=0
  FILES_COUNT=0
fi
log "Files tar: $(du -h "$FILES_TAR" | cut -f1) (${FILES_COUNT} files)"

# Row counts per table (best-effort — used by the Backups preview UI)
TABLES_JSON=$(psql "$DB_URL" -tA -F'|' -c "
  SELECT table_name FROM information_schema.tables
  WHERE table_schema='public' AND table_type='BASE TABLE'
  ORDER BY table_name;
" 2>/dev/null | while read -r tbl; do
  [ -z "$tbl" ] && continue
  cnt=$(psql "$DB_URL" -tA -c "SELECT count(*) FROM \"${tbl}\";" 2>/dev/null || echo 0)
  printf '{"name":"%s","rows":%s},' "$tbl" "$cnt"
done | sed 's/,$//')

# Tier label this run participates in (used for the preview UI)
TIER="weekly"
[ "$IS_LAST_SUN_OF_MONTH" = "1" ]   && TIER="monthly"
[ "$IS_LAST_SUN_OF_QUARTER" = "1" ] && TIER="quarterly"
[ "$IS_LAST_SUN_OF_HALF" = "1" ]    && TIER="half-yearly"
[ "$IS_LAST_SUN_OF_FY" = "1" ]      && TIER="yearly"

cat > "$META_JSON" <<EOF
{
  "date": "${DATE_ISO}",
  "fy": "${FY_LABEL}",
  "tier": "${TIER}",
  "dbBytes": ${DB_SIZE},
  "filesBytes": ${FILES_SIZE},
  "filesCount": ${FILES_COUNT},
  "tables": [${TABLES_JSON}]
}
EOF

BUNDLE="${WORK}/raps-${DATE_ISO}.tar.gz"
tar -czf "$BUNDLE" -C "$WORK" db.sql.gz files.tar.gz metadata.json
BUNDLE_SIZE=$(du -h "$BUNDLE" | cut -f1)
log "Bundle: ${BUNDLE_SIZE}"

# ───────────────────────────────────────────────────────────
# 3. Always: upload weekly (overwrites previous weekly)
# ───────────────────────────────────────────────────────────
WEEKLY_PREFIX="${S3_FY_PREFIX}/weekly/"
# Delete any existing weekly file first
aws s3 rm "s3://${S3_BUCKET}/${WEEKLY_PREFIX}" --recursive --region "$REGION" --only-show-errors 2>/dev/null || true
WEEKLY_KEY="${WEEKLY_PREFIX}${DATE_ISO}.tar.gz"
aws s3 cp "$BUNDLE" "s3://${S3_BUCKET}/${WEEKLY_KEY}" --region "$REGION" --only-show-errors
log "Uploaded weekly  → s3://${S3_BUCKET}/${WEEKLY_KEY}"

# ───────────────────────────────────────────────────────────
# 4. If last Sunday of month → promote to monthly, clear weekly
# ───────────────────────────────────────────────────────────
if [ "$IS_LAST_SUN_OF_MONTH" = "1" ]; then
  MONTHLY_KEY="${S3_FY_PREFIX}/monthly/${YEAR}-${MONTH_NAME}.tar.gz"
  aws s3 cp "s3://${S3_BUCKET}/${WEEKLY_KEY}" "s3://${S3_BUCKET}/${MONTHLY_KEY}" --region "$REGION" --only-show-errors
  aws s3 rm "s3://${S3_BUCKET}/${WEEKLY_PREFIX}" --recursive --region "$REGION" --only-show-errors 2>/dev/null || true
  log "Promoted monthly → s3://${S3_BUCKET}/${MONTHLY_KEY} (weekly cleared)"
fi

# ───────────────────────────────────────────────────────────
# 5. If last Sunday of FY-quarter → promote to quarterly, delete the 3 monthlies
# ───────────────────────────────────────────────────────────
if [ "$IS_LAST_SUN_OF_QUARTER" = "1" ]; then
  QUARTERLY_KEY="${S3_FY_PREFIX}/quarterly/${YEAR}-Q${QUARTER_NUM}.tar.gz"
  MONTHLY_KEY="${S3_FY_PREFIX}/monthly/${YEAR}-${MONTH_NAME}.tar.gz"
  aws s3 cp "s3://${S3_BUCKET}/${MONTHLY_KEY}" "s3://${S3_BUCKET}/${QUARTERLY_KEY}" --region "$REGION" --only-show-errors
  aws s3 rm "s3://${S3_BUCKET}/${S3_FY_PREFIX}/monthly/" --recursive --region "$REGION" --only-show-errors 2>/dev/null || true
  log "Promoted quarterly → s3://${S3_BUCKET}/${QUARTERLY_KEY} (monthlies cleared)"
fi

# ───────────────────────────────────────────────────────────
# 6. If last Sunday of half (Sep/Mar) → promote to half-yearly, delete the 2 quarterlies
# ───────────────────────────────────────────────────────────
if [ "$IS_LAST_SUN_OF_HALF" = "1" ]; then
  HALF_KEY="${S3_FY_PREFIX}/half-yearly/${YEAR}-H${HALF_NUM}.tar.gz"
  QUARTERLY_KEY="${S3_FY_PREFIX}/quarterly/${YEAR}-Q${QUARTER_NUM}.tar.gz"
  aws s3 cp "s3://${S3_BUCKET}/${QUARTERLY_KEY}" "s3://${S3_BUCKET}/${HALF_KEY}" --region "$REGION" --only-show-errors
  aws s3 rm "s3://${S3_BUCKET}/${S3_FY_PREFIX}/quarterly/" --recursive --region "$REGION" --only-show-errors 2>/dev/null || true
  log "Promoted half-yearly → s3://${S3_BUCKET}/${HALF_KEY} (quarterlies cleared)"
fi

# ───────────────────────────────────────────────────────────
# 7. If last Sunday of FY (March) → promote to yearly, delete the 2 half-yearlies
# ───────────────────────────────────────────────────────────
if [ "$IS_LAST_SUN_OF_FY" = "1" ]; then
  YEARLY_KEY="${S3_FY_PREFIX}/yearly/${FY_LABEL}.tar.gz"
  HALF_KEY="${S3_FY_PREFIX}/half-yearly/${YEAR}-H${HALF_NUM}.tar.gz"
  aws s3 cp "s3://${S3_BUCKET}/${HALF_KEY}" "s3://${S3_BUCKET}/${YEARLY_KEY}" --region "$REGION" --only-show-errors
  aws s3 rm "s3://${S3_BUCKET}/${S3_FY_PREFIX}/half-yearly/" --recursive --region "$REGION" --only-show-errors 2>/dev/null || true
  log "Promoted yearly → s3://${S3_BUCKET}/${YEARLY_KEY} (half-yearlies cleared)"
fi

# ───────────────────────────────────────────────────────────
# 8. Master snapshot — suppliers + products + users, JSON, kept forever
# ───────────────────────────────────────────────────────────
MASTER_JSON="${WORK}/master.json"
psql "$DB_URL" -tA <<SQL > "$MASTER_JSON" 2>/dev/null || echo '{}' > "$MASTER_JSON"
SELECT json_build_object(
  'date',     '${DATE_ISO}',
  'fy',       '${FY_LABEL}',
  'suppliers',(SELECT coalesce(json_agg(s), '[]'::json) FROM (SELECT * FROM "Supplier") s),
  'products', (SELECT coalesce(json_agg(p), '[]'::json) FROM (SELECT * FROM "Product") p),
  'users',    (SELECT coalesce(json_agg(u), '[]'::json) FROM (SELECT id, username, name, role, "unitId", "isActive", "createdAt" FROM "User") u)
);
SQL

MASTER_KEY="${S3_FY_PREFIX}/master/${DATE_ISO}-master.json"
aws s3 cp "$MASTER_JSON" "s3://${S3_BUCKET}/${MASTER_KEY}" --region "$REGION" --only-show-errors
log "Master snapshot → s3://${S3_BUCKET}/${MASTER_KEY}"

# ───────────────────────────────────────────────────────────
# Cleanup
# ───────────────────────────────────────────────────────────
rm -rf "$WORK"
log "Backup complete"
