import "server-only";
import { createClient } from "@/lib/supabase/server";
import { addDays, todayIso } from "@/lib/dates";
import { parseSort } from "@/lib/url";
import type { CustomerExpiry } from "@/types/domain";

export const EXPIRY_SORTS = ["expiry_date", "category", "status", "created_at", "handled_at"] as const;
export type ExpiryView = "due" | "upcoming" | "done" | "all";

export type ExpiryRow = CustomerExpiry & { customer: { id: string; first_name: string; last_name: string; phone: string; city: string | null } };

export async function getExpiryReminderDays(): Promise<number> {
  const supabase = await createClient();
  const { data } = await supabase.from("app_settings").select("value").eq("key", "expiry_reminder_days").maybeSingle();
  return Number(data?.value ?? 14);
}

/** Due = open, expiring within the reminder window (or already expired), not snoozed. */
export async function listExpiries(f: { view: ExpiryView; agentId?: string | null; category?: string; q?: string; sort?: string; page: number; pageSize: number }) {
  const supabase = await createClient();
  const today = todayIso();
  const days = await getExpiryReminderDays();
  let q = supabase.from("customer_expiries").select("*, customer:customers!inner(id, first_name, last_name, phone, city, search_text)", { count: "exact" });
  if (f.view === "due") q = q.eq("status", "open").lte("expiry_date", addDays(today, days)).or(`snoozed_until.is.null,snoozed_until.lte.${today}`);
  if (f.view === "upcoming") q = q.eq("status", "open").or(`expiry_date.gt.${addDays(today, days)},snoozed_until.gt.${today}`);
  if (f.view === "done") q = q.neq("status", "open");
  if (f.agentId) q = q.eq("assigned_agent_id", f.agentId);
  if (f.category) q = q.eq("category", f.category);
  if (f.q) q = q.ilike("customer.search_text", `%${f.q.toLowerCase().replace(/[%_,()]/g, "")}%`);
  const s = parseSort(f.sort, EXPIRY_SORTS, f.view === "done" ? "-handled_at" : "expiry_date");
  q = q.order(s.column, { ascending: s.ascending, nullsFirst: false }).range((f.page - 1) * f.pageSize, f.page * f.pageSize - 1);
  const { data, count, error } = await q;
  if (error) throw error;
  return { rows: (data ?? []) as unknown as ExpiryRow[], total: count ?? 0, sort: s.sort, days };
}

export async function countDueExpiries(agentId: string): Promise<number> {
  const supabase = await createClient();
  const today = todayIso();
  const days = await getExpiryReminderDays();
  const { count } = await supabase
    .from("customer_expiries")
    .select("id", { count: "exact", head: true })
    .eq("assigned_agent_id", agentId)
    .eq("status", "open")
    .lte("expiry_date", addDays(today, days))
    .or(`snoozed_until.is.null,snoozed_until.lte.${today}`);
  return count ?? 0;
}

export async function getCustomerExpiries(customerId: string) {
  const supabase = await createClient();
  const { data } = await supabase.from("customer_expiries").select("*").eq("customer_id", customerId).order("expiry_date");
  return (data ?? []) as CustomerExpiry[];
}
