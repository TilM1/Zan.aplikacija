/**
 * Commission & payout rules — the single place to adjust business parameters.
 *
 * Changing a value here affects ONLY policies created afterwards. Existing
 * commission records keep their snapshotted inputs and rule_version.
 * Bump RULE_VERSION whenever any value changes.
 */
export const COMMISSION_RULES = {
  version: "2026-09-v2",

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
   * Products with commission model "agent_multiplier" (e.g. Specialisti):
   * agent total = monthly premium × the agent's own multiplier for that product
   * (set per agent by the Owner, with history), paid in 11 monthly installments.
   */
  multiplierInstallments: [
    { number: 1, sharePercent: 50, monthsAfterFirstPayout: 0 },
    { number: 2, sharePercent: 15, monthsAfterFirstPayout: 1 },
    { number: 3, sharePercent: 10, monthsAfterFirstPayout: 2 },
    { number: 4, sharePercent: 5, monthsAfterFirstPayout: 3 },
    { number: 5, sharePercent: 5, monthsAfterFirstPayout: 4 },
    { number: 6, sharePercent: 2.5, monthsAfterFirstPayout: 5 },
    { number: 7, sharePercent: 2.5, monthsAfterFirstPayout: 6 },
    { number: 8, sharePercent: 2.5, monthsAfterFirstPayout: 7 },
    { number: 9, sharePercent: 2.5, monthsAfterFirstPayout: 8 },
    { number: 10, sharePercent: 2.5, monthsAfterFirstPayout: 9 },
    { number: 11, sharePercent: 2.5, monthsAfterFirstPayout: 10 },
  ],

  /**
   * Caller one-time commission = monthly premium × the caller's multiplier at sale
   * (set per caller by the Owner, with history), paid with the agent's first payout.
   * This default is used for newly created callers.
   */
  defaultCallerMultiplier: "1.5",
} as const;

export type CommissionRules = typeof COMMISSION_RULES;
