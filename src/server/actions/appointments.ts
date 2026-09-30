"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { notifyAppointmentAgent } from "@/server/events";
import { z } from "zod";
import { requireActor } from "@/lib/auth";
import { localDateTimeToIso } from "@/lib/dates";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { normalizePhone } from "@/lib/phone";
import { newCustomerAppointmentSchema, scheduleAppointmentSchema, updateAppointmentSchema } from "@/lib/validation";
import { callWorkflow, runAction, type ActionResult } from "@/server/workflow";

export interface DuplicateMatch {
  id: string | null; // null when the user may not see that customer
  label: string;
}

export type CreateCustomerResult =
  | { status: "created"; customer_id: string; appointment_id: string }
  | { status: "duplicate"; matches: DuplicateMatch[] };

/** Caller workflow: new customer + first appointment with the selected agent. */
export async function createCustomerWithAppointment(input: unknown): Promise<ActionResult<CreateCustomerResult>> {
  return runAction(async () => {
    const { userId, profile } = await requireActor();
    const v = newCustomerAppointmentSchema.parse(input);

    if (!v.confirm_duplicate && !v.lead_id) {
      const matches = await findDuplicates(v.phone, v.email);
      if (matches.length > 0) return { status: "duplicate", matches } as const;
    }

    const res = await callWorkflow<{ customer_id: string; appointment_id: string }>("crm_create_customer_with_appointment", {
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
      p_appointment: {
        agent_id: v.appointment.agent_id,
        scheduled_at: localDateTimeToIso(v.appointment.date, v.appointment.time),
        duration_minutes: v.appointment.duration_minutes,
        note: v.appointment.note,
        caller_id: profile.role === "owner" ? v.caller_id || null : null,
      },
      p_lead_id: v.lead_id || null,
    });
    revalidatePath("/", "layout");
    after(() => notifyAppointmentAgent(res.appointment_id, userId));
    return { status: "created", ...res } as const;
  }, "Stranka in termin sta shranjena.");
}

/** Existing active customers with the same phone or e-mail. Hides names the user may not see. */
async function findDuplicates(phone: string, email: string): Promise<DuplicateMatch[]> {
  const admin = createAdminClient();
  const normalized = normalizePhone(phone) ?? "";
  const filters = [`phone_normalized.eq.${normalized}`];
  if (email) filters.push(`email.eq.${email}`);
  const { data } = await admin
    .from("customers")
    .select("id, first_name, last_name")
    .or(filters.join(","))
    .is("archived_at", null)
    .limit(5);
  if (!data?.length) return [];

  const supabase = await createClient();
  const { data: visible } = await supabase.from("customers").select("id").in("id", data.map((d) => d.id));
  const visibleIds = new Set((visible ?? []).map((r) => r.id));
  return data.map((d) =>
    visibleIds.has(d.id)
      ? { id: d.id, label: `${d.first_name} ${d.last_name}` }
      : { id: null, label: "Stranka z enako telefonsko številko ali e-pošto že obstaja (dodeljena drugemu sodelavcu)." },
  );
}

/** New appointment for an existing customer (e.g. caller after a B follow-up). */
export async function scheduleAppointment(input: unknown): Promise<ActionResult<{ appointment_id: string }>> {
  return runAction(async () => {
    const { userId } = await requireActor();
    const v = scheduleAppointmentSchema.parse(input);
    const res = await callWorkflow<{ appointment_id: string }>("crm_schedule_appointment", {
      p_actor: userId,
      p_customer_id: v.customer_id,
      p_appointment: {
        agent_id: v.agent_id,
        scheduled_at: localDateTimeToIso(v.date, v.time),
        duration_minutes: v.duration_minutes,
        note: v.note,
      },
    });
    revalidatePath("/", "layout");
    after(() => notifyAppointmentAgent(res.appointment_id, userId));
    return res;
  }, "Nov termin je dogovorjen.");
}

export async function updateAppointment(input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const { userId } = await requireActor();
    const v = updateAppointmentSchema.parse(input);
    await callWorkflow("crm_update_appointment", {
      p_actor: userId,
      p_appointment_id: v.appointment_id,
      p_changes: {
        agent_id: v.agent_id,
        scheduled_at: localDateTimeToIso(v.date, v.time),
        duration_minutes: v.duration_minutes,
        note: v.note,
      },
    });
    revalidatePath("/", "layout");
    after(() => notifyAppointmentAgent(v.appointment_id, userId, "changed"));
    return undefined;
  }, "Termin je posodobljen.");
}

export async function cancelAppointment(input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const { userId } = await requireActor();
    const v = z.object({ appointment_id: z.string().uuid(), reason: z.string().trim().min(1, "Vnesite razlog.") }).parse(input);
    await callWorkflow("crm_cancel_appointment", { p_actor: userId, p_appointment_id: v.appointment_id, p_reason: v.reason });
    revalidatePath("/", "layout");
    return undefined;
  }, "Termin je preklican.");
}
