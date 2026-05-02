# RAPS ERP — Cloud Migration Plan (AWS)

**Prepared on:** 15 April 2026
**Purpose:** Move the RAPS ERP system from local development to AWS cloud so the entire team can access and use it as a desktop-app-like software.

---

## 1. What Is RAPS ERP?

RAPS ERP is a custom-built web application for managing day-to-day operations including:

- **Inventory Management** — Products, stock levels, low-stock alerts, dead stock tracking
- **Purchase Orders** — Create, send to suppliers, receive goods, track status
- **Purchase Requests** — Manager raises request → Admin approves → Purchase Officer executes
- **Material Issue Vouchers (MIV)** — Manager requests items → Store Manager approves → Items collected
- **Stock Movements** — Track all IN, OUT, and ADJUSTMENT movements across units
- **Supplier Management** — Maintain supplier details and contact info
- **User & Role Management** — 7 roles: Admin, Manager, Store Manager, Purchase Officer, Lab, NDT, Meterology
- **Dashboard & Reports** — KPIs, analytics, stock summaries, unit-wise reports
- **Audit Logs** — Every action tracked with user, timestamp, and details

**Important:** The system handles only transactional data and logs. There are no documents or file uploads involved.

---

## 2. Current Tech Stack

### Frontend (What the user sees)

- **React 18** — JavaScript framework that builds the user interface (pages, buttons, forms, tables)
- **Vite** — Development tool that bundles and serves the frontend code fast
- **Tailwind CSS** — Styling system that controls how the app looks (colors, layout, spacing)

### Backend (Server that handles all logic)

- **Node.js** — JavaScript runtime that powers the server
- **Express.js** — Framework that handles all API requests (login, fetch data, save data, etc.)

### Database (Where all data is stored)

- **PostgreSQL** — The database engine that stores all ERP data (products, POs, stock, users, logs)
- **Prisma ORM** — A tool that lets the backend talk to PostgreSQL easily using JavaScript instead of raw SQL

### Authentication & Authorization (Who can log in and do what)

- **JWT (JSON Web Tokens)** — When a user logs in, they get a secure token. This token proves their identity on every request. Two types are used:
  - *Access Token* — Short-lived (expires quickly), used for every API call
  - *Refresh Token* — Long-lived, used to get a new access token without re-logging in
- **RBAC (Role-Based Access Control)** — Each user has a role (Admin, Manager, Store Manager, Purchase Officer). The system checks their role before allowing any action.

### Security (Protection against attacks)

- **Helmet** — Adds security headers to every response, protecting against common web attacks
- **CORS** — Controls which websites/devices can talk to the server (blocks unauthorized origins)
- **bcrypt** — Hashes (scrambles) passwords before storing them. Even if someone accesses the database, they cannot read the passwords.
- **Rate Limiting** — Limits how many login attempts can be made in a short time. Blocks brute-force password guessing.

---

## 3. App Delivery — PWA (Progressive Web App)

### 3.1 What Is a PWA?

The ERP will be delivered as a **Progressive Web App** — it looks, feels, and behaves like a native desktop/mobile application, but runs through the browser engine under the hood.

### 3.2 Why PWA Over Electron (.exe)?

There are two ways to make a web app feel like desktop software. Here's why we chose PWA:

**Things both can do equally well:**
- Both look like a real desktop app (own window, no browser visible)
- Both put an icon on your desktop that you click to open
- Both hide the address bar and browser tabs — looks like native software

**Where PWA wins:**

- **Install size:**
  PWA = 0 MB (uses Chrome/Edge already on your PC).
  Electron = 150-200 MB download and install on every single PC.

- **Updates:**
  PWA = Automatic. We update the server, everyone gets the new version instantly.
  Electron = We have to rebuild the .exe file, send it to everyone, and they have to reinstall it.

- **Team setup:**
  PWA = Open the link once, click "Install", done in 2 seconds.
  Electron = Download .exe, run installer, wait, repeat on every PC.

- **Development effort:**
  PWA = ~30 minutes to set up.
  Electron = Several hours to build + ongoing maintenance for every update.

- **Works on phone:**
  PWA = Yes. Add to home screen on Android/iOS, opens like a native app.
  Electron = No. Only works on desktop. Phone access is impossible.

- **Works on tablet:**
  PWA = Yes.
  Electron = No.

**Bottom line:** PWA gives us everything Electron does, plus phone/tablet support, zero install size, automatic updates, and almost no development effort. There is no reason to use Electron for this project.

### 3.3 How It Works for the Team

**One-time setup per device (desktop):**

1. Open Chrome/Edge → go to `http://<EC2-IP>:5001`
2. Click the install icon in the address bar (or menu → "Install app")
3. A **RAPS ERP** icon appears on the desktop
4. Done — click the icon anytime to open the ERP

**One-time setup per device (phone/tablet):**

1. Open Chrome → go to `http://<EC2-IP>:5001`
2. Tap "Add to Home Screen"
3. A **RAPS ERP** icon appears on the home screen
4. Tap it — opens fullscreen like a native app

**What the team sees:**

```
Desktop:
┌──────────────────────────────────────┐
│  RAPS ERP                    ─  □  X │  ← own window, no browser chrome
│──────────────────────────────────────│
│                                      │
│  Dashboard         FY: [2026-27 ▼]  │
│  Purchase Orders                     │
│  Inventory                           │
│  ...                                 │
└──────────────────────────────────────┘

Phone:
┌─────────────────────┐
│  RAPS ERP           │  ← fullscreen, no address bar
│─────────────────────│
│                     │
│  Dashboard          │
│  FY: [2026-27 ▼]   │
│  ...                │
└─────────────────────┘
```

### 3.4 What Needs to Be Built

- A `manifest.json` file (app name, RAPS logo icon, theme colors)
- A service worker (makes it installable + enables offline shell)
- Estimated effort: ~30 minutes

---

## 4. AWS Architecture

### 4.1 Overview

```
Team Members (Desktop PWA / Phone PWA / Browser)
       │
       ▼
┌──────────────────────────────────┐
│  AWS EC2 Instance (t3.micro)     │
│                                  │
│  ┌────────────────────────────┐  │
│  │ Express.js Server          │  │
│  │  ├── Serves React Frontend │  │
│  │  │   (PWA with manifest)   │  │
│  │  ├── Handles API Requests  │  │
│  │  └── Authentication/RBAC   │  │
│  └────────────┬───────────────┘  │
│               │                  │
│  ┌────────────▼───────────────┐  │
│  │ PM2 Process Manager        │  │
│  │  Auto-restarts on crash    │  │
│  └────────────────────────────┘  │
│               │                  │
│  ┌────────────▼───────────────┐  │
│  │ Cron Jobs                  │  │
│  │  ├── Backup: Apr 1 & Oct 1│  │
│  │  └── Log cleanup: weekly   │  │
│  └────────────┬───────────────┘  │
└───────────────┼──────────────────┘
                │
       ┌────────┴────────┐
       ▼                 ▼
┌─────────────┐   ┌─────────────┐
│ AWS RDS     │   │ AWS S3      │
│ PostgreSQL  │   │ Bucket      │
│ (Database)  │   │ (Backups)   │
│             │   │             │
│ All FY data │   │ Half-yearly │
│ lives here  │   │ SQL dumps   │
└─────────────┘   └─────────────┘
```

### 4.2 AWS Services Used

| Service | Purpose | Spec |
|---------|---------|------|
| **EC2** | Hosts the backend server + serves the PWA frontend | t3.micro (1 vCPU, 1GB RAM) |
| **Elastic IP** | Permanent IP address — never changes on reboot | 1 static IP |
| **RDS PostgreSQL** | Managed database — stores all ERP data | db.t3.micro, 20GB storage |
| **S3** | Stores half-yearly database backup files | Single bucket |
| **Security Groups** | Firewall — controls who can access the server | Allow HTTP + SSH only |

### 4.3 How the Team Accesses It

- The EC2 instance gets a **permanent Elastic IP** (e.g., `http://13.235.48.102:5001`)
- First time: team opens this IP in browser and installs the PWA
- After that: they click the RAPS ERP icon on their desktop/phone — no URL needed
- No domain name or SSL certificate needed for internal use
- Access can be restricted to office network IP via Security Groups for added safety

---

## 5. User Roles & Access

| Role | Access Level |
|------|-------------|
| **Admin** | Full control — manage users, products, approve purchase requests, view all reports and audit logs |
| **Manager** | Create purchase requests, material requests (MIV), view unit reports |
| **Store Manager** | Approve/reject material requests, manage inventory, inward entry |
| **Purchase Officer** | Track and record purchases for approved purchase requests |
| **Lab / NDT / Meterology** | Same as Manager — create purchase requests, material requests (MIV), view products |

Each user gets their own login credentials. All actions are tracked in audit logs with the user's name and timestamp.

---

## 6. Financial Year Management

### 6.1 The Problem

Over time, years of accumulated data (purchase orders, stock movements, audit logs) can make the ERP feel cluttered. But we still need access to historical data when required.

### 6.2 The Solution — Financial Year Filter

The Indian financial year runs from **1st April to 31st March**.

Every transaction in the system is tagged with its financial year (e.g., FY 2026-27). The ERP has a **Financial Year dropdown** in the header:

```
┌─────────────────────────────────────────────────┐
│  RAPS ERP                      FY: [2026-27 ▼]  │
│                                     2026-27     │
│                                     2025-26     │
│                                     2024-25     │
└─────────────────────────────────────────────────┘
```

**How it works:**

- **Default view:** Always shows the current financial year — clean, fast, relevant
- **Need to check previous years?** Switch the dropdown — instantly see old purchase orders, stock movements, logs from that year
- **All data stays in the same database** — no data is ever deleted or moved
- **Performance stays fast** because all queries filter by the selected financial year using database indexes

### 6.3 Example

> "What did we purchase on 18th November 2025?"

1. Open the ERP
2. Switch the FY dropdown to **FY 2025-26**
3. Go to Purchase Orders
4. Filter by date — 18th November 2025
5. Full details are right there

No restoring backups. No waiting. Instant access.

### 6.4 When Would Old Data Be Removed?

**Likely never.** Since the ERP only stores logs and transactional data (no documents or files), even 5-10 years of data will be only a few hundred MBs. PostgreSQL handles this easily.

If after many years (5+ years) the database feels slow, the oldest financial years can be archived to S3 and removed from the active database. Archived years will show as "Archived" in the FY dropdown — clicking them loads the data from S3 in a read-only view (takes a few seconds). Your team's daily workflow is never interrupted.

### 6.5 Storage Estimates (Logs & Transactions Only)

| Timeframe | Estimated DB Size | Compressed Backup Size |
|-----------|-------------------|----------------------|
| 1 year of data | ~50-200 MB | ~5-20 MB |
| 5 years of data | ~500 MB - 1 GB | ~50-100 MB |
| 10 years of data | ~1-2 GB | ~100-200 MB |

---

## 7. Backup Strategy

### 7.1 Schedule

| When | What | Purpose |
|------|------|---------|
| **1st October** (mid-year) | Full database backup | 6-month safety copy (temporary) |
| **1st April** (start of new FY) | Full database backup | Full-year snapshot (permanent) |

### 7.2 How It Works — Rolling Backup with Space Savings

The backup strategy is designed to save storage space while ensuring data safety:

1. **October 1 (mid-year):** A cron job runs `pg_dump` and uploads a **6-month backup** to S3
   - This is a temporary safety copy covering the first half of the financial year
   - Named: `backup_YYYY_10_01_6month.sql.gz`

2. **April 1 (start of new FY):** A cron job runs `pg_dump` and uploads a **full-year backup** to S3
   - This is the permanent backup covering the entire completed financial year
   - Named: `backup_YYYY_04_01_fullyear.sql.gz`
   - **The previous October (6-month) backup is automatically deleted** to save space

**Key principle:** Only full-year backups are retained long-term. The 6-month backup is a temporary safety net — it exists only until the full-year backup is created.

### 7.3 Backup Lifecycle Example

```
Oct 2026:  backup_2026_10_01_6month.sql.gz   ← created (temporary)
Apr 2027:  backup_2027_04_01_fullyear.sql.gz  ← created (permanent)
           backup_2026_10_01_6month.sql.gz    ← AUTO-DELETED (no longer needed)

Oct 2027:  backup_2027_10_01_6month.sql.gz   ← created (temporary)
Apr 2028:  backup_2028_04_01_fullyear.sql.gz  ← created (permanent)
           backup_2027_10_01_6month.sql.gz    ← AUTO-DELETED (no longer needed)
```

**What you always have in S3:**
- All past full-year backups (permanent, one per financial year)
- The current 6-month backup (only between October and April)

```
S3 Bucket: raps-erp-backups/
├── backup_2027_04_01_fullyear.sql.gz   ← permanent (FY 2026-27)
├── backup_2028_04_01_fullyear.sql.gz   ← permanent (FY 2027-28)
├── backup_2029_04_01_fullyear.sql.gz   ← permanent (FY 2028-29)
└── backup_2029_10_01_6month.sql.gz     ← temporary (deleted when Apr 2030 backup runs)
```

### 7.4 Important: Backups Do NOT Remove Data

**Nothing is removed from the ERP when a backup runs.** The ERP continues to show all data as normal. Backups are purely safety copies for disaster recovery. Only the old 6-month backup file is deleted from S3 — no ERP data is ever touched.

### 7.5 What Are Backups For?

Backups protect against:

- Server crashes or hardware failure
- Accidental data deletion
- Database corruption
- AWS outages

### 7.6 Restoring from Backup

If something goes wrong:

1. Download the latest backup from S3
2. Restore it to the RDS database
3. The ERP is back to the state it was in when the backup was taken

### 7.7 Backup Storage in S3

Only full-year backups accumulate. 6-month backups are auto-deleted, saving ~50% storage:

**Storage cost:**

| Stored Backups | Approx Size | Monthly Cost |
|----------------|-------------|-------------|
| 5 years (5 full-year files) | ~50-100 MB | **< ₹1** |
| 10 years (10 full-year files) | ~100-200 MB | **~₹1** |
| 20 years (20 full-year files) | ~200-400 MB | **~₹2** |

---

## 8. Cost Estimate

### 8.1 First 12 Months (AWS Free Tier)

| Service | Monthly Cost |
|---------|-------------|
| EC2 t3.micro | Free |
| Elastic IP | Free (while attached to running EC2) |
| RDS PostgreSQL db.t3.micro (20GB) | Free |
| S3 (backup storage) | ~₹5 |
| **Total** | **~₹5-10/month** |

### 8.2 After Free Tier Expires

| Service | Monthly Cost |
|---------|-------------|
| EC2 t3.micro | ~₹700 |
| Elastic IP | Free (while attached to running EC2) |
| RDS PostgreSQL db.t3.micro (20GB) | ~₹1,200 |
| S3 (backup storage) | ~₹5 |
| **Total** | **~₹1,900-2,000/month** |

### 8.3 Cost Optimization Options

- **Reserved Instances:** Commit for 1 year on EC2 + RDS to save 30-40% (~₹1,200/month instead of ₹2,000)
- **Stay on free tier as long as possible:** The t3.micro can handle a small-to-medium team comfortably
- **No NAT Gateway:** Avoid this service — it alone costs ₹2,600/month and is not needed for this setup

---

## 9. EC2 Server Maintenance — Set It and Forget It

### 9.1 Potential Issues & Prevention

#### Auto-Restart on Crash/Reboot

EC2 can restart due to AWS maintenance or hardware events. The app must come back online automatically.

**Solution:** PM2 (process manager) + systemd service

- PM2 auto-restarts the Node.js app if it crashes
- systemd ensures PM2 starts when the EC2 instance boots
- Result: even if AWS restarts the server at 3 AM, the ERP is back online within seconds — no manual intervention

#### Permanent IP Address

Without an Elastic IP, the public IP changes on every EC2 reboot. The team's bookmarks and PWA would break.

**Solution:** Attach an **Elastic IP** — a permanent IP that never changes, even across reboots. Free while the EC2 is running.

#### Disk Space Management

Over years, system logs and temp files can fill the disk.

**Solution:**
- Set up **log rotation** — old logs auto-delete after 30 days
- Use **30GB** disk (within free tier) — more than enough for this workload
- Weekly cron job to clean temp files

#### Security Updates

Over years, the OS will have vulnerabilities if not patched.

**Solution:** Enable **automatic security updates**

- Amazon Linux: `yum-cron`
- Ubuntu: `unattended-upgrades`
- Runs automatically — no manual intervention needed

#### Protection from Attacks

Public IP means bots will scan and attempt to break in.

**Solutions:**

| Measure | What It Does |
|---------|-------------|
| **Security Groups** | Only allow your office IP / team IPs to access the server |
| **SSH Key only** | No password login to the server — SSH key-based authentication only |
| **Rate Limiting** | Already built into the app — prevents brute force login attempts |
| **Fail2Ban** | Auto-blocks IPs that try too many failed SSH logins |

#### Surprise AWS Bills

After the free tier expires, charges begin. Avoid unexpected costs.

**Solution:**
- Set up **AWS Billing Alerts** — get email notification if cost exceeds ₹2,500
- Set a **monthly budget** in AWS Console → Budgets
- Takes 2 minutes to configure

### 9.2 One-Time Setup Checklist

| # | Task | Purpose |
|---|------|---------|
| 1 | Install **PM2** + configure as systemd service | App auto-restarts on crash/reboot |
| 2 | Attach **Elastic IP** | IP never changes |
| 3 | Set up **log rotation** | Disk never fills up |
| 4 | Enable **automatic security updates** | Server stays patched |
| 5 | Configure **Security Groups** tightly | Only team can access |
| 6 | Use **SSH key authentication** (no password) | Prevents brute force on server |
| 7 | Install **Fail2Ban** | Auto-blocks attackers |
| 8 | Set **AWS billing alert** at ₹2,500 | No surprise bills |
| 9 | Configure **backup cron jobs** (already planned) | Data is always safe |

### 9.3 After Setup

```
You:       Set it up once → forget about it
EC2:       Runs 24/7, restarts itself if needed
App:       PM2 keeps it alive, auto-recovers from crashes
IP:        Never changes (Elastic IP)
Security:  Auto-updates, locked down access
Backups:   Run automatically to S3
Billing:   Alerts if anything unusual

Your job:  Nothing. Just use the ERP.
```

EC2 instances routinely run for 5-10+ years without being touched.

---

## 10. Security

| Measure | Details |
|---------|---------|
| **Authentication** | JWT tokens with expiry — users must log in with credentials |
| **Password Storage** | Bcrypt hashed — passwords are never stored in plain text |
| **Role-Based Access** | Each user can only access features allowed by their role |
| **Audit Trail** | Every action logged with user name, timestamp, IP address, and details |
| **AWS Security Groups** | Firewall restricts access — can limit to office network IP only |
| **Rate Limiting** | Login attempts are rate-limited to prevent brute force attacks |
| **Helmet** | HTTP security headers enabled on all responses |
| **Database** | RDS is not directly accessible from the internet |
| **SSH** | Key-based authentication only — no password login to server |
| **Fail2Ban** | Auto-blocks suspicious IPs |
| **Auto-Patching** | OS security updates applied automatically |

---

## 11. What the Team Needs to Know

### For Regular Users (Managers, Store Managers, Purchase Officers)

- **First time:** Open browser → go to server IP → click "Install" → RAPS ERP icon appears on desktop/phone
- **Daily use:** Click the RAPS ERP icon → log in → work
- Use the FY dropdown to switch between financial years if needed
- All your actions are recorded in the audit log
- Works on desktop, laptop, phone, and tablet

### For the Admin

- You manage user accounts (create, activate, deactivate)
- You approve purchase requests
- You have access to all reports, logs, and analytics
- Backups run automatically — no action needed from you
- Server maintains itself (auto-restart, auto-updates)

### What Happens If the Server Goes Down?

- AWS provides 99.9% uptime on EC2 and RDS
- PM2 auto-restarts the app within seconds if it crashes
- If there is an AWS outage, data is safe in RDS (it has automatic daily snapshots)
- Half-yearly backups in S3 provide an additional safety net
- The system can be restored within minutes from the latest backup

---

## 12. Implementation Steps

| Step | Task | Who |
|------|------|-----|
| 1 | Create AWS account and set up free tier | Developer |
| 2 | Launch EC2 instance (t3.micro), install Node.js | Developer |
| 3 | Attach Elastic IP to EC2 | Developer |
| 4 | Set up RDS PostgreSQL, run migrations and seed data | Developer |
| 5 | Configure security groups, SSH keys, Fail2Ban | Developer |
| 6 | Install PM2, configure systemd auto-start | Developer |
| 7 | Set up log rotation and auto security updates | Developer |
| 8 | Add financial year tagging to all transactional tables | Developer |
| 9 | Add FY dropdown filter to the ERP frontend | Developer |
| 10 | Add PWA support (manifest.json, service worker, RAPS icon) | Developer |
| 11 | Build React frontend and deploy on EC2 (served by Express) | Developer |
| 12 | Deploy Express backend on EC2 | Developer |
| 13 | Set up S3 bucket and backup cron jobs (Apr 1 & Oct 1) | Developer |
| 14 | Set up AWS billing alerts | Developer |
| 15 | Create user accounts for all team members | Admin |
| 16 | Team installs PWA on their devices | Team |
| 17 | Test all workflows end-to-end | Team |
| 18 | Go live | Everyone |

---

## 13. Summary

| Aspect | Decision |
|--------|----------|
| **App Type** | PWA — installable on desktop & phone, looks like native app |
| **Hosting** | AWS (EC2 + RDS + S3) |
| **Access** | Click RAPS ERP icon on desktop/phone — no URL needed after install |
| **Database** | PostgreSQL on AWS RDS — secure, managed, reliable |
| **Financial Years** | All years in one database, filtered by FY dropdown in header |
| **Previous Year Access** | Switch the dropdown — instant access, no restoration needed |
| **Backups** | Automatic half-yearly (Oct 1 & Apr 1) to S3 — disaster recovery only |
| **Backups Retention** | Full-year backups (Apr 1) kept permanently; 6-month backups (Oct 1) auto-deleted when full-year backup is created |
| **Data in ERP** | Never removed — backups are just safety copies |
| **Data Archival** | Only if DB feels slow after 5+ years — archived FYs viewable via S3 |
| **Data Deletion** | None — all data retained unless manually archived after many years |
| **Storage** | ~50-200 MB per year — negligible for logs-only system |
| **Cost** | ~₹5-10/month (free tier) → ~₹2,000/month (after 12 months) |
| **Server Maintenance** | Set once and forget — PM2, auto-updates, auto-restart, Elastic IP |
| **Team Access** | Each member gets their own login with role-based permissions |
| **Security** | JWT auth, bcrypt passwords, RBAC, audit logs, security groups, Fail2Ban |
