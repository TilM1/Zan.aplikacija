import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TestDb } from "./harness";
import { buildPoliciesPayload } from "@/lib/commission/payload";

let db: TestDb;
let owner: string, agentMarko: string, agentLuka: string, callerAna: string, callerBor: string;
let productIds: string[];

const customerInput = (n: string) => ({
  first_name: n,
  last_name: "Novak",
  phone: "+386 41 000 " + n.length.toString().padStart(3, "0"),
  email: `${n.toLowerCase()}@example.com`,
  address: "Slovenska 1",
  postal_code: "1000",
  city: "Ljubljana",
});

async function createAppointment(actor: string, agentId: string, name = "Janez") {
  return db.rpc<{ customer_id: string; appointment_id: string }>("crm_create_customer_with_appointment", {
    p_actor: actor,
    p_customer: customerInput(name),
    p_appointment: { agent_id: agentId, scheduled_at: "2026-10-20T08:00:00Z", note: "Zanima ga življenjsko" },
  });
}

async function callerRate(callerId: string) {
  return String(Number((await db.one<{ r: string }>(`select public.current_caller_multiplier($1)::text as r`, [callerId])).r));
}

async function rate(agentId: string) {
  return (await db.one<{ r: string }>(`select public.current_agent_rate($1)::text as r`, [agentId])).r;
}

async function recordA1(actor: string, appointmentId: string, entries: Parameters<typeof buildPoliciesPayload>[0]) {
  const appt = await db.one<{ agent_id: string; caller_id: string | null }>(
    `select agent_id, caller_id from appointments where id = $1`,
    [appointmentId],
  );
  const payload = buildPoliciesPayload(entries, { agentRatePercent: await rate(appt.agent_id), callerMultiplier: appt.caller_id ? await callerRate(appt.caller_id) : null });
  return db.rpc<{ policy_ids: string[] }>("crm_record_result", {
    p_actor: actor,
    p_appointment_id: appointmentId,
    p_result: "A1",
    p_note: "Uspešno",
    p_next: null,
    p_policies: payload,
  });
}

beforeAll(async () => {
  db = await TestDb.create();
  owner = await db.createUser("owner", "Owner", "15");
  agentMarko = await db.createUser("agent", "Marko", "10");
  agentLuka = await db.createUser("agent", "Luka", "12");
  callerAna = await db.createUser("caller", "Ana");
  callerBor = await db.createUser("caller", "Bor");
  productIds = (await db.query<{ id: string }>(`select id from products order by sort_order`)).map((r) => r.id);
});

afterAll(async () => db?.close());

describe("schema", () => {
  it("seeds the three initial products", async () => {
    const rows = await db.query<{ name: string }>(`select name from products order by sort_order`);
    expect(rows.map((r) => r.name)).toEqual(["Moj življenjski bonus", "Moj življenjski kasko", "Specialisti"]);
  });
});

describe("caller flow", () => {
  it("caller creates customer + appointment; agent receives it; caller attribution recorded", async () => {
    const { customer_id, appointment_id } = await createAppointment(callerAna, agentMarko, "Caller");
    const appt = await db.one<Record<string, unknown>>(`select * from appointments where id = $1`, [appointment_id]);
    expect(appt).toMatchObject({ agent_id: agentMarko, caller_id: callerAna, created_by: callerAna, visit_number: 1, status: "scheduled" });
    const cust = await db.one<Record<string, unknown>>(`select * from customers where id = $1`, [customer_id]);
    expect(cust).toMatchObject({ responsible_caller_id: callerAna, current_agent_id: agentMarko, status: "scheduled" });

    const agentView = await db.asUser(agentMarko, `select id from appointments where id = $1`, [appointment_id]);
    expect(agentView).toHaveLength(1);
    const otherAgentView = await db.asUser(agentLuka, `select id from appointments where id = $1`, [appointment_id]);
    expect(otherAgentView).toHaveLength(0);

    const actions = await db.query<{ action: string }>(`select action from activity_log where customer_id = $1 order by id`, [customer_id]);
    expect(actions.map((a) => a.action)).toEqual(["customer_created", "appointment_created"]);
  });

  it("rejects an inactive or non-agent assignee", async () => {
    await expect(createAppointment(callerAna, callerBor, "Wrong")).rejects.toThrow(/zastopnik/);
  });

  it("prevents a second open appointment for the same customer", async () => {
    const { customer_id } = await createAppointment(callerAna, agentMarko, "Double");
    await expect(
      db.rpc("crm_schedule_appointment", { p_actor: callerAna, p_customer_id: customer_id, p_appointment: { agent_id: agentMarko, scheduled_at: "2026-11-01T10:00:00Z" } }),
    ).rejects.toThrow(/odprt termin/);
  });
});

describe("result A — new appointment required", () => {
  it("closes the old appointment, creates a new one (reassignable), keeps caller attribution and history", async () => {
    const { customer_id, appointment_id } = await createAppointment(callerAna, agentMarko, "Astatus");
    const res = await db.rpc<{ next_appointment_id: string }>("crm_record_result", {
      p_actor: agentMarko,
      p_appointment_id: appointment_id,
      p_result: "A",
      p_note: "Želi premisliti",
      p_next: { agent_id: agentLuka, scheduled_at: "2026-10-27T15:00:00Z" },
      p_policies: null,
    });
    const old = await db.one<Record<string, unknown>>(`select status, result from appointments where id = $1`, [appointment_id]);
    expect(old).toEqual({ status: "completed", result: "A" });
    const next = await db.one<Record<string, unknown>>(`select * from appointments where id = $1`, [res.next_appointment_id]);
    expect(next).toMatchObject({ agent_id: agentLuka, caller_id: callerAna, previous_appointment_id: appointment_id, visit_number: 2, status: "scheduled" });
    const cust = await db.one<Record<string, unknown>>(`select status, current_agent_id, last_result from customers where id = $1`, [customer_id]);
    expect(cust).toEqual({ status: "scheduled", current_agent_id: agentLuka, last_result: "A" });
    expect((await db.query(`select 1 from customers where first_name = 'Astatus'`)).length).toBe(1);

    const actions = (await db.query<{ action: string }>(`select action from activity_log where customer_id = $1 order by id`, [customer_id])).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["consultation_completed", "appointment_created", "appointment_reassigned"]));

    // Previous agent keeps seeing the customer's history; new agent sees it too
    expect(await db.asUser(agentMarko, `select id from customers where id = $1`, [customer_id])).toHaveLength(1);
    expect(await db.asUser(agentLuka, `select id from appointments where customer_id = $1`, [customer_id])).toHaveLength(2);
  });

  it("requires the next appointment", async () => {
    const { appointment_id } = await createAppointment(callerAna, agentMarko, "Anext");
    await expect(
      db.rpc("crm_record_result", { p_actor: agentMarko, p_appointment_id: appointment_id, p_result: "A", p_note: null, p_next: null, p_policies: null }),
    ).rejects.toThrow(/nov termin/);
    const still = await db.one<{ status: string }>(`select status from appointments where id = $1`, [appointment_id]);
    expect(still.status).toBe("scheduled"); // transaction rolled back
  });

  it("only the appointment's agent or the owner may record a result", async () => {
    const { appointment_id } = await createAppointment(callerAna, agentMarko, "Perm");
    await expect(
      db.rpc("crm_record_result", { p_actor: agentLuka, p_appointment_id: appointment_id, p_result: "A0", p_note: null, p_next: null, p_policies: null }),
    ).rejects.toThrow(/samo zastopnik/);
    await expect(
      db.rpc("crm_record_result", { p_actor: callerAna, p_appointment_id: appointment_id, p_result: "A0", p_note: null, p_next: null, p_policies: null }),
    ).rejects.toThrow();
  });
});

describe("result A0 — lost", () => {
  it("marks lost, keeps customer searchable and history intact", async () => {
    const { customer_id, appointment_id } = await createAppointment(callerAna, agentMarko, "Lost");
    await db.rpc("crm_record_result", { p_actor: agentMarko, p_appointment_id: appointment_id, p_result: "A0", p_note: "Ni interesa", p_next: null, p_policies: null });
    const cust = await db.one<Record<string, unknown>>(`select status, archived_at from customers where id = $1`, [customer_id]);
    expect(cust).toEqual({ status: "lost", archived_at: null });
    const found = await db.asUser(agentMarko, `select id from customers where search_text like '%lost%'`);
    expect(found.map((r) => (r as { id: string }).id)).toContain(customer_id);
    await expect(
      db.rpc("crm_record_result", { p_actor: agentMarko, p_appointment_id: appointment_id, p_result: "A1", p_note: null, p_next: null, p_policies: [] }),
    ).rejects.toThrow(/že vnesen/);
  });
});

describe("result B — not home → back to caller → new appointment", () => {
  it("returns the customer to the original caller who reschedules with another agent", async () => {
    const { customer_id, appointment_id } = await createAppointment(callerAna, agentMarko, "Bstatus");
    const res = await db.rpc<{ followup_id: string }>("crm_record_result", {
      p_actor: agentMarko, p_appointment_id: appointment_id, p_result: "B", p_note: "Ni bil doma", p_next: null, p_policies: null,
    });
    const f = await db.one<Record<string, unknown>>(`select caller_id, status, source_appointment_id from caller_followups where id = $1`, [res.followup_id]);
    expect(f).toEqual({ caller_id: callerAna, status: "open", source_appointment_id: appointment_id });
    expect((await db.one<{ status: string }>(`select status from customers where id = $1`, [customer_id])).status).toBe("callback");

    // Caller sees it in their follow-up queue; the other caller and the agent do not
    expect(await db.asUser(callerAna, `select id from caller_followups where status = 'open' and customer_id = $1`, [customer_id])).toHaveLength(1);
    expect(await db.asUser(callerBor, `select id from caller_followups where customer_id = $1`, [customer_id])).toHaveLength(0);
    expect(await db.asUser(agentMarko, `select id from caller_followups where customer_id = $1`, [customer_id])).toHaveLength(0);

    // Another caller cannot hijack it
    await expect(
      db.rpc("crm_schedule_appointment", { p_actor: callerBor, p_customer_id: customer_id, p_appointment: { agent_id: agentLuka, scheduled_at: "2026-10-30T09:00:00Z" } }),
    ).rejects.toThrow();

    const next = await db.rpc<{ appointment_id: string; followup_id: string }>("crm_schedule_appointment", {
      p_actor: callerAna, p_customer_id: customer_id, p_appointment: { agent_id: agentLuka, scheduled_at: "2026-10-30T09:00:00Z", note: "Doma popoldne" },
    });
    expect(next.followup_id).toBe(res.followup_id);
    const appt = await db.one<Record<string, unknown>>(`select agent_id, caller_id, visit_number, previous_appointment_id from appointments where id = $1`, [next.appointment_id]);
    expect(appt).toEqual({ agent_id: agentLuka, caller_id: callerAna, visit_number: 2, previous_appointment_id: appointment_id });
    const resolved = await db.one<Record<string, unknown>>(`select status, resolved_appointment_id from caller_followups where id = $1`, [res.followup_id]);
    expect(resolved).toEqual({ status: "rescheduled", resolved_appointment_id: next.appointment_id });

    // Previous B appointment remains in history; no duplicate customers
    const appts = await db.query<{ result: string | null }>(`select result from appointments where customer_id = $1 order by visit_number`, [customer_id]);
    expect(appts.map((a) => a.result)).toEqual(["B", null]);
    expect(await db.asUser(agentLuka, `select id from appointments where id = $1`, [next.appointment_id])).toHaveLength(1);
    expect((await db.query(`select 1 from customers where first_name = 'Bstatus'`)).length).toBe(1);
  });
});

describe("result A1 — policies and commissions", () => {
  it("creates multiple policies with agent + caller commissions and payout schedule", async () => {
    const { customer_id, appointment_id } = await createAppointment(callerAna, agentMarko, "Winner");
    const res = await recordA1(agentMarko, appointment_id, [
      { product_id: productIds[0], monthly_premium: "100.00", duration_years: 10, policy_date: "2026-10-23" },
      { product_id: productIds[2], monthly_premium: "50.00", duration_years: 20, policy_date: "2026-10-23", policy_number: "P-2" },
    ]);
    expect(res.policy_ids).toHaveLength(2);

    const policies = await db.query<Record<string, unknown>>(`select p.agent_id, p.caller_id, p.product_name, p.monthly_premium::text from policies p where p.customer_id = $1 order by p.monthly_premium desc`, [customer_id]);
    expect(policies).toEqual([
      { agent_id: agentMarko, caller_id: callerAna, product_name: "Moj življenjski bonus", monthly_premium: "100.00" },
      { agent_id: agentMarko, caller_id: callerAna, product_name: "Specialisti", monthly_premium: "50.00" },
    ]);

    const inst = await db.query<{ beneficiary_type: string; installment_number: number; amount: string; due_date: string }>(
      `select i.beneficiary_type, i.installment_number, i.amount::text, i.due_date::text
         from commission_installments i join policies p on p.id = i.policy_id
        where p.id = $1 order by i.beneficiary_type, i.installment_number`,
      [res.policy_ids[0]],
    );
    expect(inst).toEqual([
      { beneficiary_type: "agent", installment_number: 1, amount: "660.00", due_date: "2026-11-16" },
      { beneficiary_type: "agent", installment_number: 2, amount: "240.00", due_date: "2027-11-16" },
      { beneficiary_type: "agent", installment_number: 3, amount: "300.00", due_date: "2028-11-16" },
      { beneficiary_type: "caller", installment_number: 1, amount: "150.00", due_date: "2026-11-16" },
    ]);
    const c = await db.one<Record<string, unknown>>(`select rate_percent::text, total_amount::text from commissions where policy_id = $1 and beneficiary_type = 'agent'`, [res.policy_ids[0]]);
    expect(c).toEqual({ rate_percent: "10.00", total_amount: "1200.00" });
    expect((await db.one<{ status: string }>(`select status from customers where id = $1`, [customer_id])).status).toBe("won");
  });

  it("requires at least one policy and rolls back completely on invalid input", async () => {
    const { appointment_id } = await createAppointment(callerAna, agentMarko, "Empty");
    await expect(
      db.rpc("crm_record_result", { p_actor: agentMarko, p_appointment_id: appointment_id, p_result: "A1", p_note: null, p_next: null, p_policies: [] }),
    ).rejects.toThrow(/vsaj ena polica/);
    expect((await db.one<{ status: string }>(`select status from appointments where id = $1`, [appointment_id])).status).toBe("scheduled");
  });

  it("DB rejects tampered commission amounts", async () => {
    const { appointment_id } = await createAppointment(callerAna, agentMarko, "Tamper");
    const payload = buildPoliciesPayload(
      [{ product_id: productIds[0], monthly_premium: "100.00", duration_years: 10, policy_date: "2026-10-23" }],
      { agentRatePercent: "10.00", callerMultiplier: "1.5" },
    );
    payload[0].agent_commission.total_amount = "9999.00";
    await expect(
      db.rpc("crm_record_result", { p_actor: agentMarko, p_appointment_id: appointment_id, p_result: "A1", p_note: null, p_next: null, p_policies: payload }),
    ).rejects.toThrow(/commissions_agent_formula/);

    const stale = buildPoliciesPayload(
      [{ product_id: productIds[0], monthly_premium: "100.00", duration_years: 10, policy_date: "2026-10-23" }],
      { agentRatePercent: "25.00", callerMultiplier: "1.5" },
    );
    await expect(
      db.rpc("crm_record_result", { p_actor: agentMarko, p_appointment_id: appointment_id, p_result: "A1", p_note: null, p_next: null, p_policies: stale }),
    ).rejects.toThrow(/spremenil/);
  });

  it("changing the agent's rate never changes existing policies", async () => {
    const { appointment_id: first } = await createAppointment(callerAna, agentLuka, "Snap1");
    const r1 = await recordA1(agentLuka, first, [{ product_id: productIds[1], monthly_premium: "100.00", duration_years: 10, policy_date: "2026-10-25" }]);

    await db.rpc("crm_set_agent_rate", { p_actor: owner, p_agent_id: agentLuka, p_rate_percent: 14 });
    expect(await rate(agentLuka)).toBe("14.00");

    const { appointment_id: second } = await createAppointment(callerAna, agentLuka, "Snap2");
    const r2 = await recordA1(agentLuka, second, [{ product_id: productIds[1], monthly_premium: "100.00", duration_years: 10, policy_date: "2026-11-02" }]);

    const totals = await db.query<{ policy_id: string; rate_percent: string; total_amount: string }>(
      `select policy_id, rate_percent::text, total_amount::text from commissions where beneficiary_type = 'agent' and policy_id = any($1::uuid[])`,
      [[r1.policy_ids[0], r2.policy_ids[0]]],
    );
    const byPolicy = Object.fromEntries(totals.map((t) => [t.policy_id, t]));
    expect(byPolicy[r1.policy_ids[0]]).toMatchObject({ rate_percent: "12.00", total_amount: "1440.00" });
    expect(byPolicy[r2.policy_ids[0]]).toMatchObject({ rate_percent: "14.00", total_amount: "1680.00" });

    // policy 25 Oct → first payout moves to 16 Dec
    const due = await db.one<{ due_date: string }>(`select due_date::text from commission_installments where policy_id = $1 and beneficiary_type = 'caller'`, [r1.policy_ids[0]]);
    expect(due.due_date).toBe("2026-12-16");

    await expect(db.query(`update commissions set total_amount = 1 where policy_id = $1`, [r1.policy_ids[0]])).rejects.toThrow(/immutable/);
    await expect(db.query(`update policies set monthly_premium = 1 where id = $1`, [r1.policy_ids[0]])).rejects.toThrow(/cannot be changed/);
  });

  it("A1 on an agent-booked appointment (no caller) creates no caller commission", async () => {
    const { appointment_id } = await createAppointment(agentMarko, agentMarko, "Selfbooked");
    const res = await recordA1(agentMarko, appointment_id, [{ product_id: productIds[0], monthly_premium: "80.00", duration_years: 5, policy_date: "2026-10-10" }]);
    const types = await db.query<{ beneficiary_type: string }>(`select beneficiary_type from commissions where policy_id = $1`, [res.policy_ids[0]]);
    expect(types.map((t) => t.beneficiary_type)).toEqual(["agent"]);
  });
});

describe("caller multiplier", () => {
  it("changing a caller's multiplier never changes existing policies", async () => {
    const { appointment_id: first } = await createAppointment(callerBor, agentMarko, "CallerSnap1");
    const r1 = await recordA1(agentMarko, first, [{ product_id: productIds[0], monthly_premium: "100.00", duration_years: 10, policy_date: "2026-10-05" }]);

    await db.rpc("crm_set_caller_multiplier", { p_actor: owner, p_caller_id: callerBor, p_multiplier: 2 });
    const { appointment_id: second } = await createAppointment(callerBor, agentMarko, "CallerSnap2");
    const r2 = await recordA1(agentMarko, second, [{ product_id: productIds[0], monthly_premium: "100.00", duration_years: 10, policy_date: "2026-10-06" }]);

    const rows = await db.query<{ policy_id: string; m: string; total: string }>(
      `select policy_id, caller_multiplier::text m, total_amount::text total from commissions where beneficiary_type = 'caller' and policy_id = any($1::uuid[])`,
      [[r1.policy_ids[0], r2.policy_ids[0]]],
    );
    const by = Object.fromEntries(rows.map((r) => [r.policy_id, r]));
    expect(by[r1.policy_ids[0]]).toMatchObject({ m: "1.500", total: "150.00" });
    expect(by[r2.policy_ids[0]]).toMatchObject({ m: "2.000", total: "200.00" });
  });

  it("rejects a stale caller multiplier and non-owner changes", async () => {
    const { appointment_id } = await createAppointment(callerAna, agentMarko, "CallerStale");
    const payload = buildPoliciesPayload(
      [{ product_id: productIds[0], monthly_premium: "100.00", duration_years: 10, policy_date: "2026-10-05" }],
      { agentRatePercent: await rate(agentMarko), callerMultiplier: "3" },
    );
    await expect(
      db.rpc("crm_record_result", { p_actor: agentMarko, p_appointment_id: appointment_id, p_result: "A1", p_note: null, p_next: null, p_policies: payload }),
    ).rejects.toThrow(/klicatelja se je medtem spremenila/);
    await expect(db.rpc("crm_set_caller_multiplier", { p_actor: agentMarko, p_caller_id: callerAna, p_multiplier: 5 })).rejects.toThrow(/lastnik/);
    await expect(db.rpc("crm_set_caller_multiplier", { p_actor: owner, p_caller_id: agentMarko, p_multiplier: 5 })).rejects.toThrow(/samo klicatelju/);
  });

  it("multipliers are private: callers see only their own, agents none", async () => {
    expect((await db.asUser<{ caller_id: string }>(callerAna, `select distinct caller_id from caller_commission_rates`)).map((r) => r.caller_id)).toEqual([callerAna]);
    expect(await db.asUser(agentMarko, `select 1 from caller_commission_rates`)).toHaveLength(0);
    expect((await db.asUser(owner, `select 1 from caller_commission_rates`)).length).toBeGreaterThan(1);
  });

  it("new callers get the default ×1.5 automatically", async () => {
    const id = await db.createUser("caller", "Newcaller");
    expect(await callerRate(id)).toBe("1.5");
  });
});

describe("multiple visits", () => {
  it("B → A → A1 across agents keeps one customer and full history; caller keeps attribution", async () => {
    const { customer_id, appointment_id: v1 } = await createAppointment(callerAna, agentMarko, "Journey");
    await db.rpc("crm_record_result", { p_actor: agentMarko, p_appointment_id: v1, p_result: "B", p_note: null, p_next: null, p_policies: null });
    const { appointment_id: v2 } = await db.rpc<{ appointment_id: string }>("crm_schedule_appointment", {
      p_actor: callerAna, p_customer_id: customer_id, p_appointment: { agent_id: agentMarko, scheduled_at: "2026-10-22T09:00:00Z" },
    });
    const { next_appointment_id: v3 } = await db.rpc<{ next_appointment_id: string }>("crm_record_result", {
      p_actor: agentMarko, p_appointment_id: v2, p_result: "A", p_note: null, p_next: { agent_id: agentLuka, scheduled_at: "2026-10-29T09:00:00Z" }, p_policies: null,
    });
    const res = await recordA1(agentLuka, v3, [{ product_id: productIds[0], monthly_premium: "60.00", duration_years: 12, policy_date: "2026-10-29" }]);

    const p = await db.one<{ agent_id: string; caller_id: string }>(`select agent_id, caller_id from policies where id = $1`, [res.policy_ids[0]]);
    expect(p).toEqual({ agent_id: agentLuka, caller_id: callerAna });
    const overview = await db.one<Record<string, unknown>>(`select consultation_count::int, policy_count::int, status from customer_overview where id = $1`, [customer_id]);
    expect(overview).toEqual({ consultation_count: 3, policy_count: 1, status: "won" });
    expect((await db.query(`select 1 from customers where first_name = 'Journey'`)).length).toBe(1);
  });
});

describe("payroll ledger", () => {
  it("owner marks payouts paid; paid rows are final; non-owners cannot", async () => {
    const { appointment_id } = await createAppointment(callerAna, agentMarko, "Payroll");
    const res = await recordA1(agentMarko, appointment_id, [{ product_id: productIds[0], monthly_premium: "100.00", duration_years: 10, policy_date: "2026-10-01" }]);
    const [inst] = await db.query<{ id: string }>(`select id from commission_installments where policy_id = $1 and installment_number = 1 and beneficiary_type = 'agent'`, [res.policy_ids[0]]);

    await expect(db.rpc("crm_mark_installments_paid", { p_actor: agentMarko, p_installment_ids: [inst.id] })).rejects.toThrow(/lastnik/);
    expect(await db.rpc("crm_mark_installments_paid", { p_actor: owner, p_installment_ids: [inst.id] })).toBe(1);
    const paid = await db.one<Record<string, unknown>>(`select status, paid_by, paid_amount::text, original_due_date::text from commission_installments where id = $1`, [inst.id]);
    expect(paid).toEqual({ status: "paid", paid_by: owner, paid_amount: "660.00", original_due_date: "2026-11-16" });

    await expect(db.rpc("crm_mark_installments_paid", { p_actor: owner, p_installment_ids: [inst.id] })).rejects.toThrow(/že označeno/);
    await expect(db.query(`update commission_installments set due_date = '2030-01-01' where id = $1`, [inst.id])).rejects.toThrow(/no longer be modified/);
  });
});

describe("data safety", () => {
  it("blocks hard deletes of business records", async () => {
    await expect(db.query(`delete from customers`)).rejects.toThrow(/not allowed/);
    await expect(db.query(`delete from policies`)).rejects.toThrow(/not allowed/);
    await expect(db.query(`delete from commission_installments`)).rejects.toThrow(/not allowed/);
    await expect(db.query(`update activity_log set action = 'x'`)).rejects.toThrow(/append-only/);
  });
});

describe("row level security", () => {
  it("authenticated users cannot write directly or call workflow functions", async () => {
    await expect(db.asUser(callerAna, `insert into customers (first_name, last_name, phone, address, postal_code, created_by) values ('x','y','1','a','1', $1)`, [callerAna])).rejects.toThrow(/permission denied/);
    await expect(db.asUser(ownerOrThrow(), `update customers set first_name = 'hack'`)).rejects.toThrow(/permission denied/);
    await expect(db.asUser(callerAna, `select public.crm_mark_installments_paid($1, array[]::uuid[])`, [callerAna])).rejects.toThrow(/permission denied/);
  });

  it("payroll: callers and agents see only their own commissions; owner sees all", async () => {
    const all = await db.query<{ n: number }>(`select count(*)::int n from commission_installments`);
    const ownerSees = await db.asUser<{ n: number }>(owner, `select count(*)::int n from commission_installments`);
    expect(ownerSees[0].n).toBe(all[0].n);

    const anaRows = await db.asUser<{ beneficiary_id: string }>(callerAna, `select distinct beneficiary_id from commission_installments`);
    expect(anaRows.map((r) => r.beneficiary_id)).toEqual([callerAna]);
    const markoRows = await db.asUser<{ beneficiary_id: string }>(agentMarko, `select distinct beneficiary_id from commissions`);
    expect(markoRows.map((r) => r.beneficiary_id)).toEqual([agentMarko]);
    const borRows = await db.asUser<{ beneficiary_id: string }>(callerBor, `select distinct beneficiary_id from commission_installments`);
    expect(borRows.map((r) => r.beneficiary_id)).toEqual([callerBor]);

    // Agent rates are private
    expect(await db.asUser(agentMarko, `select agent_id from agent_commission_rates where agent_id <> $1`, [agentMarko])).toHaveLength(0);
    expect(await db.asUser(callerAna, `select agent_id from agent_commission_rates`)).toHaveLength(0);
  });

  it("financial activity events are hidden from non-owners", async () => {
    const rows = await db.asUser<{ action: string }>(agentMarko, `select action from activity_log where action in ('commission_generated','payout_marked_paid')`);
    expect(rows).toHaveLength(0);
    const ownerRows = await db.asUser<{ action: string }>(owner, `select action from activity_log where action = 'commission_generated'`);
    expect(ownerRows.length).toBeGreaterThan(0);
  });

  it("callers only see their own customers; agents only theirs", async () => {
    const { customer_id } = await createAppointment(callerBor, agentLuka, "Private");
    expect(await db.asUser(callerAna, `select id from customers where id = $1`, [customer_id])).toHaveLength(0);
    expect(await db.asUser(callerBor, `select id from customers where id = $1`, [customer_id])).toHaveLength(1);
    expect(await db.asUser(agentMarko, `select id from customers where id = $1`, [customer_id])).toHaveLength(0);
    expect(await db.asUser(owner, `select id from customers where id = $1`, [customer_id])).toHaveLength(1);
  });

  it("deactivated users lose all access", async () => {
    const temp = await db.createUser("agent", "Temp", "10");
    await db.rpc("crm_update_employee", { p_actor: owner, p_user_id: temp, p_changes: { is_active: false } });
    expect(await db.asUser(temp, `select id from products`)).toHaveLength(0);
    expect(await db.asUser(temp, `select id from profiles where id <> $1`, [temp])).toHaveLength(0);
    await expect(db.rpc("crm_update_employee", { p_actor: owner, p_user_id: owner, p_changes: { is_active: false } })).rejects.toThrow(/Sebi/);
  });
});

describe("demo purge", () => {
  it("removes only demo data and leaves real data untouched", async () => {
    const demoCaller = await db.createUser("caller", "Democaller", undefined, { isDemo: true });
    const demoAgent = await db.createUser("agent", "Demoagent", "10", { isDemo: true });
    const { customer_id, appointment_id } = await createAppointment(demoCaller, demoAgent, "Democust");
    await db.query(`update customers set is_demo = true where id = $1`, [customer_id]);
    await recordA1(demoAgent, appointment_id, [{ product_id: productIds[0], monthly_premium: "10.00", duration_years: 2, policy_date: "2026-10-01" }]);

    const realBefore = await db.one<{ n: number }>(`select count(*)::int n from customers where not is_demo`);
    const out = await db.rpc<{ customers_removed: number; profiles_removed: number }>("crm_purge_demo_data", {});
    expect(out).toMatchObject({ customers_removed: 1, profiles_removed: 2 });
    expect((await db.one<{ n: number }>(`select count(*)::int n from customers where not is_demo`)).n).toBe(realBefore.n);
    expect(await db.query(`select 1 from profiles where is_demo`)).toHaveLength(0);
    await expect(db.query(`delete from customers`)).rejects.toThrow(/not allowed/); // protection is back on
  });
});

function ownerOrThrow() {
  if (!owner) throw new Error("owner not set");
  return owner;
}
