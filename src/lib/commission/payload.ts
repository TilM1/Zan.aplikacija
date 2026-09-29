/**
 * Builds the A1 policies payload for crm_record_result: user-entered policy
 * fields + commission plans from the engine. Shared by the server action,
 * seed generator and integration tests so there is exactly one code path.
 */
import { buildPolicyCommissions, type AgentCommissionPlan, type CallerCommissionPlan, type IsoDate } from "./engine";

export interface PolicyEntry {
  product_id: string;
  monthly_premium: string; // decimal string
  duration_years: number;
  policy_date: IsoDate;
  policy_number?: string | null;
  note?: string | null;
}

export interface PolicyPayload extends PolicyEntry {
  agent_commission: AgentCommissionPlan;
  caller_commission: CallerCommissionPlan | null;
}

export function buildPoliciesPayload(
  entries: PolicyEntry[],
  ctx: { agentRatePercent: string; callerMultiplier: string | null },
): PolicyPayload[] {
  return entries.map((entry) => {
    const plan = buildPolicyCommissions({
      monthlyPremium: entry.monthly_premium,
      durationYears: entry.duration_years,
      policyDate: entry.policy_date,
      agentRatePercent: ctx.agentRatePercent,
      callerMultiplier: ctx.callerMultiplier,
    });
    return { ...entry, agent_commission: plan.agent, caller_commission: plan.caller };
  });
}
