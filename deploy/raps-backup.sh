#!/usr/bin/env bash
# Half-yearly RDS snapshot for RAPS.
# Cron-driven (see raps-backup-cron). Names snapshots predictably so you can find them.
#
# Schedule:
#   - Apr 1 00:30 IST  -> snapshot named  raps-YYYY-h1-mar-sep   (covers Mar..Sep)
#   - Oct 1 00:30 IST  -> snapshot named  raps-YYYY-h2-oct-feb   (covers Oct..next Feb)
#
# Requires:
#   - aws cli installed on EC2
#   - EC2 instance role has rds:CreateDBSnapshot, DescribeDBSnapshots, ListTagsForResource
#   - jq (for nicer logging)

set -euo pipefail

DB_INSTANCE_ID="${DB_INSTANCE_ID:-raps-rds-sg}"   # override via env
AWS_REGION="${AWS_REGION:-ap-south-1}"
HALF="${1:-}"                                      # h1 or h2 (passed by cron)
LOGFILE="/var/log/raps-backup.log"

if [[ -z "$HALF" || ( "$HALF" != "h1" && "$HALF" != "h2" ) ]]; then
  echo "Usage: $0 <h1|h2>" >&2
  exit 1
fi

YEAR=$(date +%Y)
if [[ "$HALF" == "h1" ]]; then
  LABEL="h1-mar-sep"
else
  LABEL="h2-oct-feb"
fi

SNAP_ID="raps-${YEAR}-${LABEL}"

{
  echo "================================================================"
  echo "$(date -Is) - starting RDS snapshot ${SNAP_ID} on ${DB_INSTANCE_ID}"

  aws rds create-db-snapshot \
    --region "${AWS_REGION}" \
    --db-snapshot-identifier "${SNAP_ID}" \
    --db-instance-identifier "${DB_INSTANCE_ID}" \
    --tags Key=Project,Value=RAPS Key=Half,Value="${LABEL}" Key=Year,Value="${YEAR}" Key=Type,Value=half-yearly

  echo "$(date -Is) - snapshot create requested. Waiting for it to become available..."
  aws rds wait db-snapshot-available \
    --region "${AWS_REGION}" \
    --db-snapshot-identifier "${SNAP_ID}"

  echo "$(date -Is) - snapshot ${SNAP_ID} is available."

  echo "Current half-yearly snapshots:"
  aws rds describe-db-snapshots \
    --region "${AWS_REGION}" \
    --db-instance-identifier "${DB_INSTANCE_ID}" \
    --snapshot-type manual \
    --query "DBSnapshots[?starts_with(DBSnapshotIdentifier,'raps-')].[DBSnapshotIdentifier,SnapshotCreateTime,AllocatedStorage]" \
    --output table
} >> "$LOGFILE" 2>&1
