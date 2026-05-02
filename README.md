# RAPS ERP

Internal ERP for RAPS — products, FIFO batches, purchase requests, purchase orders, QC inspections, gate passes, stock movements, ION (issue notes), inventory transfers, payment requests.

Stack: React + Vite (client) · Express + Prisma (server) · PostgreSQL.

## Layout

```
client/                  React app (Vite)
server/                  Express API + Prisma schema/migrations
deploy/                  AWS deployment artifacts (nginx, PM2, RDS backup)
deploy.sh                One-command redeploy on EC2
```

## Local development

```bash
# Server
cd server
cp .env.example .env       # fill in DATABASE_URL/DIRECT_URL/JWT secrets
npm install
npx prisma migrate deploy
npm run dev                # http://localhost:4000

# Client (new terminal)
cd client
npm install
npm run dev                # http://localhost:5173
```

## Production deployment

See `deploy/DEPLOY.md` for the full AWS (EC2 + RDS + Route 53 + Let's Encrypt) walkthrough.

## Backups

Half-yearly RDS snapshots automated via cron — see `deploy/raps-backup.sh` and `deploy/raps-backup-cron`.

- `raps-YYYY-h1-mar-sep` snapshot taken Apr 1 (covers Mar–Sep)
- `raps-YYYY-h2-oct-feb` snapshot taken Oct 1 (covers Oct–Feb)

List: `aws rds describe-db-snapshots --region ap-south-1 --db-instance-identifier raps-prod --snapshot-type manual`
