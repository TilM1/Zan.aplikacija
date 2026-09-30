import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TestDb } from "./harness";
import { buildPoliciesPayload } from "@/lib/commission/payload";

let db: TestDb;
let owner: string, agent: string, caller: string;
let productId: string;

async function sale(name: string, premium = "100.00") {
  const { customer_id, appointment_id } = await db.rpc<{ customer_id: string; appointment_id: string }>("crm_create_customer_with_appointment", {
    p_actor: caller,
    p_customer: { first_name: name, last_name: "Test", phone: `+38641${String(Math.floor(Math.random() * 1e6)).padStart(6, "0")}`, address: "Ulica 1", postal_code: "1000" },
    p_appointment: { agent_id: agent, scheduled_at: "2026-10-01T08:00:00Z" },
  });
  const payload = buildPoliciesPayload([{ product_id: productId, monthly_premium: premium, duration_years: 10, policy_date: "2026-10-01" }], {
    agentRatePercent: "10.00",
    callerMultiplier: "1.5",
  });
  const res = await db.rpc<{ policy_ids: string[] }>("crm_record_result", {
    p_actor: agent, p_appointment_id: appointment_id, p_result: "A1", p_note: null, p_next: null, p_policies: payload,
  });
  return { customer_id, policy_id: res.policy_ids[0] };
}

const installments = (policyId: string) =>
  db.query<{ beneficiary_type: string; installment_number: number; kind: string; amount: string; status: string; due_date: string }>(
    `select beneficiary_type, installment_number, kind, amount::text, status, due_date::text from commission_installments where policy_id = $1 order by kind, beneficiary_type, installment_number`,
    [policyId],
  );

beforeAll(async () => {
  db = await TestDb.create();
  owner = await db.createUser("owner", "Owner", "15");
  agent = await db.createUser("agent", "Marko", "10");
  caller = await db.createUser("caller", "Ana");
  productId = (await db.one<{ id: string }>(`select id from products order by sort_order limit 1`)).id;
});
afterAll(async () => db?.close());

describe("storno", () => {
  it("cancels unpaid installments and claws back paid ones on the next payout date", async () => {
    const { customer_id, policy_id } = await sale("Storno");
    // Agent's 1st installment (660) and caller's commission (150) were already paid
    const paid = await db.query<{ id: string }>(`select id from commission_installments where policy_id = $1 and installment_number = 1`, [policy_id]);
    await db.rpc("crm_mark_installments_paid", { p_actor: owner, p_installment_ids: paid.map((p) => p.id) });

    await expect(db.rpc("crm_storno_policy", { p_actor: agent, p_policy_id: policy_id, p_reason: "x", p_clawback_due: "2026-11-16" })).rejects.toThrow(/lastnik/);
    const res = await db.rpc<Record<string, unknown>>("crm_storno_policy", {
      p_actor: owner, p_policy_id: policy_id, p_reason: "Zavarovalnica zavrnila – zdravstveni pogoji", p_clawback_due: "2026-11-16",
    });
    expect(res).toMatchObject({ cancelled_count: 2, clawback_count: 2 });
    expect(Number(res.cancelled_sum)).toBe(540); // 240 + 300 not yet paid
    expect(Number(res.clawback_sum)).toBe(810); // 660 + 150 already paid

    expect(await installments(policy_id)).toEqual([
      { beneficiary_type: "agent", installment_number: 1, kind: "regular", amount: "660.00", status: "paid", due_date: "2026-11-16" },
      { beneficiary_type: "agent", installment_number: 2, kind: "regular", amount: "240.00", status: "cancelled", due_date: "2027-11-16" },
      { beneficiary_type: "agent", installment_number: 3, kind: "regular", amount: "300.00", status: "cancelled", due_date: "2028-11-16" },
      { beneficiary_type: "caller", installment_number: 1, kind: "regular", amount: "150.00", status: "paid", due_date: "2026-11-16" },
      { beneficiary_type: "agent", installment_number: 101, kind: "clawback", amount: "-660.00", status: "scheduled", due_date: "2026-11-16" },
      { beneficiary_type: "caller", installment_number: 101, kind: "clawback", amount: "-150.00", status: "scheduled", due_date: "2026-11-16" },
    ]);
    const p = await db.one<Record<string, unknown>>(`select status, cancel_reason from policies where id = $1`, [policy_id]);
    expect(p).toEqual({ status: "cancelled", cancel_reason: "Zavarovalnica zavrnila – zdravstveni pogoji" });
    expect((await db.one<{ status: string }>(`select status from customers where id = $1`, [customer_id])).status).toBe("lost");
    expect((await db.query(`select 1 from commissions where policy_id = $1 and status = 'cancelled'`, [policy_id])).length).toBe(2);

    // Agent sees the deduction in their own ledger; net unpaid for this policy = -660
    const net = await db.asUser<{ s: string }>(agent, `select sum(amount)::text s from commission_installments where policy_id = $1 and status = 'scheduled'`, [policy_id]);
    expect(net[0].s).toBe("-660.00");
    await expect(db.rpc("crm_storno_policy", { p_actor: owner, p_policy_id: policy_id, p_reason: "x", p_clawback_due: "2026-11-16" })).rejects.toThrow(/že stornirana/);
    await expect(db.query(`update commission_installments set status = 'scheduled' where policy_id = $1 and status = 'paid'`, [policy_id])).rejects.toThrow(/no longer be modified/);
  });

  it("can be reverted while the deduction is not settled; not afterwards", async () => {
    const { policy_id } = await sale("Revert");
    const paid = await db.query<{ id: string }>(`select id from commission_installments where policy_id = $1 and installment_number = 1 and beneficiary_type = 'agent'`, [policy_id]);
    await db.rpc("crm_mark_installments_paid", { p_actor: owner, p_installment_ids: [paid[0].id] });
    const before = await installments(policy_id);
    const { backup_id } = await db.rpc<{ backup_id: string }>("crm_storno_policy", { p_actor: owner, p_policy_id: policy_id, p_reason: "Pomota", p_clawback_due: "2026-11-16" });

    await db.rpc("crm_revert_storno", { p_actor: owner, p_backup_id: backup_id });
    expect(await installments(policy_id)).toEqual(before);
    expect((await db.one<{ status: string }>(`select status from policies where id = $1`, [policy_id])).status).toBe("active");
    await expect(db.rpc("crm_revert_storno", { p_actor: owner, p_backup_id: backup_id })).rejects.toThrow(/že razveljavljen/);

    // Storno again, settle the deduction → revert no longer possible
    const again = await db.rpc<{ backup_id: string }>("crm_storno_policy", { p_actor: owner, p_policy_id: policy_id, p_reason: "Res zavrnjena", p_clawback_due: "2026-11-16" });
    const claw = await db.query<{ id: string }>(`select id from commission_installments where policy_id = $1 and kind = 'clawback'`, [policy_id]);
    await db.rpc("crm_mark_installments_paid", { p_actor: owner, p_installment_ids: claw.map((c) => c.id) });
    await expect(db.rpc("crm_revert_storno", { p_actor: owner, p_backup_id: again.backup_id })).rejects.toThrow(/že obračunan/);
  });
});

describe("customer deletion with backup", () => {
  it("is blocked once commissions were paid", async () => {
    const { customer_id, policy_id } = await sale("Paid");
    const paid = await db.query<{ id: string }>(`select id from commission_installments where policy_id = $1 and beneficiary_type = 'caller'`, [policy_id]);
    await db.rpc("crm_mark_installments_paid", { p_actor: owner, p_installment_ids: [paid[0].id] });
    await expect(db.rpc("crm_delete_customer", { p_actor: owner, p_customer_id: customer_id, p_reason: "x" })).rejects.toThrow(/storno/);
  });

  it("deletes everything into a backup and restores it exactly", async () => {
    const { customer_id } = await sale("Delete");
    await db.rpc("crm_add_customer_note", { p_actor: caller, p_customer_id: customer_id, p_note: "Opomba" });
    const counts = async () =>
      db.one<Record<string, number>>(
        `select (select count(*)::int from customers where id = $1) c,
                (select count(*)::int from appointments where customer_id = $1) a,
                (select count(*)::int from policies where customer_id = $1) p,
                (select count(*)::int from commission_installments i join policies p on p.id = i.policy_id where p.customer_id = $1) i,
                (select count(*)::int from activity_log where customer_id = $1) l`,
        [customer_id],
      );
    const before = await counts();
    expect(before).toMatchObject({ c: 1, a: 1, p: 1, i: 4 });

    await expect(db.rpc("crm_delete_customer", { p_actor: agent, p_customer_id: customer_id, p_reason: "x" })).rejects.toThrow(/lastnik/);
    const backupId = await db.rpc<string>("crm_delete_customer", { p_actor: owner, p_customer_id: customer_id, p_reason: "Vnesena po pomoti" });
    expect(await counts()).toEqual({ c: 0, a: 0, p: 0, i: 0, l: 0 });

    // Backup visible to owner only
    expect(await db.asUser(owner, `select id from deleted_records where id = $1`, [backupId])).toHaveLength(1);
    expect(await db.asUser(agent, `select id from deleted_records`)).toHaveLength(0);
    expect(await db.asUser(caller, `select id from deleted_records`)).toHaveLength(0);

    await db.rpc("crm_restore_customer", { p_actor: owner, p_backup_id: backupId });
    const after = await counts();
    expect(after).toEqual({ ...before, l: before.l + 1 }); // + "customer_restored" event
    await expect(db.rpc("crm_restore_customer", { p_actor: owner, p_backup_id: backupId })).rejects.toThrow(/že obnovljena/);
  });

  it("GDPR: a deletion backup can be purged; storno backups cannot", async () => {
    const { customer_id, policy_id } = await sale("Gdpr");
    const storno = await db.rpc<{ backup_id: string }>("crm_storno_policy", { p_actor: owner, p_policy_id: policy_id, p_reason: "x", p_clawback_due: "2026-11-16" });
    await expect(db.rpc("crm_purge_deleted_record", { p_actor: owner, p_backup_id: storno.backup_id })).rejects.toThrow(/finančne sledi/);
    const del = await db.rpc<string>("crm_delete_customer", { p_actor: owner, p_customer_id: customer_id, p_reason: "Zahteva za izbris" });
    await db.rpc("crm_purge_deleted_record", { p_actor: owner, p_backup_id: del });
    expect(await db.query(`select 1 from deleted_records where id = $1`, [del])).toHaveLength(0);
  });
});
