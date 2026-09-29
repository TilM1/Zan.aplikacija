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

/**
 * Latest commission rate per agent that the user may see
 * (RLS: owner sees all, agents only their own). Used for previews only —
 * the authoritative rate is read server-side when saving.
 */
export async function getVisibleAgentRates(): Promise<Record<string, string>> {
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
