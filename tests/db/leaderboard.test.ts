import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TestDb } from "./harness";
import { buildPoliciesPayload } from "@/lib/commission/payload";

let db: TestDb;
let owner: string, marko: string, luka: string, ana: string, bor: string;

async function sell(caller: string, agent: string, premium: string, date: string) {
  const { appointment_id } = await db.rpc<{ appointment_id: string }>("crm_create_customer_with_appointment", {
    p_actor: caller,
    p_customer: { first_name: "K", last_name: premium, phone: `+38640${Math.floor(Math.random() * 1e7)}`, address: "U 1", postal_code: "1000" },
    p_appointment: { agent_id: agent, scheduled_at: `${date}T08:00:00Z` },
  });
  const [{ id: product }] = await db.query<{ id: string }>(`select id from products order by sort_order limit 1`);
  const payload = buildPoliciesPayload([{ product_id: product, monthly_premium: premium, duration_years: 10, policy_date: date }], { agentRatePercent: "10.00", callerMultiplier: "1.5" });
  await db.rpc("crm_record_result", { p_actor: agent, p_appointment_id: appointment_id, p_result: "A1", p_note: null, p_next: null, p_policies: payload });
}

beforeAll(async () => {
  db = await TestDb.create();
  owner = await db.createUser("owner", "Zan", "15");
  marko = await db.createUser("agent", "Marko", "10");
  luka = await db.createUser("agent", "Luka", "10");
  ana = await db.createUser("caller", "Ana");
  bor = await db.createUser("caller", "Bor");
  await sell(ana, marko, "100.00", "2026-10-05");
  await sell(ana, marko, "50.00", "2026-10-06");
  await sell(bor, luka, "200.00", "2026-10-07");
  await sell(bor, luka, "80.00", "2026-09-20"); // previous month
});
afterAll(async () => db?.close());

describe("leaderboard", () => {
  it("every active user sees monthly aggregates of everyone (no customer data)", async () => {
    const rows = await db.asUser<{ kind: string; user_id: string; policies: number; premium: string; successful: number; booked: number }>(
      bor,
      `select kind, user_id, policies, premium::text, successful, booked from public.leaderboard('2026-10-15')`,
    );
    const get = (id: string) => rows.find((r) => r.user_id === id)!;
    expect(get(marko)).toMatchObject({ kind: "agent", policies: 2, premium: "150.00" });
    expect(get(luka)).toMatchObject({ kind: "agent", policies: 1, premium: "200.00" });
    expect(get(ana)).toMatchObject({ kind: "caller", policies: 2 });
    expect(get(bor)).toMatchObject({ kind: "caller", policies: 1 });
    expect(rows.some((r) => r.user_id === owner && r.kind === "agent")).toBe(true);

    // Consultations count in the month they were completed (today in this test)
    const now = await db.asUser<{ user_id: string; consultations: number; successful: number; booked: number }>(ana, `select user_id, consultations, successful, booked from public.leaderboard(current_date)`);
    expect(now.find((r) => r.user_id === marko)).toMatchObject({ consultations: 2, successful: 2 });
    expect(now.find((r) => r.user_id === ana)).toMatchObject({ booked: 2 });
  });

  it("returns nothing without an active CRM session", async () => {
    await db.rpc("crm_update_employee", { p_actor: owner, p_user_id: bor, p_changes: { is_active: false } });
    expect(await db.asUser(bor, `select * from public.leaderboard('2026-10-15')`)).toHaveLength(0);
    await db.rpc("crm_update_employee", { p_actor: owner, p_user_id: bor, p_changes: { is_active: true } });
  });

  it("only the owner sets prizes; everyone can read them", async () => {
    await db.rpc("crm_set_leaderboard_prizes", { p_actor: owner, p_month: "2026-10-10", p_agent_prize: "Večerja za dva", p_caller_prize: "Bon 100 €" });
    await expect(db.rpc("crm_set_leaderboard_prizes", { p_actor: marko, p_month: "2026-10-10", p_agent_prize: "x", p_caller_prize: "y" })).rejects.toThrow(/lastnik/);
    const p = await db.asUser<{ month: string; agent_prize: string }>(ana, `select month::text, agent_prize from leaderboard_prizes`);
    expect(p).toEqual([{ month: "2026-10-01", agent_prize: "Večerja za dva" }]);
  });
});
