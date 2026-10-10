import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TestDb } from "./harness";

let db: TestDb;
let owner: string, ana: string, bor: string, live: string;

const row = (key: string, name: string, phone: string, extra: Record<string, string> = { "Starostna skupina": "31–49 let" }, more: Record<string, unknown> = {}) => ({
  source_key: key, name, phone, email: `${name.toLowerCase().replace(/\s/g, ".")}@x.si`, created_at: "2026-10-09T10:42:56.000Z", extra, skip: false, ...more,
});
const ingest = (rows: unknown[]) => db.rpc<Record<string, unknown>>("crm_ingest_live_leads", { p_list_id: live, p_rows: rows });

beforeAll(async () => {
  db = await TestDb.create();
  owner = await db.createUser("owner", "Zan", "6");
  ana = await db.createUser("caller", "Ana");
  bor = await db.createUser("caller", "Bor");
  live = await db.rpc<string>("crm_create_live_list", {
    p_actor: owner, p_name: "Specialisti – oglasi", p_source_label: "Facebook oglas", p_source_tab: "SPECIALISTI",
    p_token_hash: "a".repeat(64), p_members: [{ caller_id: ana, notify: true }],
  });
});
afterAll(async () => db?.close());

describe("live lists", () => {
  it("ingests new contacts with submission date; the same sheet row is never imported twice", async () => {
    const r1 = await ingest([row("k1", "Natasa Pregl", "+38640166925"), row("k2", "Skip Me", "+38640000002", {}, { skip: true }), row("k3", "Bad", "00000000000")]);
    expect(r1).toMatchObject({ inserted: 1, skipped: 1, invalid: 1, reinquiries: 0 });
    const r2 = await ingest([row("k1", "Natasa Pregl", "+38640166925"), row("k2", "Skip Me", "+38640000002"), row("k4", "Janja Bizjak", "040 682 380")]);
    expect(r2).toMatchObject({ inserted: 1, skipped: 0, invalid: 0, reinquiries: 0 }); // only k4 is new
    const l = await db.one<Record<string, unknown>>(`select status, source_created_at is not null as has_date, extra->>'Starostna skupina' age from leads where phone_normalized = '+38640166925'`);
    expect(l).toEqual({ status: "new", has_date: true, age: "31–49 let" });
    expect((await db.one<{ t: boolean }>(`select last_ingest_at is not null t from lead_lists where id = $1`, [live])).t).toBe(true);
  });

  it("only the callers picked by the owner see the list; notify flag is per caller", async () => {
    const names = async (u: string) => (await db.asUser<{ name: string }>(u, `select name from lead_lists`)).map((r) => r.name);
    expect(await names(ana)).toContain("Specialisti – oglasi");
    expect(await names(bor)).not.toContain("Specialisti – oglasi");
    expect(await db.asUser(bor, `select id from leads where list_id = $1`, [live])).toHaveLength(0);

    await db.rpc("crm_update_lead_list", { p_actor: owner, p_list_id: live, p_name: "Specialisti – oglasi", p_archived: false, p_members: [{ caller_id: ana, notify: true }, { caller_id: bor, notify: false }] });
    expect(await names(bor)).toContain("Specialisti – oglasi");
    const m = await db.query<{ caller_id: string; notify: boolean }>(`select caller_id, notify from lead_list_members where list_id = $1 order by notify desc`, [live]);
    expect(m).toEqual([{ caller_id: ana, notify: true }, { caller_id: bor, notify: false }]);
    // no members = every caller
    await db.rpc("crm_update_lead_list", { p_actor: owner, p_list_id: live, p_name: "Specialisti – oglasi", p_archived: false, p_members: [] });
    expect(await names(bor)).toContain("Specialisti – oglasi");
  });

  it("duplicate from an S.P. list is moved to the live list with a notice; existing data is kept", async () => {
    const sp = await db.rpc<string>("crm_create_lead_list", { p_actor: owner, p_name: "SP Ljubljana", p_file_name: "sp.xlsx", p_assigned_caller_id: null, p_mapping: {}, p_extra_columns: [], p_total_rows: 1 });
    await db.rpc("crm_import_leads", { p_actor: owner, p_list_id: sp, p_rows: [{ row_number: 2, name: "PIA MRŠEK, SAMOSTOJNA DELAVKA", phone: "38631443031", street: "Čebelarska 26", postal_code: "1000", city: "LJUBLJANA", activity: "Oblikovanje", tax_number: "123", email: null, extra: { "Boniteta plačil": "NN" } }] });
    await db.rpc("crm_finalize_lead_list", { p_actor: owner, p_list_id: sp });
    const before = await db.one<{ id: string }>(`select id from leads where phone_normalized = '+38631443031'`);
    await db.rpc("crm_lead_set_status", { p_actor: ana, p_lead_id: before.id, p_status: "rejected", p_next_call_at: null, p_comment: "Ni časa" });

    const r = await ingest([row("k9", "Pia Mršek", "p:+38631443031".replace("p:", ""), { "Za koga": "Samo zase" })]);
    expect(r).toMatchObject({ inserted: 0, reinquiries: 1 });
    const l = await db.one<Record<string, unknown>>(
      `select id, list_id, status, name, street, city, tax_number, email, extra->>'Boniteta plačil' b, extra->>'Za koga' z, reinquiry_note, last_comment from leads where phone_normalized = '+38631443031'`,
    );
    expect(l).toMatchObject({
      id: before.id, list_id: live, status: "new",
      name: "PIA MRŠEK, SAMOSTOJNA DELAVKA", street: "Čebelarska 26", city: "LJUBLJANA", tax_number: "123", // S.P. data kept
      email: "pia.mršek@x.si", b: "NN", z: "Samo zase", last_comment: "Ni časa",
    });
    expect(String(l.reinquiry_note)).toMatch(/Dvojnik.*SP Ljubljana.*dodatno zanimala.*Prej: zavrnjen/);
    const ev = await db.query<{ action: string }>(`select action from lead_events where lead_id = $1 order by id`, [before.id]);
    expect(ev.map((e) => e.action)).toEqual(["status_changed", "reinquiry"]);
  });

  it("a new inquiry overrides an older do-not-call entry and says so", async () => {
    await db.query(`insert into lead_suppressions (phone_normalized) values ('+38641777000')`);
    const r = await ingest([row("k20", "Stara Blokada", "+38641777000")]);
    expect(r).toMatchObject({ inserted: 1 });
    expect(await db.query(`select 1 from lead_suppressions where phone_normalized = '+38641777000'`)).toHaveLength(0);
    expect((await db.one<{ n: string }>(`select reinquiry_note n from leads where phone_normalized = '+38641777000'`)).n).toMatch(/Ne želi klicev/);
  });
});

describe("new statuses", () => {
  it("'se ne javi' returns the contact tomorrow at 08:00 and counts attempts; 'neveljavna' leaves the queue", async () => {
    const lead = await db.one<{ id: string }>(`select id from leads where phone_normalized = '+38640166925'`);
    await db.rpc("crm_lead_set_status", { p_actor: ana, p_lead_id: lead.id, p_status: "no_answer", p_next_call_at: null, p_comment: null });
    await db.rpc("crm_lead_set_status", { p_actor: ana, p_lead_id: lead.id, p_status: "no_answer", p_next_call_at: null, p_comment: null });
    const l = await db.one<Record<string, unknown>>(
      `select status, no_answer_count, to_char(next_call_at at time zone 'Europe/Ljubljana', 'HH24:MI') t,
              (next_call_at at time zone 'Europe/Ljubljana')::date - (now() at time zone 'Europe/Ljubljana')::date d from leads where id = $1`,
      [lead.id],
    );
    expect(l).toEqual({ status: "no_answer", no_answer_count: 2, t: "08:00", d: 1 });
    // not due today, due once the time has come
    const stats = async () => (await db.asUser<{ due: boolean; n: number }>(owner, `select due, n::int from public.lead_list_stats() where list_id = $1 and status = 'no_answer'`, [live]))[0];
    expect(await stats()).toMatchObject({ due: false, n: 1 });
    await db.query(`update leads set next_call_at = now() - interval '1 minute' where id = $1`, [lead.id]);
    expect(await stats()).toMatchObject({ due: true, n: 1 });

    await db.rpc("crm_lead_set_status", { p_actor: ana, p_lead_id: lead.id, p_status: "invalid", p_next_call_at: null, p_comment: "Številka ne obstaja" });
    const inv = await db.one<Record<string, unknown>>(`select status, next_call_at from leads where id = $1`, [lead.id]);
    expect(inv).toEqual({ status: "invalid", next_call_at: null });
    expect(await db.query(`select 1 from lead_suppressions where phone_normalized = '+38640166925'`)).toHaveLength(0); // not a GDPR objection
  });
});
