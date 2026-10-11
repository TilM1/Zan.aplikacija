import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildInviteIcs } from "@/lib/calendar/ics";
import { formatDate, formatTime, formatWeekday } from "@/lib/dates";
import { formatPhone } from "@/lib/phone";
import { mailConfig, sendCalendarMail } from "@/server/mail";

const uidOf = (appointmentId: string, from: string) => `${appointmentId}@${from.split("@")[1] ?? "crm"}`;

/**
 * Keeps the agent's calendar invitation in step with an appointment:
 * new / moved → invitation (update), cancelled or handed to another agent →
 * cancellation to whoever got the last invitation. Call after every change.
 * Never throws: a mail problem must not break the booking.
 */
export async function syncAppointmentInvite(appointmentId: string | null | undefined) {
  const cfg = mailConfig();
  if (!appointmentId || !cfg) return;
  const admin = createAdminClient();
  try {
    const { data: a } = await admin
      .from("appointments")
      .select(
        "id, status, scheduled_at, duration_minutes, location, postal_code, note, visit_number, caller_id, invite_sent_to, customer:customers(id, first_name, last_name, phone, city), agent:profiles!appointments_agent_id_fkey(first_name, last_name, email, invite_enabled, invite_email, is_active)",
      )
      .eq("id", appointmentId)
      .maybeSingle();
    if (!a) return;
    const c = a.customer as unknown as { id: string; first_name: string; last_name: string; phone: string; city: string | null };
    const agent = a.agent as unknown as { first_name: string; last_name: string; email: string; invite_enabled: boolean; invite_email: string | null; is_active: boolean };
    const target = a.status === "scheduled" && agent.is_active && agent.invite_enabled ? (agent.invite_email || agent.email).toLowerCase() : null;
    const previous = (a.invite_sent_to as string | null)?.toLowerCase() ?? null;
    // Nothing to do for finished appointments or ones that never had an invitation
    if (a.status === "completed" || (!target && !previous)) return;
    if (target && !previous && new Date(a.scheduled_at).getTime() < Date.now() - 24 * 3600_000) return; // entered for the past

    let callerName = "";
    if (a.caller_id) {
      const { data: caller } = await admin.from("profiles").select("first_name, last_name").eq("id", a.caller_id).maybeSingle();
      if (caller) callerName = `${caller.first_name} ${caller.last_name}`;
    }
    const origin = process.env.APP_PUBLIC_HOST || process.env.VERCEL_PROJECT_PRODUCTION_URL;
    const name = `${c.first_name} ${c.last_name}`;
    const place = [a.location, [a.postal_code, c.city].filter(Boolean).join(" ")].filter(Boolean).join(", ");
    const when = `${formatWeekday(a.scheduled_at)}, ${formatDate(a.scheduled_at)} ob ${formatTime(a.scheduled_at)}`;
    const description = [
      `Stranka: ${name}`,
      `Telefon: ${formatPhone(c.phone)}`,
      place && `Naslov: ${place}`,
      a.visit_number > 1 && `Obisk št. ${a.visit_number}`,
      callerName && `Termin dogovoril/a: ${callerName}`,
      a.note && `Opomba: ${a.note}`,
      origin && `CRM: https://${origin.replace(/^https?:\/\//, "")}/customers/${c.id}`,
    ]
      .filter(Boolean)
      .join("\n");

    const send = async (to: string, method: "REQUEST" | "CANCEL", sequence: number) => {
      const start = new Date(a.scheduled_at);
      await sendCalendarMail({
        to,
        method,
        subject: method === "CANCEL" ? `Preklicano: termin ${name} (${when})` : `Termin: ${name} – ${when}`,
        text: method === "CANCEL" ? `Termin ni več v vašem urniku.\n\n${description}` : `${when}\n\n${description}\n\nTo sporočilo je vabilo za koledar – termin se doda v vaš koledar.`,
        ics: buildInviteIcs({
          uid: uidOf(a.id, cfg.from),
          sequence,
          method,
          start: start.toISOString(),
          end: new Date(start.getTime() + (a.duration_minutes ?? 60) * 60_000).toISOString(),
          summary: `Termin: ${name}${c.city ? ` (${c.city})` : ""}`,
          description,
          location: place,
          organizer: { name: cfg.fromName, email: cfg.from },
          attendee: { name: `${agent.first_name} ${agent.last_name}`, email: to },
          stamp: new Date().toISOString(),
        }),
      });
    };

    const mark = async (sentTo: string | null, error: string | null = null) => {
      const { data } = await admin.rpc("crm_mark_invite", { p_appointment_id: a.id, p_sent_to: sentTo, p_error: error });
      return Number(data ?? 1);
    };

    try {
      if (previous && previous !== target) await send(previous, "CANCEL", await mark(null));
      if (target) {
        // Reserve the number first, so an update always carries a higher SEQUENCE than the last message
        await send(target, "REQUEST", await mark(target));
      }
    } catch (e) {
      console.error("[invite] send failed", e);
      await mark(previous, String((e as Error).message ?? e).slice(0, 300));
    }
  } catch (e) {
    console.error("[invite] failed", e);
  }
}

/** Test invitation to one address (15-minute event tomorrow at 9:00 UTC+), so the user can check their mailbox. */
export async function sendTestInvite(to: string, attendeeName: string) {
  const cfg = mailConfig();
  if (!cfg) throw new Error("NOT_CONFIGURED");
  const start = new Date(Date.now() + 24 * 3600_000);
  start.setUTCMinutes(0, 0, 0);
  await sendCalendarMail({
    to,
    method: "REQUEST",
    subject: "Testno vabilo – CoreMark CRM",
    text: "To je testno vabilo iz CoreMark CRM. Če ga vidite kot dogodek v koledarju, vabila delujejo. Dogodek lahko izbrišete.",
    ics: buildInviteIcs({
      uid: `test-${start.getTime()}-${Math.round(start.getTime() / 7)}@${cfg.from.split("@")[1] ?? "crm"}`,
      sequence: 0,
      method: "REQUEST",
      start: start.toISOString(),
      end: new Date(start.getTime() + 15 * 60_000).toISOString(),
      summary: "Testno vabilo – CoreMark CRM",
      description: "Testno vabilo. Dogodek lahko izbrišete.",
      location: "",
      organizer: { name: cfg.fromName, email: cfg.from },
      attendee: { name: attendeeName, email: to },
      stamp: new Date().toISOString(),
    }),
  });
}
