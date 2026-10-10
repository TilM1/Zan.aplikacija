import { buildPoliciesPayload, type PolicyEntry, type PolicyPayload } from "@/lib/commission/payload";
import { createAdminClient } from "@/lib/supabase/admin";
import { WorkflowError } from "@/server/workflow";

/**
 * Policies payload for a sale (result A1): snapshots the agent's CURRENT rate /
 * per-product numbers and the caller's multiplier (never retroactive) and lets
 * the commission engine compute every commission record.
 */
export async function buildSalePolicies(agentId: string, callerId: string | null, entries: PolicyEntry[]): Promise<PolicyPayload[]> {
  const admin = createAdminClient();
  const productIds = [...new Set(entries.map((p) => p.product_id))];
  const [{ data: rate, error }, callerRes, productsRes, multRes] = await Promise.all([
    admin.rpc("current_agent_rate", { p_agent_id: agentId }),
    callerId ? admin.rpc("current_caller_multiplier", { p_caller_id: callerId }) : Promise.resolve({ data: null, error: null }),
    admin.from("products").select("id, name, commission_model").in("id", productIds),
    admin
      .from("agent_product_multipliers")
      .select("product_id, multiplier, effective_from, created_at")
      .eq("agent_id", agentId)
      .in("product_id", productIds)
      .order("effective_from", { ascending: false })
      .order("created_at", { ascending: false }),
  ]);
  if (error) throw error;
  if (callerRes.error) throw callerRes.error;
  const products = (productsRes.data ?? []) as { id: string; name: string; commission_model: "standard" | "agent_multiplier" }[];
  const productModels = Object.fromEntries(products.map((p) => [p.id, p.commission_model]));
  const agentMultipliers: Record<string, string> = {};
  for (const m of multRes.data ?? []) if (!(m.product_id in agentMultipliers)) agentMultipliers[m.product_id] = String(Number(m.multiplier));
  for (const p of products) {
    if (p.commission_model === "agent_multiplier" && !agentMultipliers[p.id]) {
      throw new WorkflowError(`Zastopnik nima nastavljene provizije za produkt »${p.name}«. Nastavite jo pod Zaposleni.`);
    }
  }
  const needsRate = products.some((p) => p.commission_model === "standard");
  if (needsRate && (rate === null || rate === undefined)) {
    throw new WorkflowError("Zastopnik nima nastavljenega odstotka provizije. Nastavite ga pod Zaposleni.");
  }
  if (callerId && (callerRes.data === null || callerRes.data === undefined)) {
    throw new WorkflowError("Klicatelj nima nastavljene provizije. Nastavite jo pod Zaposleni.");
  }
  return buildPoliciesPayload(entries, {
    agentRatePercent: rate === null || rate === undefined ? null : Number(rate).toFixed(2),
    callerMultiplier: callerId ? String(Number(callerRes.data)) : null,
    productModels,
    agentMultipliers,
  });
}
