"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActor } from "@/lib/auth";
import { callWorkflow, runAction, type ActionResult } from "@/server/workflow";

export async function saveProduct(input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const { userId } = await requireActor(["owner"]);
    const v = z
      .object({
        id: z.string().uuid().nullable(),
        name: z.string().trim().min(1, "Ime je obvezno.").max(120),
        is_active: z.boolean(),
        sort_order: z.coerce.number().int().min(0).max(10000),
      })
      .parse(input);
    await callWorkflow("crm_upsert_product", {
      p_actor: userId,
      p_product_id: v.id,
      p_name: v.name,
      p_is_active: v.is_active,
      p_sort_order: v.sort_order,
    });
    revalidatePath("/settings");
    return undefined;
  }, "Produkt je shranjen.");
}
