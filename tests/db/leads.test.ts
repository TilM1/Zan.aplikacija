import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TestDb } from "./harness";
import { normalizePhone } from "@/lib/phone";
import { chunkRows } from "@/lib/leads/import";

let db: TestDb;
let owner: string, agent: string, ana: string, bor: string;

const row = (i: number, phone: string, extra: Record<string, unknown> = {}) => ({
  row_number: i,
  name: `PODJETJE ${i}, JANEZ NOVAK S.P.`,
  phone,
  street: `Ulica ${i}`,
  postal_code: i % 2 ? "1000" : "2000",
  city: i % 2 ? "LJUBLJANA" : "MARIBOR",
  activity: "Svetovanje",
  tax_number: String(10000000 + i),
  email: null,
  extra: { "Boniteta plačil": "NN", ...extra },
});

async function newList(assigned: string | null = null, name = "Seznam") {
  return db.rpc<string>("crm_create_lead_list", {
    p_actor: owner, p_name: name, p_file_name: "test.xlsx", p_assigned_caller_id: assigned, p_mapping: {}, p_extra_columns: [], p_total_rows: 0,
  });
}

beforeAll(async () => {
  db = await TestDb.create();
  owner = await db.createUser("owner", "Owner", "15");
  agent = await db.createUser("agent", "Marko", "10");
  ana = await db.createUser("caller", "Ana");
  bor = await db.createUser("caller", "Bor");
});
afterAll(async () => db?.close());

describe("phone normalisation", () => {
  it("SQL and TypeScript agree", async () => {
    for (const p of ["38631443031", "041 123 456", "+386 41 123 456", "0038641123456", "01/234-56-78", "+49 170 1234567"]) {
      const sql = await db.one<{ n: string | null }>(`select public.crm_normalize_phone($1) n`, [p]);
      expect(sql.n).toBe(normalizePhone(p));
    }
  });
});

describe("import", () => {
  it("imports rows, skips invalid rows and duplicate phones (in chunk and across lists)", async () => {
    const list = await newList(null, "Ljubljana april");
    const res = await db.rpc<Record<string, number>>("crm_import_leads", {
      p_actor: owner,
      p_list_id: list,
      p_rows: [row(2, "38631000001"), row(3, "031 000 001"), row(4, ""), { ...row(5, "38631000002"), name: "" }, row(6, "38631000003")],
    });
    expect(res).toEqual({ inserted: 2, invalid: 2, suppressed: 0, duplicates: 1 });
    await db.rpc("crm_finalize_lead_list", { p_actor: owner, p_list_id: list });

    const list2 = await newList();
    const res2 = await db.rpc<Record<string, number>>("crm_import_leads", { p_actor: owner, p_list_id: list2, p_rows: [row(2, "+386 31 000 003"), row(3, "38631000004")] });
    expect(res2).toMatchObject({ inserted: 1, duplicates: 1 });
    const l = await db.one<Record<string, unknown>>(`select phone_normalized, extra->>'Boniteta plačil' b from leads where phone_normalized = '+38631000004'`);
    expect(l).toEqual({ phone_normalized: "+38631000004", b: "NN" });
  });

  it("only the owner can import; closed lists reject more rows", async () => {
    const list = await newList();
    await expect(db.rpc("crm_import_leads", { p_actor: ana, p_list_id: list, p_rows: [row(2, "38631000099")] })).rejects.toThrow(/lastnik/);
    await db.rpc("crm_finalize_lead_list", { p_actor: owner, p_list_id: list });
    await expect(db.rpc("crm_import_leads", { p_actor: owner, p_list_id: list, p_rows: [row(2, "38631000098")] })).rejects.toThrow(/ni več odprt/);
  });
});

describe("access", () => {
  it("callers see ready lists for all callers or assigned to them; agents see none", async () => {
    const forBor = await newList(bor, "Samo Bor");
    await db.rpc("crm_import_leads", { p_actor: owner, p_list_id: forBor, p_rows: [row(2, "38640000001")] });
    const importing = await newList(null, "Še uvažam");
    await db.rpc("crm_import_leads", { p_actor: owner, p_list_id: importing, p_rows: [row(2, "38640000002")] });
    await db.rpc("crm_finalize_lead_list", { p_actor: owner, p_list_id: forBor });

    const names = async (u: string) => (await db.asUser<{ name: string }>(u, `select name from lead_lists order by name`)).map((r) => r.name);
    expect(await names(bor)).toContain("Samo Bor");
    expect(await names(ana)).not.toContain("Samo Bor");
    expect(await names(ana)).not.toContain("Še uvažam"); // not finalized yet
    expect(await names(owner)).toEqual(expect.arrayContaining(["Samo Bor", "Še uvažam"]));
    expect(await db.asUser(agent, `select id from leads`)).toHaveLength(0);
    expect(await db.asUser(ana, `select id from leads where phone_normalized = '+38640000001'`)).toHaveLength(0);
    await expect(db.asUser(ana, `select * from lead_suppressions`)).rejects.toThrow(/permission denied/);
    await expect(db.asUser(ana, `update leads set status = 'rejected'`)).rejects.toThrow(/permission denied/);

    // Caller cannot change a lead of a list they cannot see
    const [lead] = await db.query<{ id: string }>(`select id from leads where phone_normalized = '+38640000001'`);
    await expect(db.rpc("crm_lead_set_status", { p_actor: ana, p_lead_id: lead.id, p_status: "rejected", p_next_call_at: null, p_comment: null })).rejects.toThrow(/dostopa/);
  });
});

describe("statuses", () => {
  let leadId: string;
  beforeAll(async () => {
    const list = await newList(null, "Statusi");
    await db.rpc("crm_import_leads", { p_actor: owner, p_list_id: list, p_rows: [row(2, "38651000001"), row(3, "38651000002"), row(4, "38651000003")] });
    await db.rpc("crm_finalize_lead_list", { p_actor: owner, p_list_id: list });
    leadId = (await db.one<{ id: string }>(`select id from leads where phone_normalized = '+38651000001'`)).id;
  });

  it("callback requires a future date and keeps history", async () => {
    await expect(db.rpc("crm_lead_set_status", { p_actor: ana, p_lead_id: leadId, p_status: "callback", p_next_call_at: null, p_comment: "" })).rejects.toThrow(/datum/);
    const when = new Date(Date.now() + 3 * 86400_000).toISOString();
    await db.rpc("crm_lead_set_status", { p_actor: ana, p_lead_id: leadId, p_status: "callback", p_next_call_at: when, p_comment: "Pokliči v četrtek" });
    await db.rpc("crm_lead_add_comment", { p_actor: bor, p_lead_id: leadId, p_comment: "Ima že zavarovanje do junija" });
    const l = await db.one<Record<string, unknown>>(`select status, contact_count, last_comment, last_contacted_by from leads where id = $1`, [leadId]);
    expect(l).toEqual({ status: "callback", contact_count: 1, last_comment: "Ima že zavarovanje do junija", last_contacted_by: ana });
    const ev = await db.asUser<{ action: string }>(ana, `select action from lead_events where lead_id = $1 order by id`, [leadId]);
    expect(ev.map((e) => e.action)).toEqual(["status_changed", "comment"]);
  });

  it("rejected schedules a recall after the owner-defined period", async () => {
    await db.rpc("crm_set_setting", { p_actor: owner, p_key: "lead_rejected_recall_months", p_value: 3 });
    await expect(db.rpc("crm_set_setting", { p_actor: ana, p_key: "lead_rejected_recall_months", p_value: 1 })).rejects.toThrow(/lastnik/);
    await expect(db.rpc("crm_set_setting", { p_actor: owner, p_key: "lead_rejected_recall_months", p_value: 0 })).rejects.toThrow(/med 1 in 60/);
    const id = (await db.one<{ id: string }>(`select id from leads where phone_normalized = '+38651000002'`)).id;
    await db.rpc("crm_lead_set_status", { p_actor: ana, p_lead_id: id, p_status: "rejected", p_next_call_at: null, p_comment: "Ne zanima" });
    const r = await db.one<{ months: number }>(`select round(extract(epoch from next_call_at - now()) / 86400 / 30)::int months from leads where id = $1`, [id]);
    expect(r.months).toBe(3);
  });

  it("do-not-call is permanent: the number is never imported again, even after the list is deleted", async () => {
    const id = (await db.one<{ id: string }>(`select id from leads where phone_normalized = '+38651000003'`)).id;
    await db.rpc("crm_lead_set_status", { p_actor: ana, p_lead_id: id, p_status: "do_not_call", p_next_call_at: null, p_comment: "Ne želi klicev" });
    const listId = (await db.one<{ list_id: string }>(`select list_id from leads where id = $1`, [id])).list_id;
    expect(await db.rpc<number>("crm_delete_lead_list", { p_actor: owner, p_list_id: listId })).toBe(3);

    const list = await newList();
    const res = await db.rpc<Record<string, number>>("crm_import_leads", { p_actor: owner, p_list_id: list, p_rows: [row(2, "051 000 003"), row(3, "38651000001")] });
    expect(res).toMatchObject({ inserted: 1, suppressed: 1 }); // 051000003 blocked; 051000001 re-importable after deletion
  });
});

describe("conversion to appointment", () => {
  it("creates customer + appointment, marks the lead and keeps caller attribution", async () => {
    const list = await newList(null, "Konverzija");
    await db.rpc("crm_import_leads", { p_actor: owner, p_list_id: list, p_rows: [row(2, "38670000001")] });
    await db.rpc("crm_finalize_lead_list", { p_actor: owner, p_list_id: list });
    const lead = await db.one<{ id: string }>(`select id from leads where phone_normalized = '+38670000001'`);

    const res = await db.rpc<{ customer_id: string }>("crm_create_customer_with_appointment", {
      p_actor: ana,
      p_customer: { first_name: "Janez", last_name: "Novak", phone: "070 000 001", address: "Ulica 2", postal_code: "1000" },
      p_appointment: { agent_id: agent, scheduled_at: "2026-11-02T09:00:00Z" },
      p_lead_id: lead.id,
    });
    const l = await db.one<Record<string, unknown>>(`select status, customer_id from leads where id = $1`, [lead.id]);
    expect(l).toEqual({ status: "appointment", customer_id: res.customer_id });
    const c = await db.one<Record<string, unknown>>(`select responsible_caller_id, phone_normalized from customers where id = $1`, [res.customer_id]);
    expect(c).toEqual({ responsible_caller_id: ana, phone_normalized: "+38670000001" });
    await expect(
      db.rpc("crm_create_customer_with_appointment", {
        p_actor: ana,
        p_customer: { first_name: "Janez", last_name: "Novak", phone: "070 000 001", address: "Ulica 2", postal_code: "1000" },
        p_appointment: { agent_id: agent, scheduled_at: "2026-11-03T09:00:00Z" },
        p_lead_id: lead.id,
      }),
    ).rejects.toThrow(/že dogovorjen/);
  });
});

describe("scale", () => {
  it("imports 50,000 contacts in chunks and filters them quickly", async () => {
    const list = await newList(null, "50k");
    const rows = Array.from({ length: 50_000 }, (_, i) =>
      row(i + 2, `+3869${String(i).padStart(7, "0")}`, { "Fin. leto": "2025", "Povp. mes. plača": String(i % 3000) }),
    );
    const t0 = Date.now();
    let inserted = 0;
    for (const chunk of chunkRows(rows)) {
      inserted += (await db.rpc<{ inserted: number }>("crm_import_leads", { p_actor: owner, p_list_id: list, p_rows: chunk })).inserted;
    }
    await db.rpc("crm_finalize_lead_list", { p_actor: owner, p_list_id: list });
    const importMs = Date.now() - t0;
    expect(inserted).toBe(50_000);

    const t1 = Date.now();
    const page = await db.asUser<{ id: string }>(
      ana,
      `select id from leads where list_id = $1 and lower(city) = 'ljubljana' and (status = 'new' or (status in ('callback','rejected') and next_call_at <= now())) order by row_number limit 50`,
      [list],
    );
    const cnt = await db.asUser<{ n: number }>(ana, `select count(*)::int n from leads where list_id = $1 and search_text like '%podjetje 4999%'`, [list]);
    const queryMs = Date.now() - t1;
    expect(page).toHaveLength(50);
    expect(cnt[0].n).toBeGreaterThan(0);
    console.log(`50k import (in-process PGlite): ${importMs} ms, filtered queries: ${queryMs} ms`);
  }, 300_000);
});
