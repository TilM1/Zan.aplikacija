"use server";

import { z } from "zod";
import { headers } from "next/headers";
import { requireActor } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { notifyUsers, pushConfigured } from "@/server/notify";
import { runAction, WorkflowError, type ActionResult } from "@/server/workflow";

const subscriptionSchema = z.object({
  endpoint: z.url().max(1000),
  keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(5).max(100) }),
});

/** Store this device's push subscription for the signed-in user. */
export async function savePushSubscription(input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const { userId } = await requireActor();
    const v = subscriptionSchema.parse(input);
    const ua = (await headers()).get("user-agent")?.slice(0, 300) ?? null;
    const { error } = await createAdminClient()
      .from("push_subscriptions")
      .upsert({ user_id: userId, endpoint: v.endpoint, p256dh: v.keys.p256dh, auth: v.keys.auth, user_agent: ua, failure_count: 0 }, { onConflict: "endpoint" });
    if (error) throw new WorkflowError("Obvestil ni bilo mogoče vklopiti.");
    return undefined;
  }, "Obvestila so vklopljena na tej napravi.");
}

export async function removePushSubscription(input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const { userId } = await requireActor();
    const v = z.object({ endpoint: z.string().max(1000) }).parse(input);
    await createAdminClient().from("push_subscriptions").delete().eq("endpoint", v.endpoint).eq("user_id", userId);
    return undefined;
  }, "Obvestila so izklopljena na tej napravi.");
}

export async function sendTestNotification(): Promise<ActionResult<number>> {
  return runAction(async () => {
    const { userId } = await requireActor();
    if (!pushConfigured()) throw new WorkflowError("Obvestila na strežniku še niso nastavljena (manjkajo ključi VAPID).");
    const n = await notifyUsers([userId], { title: "CoreMark CRM", body: "Obvestila delujejo ✓", url: "/profile", tag: "test" });
    if (n === 0) throw new WorkflowError("Ni aktivne naprave za obvestila. Najprej vklopite obvestila.");
    return n;
  }, "Testno obvestilo je poslano.");
}
