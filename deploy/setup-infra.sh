#!/usr/bin/env bash
# RAPS-ERP — Create all AWS infrastructure from your local machine.
#
# Prerequisites:
#   aws configure   (region: ap-south-1, output: json)
#
# Required env vars:
#   export RAPS_DB_PASSWORD="YourStrongPassword"
#
# Optional env vars:
#   export RAPS_MY_IP="203.0.113.5/32"    # restrict SSH (default: open)
#   export RAPS_KEY_NAME="raps-key"       # SSH key name (default: raps-key)
#
# Usage:
#   bash deploy/setup-infra.sh

set -euo pipefail

REGION="ap-south-1"
DB_PASSWORD="${RAPS_DB_PASSWORD:?Export RAPS_DB_PASSWORD first}"
KEY_NAME="${RAPS_KEY_NAME:-raps-key}"
MY_IP="${RAPS_MY_IP:-0.0.0.0/0}"

DB_ID="raps-prod"
DB_NAME="raps"
DB_USER="rapsadmin"
DB_CLASS="db.t4g.micro"
EC2_TYPE="t3.small"
EC2_NAME="raps-app"
EC2_SG="raps-app-sg"
RDS_SG="raps-db-sg"
S3_BUCKET="raps-backups-$(aws sts get-caller-identity --query Account --output text)"
IAM_ROLE="raps-ec2-role"

echo "================================================"
echo "  RAPS-ERP — AWS Infrastructure Setup"
echo "  Region: ${REGION}"
echo "================================================"

# ── 1. Default VPC ──────────────────────────────────
echo ""
echo "[1/8] Finding default VPC..."
VPC_ID=$(aws ec2 describe-vpcs --region "$REGION" \
  --filters "Name=isDefault,Values=true" \
  --query "Vpcs[0].VpcId" --output text)

if [ "$VPC_ID" = "None" ] || [ -z "$VPC_ID" ]; then
  echo "  ERROR: No default VPC in ${REGION}. Create one first."
  exit 1
fi
echo "  VPC: ${VPC_ID}"

# ── 2. Security Groups ─────────────────────────────
echo ""
echo "[2/8] Creating security groups..."

create_sg() {
  local name="$1" desc="$2"
  local sg_id
  sg_id=$(aws ec2 describe-security-groups --region "$REGION" \
    --filters "Name=group-name,Values=${name}" "Name=vpc-id,Values=${VPC_ID}" \
    --query "SecurityGroups[0].GroupId" --output text 2>/dev/null || echo "None")
  if [ "$sg_id" = "None" ] || [ -z "$sg_id" ]; then
    sg_id=$(aws ec2 create-security-group --region "$REGION" \
      --group-name "$name" --description "$desc" --vpc-id "$VPC_ID" \
      --query "GroupId" --output text)
    echo "  Created: ${name} (${sg_id})"
  else
    echo "  Exists:  ${name} (${sg_id})"
  fi
  echo "$sg_id"
}

EC2_SG_ID=$(create_sg "$EC2_SG" "RAPS - app server" | tail -1)
RDS_SG_ID=$(create_sg "$RDS_SG" "RAPS - database" | tail -1)

# EC2 inbound: SSH + HTTP + HTTPS
aws ec2 authorize-security-group-ingress --region "$REGION" --group-id "$EC2_SG_ID" \
  --ip-permissions \
  "IpProtocol=tcp,FromPort=22,ToPort=22,IpRanges=[{CidrIp=${MY_IP},Description=SSH}]" \
  "IpProtocol=tcp,FromPort=80,ToPort=80,IpRanges=[{CidrIp=0.0.0.0/0,Description=HTTP}]" \
  "IpProtocol=tcp,FromPort=443,ToPort=443,IpRanges=[{CidrIp=0.0.0.0/0,Description=HTTPS}]" \
  2>/dev/null || true

# RDS inbound: PostgreSQL from EC2 only
aws ec2 authorize-security-group-ingress --region "$REGION" --group-id "$RDS_SG_ID" \
  --ip-permissions \
  "IpProtocol=tcp,FromPort=5432,ToPort=5432,UserIdGroupPairs=[{GroupId=${EC2_SG_ID},Description=EC2-to-RDS}]" \
  2>/dev/null || true

# ── 3. SSH Key Pair ─────────────────────────────────
echo ""
echo "[3/8] Setting up SSH key..."
if aws ec2 describe-key-pairs --region "$REGION" --key-names "$KEY_NAME" > /dev/null 2>&1; then
  echo "  Exists: ${KEY_NAME}"
else
  aws ec2 create-key-pair --region "$REGION" --key-name "$KEY_NAME" \
    --query "KeyMaterial" --output text > "${KEY_NAME}.pem"
  chmod 400 "${KEY_NAME}.pem"
  echo "  Created: ${KEY_NAME}.pem — SAVE THIS FILE, cannot be re-downloaded"
fi

# ── 4. RDS PostgreSQL ──────────────────────────────
echo ""
echo "[4/8] Creating RDS instance (takes 5-10 min)..."
if aws rds describe-db-instances --region "$REGION" --db-instance-identifier "$DB_ID" > /dev/null 2>&1; then
  echo "  Exists: ${DB_ID}"
else
  aws rds create-db-instance --region "$REGION" \
    --db-instance-identifier "$DB_ID" \
    --db-instance-class "$DB_CLASS" \
    --engine postgres --engine-version "16" \
    --master-username "$DB_USER" \
    --master-user-password "$DB_PASSWORD" \
    --allocated-storage 20 --storage-type gp3 \
    --db-name "$DB_NAME" \
    --vpc-security-group-ids "$RDS_SG_ID" \
    --backup-retention-period 7 \
    --no-multi-az --no-publicly-accessible --storage-encrypted \
    --tags Key=Project,Value=RAPS > /dev/null

  echo "  Waiting for RDS..."
  aws rds wait db-instance-available --region "$REGION" --db-instance-identifier "$DB_ID"
  echo "  RDS ready."
fi

RDS_ENDPOINT=$(aws rds describe-db-instances --region "$REGION" \
  --db-instance-identifier "$DB_ID" \
  --query "DBInstances[0].Endpoint.Address" --output text)
echo "  Endpoint: ${RDS_ENDPOINT}"

# ── 5. S3 Backup Bucket ────────────────────────────
echo ""
echo "[5/8] Creating S3 backup bucket..."
if aws s3api head-bucket --bucket "$S3_BUCKET" --region "$REGION" 2>/dev/null; then
  echo "  Exists: ${S3_BUCKET}"
else
  aws s3api create-bucket --bucket "$S3_BUCKET" --region "$REGION" \
    --create-bucket-configuration LocationConstraint="$REGION" > /dev/null

  aws s3api put-public-access-block --bucket "$S3_BUCKET" \
    --public-access-block-configuration \
    "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"

  aws s3api put-bucket-lifecycle-configuration --bucket "$S3_BUCKET" \
    --lifecycle-configuration '{
      "Rules": [{
        "ID": "BackupRetention",
        "Filter": {"Prefix": "backups/"},
        "Status": "Enabled",
        "Transitions": [
          {"Days": 90, "StorageClass": "GLACIER_IR"},
          {"Days": 365, "StorageClass": "DEEP_ARCHIVE"}
        ]
      }, {
        "ID": "CleanupOldVersions",
        "Filter": {"Prefix": ""},
        "Status": "Enabled",
        "NoncurrentVersionExpiration": {"NoncurrentDays": 30}
      }]
    }'

  echo "  Created: ${S3_BUCKET}"
fi

# ── 6. IAM Role ────────────────────────────────────
echo ""
echo "[6/8] Creating IAM role..."
if aws iam get-role --role-name "$IAM_ROLE" > /dev/null 2>&1; then
  echo "  Exists: ${IAM_ROLE}"
else
  aws iam create-role --role-name "$IAM_ROLE" \
    --assume-role-policy-document '{
      "Version": "2012-10-17",
      "Statement": [{
        "Effect": "Allow",
        "Principal": {"Service": "ec2.amazonaws.com"},
        "Action": "sts:AssumeRole"
      }]
    }' > /dev/null

  POLICY=$(cat deploy/iam-policy.json | sed "s|BUCKET_NAME|${S3_BUCKET}|g")
  aws iam put-role-policy --role-name "$IAM_ROLE" \
    --policy-name "raps-backup-access" --policy-document "$POLICY"

  echo "  Created: ${IAM_ROLE}"
fi

PROFILE_NAME="raps-ec2-profile"
if aws iam get-instance-profile --instance-profile-name "$PROFILE_NAME" > /dev/null 2>&1; then
  echo "  Instance profile exists."
else
  aws iam create-instance-profile --instance-profile-name "$PROFILE_NAME" > /dev/null
  aws iam add-role-to-instance-profile --instance-profile-name "$PROFILE_NAME" --role-name "$IAM_ROLE"
  echo "  Instance profile created. Waiting for propagation..."
  sleep 10
fi

# ── 7. EC2 Instance ────────────────────────────────
echo ""
echo "[7/8] Launching EC2 instance..."
EXISTING_EC2=$(aws ec2 describe-instances --region "$REGION" \
  --filters "Name=tag:Name,Values=${EC2_NAME}" "Name=instance-state-name,Values=running,stopped" \
  --query "Reservations[0].Instances[0].InstanceId" --output text 2>/dev/null || echo "None")

if [ "$EXISTING_EC2" != "None" ] && [ -n "$EXISTING_EC2" ]; then
  EC2_ID="$EXISTING_EC2"
  echo "  Exists: ${EC2_ID}"
else
  AMI_ID=$(aws ec2 describe-images --region "$REGION" --owners 099720109477 \
    --filters "Name=name,Values=ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-*" \
              "Name=state,Values=available" \
    --query "sort_by(Images, &CreationDate)[-1].ImageId" --output text)

  EC2_ID=$(aws ec2 run-instances --region "$REGION" \
    --image-id "$AMI_ID" \
    --instance-type "$EC2_TYPE" \
    --key-name "$KEY_NAME" \
    --security-group-ids "$EC2_SG_ID" \
    --iam-instance-profile Name="$PROFILE_NAME" \
    --block-device-mappings "[{\"DeviceName\":\"/dev/sda1\",\"Ebs\":{\"VolumeSize\":20,\"VolumeType\":\"gp3\"}}]" \
    --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=${EC2_NAME}},{Key=Project,Value=RAPS}]" \
    --query "Instances[0].InstanceId" --output text)

  echo "  Launched: ${EC2_ID}"
  aws ec2 wait instance-running --region "$REGION" --instance-ids "$EC2_ID"
  echo "  Running."
fi

# ── 8. Elastic IP ──────────────────────────────────
echo ""
echo "[8/8] Assigning Elastic IP..."
EXISTING_EIP=$(aws ec2 describe-addresses --region "$REGION" \
  --filters "Name=instance-id,Values=${EC2_ID}" \
  --query "Addresses[0].PublicIp" --output text 2>/dev/null || echo "None")

if [ "$EXISTING_EIP" != "None" ] && [ -n "$EXISTING_EIP" ]; then
  ELASTIC_IP="$EXISTING_EIP"
  echo "  Exists: ${ELASTIC_IP}"
else
  ALLOC_ID=$(aws ec2 allocate-address --region "$REGION" --domain vpc \
    --query "AllocationId" --output text)
  aws ec2 associate-address --region "$REGION" --instance-id "$EC2_ID" --allocation-id "$ALLOC_ID" > /dev/null
  ELASTIC_IP=$(aws ec2 describe-addresses --region "$REGION" --allocation-ids "$ALLOC_ID" \
    --query "Addresses[0].PublicIp" --output text)
  echo "  Allocated: ${ELASTIC_IP}"
fi

# ── Summary ─────────────────────────────────────────
echo ""
echo "================================================"
echo "  Infrastructure ready!"
echo "================================================"
echo ""
echo "  EC2:          ${EC2_ID} (${EC2_TYPE})"
echo "  Elastic IP:   ${ELASTIC_IP}"
echo "  RDS:          ${RDS_ENDPOINT}"
echo "  S3 Bucket:    ${S3_BUCKET}"
echo "  DB Name:      ${DB_NAME}"
echo "  DB User:      ${DB_USER}"
echo ""
echo "  Next step — SSH in and run the bootstrap:"
echo ""
echo "    ssh -i ${KEY_NAME}.pem ubuntu@${ELASTIC_IP}"
echo "    bash bootstrap.sh ${RDS_ENDPOINT} \"${DB_PASSWORD}\""
echo ""
echo "================================================"
