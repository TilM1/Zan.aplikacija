import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TestDb } from "./harness";

let db: TestDb;
let owner: string, marko: string, luka: string, ana: string, customerId: string;

beforeAll(async () => {
  db = await TestDb.create();
  owner = await db.createUser("owner", "Owner", "15");
  marko = await db.createUser("agent", "Marko", "10");
  luka = await db.createUser("agent", "Luka", "10");
  ana = await db.createUser("caller", "Ana");
  const res = await db.rpc<{ customer_id: string }>("crm_create_customer_with_appointment", {
    p_actor: ana,
    p_customer: { first_name: "Janez", last_name: "Novak", phone: "041 555 111", address: "Ulica 1", postal_code: "1000" },
    p_appointment: { agent_id: marko, scheduled_at: "2026-10-01T08:00:00Z" },
  });
  customerId = res.customer_id;
});
afterAll(async () => db?.close());

describe("skadence (expiries)", () => {
  it("the agent records expiries; reminders are assigned to them and private", async () => {
    const n = await db.rpc<number>("crm_add_expiries", {
      p_actor: marko,
      p_customer_id: customerId,
      p_items: [
        { category: "avto", description: "AO + kasko, Golf", insurer: "Triglav", expiry_date: "2026-11-10", note: "" },
        { category: "dom", description: "Hiša", insurer: "Generali", expiry_date: "2027-03-01" },
      ],
    });
    expect(n).toBe(2);
    const rows = await db.asUser<{ assigned_agent_id: string }>(marko, `select assigned_agent_id from customer_expiries where customer_id = $1`, [customerId]);
    expect(rows.map((r) => r.assigned_agent_id)).toEqual([marko, marko]);
    expect(await db.asUser(luka, `select id from customer_expiries`)).toHaveLength(0);
    expect(await db.asUser(ana, `select id from customer_expiries`)).toHaveLength(0);
    expect(await db.asUser(owner, `select id from customer_expiries`)).toHaveLength(2);
    await expect(db.rpc("crm_add_expiries", { p_actor: ana, p_customer_id: customerId, p_items: [{ category: "avto", expiry_date: "2026-12-01" }] })).rejects.toThrow(/zastopniki/);
    await expect(db.rpc("crm_add_expiries", { p_actor: luka, p_customer_id: customerId, p_items: [{ category: "avto", expiry_date: "2026-12-01" }] })).rejects.toThrow(/zastopniki/);
  });

  it("done with repeat creates next year's expiry; only the assignee or owner can update", async () => {
    const [e] = await db.query<{ id: string }>(`select id from customer_expiries where category = 'avto'`);
    await expect(db.rpc("crm_update_expiry", { p_actor: luka, p_expiry_id: e.id, p_status: "done", p_outcome: null, p_snooze_until: null, p_repeat_next_year: false })).rejects.toThrow(/ni dodeljena/);
    const next = await db.rpc<string>("crm_update_expiry", { p_actor: marko, p_expiry_id: e.id, p_status: "done", p_outcome: "Podpisal kasko pri nas", p_snooze_until: null, p_repeat_next_year: true });
    const n = await db.one<Record<string, unknown>>(`select expiry_date::text, status, assigned_agent_id from customer_expiries where id = $1`, [next]);
    expect(n).toEqual({ expiry_date: "2027-11-10", status: "open", assigned_agent_id: marko });
    const snooze = await db.query<{ id: string }>(`select id from customer_expiries where category = 'dom'`);
    await db.rpc("crm_update_expiry", { p_actor: owner, p_expiry_id: snooze[0].id, p_status: "open", p_outcome: "Pokliči po novem letu", p_snooze_until: "2027-01-05", p_repeat_next_year: false });
    expect((await db.one<{ s: string }>(`select snoozed_until::text s from customer_expiries where id = $1`, [snooze[0].id])).s).toBe("2027-01-05");
  });

  it("owner sets the reminder window", async () => {
    await db.rpc("crm_set_expiry_reminder_days", { p_actor: owner, p_days: 21 });
    expect((await db.one<{ v: string }>(`select value::text v from app_settings where key = 'expiry_reminder_days'`)).v).toBe("21");
    await expect(db.rpc("crm_set_expiry_reminder_days", { p_actor: marko, p_days: 5 })).rejects.toThrow(/lastnik/);
  });

  it("customer deletion backup includes expiries and restores them", async () => {
    const before = (await db.one<{ n: number }>(`select count(*)::int n from customer_expiries where customer_id = $1`, [customerId])).n;
    const backup = await db.rpc<string>("crm_delete_customer", { p_actor: owner, p_customer_id: customerId, p_reason: "test" });
    expect((await db.one<{ n: number }>(`select count(*)::int n from customer_expiries where customer_id = $1`, [customerId])).n).toBe(0);
    await db.rpc("crm_restore_customer", { p_actor: owner, p_backup_id: backup });
    expect((await db.one<{ n: number }>(`select count(*)::int n from customer_expiries where customer_id = $1`, [customerId])).n).toBe(before);
  });
});
