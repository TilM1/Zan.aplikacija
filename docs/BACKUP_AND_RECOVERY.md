# Backup, recovery and data export

There are two separate mechanisms. The CSV/XLSX export **does not replace** database backups.

| | Supabase database backups | CRM Data Export (Owner) |
|---|---|---|
| What | Full PostgreSQL database (all tables, constraints, auth users, history) | Selected business datasets as CSV/XLSX |
| Purpose | Disaster recovery: restore the system | Offline copy, auditing, working in Excel, emergency access to key data |
| Restores the app? | Yes | No, but the data is reconstructable (includes IDs and foreign keys) |
| Includes files? | No (Storage objects are separate) | No (document metadata only) |

## 1. Database backups (infrastructure)

- **Paid plans (Pro+)** include daily backups (7 days on Pro). Enable the **Point-in-Time Recovery (PITR)** add-on for production. This is recommended for financial data: restore to any second, not just the last daily backup.
- **Free plan** has no downloadable daily backups. Do not run production on the free tier.
- **Additional off-site logical backup** (recommended weekly, and before every migration):
  ```bash
  # Dashboard → Connect → connection string (session pooler)
  npx supabase db dump --db-url "$SUPABASE_DB_URL" -f backup_schema.sql
  npx supabase db dump --db-url "$SUPABASE_DB_URL" --data-only -f backup_data.sql
  npx supabase db dump --db-url "$SUPABASE_DB_URL" --role-only -f backup_roles.sql
  ```
  Store the files encrypted in a location you control (EU, access-restricted). They contain personal data.
- **Storage (policy PDFs)** is not included in database backups. Back up the `documents` bucket periodically, e.g. with an S3-compatible sync tool using Supabase Storage S3 credentials (Dashboard → Storage → S3 connection) to a private encrypted bucket.

## 2. Recovery

1. **Accidental data change:** business records cannot be hard-deleted (triggers), and history is append-only. Most mistakes can be corrected in the app or reconstructed from `activity_log`.
2. **Data corruption or loss:** Dashboard → Database → Backups → restore a daily backup, or with PITR, the exact timestamp before the incident. A restore overwrites the project database, so first export the current state if you need to compare.
3. **Total loss / region outage:** create a new project, then restore `backup_roles.sql`, `backup_schema.sql` and `backup_data.sql` with `psql`. Re-upload the Storage backup and update the Vercel env variables.
4. After any restore, verify: `npm run check`, log in as Owner, compare row counts with the latest CRM export.

Test a restore into a scratch project at least once before go-live, and periodically after that.

## 3. CRM Data Export (Owner → "Izvoz podatkov")

- Datasets: customers, appointments/consultations, policies, commission and payout ledger (with calculation inputs), employees (with rate history), follow-ups, activity log, and document metadata.
- Formats: CSV (UTF-8 with BOM, comma separated) and XLSX. **"Prenesi vse"** produces one XLSX workbook with one sheet per dataset.
- Optional date filter per dataset (by created/scheduled/policy/due date).
- Raw columns, including IDs and foreign keys, plus readable names for convenience.
- CSV cells are protected against spreadsheet formula injection.
- Owner only. The endpoint checks the role, and RLS applies as well.

Exports contain personal data (GDPR). Store them securely, share them only with authorised people, and delete them when no longer needed.
