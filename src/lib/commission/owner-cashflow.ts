/**
 * Owner earnings by PAYOUT date (when the money actually moves), not by policy
 * date. The insurer's commission to the agency is assumed to arrive on the same
 * schedule as the agent's installments (55/20/25 at +0/+12/+24 months, or the
 * 11 monthly installments for "premija × število" products). Agent and caller
 * commissions are deducted on the dates they are actually due. Pure and tested.
 */
import { installmentDueDate, splitByShares, type IsoDate } from "./engine";
import { COMMISSION_RULES, type CommissionRules } from "./rules";
import type { Cents } from "@/lib/money";

export interface CashflowPolicy {
  policyDate: IsoDate;
  agencyCents: Cents;
  agencyModel: "standard" | "agent_multiplier" | null;
  /** When the owner sold the policy himself, the agent part stays with him. */
  soldByOwner: boolean;
  /** Non-cancelled installments of this policy (clawbacks are negative). */
  payouts: { type: "agent" | "caller"; dueDate: IsoDate; cents: Cents }[];
}

export interface CashflowEntry {
  date: IsoDate;
  /** Agency installment number (null when only a deduction falls on this date). */
  number: number | null;
  of: number;
  sharePercent: number | null;
  agencyCents: Cents;
  agentCents: Cents;
  callerCents: Cents;
  ownerCents: Cents;
}

export function policyCashflow(p: CashflowPolicy, rules: CommissionRules = COMMISSION_RULES): CashflowEntry[] {
  const schedule = p.agencyModel === "agent_multiplier" ? rules.multiplierInstallments : rules.agentInstallments;
  const parts = splitByShares(p.agencyCents, schedule.map((s) => s.sharePercent));
  const byDate = new Map<IsoDate, CashflowEntry>();
  const at = (date: IsoDate) => {
    let e = byDate.get(date);
    if (!e) {
      e = { date, number: null, of: schedule.length, sharePercent: null, agencyCents: 0, agentCents: 0, callerCents: 0, ownerCents: 0 };
      byDate.set(date, e);
    }
    return e;
  };
  schedule.forEach((s, i) => {
    const e = at(installmentDueDate(p.policyDate, s.monthsAfterFirstPayout, rules));
    e.number = s.number;
    e.sharePercent = s.sharePercent;
    e.agencyCents += parts[i];
  });
  for (const o of p.payouts) {
    if (o.type === "agent" && p.soldByOwner) continue;
    const e = at(o.dueDate);
    if (o.type === "agent") e.agentCents += o.cents;
    else e.callerCents += o.cents;
  }
  const entries = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  for (const e of entries) e.ownerCents = e.agencyCents - e.agentCents - e.callerCents;
  return entries;
}
