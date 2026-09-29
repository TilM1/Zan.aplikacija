import "server-only";
import { createClient } from "@/lib/supabase/server";
import { parseSort } from "@/lib/url";

export const APPOINTMENT_SORTS = ["scheduled_at", "visit_number", "status", "result", "agent_id", "caller_id", "location", "created_at"] as const;
import type { AppointmentWithRelations, Profile } from "@/types/domain";

export const APPOINTMENT_SELECT =
  "*, customer:customers!inner(id, first_name, last_name, phone, email, address, postal_code, city, status, search_text)";

export type AgentScope = { kind: "me" } | { kind: "all" } | { kind: "agent"; id: string };

/** Resolve ?agent= for pipeline/calendar. Only the owner may look beyond themselves. */
export function resolveAgentScope(profile: Profile, param: string | undefined): AgentScope {
  if (profile.role !== "owner") return { kind: "me" };
  if (!param || param === "me") return { kind: "me" };
  if (param === "all") return { kind: "all" };
  return /^[0-9a-f-]{36}$/.test(param) ? { kind: "agent", id: param } : { kind: "me" };
}

function scopeAgentId(profile: Profile, scope: AgentScope): string | null {
  if (scope.kind === "me") return profile.id;
  if (scope.kind === "agent") return scope.id;
  return null;
}

/** Kanban data: all open appointments + results within the last `days` days. */
export async function getPipeline(profile: Profile, scope: AgentScope, days = 30) {
  const supabase = await createClient();
  const agentId = scopeAgentId(profile, scope);
  const since = new Date(Date.now() - days * 86400_000).toISOString();

  let open = supabase.from("appointments").select(APPOINTMENT_SELECT).eq("status", "scheduled").order("scheduled_at").limit(500);
  let done = supabase
    .from("appointments")
    .select(APPOINTMENT_SELECT)
    .eq("status", "completed")
    .gte("completed_at", since)
    .order("completed_at", { ascending: false })
    .limit(500);
  if (agentId) {
    open = open.eq("agent_id", agentId);
    done = done.eq("agent_id", agentId);
  }
  const [o, d] = await Promise.all([open, done]);
  if (o.error) throw o.error;
  if (d.error) throw d.error;
  return [...(o.data ?? []), ...(d.data ?? [])] as AppointmentWithRelations[];
}

export interface AppointmentFilters {
  q?: string;
  status?: string; // scheduled | completed | cancelled | pending (open & past)
  result?: string;
  agent?: string;
  caller?: string;
  from?: string; // ISO instant
  to?: string;
  sort?: string; // scheduled_at | -scheduled_at | visit_number
  page: number;
  pageSize: number;
  /** Restrict to appointments this caller booked. */
  callerScope?: string;
  agentScope?: string | null;
}

export async function listAppointments(f: AppointmentFilters) {
  const supabase = await createClient();
  let q = supabase.from("appointments").select(APPOINTMENT_SELECT, { count: "exact" });

  if (f.q) q = q.ilike("customer.search_text", `%${f.q.toLowerCase().replace(/[%_]/g, "")}%`);
  if (f.status === "pending") q = q.eq("status", "scheduled").lte("scheduled_at", new Date().toISOString());
  else if (f.status === "upcoming") q = q.eq("status", "scheduled").gt("scheduled_at", new Date().toISOString());
  else if (f.status) q = q.eq("status", f.status);
  if (f.result) q = q.eq("result", f.result);
  if (f.agent) q = q.eq("agent_id", f.agent);
  if (f.caller) q = q.eq("caller_id", f.caller);
  if (f.callerScope) q = q.eq("caller_id", f.callerScope);
  if (f.agentScope) q = q.eq("agent_id", f.agentScope);
  if (f.from) q = q.gte("scheduled_at", f.from);
  if (f.to) q = q.lt("scheduled_at", f.to);

  const s = parseSort(f.sort, APPOINTMENT_SORTS, "-scheduled_at");
  q = q.order(s.column, { ascending: s.ascending, nullsFirst: false }).order("scheduled_at", { ascending: false }).range((f.page - 1) * f.pageSize, f.page * f.pageSize - 1);

  const { data, count, error } = await q;
  if (error) throw error;
  return { rows: (data ?? []) as AppointmentWithRelations[], total: count ?? 0 };
}

export async function getAppointmentsInRange(fromIso: string, toIso: string, agentId: string | null, limit = 1000) {
  const supabase = await createClient();
  let q = supabase
    .from("appointments")
    .select(APPOINTMENT_SELECT)
    .gte("scheduled_at", fromIso)
    .lt("scheduled_at", toIso)
    .neq("status", "cancelled")
    .order("scheduled_at")
    .limit(limit);
  if (agentId) q = q.eq("agent_id", agentId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as AppointmentWithRelations[];
}
