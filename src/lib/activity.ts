/** Turns activity_log rows into readable timeline entries (pure, testable). */
import { ACTIVITY_LABELS, RESULT_LABELS } from "@/lib/labels";
import { formatDate, formatDateTime } from "@/lib/dates";
import { formatDecimalEur } from "@/lib/money";
import type { ActivityRow, ConsultationResult } from "@/types/domain";

export type TimelineKind = "create" | "appointment" | "result" | "followup" | "policy" | "money" | "document" | "note" | "change";

export interface TimelineEntry {
  id: number;
  at: string;
  kind: TimelineKind;
  title: string;
  detail?: string;
  result?: ConsultationResult;
  actor: string;
}

const FIELD_LABELS: Record<string, string> = {
  first_name: "ime", last_name: "priimek", phone: "telefon", email: "e-pošta", address: "naslov", postal_code: "pošta", city: "kraj",
};

export function describeActivity(row: ActivityRow, nameOf: (id: string | null | undefined) => string): TimelineEntry {
  const n = (row.new_value ?? {}) as Record<string, unknown>;
  const o = (row.old_value ?? {}) as Record<string, unknown>;
  const m = (row.metadata ?? {}) as Record<string, unknown>;
  const base = { id: row.id, at: row.created_at, actor: nameOf(row.actor_id), title: ACTIVITY_LABELS[row.action] ?? row.action };
  const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));

  switch (row.action) {
    case "customer_created":
      return { ...base, kind: "create", detail: n.responsible_caller_id ? `Odgovorni klicatelj: ${nameOf(str(n.responsible_caller_id))}` : undefined };
    case "appointment_created": {
      const src = m.source === "result_A" ? " (po rezultatu A)" : m.source === "followup" ? " (po klicu nazaj)" : "";
      return {
        ...base,
        kind: "appointment",
        title: `${Number(n.visit_number) > 1 ? `${n.visit_number}. obisk` : "Termin"} dogovorjen${src}`,
        detail: `${formatDateTime(str(n.scheduled_at))} · zastopnik ${nameOf(str(n.agent_id))}${n.caller_id ? ` · klicatelj ${nameOf(str(n.caller_id))}` : ""}`,
      };
    }
    case "appointment_reassigned":
      return { ...base, kind: "appointment", detail: `${nameOf(str(o.agent_id))} → ${nameOf(str(n.agent_id))}` };
    case "appointment_rescheduled":
      return { ...base, kind: "appointment", detail: `${formatDateTime(str(o.scheduled_at))} → ${formatDateTime(str(n.scheduled_at))}` };
    case "appointment_cancelled":
      return { ...base, kind: "appointment", detail: str(n.reason) };
    case "consultation_completed": {
      const r = n.result as ConsultationResult;
      return {
        ...base,
        kind: "result",
        result: r,
        title: `Svetovanje z ${nameOf(str(m.agent_id))} – ${r} · ${RESULT_LABELS[r]?.label ?? ""}`,
        detail: str(n.note) || undefined,
      };
    }
    case "followup_created":
      return { ...base, kind: "followup", title: `Vrnjeno klicatelju ${nameOf(str(n.caller_id))} za ponoven klic` };
    case "followup_closed":
      return { ...base, kind: "followup", detail: str(n.note) || undefined };
    case "followup_resolved":
      return { ...base, kind: "followup" };
    case "policy_created":
      return {
        ...base,
        kind: "policy",
        title: `Polica sklenjena – ${str(n.product)}`,
        detail: `${formatDecimalEur(n.monthly_premium as string)}/mesec · ${n.duration_years} let · datum ${formatDate(str(n.policy_date))} · zastopnik ${nameOf(str(n.agent_id))}`,
      };
    case "commission_generated":
      return { ...base, kind: "money", title: `Provizija obračunana (${n.beneficiary_type === "agent" ? "zastopnik" : "klicatelj"} ${nameOf(str(n.beneficiary_id))})`, detail: formatDecimalEur(n.total_amount as string) };
    case "payout_marked_paid":
      return { ...base, kind: "money", detail: `${formatDecimalEur(n.amount as string)} · ${nameOf(str(m.beneficiary_id))} · ${m.installment_number}. obrok` };
    case "document_uploaded":
    case "document_removed":
      return { ...base, kind: "document", detail: str(n.file_name) };
    case "note_added":
      return { ...base, kind: "note", detail: str(n.note) };
    case "customer_updated":
      return {
        ...base,
        kind: "change",
        detail: Object.keys(n)
          .map((k) => `${FIELD_LABELS[k] ?? k}: ${str(o[k]) || "–"} → ${str(n[k]) || "–"}`)
          .join(" · "),
      };
    case "policy_cancelled":
      return { ...base, kind: "policy", title: `Polica stornirana – ${str(m.product)}`, detail: str(n.reason) || undefined };
    case "policy_storno_reverted":
      return { ...base, kind: "policy" };
    case "commission_reversed":
      return { ...base, kind: "money", detail: `preklicano ${formatDecimalEur(n.cancelled_sum as string)} · odbitek ${formatDecimalEur(n.clawback_sum as string)} (${formatDate(str(n.clawback_due))})` };
    case "status_changed":
      return { ...base, kind: "change" };
    default:
      return { ...base, kind: "change" };
  }
}
