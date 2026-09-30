"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActor } from "@/lib/auth";
import { callWorkflow, runAction, type ActionResult } from "@/server/workflow";

const productSchema = z.object({
  id: z.string().uuid().nullable(),
  name: z.string().trim().min(1, "Ime je obvezno.").max(120),
  is_active: z.boolean(),
  sort_order: z.coerce.number().int().min(0).max(10000),
});

export async function saveProduct(input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const { userId } = await requireActor(["owner"]);
    const v = productSchema.parse(input);
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

/** Save a new display order: products in the given order get sort_order 10, 20, 30, … */
export async function reorderProducts(input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const { userId } = await requireActor(["owner"]);
    const products = z.array(productSchema.extend({ id: z.string().uuid() })).min(1).max(200).parse(input);
    for (const [i, p] of products.entries()) {
      if (p.sort_order === (i + 1) * 10) continue;
      await callWorkflow("crm_upsert_product", { p_actor: userId, p_product_id: p.id, p_name: p.name, p_is_active: p.is_active, p_sort_order: (i + 1) * 10 });
    }
    revalidatePath("/settings");
    return undefined;
  });
}
