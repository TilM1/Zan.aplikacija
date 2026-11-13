import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TestDb } from "./harness";
import { buildPoliciesPayload } from "@/lib/commission/payload";

let db: TestDb;
let owner: string, marko: string, ana: string, bonus: string;

beforeAll(async () => {
  db = await TestDb.create();
  owner = await db.createUser("owner", "Zan", "6");
  marko = await db.createUser("agent", "Marko", "3.5");
  ana = await db.createUser("caller", "Ana");
  bonus = (await db.one<{ id: string }>(`select id from products where name = 'Moj življenjski bonus'`)).id;
});
afterAll(async () => db?.close());

const addLead = (actor: string, lead: Record<string, unknown>) =>
  db.rpc<{ status: string; lead_id: string; list_id: string; list_name: string; existing_customer_id: string | null }>("crm_add_private_lead", {
    p_actor: actor,
    p_lead: lead,
  });

async function policies(agent: string, caller: string | null, policyDate: string, premium = "100.00") {
  const rate = (await db.one<{ r: string | null }>(`select public.current_agent_rate($1)::text r`, [agent])).r;
  return buildPoliciesPayload([{ product_id: bonus, monthly_premium: premium, duration_years: 10, policy_date: policyDate }], {
    agentRatePercent: rate,
    callerMultiplier: caller ? "1.5" : null,
    ...(await db.productContext(agent)),
  });
}

describe("Zasebna baza (private list) via crm_add_private_lead", () => {
  it("creates the private list on first use and adds the contact with its note", async () => {
    const r = await addLead(owner, { name: "Petra Zupan", phone: "041 900 100", email: "Petra@Mail.si", street: "Cesta 5", postal_code: "1000", city: "Ljubljana", note: "Zanima jo pokojninsko" });
    expect(r.status).toBe("created");
    const list = await db.one<Record<string, unknown>>(`select name, kind, status, total_rows, imported_count from lead_lists where id = $1`, [r.list_id]);
    expect(list).toEqual({ name: "Zasebna baza", kind: "private", status: "ready", total_rows: 1, imported_count: 1 });
    const lead = await db.one<Record<string, unknown>>(`select name, phone_normalized, email, status, last_comment from leads where id = $1`, [r.lead_id]);
    expect(lead).toEqual({ name: "Petra Zupan", phone_normalized: "+38641900100", email: "petra@mail.si", status: "new", last_comment: "Zanima jo pokojninsko" });
    expect(await db.query(`select action, comment from lead_events where lead_id = $1`, [r.lead_id])).toEqual([{ action: "comment", comment: "Zanima jo pokojninsko" }]);
  });

  it("reuses the same list and reports a number that is already in a call list", async () => {
    const second = await addLead(owner, { name: "Rok Bizjak", phone: "+386 41 900 200" });
    const first = await db.one<{ id: string }>(`select id from lead_lists where kind = 'private'`);
    expect(second.list_id).toBe(first.id);
    const dup = await addLead(owner, { name: "Rok B.", phone: "041900200" });
    expect(dup).toMatchObject({ status: "exists", lead_id: second.lead_id, list_name: "Zasebna baza" });
    expect((await db.one<{ n: number }>(`select count(*)::int n from leads where list_id = $1`, [first.id])).n).toBe(2);
  });

  it("is hidden from callers even if the owner adds members, and only the owner may add", async () => {
    const list = await db.one<{ id: string }>(`select id from lead_lists where kind = 'private'`);
    await db.query(`insert into lead_list_members (list_id, caller_id, notify) values ($1, $2, true)`, [list.id, ana]);
    expect(await db.asUser(ana, `select id from lead_lists where id = $1`, [list.id])).toHaveLength(0);
    expect(await db.asUser(ana, `select id from leads where list_id = $1`, [list.id])).toHaveLength(0);
    expect((await db.asUser(owner, `select id from leads where list_id = $1`, [list.id])).length).toBe(2);
    await expect(addLead(marko, { name: "X Y", phone: "041 900 300" })).rejects.toThrow();
    await expect(addLead(ana, { name: "X Y", phone: "041 900 300" })).rejects.toThrow();
  });

  it("still shows ordinary lists to callers", async () => {
    const l = await db.one<{ id: string }>(`insert into lead_lists (name, status, imported_by) values ('Navaden', 'ready', $1) returning id`, [owner]);
    expect(await db.asUser(ana, `select id from lead_lists where id = $1`, [l.id])).toEqual([{ id: l.id }]);
  });

  it("rejects invalid input and do-not-call numbers", async () => {
    await expect(addLead(owner, { name: "", phone: "041 900 400" })).rejects.toThrow(/obvezna/);
    await expect(addLead(owner, { name: "Kratka", phone: "123" })).rejects.toThrow(/telefonsko/);
    await db.query(`insert into lead_suppressions (phone_normalized) values ('+38641900500')`);
    await expect(addLead(owner, { name: "Ne Kliči", phone: "041 900 500" })).rejects.toThrow(/Ne kliči/);
  });

  it("creates a new private list after the old one is archived", async () => {
    const old = await db.one<{ id: string }>(`select id from lead_lists where kind = 'private' and status <> 'archived'`);
    await db.query(`update lead_lists set status = 'archived' where id = $1`, [old.id]);
    const r = await addLead(owner, { name: "Nova Oseba", phone: "041 900 600" });
    expect(r.list_id).not.toBe(old.id);
    await expect(db.query(`insert into lead_lists (name, kind, status, imported_by) values ('Druga', 'private', 'ready', $1)`, [owner])).rejects.toThrow();
  });
});

describe("policy for an existing customer via crm_add_policy_to_customer", () => {
  async function signedCustomer(phone: string, caller: string | null) {
    return db.rpc<{ customer_id: string }>("crm_add_signed_customer", {
      p_actor: owner,
      p_customer: { first_name: "Obstoječa", last_name: "Stranka", phone, address: "", postal_code: "" },
      p_sale: { agent_id: owner, caller_id: caller, signed_at: "2026-06-01T10:00:00Z" },
      p_policies: await policies(owner, caller, "2026-06-01"),
    });
  }

  it("adds a second policy: new completed A1 visit dated on signing, commissions for the owner", async () => {
    const c = await signedCustomer("041 800 100", null);
    const res = await db.rpc<{ customer_id: string; policy_ids: string[] }>("crm_add_policy_to_customer", {
      p_actor: owner,
      p_customer_id: c.customer_id,
      p_sale: { agent_id: owner, caller_id: null, signed_at: "2026-10-05T10:00:00Z", note: "Druga polica" },
      p_policies: await policies(owner, null, "2026-10-05", "50.00"),
    });
    expect(res.customer_id).toBe(c.customer_id);
    const visits = await db.query<{ v: number; status: string; result: string; d: string }>(
      `select visit_number v, status, result, completed_at::date::text d from appointments where customer_id = $1 order by visit_number`,
      [c.customer_id],
    );
    expect(visits).toEqual([
      { v: 1, status: "completed", result: "A1", d: "2026-06-01" },
      { v: 2, status: "completed", result: "A1", d: "2026-10-05" },
    ]);
    expect((await db.one<{ s: string }>(`select status s from customers where id = $1`, [c.customer_id])).s).toBe("won");
    const com = await db.query(`select beneficiary_type t, total_amount::text total from commissions where policy_id = $1`, [res.policy_ids[0]]);
    expect(com).toEqual([{ t: "agent", total: "360.00" }]); // 50 × 12 × 10 × 6 %
  });

  it("gives the responsible caller their commission, and refuses if the expected caller differs", async () => {
    const c = await signedCustomer("041 800 200", ana);
    await expect(
      db.rpc("crm_add_policy_to_customer", {
        p_actor: owner,
        p_customer_id: c.customer_id,
        p_sale: { agent_id: owner, caller_id: null, signed_at: "2026-10-05T10:00:00Z" },
        p_policies: await policies(owner, null, "2026-10-05"),
      }),
    ).rejects.toThrow(/spremenili/);
    const res = await db.rpc<{ policy_ids: string[] }>("crm_add_policy_to_customer", {
      p_actor: owner,
      p_customer_id: c.customer_id,
      p_sale: { agent_id: owner, caller_id: ana, signed_at: "2026-10-05T10:00:00Z" },
      p_policies: await policies(owner, ana, "2026-10-05"),
    });
    const com = await db.query(`select beneficiary_type t, beneficiary_id who from commissions where policy_id = $1 order by 1`, [res.policy_ids[0]]);
    expect(com).toEqual([{ t: "agent", who: owner }, { t: "caller", who: ana }]);
  });

  it("refuses when the customer has an open appointment, for non-owners, and leaves nothing behind", async () => {
    const c = await signedCustomer("041 800 300", null);
    await db.rpc("crm_schedule_appointment", {
      p_actor: owner,
      p_customer_id: c.customer_id,
      p_appointment: { agent_id: marko, scheduled_at: "2026-12-01T09:00:00Z", duration_minutes: 60 },
    });
    const before = (await db.one<{ n: number }>(`select count(*)::int n from policies`)).n;
    await expect(
      db.rpc("crm_add_policy_to_customer", {
        p_actor: owner,
        p_customer_id: c.customer_id,
        p_sale: { agent_id: owner, caller_id: null },
        p_policies: await policies(owner, null, "2026-10-05"),
      }),
    ).rejects.toThrow(/odprt termin/);
    await expect(
      db.rpc("crm_add_policy_to_customer", {
        p_actor: marko,
        p_customer_id: c.customer_id,
        p_sale: { agent_id: marko, caller_id: null },
        p_policies: await policies(marko, null, "2026-10-05"),
      }),
    ).rejects.toThrow();
    expect((await db.one<{ n: number }>(`select count(*)::int n from policies`)).n).toBe(before);
  });
});

describe("telegram_submissions", () => {
  it("one row per Telegram message and no browser access", async () => {
    const ins = `insert into telegram_submissions (chat_id, message_id, telegram_user_id, actor_id, command, payload) values (1, 10, 1, $1, 'novastranka', '{}')`;
    await db.query(ins, [owner]);
    await expect(db.query(ins, [owner])).rejects.toThrow();
    await expect(db.asUser(owner, `select * from telegram_submissions`)).rejects.toThrow();
  });
});
