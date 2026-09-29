"use server";

import { revalidatePath } from "next/cache";
import { requireActor, isAgentLike } from "@/lib/auth";
import { buildPoliciesPayload } from "@/lib/commission/payload";
import { localDateTimeToIso } from "@/lib/dates";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { recordResultSchema } from "@/lib/validation";
import { callWorkflow, runAction, WorkflowError, type ActionResult } from "@/server/workflow";

export interface RecordResultData {
  appointment_id: string;
  next_appointment_id: string | null;
  followup_id: string | null;
  policy_ids: string[];
  customer_id: string;
}

/**
 * Record a consultation result (A / A0 / A1 / B).
 * For A1 the commission engine computes all commission records from the
 * agent's CURRENT rate; the SQL function verifies the rate and persists
 * policies + commissions + payout schedule atomically.
 */
export async function recordResult(input: unknown): Promise<ActionResult<RecordResultData>> {
  return runAction(async () => {
    const { userId, profile } = await requireActor();
    if (!isAgentLike(profile.role)) throw new WorkflowError("Rezultat svetovanja lahko vnese samo zastopnik.");
    const v = recordResultSchema.parse(input);

    // Read through RLS: proves the user may see this appointment.
    const supabase = await createClient();
    const { data: appt } = await supabase
      .from("appointments")
      .select("id, agent_id, caller_id, customer_id, status")
      .eq("id", v.appointment_id)
      .maybeSingle();
    if (!appt) throw new WorkflowError("Termin ne obstaja ali do njega nimate dostopa.");

    let policies = null;
    if (v.result === "A1") {
      const admin = createAdminClient();
      const { data: rate, error } = await admin.rpc("current_agent_rate", { p_agent_id: appt.agent_id });
      if (error) throw error;
      if (rate === null || rate === undefined) {
        throw new WorkflowError("Zastopnik nima nastavljenega odstotka provizije. Obrnite se na lastnika.");
      }
      policies = buildPoliciesPayload(
        v.policies.map((p) => ({ ...p, policy_number: p.policy_number || null, note: p.note || null })),
        { agentRatePercent: Number(rate).toFixed(2), hasCaller: appt.caller_id !== null },
      );
    }

    const next =
      v.result === "A"
        ? {
            agent_id: v.next.agent_id,
            scheduled_at: localDateTimeToIso(v.next.date, v.next.time),
            duration_minutes: v.next.duration_minutes,
            note: v.next.note,
          }
        : null;

    const res = await callWorkflow<Omit<RecordResultData, "customer_id">>("crm_record_result", {
      p_actor: userId,
      p_appointment_id: v.appointment_id,
      p_result: v.result,
      p_note: v.note,
      p_next: next,
      p_policies: policies,
    });
    revalidatePath("/", "layout");
    return { ...res, customer_id: appt.customer_id };
  }, "Rezultat svetovanja je shranjen.");
}
