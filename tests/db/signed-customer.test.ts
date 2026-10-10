import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TestDb } from "./harness";
import { buildPoliciesPayload } from "@/lib/commission/payload";

let db: TestDb;
let owner: string, marko: string, ana: string, bonus: string;

async function addSigned(actor: string, agent: string, caller: string | null, customer: Record<string, string>, policyDate: string) {
  const rate = (await db.one<{ r: string | null }>(`select public.current_agent_rate($1)::text r`, [agent])).r;
  const policies = buildPoliciesPayload([{ product_id: bonus, monthly_premium: "100.00", duration_years: 10, policy_date: policyDate }], {
    agentRatePercent: rate,
    callerMultiplier: caller ? "1.5" : null,
    ...(await db.productContext(agent)),
  });
  return db.rpc<{ customer_id: string; appointment_id: string; policy_ids: string[] }>("crm_add_signed_customer", {
    p_actor: actor,
    p_customer: customer,
    p_sale: { agent_id: agent, caller_id: caller, signed_at: `${policyDate}T10:00:00Z`, note: "Stara stranka" },
    p_policies: policies,
  });
}

beforeAll(async () => {
  db = await TestDb.create();
  owner = await db.createUser("owner", "Zan", "6");
  marko = await db.createUser("agent", "Marko", "3.5");
  ana = await db.createUser("caller", "Ana");
  bonus = (await db.one<{ id: string }>(`select id from products where name = 'Moj življenjski bonus'`)).id;
});
afterAll(async () => db?.close());

describe("owner adds an already signed customer", () => {
  it("one step: won customer, completed A1 consultation dated on signing, policy and commissions; address optional", async () => {
    const r = await addSigned(owner, owner, null, { first_name: "Jana", last_name: "Novak", phone: "041 111 222", address: "", postal_code: "" }, "2026-08-10");
    const c = await db.one<Record<string, unknown>>(`select status, last_result, current_agent_id, responsible_caller_id from customers where id = $1`, [r.customer_id]);
    expect(c).toEqual({ status: "won", last_result: "A1", current_agent_id: owner, responsible_caller_id: null });
    const a = await db.one<Record<string, unknown>>(`select status, result, completed_at::date::text d from appointments where id = $1`, [r.appointment_id]);
    expect(a).toEqual({ status: "completed", result: "A1", d: "2026-08-10" });
    expect(await db.query(`select 1 from appointments where customer_id = $1 and status = 'scheduled'`, [r.customer_id])).toHaveLength(0);
    const com = await db.query<{ t: string; total: string }>(`select beneficiary_type t, total_amount::text total from commissions where policy_id = $1`, [r.policy_ids[0]]);
    expect(com).toEqual([{ t: "agent", total: "720.00" }]); // 100 × 12 × 10 × 6 %, no caller
  });

  it("with another agent and a caller both get their commission", async () => {
    const r = await addSigned(owner, marko, ana, { first_name: "Bojan", last_name: "Kos", phone: "041 333 444", address: "Ulica 1", postal_code: "1000" }, "2026-09-20");
    const com = await db.query<{ t: string; who: string; total: string }>(`select beneficiary_type t, beneficiary_id who, total_amount::text total from commissions where policy_id = $1 order by 1`, [r.policy_ids[0]]);
    expect(com).toEqual([{ t: "agent", who: marko, total: "420.00" }, { t: "caller", who: ana, total: "150.00" }]);
  });

  it("only the owner may use it, and a failed save leaves nothing behind", async () => {
    await expect(addSigned(marko, marko, null, { first_name: "X", last_name: "Y", phone: "041 555 666", address: "", postal_code: "" }, "2026-09-20")).rejects.toThrow();
    const before = (await db.one<{ n: number }>(`select count(*)::int n from customers`)).n;
    await expect(
      db.rpc("crm_add_signed_customer", { p_actor: owner, p_customer: { first_name: "Brez", last_name: "Police", phone: "041 777 888", address: "", postal_code: "" }, p_sale: { agent_id: owner }, p_policies: [] }),
    ).rejects.toThrow(/vsaj ena polica/);
    expect((await db.one<{ n: number }>(`select count(*)::int n from customers`)).n).toBe(before);
  });
});
