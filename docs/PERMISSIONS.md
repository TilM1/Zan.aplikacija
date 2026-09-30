# Permissions

Enforcement layers:

1. **RLS on every table** (`supabase/migrations/…_rls.sql`) decides which rows a signed-in user can read. Anonymous users can read nothing. Deactivated users can read nothing: every policy requires an active profile.
2. **No direct writes.** `authenticated` has only SELECT privileges. All changes go through `crm_*` functions that only the server (service role) can execute. Each function re-checks the actor's role and ownership.
3. **Server actions and route handlers** verify the session (`getClaims`) and role before calling a workflow.
4. **Navigation and page guards** are convenience only.

## Read access matrix

| Data | Owner | Agent | Caller |
|---|---|---|---|
| Team directory (names, roles) | all | all active colleagues | all active colleagues |
| Customers | all | customers they handle now, had an appointment with, or sold to | customers they created or are responsible for, or booked an appointment for |
| Appointments | all | own appointments, plus full appointment history of customers they can see | appointments they booked, plus history of their customers |
| Follow-ups (B queue) | all | – | own |
| Policies | all | own sales, plus policies of customers they can see | policies originating from their appointments |
| Policy documents (PDF) | all | uploaded by them, their policies, or customers they can see | – |
| Commissions / installments (payroll) | all | **own only** | **own only** |
| Agent commission rates | all | own only | – |
| Caller commission multipliers | all | – | own only |
| Activity timeline | all | team events of visible customers (financial events hidden) | same |
| Products | all | all | all |
| Call lists (lead_lists / leads / history) | all | – | ready lists assigned to them or to all callers |
| Do-not-call list (lead_suppressions) | server only | – | – |
| Export / backup | ✔ | – | – |
| Storno & deletion backups (deleted_records) | ✔ | – | – |

## Action matrix

| Action | Owner | Agent | Caller |
|---|---|---|---|
| Create customer + appointment | ✔ (may set the Caller) | ✔ (own lead, no Caller) | ✔ (attributed to self) |
| New appointment for existing customer | ✔ | ✔ (visible customers) | ✔ (own customers; follow-ups assigned to them) |
| Reschedule / reassign open appointment | ✔ | own appointments | appointments they booked |
| Cancel open appointment | ✔ | own | booked by them |
| Record result A / A0 / A1 / B | ✔ (any) | own appointments | – |
| Close follow-up | ✔ | – | own |
| Edit customer details, add note | ✔ | visible customers | visible customers |
| Archive / restore customer | ✔ | – | – |
| Storno policy, revert storno, delete / restore customer, purge deletion backup | ✔ | – | – |
| Upload policy document | ✔ | visible customers | – |
| Mark payouts paid | ✔ | – | – |
| Create/edit/deactivate employees, set agent rates and caller multipliers, reset passwords | ✔ | – | – |
| Manage products | ✔ | – | – |
| Import / rename / assign / archive / delete call lists, set recall period | ✔ | – | – |
| Set contact status (callback, rejected, do-not-call), comment, convert to appointment | ✔ | – | contacts in their lists |
| Reports, payroll overview, export | ✔ | own production/earnings | own production/earnings |

## Guarantees verified by tests (`tests/db/workflows.test.ts`)

- A Caller cannot see another Caller's customers or follow-ups, and an Agent cannot see another Agent's customers.
- Callers and Agents see only their own commission rows. Another Agent's rate is invisible.
- Financial activity events are hidden from non-owners.
- Direct INSERT or UPDATE by an authenticated user fails with a permission error, and so does calling a workflow function directly.
- Deactivated users lose all access, and the Owner cannot lock themselves out.

## Documents

- Bucket `documents` is **private** and has no Storage policies for browser roles.
- Download: `GET /api/documents/:id` reads the `documents` row through RLS, then redirects to a **60-second signed URL**. No permanent public URLs exist.
- Upload: the server checks permission and issues a one-time signed upload URL. The browser uploads directly (no function size limits). The server then checks that the object exists and records the metadata plus a history event.
