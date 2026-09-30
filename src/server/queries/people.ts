import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/types/domain";

/** All team members visible to the user (small table), cached per request. */
export const getPeople = cache(async (): Promise<Map<string, Profile>> => {
  const supabase = await createClient();
  const { data } = await supabase.from("profiles").select("*").order("first_name");
  return new Map(((data ?? []) as Profile[]).map((p) => [p.id, p]));
});

export async function getAgents(opts: { includeInactive?: boolean } = {}): Promise<Profile[]> {
  const people = await getPeople();
  return [...people.values()].filter((p) => (p.role === "agent" || p.role === "owner") && (opts.includeInactive || p.is_active));
}

export async function getCallers(opts: { includeInactive?: boolean } = {}): Promise<Profile[]> {
  const people = await getPeople();
  return [...people.values()].filter((p) => p.role === "caller" && (opts.includeInactive || p.is_active));
}

export function nameOf(people: Map<string, Profile>, id: string | null | undefined): string {
  if (!id) return "–";
  const p = people.get(id);
  return p ? `${p.first_name} ${p.last_name}` : "–";
}

export type PersonOption = { id: string; name: string };
export const toOptions = (list: Profile[]): PersonOption[] => list.map((p) => ({ id: p.id, name: `${p.first_name} ${p.last_name}` }));

export interface CommissionRates {
  /** agent id → current rate % ("10.00") */
  agents: Record<string, string>;
  /** caller id → current multiplier ("1.5") */
  callers: Record<string, string>;
  /** agent id → product id → current multiplier ("12") for "premija × število" products */
  agentProducts: Record<string, Record<string, string>>;
}

/**
 * Current commission settings the user may see (RLS: owner sees all, an agent
 * only their own rate, a caller only their own multiplier). Used for display
 * and previews only — authoritative values are read server-side when saving.
 */
export async function getVisibleCommissionRates(): Promise<CommissionRates> {
  const supabase = await createClient();
  const [agents, callers, productMults] = await Promise.all([
    getVisibleAgentRates(),
    supabase
      .from("caller_commission_rates")
      .select("caller_id, multiplier, effective_from, created_at")
      .order("effective_from", { ascending: false })
      .order("created_at", { ascending: false }),
    supabase
      .from("agent_product_multipliers")
      .select("agent_id, product_id, multiplier, effective_from, created_at")
      .order("effective_from", { ascending: false })
      .order("created_at", { ascending: false }),
  ]);
  const callerMap: Record<string, string> = {};
  for (const r of callers.data ?? []) if (!(r.caller_id in callerMap)) callerMap[r.caller_id] = String(Number(r.multiplier));
  const agentProducts: Record<string, Record<string, string>> = {};
  for (const r of productMults.data ?? []) {
    const m = (agentProducts[r.agent_id] ??= {});
    if (!(r.product_id in m)) m[r.product_id] = String(Number(r.multiplier));
  }
  return { agents, callers: callerMap, agentProducts };
}

async function getVisibleAgentRates(): Promise<Record<string, string>> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("agent_commission_rates")
    .select("agent_id, rate_percent, effective_from, created_at")
    .order("effective_from", { ascending: false })
    .order("created_at", { ascending: false });
  const out: Record<string, string> = {};
  for (const r of data ?? []) if (!(r.agent_id in out)) out[r.agent_id] = Number(r.rate_percent).toFixed(2);
  return out;
}
