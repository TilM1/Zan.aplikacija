/**
 * Generates supabase/seed/demo-seed.sql — clearly identifiable, removable demo
 * data (profiles.is_demo / customers.is_demo = true, e-mails @demo.zan-crm.si).
 *
 * All commission amounts and payout dates come from the real commission
 * engine (src/lib/commission), so demo data follows production rules.
 * Dates are relative to the day the seed is generated.
 *
 *   npm run demo:generate        → writes the SQL file
 *   npm run demo:seed            → generates + applies it (needs SUPABASE_DB_URL)
 *   npm run demo:cleanup         → removes all demo data
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { buildPoliciesPayload, type PolicyEntry } from "../../src/lib/commission/payload";
import { addDays, localDateTimeToIso, todayIso } from "../../src/lib/dates";

export const DEMO_PASSWORD = "Demo-Zan-2026!";
// .invalid is reserved (RFC 2606): nobody can ever receive mail for these addresses.
export const DEMO_EMAIL_DOMAIN = "demo.zan-crm.invalid";

type Role = "owner" | "agent" | "caller";
type Result = "A" | "A0" | "A1" | "B";

interface DemoUser {
  id: string;
  first: string;
  last: string;
  role: Role;
  email: string;
  rates?: { from: string; rate: string }[]; // ISO date → rate (history)
}

const lit = (v: unknown): string => {
  if (v === null || v === undefined) return "null";
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "object") return `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;
  return `'${String(v).replace(/'/g, "''")}'`;
};

export function generateDemoSeed(today = todayIso()): string {
  const out: string[] = [];
  const sql = (s: string) => out.push(s);
  const d = (offset: number) => addDays(today, offset);
  const at = (offset: number, time: string) => localDateTimeToIso(d(offset), time);
  const stampAfter = (iso: string, minutes: number) => new Date(new Date(iso).getTime() + minutes * 60_000).toISOString();

  // -------------------------------------------------------------------------
  // Users
  // -------------------------------------------------------------------------
  const mk = (first: string, last: string, role: Role, rates?: { from: string; rate: string }[]): DemoUser => ({
    id: randomUUID(),
    first,
    last,
    role,
    email: `${first}.${last}`.toLowerCase().normalize("NFKD").replace(/[^\w.]/g, "") + `@${DEMO_EMAIL_DOMAIN}`,
    rates,
  });
  const owner = mk("Tomaž", "Lastnik", "owner", [{ from: d(-900), rate: "15.00" }]);
  const marko = mk("Marko", "Kovač", "agent", [{ from: d(-900), rate: "10.00" }]);
  const luka = mk("Luka", "Horvat", "agent", [
    { from: d(-900), rate: "10.00" },
    { from: d(-60), rate: "12.00" }, // raise → only newer policies use 12 %
  ]);
  const nina = mk("Nina", "Zupan", "agent", [{ from: d(-400), rate: "11.50" }]);
  const ana = mk("Ana", "Novak", "caller", [{ from: d(-900), rate: "1.5" }]);
  const petra = mk("Petra", "Krajnc", "caller", [
    { from: d(-900), rate: "1.5" },
    { from: d(-10), rate: "2" }, // raise → only policies saved after it use ×2
  ]);
  const jure = mk("Jure", "Golob", "caller", [{ from: d(-900), rate: "1.5" }]);
  const users = [owner, marko, luka, nina, ana, petra, jure];

  // Specialisti: agent total = monthly premium × the agent's own number
  const SPECIALIST_MULTIPLIER: Record<string, string> = { Tomaž: "14", Marko: "12", Luka: "10", Nina: "11" };

  const rateAt = (u: DemoUser, date: string) => [...(u.rates ?? [])].filter((r) => r.from <= date).sort((a, b) => b.from.localeCompare(a.from))[0].rate;

  sql(`-- ZAN CRM demo data — generated ${today}. Remove with supabase/seed/demo-cleanup.sql`);
  sql(`begin;`);
  sql(`do $$ begin
  if exists (select 1 from public.profiles where is_demo) then
    raise exception 'Demo data already exists. Run supabase/seed/demo-cleanup.sql first.';
  end if;
  if exists (select 1 from public.profiles where not is_demo) then
    raise exception 'This database has real users (production?). Demo data can only be loaded into an empty/staging database.';
  end if;
end $$;`);

  for (const u of users) {
    sql(`insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
values ('00000000-0000-0000-0000-000000000000', ${lit(u.id)}, 'authenticated', 'authenticated', ${lit(u.email)}, extensions.crypt(${lit(DEMO_PASSWORD)}, extensions.gen_salt('bf')), now(), ${lit({ provider: "email", providers: ["email"], app: "zan_crm", demo: true })}, ${lit({ first_name: u.first, last_name: u.last })}, now(), now(), '', '', '', '');`);
    sql(`insert into auth.identities (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
values (${lit(randomUUID())}, ${lit(u.id)}, ${lit(u.id)}, ${lit({ sub: u.id, email: u.email, email_verified: true })}, 'email', now(), now(), now());`);
    sql(`insert into public.profiles (id, first_name, last_name, email, phone, role, is_demo, created_at) values (${lit(u.id)}, ${lit(u.first)}, ${lit(u.last)}, ${lit(u.email)}, ${lit("+386 40 000 " + String(users.indexOf(u) + 100))}, ${lit(u.role)}, true, ${lit(at(-900, "08:00"))});`);
    for (const r of u.rates ?? []) {
      const at8 = lit(localDateTimeToIso(r.from, "08:00"));
      if (u.role === "caller") {
        sql(`insert into public.caller_commission_rates (caller_id, multiplier, effective_from, set_by, created_at) values (${lit(u.id)}, ${r.rate}, ${at8}, ${lit(owner.id)}, ${at8});`);
      } else {
        sql(`insert into public.agent_commission_rates (agent_id, rate_percent, effective_from, set_by, created_at) values (${lit(u.id)}, ${r.rate}, ${at8}, ${lit(owner.id)}, ${at8});`);
      }
      if (r !== u.rates![0]) {
        const [action, key] = u.role === "caller" ? ["caller_multiplier_changed", "multiplier"] : ["agent_rate_changed", "rate_percent"];
        sql(`insert into public.activity_log (entity_type, entity_id, action, actor_id, visibility, old_value, new_value, created_at) values ('profile', ${lit(u.id)}, ${lit(action)}, ${lit(owner.id)}, 'owner', ${lit({ [key]: u.rates![0].rate })}, ${lit({ [key]: r.rate })}, ${at8});`);
      }
    }
  }

  for (const u of users.filter((x) => x.role !== "caller")) {
    sql(`insert into public.agent_product_multipliers (agent_id, product_id, multiplier, effective_from, set_by, created_at) select ${lit(u.id)}, id, ${SPECIALIST_MULTIPLIER[u.first]}, ${lit(at(-900, "08:00"))}, ${lit(owner.id)}, ${lit(at(-900, "08:00"))} from public.products where name = 'Specialisti';`);
  }

  const products = {
    bonus: `(select id from public.products where name = 'Moj življenjski bonus')`,
    kasko: `(select id from public.products where name = 'Moj življenjski kasko')`,
    spec: `(select id from public.products where name = 'Specialisti')`,
  };
  const productNames = { bonus: "Moj življenjski bonus", kasko: "Moj življenjski kasko", spec: "Specialisti" };
  type ProductKey = keyof typeof products;

  const log = (customerId: string, entityType: string, entityId: string | null, action: string, actor: string, createdAt: string, newValue: unknown = null, metadata: unknown = {}, visibility = "team", oldValue: unknown = null) =>
    sql(`insert into public.activity_log (customer_id, entity_type, entity_id, action, actor_id, visibility, old_value, new_value, metadata, created_at) values (${lit(customerId)}, ${lit(entityType)}, ${lit(entityId)}, ${lit(action)}, ${lit(actor)}, ${lit(visibility)}, ${lit(oldValue)}, ${lit(newValue)}, ${lit(metadata)}, ${lit(createdAt)});`);

  // -------------------------------------------------------------------------
  // Customer journey builder
  // -------------------------------------------------------------------------
  const cities = [
    ["Ljubljana", "1000"], ["Maribor", "2000"], ["Celje", "3000"], ["Kranj", "4000"], ["Koper", "6000"],
    ["Novo mesto", "8000"], ["Velenje", "3320"], ["Ptuj", "2250"], ["Domžale", "1230"], ["Kamnik", "1241"],
  ];
  const streets = ["Slovenska cesta", "Prešernova ulica", "Tržaška cesta", "Cankarjeva ulica", "Gregorčičeva ulica", "Partizanska cesta", "Ulica heroja Tomšiča", "Kidričeva ulica"];
  let seq = 0;

  interface Step {
    agent: DemoUser;
    day: number; // offset from today
    time: string;
    result?: Result;
    note?: string;
    policies?: { product: ProductKey; premium: string; years: number; number?: string }[];
    cancel?: string;
    /** Owner/agent reschedules without caller (only for first step). */
  }

  function journey(first: string, last: string, caller: DemoUser | null, bookedBy: DemoUser, bookedDay: number, steps: Step[], opts: { followupClosed?: string; paidMode?: "auto" | "none" } = {}) {
    seq++;
    const customerId = randomUUID();
    const [city, postal] = cities[seq % cities.length];
    const address = `${streets[seq % streets.length]} ${(seq * 7) % 90 + 1}`;
    const phone = `+386 41 ${String(200 + seq).padStart(3, "0")} ${String(100 + ((seq * 37) % 900)).padStart(3, "0")}`;
    const email = seq % 3 === 0 ? null : `${first}.${last}`.toLowerCase().normalize("NFKD").replace(/[^\w.]/g, "") + "@example.com";
    const createdAt = at(bookedDay, "11:15");

    sql(`insert into public.customers (id, first_name, last_name, phone, email, address, postal_code, city, status, responsible_caller_id, current_agent_id, created_by, is_demo, created_at, updated_at)
values (${lit(customerId)}, ${lit(first)}, ${lit(last)}, ${lit(phone)}, ${lit(email)}, ${lit(address)}, ${lit(postal)}, ${lit(city)}, 'scheduled', ${lit(caller?.id ?? null)}, ${lit(steps[0].agent.id)}, ${lit(bookedBy.id)}, true, ${lit(createdAt)}, ${lit(createdAt)});`);
    log(customerId, "customer", customerId, "customer_created", bookedBy.id, createdAt, { responsible_caller_id: caller?.id ?? null });

    let prevId: string | null = null;
    let status = "scheduled";
    let lastResult: Result | null = null;
    let currentAgent = steps[0].agent.id;
    let openFollowup: { id: string; createdAt: string } | null = null;

    steps.forEach((step, i) => {
      const apptId = randomUUID();
      const scheduledAt = at(step.day, step.time);
      // booking time: first step at bookedDay; later steps shortly after the previous visit
      const bookedAt = i === 0 ? createdAt : stampAfter(at(steps[i - 1].day, steps[i - 1].time), openFollowup ? 60 * 24 : 90);
      const creator = i === 0 ? bookedBy : openFollowup ? (caller ?? owner) : steps[i - 1].agent;
      const source = i === 0 ? "new_customer" : openFollowup ? "followup" : "result_A";
      const isDone = !!step.result;
      const completedAt = isDone ? stampAfter(scheduledAt, 75) : null;
      status = step.cancel ? "closed" : "scheduled";

      sql(`insert into public.appointments (id, customer_id, agent_id, caller_id, created_by, previous_appointment_id, visit_number, scheduled_at, duration_minutes, location, postal_code, note, status, result, result_note, completed_at, completed_by, cancelled_at, cancelled_by, cancel_reason, created_at, updated_at)
values (${lit(apptId)}, ${lit(customerId)}, ${lit(step.agent.id)}, ${lit(caller?.id ?? null)}, ${lit(creator.id)}, ${lit(prevId)}, ${i + 1}, ${lit(scheduledAt)}, 60, ${lit(address)}, ${lit(postal)}, ${lit(i === 0 ? "Zanima ga zavarovanje za družino" : null)}, ${lit(step.cancel ? "cancelled" : isDone ? "completed" : "scheduled")}, ${lit(step.result ?? null)}, ${lit(step.note ?? null)}, ${lit(completedAt)}, ${lit(isDone ? step.agent.id : null)}, ${lit(step.cancel ? stampAfter(bookedAt, 600) : null)}, ${lit(step.cancel ? creator.id : null)}, ${lit(step.cancel ?? null)}, ${lit(bookedAt)}, ${lit(bookedAt)});`);
      log(customerId, "appointment", apptId, "appointment_created", creator.id, bookedAt, { scheduled_at: scheduledAt, agent_id: step.agent.id, caller_id: caller?.id ?? null, visit_number: i + 1, previous_appointment_id: prevId }, { source });
      if (i > 0 && step.agent.id !== steps[i - 1].agent.id) {
        log(customerId, "appointment", apptId, "appointment_reassigned", creator.id, bookedAt, { agent_id: step.agent.id }, {}, "team", { agent_id: steps[i - 1].agent.id });
      }
      currentAgent = step.agent.id;

      if (openFollowup) {
        sql(`update public.caller_followups set status = 'rescheduled', resolved_appointment_id = ${lit(apptId)}, resolved_at = ${lit(bookedAt)}, resolved_by = ${lit(creator.id)}, updated_at = ${lit(bookedAt)} where id = ${lit(openFollowup.id)};`);
        log(customerId, "caller_followup", openFollowup.id, "followup_resolved", creator.id, bookedAt, { appointment_id: apptId });
        openFollowup = null;
      }

      if (step.cancel) {
        log(customerId, "appointment", apptId, "appointment_cancelled", creator.id, stampAfter(bookedAt, 600), { status: "cancelled", reason: step.cancel });
      }

      if (isDone) {
        log(customerId, "appointment", apptId, "consultation_completed", step.agent.id, completedAt!, { status: "completed", result: step.result, note: step.note ?? null }, { agent_id: step.agent.id, visit_number: i + 1 });
        lastResult = step.result!;
        if (step.result === "A0") status = "lost";
        if (step.result === "B") {
          status = "callback";
          const fid = randomUUID();
          sql(`insert into public.caller_followups (id, customer_id, caller_id, source_appointment_id, reason, status, note, created_at, updated_at) values (${lit(fid)}, ${lit(customerId)}, ${lit(caller?.id ?? null)}, ${lit(apptId)}, 'B', 'open', ${lit(step.note ?? null)}, ${lit(completedAt)}, ${lit(completedAt)});`);
          log(customerId, "caller_followup", fid, "followup_created", step.agent.id, completedAt!, { caller_id: caller?.id ?? null, source_appointment_id: apptId });
          openFollowup = { id: fid, createdAt: completedAt! };
        }
        if (step.result === "A1") {
          status = "won";
          const policyDate = d(step.day);
          const entries: PolicyEntry[] = step.policies!.map((p) => ({ product_id: p.product, monthly_premium: p.premium, duration_years: p.years, policy_date: policyDate, policy_number: p.number ?? null }));
          const payload = buildPoliciesPayload(entries, {
            agentRatePercent: rateAt(step.agent, policyDate),
            callerMultiplier: caller ? rateAt(caller, policyDate) : null,
            productModels: { spec: "agent_multiplier" },
            agentMultipliers: { spec: SPECIALIST_MULTIPLIER[step.agent.first] },
          });
          payload.forEach((p, pi) => {
            const policyId = randomUUID();
            const key = step.policies![pi].product;
            sql(`insert into public.policies (id, customer_id, appointment_id, product_id, product_name, policy_number, monthly_premium, duration_years, policy_date, agent_id, caller_id, created_by, created_at, updated_at)
values (${lit(policyId)}, ${lit(customerId)}, ${lit(apptId)}, ${products[key]}, ${lit(productNames[key])}, ${lit(p.policy_number)}, ${p.monthly_premium}, ${p.duration_years}, ${lit(p.policy_date)}, ${lit(step.agent.id)}, ${lit(caller?.id ?? null)}, ${lit(step.agent.id)}, ${lit(completedAt)}, ${lit(completedAt)});`);
            log(customerId, "policy", policyId, "policy_created", step.agent.id, completedAt!, { product: productNames[key], monthly_premium: p.monthly_premium, duration_years: p.duration_years, policy_date: p.policy_date, agent_id: step.agent.id, caller_id: caller?.id ?? null });

            const commissions = [
              { type: "agent", beneficiary: step.agent.id, plan: p.agent_commission, rate: p.agent_commission.rate_percent, mult: null as string | null, years: p.duration_years, model: p.agent_commission.calc_model, agentMult: p.agent_commission.agent_multiplier },
              ...(p.caller_commission ? [{ type: "caller", beneficiary: caller!.id, plan: p.caller_commission, rate: null as string | null, mult: p.caller_commission.caller_multiplier, years: null as number | null, model: "standard", agentMult: null as string | null }] : []),
            ];
            for (const c of commissions) {
              const cid = randomUUID();
              sql(`insert into public.commissions (id, policy_id, beneficiary_id, beneficiary_type, base_monthly_premium, base_duration_years, rate_percent, caller_multiplier, calc_model, agent_multiplier, total_amount, policy_date, rule_version, calculation, created_at)
values (${lit(cid)}, ${lit(policyId)}, ${lit(c.beneficiary)}, ${lit(c.type)}, ${p.monthly_premium}, ${lit(c.years)}, ${lit(c.rate)}, ${lit(c.mult)}, ${lit(c.model)}, ${lit(c.agentMult)}, ${c.plan.total_amount}, ${lit(p.policy_date)}, ${lit(c.plan.rule_version)}, ${lit(c.plan.calculation)}, ${lit(completedAt)});`);
              log(customerId, "commission", cid, "commission_generated", step.agent.id, completedAt!, { beneficiary_type: c.type, beneficiary_id: c.beneficiary, total_amount: c.plan.total_amount, policy_id: policyId }, {}, "owner");
              for (const inst of c.plan.installments) {
                // Older payouts are paid; the most recent payout cycle (last ~20 days) stays unpaid to demo "due"
                const paid = opts.paidMode !== "none" && inst.due_date < d(-20);
                const paidAt = paid ? localDateTimeToIso(inst.due_date, "10:00") : null;
                const iid = randomUUID();
                sql(`insert into public.commission_installments (id, commission_id, policy_id, beneficiary_id, beneficiary_type, installment_number, share_percent, amount, due_date, original_due_date, status, paid_at, paid_by, paid_amount, created_at, updated_at)
values (${lit(iid)}, ${lit(cid)}, ${lit(policyId)}, ${lit(c.beneficiary)}, ${lit(c.type)}, ${inst.number}, ${inst.share_percent}, ${inst.amount}, ${lit(inst.due_date)}, ${lit(inst.due_date)}, ${lit(paid ? "paid" : "scheduled")}, ${lit(paidAt)}, ${lit(paid ? owner.id : null)}, ${lit(paid ? inst.amount : null)}, ${lit(completedAt)}, ${lit(paidAt ?? completedAt)});`);
                if (paid) log(customerId, "commission_installment", iid, "payout_marked_paid", owner.id, paidAt!, { status: "paid", amount: inst.amount, paid_at: paidAt }, { beneficiary_id: c.beneficiary, original_due_date: inst.due_date, installment_number: inst.number }, "owner", { status: "scheduled" });
              }
            }
          });
        }
      }
      prevId = apptId;
    });

    if (opts.followupClosed && openFollowup) {
      const closedAt = stampAfter((openFollowup as { createdAt: string }).createdAt, 60 * 26);
      sql(`update public.caller_followups set status = 'closed', resolved_at = ${lit(closedAt)}, resolved_by = ${lit(caller!.id)}, note = ${lit(opts.followupClosed)} where id = ${lit((openFollowup as { id: string }).id)};`);
      log(customerId, "caller_followup", (openFollowup as { id: string }).id, "followup_closed", caller!.id, closedAt, { note: opts.followupClosed });
      status = "closed";
    }

    sql(`update public.customers set status = ${lit(status)}, last_result = ${lit(lastResult)}, current_agent_id = ${lit(currentAgent)} where id = ${lit(customerId)};`);
  }

  // -------------------------------------------------------------------------
  // Scenarios
  // -------------------------------------------------------------------------
  // Upcoming appointments
  journey("Janez", "Kranjc", ana, ana, -2, [{ agent: marko, day: 1, time: "10:00" }]);
  journey("Maja", "Potočnik", ana, ana, -1, [{ agent: luka, day: 2, time: "17:30" }]);
  journey("Rok", "Mlakar", petra, petra, -3, [{ agent: nina, day: 3, time: "09:00" }]);
  journey("Eva", "Kos", jure, jure, -1, [{ agent: marko, day: 5, time: "16:00" }]);
  journey("Gregor", "Vidmar", petra, petra, 0, [{ agent: owner, day: 4, time: "12:00" }]);
  // Today
  journey("Sara", "Bizjak", ana, ana, -4, [{ agent: marko, day: 0, time: "09:30" }]);
  journey("Matej", "Hribar", jure, jure, -3, [{ agent: luka, day: 0, time: "18:00" }]);
  // Waiting for result (past, still open)
  journey("Tina", "Kavčič", petra, petra, -6, [{ agent: marko, day: -1, time: "14:00" }]);
  journey("Andrej", "Rozman", ana, ana, -7, [{ agent: nina, day: -2, time: "11:00" }]);
  // A0 lost
  journey("Mojca", "Petek", ana, ana, -20, [{ agent: marko, day: -14, time: "10:00", result: "A0", note: "Že ima zavarovanje pri drugi zavarovalnici." }]);
  journey("Boštjan", "Žagar", jure, jure, -25, [{ agent: luka, day: -18, time: "15:00", result: "A0", note: "Ne zanima ga." }]);
  journey("Irena", "Kolar", petra, petra, -12, [{ agent: nina, day: -8, time: "17:00", result: "A0" }]);
  // B → open follow-ups
  journey("Aleš", "Turk", ana, ana, -9, [{ agent: marko, day: -3, time: "16:30", result: "B", note: "Nikogar ni bilo doma, soseda pravi da dela popoldne." }]);
  journey("Nataša", "Oblak", ana, ana, -8, [{ agent: luka, day: -2, time: "10:00", result: "B" }]);
  journey("Primož", "Zajc", jure, jure, -10, [{ agent: nina, day: -4, time: "12:30", result: "B", note: "Zaprto, pustil vizitko." }]);
  // B → follow-up closed without appointment
  journey("Vesna", "Jereb", petra, petra, -30, [{ agent: marko, day: -24, time: "10:00", result: "B" }], { followupClosed: "Stranka ne želi novega termina." });
  // B → caller reschedules → upcoming (recurring, reassigned agent)
  journey("Klemen", "Pirc", ana, ana, -15, [
    { agent: marko, day: -10, time: "18:00", result: "B" },
    { agent: nina, day: 2, time: "10:30" },
  ]);
  // B → caller reschedules → A1 with another agent
  journey("Urška", "Kralj", jure, jure, -40, [
    { agent: luka, day: -33, time: "09:00", result: "B" },
    { agent: marko, day: -26, time: "17:00", result: "A1", policies: [{ product: "bonus", premium: "60.00", years: 15, number: "MZB-10421" }] },
  ]);
  // A → new appointment upcoming with a different agent
  journey("Darko", "Vovk", petra, petra, -12, [
    { agent: marko, day: -5, time: "11:00", result: "A", note: "Želi primerjati z ženino polico." },
    { agent: luka, day: 3, time: "18:00" },
  ]);
  journey("Metka", "Lesjak", ana, ana, -9, [
    { agent: nina, day: -3, time: "10:00", result: "A" },
    { agent: nina, day: 6, time: "10:00" },
  ]);
  // A → A1 (three visits)
  journey("Blaž", "Kokalj", jure, jure, -50, [
    { agent: luka, day: -45, time: "16:00", result: "A" },
    { agent: luka, day: -38, time: "16:00", result: "A1", policies: [{ product: "kasko", premium: "85.50", years: 20, number: "MZK-55310" }, { product: "spec", premium: "19.90", years: 10 }] },
  ]);
  // A1 around the payout cutoff (last month's 23rd / 24th / 25th)
  const lastMonth = (day: number) => {
    const [y, m] = today.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 2, day));
    return Math.round((dt.getTime() - Date.UTC(y, m - 1, Number(today.slice(8)))) / 86400_000);
  };
  journey("Polona", "Hočevar", ana, ana, lastMonth(23) - 6, [{ agent: marko, day: lastMonth(23), time: "10:00", result: "A1", policies: [{ product: "bonus", premium: "100.00", years: 10, number: "MZB-20001" }] }]);
  journey("Simon", "Debeljak", petra, petra, lastMonth(24) - 5, [{ agent: luka, day: lastMonth(24), time: "12:00", result: "A1", policies: [{ product: "kasko", premium: "45.00", years: 12 }] }]);
  journey("Katja", "Tomažič", jure, jure, lastMonth(25) - 5, [{ agent: nina, day: lastMonth(25), time: "15:00", result: "A1", policies: [{ product: "spec", premium: "29.99", years: 5 }] }]);
  // A1 with multiple policies
  journey("Robert", "Šuštar", ana, ana, -20, [
    { agent: marko, day: -16, time: "17:00", result: "A1", policies: [
      { product: "bonus", premium: "120.00", years: 25, number: "MZB-30112" },
      { product: "kasko", premium: "55.00", years: 20, number: "MZK-30113" },
      { product: "spec", premium: "24.50", years: 10 },
    ] },
  ]);
  journey("Lucija", "Gorenc", petra, petra, -11, [
    { agent: luka, day: -6, time: "11:30", result: "A1", policies: [{ product: "bonus", premium: "75.00", years: 18 }, { product: "spec", premium: "15.00", years: 8 }] },
  ]);
  // Old policies → later-stage installments (2nd and 3rd) due / paid
  journey("Franc", "Jerman", ana, ana, -410, [{ agent: luka, day: -402, time: "10:00", result: "A1", policies: [{ product: "bonus", premium: "90.00", years: 20, number: "MZB-00881" }] }]);
  journey("Marija", "Rupnik", jure, jure, -770, [{ agent: marko, day: -762, time: "14:00", result: "A1", policies: [{ product: "kasko", premium: "110.00", years: 15, number: "MZK-00502" }] }]);
  // Owner sells as agent
  journey("Peter", "Kastelic", petra, petra, -18, [{ agent: owner, day: -13, time: "13:00", result: "A1", policies: [{ product: "bonus", premium: "150.00", years: 20, number: "MZB-40001" }] }]);
  // Agent self-booked (no caller → no caller commission)
  journey("Helena", "Zorman", null, nina, -22, [{ agent: nina, day: -19, time: "09:00", result: "A1", policies: [{ product: "kasko", premium: "38.00", years: 10 }] }]);
  // Cancelled appointment
  journey("Zoran", "Majcen", jure, jure, -6, [{ agent: marko, day: 1, time: "08:30", cancel: "Stranka je odpovedala termin po telefonu." }]);

  sql(`commit;`);
  return out.join("\n") + "\n";
}

// CLI
if (process.argv[1] && process.argv[1].endsWith("generate-demo-seed.ts")) {
  const file = path.resolve(process.cwd(), "supabase/seed/demo-seed.sql");
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, generateDemoSeed());
  console.log(`Wrote ${file}`);
  console.log(`Demo users: *@${DEMO_EMAIL_DOMAIN} · password: ${DEMO_PASSWORD}`);
}
