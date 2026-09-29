import { Badge } from "@/components/ui/badge";
import {
  APPOINTMENT_STATUS_LABELS,
  CUSTOMER_STATUS_LABELS,
  FOLLOWUP_STATUS_LABELS,
  INSTALLMENT_STATUS_LABELS,
  RESULT_LABELS,
} from "@/lib/labels";
import type { AppointmentStatus, ConsultationResult, CustomerStatus, DisplayInstallmentStatus, FollowupStatus } from "@/types/domain";

export function ResultBadge({ result, withLabel = true }: { result: ConsultationResult | null; withLabel?: boolean }) {
  if (!result) return null;
  const r = RESULT_LABELS[result];
  return (
    <Badge tone={r.tone} title={r.label}>
      <span className="font-semibold">{r.short}</span>
      {withLabel && <span className="font-normal">· {r.label}</span>}
    </Badge>
  );
}

export function CustomerStatusBadge({ status }: { status: CustomerStatus }) {
  const s = CUSTOMER_STATUS_LABELS[status];
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

export function AppointmentStatusBadge({ status, result }: { status: AppointmentStatus; result: ConsultationResult | null }) {
  if (status === "completed" && result) return <ResultBadge result={result} />;
  const s = APPOINTMENT_STATUS_LABELS[status];
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

export function FollowupStatusBadge({ status }: { status: FollowupStatus }) {
  const s = FOLLOWUP_STATUS_LABELS[status];
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

export function InstallmentStatusBadge({ status }: { status: DisplayInstallmentStatus }) {
  const s = INSTALLMENT_STATUS_LABELS[status];
  return <Badge tone={s.tone}>{s.label}</Badge>;
}
