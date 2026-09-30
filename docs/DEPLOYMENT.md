# Deployment: GitHub → Vercel → Supabase

## Environments

| | Production | Staging (test) |
|---|---|---|
| Git branch | `main` | `develop` (or any feature branch) |
| Vercel | Production deployment (your domain) | Preview deployment (`…-git-develop-….vercel.app`) |
| Supabase | production project (real data) | separate staging project (demo data only) |
| Vercel env vars | scope **Production** → prod keys | scope **Preview** → staging keys |
| `.env.local` (your computer) | ✗ never point local dev at production | ✔ staging keys |

Workflow: change code on `develop` → push → test on the Preview URL (staging database) → merge `develop` into `main` → production deploys automatically. Database changes: `npm run db:migrate` against staging first, then production (switch `SUPABASE_DB_URL`).

Protect preview URLs: Vercel → Settings → Deployment Protection → **Vercel Authentication** for Preview.


## 1. Supabase (production project)

- Use a **dedicated project** for the CRM, not shared with other apps (GDPR, and because auth users and triggers are project-wide). Choose an EU region (e.g. `eu-central-1`, Frankfurt).
- Apply the migrations in `supabase/migrations/` in filename order:
  - `npx supabase link --project-ref <ref>` then `npx supabase db push`, or
  - paste each file into the SQL Editor.
- **Auth settings** (Dashboard → Authentication):
  - Disable public sign-ups ("Allow new users to sign up" = off). Employees are created by the Owner only.
  - Set a minimum password length ≥ 10.
  - Site URL = your production URL.
- Bootstrap the Owner: `npm run create-owner -- owner@company.si "Ime" "Priimek" 15` (run locally with the production env values).
- **Do not** load demo data into production. If you did, run `supabase/seed/demo-cleanup.sql`.
- Enable backups / PITR, see [BACKUP_AND_RECOVERY.md](BACKUP_AND_RECOVERY.md).
- Check Dashboard → Advisors (security and performance) after each migration.

## 2. Vercel

1. Import the GitHub repository in Vercel (framework preset: Next.js).
2. Environment variables (Production and Preview):
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
   - `SUPABASE_SECRET_KEY` (keep this unprefixed, so it stays server-only)
   - `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (push notifications; generate with `npx web-push generate-vapid-keys`)
   - `CRON_SECRET` (random string; Vercel sends it to `/api/cron/daily`)
3. Region: choose one close to the Supabase region (e.g. `fra1`).
4. Deploy. Every push to `main` deploys to production, and PRs get preview deployments.
   - Point previews at a separate staging Supabase project so previews never touch production data.

## 3. Release checklist

- [ ] `npm run check` passes (types, lint, tests)
- [ ] Migrations applied to staging, app tested with demo data
- [ ] Migrations applied to production (never change the production schema by hand)
- [ ] No demo data in production (`select count(*) from profiles where is_demo` = 0)
- [ ] Owner account exists; public sign-ups disabled
- [ ] Backups/PITR enabled

## Schema changes

Always add a **new** migration file (`supabase/migrations/<timestamp>_<name>.sql`). Never edit a migration that is already applied. Apply to staging first, then production.

**Privileges for new tables:** the RLS migration revokes default privileges from `anon`/`authenticated`. For every new table, a migration must explicitly `grant select … to authenticated`, `enable row level security` and add SELECT policies. Writes should go through a new or extended `crm_*` function (granted to `service_role` only).
