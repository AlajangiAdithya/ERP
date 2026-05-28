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

Tiered backups to S3 — `deploy/backup.sh` runs every Sunday 00:30 IST via cron
(`deploy/backup.cron`). Each run bundles a Postgres dump + `/server/uploads/` +
a metadata.json into one `.tar.gz` and promotes it through the FY-aligned ladder:

| Tier | Trigger | S3 path | Older tier deleted on promotion? |
|---|---|---|---|
| Weekly      | every Sunday | `FY25-26/weekly/<date>.tar.gz` (only 1 file ever) | n/a — overwrites itself |
| Monthly     | last Sunday of calendar month | `FY25-26/monthly/<year>-<month>.tar.gz` | weekly cleared |
| Quarterly   | last Sunday of Jun/Sep/Dec/Mar | `FY25-26/quarterly/<year>-Q<n>.tar.gz` | 3 monthlies deleted |
| Half-yearly | last Sunday of Sep, Mar         | `FY25-26/half-yearly/<year>-H<n>.tar.gz` | 2 quarterlies deleted |
| Yearly      | last Sunday of March (FY end)   | `FY25-26/yearly/FY25-26.tar.gz` (kept forever) | 2 half-yearlies deleted |
| Master      | every run | `FY25-26/master/<date>-master.json` (suppliers + products + users; kept forever) | — |

Browse / restore: see `deploy/RESTORE.md` for the kid-simple walkthrough, or log in as
`superadmin` and use the **Backups** menu page.
