"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActor } from "@/lib/auth";
import { localDateTimeToIso } from "@/lib/dates";
import { dateSchema } from "@/lib/validation";
import { callWorkflow, runAction, type ActionResult } from "@/server/workflow";

export async function markInstallmentsPaid(input: unknown): Promise<ActionResult<number>> {
  return runAction(async () => {
    const { userId } = await requireActor(["owner"]);
    const v = z
      .object({
        installment_ids: z.array(z.string().uuid()).min(1, "Izberite izplačila.").max(500),
        paid_on: dateSchema,
        note: z.string().trim().max(500).optional().default(""),
      })
      .parse(input);
    const count = await callWorkflow<number>("crm_mark_installments_paid", {
      p_actor: userId,
      p_installment_ids: v.installment_ids,
      p_paid_at: localDateTimeToIso(v.paid_on, "12:00"),
      p_note: v.note,
    });
    revalidatePath("/payroll");
    return count;
  }, "Izplačila so označena kot plačana.");
}
