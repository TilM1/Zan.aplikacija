import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { addDays, dayBoundsIso, todayIso } from "@/lib/dates";
import { notifyUsers } from "@/server/notify";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Daily morning summary (Vercel Cron, see vercel.json). One notification per
 * user with what needs attention today. Protected by CRON_SECRET.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const admin = createAdminClient();
  const today = todayIso();
  const { start, end } = dayBoundsIso(today);
  const nowIso = new Date().toISOString();

  const [{ data: people }, { data: setting }] = await Promise.all([
    admin.from("profiles").select("id, role").eq("is_active", true),
    admin.from("app_settings").select("value").eq("key", "expiry_reminder_days").maybeSingle(),
  ]);
  const reminderDays = Number(setting?.value ?? 14);

  const [appsToday, pending, expiries, followups, callbacks, lists] = await Promise.all([
    admin.from("appointments").select("agent_id").eq("status", "scheduled").gte("scheduled_at", start).lt("scheduled_at", end),
    admin.from("appointments").select("agent_id").eq("status", "scheduled").lt("scheduled_at", nowIso),
    admin
      .from("customer_expiries")
      .select("assigned_agent_id")
      .eq("status", "open")
      .lte("expiry_date", addDays(today, reminderDays))
      .or(`snoozed_until.is.null,snoozed_until.lte.${today}`),
    admin.from("caller_followups").select("caller_id").eq("status", "open"),
    admin.from("leads").select("list_id").eq("status", "callback").lt("next_call_at", end),
    admin.from("lead_lists").select("id, assigned_caller_id").eq("status", "ready"),
  ]);

  const countBy = <T,>(rows: T[] | null, key: (r: T) => string | null) => {
    const m = new Map<string, number>();
    for (const r of rows ?? []) {
      const k = key(r);
      if (k) m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  };
  const todayBy = countBy(appsToday.data, (r) => r.agent_id);
  const pendingBy = countBy(pending.data, (r) => r.agent_id);
  const expiriesBy = countBy(expiries.data, (r) => r.assigned_agent_id);
  const followupsBy = countBy(followups.data, (r) => r.caller_id);
  const listOwner = new Map((lists.data ?? []).map((l) => [l.id, l.assigned_caller_id as string | null]));
  const callbacksByList = countBy(callbacks.data, (r) => r.list_id);
  const callers = (people ?? []).filter((p) => p.role === "caller");

  let sent = 0;
  for (const p of people ?? []) {
    const lines: string[] = [];
    let url = "/dashboard";
    if (p.role === "agent" || p.role === "owner") {
      const t = todayBy.get(p.id) ?? 0;
      const e = expiriesBy.get(p.id) ?? 0;
      const r = pendingBy.get(p.id) ?? 0;
      if (t) lines.push(`${t} ${t === 1 ? "termin" : "terminov"} danes`);
      if (e) lines.push(`${e} skadenc za klic`);
      if (r) lines.push(`${r} terminov čaka na rezultat`);
      if (e && !t) url = "/renewals";
    } else if (p.role === "caller") {
      let cb = 0;
      for (const [listId, n] of callbacksByList) {
        const assigned = listOwner.get(listId);
        if (assigned === p.id || (assigned === null && callers.length > 0)) cb += n;
      }
      const f = followupsBy.get(p.id) ?? 0;
      if (cb) lines.push(`${cb} ponovnih klicev danes`);
      if (f) lines.push(`${f} klicev nazaj (ni bilo doma)`);
      url = cb ? "/leads" : "/follow-ups";
    }
    if (lines.length) {
      sent += await notifyUsers([p.id], { title: "Dobro jutro – danes", body: lines.join(" · "), url, tag: "daily" });
    }
  }
  return NextResponse.json({ ok: true, users: people?.length ?? 0, notificationsSent: sent });
}
