"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActor } from "@/lib/auth";
import { customerSchema } from "@/lib/validation";
import { callWorkflow, runAction, type ActionResult } from "@/server/workflow";

export async function updateCustomer(input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const { userId } = await requireActor();
    const v = customerSchema.extend({ customer_id: z.string().uuid() }).parse(input);
    const { customer_id, ...changes } = v;
    await callWorkflow("crm_update_customer", { p_actor: userId, p_customer_id: customer_id, p_changes: changes });
    revalidatePath(`/customers/${customer_id}`);
    return undefined;
  }, "Podatki stranke so shranjeni.");
}

export async function addCustomerNote(input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const { userId } = await requireActor();
    const v = z.object({ customer_id: z.string().uuid(), note: z.string().trim().min(1, "Opomba je prazna.").max(4000) }).parse(input);
    await callWorkflow("crm_add_customer_note", { p_actor: userId, p_customer_id: v.customer_id, p_note: v.note });
    revalidatePath(`/customers/${v.customer_id}`);
    return undefined;
  }, "Opomba je dodana.");
}

export async function setCustomerArchived(input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const { userId } = await requireActor(["owner"]);
    const v = z.object({ customer_id: z.string().uuid(), archived: z.boolean() }).parse(input);
    await callWorkflow("crm_set_customer_archived", { p_actor: userId, p_customer_id: v.customer_id, p_archived: v.archived });
    revalidatePath(`/customers/${v.customer_id}`);
    return undefined;
  }, "Shranjeno.");
}
