# Architecture

## Principles

1. **The database is the source of truth and the last line of defence.** Business invariants are constraints and triggers; authorization is RLS plus checks inside workflow functions.
2. **Reads use RLS, writes use workflow functions.** Browsers and server components read through a Supabase client that carries the user's JWT, so RLS filters every row. Every write goes through a `crm_*` PL/pgSQL function that runs in one transaction.
3. **One place for each rule.** Commission maths lives in `src/lib/commission`. Status workflow lives in `crm_record_result`. Navigation lives in `src/config/navigation.ts`. Dashboard composition lives in `src/config/dashboard.ts`. Labels live in `src/lib/labels.ts`.
4. **History is never overwritten.** Every visit is a new appointment row. Results are recorded, not edited. Financial rows are immutable. The activity log is append-only. Business records cannot be hard-deleted.

## Request flow

```
Browser ──(server action)──▶ requireActor()          verify JWT (getClaims) + active profile
                             zod validation
                             [A1] commission engine   computes commissions from the agent's CURRENT rate
                             callWorkflow("crm_…")    service-role RPC, passes verified p_actor
                                   │
                                   ▼
                     PostgreSQL crm_* function (SECURITY DEFINER, service_role only)
                       re-checks actor role/ownership → writes rows → writes activity_log
                       CHECK constraints verify commission formulas; triggers protect history

Browser ──(page render)──▶ server component → Supabase client with user JWT → RLS-filtered rows
```

Why writes use the service role: the `crm_*` functions can only be executed by `service_role`, and `authenticated` users have no INSERT, UPDATE or DELETE privileges on any table. A user who calls the Supabase REST API directly can therefore only **read** what RLS allows, and can never write. The server passes the verified user id as `p_actor`, and each function re-checks what that actor may do.

## Data model

```
auth.users 1─1 profiles ─┬─< agent_commission_rates      (rate history; latest = current)
                         │
customers ─┬─< appointments ──< policies ──< commissions ──< commission_installments
           │     │  ▲ previous_appointment_id (visit chain)
           │     └─< caller_followups (source_appointment_id, resolved_appointment_id)
           ├─< documents (policy_id optional) ── Storage bucket "documents" (private)
           └─< activity_log
products ──< policies
```

| Table | Purpose / key rules |
|---|---|
| `profiles` | 1:1 with `auth.users` (`id` = auth user id). Holds role (`owner`/`agent`/`caller`) and `is_active`. Deleting a profile is blocked; deactivate instead, so historical production stays intact. |
| `agent_commission_rates` | Append-only history of each Agent's %. The current rate is the latest row. |
| `products` | Configurable products. The three initial products are seeded. `policies.product_name` snapshots the name. |
| `customers` | One persistent row per person, never duplicated per visit. `responsible_caller_id` is the Caller who originated the customer. `status` is the latest state (`scheduled`, `callback`, `won`, `lost`, `closed`). `search_text` has a trigram index for fast search. |
| `appointments` | **An appointment plus its result is the consultation.** A separate consultations table would duplicate the 1:1 relationship. `visit_number` and `previous_appointment_id` form the visit chain. `caller_id` is the Caller attribution for this appointment and is inherited by result-A follow-ups. It is not changed by agent reassignment. At most one open appointment per customer (partial unique index). Calendar-sync fields are ready for Outlook. |
| `caller_followups` | The "Call again" queue created by result B. At most one open follow-up per customer. It is resolved by the next booked appointment, or closed by the Caller. |
| `policies` | One row per policy sold at an A1 appointment. `agent_id` and `caller_id` are copied from the appointment. Financial fields are frozen by trigger. |
| `commissions` | One row per (policy, beneficiary type). It snapshots premium, years, rate %, multiplier, rule version and a human-readable calculation. CHECK constraints re-verify the formula. Immutable except `status`. |
| `commission_installments` | The payout ledger. Amount, share and original due date are immutable. Only `scheduled` rows can move to `paid` or `cancelled`, and paid rows are final. "Due" is derived (`scheduled` and due date ≤ today). |
| `documents` | Metadata for private Storage objects. Soft delete. `document_type` enum is extensible. |
| `activity_log` | Append-only history and audit trail: actor, entity, old/new value, metadata. `visibility = 'owner'` hides financial events from non-owners. |

### Attribution rules (as implemented)

- **Caller → customer:** `customers.responsible_caller_id` is the Caller who created the customer. It never changes.
- **Caller → appointment:** set to the booking Caller. An appointment created by result **A** inherits the previous appointment's Caller. An appointment booked after **B** gets the follow-up's Caller. An appointment booked manually by Owner or Agent gets the customer's responsible Caller. An Agent booking their own brand-new lead has no Caller.
- **Policy → Agent:** the Agent of the consultation appointment, i.e. the actual seller.
- **Policy → Caller:** the appointment's Caller. They get the Caller commission even if the Agent was reassigned.
- **B → returned to:** the appointment's Caller, falling back to the customer's responsible Caller.

### Status workflow (`crm_record_result`)

| Result | Effect (single transaction) |
|---|---|
| **A** | Close the appointment. Require a next date/time and Agent (defaults to the current Agent, reassignable). Create a **new** linked appointment. The customer stays `scheduled`. |
| **A0** | Close the appointment. Customer → `lost`. The customer remains searchable and is not archived. |
| **B** | Close the appointment. Create an open follow-up for the Caller. Customer → `callback`. |
| **A1** | Close the appointment. Require ≥ 1 policy. Validate that the snapshot rate equals the Agent's current rate. Insert policies, agent and caller commissions, and installments. Customer → `won`. |

Every step writes `activity_log` rows that form the customer timeline.

## Money and time

- Money is `numeric(12,2)` in Postgres and **integer cents** in TypeScript (`src/lib/money.ts`), with no floating-point arithmetic. Rounding is half-up, matching Postgres `round()`.
- Instants are `timestamptz`. Calendar dates (policy date, due dates) are `date`. All user input and display uses **Europe/Ljubljana** (`src/lib/dates.ts`), so DST changes and server time zones never move appointments or payout dates.
- Payout dates are pure calendar arithmetic on `YYYY-MM-DD`, with no time zone involved.

## Frontend

- Pages are thin server components that call `src/server/queries/*` and render module components.
- Client components are limited to interaction: Kanban drag and drop, dialogs, forms and filters.
- Filters are kept in the URL (`searchParams`), so views are shareable and work with the back button. Tables paginate server-side.
- Mutations go through server actions returning `ActionResult`. `useSubmit` prevents double submission and shows toasts.
- The UI kit is small and dependency-free (`src/components/ui`).

## Testing

- `src/lib/commission/engine.test.ts`: formulas, splits, rounding, cutoff dates, multiple policies, snapshots.
- `tests/db/workflows.test.ts`: the **real migration files** run in PGlite (in-process Postgres) with Supabase auth/storage stubs. Covers Caller flow, A, A0, B → Caller → new appointment (with reassignment), A1 with multiple policies, commission snapshots after a rate change, tampered amounts rejected by the DB, payroll ledger finality, delete protection, and RLS isolation between Owner, Agents and Callers.
- `tests/db/demo-seed.test.ts`: the generated demo seed satisfies every constraint, and the purge removes only demo data.
