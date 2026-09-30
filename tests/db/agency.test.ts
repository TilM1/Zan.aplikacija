import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TestDb } from "./harness";
import { buildPoliciesPayload } from "@/lib/commission/payload";

let db: TestDb;
let owner: string, marko: string, ana: string;
let bonus: string, spec: string;

async function sale(agent: string, product: string, premium: string, years: number) {
  const { customer_id, appointment_id } = await db.rpc<{ customer_id: string; appointment_id: string }>("crm_create_customer_with_appointment", {
    p_actor: ana,
    p_customer: { first_name: "K", last_name: "X", phone: `+38641${Math.floor(1e6 + Math.random() * 8e6)}`, address: "U 1", postal_code: "1000" },
    p_appointment: { agent_id: agent, scheduled_at: "2026-10-01T08:00:00Z" },
  });
  const rate = (await db.one<{ r: string | null }>(`select public.current_agent_rate($1)::text r`, [agent])).r;
  const payload = buildPoliciesPayload([{ product_id: product, monthly_premium: premium, duration_years: years, policy_date: "2026-10-01" }], {
    agentRatePercent: rate,
    callerMultiplier: "1.5",
    ...(await db.productContext(agent)),
  });
  const r = await db.rpc<{ policy_ids: string[] }>("crm_record_result", { p_actor: agent, p_appointment_id: appointment_id, p_result: "A1", p_note: null, p_next: null, p_policies: payload });
  return { customer_id, policy_id: r.policy_ids[0] };
}

beforeAll(async () => {
  db = await TestDb.create();
  owner = await db.createUser("owner", "Zan", "6");
  marko = await db.createUser("agent", "Marko", "3.5");
  ana = await db.createUser("caller", "Ana");
  await db.setProductMultiplier(marko, "Specialisti", 8);
  await db.setProductMultiplier(owner, "Specialisti", 10.25);
  bonus = (await db.one<{ id: string }>(`select id from products where name = 'Moj življenjski bonus'`)).id;
  spec = (await db.one<{ id: string }>(`select id from products where name = 'Specialisti'`)).id;
});
afterAll(async () => db?.close());

const agency = (policyId: string) => db.one<{ total: string; rate: string; calc_model: string }>(`select total_amount::text total, rate::text, calc_model from policy_agency_commissions where policy_id = $1`, [policyId]);

describe("agency commission (owner earnings)", () => {
  it("bonus/kasko: 6 % of premium × 12 × years; owner keeps 6 % − agent − caller", async () => {
    const { policy_id } = await sale(marko, bonus, "100.00", 10);
    expect(await agency(policy_id)).toEqual({ total: "720.00", rate: "6.000", calc_model: "standard" }); // 100×12×10×6 %
    const c = await db.query<{ t: string; total: string }>(`select beneficiary_type t, total_amount::text total from commissions where policy_id = $1 order by 1`, [policy_id]);
    expect(c).toEqual([{ t: "agent", total: "420.00" }, { t: "caller", total: "150.00" }]); // 3.5 % and ×1.5 → owner keeps 150
  });

  it("Specialisti: agency premium × 10.25, agent premium × his number", async () => {
    const { policy_id } = await sale(marko, spec, "30.00", 1);
    expect(await agency(policy_id)).toMatchObject({ total: "307.50", calc_model: "agent_multiplier" }); // 30 × 10.25; agent 240, caller 45 → owner 22.50
  });

  it("only the owner can see agency amounts", async () => {
    expect((await db.asUser(owner, `select policy_id from policy_agency_commissions`)).length).toBeGreaterThan(0);
    expect(await db.asUser(marko, `select policy_id from policy_agency_commissions`)).toHaveLength(0);
    expect(await db.asUser(ana, `select policy_id from policy_agency_commissions`)).toHaveLength(0);
  });

  it("changing product settings does not change existing policies; restore keeps the original snapshot", async () => {
    const { customer_id, policy_id } = await sale(marko, bonus, "50.00", 10);
    await db.rpc("crm_upsert_product", { p_actor: owner, p_product_id: bonus, p_name: "Moj življenjski bonus", p_is_active: true, p_sort_order: 10, p_commission_model: null, p_agency_rate_percent: 7, p_agency_multiplier: null });
    expect((await agency(policy_id)).total).toBe("360.00"); // still 6 %
    const newer = await sale(marko, bonus, "50.00", 10);
    expect((await agency(newer.policy_id)).total).toBe("420.00"); // 7 %

    const backup = await db.rpc<string>("crm_delete_customer", { p_actor: owner, p_customer_id: customer_id, p_reason: "test" });
    await db.rpc("crm_restore_customer", { p_actor: owner, p_backup_id: backup });
    expect((await agency(policy_id)).total).toBe("360.00"); // original 6 %, not today's 7 %
  });
});
