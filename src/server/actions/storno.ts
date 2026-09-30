"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActor } from "@/lib/auth";
import { dateSchema } from "@/lib/validation";
import { callWorkflow, runAction, type ActionResult } from "@/server/workflow";

const reason = z.string().trim().min(3, "Vnesite razlog (vsaj nekaj besed).").max(1000);

export interface StornoResult {
  backup_id: string;
  cancelled_sum: number;
  clawback_sum: number;
}

/** Storno of a policy: unpaid commissions cancelled, paid ones deducted on the given payout date. */
export async function stornoPolicy(input: unknown): Promise<ActionResult<StornoResult>> {
  return runAction(async () => {
    const { userId } = await requireActor(["owner"]);
    const v = z.object({ policy_id: z.string().uuid(), reason, clawback_due: dateSchema }).parse(input);
    const res = await callWorkflow<StornoResult>("crm_storno_policy", {
      p_actor: userId,
      p_policy_id: v.policy_id,
      p_reason: v.reason,
      p_clawback_due: v.clawback_due,
    });
    revalidatePath("/", "layout");
    return res;
  }, "Polica je stornirana.");
}

export async function revertStorno(input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const { userId } = await requireActor(["owner"]);
    const v = z.object({ backup_id: z.string().uuid() }).parse(input);
    await callWorkflow("crm_revert_storno", { p_actor: userId, p_backup_id: v.backup_id });
    revalidatePath("/", "layout");
    return undefined;
  }, "Storno je razveljavljen.");
}

export async function deleteCustomer(input: unknown): Promise<ActionResult<string>> {
  return runAction(async () => {
    const { userId } = await requireActor(["owner"]);
    const v = z.object({ customer_id: z.string().uuid(), reason }).parse(input);
    const id = await callWorkflow<string>("crm_delete_customer", { p_actor: userId, p_customer_id: v.customer_id, p_reason: v.reason });
    revalidatePath("/", "layout");
    return id;
  }, "Stranka je izbrisana. Obnovite jo lahko v »Storno in izbrisi«.");
}

export async function restoreCustomer(input: unknown): Promise<ActionResult<string>> {
  return runAction(async () => {
    const { userId } = await requireActor(["owner"]);
    const v = z.object({ backup_id: z.string().uuid() }).parse(input);
    const id = await callWorkflow<string>("crm_restore_customer", { p_actor: userId, p_backup_id: v.backup_id });
    revalidatePath("/", "layout");
    return id;
  }, "Stranka je obnovljena.");
}

export async function purgeBackup(input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const { userId } = await requireActor(["owner"]);
    const v = z.object({ backup_id: z.string().uuid() }).parse(input);
    await callWorkflow("crm_purge_deleted_record", { p_actor: userId, p_backup_id: v.backup_id });
    revalidatePath("/deleted");
    return undefined;
  }, "Varnostna kopija je trajno izbrisana.");
}
