import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatDate, formatTime, formatWeekday } from "@/lib/dates";
import { notifyUsers } from "@/server/notify";

/** Notify the agent of an appointment (unless they created/changed it themselves). */
export async function notifyAppointmentAgent(appointmentId: string | null | undefined, actorId: string, kind: "new" | "changed" = "new") {
  if (!appointmentId) return;
  const { data: a } = await createAdminClient()
    .from("appointments")
    .select("agent_id, scheduled_at, location, customer:customers(id, first_name, last_name, city)")
    .eq("id", appointmentId)
    .maybeSingle();
  if (!a || a.agent_id === actorId) return;
  const c = a.customer as unknown as { id: string; first_name: string; last_name: string; city: string | null };
  await notifyUsers([a.agent_id], {
    title: kind === "new" ? "Nov termin" : "Termin spremenjen",
    body: `${c.first_name} ${c.last_name} · ${formatWeekday(a.scheduled_at)} ${formatDate(a.scheduled_at)} ob ${formatTime(a.scheduled_at)}${c.city ? ` · ${c.city}` : ""}`,
    url: `/customers/${c.id}`,
    tag: `appt-${appointmentId}`,
  });
}

/** Notify the caller that a customer was not home (B) and needs a new call. */
export async function notifyFollowupCaller(followupId: string | null | undefined) {
  if (!followupId) return;
  const { data: f } = await createAdminClient()
    .from("caller_followups")
    .select("caller_id, customer:customers(first_name, last_name)")
    .eq("id", followupId)
    .maybeSingle();
  if (!f?.caller_id) return;
  const c = f.customer as unknown as { first_name: string; last_name: string };
  await notifyUsers([f.caller_id], {
    title: "Klic nazaj",
    body: `${c.first_name} ${c.last_name} ni bil/a doma – dogovorite nov termin.`,
    url: "/follow-ups",
    tag: `followup-${followupId}`,
  });
}
