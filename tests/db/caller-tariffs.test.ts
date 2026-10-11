import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TestDb } from "./harness";
import { buildPoliciesPayload } from "@/lib/commission/payload";

let db: TestDb;
let owner: string, marko: string, ana: string, bonus: string, live: string;
let n = 0;

const mult = async (tariff: string) => String(Number((await db.one<{ r: string }>(`select public.current_caller_multiplier_for($1, $2)::text r`, [ana, tariff])).r));

/** Ana books an appointment (from a live contact or directly), Marko sells a 100 € policy with the given caller multiplier. */
async function sale(fromLive: boolean, callerMultiplier: string) {
  const phone = `+3864100${String(1000 + n++)}`;
  let leadId: string | null = null;
  if (fromLive) {
    await db.rpc("crm_ingest_live_leads", { p_list_id: live, p_rows: [{ source_key: phone, name: "Oglas Oseba", phone, email: null, created_at: "2026-10-09T10:00:00Z", extra: {}, skip: false }] });
    leadId = (await db.one<{ id: string }>(`select id from leads where phone_normalized = $1`, [phone])).id;
  }
  const { customer_id, appointment_id } = await db.rpc<{ customer_id: string; appointment_id: string }>("crm_create_customer_with_appointment", {
    p_actor: ana,
    p_customer: { first_name: "K", last_name: "X", phone, address: "U 1", postal_code: "1000" },
    p_appointment: { agent_id: marko, scheduled_at: "2026-10-12T08:00:00Z" },
    p_lead_id: leadId,
  });
  const payload = buildPoliciesPayload([{ product_id: bonus, monthly_premium: "100.00", duration_years: 10, policy_date: "2026-10-12" }], {
    agentRatePercent: "3.50",
    callerMultiplier,
    ...(await db.productContext(marko)),
  });
  const r = await db.rpc<{ policy_ids: string[] }>("crm_record_result", { p_actor: marko, p_appointment_id: appointment_id, p_result: "A1", p_note: null, p_next: null, p_policies: payload });
  const c = await db.one<{ total: string; m: string }>(`select total_amount::text total, caller_multiplier::text m from commissions where policy_id = $1 and beneficiary_type = 'caller'`, [r.policy_ids[0]]);
  const t = await db.one<{ t: string }>(`select caller_tariff t from customers where id = $1`, [customer_id]);
  return { total: c.total, tariff: t.t };
}

beforeAll(async () => {
  db = await TestDb.create();
  owner = await db.createUser("owner", "Zan", "6");
  marko = await db.createUser("agent", "Marko", "3.5");
  ana = await db.createUser("caller", "Ana");
  bonus = (await db.one<{ id: string }>(`select id from products where name = 'Moj življenjski bonus'`)).id;
  live = await db.rpc<string>("crm_create_live_list", { p_actor: owner, p_name: "Oglasi", p_source_label: "Facebook", p_source_tab: "SPECIALISTI", p_token_hash: "a".repeat(64), p_members: [] });
});
afterAll(async () => db?.close());

describe("caller tariffs: regular list vs live list", () => {
  it("without a live tariff the standard one applies to both", async () => {
    expect([await mult("standard"), await mult("live")]).toEqual(["1.5", "1.5"]);
    expect(await sale(true, "1.5")).toEqual({ total: "150.00", tariff: "live" });
  });

  it("owner sets a separate live tariff: live customers get it, regular customers keep the standard one", async () => {
    await db.rpc("crm_set_caller_multiplier", { p_actor: owner, p_caller_id: ana, p_multiplier: 1, p_tariff: "live" });
    expect([await mult("standard"), await mult("live")]).toEqual(["1.5", "1"]);
    expect(await sale(true, "1")).toEqual({ total: "100.00", tariff: "live" });
    expect(await sale(false, "1.5")).toEqual({ total: "150.00", tariff: "standard" });
  });

  it("the database rejects the wrong tariff for a customer", async () => {
    await expect(sale(true, "1.5")).rejects.toThrow(/medtem spremenila/);
    await expect(sale(false, "1")).rejects.toThrow(/medtem spremenila/);
  });

  it("changing the standard tariff does not touch the live one; history is kept per tariff", async () => {
    await db.rpc("crm_set_caller_multiplier", { p_actor: owner, p_caller_id: ana, p_multiplier: 2 });
    expect([await mult("standard"), await mult("live")]).toEqual(["2", "1"]);
    const h = await db.query<{ tariff: string; n: number }>(`select tariff, count(*)::int n from caller_commission_rates where caller_id = $1 group by 1 order by 1`, [ana]);
    expect(h).toEqual([{ tariff: "live", n: 1 }, { tariff: "standard", n: 2 }]);
  });
});
