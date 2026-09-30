import "server-only";
import { createClient } from "@/lib/supabase/server";
import { parseSort } from "@/lib/url";
import type { Lead, LeadEvent, LeadList, LeadStatus } from "@/types/domain";

export const LEAD_SORTS = ["row_number", "name", "city", "postal_code", "activity", "status", "next_call_at", "last_contacted_at", "contact_count"] as const;

/** "due" = to call now: new, or callback/rejected whose recall date has arrived. */
export type LeadView = "due" | "all" | LeadStatus | "scheduled";

export interface LeadFilters {
  view: LeadView;
  list?: string;
  q?: string;
  city?: string;
  postal?: string;
  activity?: string;
  sort?: string;
  page: number;
  pageSize: number;
}

export const LEAD_LIST_COLUMNS =
  "id, list_id, row_number, name, phone, phone_normalized, street, postal_code, city, activity, tax_number, email, status, next_call_at, last_contacted_at, last_contacted_by, contact_count, last_comment, customer_id, existing_customer_id, created_at";

export async function listLeads(f: LeadFilters) {
  const supabase = await createClient();
  let q = supabase.from("leads").select(LEAD_LIST_COLUMNS, { count: "exact" });
  const nowIso = new Date().toISOString();
  switch (f.view) {
    case "due":
      q = q.or(`status.eq.new,and(status.in.(callback,rejected),next_call_at.lte.${nowIso})`);
      break;
    case "scheduled": // callbacks/rejections waiting for a later date
      q = q.in("status", ["callback", "rejected"]).gt("next_call_at", nowIso);
      break;
    case "all":
      break;
    default:
      q = q.eq("status", f.view);
  }
  if (f.list) q = q.eq("list_id", f.list);
  if (f.city) q = q.ilike("city", f.city.replace(/[%_]/g, ""));
  if (f.postal) q = q.eq("postal_code", f.postal.trim());
  if (f.activity) q = q.ilike("activity", `%${f.activity.replace(/[%_,()]/g, "")}%`);
  if (f.q) {
    const term = f.q.toLowerCase().replace(/[%_,()]/g, "").trim();
    const digits = term.replace(/[\s/().-]/g, "");
    q = /^\+?\d{4,}$/.test(digits)
      ? q.ilike("phone_normalized", `%${digits.replace(/^(\+386|00386|0)/, "")}%`)
      : q.ilike("search_text", `%${term}%`);
  }
  const s = parseSort(f.sort, LEAD_SORTS, f.view === "due" ? "row_number" : "-last_contacted_at");
  q = q.order(s.column, { ascending: s.ascending, nullsFirst: false }).order("row_number").range((f.page - 1) * f.pageSize, f.page * f.pageSize - 1);
  const { data, count, error } = await q;
  if (error) throw error;
  return { rows: (data ?? []) as unknown as Lead[], total: count ?? 0, sort: s.sort };
}

export async function getLeadLists(opts: { includeInactive?: boolean } = {}) {
  const supabase = await createClient();
  let q = supabase.from("lead_lists").select("*").order("created_at", { ascending: false });
  if (!opts.includeInactive) q = q.eq("status", "ready");
  const { data } = await q;
  return (data ?? []) as LeadList[];
}

export interface ListStats {
  total: number;
  due: number;
  byStatus: Partial<Record<LeadStatus, number>>;
}

export async function getLeadListStats(): Promise<Record<string, ListStats>> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("lead_list_stats");
  const out: Record<string, ListStats> = {};
  for (const r of (data ?? []) as { list_id: string; status: LeadStatus; due: boolean; n: number }[]) {
    const s = (out[r.list_id] ??= { total: 0, due: 0, byStatus: {} });
    const n = Number(r.n);
    s.total += n;
    if (r.due) s.due += n;
    s.byStatus[r.status] = (s.byStatus[r.status] ?? 0) + n;
  }
  return out;
}

export async function getCityFacets(listId?: string) {
  const supabase = await createClient();
  const { data } = await supabase.rpc("lead_city_facets", { p_list_id: listId ?? null });
  return ((data ?? []) as { city: string; n: number }[]).map((r) => ({ city: r.city, n: Number(r.n) }));
}

export async function getLeadWithHistory(id: string) {
  const supabase = await createClient();
  const [{ data: lead }, { data: events }] = await Promise.all([
    supabase.from("leads").select("*, list:lead_lists(name)").eq("id", id).maybeSingle(),
    supabase.from("lead_events").select("*").eq("lead_id", id).order("created_at", { ascending: false }).limit(100),
  ]);
  if (!lead) return null;
  return { lead: lead as Lead & { list: { name: string } | null }, events: (events ?? []) as LeadEvent[] };
}

export async function getRecallMonths(): Promise<number> {
  const supabase = await createClient();
  const { data } = await supabase.from("app_settings").select("value").eq("key", "lead_rejected_recall_months").maybeSingle();
  return Number(data?.value ?? 6);
}

export async function countDueLeads(): Promise<number> {
  const supabase = await createClient();
  const { count } = await supabase
    .from("leads")
    .select("id", { count: "exact", head: true })
    .or(`status.eq.new,and(status.in.(callback,rejected),next_call_at.lte.${new Date().toISOString()})`);
  return count ?? 0;
}
