import "server-only";
import { createClient } from "@/lib/supabase/server";
import { toCents } from "@/lib/money";
import { policyCashflow, type CashflowEntry } from "@/lib/commission/owner-cashflow";

/** One payout date of one policy: what the insurer pays, what goes to agent/caller, what stays. */
export interface OwnerEarningRow extends CashflowEntry {
  policyId: string;
  policyDate: string;
  customerId: string;
  customerName: string;
  productName: string;
  monthlyPremium: string;
  agentId: string;
  callerId: string | null;
  soldByOwner: boolean;
}

export interface OwnerTotals {
  agency: number;
  agents: number;
  callers: number;
  owner: number;
  /** Part of `owner` from policies signed in the same calendar year as the payout. */
  fromNew: number;
  /** Part of `owner` from policies signed in earlier years (later installments). */
  fromEarlier: number;
}

const cents = (v: unknown) => toCents(Number(v ?? 0).toFixed(2));

export function totalsOf(rows: OwnerEarningRow[]): OwnerTotals {
  const t: OwnerTotals = { agency: 0, agents: 0, callers: 0, owner: 0, fromNew: 0, fromEarlier: 0 };
  for (const r of rows) {
    t.agency += r.agencyCents;
    t.agents += r.agentCents;
    t.callers += r.callerCents;
    t.owner += r.ownerCents;
    if (r.policyDate.slice(0, 4) === r.date.slice(0, 4)) t.fromNew += r.ownerCents;
    else t.fromEarlier += r.ownerCents;
  }
  return t;
}

/**
 * Owner's earnings of all active policies, split by payout date
 * (see owner-cashflow.ts). Owner-only (RLS on agency amounts).
 */
export async function getOwnerEarnings(ownerId: string): Promise<OwnerEarningRow[]> {
  const supabase = await createClient();
  const rows: OwnerEarningRow[] = [];
  const PAGE = 1000;
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .from("policies")
      .select(
        "id, policy_date, product_name, monthly_premium, agent_id, caller_id, customer:customers(id, first_name, last_name), agency:policy_agency_commissions(calc_model, total_amount), installments:commission_installments(beneficiary_type, amount, due_date, status)",
      )
      .eq("status", "active")
      .order("policy_date", { ascending: false })
      .order("id")
      .range(offset, offset + PAGE - 1);
    if (error) throw error;
    type Agency = { calc_model: "standard" | "agent_multiplier"; total_amount: number };
    for (const p of (data ?? []) as unknown as {
      id: string;
      policy_date: string;
      product_name: string;
      monthly_premium: number;
      agent_id: string;
      caller_id: string | null;
      customer: { id: string; first_name: string; last_name: string };
      agency: Agency | Agency[] | null;
      installments: { beneficiary_type: "agent" | "caller"; amount: number; due_date: string; status: string }[];
    }[]) {
      const agency = Array.isArray(p.agency) ? p.agency[0] : p.agency;
      const soldByOwner = p.agent_id === ownerId;
      const entries = policyCashflow({
        policyDate: p.policy_date,
        agencyCents: agency ? cents(agency.total_amount) : 0,
        agencyModel: agency?.calc_model ?? null,
        soldByOwner,
        payouts: p.installments.filter((i) => i.status !== "cancelled").map((i) => ({ type: i.beneficiary_type, dueDate: i.due_date, cents: cents(i.amount) })),
      });
      for (const e of entries) {
        rows.push({
          ...e,
          policyId: p.id,
          policyDate: p.policy_date,
          customerId: p.customer.id,
          customerName: `${p.customer.first_name} ${p.customer.last_name}`,
          productName: p.product_name,
          monthlyPremium: Number(p.monthly_premium).toFixed(2),
          agentId: p.agent_id,
          callerId: p.caller_id,
          soldByOwner,
        });
      }
    }
    if (!data || data.length < PAGE) break;
  }
  return rows.sort((a, b) => a.date.localeCompare(b.date) || a.customerName.localeCompare(b.customerName, "sl"));
}
