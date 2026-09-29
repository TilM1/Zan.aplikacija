"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActor } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { callWorkflow, runAction, WorkflowError, type ActionResult } from "@/server/workflow";

export async function updateOwnProfile(input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const { userId } = await requireActor();
    const v = z
      .object({ first_name: z.string().trim().min(1), last_name: z.string().trim().min(1), phone: z.string().trim().max(30).optional().default("") })
      .parse(input);
    await callWorkflow("crm_update_own_profile", { p_actor: userId, p_changes: v });
    revalidatePath("/", "layout");
    return undefined;
  }, "Profil je shranjen.");
}

export async function changeOwnPassword(input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    await requireActor();
    const v = z
      .object({ password: z.string().min(10, "Geslo mora imeti vsaj 10 znakov."), confirm: z.string() })
      .refine((x) => x.password === x.confirm, { path: ["confirm"], message: "Gesli se ne ujemata." })
      .parse(input);
    const supabase = await createClient();
    const { error } = await supabase.auth.updateUser({ password: v.password });
    if (error) throw new WorkflowError("Gesla ni bilo mogoče spremeniti.");
    return undefined;
  }, "Geslo je spremenjeno.");
}
