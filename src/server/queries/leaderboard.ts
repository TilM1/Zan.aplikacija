import "server-only";
import { createClient } from "@/lib/supabase/server";
import { toCents } from "@/lib/money";

export interface LeaderRow {
  userId: string;
  name: string;
  policies: number;
  premiumCents: number;
  consultations: number;
  successful: number;
  booked: number;
  rank: number;
}

/**
 * Monthly ranking.
 * Agents: by monthly premium sold, then number of policies.
 * Callers: by policies from their appointments, then appointments booked.
 */
export async function getLeaderboard(month: string) {
  const supabase = await createClient();
  const [{ data, error }, { data: prizes }] = await Promise.all([
    supabase.rpc("leaderboard", { p_month: month }),
    supabase.from("leaderboard_prizes").select("agent_prize, caller_prize").eq("month", month).maybeSingle(),
  ]);
  if (error) throw error;
  const rows = (data ?? []) as { kind: "agent" | "caller"; user_id: string; first_name: string; last_name: string; policies: number; premium: string | number; consultations: number; successful: number; booked: number }[];
  const map = (kind: "agent" | "caller") =>
    rows
      .filter((r) => r.kind === kind)
      .map((r) => ({
        userId: r.user_id,
        name: `${r.first_name} ${r.last_name}`,
        policies: r.policies,
        premiumCents: toCents(Number(r.premium).toFixed(2)),
        consultations: r.consultations,
        successful: r.successful,
        booked: r.booked,
        rank: 0,
      }));
  const rankBy = (list: LeaderRow[], a: (r: LeaderRow) => number, b: (r: LeaderRow) => number) => {
    list.sort((x, y) => a(y) - a(x) || b(y) - b(x) || x.name.localeCompare(y.name, "sl"));
    list.forEach((r, i) => {
      const prev = list[i - 1];
      r.rank = prev && a(prev) === a(r) && b(prev) === b(r) ? prev.rank : i + 1;
    });
    return list;
  };
  return {
    agents: rankBy(map("agent"), (r) => r.premiumCents, (r) => r.policies),
    callers: rankBy(map("caller"), (r) => r.policies, (r) => r.booked),
    prizes: { agent: (prizes?.agent_prize as string | null) ?? null, caller: (prizes?.caller_prize as string | null) ?? null },
  };
}
