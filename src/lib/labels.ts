/**
 * Display labels and badge tones. Internal codes (A, A0, A1, B, …) stay in the
 * database; the UI always shows these labels.
 */
import type {
  AppointmentStatus,
  ConsultationResult,
  CustomerStatus,
  DisplayInstallmentStatus,
  FollowupStatus,
  Role,
} from "@/types/domain";

export type Tone = "neutral" | "info" | "success" | "warning" | "danger" | "accent";

export const ROLE_LABELS: Record<Role, string> = {
  owner: "Lastnik",
  agent: "Zastopnik",
  caller: "Klicatelj",
};

export const RESULT_LABELS: Record<ConsultationResult, { short: string; label: string; tone: Tone }> = {
  A: { short: "A", label: "Nov termin potreben", tone: "info" },
  A0: { short: "A0", label: "Neuspešno", tone: "danger" },
  A1: { short: "A1", label: "Uspešno – polica", tone: "success" },
  B: { short: "B", label: "Stranke ni bilo doma", tone: "warning" },
};

export const RESULT_DESCRIPTIONS: Record<ConsultationResult, string> = {
  A: "Svetovanje opravljeno – potreben je nov termin.",
  A0: "Svetovanje opravljeno – neuspešno.",
  A1: "Svetovanje opravljeno – sklenjena nova polica.",
  B: "Stranke ni bilo doma – vrne se klicatelju za ponoven klic.",
};

export const CUSTOMER_STATUS_LABELS: Record<CustomerStatus, { label: string; tone: Tone }> = {
  scheduled: { label: "Termin dogovorjen", tone: "info" },
  callback: { label: "Ponoven klic", tone: "warning" },
  won: { label: "Stranka (polica)", tone: "success" },
  lost: { label: "Neuspešno", tone: "danger" },
  closed: { label: "Brez termina", tone: "neutral" },
};

export const APPOINTMENT_STATUS_LABELS: Record<AppointmentStatus, { label: string; tone: Tone }> = {
  scheduled: { label: "Odprt", tone: "info" },
  completed: { label: "Opravljen", tone: "neutral" },
  cancelled: { label: "Preklican", tone: "neutral" },
};

export const FOLLOWUP_STATUS_LABELS: Record<FollowupStatus, { label: string; tone: Tone }> = {
  open: { label: "Za klic", tone: "warning" },
  rescheduled: { label: "Nov termin", tone: "success" },
  closed: { label: "Zaprto", tone: "neutral" },
};

export const INSTALLMENT_STATUS_LABELS: Record<DisplayInstallmentStatus, { label: string; tone: Tone }> = {
  scheduled: { label: "Načrtovano", tone: "neutral" },
  due: { label: "Zapadlo", tone: "warning" },
  paid: { label: "Izplačano", tone: "success" },
  cancelled: { label: "Preklicano", tone: "danger" },
};

export const ACTIVITY_LABELS: Record<string, string> = {
  customer_created: "Stranka ustvarjena",
  customer_updated: "Podatki stranke spremenjeni",
  customer_archived: "Stranka arhivirana",
  customer_restored: "Stranka obnovljena",
  appointment_created: "Termin dogovorjen",
  appointment_reassigned: "Termin prerazporejen",
  appointment_rescheduled: "Termin prestavljen",
  appointment_cancelled: "Termin preklican",
  consultation_completed: "Svetovanje zaključeno",
  status_changed: "Status spremenjen",
  followup_created: "Vrnjeno klicatelju (ponoven klic)",
  followup_resolved: "Klic nazaj rešen – nov termin",
  followup_closed: "Klic nazaj zaprt",
  policy_created: "Polica sklenjena",
  commission_generated: "Provizija obračunana",
  payout_marked_paid: "Izplačilo označeno kot plačano",
  document_uploaded: "Dokument naložen",
  document_removed: "Dokument odstranjen",
  note_added: "Opomba",
  employee_created: "Zaposleni dodan",
  employee_updated: "Zaposleni posodobljen",
  agent_rate_changed: "Odstotek provizije spremenjen",
  caller_multiplier_changed: "Provizija klicatelja spremenjena",
  product_saved: "Produkt shranjen",
};

export const BENEFICIARY_LABELS = { agent: "Zastopnik", caller: "Klicatelj" } as const;
