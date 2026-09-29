/**
 * Commission & payout rules — the single place to adjust business parameters.
 *
 * Changing a value here affects ONLY policies created afterwards. Existing
 * commission records keep their snapshotted inputs and rule_version.
 * Bump RULE_VERSION whenever any value changes.
 */
export const COMMISSION_RULES = {
  version: "2026-09-v1",

  /** Policies dated on or before this day of month pay out in the next month. */
  cutoffDay: 24,
  /** Day of month on which payouts happen. */
  payoutDay: 16,

  /** Agent total = monthly premium × monthsPerYear × duration (years) × rate%. */
  monthsPerYear: 12,

  /**
   * Agent installments. monthsAfterFirstPayout is counted from the first payout
   * date: payout months 1, 13 and 25 (confirmed business rule).
   */
  agentInstallments: [
    { number: 1, sharePercent: 55, monthsAfterFirstPayout: 0 },
    { number: 2, sharePercent: 20, monthsAfterFirstPayout: 12 },
    { number: 3, sharePercent: 25, monthsAfterFirstPayout: 24 },
  ],

  /**
   * Caller one-time commission = monthly premium × the caller's multiplier at sale
   * (set per caller by the Owner, with history), paid with the agent's first payout.
   * This default is used for newly created callers.
   */
  defaultCallerMultiplier: "1.5",
} as const;

export type CommissionRules = typeof COMMISSION_RULES;
