import "server-only";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatDate, formatDateTime, localDateTimeToIso } from "@/lib/dates";
import { formatDecimalEur } from "@/lib/money";
import { formatPhone, normalizePhone } from "@/lib/phone";
import {
  COMMAND_TITLES,
  TELEGRAM_COMMANDS,
  matchProduct,
  parseTemplate,
  templateFor,
  validateTemplate,
  type DodajPolico,
  type NovaPolica,
  type NovaStranka,
  type TelegramCommand,
  type TelegramInput,
} from "@/lib/telegram/templates";
import { buildSalePolicies } from "@/server/sale-policies";
import { callWorkflow, WorkflowError } from "@/server/workflow";
import { answerCallback, editMessage, esc, sendMessage, setCommands, type TelegramMessage, type TelegramUpdate } from "./api";

/** A confirmation button older than this no longer saves anything. */
const SUBMISSION_TTL_MS = 24 * 60 * 60 * 1000;

interface Actor {
  telegramUserId: number;
  profileId: string;
}

type Submission = {
  id: string;
  chat_id: number;
  telegram_user_id: number;
  actor_id: string;
  command: TelegramCommand;
  payload: Record<string, unknown>;
  status: string;
  created_at: string;
};

type PolicyPayload = { product_id: string; product_name: string };
type StrankaPayload = NovaStranka;
type NovaPolicaPayload = NovaPolica & PolicyPayload;
type DodajPolicoPayload = DodajPolico & PolicyPayload & { customer_id: string; customer_name: string; caller_id: string | null };

// ---------------------------------------------------------------------------
// Who may use the bot
// ---------------------------------------------------------------------------

/**
 * TELEGRAM_ALLOWED_USERS="<telegram user id>:<CRM login e-mail or profile id>,…"
 * e.g. "123456789:zan@zzpartnerji.si"
 */
function allowedLogin(telegramUserId: number): string | null {
  for (const pair of (process.env.TELEGRAM_ALLOWED_USERS ?? "").split(",")) {
    const i = pair.indexOf(":");
    if (i < 0) continue;
    const tg = pair.slice(0, i).trim();
    const login = pair.slice(i + 1).trim().toLowerCase();
    if (tg && login && tg === String(telegramUserId)) return login;
  }
  return null;
}

/** Only an active Owner listed in TELEGRAM_ALLOWED_USERS. The DB functions re-check this. */
async function resolveActor(telegramUserId: number): Promise<Actor | null> {
  const login = allowedLogin(telegramUserId);
  if (!login) return null;
  const { data } = await createAdminClient().from("profiles").select("id, email").eq("role", "owner").eq("is_active", true);
  const owner = (data ?? []).find((p) => p.id === login || p.email.toLowerCase() === login);
  return owner ? { telegramUserId, profileId: owner.id } : null;
}

// ---------------------------------------------------------------------------
// Texts
// ---------------------------------------------------------------------------

const HELP = [
  "<b>ZZ CRM · vpis prek Telegrama</b>",
  "",
  "/novastranka – kontakt v <b>Zasebno bazo</b> (Klicni seznami)",
  "/novapolica – nova stranka s podpisano polico",
  "/dodajpolico – nova polica za obstoječo stranko (poišče jo po telefonu)",
  "/produkti – seznam produktov",
  "",
  "Izberi ukaz, tapni predlogo (skopira se), izpolni in pošlji nazaj. Pred shranjevanjem dobiš povzetek in gumb ✅ Shrani.",
].join("\n");

function publicOrigin(): string | null {
  const host = process.env.APP_PUBLIC_HOST || process.env.VERCEL_PROJECT_PRODUCTION_URL;
  return host ? `https://${host.replace(/^https?:\/\//, "").replace(/\/$/, "")}` : null;
}

function link(path: string, label: string): string {
  const origin = publicOrigin();
  return origin ? `\n<a href="${esc(origin + path)}">${esc(label)}</a>` : "";
}

const line = (label: string, value: unknown) => (value === "" || value === null || value === undefined ? null : `${label}: <b>${esc(value)}</b>`);

function summary(command: TelegramCommand, p: Record<string, unknown>): string {
  const rows: (string | null)[] = [`<b>${esc(COMMAND_TITLES[command])}</b>`];
  if (command !== "dodajpolico") {
    const s = p as StrankaPayload;
    rows.push(
      line("Ime in priimek", `${s.first_name} ${s.last_name}`),
      line("Telefon", formatPhone(normalizePhone(s.phone))),
      line("E-pošta", s.email),
      line("Naslov", [s.address, [s.postal_code, s.city].filter(Boolean).join(" ")].filter(Boolean).join(", ")),
    );
  } else {
    const d = p as DodajPolicoPayload;
    rows.push(line("Stranka", d.customer_name), line("Telefon", formatPhone(normalizePhone(d.phone))));
  }
  if (command !== "novastranka") {
    const pol = p as NovaPolicaPayload;
    rows.push(
      line("Produkt", pol.product_name),
      line("Mesečna premija", formatDecimalEur(pol.monthly_premium)),
      line("Trajanje", `${pol.duration_years} let`),
      line("Datum police", formatDate(pol.policy_date)),
      line("Številka police", pol.policy_number),
      line("Zastopnik", "jaz (lastnik)"),
    );
  }
  rows.push(line("Opomba", p.note));
  return rows.filter(Boolean).join("\n");
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function handleUpdate(update: TelegramUpdate): Promise<void> {
  if (update.callback_query) return handleCallback(update.callback_query);
  const msg = update.message;
  if (!msg?.text || !msg.from || msg.chat.type !== "private") return;

  const actor = await resolveActor(msg.from.id);
  if (!actor) {
    await sendMessage(msg.chat.id, `⛔ Ni dostopa.\nTvoj Telegram ID: <code>${msg.from.id}</code>`);
    return;
  }

  const text = msg.text.trim();
  if (text.startsWith("/")) return handleCommand(msg, text);
  const parsed = parseTemplate(text);
  if (parsed) return handleTemplate(actor, msg, parsed);
  await sendMessage(msg.chat.id, `Ne razumem sporočila. Začni z ukazom.\n\n${HELP}`);
}

async function handleCommand(msg: TelegramMessage, text: string) {
  const cmd = text.slice(1).split(/[\s@]/)[0].toLowerCase();
  if ((TELEGRAM_COMMANDS as string[]).includes(cmd)) {
    const c = cmd as TelegramCommand;
    const hint =
      c === "novastranka"
        ? "Obvezno: ime, priimek, telefon."
        : c === "novapolica"
          ? "Obvezno: ime, priimek, telefon, produkt, premija, trajanje. Prazen datum = danes. Za produkt je dovolj del imena (/produkti)."
          : "Stranko poiščem po telefonu. Prazen datum = danes. Za produkt je dovolj del imena (/produkti).";
    await sendMessage(msg.chat.id, `<b>${esc(COMMAND_TITLES[c])}</b>\nTapni predlogo, da jo kopiraš, izpolni in pošlji:\n\n<pre>${esc(templateFor(c))}</pre>\n${esc(hint)}`);
    return;
  }
  if (cmd === "start") await setCommands();
  if (cmd === "produkti") {
    const products = await activeProducts();
    await sendMessage(msg.chat.id, `<b>Produkti</b>\n${products.map((p) => `• ${esc(p.name)}`).join("\n") || "Ni aktivnih produktov."}`);
    return;
  }
  await sendMessage(msg.chat.id, HELP);
}

async function activeProducts() {
  const { data } = await createAdminClient().from("products").select("id, name").eq("is_active", true).order("sort_order");
  return (data ?? []) as { id: string; name: string }[];
}

// ---------------------------------------------------------------------------
// Step 1: a filled template arrives → validate, check, ask for confirmation
// ---------------------------------------------------------------------------

type Prepared = { error: string } | { payload: Record<string, unknown>; warnings: string[]; confirmLabel?: string };

async function handleTemplate(actor: Actor, msg: TelegramMessage, parsed: NonNullable<ReturnType<typeof parseTemplate>>) {
  const admin = createAdminClient();
  // Telegram may deliver the same message twice: handle it once
  const { data: seen } = await admin.from("telegram_submissions").select("id").eq("chat_id", msg.chat.id).eq("message_id", msg.message_id).maybeSingle();
  if (seen) return;

  const v = validateTemplate(parsed);
  if (!v.ok) {
    await sendMessage(msg.chat.id, `❌ Popravi in pošlji znova:\n${v.errors.map((e) => `• ${esc(e)}`).join("\n")}`, { replyTo: msg.message_id });
    return;
  }

  let prepared: Prepared;
  try {
    prepared = await prepare(actor, v.input);
  } catch (e) {
    if (!(e instanceof WorkflowError)) console.error("[telegram] prepare failed", e);
    prepared = { error: e instanceof WorkflowError ? e.message : "Pri preverjanju je prišlo do napake. Poskusi znova." };
  }
  if ("error" in prepared) {
    await sendMessage(msg.chat.id, `❌ ${esc(prepared.error)}`, { replyTo: msg.message_id });
    return;
  }

  const { data: row, error } = await admin
    .from("telegram_submissions")
    .insert({
      chat_id: msg.chat.id,
      message_id: msg.message_id,
      telegram_user_id: actor.telegramUserId,
      actor_id: actor.profileId,
      command: v.input.command,
      payload: prepared.payload,
    })
    .select("id")
    .single();
  if (error || !row) {
    if (error?.code !== "23505") console.error("[telegram] insert submission failed", error);
    return;
  }

  const warnings = prepared.warnings.length ? `\n\n${prepared.warnings.join("\n")}` : "";
  const unknown = parsed.unknown.length ? `\n\nNeprepoznane vrstice (ne bodo shranjene):\n${parsed.unknown.map((u) => `• ${esc(u)}`).join("\n")}` : "";
  await sendMessage(msg.chat.id, `${summary(v.input.command, prepared.payload)}${warnings}${unknown}`, {
    replyTo: msg.message_id,
    buttons: [[
      { text: prepared.confirmLabel ?? "✅ Shrani", callback_data: `ok:${row.id}` },
      { text: "❌ Prekliči", callback_data: `no:${row.id}` },
    ]],
  });
}

async function prepare(actor: Actor, input: TelegramInput): Promise<Prepared> {
  const admin = createAdminClient();
  const phone = normalizePhone(input.data.phone) ?? "";

  if (input.command === "novastranka") {
    const [{ data: lead }, { data: customers }] = await Promise.all([
      admin.from("leads").select("id, list:lead_lists(name)").eq("phone_normalized", phone).maybeSingle(),
      admin.from("customers").select("first_name, last_name").eq("phone_normalized", phone).is("archived_at", null).limit(3),
    ]);
    if (lead) {
      const listName = (lead.list as unknown as { name: string } | null)?.name ?? "–";
      return { error: `Ta številka je že v klicnem seznamu »${listName}«.` };
    }
    const warnings = (customers ?? []).map((c) => `ℹ️ Ta oseba je že stranka v CRM: ${esc(`${c.first_name} ${c.last_name}`)}`);
    return { payload: input.data, warnings };
  }

  const products = await activeProducts();
  const match = matchProduct(input.data.product, products);
  if (!("product" in match)) {
    return { error: `Produkta »${input.data.product}« ne najdem natančno. Možnosti:\n${match.candidates.map((p) => `• ${p.name}`).join("\n")}` };
  }
  const policy = { product_id: match.product.id, product_name: match.product.name };

  if (input.command === "novapolica") {
    // Fail early if the owner's commission settings are missing (same check as on save)
    await buildSalePolicies(actor.profileId, null, [entryOf({ ...input.data, ...policy })]);
    const filters = [`phone_normalized.eq.${phone}`];
    if (input.data.email) filters.push(`email.eq.${input.data.email}`);
    const { data: dups } = await admin.from("customers").select("first_name, last_name").or(filters.join(",")).is("archived_at", null).limit(3);
    if (dups?.length) {
      return {
        payload: { ...input.data, ...policy },
        warnings: [
          `⚠️ Stranka s tem telefonom ali e-pošto že obstaja: ${esc(dups.map((d) => `${d.first_name} ${d.last_name}`).join(", "))}.`,
          "Za dodatno polico obstoječi stranki uporabi /dodajpolico. Novo stranko ustvari samo, če gre res za drugo osebo.",
        ],
        confirmLabel: "⚠️ Vseeno ustvari novo",
      };
    }
    return { payload: { ...input.data, ...policy }, warnings: [] };
  }

  // dodajpolico: find the customer by phone
  const { data: found } = await admin
    .from("customers")
    .select("id, first_name, last_name, city, responsible_caller_id, caller_tariff")
    .eq("phone_normalized", phone)
    .is("archived_at", null)
    .limit(5);
  if (!found?.length) return { error: "Stranke s to telefonsko številko ni v CRM. Za novo stranko uporabi /novapolica." };
  if (found.length > 1) {
    return { error: `To številko ima več strank (${found.map((c) => `${c.first_name} ${c.last_name}`).join(", ")}). Polico vnesi v CRM.` };
  }
  const c = found[0];
  const [{ data: open }, { data: followup }] = await Promise.all([
    admin.from("appointments").select("scheduled_at").eq("customer_id", c.id).eq("status", "scheduled").maybeSingle(),
    admin.from("caller_followups").select("caller_id").eq("customer_id", c.id).eq("status", "open").maybeSingle(),
  ]);
  if (open) {
    return { error: `${c.first_name} ${c.last_name} ima odprt termin (${formatDateTime(open.scheduled_at)}). Vpiši rezultat A1 pri tem terminu v CRM.` };
  }
  const callerId: string | null = followup?.caller_id ?? c.responsible_caller_id ?? null;
  const warnings: string[] = [];
  if (callerId) {
    const { data: caller } = await admin.from("profiles").select("first_name, last_name").eq("id", callerId).maybeSingle();
    warnings.push(`ℹ️ Provizijo za klicatelja dobi ${esc(caller ? `${caller.first_name} ${caller.last_name}` : "odgovorni klicatelj")} (kot pri vnosu v CRM).`);
  }
  await buildSalePolicies(actor.profileId, callerId, [entryOf({ ...input.data, ...policy })], (c.caller_tariff as "standard" | "live") ?? "standard");
  return {
    payload: { ...input.data, ...policy, customer_id: c.id, customer_name: `${c.first_name} ${c.last_name}${c.city ? `, ${c.city}` : ""}`, caller_id: callerId },
    warnings,
  };
}

function entryOf(p: (NovaPolica | DodajPolico) & PolicyPayload) {
  return {
    product_id: p.product_id,
    monthly_premium: p.monthly_premium,
    duration_years: p.duration_years,
    policy_date: p.policy_date,
    policy_number: p.policy_number || null,
    note: null,
  };
}

// ---------------------------------------------------------------------------
// Step 2: ✅ / ❌ pressed
// ---------------------------------------------------------------------------

async function handleCallback(q: NonNullable<TelegramUpdate["callback_query"]>) {
  const m = /^(ok|no):([0-9a-f-]{36})$/.exec(q.data ?? "");
  const chatId = q.message?.chat.id;
  const messageId = q.message?.message_id;
  if (!m || !chatId || !messageId) return answerCallback(q.id);

  const actor = await resolveActor(q.from.id);
  if (!actor) return answerCallback(q.id, "Ni dostopa.");

  const admin = createAdminClient();
  const { data: sub } = await admin.from("telegram_submissions").select("*").eq("id", m[2]).maybeSingle<Submission>();
  if (!sub || Number(sub.telegram_user_id) !== actor.telegramUserId || sub.actor_id !== actor.profileId) {
    return answerCallback(q.id, "Zapis ne obstaja.");
  }
  const title = summary(sub.command, sub.payload);

  const expired = Date.now() - new Date(sub.created_at).getTime() > SUBMISSION_TTL_MS;
  if (m[1] === "no" || expired) {
    const { data: cancelled } = await admin
      .from("telegram_submissions")
      .update({ status: "cancelled", ...(m[1] === "no" ? {} : { error: "expired" }) })
      .eq("id", sub.id)
      .eq("status", "pending")
      .select("id");
    if (!cancelled?.length) return answerCallback(q.id, "To je že obdelano.");
    await editMessage(chatId, messageId, `${title}\n\n${m[1] === "no" ? "❌ Preklicano, nič ni shranjeno." : "⌛ Potrditev je potekla. Pošlji predlogo znova."}`);
    return answerCallback(q.id);
  }

  // Claim it atomically: a double tap or a resent update saves only once
  const { data: claimed } = await admin
    .from("telegram_submissions")
    .update({ status: "processing" })
    .eq("id", sub.id)
    .eq("status", "pending")
    .select("id");
  if (!claimed?.length) return answerCallback(q.id, "To je že obdelano.");

  try {
    const { text, result } = await execute(actor, sub);
    await admin.from("telegram_submissions").update({ status: "done", result }).eq("id", sub.id);
    revalidatePath("/", "layout");
    await editMessage(chatId, messageId, `${title}\n\n${text}`);
    return answerCallback(q.id, "Shranjeno");
  } catch (e) {
    const known = e instanceof WorkflowError;
    if (!known) console.error("[telegram] save failed", e);
    const message = known ? e.message : "Pri shranjevanju je prišlo do napake. Nič ni shranjeno, poskusi znova.";
    await admin.from("telegram_submissions").update({ status: "failed", error: message }).eq("id", sub.id);
    await editMessage(chatId, messageId, `${title}\n\n❌ Ni shranjeno: ${esc(message)}`);
    return answerCallback(q.id, "Ni shranjeno");
  }
}

async function execute(actor: Actor, sub: Submission): Promise<{ text: string; result: Record<string, unknown> }> {
  if (sub.command === "novastranka") {
    const s = sub.payload as unknown as StrankaPayload;
    const res = await callWorkflow<{ status: string; lead_id: string; list_id: string; list_name: string }>("crm_add_private_lead", {
      p_actor: actor.profileId,
      p_lead: {
        name: `${s.first_name} ${s.last_name}`,
        phone: s.phone,
        email: s.email,
        street: s.address,
        postal_code: s.postal_code,
        city: s.city,
        note: s.note,
        extra: { Vir: "Telegram" },
      },
    });
    if (res.status !== "created") throw new WorkflowError(`Ta številka je že v klicnem seznamu »${res.list_name}«.`);
    const phone = normalizePhone(s.phone) ?? "";
    return {
      text: `✅ Shranjeno v »${esc(res.list_name)}«.${link(`/leads?list=${res.list_id}&view=all&q=${encodeURIComponent(phone)}`, "Odpri v CRM")}`,
      result: res,
    };
  }

  if (sub.command === "novapolica") {
    const p = sub.payload as unknown as NovaPolicaPayload;
    const policies = await buildSalePolicies(actor.profileId, null, [entryOf(p)]);
    const res = await callWorkflow<{ customer_id: string; policy_ids: string[] }>("crm_add_signed_customer", {
      p_actor: actor.profileId,
      p_customer: { first_name: p.first_name, last_name: p.last_name, phone: p.phone, email: p.email, address: p.address, postal_code: p.postal_code, city: p.city },
      p_sale: { agent_id: actor.profileId, caller_id: null, signed_at: localDateTimeToIso(p.policy_date, "12:00"), note: p.note },
      p_policies: policies,
    });
    return { text: `✅ Stranka in polica sta shranjeni.${link(`/customers/${res.customer_id}`, "Odpri stranko v CRM")}`, result: res };
  }

  const d = sub.payload as unknown as DodajPolicoPayload;
  const { data: c } = await createAdminClient().from("customers").select("caller_tariff").eq("id", d.customer_id).maybeSingle();
  const policies = await buildSalePolicies(actor.profileId, d.caller_id, [entryOf(d)], (c?.caller_tariff as "standard" | "live") ?? "standard");
  const res = await callWorkflow<{ customer_id: string; policy_ids: string[] }>("crm_add_policy_to_customer", {
    p_actor: actor.profileId,
    p_customer_id: d.customer_id,
    p_sale: { agent_id: actor.profileId, caller_id: d.caller_id, signed_at: localDateTimeToIso(d.policy_date, "12:00"), note: d.note },
    p_policies: policies,
  });
  return { text: `✅ Polica je dodana.${link(`/customers/${res.customer_id}`, "Odpri stranko v CRM")}`, result: res };
}
