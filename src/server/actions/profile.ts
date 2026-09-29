"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActor } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { passwordSchema } from "@/lib/validation";
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

/**
 * Set own password. Also used on first login with a temporary password:
 * clears the must_change_password flag, refreshes the JWT (so RLS grants
 * access again) and signs out all other devices.
 */
export async function changeOwnPassword(input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const { userId } = await requireActor(undefined, { allowTemporaryPassword: true });
    const v = z
      .object({ password: passwordSchema, confirm: z.string() })
      .refine((x) => x.password === x.confirm, { path: ["confirm"], message: "Gesli se ne ujemata." })
      .parse(input);
    const supabase = await createClient();
    const { error } = await supabase.auth.updateUser({ password: v.password });
    if (error) {
      throw new WorkflowError(
        error.code === "same_password" ? "Novo geslo mora biti drugačno od trenutnega." : error.code === "weak_password" ? "Geslo je prešibko." : "Gesla ni bilo mogoče spremeniti.",
      );
    }
    const { error: metaError } = await createAdminClient().auth.admin.updateUserById(userId, { app_metadata: { must_change_password: false } });
    if (metaError) throw new WorkflowError("Geslo je spremenjeno, a stanja računa ni bilo mogoče posodobiti. Prijavite se znova.");
    await supabase.auth.refreshSession();
    await supabase.auth.signOut({ scope: "others" });
    return undefined;
  }, "Geslo je spremenjeno.");
}
