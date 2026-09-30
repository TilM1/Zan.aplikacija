import "server-only";
import { createClient } from "@/lib/supabase/server";
import { toCents } from "@/lib/money";

export interface OwnerEarningRow {
  policyId: string;
  policyDate: string;
  customerId: string;
  customerName: string;
  productName: string;
  monthlyPremium: string;
  durationYears: number;
  agentId: string;
  callerId: string | null;
  agencyModel: "standard" | "agent_multiplier" | null;
  agencyRate: number | null;
  agencyCents: number;
  agentCents: number;
  callerCents: number;
  /** Agency − caller − agent (agent part stays with the owner when he sold himself). */
  ownerCents: number;
  soldByOwner: boolean;
}

const cents = (v: unknown) => toCents(Number(v ?? 0).toFixed(2));

/** Owner's own earnings per active policy with policy date in [from, to]. Owner-only (RLS on agency amounts). */
export async function getOwnerEarnings(ownerId: string, from: string | null, to: string | null) {
  const supabase = await createClient();
  const rows: OwnerEarningRow[] = [];
  const PAGE = 1000;
  for (let offset = 0; ; offset += PAGE) {
    let q = supabase
      .from("policies")
      .select(
        "id, policy_date, product_name, monthly_premium, duration_years, agent_id, caller_id, customer:customers(id, first_name, last_name), agency:policy_agency_commissions(calc_model, rate, total_amount), commissions(beneficiary_type, total_amount, status)",
      )
      .eq("status", "active")
      .order("policy_date", { ascending: false })
      .order("id")
      .range(offset, offset + PAGE - 1);
    if (from) q = q.gte("policy_date", from);
    if (to) q = q.lte("policy_date", to);
    const { data, error } = await q;
    if (error) throw error;
    for (const p of (data ?? []) as unknown as {
      id: string;
      policy_date: string;
      product_name: string;
      monthly_premium: number;
      duration_years: number;
      agent_id: string;
      caller_id: string | null;
      customer: { id: string; first_name: string; last_name: string };
      agency: { calc_model: "standard" | "agent_multiplier"; rate: number; total_amount: number } | { calc_model: "standard" | "agent_multiplier"; rate: number; total_amount: number }[] | null;
      commissions: { beneficiary_type: "agent" | "caller"; total_amount: number; status: string }[];
    }[]) {
      const agency = Array.isArray(p.agency) ? p.agency[0] : p.agency;
      const active = p.commissions.filter((c) => c.status === "active");
      const agentCents = active.filter((c) => c.beneficiary_type === "agent").reduce((a, c) => a + cents(c.total_amount), 0);
      const callerCents = active.filter((c) => c.beneficiary_type === "caller").reduce((a, c) => a + cents(c.total_amount), 0);
      const agencyCents = agency ? cents(agency.total_amount) : 0;
      const soldByOwner = p.agent_id === ownerId;
      rows.push({
        policyId: p.id,
        policyDate: p.policy_date,
        customerId: p.customer.id,
        customerName: `${p.customer.first_name} ${p.customer.last_name}`,
        productName: p.product_name,
        monthlyPremium: Number(p.monthly_premium).toFixed(2),
        durationYears: p.duration_years,
        agentId: p.agent_id,
        callerId: p.caller_id,
        agencyModel: agency?.calc_model ?? null,
        agencyRate: agency ? Number(agency.rate) : null,
        agencyCents,
        agentCents,
        callerCents,
        ownerCents: agencyCents - callerCents - (soldByOwner ? 0 : agentCents),
        soldByOwner,
      });
    }
    if (!data || data.length < PAGE) break;
  }
  const sum = (f: (r: OwnerEarningRow) => number) => rows.reduce((a, r) => a + f(r), 0);
  return {
    rows,
    totals: {
      agency: sum((r) => r.agencyCents),
      agents: sum((r) => (r.soldByOwner ? 0 : r.agentCents)),
      callers: sum((r) => r.callerCents),
      owner: sum((r) => r.ownerCents),
      ownSales: sum((r) => (r.soldByOwner ? r.ownerCents : 0)),
    },
  };
}
