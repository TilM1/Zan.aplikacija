/** Payroll display helpers (pure). */
import type { DisplayInstallmentStatus, Installment } from "@/types/domain";

/** "due" is derived: a scheduled installment whose due date has arrived. */
export function displayStatus(i: Pick<Installment, "status" | "due_date">, today: string): DisplayInstallmentStatus {
  if (i.status === "scheduled" && i.due_date <= today) return "due";
  return i.status;
}
