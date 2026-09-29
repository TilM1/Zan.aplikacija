# ZAN CRM

Internal CRM for an insurance sales team: **Callers** book consultations, **Agents** run them and record results (A / A0 / A1 / B), policies are captured with private PDF uploads, and a **commission engine** produces an auditable payout ledger for the **Owner**.

Stack: Next.js 16 (App Router, TypeScript) · Supabase (Postgres, Auth, Storage, RLS) · Tailwind CSS 4 · Vercel.
UI language: Slovenian. Code and docs: English.

| Topic | Document |
|---|---|
| Architecture, data model, relationships | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| Roles & permission matrix | [docs/PERMISSIONS.md](docs/PERMISSIONS.md) |
| Commission formulas & payout timing | [docs/COMMISSIONS.md](docs/COMMISSIONS.md) |
| GitHub → Vercel → Supabase deployment | [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) |
| Security measures & settings | [docs/SECURITY.md](docs/SECURITY.md) |
| Backups, recovery, CSV/XLSX export | [docs/BACKUP_AND_RECOVERY.md](docs/BACKUP_AND_RECOVERY.md) |
| Future Outlook calendar sync | [docs/OUTLOOK_INTEGRATION.md](docs/OUTLOOK_INTEGRATION.md) |

---

## Quick start (local)

Requirements: Node.js ≥ 20.9, a Supabase project (EU region recommended for GDPR).

```bash
npm install
cp .env.example .env.local        # fill in the values (see below)
```

1. **Apply database migrations**: `npm run db:migrate` (needs `SUPABASE_DB_URL`), or paste each file from `supabase/migrations/` into the SQL Editor in filename order.
2. **Create the first Owner** (only an Owner can create other employees):
   ```bash
   npm run create-owner -- owner@company.si "Ime" "Priimek" 15
   ```
   The last argument is the Owner's own Agent commission % (the Owner is also an Agent).
3. **(Optional) Load demo data**: `npm run demo:seed` (needs `SUPABASE_DB_URL`) or paste the output of `npm run demo:generate` (`supabase/seed/demo-seed.sql`) into the SQL editor.
4. `npm run dev` → http://localhost:3000

### Environment variables

| Variable | Where | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | browser + server | Project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | browser + server | Publishable (or legacy anon) key. Safe to expose: RLS protects data. |
| `SUPABASE_SECRET_KEY` | **server only** | Secret / service-role key. Used only by server actions and route handlers to call `crm_*` workflow functions, Auth admin and Storage signing. Never prefix with `NEXT_PUBLIC_`. |
| `SUPABASE_DB_URL` | local scripts only | Postgres connection string for `demo:seed` / `demo:cleanup`. Not needed on Vercel. |

`.env*` files are git-ignored (except `.env.example`). Never commit secrets.

### Scripts

| Command | What it does |
|---|---|
| `npm run dev` / `build` / `start` | Next.js |
| `npm run check` | typecheck + lint + all tests |
| `npm test` | Unit tests (commission engine, CSV) + database integration tests (real migrations in PGlite: workflows, constraints, RLS, demo seed/purge) |
| `npm run db:migrate` | Apply pending migrations to `SUPABASE_DB_URL` |
| `npm run db:wipe -- --confirm <ref>` | **Delete all data and users** (staging reset / before go-live) |
| `npm run create-owner -- …` | Bootstrap the first Owner (temporary password, must be changed at first login) |
| `npm run demo:generate` | Write `supabase/seed/demo-seed.sql` (dates relative to today) |
| `npm run demo:seed` / `demo:cleanup` | Apply demo data / remove it (needs `SUPABASE_DB_URL`) |
| `npm run db:types` | Regenerate Supabase TypeScript types (optional) |

---

## Demo data

Demo users (all `@demo.zan-crm.invalid`, password `Demo-Zan-2026!`):

| User | Role | Commission |
|---|---|---|
| tomaz.lastnik@ | Owner (also Agent) | 15 % |
| marko.kovac@ | Agent | 10 % |
| luka.horvat@ | Agent | 10 % → **12 %** (raised 60 days ago – older policies keep 10 %) |
| nina.zupan@ | Agent | 11.5 % |
| ana.novak@, jure.golob@ | Caller | × 1.5 |
| petra.krajnc@ | Caller | × 1.5 → **× 2** (raised 10 days ago – older policies keep × 1.5) |

~30 customers cover: upcoming and today's appointments, results awaiting entry, A0, B with open follow-ups, B → rescheduled (with another agent), B → A1, A → new appointment with another agent, multi-visit customers, multiple policies per consultation, policies around the 23/24/25 cutoff, 13- and 25-month installments, the Owner selling, an agent self-booked sale without a caller, a cancelled appointment and a closed follow-up.

Every demo row is flagged (`profiles.is_demo`, `customers.is_demo`) and marked "DEMO" in the UI.

**Remove before go-live:** `npm run demo:cleanup` or run `supabase/seed/demo-cleanup.sql` in the SQL editor. It calls `crm_purge_demo_data()`, which deletes demo customers with all dependent rows plus demo users. It **refuses to run** if a demo user is linked to real data, so real data can never be removed by it.

---

## Roles (summary)

- **Owner**: everything, including employees, commission rates, payroll, reports, export, settings. The Owner is also an Agent: they can hold appointments and sell policies.
- **Agent**: own pipeline (Kanban + table), calendar, customers they handle, policies, own production and earnings.
- **Caller**: new appointments, own customers, follow-up queue (B), booked appointments and their outcomes, own production and earnings.

Access is enforced by **PostgreSQL Row Level Security and server-side checks**, not by menus. See [docs/PERMISSIONS.md](docs/PERMISSIONS.md).

## Commission rules (summary)

- Agent: `monthly premium × 12 × years × agent % (snapshotted at sale)`, paid 55 % / 20 % / 25 %.
- Caller: `monthly premium × caller multiplier (snapshotted at sale; default 1.5)` per policy, paid once.
- The Owner changes both under **Zaposleni → person → Provizija**. Changes apply only to policies saved afterwards.
- Policy dated on or before the 24th → first payout on the 16th of next month; after the 24th → 16th of the month after. The 2nd and 3rd agent installments follow 12 and 24 months after the first payout (payout months 1, 13, 25). The Caller is paid on the same date as the Agent's first installment.

Details, examples and rounding rules: [docs/COMMISSIONS.md](docs/COMMISSIONS.md).

## Project layout

```
supabase/migrations/     schema, RLS, workflow functions, storage (source of truth)
supabase/seed/           demo cleanup SQL (+ generated demo seed)
src/lib/commission/      commission engine (pure, unit-tested) + rules config
src/lib/                 money, dates (Europe/Ljubljana), validation (zod), labels, auth
src/server/actions/      server actions: authorize → validate → call crm_* workflow
src/server/queries/      reads through the user's RLS-scoped Supabase client
src/server/export/       export dataset definitions + CSV
src/config/              navigation per role, dashboard widget layout
src/components/          ui kit, layout, pipeline, appointments, customers, payroll, …
src/app/(app)/           pages (one folder per module)
src/app/api/             document access (signed URLs), data export
tests/db/                PGlite integration tests running the real migrations
scripts/                 demo seed/cleanup, create-owner
```
