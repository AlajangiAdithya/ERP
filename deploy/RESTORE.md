# How to restore a RAPS backup

This is for **you only**. Other users never need this page.

---

## Where backups live

All backups live in S3 under your account:

```
s3://raps-backups-<your-account>/
  FY2025-26/
    weekly/        — 1 file, overwrites each Sunday
    monthly/       — last Sunday of each month becomes a "month" file
    quarterly/     — last Sunday of Jun/Sep/Dec/Mar (FY quarters)
    half-yearly/   — last Sunday of Sep and Mar
    yearly/        — last Sunday of March (FY end)
    master/        — small JSON snapshot of suppliers + products + users
  FY2026-27/
    ...
```

When a tier promotes to a higher tier, the lower files are deleted automatically.
Yearly backups are kept forever. Master snapshots are kept forever.

---

## Just want to LOOK at what was in a backup?

1. Log in as **superadmin** → click **Backups** in the menu.
2. Pick the FY year → pick a tier → click a file.
3. The right pane shows the date, table names, row counts, and uploaded file list.
4. Click **Download** if you want the actual file on your laptop.
5. On your laptop, right-click the `.tar.gz` → **Extract Here**. You get:
   - `db.sql.gz` — the database (un-gzip it and open in any text editor)
   - `files.tar.gz` — all the PDFs and photos (un-tar to see them)
   - `metadata.json` — the same summary you saw in the preview

That's it. No production data is touched.

---

## Need to ACTUALLY restore an old backup over today's data?

> ⚠️ This OVERWRITES everything. There is no undo.
> Only do this if today's data is broken and you want to roll back.

1. SSH to the EC2 box:
   ```
   ssh -i raps-key.pem ubuntu@<EC2-IP>
   ```
2. Run the restore script with the backup's S3 key:
   ```
   sudo bash /var/www/raps/deploy/restore.sh FY2025-26/monthly/2026-april.tar.gz
   ```
3. It will:
   - Show you the date and contents of the backup
   - Ask you to type **yes** to confirm
   - Stop the API
   - Wipe the current database and reload it from the backup
   - Restore the `/uploads` folder
   - Start the API again
4. Total time: ~1–2 minutes. Users will see "Service unavailable" during this window.

---

## What's inside one backup file?

| Inside the `.tar.gz` | What it is |
|---|---|
| `db.sql.gz` | Compressed PostgreSQL dump — every table, every row from that date |
| `files.tar.gz` | Everything in `/server/uploads/` at that moment (quotation PDFs, GRN photos, supplier assessment forms, IIR PDFs, etc.) |
| `metadata.json` | Small summary: date, FY, tier, table list with row counts, file count |

---

## Common questions

**Q: Can I restore only ONE table (e.g., just suppliers)?**
A: Yes, but you'll need to do it by hand. Download the backup, un-gzip `db.sql.gz`, open it in a text editor, find the `INSERT` lines for the table you want, and run them via `psql`. Or ask a developer for help.

**Q: A purchase officer says "I bought product X on 2024-08-12 from supplier Y for ₹50,000 — can you find this?"**
A: Open the superadmin **Backups** page → find a backup from around that date (e.g. `FY2024-25/monthly/2024-august.tar.gz`) → click it → download → un-gzip the SQL → search for the supplier name. Or restore it into a *local* Postgres on your laptop and use a tool like pgAdmin to browse.

**Q: I clicked Audit and now the system looks weird.**
A: Nothing real changed. Triple-click the RAPS logo to reset, or just close that browser tab. Audit mode only affects what you see — never the real database.

**Q: I think someone got the superadmin password.**
A: Change it: log in as superadmin → Real-time Corrections → User table → find row with username `superadmin` → edit `password` field (must be bcrypt-hashed; use any online bcrypt generator and paste the hash). Done.
