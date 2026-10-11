"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { notifyAppointmentAgent } from "@/server/events";
import { syncAppointmentInvite } from "@/server/invites";
import { z } from "zod";
import { requireActor } from "@/lib/auth";
import { localDateTimeToIso } from "@/lib/dates";
import { findDuplicates, type DuplicateMatch } from "@/server/duplicates";
import { newCustomerAppointmentSchema, scheduleAppointmentSchema, updateAppointmentSchema } from "@/lib/validation";
import { callWorkflow, runAction, type ActionResult } from "@/server/workflow";

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
    after(async () => {
      await notifyAppointmentAgent(res.appointment_id, userId);
      await syncAppointmentInvite(res.appointment_id);
    });
    return { status: "created", ...res } as const;
  }, "Stranka in termin sta shranjena.");
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
    after(async () => {
      await notifyAppointmentAgent(res.appointment_id, userId);
      await syncAppointmentInvite(res.appointment_id);
    });
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
    after(async () => {
      await notifyAppointmentAgent(v.appointment_id, userId, "changed");
      await syncAppointmentInvite(v.appointment_id);
    });
    return undefined;
  }, "Termin je posodobljen.");
}

export async function cancelAppointment(input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const { userId } = await requireActor();
    const v = z.object({ appointment_id: z.string().uuid(), reason: z.string().trim().min(1, "Vnesite razlog.") }).parse(input);
    await callWorkflow("crm_cancel_appointment", { p_actor: userId, p_appointment_id: v.appointment_id, p_reason: v.reason });
    after(() => syncAppointmentInvite(v.appointment_id));
    revalidatePath("/", "layout");
    return undefined;
  }, "Termin je preklican.");
}
