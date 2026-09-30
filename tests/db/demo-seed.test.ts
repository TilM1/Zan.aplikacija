import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TestDb } from "./harness";
import { generateDemoSeed } from "../../scripts/demo/generate-demo-seed";
import { readFileSync } from "node:fs";
import path from "node:path";

let db: TestDb;

beforeAll(async () => {
  db = await TestDb.create();
});
afterAll(async () => db?.close());

describe("demo seed", () => {
  it("applies cleanly against the real schema and constraints", async () => {
    await db.pg.exec(generateDemoSeed("2026-09-29"));
    // A real (non-demo) customer must survive the purge later
    const owner = await db.createUser("owner", "RealOwner", "10");
    await db.rpc("crm_create_customer_with_appointment", {
      p_actor: owner,
      p_customer: { first_name: "Real", last_name: "Customer", phone: "+386 31 111 111", address: "Real 1", postal_code: "1000" },
      p_appointment: { agent_id: owner, scheduled_at: "2026-12-01T09:00:00Z" },
    });
    const counts = await db.one<Record<string, number>>(`select
      (select count(*)::int from customers where is_demo) customers,
      (select count(*)::int from profiles where is_demo) profiles,
      (select count(*)::int from policies) policies,
      (select count(*)::int from caller_followups where status = 'open') open_followups,
      (select count(*)::int from appointments where visit_number > 1) repeat_visits,
      (select count(*)::int from commission_installments where status = 'paid') paid,
      (select count(*)::int from commission_installments where status = 'scheduled' and due_date <= '2026-09-29') due`);
    expect(counts.customers).toBeGreaterThanOrEqual(25);
    expect(counts.profiles).toBe(7);
    expect(counts.policies).toBeGreaterThanOrEqual(12);
    expect(counts.open_followups).toBe(3);
    expect(counts.repeat_visits).toBeGreaterThanOrEqual(4);
    expect(counts.paid).toBeGreaterThan(0);
    expect(counts.due).toBeGreaterThan(0);
  });

  it("refuses to load demo data into a database with real users", async () => {
    const fresh = await TestDb.create();
    await fresh.createUser("owner", "Prod", "10");
    await expect(fresh.pg.exec(generateDemoSeed("2026-09-29"))).rejects.toThrow(/real users/);
    await fresh.close();
  });

  it("snapshots Luka's old 10% rate on old policies and 12% on new ones", async () => {
    const rows = await db.query<{ rate: string; policy_date: string }>(
      `select c.rate_percent::text rate, c.policy_date::text from commissions c join profiles p on p.id = c.beneficiary_id where p.first_name = 'Luka' and c.calc_model = 'standard' order by c.policy_date`,
    );
    expect(rows[0].rate).toBe("10.00"); // sold ~400 days ago
    expect(rows.at(-1)!.rate).toBe("12.00");
  });

  it("snapshots Petra's old ×1.5 and new ×2 caller multiplier", async () => {
    const rows = await db.query<{ m: string }>(
      `select c.caller_multiplier::text m from commissions c join profiles p on p.id = c.beneficiary_id where p.first_name = 'Petra' order by c.policy_date`,
    );
    expect(rows[0].m).toBe("1.500");
    expect(rows.at(-1)!.m).toBe("2.000");
  });

  it("demo customer statuses are consistent with their appointments", async () => {
    const bad = await db.query(`select c.first_name from customers c where is_demo and (
      (status = 'scheduled') <> exists (select 1 from appointments a where a.customer_id = c.id and a.status = 'scheduled'))`);
    expect(bad).toEqual([]);
  });

  it("cleanup script removes all demo data and keeps real data", async () => {
    await db.pg.exec(readFileSync(path.resolve(__dirname, "../../supabase/seed/demo-cleanup.sql"), "utf8"));
    const left = await db.one<Record<string, number>>(`select
      (select count(*)::int from profiles where is_demo) profiles,
      (select count(*)::int from customers where is_demo) customers,
      (select count(*)::int from auth.users where email like '%@demo.zan-crm.invalid') users,
      (select count(*)::int from customers where first_name = 'Real') real`);
    expect(left).toEqual({ profiles: 0, customers: 0, users: 0, real: 1 });
  });
});
