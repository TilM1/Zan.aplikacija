import "server-only";
import { addDays, dayBoundsIso, monthStart, addMonthsToMonthStart, todayIso } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";
import { sumDecimals } from "@/lib/money";
import type { ConsultationResult } from "@/types/domain";

/**
 * Dashboard/report metrics. Each function is independent so widgets can be
 * added, removed or rearranged without touching business logic.
 * `scope` narrows to one agent/caller; omitted = everything the user may see (RLS).
 */
export type MetricScope = { agentId?: string; callerId?: string };

export function currentMonthRange(today = todayIso()) {
  const from = monthStart(today);
  const toExclusive = addMonthsToMonthStart(today, 1);
  return { from, to: addDays(toExclusive, -1), toExclusive };
}

export async function countAppointmentsOnDay(date: string, scope: MetricScope = {}) {
  const supabase = await createClient();
  const { start, end } = dayBoundsIso(date);
  let q = supabase.from("appointments").select("id", { count: "exact", head: true }).gte("scheduled_at", start).lt("scheduled_at", end).neq("status", "cancelled");
  if (scope.agentId) q = q.eq("agent_id", scope.agentId);
  if (scope.callerId) q = q.eq("caller_id", scope.callerId);
  const { count } = await q;
  return count ?? 0;
}

export async function countPendingResults(scope: MetricScope = {}) {
  const supabase = await createClient();
  let q = supabase.from("appointments").select("id", { count: "exact", head: true }).eq("status", "scheduled").lte("scheduled_at", new Date().toISOString());
  if (scope.agentId) q = q.eq("agent_id", scope.agentId);
  if (scope.callerId) q = q.eq("caller_id", scope.callerId);
  const { count } = await q;
  return count ?? 0;
}

/** Results of consultations completed in [fromDate, toDateExclusive). */
export async function resultBreakdown(fromDate: string, toDateExclusive: string, scope: MetricScope = {}) {
  const supabase = await createClient();
  let q = supabase
    .from("appointments")
    .select("result, agent_id, caller_id")
    .eq("status", "completed")
    .gte("completed_at", dayBoundsIso(fromDate).start)
    .lt("completed_at", dayBoundsIso(toDateExclusive).start)
    .limit(10000);
  if (scope.agentId) q = q.eq("agent_id", scope.agentId);
  if (scope.callerId) q = q.eq("caller_id", scope.callerId);
  const { data } = await q;
  const counts: Record<ConsultationResult, number> = { A: 0, A0: 0, A1: 0, B: 0 };
  for (const r of data ?? []) counts[r.result as ConsultationResult]++;
  const total = counts.A + counts.A0 + counts.A1 + counts.B;
  return { counts, total, rows: (data ?? []) as { result: ConsultationResult; agent_id: string; caller_id: string | null }[] };
}

export interface PolicyAgg {
  count: number;
  premiumCents: number;
}

/** Policies with policy_date in [from, to] (inclusive), grouped by agent and caller. */
export async function policyProduction(from: string, to: string, scope: MetricScope = {}) {
  const supabase = await createClient();
  let q = supabase
    .from("policies")
    .select("agent_id, caller_id, monthly_premium, product_name, policy_date")
    .eq("status", "active")
    .gte("policy_date", from)
    .lte("policy_date", to)
    .limit(10000);
  if (scope.agentId) q = q.eq("agent_id", scope.agentId);
  if (scope.callerId) q = q.eq("caller_id", scope.callerId);
  const { data } = await q;
  const rows = (data ?? []) as { agent_id: string; caller_id: string | null; monthly_premium: string | number; product_name: string; policy_date: string }[];
  const byAgent = new Map<string, PolicyAgg>();
  const byCaller = new Map<string, PolicyAgg>();
  const byProduct = new Map<string, PolicyAgg>();
  const byMonth = new Map<string, PolicyAgg>();
  const add = (m: Map<string, PolicyAgg>, key: string, premium: number) => {
    const cur = m.get(key) ?? { count: 0, premiumCents: 0 };
    cur.count++;
    cur.premiumCents += premium;
    m.set(key, cur);
  };
  for (const r of rows) {
    const premium = sumDecimals([r.monthly_premium]);
    add(byAgent, r.agent_id, premium);
    if (r.caller_id) add(byCaller, r.caller_id, premium);
    add(byProduct, r.product_name, premium);
    add(byMonth, r.policy_date.slice(0, 7), premium);
  }
  return {
    count: rows.length,
    premiumCents: sumDecimals(rows.map((r) => r.monthly_premium)),
    byAgent,
    byCaller,
    byProduct,
    byMonth,
  };
}

/** Appointments booked (created) by callers in a period. */
export async function appointmentsBooked(from: string, toExclusive: string, scope: MetricScope = {}) {
  const supabase = await createClient();
  let q = supabase
    .from("appointments")
    .select("caller_id")
    .gte("created_at", dayBoundsIso(from).start)
    .lt("created_at", dayBoundsIso(toExclusive).start)
    .not("caller_id", "is", null)
    .limit(10000);
  if (scope.callerId) q = q.eq("caller_id", scope.callerId);
  const { data } = await q;
  const byCaller = new Map<string, number>();
  for (const r of data ?? []) byCaller.set(r.caller_id as string, (byCaller.get(r.caller_id as string) ?? 0) + 1);
  return { total: data?.length ?? 0, byCaller };
}

export async function openFollowupCount(callerId?: string) {
  const supabase = await createClient();
  let q = supabase.from("caller_followups").select("id", { count: "exact", head: true }).eq("status", "open");
  if (callerId) q = q.eq("caller_id", callerId);
  const { count } = await q;
  return count ?? 0;
}

export async function recentActivity(limit = 12) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("activity_log")
    .select("*, customer:customers(id, first_name, last_name)")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit);
  return (data ?? []) as (import("@/types/domain").ActivityRow & { customer: { id: string; first_name: string; last_name: string } | null })[];
}
