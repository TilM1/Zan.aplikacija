"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActor } from "@/lib/auth";
import { callWorkflow, runAction, type ActionResult } from "@/server/workflow";

export async function closeFollowup(input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const { userId } = await requireActor(["caller", "owner"]);
    const v = z.object({ followup_id: z.string().uuid(), note: z.string().trim().min(1, "Vnesite razlog.").max(2000) }).parse(input);
    await callWorkflow("crm_close_followup", { p_actor: userId, p_followup_id: v.followup_id, p_note: v.note });
    revalidatePath("/", "layout");
    return undefined;
  }, "Klic nazaj je zaprt.");
}
