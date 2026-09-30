"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActor } from "@/lib/auth";
import { dateSchema } from "@/lib/validation";
import { callWorkflow, runAction, type ActionResult } from "@/server/workflow";

const CATEGORIES = ["avto", "dom", "zivljenjsko", "nezgodno", "zdravstveno", "potovalno", "drugo"] as const;

const expiryItemSchema = z.object({
  category: z.enum(CATEGORIES, { message: "Izberite vrsto." }),
  description: z.string().trim().max(200).optional().default(""),
  insurer: z.string().trim().max(120).optional().default(""),
  expiry_date: dateSchema,
  note: z.string().trim().max(1000).optional().default(""),
});

export async function addExpiries(input: unknown): Promise<ActionResult<number>> {
  return runAction(async () => {
    const { userId } = await requireActor(["agent", "owner"]);
    const v = z
      .object({ customer_id: z.string().uuid(), appointment_id: z.string().uuid().nullable().optional(), items: z.array(expiryItemSchema).min(1).max(20) })
      .parse(input);
    const n = await callWorkflow<number>("crm_add_expiries", {
      p_actor: userId,
      p_customer_id: v.customer_id,
      p_items: v.items,
      p_appointment_id: v.appointment_id ?? null,
    });
    revalidatePath(`/customers/${v.customer_id}`);
    revalidatePath("/renewals");
    return n;
  }, "Skadence so shranjene.");
}

export async function updateExpiry(input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const { userId } = await requireActor(["agent", "owner"]);
    const v = z
      .object({
        expiry_id: z.string().uuid(),
        status: z.enum(["open", "done", "dismissed"]),
        outcome: z.string().trim().max(1000).optional().default(""),
        snooze_until: dateSchema.nullable().optional(),
        repeat_next_year: z.boolean().optional().default(false),
      })
      .parse(input);
    await callWorkflow("crm_update_expiry", {
      p_actor: userId,
      p_expiry_id: v.expiry_id,
      p_status: v.status,
      p_outcome: v.outcome,
      p_snooze_until: v.snooze_until ?? null,
      p_repeat_next_year: v.repeat_next_year,
    });
    revalidatePath("/renewals");
    revalidatePath("/", "layout");
    return undefined;
  }, "Shranjeno.");
}

export async function setExpiryReminderDays(input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const { userId } = await requireActor(["owner"]);
    const v = z.object({ days: z.coerce.number().int().min(1).max(120) }).parse(input);
    await callWorkflow("crm_set_expiry_reminder_days", { p_actor: userId, p_days: v.days });
    revalidatePath("/settings");
    return undefined;
  }, "Nastavitev je shranjena.");
}
