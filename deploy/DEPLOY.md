# RAPS ERP — AWS Deployment Guide

Deploy target: single EC2 (`t3.micro`, Ubuntu 22.04 LTS, ap-south-1) + RDS PostgreSQL (`db.t4g.micro`, Multi-AZ off, ap-south-1) + Route 53 + Let's Encrypt.

Estimated monthly cost: ~$22–25.

---

## Phase 1 — Provision RDS PostgreSQL

1. AWS Console → RDS → Create database
   - Engine: PostgreSQL 15 (or 16)
   - Templates: Production (or Free tier if eligible)
   - DB instance identifier: `raps-prod`
   - Master username: `rapsadmin`
   - Master password: strong, save it
   - Instance class: `db.t4g.micro`
   - Storage: 20 GB gp3, autoscaling up to 100 GB
   - Multi-AZ: No (single-AZ for cost)
   - VPC: default
   - Public access: **No**
   - VPC security group: create new `raps-rds-sg`
   - Initial database name: `raps`
   - Backup retention: 7 days
   - Encryption: enabled (default KMS key)
2. Wait until status = Available, copy the endpoint (e.g. `raps-prod.xxx.ap-south-1.rds.amazonaws.com`).

## Phase 2 — Provision EC2

1. EC2 → Launch instance
   - Name: `raps-app`
   - AMI: Ubuntu Server 22.04 LTS (arm64)
   - Type: `t3.micro`
   - Key pair: create + download `.pem`
   - Network: same VPC as RDS
   - Security group: create `raps-app-sg`
     - Inbound: 22 (your IP), 80 (0.0.0.0/0), 443 (0.0.0.0/0)
   - Storage: 20 GB gp3
2. Allocate Elastic IP → associate to the instance.
3. Edit `raps-rds-sg` inbound rules: allow PostgreSQL/5432 from `raps-app-sg` (source = security group, not CIDR).

## Phase 3 — Server bootstrap

```bash
ssh -i raps.pem ubuntu@<elastic-ip>

sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git nginx postgresql-client jq unzip

# Node.js 20 (use NodeSource)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# PM2
sudo npm install -g pm2

# AWS CLI v2 (arm64)
curl "https://awscli.amazonaws.com/awscli-exe-linux-aarch64.zip" -o awscliv2.zip
unzip awscliv2.zip
sudo ./aws/install
rm -rf aws awscliv2.zip
```

## Phase 4 — Migrate data from Supabase to RDS

From your local machine **or** EC2 (EC2 is faster):

```bash
# Use pooler hostname (IPv4) + session port 5432 + user = postgres.<projectref>
pg_dump "postgresql://postgres.dhnpmtzttmsqfjenxlpa:Alajangi%4006@aws-0-ap-south-1.pooler.supabase.com:5432/postgres" \
  --no-owner --no-acl -F c -f raps-supabase.dump
```

Copy dump to EC2 if you ran it locally:

```bash
scp -i raps.pem raps-supabase.dump ubuntu@<elastic-ip>:~/
```

Restore into RDS (run from EC2 — RDS has no public access):

```bash
pg_restore --no-owner --no-acl -d \
  "postgresql://rapsadmin:<RDS_PWD>@<RDS_ENDPOINT>:5432/raps" \
  raps-supabase.dump
```

Verify:

```bash
psql "postgresql://rapsadmin:<RDS_PWD>@<RDS_ENDPOINT>:5432/raps" \
  -c "SELECT COUNT(*) FROM \"Product\";"
# Expect ~2661
```

## Phase 5 — Deploy app code

```bash
sudo mkdir -p /var/www
sudo chown ubuntu:ubuntu /var/www
cd /var/www
git clone https://github.com/AlajangiAdithya/RAPS-ERP.git raps
cd raps

# Backend
cd server
cp .env.example .env
nano .env   # set DATABASE_URL/DIRECT_URL to RDS, set strong JWT secrets, CLIENT_URL
npm ci
npx prisma generate
npx prisma migrate deploy   # idempotent — applies any new migrations only

# Frontend
cd ../client
cp .env.production.example .env.production
nano .env.production        # set VITE_API_URL=https://erp.yourdomain.com
npm ci
npm run build               # outputs to client/dist
```

## Phase 6 — Start backend with PM2

```bash
sudo mkdir -p /var/log/pm2
sudo chown ubuntu:ubuntu /var/log/pm2
cd /var/www/raps
pm2 start deploy/ecosystem.config.js
pm2 save
pm2 startup        # copy & run the printed sudo command
```

Check: `curl http://127.0.0.1:4000/api/health` → `{"status":"ok",...}`

## Phase 7 — nginx + SSL

```bash
sudo cp /var/www/raps/deploy/nginx-raps.conf /etc/nginx/sites-available/raps
sudo nano /etc/nginx/sites-available/raps   # replace erp.yourdomain.com
sudo ln -sf /etc/nginx/sites-available/raps /etc/nginx/sites-enabled/raps
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

DNS: in Route 53, create an `A` record `erp.yourdomain.com` → Elastic IP.

After DNS resolves:

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d erp.yourdomain.com
# Auto-renew is installed as a systemd timer; verify:
sudo systemctl list-timers | grep certbot
```

## Phase 8 — Half-yearly backups

```bash
sudo cp /var/www/raps/deploy/raps-backup.sh /usr/local/bin/raps-backup.sh
sudo chmod 755 /usr/local/bin/raps-backup.sh
sudo cp /var/www/raps/deploy/raps-backup-cron /etc/cron.d/raps-backup
sudo chmod 644 /etc/cron.d/raps-backup
sudo touch /var/log/raps-backup.log && sudo chown root:root /var/log/raps-backup.log
```

Attach IAM permissions to the EC2 instance role:

1. IAM → Roles → create role `raps-app-role` (trusted entity = EC2).
2. Create inline policy from `deploy/iam-backup-policy.json`.
3. EC2 → instance → Actions → Security → Modify IAM role → attach `raps-app-role`.

Manual test:

```bash
sudo /usr/local/bin/raps-backup.sh h1
sudo tail -f /var/log/raps-backup.log
```

To list backups any time:

```bash
aws rds describe-db-snapshots --region ap-south-1 \
  --db-instance-identifier raps-prod \
  --snapshot-type manual \
  --query "DBSnapshots[?starts_with(DBSnapshotIdentifier,'raps-')].[DBSnapshotIdentifier,SnapshotCreateTime,Status]" \
  --output table
```

To restore a backup into a new instance:

```bash
aws rds restore-db-instance-from-db-snapshot --region ap-south-1 \
  --db-instance-identifier raps-restore \
  --db-snapshot-identifier raps-2026-h1-mar-sep \
  --db-instance-class db.t4g.micro
```

Then point `DATABASE_URL` at the new endpoint (or rename instances).

## Phase 9 — Smoke test

- Browse `https://erp.yourdomain.com` — login, list Products, page through (100/page), open Product detail (FIFO batches), open Stock Movements, download a PDF.
- Confirm Notes column shows pretty `MIR ... • PO ... • QC: ...` strings, not raw JSON.

## Phase 10 — Future redeploys

```bash
ssh ubuntu@<elastic-ip>
cd /var/www/raps
./deploy.sh
```

`deploy.sh` does git pull + npm ci + prisma migrate deploy + vite build + pm2 restart.
