"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActor } from "@/lib/auth";
import { dateSchema } from "@/lib/validation";
import { callWorkflow, runAction, type ActionResult } from "@/server/workflow";

export async function setLeaderboardPrizes(input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const { userId } = await requireActor(["owner"]);
    const v = z
      .object({ month: dateSchema, agent_prize: z.string().trim().max(300).optional().default(""), caller_prize: z.string().trim().max(300).optional().default("") })
      .parse(input);
    await callWorkflow("crm_set_leaderboard_prizes", { p_actor: userId, p_month: v.month, p_agent_prize: v.agent_prize, p_caller_prize: v.caller_prize });
    revalidatePath("/leaderboard");
    revalidatePath("/dashboard");
    return undefined;
  }, "Nagrade so shranjene.");
}
