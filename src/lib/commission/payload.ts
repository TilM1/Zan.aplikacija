/**
 * Builds the A1 policies payload for crm_record_result: user-entered policy
 * fields + commission plans from the engine. Shared by the server action,
 * seed generator and integration tests so there is exactly one code path.
 */
import { buildPolicyCommissions, type AgentCommissionPlan, type CallerCommissionPlan, type CommissionModel, type IsoDate } from "./engine";

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
  ctx: {
    /** Agent's current standard rate (null if not set). */
    agentRatePercent: string | null;
    callerMultiplier: string | null;
    /** product_id → commission model (default "standard"). */
    productModels?: Record<string, CommissionModel>;
    /** product_id → agent's current multiplier for that product. */
    agentMultipliers?: Record<string, string>;
  },
): PolicyPayload[] {
  return entries.map((entry) => {
    const plan = buildPolicyCommissions({
      monthlyPremium: entry.monthly_premium,
      durationYears: entry.duration_years,
      policyDate: entry.policy_date,
      agentModel: ctx.productModels?.[entry.product_id] ?? "standard",
      agentRatePercent: ctx.agentRatePercent,
      agentMultiplier: ctx.agentMultipliers?.[entry.product_id] ?? null,
      callerMultiplier: ctx.callerMultiplier,
    });
    return { ...entry, agent_commission: plan.agent, caller_commission: plan.caller };
  });
}
