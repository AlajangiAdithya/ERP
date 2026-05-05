#!/usr/bin/env bash
# RAPS-ERP — Full AWS infrastructure setup (minimal tier)
# Creates: Security Groups, RDS, S3 bucket + lifecycle, IAM role, EC2, Elastic IP
#
# Prerequisites:
#   - AWS CLI v2 configured: `aws configure` (region: ap-south-1)
#   - Set env vars before running:
#       export RAPS_DB_PASSWORD="YourStrongPassword"
#       export RAPS_SSH_KEY_NAME="raps-key"       (optional, default: raps-key)
#       export RAPS_MY_IP="203.0.113.5/32"         (your IP for SSH, or 0.0.0.0/0)
#
# Usage: bash deploy/setup-infra.sh

set -euo pipefail

# ─── Configuration ───────────────────────────────────────────────────────────
REGION="ap-south-1"
PROJECT="raps"
DB_PASSWORD="${RAPS_DB_PASSWORD:?Export RAPS_DB_PASSWORD before running}"
SSH_KEY_NAME="${RAPS_SSH_KEY_NAME:-raps-key}"
MY_IP="${RAPS_MY_IP:-0.0.0.0/0}"

DB_INSTANCE_ID="${PROJECT}-prod"
DB_NAME="raps"
DB_USER="rapsadmin"
DB_INSTANCE_CLASS="db.t3.micro"
DB_STORAGE=20

EC2_INSTANCE_TYPE="t3.micro"
EC2_VOLUME_SIZE=20
EC2_NAME="${PROJECT}-app"

S3_BUCKET="${PROJECT}-erp-backups-$(aws sts get-caller-identity --query Account --output text)"

EC2_SG_NAME="${PROJECT}-app-sg"
RDS_SG_NAME="${PROJECT}-rds-sg"

echo "============================================="
echo "  RAPS-ERP Infrastructure Setup"
echo "  Region: ${REGION}"
echo "============================================="
echo ""

# ─── Step 1: Get default VPC ─────────────────────────────────────────────────
echo "[1/9] Getting default VPC..."
VPC_ID=$(aws ec2 describe-vpcs --region "$REGION" \
  --filters "Name=isDefault,Values=true" \
  --query "Vpcs[0].VpcId" --output text)

if [ "$VPC_ID" = "None" ] || [ -z "$VPC_ID" ]; then
  echo "ERROR: No default VPC found in ${REGION}. Create one first."
  exit 1
fi
echo "       VPC: ${VPC_ID}"

# ─── Step 2: Create EC2 Security Group ───────────────────────────────────────
echo "[2/9] Creating EC2 security group..."
EC2_SG_ID=$(aws ec2 describe-security-groups --region "$REGION" \
  --filters "Name=group-name,Values=${EC2_SG_NAME}" "Name=vpc-id,Values=${VPC_ID}" \
  --query "SecurityGroups[0].GroupId" --output text 2>/dev/null || echo "None")

if [ "$EC2_SG_ID" = "None" ] || [ -z "$EC2_SG_ID" ]; then
  EC2_SG_ID=$(aws ec2 create-security-group --region "$REGION" \
    --group-name "$EC2_SG_NAME" \
    --description "RAPS ERP - EC2 app server" \
    --vpc-id "$VPC_ID" \
    --query "GroupId" --output text)

  aws ec2 authorize-security-group-ingress --region "$REGION" --group-id "$EC2_SG_ID" \
    --ip-permissions \
    "IpProtocol=tcp,FromPort=22,ToPort=22,IpRanges=[{CidrIp=${MY_IP},Description=SSH}]" \
    "IpProtocol=tcp,FromPort=80,ToPort=80,IpRanges=[{CidrIp=0.0.0.0/0,Description=HTTP}]" \
    "IpProtocol=tcp,FromPort=443,ToPort=443,IpRanges=[{CidrIp=0.0.0.0/0,Description=HTTPS}]"
  echo "       Created: ${EC2_SG_ID}"
else
  echo "       Exists: ${EC2_SG_ID}"
fi

# ─── Step 3: Create RDS Security Group ───────────────────────────────────────
echo "[3/9] Creating RDS security group..."
RDS_SG_ID=$(aws ec2 describe-security-groups --region "$REGION" \
  --filters "Name=group-name,Values=${RDS_SG_NAME}" "Name=vpc-id,Values=${VPC_ID}" \
  --query "SecurityGroups[0].GroupId" --output text 2>/dev/null || echo "None")

if [ "$RDS_SG_ID" = "None" ] || [ -z "$RDS_SG_ID" ]; then
  RDS_SG_ID=$(aws ec2 create-security-group --region "$REGION" \
    --group-name "$RDS_SG_NAME" \
    --description "RAPS ERP - RDS PostgreSQL" \
    --vpc-id "$VPC_ID" \
    --query "GroupId" --output text)

  aws ec2 authorize-security-group-ingress --region "$REGION" --group-id "$RDS_SG_ID" \
    --ip-permissions \
    "IpProtocol=tcp,FromPort=5432,ToPort=5432,UserIdGroupPairs=[{GroupId=${EC2_SG_ID},Description=EC2-to-RDS}]"
  echo "       Created: ${RDS_SG_ID}"
else
  echo "       Exists: ${RDS_SG_ID}"
fi

# ─── Step 4: Create RDS Instance ────────────────────────────────────────────
echo "[4/9] Creating RDS PostgreSQL instance (takes ~5-10 min)..."
RDS_EXISTS=$(aws rds describe-db-instances --region "$REGION" \
  --db-instance-identifier "$DB_INSTANCE_ID" \
  --query "DBInstances[0].DBInstanceIdentifier" --output text 2>/dev/null || echo "None")

if [ "$RDS_EXISTS" = "None" ]; then
  aws rds create-db-instance --region "$REGION" \
    --db-instance-identifier "$DB_INSTANCE_ID" \
    --db-instance-class "$DB_INSTANCE_CLASS" \
    --engine postgres \
    --engine-version "16" \
    --master-username "$DB_USER" \
    --master-user-password "$DB_PASSWORD" \
    --allocated-storage "$DB_STORAGE" \
    --storage-type gp3 \
    --db-name "$DB_NAME" \
    --vpc-security-group-ids "$RDS_SG_ID" \
    --backup-retention-period 7 \
    --no-multi-az \
    --no-publicly-accessible \
    --storage-encrypted \
    --tags Key=Project,Value=RAPS > /dev/null

  echo "       Waiting for RDS to become available..."
  aws rds wait db-instance-available --region "$REGION" \
    --db-instance-identifier "$DB_INSTANCE_ID"
  echo "       RDS is ready."
else
  echo "       Exists: ${DB_INSTANCE_ID}"
fi

RDS_ENDPOINT=$(aws rds describe-db-instances --region "$REGION" \
  --db-instance-identifier "$DB_INSTANCE_ID" \
  --query "DBInstances[0].Endpoint.Address" --output text)
echo "       Endpoint: ${RDS_ENDPOINT}"

# ─── Step 5: Create S3 Bucket + Lifecycle ────────────────────────────────────
echo "[5/9] Creating S3 backup bucket..."
if aws s3api head-bucket --bucket "$S3_BUCKET" --region "$REGION" 2>/dev/null; then
  echo "       Exists: ${S3_BUCKET}"
else
  aws s3api create-bucket --bucket "$S3_BUCKET" --region "$REGION" \
    --create-bucket-configuration LocationConstraint="$REGION" > /dev/null

  aws s3api put-bucket-versioning --bucket "$S3_BUCKET" \
    --versioning-configuration Status=Enabled

  aws s3api put-bucket-lifecycle-configuration --bucket "$S3_BUCKET" \
    --lifecycle-configuration file://deploy/s3-lifecycle.json

  aws s3api put-public-access-block --bucket "$S3_BUCKET" \
    --public-access-block-configuration \
    "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"

  echo "       Created: ${S3_BUCKET} (with lifecycle rules)"
fi

# ─── Step 6: Create IAM Role for EC2 ────────────────────────────────────────
echo "[6/9] Creating IAM role..."
ROLE_NAME="${PROJECT}-app-role"

if aws iam get-role --role-name "$ROLE_NAME" > /dev/null 2>&1; then
  echo "       Exists: ${ROLE_NAME}"
else
  aws iam create-role --role-name "$ROLE_NAME" \
    --assume-role-policy-document '{
      "Version": "2012-10-17",
      "Statement": [{
        "Effect": "Allow",
        "Principal": {"Service": "ec2.amazonaws.com"},
        "Action": "sts:AssumeRole"
      }]
    }' > /dev/null

  ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

  aws iam put-role-policy --role-name "$ROLE_NAME" \
    --policy-name "${PROJECT}-backup-policy" \
    --policy-document "$(cat deploy/iam-backup-policy.json | sed "s/ACCOUNT_ID/${ACCOUNT_ID}/g" | sed "s/DB_INSTANCE_ID/${DB_INSTANCE_ID}/g" | sed "s/S3_BUCKET/${S3_BUCKET}/g")"

  echo "       Created: ${ROLE_NAME}"
fi

PROFILE_NAME="${PROJECT}-app-profile"
if aws iam get-instance-profile --instance-profile-name "$PROFILE_NAME" > /dev/null 2>&1; then
  echo "       Instance profile exists."
else
  aws iam create-instance-profile --instance-profile-name "$PROFILE_NAME" > /dev/null
  aws iam add-role-to-instance-profile --instance-profile-name "$PROFILE_NAME" \
    --role-name "$ROLE_NAME"
  echo "       Instance profile created. Waiting 10s for propagation..."
  sleep 10
fi

# ─── Step 7: Create Key Pair ────────────────────────────────────────────────
echo "[7/9] Setting up SSH key pair..."
if aws ec2 describe-key-pairs --region "$REGION" --key-names "$SSH_KEY_NAME" > /dev/null 2>&1; then
  echo "       Key pair exists: ${SSH_KEY_NAME}"
else
  aws ec2 create-key-pair --region "$REGION" \
    --key-name "$SSH_KEY_NAME" \
    --query "KeyMaterial" --output text > "${SSH_KEY_NAME}.pem"
  chmod 400 "${SSH_KEY_NAME}.pem"
  echo "       Created: ${SSH_KEY_NAME}.pem (SAVE THIS FILE — cannot be re-downloaded)"
fi

# ─── Step 8: Launch EC2 Instance ─────────────────────────────────────────────
echo "[8/9] Launching EC2 instance..."
EXISTING_EC2=$(aws ec2 describe-instances --region "$REGION" \
  --filters "Name=tag:Name,Values=${EC2_NAME}" "Name=instance-state-name,Values=running,stopped" \
  --query "Reservations[0].Instances[0].InstanceId" --output text 2>/dev/null || echo "None")

if [ "$EXISTING_EC2" != "None" ] && [ -n "$EXISTING_EC2" ]; then
  EC2_ID="$EXISTING_EC2"
  echo "       Exists: ${EC2_ID}"
else
  AMI_ID=$(aws ec2 describe-images --region "$REGION" \
    --owners 099720109477 \
    --filters "Name=name,Values=ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-*" \
              "Name=state,Values=available" \
    --query "sort_by(Images, &CreationDate)[-1].ImageId" --output text)

  EC2_ID=$(aws ec2 run-instances --region "$REGION" \
    --image-id "$AMI_ID" \
    --instance-type "$EC2_INSTANCE_TYPE" \
    --key-name "$SSH_KEY_NAME" \
    --security-group-ids "$EC2_SG_ID" \
    --iam-instance-profile Name="$PROFILE_NAME" \
    --block-device-mappings "[{\"DeviceName\":\"/dev/sda1\",\"Ebs\":{\"VolumeSize\":${EC2_VOLUME_SIZE},\"VolumeType\":\"gp3\"}}]" \
    --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=${EC2_NAME}},{Key=Project,Value=RAPS}]" \
    --query "Instances[0].InstanceId" --output text)

  echo "       Launched: ${EC2_ID}, waiting for running state..."
  aws ec2 wait instance-running --region "$REGION" --instance-ids "$EC2_ID"
  echo "       Instance is running."
fi

# ─── Step 9: Allocate Elastic IP ─────────────────────────────────────────────
echo "[9/9] Allocating Elastic IP..."
ASSOC_CHECK=$(aws ec2 describe-addresses --region "$REGION" \
  --filters "Name=instance-id,Values=${EC2_ID}" \
  --query "Addresses[0].PublicIp" --output text 2>/dev/null || echo "None")

if [ "$ASSOC_CHECK" != "None" ] && [ -n "$ASSOC_CHECK" ]; then
  ELASTIC_IP="$ASSOC_CHECK"
  echo "       Already associated: ${ELASTIC_IP}"
else
  ALLOC_ID=$(aws ec2 allocate-address --region "$REGION" --domain vpc \
    --query "AllocationId" --output text)
  aws ec2 associate-address --region "$REGION" \
    --instance-id "$EC2_ID" --allocation-id "$ALLOC_ID" > /dev/null
  ELASTIC_IP=$(aws ec2 describe-addresses --region "$REGION" \
    --allocation-ids "$ALLOC_ID" \
    --query "Addresses[0].PublicIp" --output text)
  echo "       Allocated: ${ELASTIC_IP}"
fi

# ─── Done ────────────────────────────────────────────────────────────────────
echo ""
echo "============================================="
echo "  Infrastructure ready!"
echo "============================================="
echo ""
echo "  EC2 Instance:   ${EC2_ID}"
echo "  Elastic IP:     ${ELASTIC_IP}"
echo "  RDS Endpoint:   ${RDS_ENDPOINT}"
echo "  RDS Database:   ${DB_NAME}"
echo "  RDS User:       ${DB_USER}"
echo "  S3 Bucket:      ${S3_BUCKET}"
echo ""
echo "  Next step — SSH into EC2 and run the bootstrap:"
echo ""
echo "    ssh -i ${SSH_KEY_NAME}.pem ubuntu@${ELASTIC_IP}"
echo "    curl -sO https://raw.githubusercontent.com/AlajangiAdithya/RAPS-ERP/main/deploy/ec2-setup.sh"
echo "    bash ec2-setup.sh ${RDS_ENDPOINT} ${DB_PASSWORD}"
echo ""
echo "============================================="
