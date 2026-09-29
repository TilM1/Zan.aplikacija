/**
 * Commission engine — pure, deterministic, fully unit-tested.
 * The only place where commission amounts and payout dates are calculated.
 */
import {
  basisHundredthsToPercent,
  centsToDecimal,
  divRoundHalfUp,
  percentToBasisHundredths,
  toCents,
  type Cents,
} from "@/lib/money";
import { COMMISSION_RULES, type CommissionRules } from "./rules";

// ---------------------------------------------------------------------------
// Calendar-date helpers (plain YYYY-MM-DD, no time zone involved)
// ---------------------------------------------------------------------------
export type IsoDate = string; // YYYY-MM-DD

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseIsoDate(date: IsoDate): { year: number; month: number; day: number } {
  const m = ISO_DATE_RE.exec(date);
  if (!m) throw new Error(`Invalid date: ${date}`);
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    throw new Error(`Invalid date: ${date}`);
  }
  return { year, month, day };
}

function formatIsoDate(year: number, month: number, day: number): IsoDate {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Add whole months to (year, month) and return the given day in that month. */
function monthWithDay(year: number, month: number, addMonths: number, day: number): IsoDate {
  const index = year * 12 + (month - 1) + addMonths;
  return formatIsoDate(Math.floor(index / 12), (index % 12) + 1, day);
}

// ---------------------------------------------------------------------------
// Payout dates
// ---------------------------------------------------------------------------

/**
 * First payout date for a policy:
 *   policy date day ≤ cutoff (24th) → payout day (16th) of the NEXT month
 *   policy date day > cutoff        → payout day of the month AFTER next
 */
export function firstPayoutDate(policyDate: IsoDate, rules: CommissionRules = COMMISSION_RULES): IsoDate {
  const { year, month, day } = parseIsoDate(policyDate);
  const monthsAhead = day <= rules.cutoffDay ? 1 : 2;
  return monthWithDay(year, month, monthsAhead, rules.payoutDay);
}

export function installmentDueDate(
  policyDate: IsoDate,
  monthsAfterFirstPayout: number,
  rules: CommissionRules = COMMISSION_RULES,
): IsoDate {
  const first = parseIsoDate(firstPayoutDate(policyDate, rules));
  return monthWithDay(first.year, first.month, monthsAfterFirstPayout, rules.payoutDay);
}

// ---------------------------------------------------------------------------
// Amounts
// ---------------------------------------------------------------------------

/** premium × 12 × years × rate%  (rate in hundredths of a percent, e.g. 10% = 1000). */
export function agentCommissionTotal(
  monthlyPremium: Cents,
  durationYears: number,
  rateBasisHundredths: number,
  rules: CommissionRules = COMMISSION_RULES,
): Cents {
  assertPositiveCents(monthlyPremium);
  if (!Number.isInteger(durationYears) || durationYears < 1) throw new Error("Duration must be a positive integer");
  if (!Number.isInteger(rateBasisHundredths) || rateBasisHundredths < 0 || rateBasisHundredths > 10000) {
    throw new Error("Rate must be between 0 and 100%");
  }
  // cents × months × years × (rate/100 in hundredths) / 10000
  return divRoundHalfUp(monthlyPremium * rules.monthsPerYear * durationYears * rateBasisHundredths, 10000);
}

/** premium × 1.5 */
export function callerCommissionTotal(monthlyPremium: Cents, rules: CommissionRules = COMMISSION_RULES): Cents {
  assertPositiveCents(monthlyPremium);
  return divRoundHalfUp(monthlyPremium * rules.callerMultiplier.numerator, rules.callerMultiplier.denominator);
}

/**
 * Split a total into installments by share. Each share is rounded half-up;
 * the last installment absorbs the rounding remainder so the parts always
 * sum exactly to the total.
 */
export function splitByShares(total: Cents, shares: readonly number[]): Cents[] {
  const sum = shares.reduce((a, b) => a + b, 0);
  if (sum !== 100) throw new Error(`Shares must sum to 100, got ${sum}`);
  const parts: Cents[] = [];
  let allocated = 0;
  shares.forEach((share, i) => {
    if (i === shares.length - 1) {
      parts.push(total - allocated);
    } else {
      const part = divRoundHalfUp(total * share, 100);
      parts.push(part);
      allocated += part;
    }
  });
  return parts;
}

function assertPositiveCents(value: Cents) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error("Monthly premium must be a positive amount");
}

// ---------------------------------------------------------------------------
// Full commission records (the payload persisted by crm_record_result)
// ---------------------------------------------------------------------------
export interface InstallmentPlan {
  number: number;
  share_percent: string;
  amount: string; // decimal string
  due_date: IsoDate;
}

export interface AgentCommissionPlan {
  rate_percent: string;
  total_amount: string;
  rule_version: string;
  calculation: Record<string, unknown>;
  installments: InstallmentPlan[];
}

export interface CallerCommissionPlan {
  caller_multiplier: string;
  total_amount: string;
  rule_version: string;
  calculation: Record<string, unknown>;
  installments: InstallmentPlan[];
}

export interface PolicyCommissionInput {
  monthlyPremium: string; // decimal string, e.g. "100.00"
  durationYears: number;
  policyDate: IsoDate;
  agentRatePercent: string; // snapshot of agent's current rate, e.g. "10.00"
  hasCaller: boolean;
}

export interface PolicyCommissionPlan {
  agent: AgentCommissionPlan;
  caller: CallerCommissionPlan | null;
}

export function buildAgentCommission(
  input: Omit<PolicyCommissionInput, "hasCaller">,
  rules: CommissionRules = COMMISSION_RULES,
): AgentCommissionPlan {
  const premium = toCents(input.monthlyPremium);
  const rate = percentToBasisHundredths(input.agentRatePercent);
  const total = agentCommissionTotal(premium, input.durationYears, rate, rules);
  const amounts = splitByShares(total, rules.agentInstallments.map((i) => i.sharePercent));
  const installments = rules.agentInstallments.map((inst, idx) => ({
    number: inst.number,
    share_percent: inst.sharePercent.toFixed(2),
    amount: centsToDecimal(amounts[idx]),
    due_date: installmentDueDate(input.policyDate, inst.monthsAfterFirstPayout, rules),
  }));
  const ratePercent = basisHundredthsToPercent(rate);
  return {
    rate_percent: ratePercent,
    total_amount: centsToDecimal(total),
    rule_version: rules.version,
    calculation: {
      formula: "monthly_premium × 12 × duration_years × rate_percent / 100",
      expression: `${centsToDecimal(premium)} × ${rules.monthsPerYear} × ${input.durationYears} × ${ratePercent}%`,
      monthly_premium: centsToDecimal(premium),
      months_per_year: rules.monthsPerYear,
      duration_years: input.durationYears,
      rate_percent: ratePercent,
      total: centsToDecimal(total),
      policy_date: input.policyDate,
      cutoff_day: rules.cutoffDay,
      payout_day: rules.payoutDay,
      schedule: rules.agentInstallments.map((i) => ({
        number: i.number,
        share_percent: i.sharePercent,
        months_after_first_payout: i.monthsAfterFirstPayout,
      })),
    },
    installments,
  };
}

export function buildCallerCommission(
  input: Pick<PolicyCommissionInput, "monthlyPremium" | "policyDate">,
  rules: CommissionRules = COMMISSION_RULES,
): CallerCommissionPlan {
  const premium = toCents(input.monthlyPremium);
  const total = callerCommissionTotal(premium, rules);
  return {
    caller_multiplier: rules.callerMultiplier.display,
    total_amount: centsToDecimal(total),
    rule_version: rules.version,
    calculation: {
      formula: "monthly_premium × caller_multiplier",
      expression: `${centsToDecimal(premium)} × ${rules.callerMultiplier.display}`,
      monthly_premium: centsToDecimal(premium),
      caller_multiplier: rules.callerMultiplier.display,
      total: centsToDecimal(total),
      policy_date: input.policyDate,
      paid_with: "agent installment 1",
    },
    installments: [
      {
        number: 1,
        share_percent: "100.00",
        amount: centsToDecimal(total),
        due_date: firstPayoutDate(input.policyDate, rules),
      },
    ],
  };
}

export function buildPolicyCommissions(
  input: PolicyCommissionInput,
  rules: CommissionRules = COMMISSION_RULES,
): PolicyCommissionPlan {
  return {
    agent: buildAgentCommission(input, rules),
    caller: input.hasCaller ? buildCallerCommission(input, rules) : null,
  };
}
