import "server-only";
import webpush from "web-push";
import { createAdminClient } from "@/lib/supabase/admin";

export interface PushPayload {
  title: string;
  body: string;
  /** Page to open when the notification is tapped. */
  url?: string;
  /** Same tag replaces an older notification instead of stacking. */
  tag?: string;
}

let configured: boolean | null = null;
function configure(): boolean {
  if (configured !== null) return configured;
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) {
    configured = false;
    return false;
  }
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:obvestila@example.com", pub, priv);
  configured = true;
  return true;
}

export function pushConfigured() {
  return configure();
}

/**
 * Send a notification to all devices of the given users. Never throws:
 * notifications are best-effort and must not break business actions.
 * Expired subscriptions (404/410) are removed.
 */
export async function notifyUsers(userIds: (string | null | undefined)[], payload: PushPayload): Promise<number> {
  const ids = [...new Set(userIds.filter((x): x is string => !!x))];
  if (ids.length === 0 || !configure()) return 0;
  try {
    const admin = createAdminClient();
    const { data } = await admin.from("push_subscriptions").select("id, endpoint, p256dh, auth").in("user_id", ids);
    let sent = 0;
    await Promise.all(
      (data ?? []).map(async (s) => {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { TTL: 60 * 60 * 12, urgency: "normal" });
          sent++;
          await admin.from("push_subscriptions").update({ last_success_at: new Date().toISOString(), failure_count: 0 }).eq("id", s.id);
        } catch (err) {
          const code = (err as { statusCode?: number }).statusCode;
          if (code === 404 || code === 410) await admin.from("push_subscriptions").delete().eq("id", s.id);
          else console.warn("[push] send failed", code);
        }
      }),
    );
    return sent;
  } catch (e) {
    console.warn("[push] notifyUsers failed", e);
    return 0;
  }
}
