# RAPS ERP — Production Setup Record

Snapshot of the live AWS deployment as of **2026-05-02**.

---

## What's running

| Component | Detail |
|---|---|
| **App URL** | http://3.7.195.233 (HTTP only — domain/HTTPS pending) |
| **EC2 instance** | `raps-app`, x86_64 Ubuntu 26.04, Elastic IP `3.7.195.233`, ap-south-1 (Mumbai) |
| **RDS instance** | `raps-rds-sg`, PostgreSQL 18.3, `db.t4g.micro`, 20 GB gp3, ap-south-1 |
| **RDS endpoint** | `raps-rds-sg.cvkmeeiaoeol.ap-south-1.rds.amazonaws.com:5432` |
| **DB name** | `postgres` (single-DB setup) |
| **Backend** | Node 20 + Express, PM2 process `raps-api` on port 4000 |
| **Frontend** | Vite-built React, served by nginx from `/var/www/raps/client/dist` |
| **Reverse proxy** | nginx 1.28 → `/api/*` to localhost:4000, everything else to dist/ |
| **Swap** | 4 GB at `/swapfile` (needed for Vite build on small instance) |
| **Backups** | Manual RDS snapshots, half-yearly via cron (see below) |
| **IAM role** | `raps-app-role` attached to EC2, inline policy `raps-rds-snapshot` |

### Estimated monthly cost

~$22–25/month (EC2 t3.small ~$15 + RDS t4g.micro ~$8 + storage/IO ~$2).

---

## Data state (after Supabase → RDS migration)

| Table | Rows |
|---|---|
| Product | 2,661 |
| StockMovement | 1,430 |
| ProductBatch | 1,430 |
| PurchaseRequest | 420 |
| PurchaseOrder | 456 |
| User | 13 |

Migrated via `pg_dump -F c` from Supabase (pooler `aws-1-ap-southeast-1`) → `pg_restore` into RDS. The dump also brought along Supabase's `auth`/`storage`/`realtime` schemas — these are unused by the app and harmless. Can be dropped later if desired:

```sql
DROP SCHEMA IF EXISTS auth CASCADE;
DROP SCHEMA IF EXISTS storage CASCADE;
DROP SCHEMA IF EXISTS realtime CASCADE;
DROP SCHEMA IF EXISTS extensions CASCADE;
```

---

## SSH access

```bash
ssh -i C:\Users\alaja\Downloads\raps-key.pem ubuntu@3.7.195.233
```

Key permissions are locked down (Windows ACL: only owner can read).

---

## Where things live on EC2

```
/var/www/raps/            # repo root (extracted from tarball, no .git yet)
├── server/.env           # DB URL, JWT secrets, PORT=4000   ← contains secrets
├── client/.env.production # VITE_API_URL=http://3.7.195.233
├── client/dist/          # built frontend (~2 MB JS)
└── deploy/               # nginx, PM2, backup scripts (source of truth)

/etc/nginx/sites-enabled/raps        → /etc/nginx/sites-available/raps
/usr/local/bin/raps-backup.sh        # snapshot script
/etc/cron.d/raps-backup              # half-yearly schedule
/var/log/raps-backup.log             # backup history
/var/log/pm2/raps-api.{out,error}.log # backend logs
/etc/systemd/system/pm2-ubuntu.service # PM2 boot service
```

### View logs

```bash
pm2 logs raps-api --lines 100      # backend
sudo tail -f /var/log/nginx/error.log
sudo tail -f /var/log/raps-backup.log
```

### Restart backend

```bash
pm2 restart raps-api
```

### Reload nginx

```bash
sudo nginx -t && sudo systemctl reload nginx
```

---

## Backups (half-yearly RDS snapshots)

**Schedule** (UTC times, equivalent to 00:30 IST):

| Cron | Snapshot name | Covers |
|---|---|---|
| `0 19 31 3 *` (Mar 31 19:00 UTC = Apr 1 00:30 IST) | `raps-YYYY-h1-mar-sep` | Mar–Sep |
| `0 19 30 9 *` (Sep 30 19:00 UTC = Oct 1 00:30 IST) | `raps-YYYY-h2-oct-feb` | Oct–Feb |

### List snapshots

```bash
aws rds describe-db-snapshots --region ap-south-1 \
  --db-instance-identifier raps-rds-sg \
  --snapshot-type manual \
  --query "DBSnapshots[?starts_with(DBSnapshotIdentifier,'raps-')].[DBSnapshotIdentifier,SnapshotCreateTime,Status,AllocatedStorage]" \
  --output table
```

### Manual snapshot (any time)

```bash
sudo /usr/local/bin/raps-backup.sh h1   # or h2
sudo tail /var/log/raps-backup.log
```

### Restore a snapshot to a new instance

```bash
aws rds restore-db-instance-from-db-snapshot --region ap-south-1 \
  --db-instance-identifier raps-restore \
  --db-snapshot-identifier raps-2026-h1-mar-sep \
  --db-instance-class db.t4g.micro
```

Then update `server/.env` `DATABASE_URL` to point at the new endpoint, and `pm2 restart raps-api`. (Or rename instances — old becomes archive, new becomes prod.)

---

## Future redeploys

Once the GitHub repo is reachable from EC2 (see "Open items" below), `deploy.sh` handles redeploys end-to-end:

```bash
ssh -i C:\Users\alaja\Downloads\raps-key.pem ubuntu@3.7.195.233
cd /var/www/raps && ./deploy.sh
```

Until then, code updates require the **tar-and-scp dance**:

```powershell
# On Windows (from RAPS-ERP folder):
& "$env:WINDIR\System32\tar.exe" --exclude='./.git' --exclude='./node_modules' --exclude='./client/node_modules' --exclude='./server/node_modules' --exclude='./client/dist' --exclude='./server/uploads/*' --exclude='./.env' --exclude='./client/.env' --exclude='./server/.env' --exclude='./*.dump' --exclude='./*.tgz' -czf raps-src.tgz .

scp -i 'C:\Users\alaja\Downloads\raps-key.pem' raps-src.tgz ubuntu@3.7.195.233:~/

# On EC2:
ssh ... 'cd /var/www/raps && tar -xzf ~/raps-src.tgz && cd server && npm ci && npx prisma generate && cd ../client && npm ci && npm run build && pm2 restart raps-api'
```

---

## Open items / known limitations

### 1. Domain + HTTPS not configured
Currently HTTP-only on the bare IP. To add HTTPS:
1. Register a domain → Route 53 → A record `erp.yourdomain.com` → `3.7.195.233`
2. ```bash
   sudo sed -i 's/server_name _;/server_name erp.yourdomain.com;/' /etc/nginx/sites-available/raps
   sudo nginx -t && sudo systemctl reload nginx
   sudo apt install -y certbot python3-certbot-nginx
   sudo certbot --nginx -d erp.yourdomain.com --agree-tos -m alajangi.adithya06@gmail.com --no-eff-email --redirect
   ```
3. Update `CLIENT_URL` in `server/.env` and `VITE_API_URL` in `client/.env.production` to the HTTPS URL, rebuild frontend, restart PM2.

### 2. GitHub repo is private — `git pull` doesn't work from EC2
Pick one to enable `./deploy.sh`:
- **Make repo public**: GitHub → Settings → Danger Zone → Change visibility
- **PAT auth**: `git remote set-url origin https://<USER>:<TOKEN>@github.com/AlajangiAdithya/RAPS-ERP.git`
- **SSH deploy key**: `ssh-keygen` on EC2 → paste pubkey into GitHub repo → Settings → Deploy keys → `git remote set-url origin git@github.com:AlajangiAdithya/RAPS-ERP.git`

### 3. RDS instance was named `raps-rds-sg`
Probably an accidental naming during console wizard (security-group name reused). Functionally fine. If you ever recreate the instance, `raps-prod` would be a cleaner name; the backup script and IAM policy would need to be updated to match.

### 4. Frontend bundle is 2 MB (gzipped 632 KB)
`@react-pdf/renderer` is the main contributor. Acceptable for an internal ERP. If you ever care, code-split the PDF components with dynamic `import()`.

### 5. RDS Multi-AZ is OFF
Single-AZ for cost. Half-yearly snapshots cover disaster recovery. If RDS Mumbai AZ has an outage, expect a few hours of downtime. To upgrade: RDS console → modify instance → toggle Multi-AZ (≈doubles RDS cost).

---

## Reference: secrets locations

Nothing in this repo or on GitHub. All secrets live on EC2 only:

| Secret | Where |
|---|---|
| RDS master password | `/var/www/raps/server/.env` (`DATABASE_URL`) |
| JWT signing keys | `/var/www/raps/server/.env` (`JWT_SECRET`, `JWT_REFRESH_SECRET`) |
| EC2 SSH key | `C:\Users\alaja\Downloads\raps-key.pem` (Windows local) |

To rotate JWT secrets (kicks all logged-in users out — they'll need to re-login):

```bash
ssh ubuntu@3.7.195.233
NEW_JWT=$(openssl rand -hex 64)
NEW_REFRESH=$(openssl rand -hex 64)
sed -i "s|^JWT_SECRET=.*|JWT_SECRET=\"$NEW_JWT\"|" /var/www/raps/server/.env
sed -i "s|^JWT_REFRESH_SECRET=.*|JWT_REFRESH_SECRET=\"$NEW_REFRESH\"|" /var/www/raps/server/.env
pm2 restart raps-api
```

---

## Reference: AWS resources

| Type | Identifier | Region |
|---|---|---|
| EC2 instance | `i-01540ae536691984f` | ap-south-1 |
| Elastic IP | `3.7.195.233` | ap-south-1 |
| EC2 IAM role | `raps-app-role` (account `778368357081`) | global |
| RDS instance | `raps-rds-sg` | ap-south-1 |
| RDS security group | (allows 5432 from EC2 SG only) | ap-south-1 |
| Half-yearly snapshots | `raps-YYYY-h{1,2}-{mar-sep,oct-feb}` | ap-south-1 |

---

# Recreate from scratch on a new AWS account

Use this if the current account is gone, or you're standing up a fresh staging/DR copy. Estimated time: 60–90 min for someone who knows AWS console basics, ~30 min if you script everything via CLI.

## Phase 0 — Prereqs on your local machine

- AWS account with billing enabled
- Local machine has: git, ssh, scp (Windows: built into modern OpenSSH)
- PostgreSQL client tools (`pg_dump`/`pg_restore`/`psql`) — install from https://www.postgresql.org/download/ if missing. On Windows, it lands at `C:\Program Files\PostgreSQL\<ver>\bin\` and is NOT added to PATH by default; either add it or call binaries with full paths.
- A backup `.dump` file from the existing RDS (snapshot manually first if migrating: see "Disaster recovery" below).

## Phase 1 — Provision RDS (must come first; takes ~10 min)

AWS Console → RDS → **Create database**:

| Field | Value |
|---|---|
| Method | Standard create |
| Engine | PostgreSQL **18.x** (match the dump's source version) |
| Template | Production (or Free tier if eligible) |
| DB instance identifier | `raps-rds-sg` (or `raps-prod` — pick something sensible and remember it) |
| Master username | `postgres` |
| Master password | *generate strong, save in password manager* |
| Instance class | `db.t4g.micro` (burst), `db.t4g.small` if more headroom needed |
| Storage | 20 GB gp3, autoscaling to 100 GB |
| Multi-AZ | No (cost) — toggle on later if uptime SLA matters |
| VPC | default |
| Public access | **No** |
| VPC security group | Create new → name `raps-rds-sg` |
| Initial database name | `postgres` (or `raps`) |
| Backup retention | 7 days (RDS automated, separate from our half-yearly manual ones) |
| Encryption | Enabled (default KMS key) |
| Performance Insights | Off (free tier limits) |

Click **Create database**. Wait until status = Available. **Copy the endpoint** (looks like `<dbid>.<random>.<region>.rds.amazonaws.com`).

## Phase 2 — Provision EC2

EC2 → **Launch instance**:

| Field | Value |
|---|---|
| Name | `raps-app` |
| AMI | Ubuntu Server 26.04 LTS (note architecture — `x86_64` vs `arm64`) |
| Instance type | `t3.small` (x86) or `t4g.small` (arm) — both ~$15/mo |
| Key pair | Create new → name `raps-key` → download `.pem` immediately |
| Network | same VPC as RDS |
| Security group | Create new `raps-app-sg`. Inbound rules: 22 from your IP, 80 from 0.0.0.0/0, 443 from 0.0.0.0/0 |
| Storage | 20 GB gp3 |

After launch: **Elastic IPs** → Allocate → Associate to the instance. **Save the Elastic IP** — this is what DNS/users hit.

Now connect RDS to EC2: EC2 → Security Groups → `raps-rds-sg` → Inbound rules → **Edit** → Add rule: PostgreSQL (5432), Source = `raps-app-sg` (the security group, NOT a CIDR). Save.

On Windows, lock down the .pem permissions before first ssh:
```powershell
$key = 'C:\path\to\raps-key.pem'
& "$env:WINDIR\System32\icacls.exe" $key /inheritance:r
& "$env:WINDIR\System32\icacls.exe" $key /grant:r "${env:USERNAME}:(R)"
```
Without this, OpenSSH refuses to use the key.

## Phase 3 — Migrate data into the new RDS

If you have a `.dump` file already, skip the dump step. Otherwise dump from source:

```bash
# From the source DB (Supabase example — use POOLER hostname, not direct, since EC2 can't reach IPv6)
pg_dump "postgresql://postgres.<projectref>:<password>@aws-X-<region>.pooler.supabase.com:5432/postgres" \
  --no-owner --no-acl -F c -f raps.dump
```
Get the exact pooler URL from Supabase Dashboard → Project Settings → Database → "Session pooler" tab. Region varies per project — don't guess.

Restore on EC2 (RDS isn't publicly accessible):
```bash
scp -i raps-key.pem raps.dump ubuntu@<elastic-ip>:~/

ssh -i raps-key.pem ubuntu@<elastic-ip>
sudo apt update && sudo apt install -y postgresql-client
pg_restore --no-owner --no-acl -d \
  "postgresql://postgres:<rds_password>@<rds_endpoint>:5432/postgres?sslmode=require" \
  ~/raps.dump
# Expect "errors ignored on restore: 3" — Supabase-specific RLS/triggers. Harmless.

# Verify
psql "postgresql://postgres:<rds_password>@<rds_endpoint>:5432/postgres?sslmode=require" \
  -c 'SELECT COUNT(*) FROM "Product";'
```

## Phase 4 — Bootstrap EC2 (Node, nginx, PM2, AWS CLI)

The whole bootstrap is in `deploy/.bootstrap.sh` (see "Re-runnable bootstrap script" section below). To run it:

```bash
ssh -i raps-key.pem ubuntu@<elastic-ip>
# (the bootstrap script handles all of: apt update, Node 20, PM2, AWS CLI v2, swap, repo, .env, npm ci, vite build, PM2 start, nginx config, backup cron staging)
```

If running manually instead, the install steps:
```bash
sudo apt update && sudo apt install -y curl git nginx jq unzip
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt install -y nodejs
sudo npm install -g pm2
ARCH=$(uname -m)   # x86_64 or aarch64 — DON'T HARDCODE
curl -sS "https://awscli.amazonaws.com/awscli-exe-linux-${ARCH}.zip" -o awscliv2.zip
unzip -q awscliv2.zip && sudo ./aws/install && rm -rf aws awscliv2.zip
```

## Phase 5 — Add 4 GB swap (CRITICAL on small instances)

Vite build of this app needs ~1.5 GB RAM. `t3.small` has 2 GB. Without swap, the build OOM-kills silently:
```bash
sudo fallocate -l 4G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
free -h   # confirm Swap: 4.0Gi
```

## Phase 6 — Get the code onto EC2

If repo is **public**:
```bash
sudo mkdir -p /var/www && sudo chown ubuntu:ubuntu /var/www
git clone https://github.com/AlajangiAdithya/RAPS-ERP.git /var/www/raps
```

If repo is **private** (current state) — use one of:
- **Tar from local Windows** (no GitHub auth needed):
  ```powershell
  cd <repo-root>
  & "$env:WINDIR\System32\tar.exe" --exclude='./.git' --exclude='./node_modules' --exclude='./client/node_modules' --exclude='./server/node_modules' --exclude='./client/dist' --exclude='./server/uploads/*' --exclude='./.env' --exclude='./*/.env' --exclude='./*.dump' --exclude='./*.tgz' -czf raps-src.tgz .
  scp -i raps-key.pem raps-src.tgz ubuntu@<elastic-ip>:~/
  ssh -i raps-key.pem ubuntu@<elastic-ip> 'sudo mkdir -p /var/www/raps && sudo chown ubuntu:ubuntu /var/www/raps && tar -xzf ~/raps-src.tgz -C /var/www/raps'
  ```
- **GitHub PAT** (then `./deploy.sh` works for future redeploys):
  ```bash
  cd /var/www/raps
  git remote set-url origin https://<USER>:<PAT>@github.com/AlajangiAdithya/RAPS-ERP.git
  ```
- **GitHub SSH deploy key** (recommended for prod):
  ```bash
  ssh-keygen -t ed25519 -C "raps-ec2-deploy" -f ~/.ssh/github_deploy -N ""
  cat ~/.ssh/github_deploy.pub
  # Paste into GitHub → repo Settings → Deploy keys → Add (read-only)
  cat >> ~/.ssh/config <<EOF
  Host github.com
    IdentityFile ~/.ssh/github_deploy
    StrictHostKeyChecking no
  EOF
  cd /var/www/raps && git remote set-url origin git@github.com:AlajangiAdithya/RAPS-ERP.git
  ```

## Phase 7 — Configure .env files + build

```bash
cd /var/www/raps/server
JWT_SECRET=$(openssl rand -hex 64)
JWT_REFRESH_SECRET=$(openssl rand -hex 64)
cat > .env <<EOF
DATABASE_URL="postgresql://postgres:<rds_password>@<rds_endpoint>:5432/postgres?sslmode=require&schema=public"
DIRECT_URL="postgresql://postgres:<rds_password>@<rds_endpoint>:5432/postgres?sslmode=require&schema=public"
JWT_SECRET="$JWT_SECRET"
JWT_REFRESH_SECRET="$JWT_REFRESH_SECRET"
PORT=4000
NODE_ENV="production"
CLIENT_URL="http://<elastic-ip>"
EOF

cd /var/www/raps/client
echo "VITE_API_URL=http://<elastic-ip>" > .env.production

# Install + build
cd /var/www/raps/server && npm ci && npx prisma generate
cd /var/www/raps/client && npm ci && npm run build
```

## Phase 8 — PM2 + systemd + nginx

```bash
sudo mkdir -p /var/log/pm2 && sudo chown ubuntu:ubuntu /var/log/pm2
cd /var/www/raps
pm2 start deploy/ecosystem.config.js
pm2 save
sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u ubuntu --hp /home/ubuntu | grep '^sudo' | bash

curl http://127.0.0.1:4000/api/health   # expect {"status":"ok",...}

# nginx
sudo cp /var/www/raps/deploy/nginx-raps.conf /etc/nginx/sites-available/raps
sudo sed -i 's/server_name erp.yourdomain.com;/server_name _;/' /etc/nginx/sites-available/raps  # if no domain yet
sudo ln -sf /etc/nginx/sites-available/raps /etc/nginx/sites-enabled/raps
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
curl -I http://localhost/   # expect 200 OK
```

## Phase 9 — IAM role + backup automation

In AWS Console:
1. IAM → Roles → Create role → AWS service: EC2 → Next
2. Skip permissions → name `raps-app-role` → Create
3. Open the role → Add permissions → **Create inline policy** → JSON tab
4. Paste the contents of `deploy/iam-backup-policy.json` (update the resource ARNs to match your DB instance ID and region!)
5. Name it `raps-rds-snapshot` → Create
6. EC2 → select instance → **Actions → Security → Modify IAM role** → pick `raps-app-role`

Then on EC2:
```bash
sudo cp /var/www/raps/deploy/raps-backup.sh /usr/local/bin/raps-backup.sh
sudo chmod 755 /usr/local/bin/raps-backup.sh
sudo cp /var/www/raps/deploy/raps-backup-cron /etc/cron.d/raps-backup
sudo chmod 644 /etc/cron.d/raps-backup
sudo touch /var/log/raps-backup.log

# If your RDS instance ID differs from `raps-rds-sg`, edit it:
sudo sed -i 's/raps-rds-sg/<your-db-id>/' /usr/local/bin/raps-backup.sh

# Test
sudo /usr/local/bin/raps-backup.sh h1
sudo tail /var/log/raps-backup.log
# Snapshot create takes ~5 min for 20 GB — script waits for "available" status
```

## Phase 10 — Domain + HTTPS (optional, when domain is ready)

```bash
# 1. Route 53 (or your DNS provider): A record erp.example.com → <elastic-ip>
# 2. Wait for DNS: dig erp.example.com +short → should return the IP

sudo sed -i 's/server_name _;/server_name erp.example.com;/' /etc/nginx/sites-available/raps
sudo nginx -t && sudo systemctl reload nginx
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d erp.example.com --agree-tos -m you@example.com --no-eff-email --redirect

# 3. Update env + rebuild
sed -i 's|CLIENT_URL=.*|CLIENT_URL="https://erp.example.com"|' /var/www/raps/server/.env
echo "VITE_API_URL=https://erp.example.com" > /var/www/raps/client/.env.production
cd /var/www/raps/client && npm run build
pm2 restart raps-api
```

Auto-renewal is installed as a systemd timer — verify with `sudo systemctl list-timers | grep certbot`.

---

# Troubleshooting playbook

Symptoms we actually hit during this deployment, with fixes.

| Symptom | Root cause | Fix |
|---|---|---|
| `pg_dump: connection failed: Network is unreachable` (IPv6 address shown) | Supabase direct host `db.<ref>.supabase.co` is IPv6-only; EC2 has no IPv6 outbound by default | Use **pooler** hostname instead (IPv4): `aws-X-<region>.pooler.supabase.com:5432`, user becomes `postgres.<projectref>`. Get exact URL from Supabase Dashboard → Database → "Session pooler" tab. |
| `pg_dump: tenant/user postgres.<ref> not found` | Wrong pooler region (e.g. used `ap-south-1` when project is in `ap-southeast-1`) | Pooler region varies per project — do not assume. Read the exact URL from Supabase dashboard. |
| `pg_dump: command not found` (Windows) | PostgreSQL client not in PATH | Use full path: `& "C:\Program Files\PostgreSQL\<ver>\bin\pg_dump.exe"`. Or add `C:\Program Files\PostgreSQL\<ver>\bin` to PATH. |
| `git clone: could not read Username for 'https://github.com'` | Repo is private, EC2 has no GitHub credentials | Make repo public, OR use PAT, OR use SSH deploy key (see Phase 6 above). |
| `vite build` exits with `Killed` (no error, just dies) | OOM — kernel killed the build process. Vite + @react-pdf/renderer needs ~1.5 GB | Add 4 GB swap (Phase 5). Re-run build. |
| `aws: Exec format error` after install | Downloaded wrong architecture binary | `uname -m` on EC2; download `awscli-exe-linux-${ARCH}.zip` (`x86_64` for t3.*, `aarch64` for t4g.*). Don't hardcode. |
| `pg_restore: errors ignored on restore: 3` | Supabase-specific objects (RLS policies, event triggers, `wal_level` for realtime) that don't apply to vanilla Postgres | Ignore — these are not used by the RAPS app. Optionally `DROP SCHEMA auth/storage/realtime CASCADE;` to clean up. |
| nginx `404` on `/api/health` immediately after reload | Race condition / stale config briefly cached | Wait 1 sec and retry. If it persists: `sudo nginx -t` to validate, `sudo systemctl reload nginx`, check `/etc/nginx/sites-enabled/` for stray configs. |
| `aws rds create-db-snapshot: DBInstanceNotFound: raps-prod` | Backup script default ID (`raps-prod`) doesn't match actual RDS instance ID | `sudo sed -i 's/raps-prod/<actual-id>/' /usr/local/bin/raps-backup.sh` AND update the IAM policy resource ARNs to match. |
| `aws ... AccessDenied: not authorized to perform rds:DescribeDBInstances` | IAM policy resource scope too narrow (specific db ARN only) | Update inline policy on `raps-app-role` to use `"Resource": "*"` for read-only Describe* actions. Keep snapshot create/delete scoped to `raps-rds-sg` and `raps-*` snapshots. |
| `pm2 startup` printed a sudo command but cron / boot doesn't restart raps-api | The printed command wasn't executed | Run it explicitly: `sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u ubuntu --hp /home/ubuntu \| grep '^sudo' \| bash`, then `pm2 save`. |
| ssh from PowerShell mangles single-quoted SQL with spaces | PowerShell expands/splits args before passing to ssh | Don't pass complex SQL inline. Write a `.sh` script locally, `scp` it, then `ssh ... 'bash ~/script.sh'`. |
| `icacls: not recognized` in PowerShell | PATH issue with system32 | Use full path: `& "$env:WINDIR\System32\icacls.exe" ...` |
| `psql: warning: extra command-line argument "FROM" ignored` | Conninfo string with spaces (host=X port=Y ...) got split by shell expansion | Use **URL form** instead: `psql "postgresql://user:pwd@host:port/db?sslmode=require"` — no internal spaces. |
| Frontend loads but API calls 404 / CORS error | `VITE_API_URL` doesn't match the actual public URL | Edit `client/.env.production`, `cd client && npm run build`, `pm2 restart raps-api`. Hard-refresh browser (Ctrl+Shift+R) to bust the SPA cache. |
| Login fails with "invalid token" right after redeploy | JWT secret rotated, old tokens are now invalid | Expected. All users must re-login. To avoid: don't rotate JWT secrets unless intentional. |
| `prisma generate` complains about missing OPENSSL or platform | Prisma can't auto-detect engine for the OS | Ensure `binaryTargets = ["native"]` in `schema.prisma`. On non-glibc systems (Alpine), add `"linux-musl"`. |

---

# Disaster recovery scenarios

## DR-1: EC2 instance dies (data is safe in RDS)

1. Launch a new EC2 with the same AMI/type/key — Phase 2.
2. Re-run Phases 4–9. Skip Phase 3 (data already in RDS).
3. Reassign the Elastic IP from the dead instance to the new one (EC2 → Elastic IPs → Associate). DNS doesn't need to change.
4. Total downtime: ~30 min.

## DR-2: RDS data corruption / accidental deletion

1. Pick a snapshot from the half-yearly archive:
   ```bash
   aws rds describe-db-snapshots --region ap-south-1 \
     --db-instance-identifier raps-rds-sg --snapshot-type manual \
     --query "DBSnapshots[?starts_with(DBSnapshotIdentifier,'raps-')].[DBSnapshotIdentifier,SnapshotCreateTime]" \
     --output table
   ```
2. Restore to a new instance:
   ```bash
   aws rds restore-db-instance-from-db-snapshot --region ap-south-1 \
     --db-instance-identifier raps-restore \
     --db-snapshot-identifier raps-2026-h1-mar-sep \
     --db-instance-class db.t4g.micro
   ```
3. Wait ~10 min for it to come up. Get its endpoint from `aws rds describe-db-instances --db-instance-identifier raps-restore`.
4. Either:
   - Update `server/.env` `DATABASE_URL` to the new endpoint, `pm2 restart raps-api`. Old instance stays as-is.
   - Or swap names: rename old instance to `raps-rds-old`, rename new instance to `raps-rds-sg` (`aws rds modify-db-instance --new-db-instance-identifier ...`). Endpoint changes, must update env again.
5. Data loss is bounded by snapshot age (worst case 6 months for half-yearly + 7 days for RDS automated backups).

## DR-3: Whole AWS account compromised / lost

1. Open new AWS account.
2. **Critical**: get a `.dump` file out of the old RDS first if you still have access:
   ```bash
   ssh ubuntu@<old-elastic-ip> "pg_dump 'postgresql://postgres:PWD@<old-endpoint>:5432/postgres?sslmode=require' --no-owner --no-acl -F c -f raps-rescue.dump"
   scp ubuntu@<old-elastic-ip>:~/raps-rescue.dump .
   ```
3. Follow Phases 1–10 in the new account, with the rescued dump fed into Phase 3.
4. Update DNS A record to the new Elastic IP. Wait for TTL.

## DR-4: Half-yearly cron didn't fire

```bash
sudo cat /var/log/raps-backup.log     # last entries
sudo grep CRON /var/log/syslog | tail -20    # did cron try?
sudo systemctl status cron            # cron running?
sudo /usr/local/bin/raps-backup.sh h1 # manual snapshot — fixes immediate gap
```

Check `/etc/cron.d/raps-backup` syntax — cron is intolerant of stray characters. Cron times are in UTC by default on EC2 (Ubuntu). `0 19 31 3 *` = Mar 31 19:00 UTC = Apr 1 00:30 IST.

---

# Operations cheatsheet

```bash
# SSH
ssh -i C:\Users\alaja\Downloads\raps-key.pem ubuntu@3.7.195.233

# Health
pm2 status
pm2 logs raps-api --lines 50
sudo systemctl status nginx
curl http://localhost/api/health

# DB connection (from EC2)
psql "postgresql://postgres:<pwd>@raps-rds-sg.cvkmeeiaoeol.ap-south-1.rds.amazonaws.com:5432/postgres?sslmode=require"

# Quick restart
pm2 restart raps-api
sudo systemctl reload nginx

# Backup now
sudo /usr/local/bin/raps-backup.sh h1
sudo tail /var/log/raps-backup.log

# List snapshots
aws rds describe-db-snapshots --region ap-south-1 --db-instance-identifier raps-rds-sg --snapshot-type manual --output table

# Disk / memory
df -h
free -h

# Rebuild frontend after code change
cd /var/www/raps/client && npm run build && pm2 restart raps-api

# View nginx errors
sudo tail -f /var/log/nginx/error.log
```

---

# AI agent / Claude Code instructions

If you (Claude or another agent) are reading this to handle an issue:

1. **First**, identify the symptom in the troubleshooting playbook above. The fix is usually one row away.
2. **Always verify state before acting** — `pm2 status`, `aws rds describe-db-instances`, `ls /var/www/raps`. Don't assume the deployment matches this doc verbatim; resources may have been renamed or restructured.
3. **Never destructive without confirmation** — don't `DROP DATABASE`, `aws rds delete-*`, `rm -rf /var/www`, `pm2 delete` without explicit user OK.
4. **PowerShell quoting through ssh is brutal** — when in doubt, write commands to a `.sh` script, `scp` it, then `ssh '... bash ~/script.sh'`. Pasting complex inline SQL/aws CLI through ssh from PowerShell will silently mangle quotes.
5. **Secrets are in `/var/www/raps/server/.env` on EC2 only** — never commit them, never paste them to public channels, never put them in this doc.
6. **For new AWS account deployment**: follow "Recreate from scratch" Phases 0–10 in order. Phase 1 must complete (RDS available) before Phase 3 (data import). Phase 4 (bootstrap) can run in parallel with Phase 3.
7. **For "site is down"**: check in this order — `pm2 status` (backend alive?), `curl localhost:4000/api/health` (backend responding?), `curl localhost/` (nginx serving?), `curl localhost/api/health` (proxy working?), then external IP. Most outages are PM2 crashes or nginx config errors after a manual edit.
8. **For "can't connect to DB"**: check security group rules (RDS SG must allow 5432 from EC2 SG), then sslmode (must be `require` or stricter for RDS), then password (special chars must be URL-encoded, e.g. `@` → `%40`).
