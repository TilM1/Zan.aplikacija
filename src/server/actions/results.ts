"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { notifyAppointmentAgent, notifyFollowupCaller } from "@/server/events";
import { requireActor, isAgentLike } from "@/lib/auth";
import { localDateTimeToIso } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";
import { recordResultSchema, signedCustomerSchema } from "@/lib/validation";
import { findDuplicates, type DuplicateMatch } from "@/server/duplicates";
import { buildSalePolicies } from "@/server/sale-policies";
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
      .select("id, agent_id, caller_id, customer_id, status, customer:customers(caller_tariff)")
      .eq("id", v.appointment_id)
      .maybeSingle();
    if (!appt) throw new WorkflowError("Termin ne obstaja ali do njega nimate dostopa.");

    const policies =
      v.result === "A1"
        ? await buildSalePolicies(
            appt.agent_id,
            appt.caller_id,
            v.policies.map((p) => ({ ...p, policy_number: p.policy_number || null, note: p.note || null })),
            (appt.customer as unknown as { caller_tariff: "standard" | "live" } | null)?.caller_tariff ?? "standard",
          )
        : null;

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
    after(async () => {
      await notifyAppointmentAgent(res.next_appointment_id, userId);
      await notifyFollowupCaller(res.followup_id);
    });
    return { ...res, customer_id: appt.customer_id };
  }, "Rezultat svetovanja je shranjen.");
}

export type SignedCustomerResult =
  | { status: "created"; customer_id: string; policy_ids: string[] }
  | { status: "duplicate"; matches: DuplicateMatch[] };

/**
 * Owner shortcut: add a customer who has already signed (customer + policies in
 * one step, no appointment to enter). Same commission path as a normal sale.
 */
export async function addSignedCustomer(input: unknown): Promise<ActionResult<SignedCustomerResult>> {
  return runAction(async () => {
    const { userId } = await requireActor(["owner"]);
    const v = signedCustomerSchema.parse(input);

    if (!v.confirm_duplicate) {
      const matches = await findDuplicates(v.phone, v.email);
      if (matches.length > 0) return { status: "duplicate", matches } as const;
    }

    const callerId = v.caller_id || null;
    const policies = await buildSalePolicies(
      v.agent_id,
      callerId,
      v.policies.map((p) => ({ ...p, policy_number: p.policy_number || null, note: p.note || null })),
    );
    // Signed on the earliest policy date (noon, so the day never shifts with DST)
    const signedOn = v.policies.map((p) => p.policy_date).sort()[0];
    const res = await callWorkflow<{ customer_id: string; policy_ids: string[] }>("crm_add_signed_customer", {
      p_actor: userId,
      p_customer: {
        first_name: v.first_name,
        last_name: v.last_name,
        phone: v.phone,
        email: v.email,
        address: v.address,
        postal_code: v.postal_code,
        city: v.city,
      },
      p_sale: { agent_id: v.agent_id, caller_id: callerId, signed_at: localDateTimeToIso(signedOn, "12:00"), note: v.note },
      p_policies: policies,
    });
    revalidatePath("/", "layout");
    return { status: "created", customer_id: res.customer_id, policy_ids: res.policy_ids } as const;
  }, "Podpisana stranka je shranjena.");
}
