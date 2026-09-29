import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/types/domain";
import type { NavCounts } from "@/components/layout/sidebar";

export async function getNavCounts(profile: Profile): Promise<NavCounts> {
  const supabase = await createClient();
  const counts: NavCounts = {};
  const tasks: PromiseLike<unknown>[] = [];

  if (profile.role === "caller" || profile.role === "owner") {
    let q = supabase.from("caller_followups").select("id", { count: "exact", head: true }).eq("status", "open");
    if (profile.role === "caller") q = q.eq("caller_id", profile.id);
    tasks.push(q.then(({ count }) => void (counts.followups = count ?? 0)));
  }
  if (profile.role === "agent" || profile.role === "owner") {
    tasks.push(
      supabase
        .from("appointments")
        .select("id", { count: "exact", head: true })
        .eq("status", "scheduled")
        .eq("agent_id", profile.id)
        .lte("scheduled_at", new Date().toISOString())
        .then(({ count }) => void (counts.pendingResults = count ?? 0)),
    );
  }
  await Promise.all(tasks);
  return counts;
}
