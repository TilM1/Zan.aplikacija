# Commission engine

Code: `src/lib/commission/engine.ts` (pure functions). Parameters: `src/lib/commission/rules.ts`. Tests: `engine.test.ts`.

## Formulas

**Agent (per policy)**

```
total = monthly_premium × 12 × duration_years × agent_rate_% / 100
```

Example: 100 € × 12 × 10 × 10 % = **1,200 €**, split into:

| Installment | Share | Amount | Due |
|---|---|---|---|
| 1 | 55 % | 660 € | first payout date |
| 2 | 20 % | 240 € | first payout + 12 months ("13-month milestone") |
| 3 | 25 % | 300 € | first payout + 24 months ("25-month milestone") |

**Caller (per policy, one-time)**

```
total = monthly_premium × 1.5
```

Example: 100 € → **150 €**, due on the same date as the Agent's first installment. With several policies from one consultation, each policy produces its own Agent and Caller commission.

## Payout timing

- Cutoff: the **24th**. Payout day: the **16th**.
- Policy date ≤ 24th → first payout on the 16th of the **next** month.
- Policy date > 24th → first payout on the 16th of the month **after next**.

| Policy date | First payout (Agent 55 % + Caller 100 %) | 2nd (20 %) | 3rd (25 %) |
|---|---|---|---|
| 23 Oct 2026 | 16 Nov 2026 | 16 Nov 2027 | 16 Nov 2028 |
| 24 Oct 2026 | 16 Nov 2026 | 16 Nov 2027 | 16 Nov 2028 |
| 25 Oct 2026 | 16 Dec 2026 | 16 Dec 2027 | 16 Dec 2028 |

The date used is the **policy date** entered by the Agent. It defaults to the consultation day.

## Rounding

- All arithmetic is in integer cents.
- Totals are rounded half-up to the cent, the same as PostgreSQL `round(numeric, 2)`.
- Installments 1 and 2 are rounded half-up. Installment 3 takes the remainder, so the installments always add up exactly to the total. The database verifies this.

## Snapshots and auditability

When a policy is saved, each commission row stores:

- `base_monthly_premium`, `base_duration_years`, `rate_percent` (Agent % at sale) or `caller_multiplier`
- `policy_date`, `rule_version` (e.g. `2026-09-v1`)
- `calculation` (JSON), including a human-readable expression such as `100.00 × 12 × 10 × 10.00%`

Safeguards:

- **Rate changes never alter history.** Rates are an append-only history table, and existing commissions keep their snapshot.
- The DB **re-verifies** each total with CHECK constraints, so a tampered amount is rejected.
- `crm_record_result` rejects the save if the Agent's rate changed between preview and save.
- Commission rows are immutable (only `status` may change). Policy financial fields are frozen. Installments can only go from `scheduled` to `paid` or `cancelled`, and paid rows are final (`paid_at`, `paid_by`, `paid_amount`, `original_due_date` are kept).

## Changing the rules later

1. Edit `src/lib/commission/rules.ts` and bump `version`.
2. Update the tests.
3. If the formula itself changes, add a migration that updates the CHECK constraints so they only apply to the old `rule_version`s, plus the new formula.
4. Existing records are unaffected.

Future corrections (cancellations, clawbacks) should be **new adjustment records**, not edits. The `cancelled` statuses and immutable ledger are designed for this.
