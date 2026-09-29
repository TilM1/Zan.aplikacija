import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Commission, Installment, Policy } from "@/types/domain";

export type LedgerRow = Installment & {
  commission: Pick<Commission, "total_amount" | "rate_percent" | "caller_multiplier" | "base_monthly_premium" | "base_duration_years" | "calculation" | "rule_version">;
  policy: Pick<Policy, "id" | "product_name" | "policy_date" | "policy_number" | "customer_id"> & {
    customer: { id: string; first_name: string; last_name: string };
  };
};

const LEDGER_SELECT =
  "*, commission:commissions!inner(total_amount, rate_percent, caller_multiplier, base_monthly_premium, base_duration_years, calculation, rule_version), policy:policies!inner(id, product_name, policy_date, policy_number, customer_id, customer:customers!inner(id, first_name, last_name))";

export interface LedgerFilters {
  status?: "due" | "upcoming" | "unpaid" | "paid" | "cancelled" | "all";
  beneficiary?: string;
  type?: "agent" | "caller";
  from?: string; // due_date >=
  to?: string; // due_date <=
  today: string;
  page: number;
  pageSize: number;
}

/** Installments visible to the user (RLS: own rows, or all for owner). */
export async function listLedger(f: LedgerFilters) {
  const supabase = await createClient();
  let q = supabase.from("commission_installments").select(LEDGER_SELECT, { count: "exact" });
  switch (f.status) {
    case "due":
      q = q.eq("status", "scheduled").lte("due_date", f.today);
      break;
    case "upcoming":
      q = q.eq("status", "scheduled").gt("due_date", f.today);
      break;
    case "unpaid":
      q = q.eq("status", "scheduled");
      break;
    case "paid":
    case "cancelled":
      q = q.eq("status", f.status);
      break;
  }
  if (f.beneficiary) q = q.eq("beneficiary_id", f.beneficiary);
  if (f.type) q = q.eq("beneficiary_type", f.type);
  if (f.from) q = q.gte("due_date", f.from);
  if (f.to) q = q.lte("due_date", f.to);
  q = q
    .order(f.status === "paid" ? "paid_at" : "due_date", { ascending: f.status !== "paid" })
    .order("installment_number")
    .range((f.page - 1) * f.pageSize, f.page * f.pageSize - 1);
  const { data, count, error } = await q;
  if (error) throw error;
  return { rows: (data ?? []) as LedgerRow[], total: count ?? 0 };
}

export type InstallmentLite = Pick<Installment, "id" | "beneficiary_id" | "beneficiary_type" | "amount" | "due_date" | "status" | "installment_number" | "paid_at">;

/**
 * Lightweight rows for aggregation (summaries by month / employee).
 * Pages through results so totals stay correct as the ledger grows.
 */
export async function getInstallmentsForSummary(opts: { beneficiary?: string; statuses?: string[]; fromDue?: string; toDue?: string }) {
  const supabase = await createClient();
  const out: InstallmentLite[] = [];
  const PAGE = 1000;
  for (let offset = 0; ; offset += PAGE) {
    let q = supabase
      .from("commission_installments")
      .select("id, beneficiary_id, beneficiary_type, amount, due_date, status, installment_number, paid_at")
      .order("due_date")
      .order("id")
      .range(offset, offset + PAGE - 1);
    if (opts.beneficiary) q = q.eq("beneficiary_id", opts.beneficiary);
    if (opts.statuses) q = q.in("status", opts.statuses);
    if (opts.fromDue) q = q.gte("due_date", opts.fromDue);
    if (opts.toDue) q = q.lte("due_date", opts.toDue);
    const { data, error } = await q;
    if (error) throw error;
    out.push(...((data ?? []) as InstallmentLite[]));
    if (!data || data.length < PAGE) break;
  }
  return out;
}
