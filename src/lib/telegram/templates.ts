/**
 * Telegram bot templates: the text the owner copies, fills in and sends back,
 * and the parser that turns it into validated input (pure, testable).
 * Validation reuses the same rules as the CRM forms (src/lib/validation.ts).
 */
import { z } from "zod";
import { emailSchema, moneySchema, phoneSchema } from "@/lib/validation";
import { isValidIsoDate, todayIso } from "@/lib/dates";

export type TelegramCommand = "novastranka" | "novapolica" | "dodajpolico";
export const TELEGRAM_COMMANDS: TelegramCommand[] = ["novastranka", "novapolica", "dodajpolico"];

/** Canonical field keys and the labels shown in the templates. */
const LABELS = {
  first_name: "Ime",
  last_name: "Priimek",
  phone: "Telefon",
  email: "E-pošta",
  address: "Naslov",
  postal_code: "Pošta",
  city: "Kraj",
  product: "Produkt",
  monthly_premium: "Mesečna premija",
  duration_years: "Trajanje (let)",
  policy_date: "Datum police",
  policy_number: "Številka police",
  note: "Opomba",
} as const;
type FieldKey = keyof typeof LABELS;

/** Accepted spellings (lower-case, without diacritics and punctuation). */
const ALIASES: Record<string, FieldKey> = {
  ime: "first_name",
  priimek: "last_name",
  telefon: "phone", tel: "phone", gsm: "phone", telefonska: "phone", telefonskastevilka: "phone",
  eposta: "email", email: "email", mail: "email",
  naslov: "address", ulica: "address",
  posta: "postal_code", postnastevilka: "postal_code", postna: "postal_code",
  kraj: "city",
  produkt: "product",
  mesecnapremija: "monthly_premium", premija: "monthly_premium",
  trajanje: "duration_years", trajanjelet: "duration_years", let: "duration_years", leta: "duration_years",
  datumpolice: "policy_date", datum: "policy_date",
  stevilkapolice: "policy_number", stpolice: "policy_number",
  opomba: "note", komentar: "note",
};

const FIELDS: Record<TelegramCommand, FieldKey[]> = {
  novastranka: ["first_name", "last_name", "phone", "email", "address", "postal_code", "city", "note"],
  novapolica: [
    "first_name", "last_name", "phone", "email", "address", "postal_code", "city",
    "product", "monthly_premium", "duration_years", "policy_date", "policy_number", "note",
  ],
  dodajpolico: ["phone", "product", "monthly_premium", "duration_years", "policy_date", "policy_number", "note"],
};

export const COMMAND_TITLES: Record<TelegramCommand, string> = {
  novastranka: "Nova stranka v Zasebno bazo",
  novapolica: "Nova stranka s podpisano polico",
  dodajpolico: "Nova polica za obstoječo stranko",
};

/** Template text to copy (header line + one "Label: " line per field). */
export function templateFor(command: TelegramCommand): string {
  return [`#${command}`, ...FIELDS[command].map((k) => `${LABELS[k]}: `)].join("\n");
}

function normalizeKey(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

export interface ParsedTemplate {
  command: TelegramCommand;
  fields: Partial<Record<FieldKey, string>>;
  /** Lines that were not understood (shown back to the user). */
  unknown: string[];
}

/** Recognises a filled template (first non-empty line is #command). Null when the text is not a template. */
export function parseTemplate(text: string): ParsedTemplate | null {
  const lines = text.replace(/\r/g, "").split("\n");
  const first = lines.findIndex((l) => l.trim() !== "");
  if (first < 0) return null;
  const header = /^#([a-zA-Z]+)\b/.exec(lines[first].trim());
  const command = header?.[1].toLowerCase() as TelegramCommand | undefined;
  if (!command || !TELEGRAM_COMMANDS.includes(command)) return null;

  const allowed = new Set(FIELDS[command]);
  const fields: Partial<Record<FieldKey, string>> = {};
  const unknown: string[] = [];
  let last: FieldKey | null = null;
  for (const line of lines.slice(first + 1)) {
    if (line.trim() === "") continue;
    const m = /^\s*([^:]{1,40}):(.*)$/.exec(line);
    const key = m ? ALIASES[normalizeKey(m[1])] : undefined;
    if (m && key && allowed.has(key)) {
      fields[key] = m[2].trim();
      last = key;
    } else if (last === "note") {
      // A multi-line note: keep the following lines
      fields.note = `${fields.note ?? ""}\n${line.trim()}`.trim();
    } else {
      unknown.push(line.trim());
    }
  }
  return { command, fields, unknown };
}

/** 5.10.2026 · 05. 10. 2026 · 2026-10-05 · danes → YYYY-MM-DD (empty = today). */
export function parseDate(raw: string | undefined, now: Date = new Date()): string | null {
  const v = (raw ?? "").trim().toLowerCase();
  if (v === "" || v === "danes") return todayIso(now);
  let iso: string | null = null;
  const sl = /^(\d{1,2})\s*\.\s*(\d{1,2})\s*\.\s*(\d{4})\.?$/.exec(v);
  if (sl) iso = `${sl[3]}-${sl[2].padStart(2, "0")}-${sl[1].padStart(2, "0")}`;
  else if (/^\d{4}-\d{2}-\d{2}$/.test(v)) iso = v;
  return iso && isValidIsoDate(iso) ? iso : null;
}

/** "45,50 €" / "45.50" / "1.200,00" → "45,50"-style input for moneySchema. */
function cleanMoney(raw: string | undefined): string {
  let v = (raw ?? "").replace(/€|eur(?:o|ov)?/gi, "").replace(/\s/g, "");
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(v)) v = v.replace(/\./g, ""); // 1.200,00
  return v;
}

const optionalPostal = z
  .string()
  .trim()
  .refine((v) => v === "" || /^\d{4}$/.test(v), "Poštna številka ima 4 števke.");

const policyFields = {
  product: z.string().trim().min(1, "Produkt je obvezno polje."),
  monthly_premium: moneySchema,
  duration_years: z.coerce
    .number({ message: "Trajanje vnesite v letih (npr. 20)." })
    .int("Trajanje v celih letih.")
    .min(1, "Trajanje mora biti vsaj 1 leto.")
    .max(100),
  policy_date: z.string().min(1, "Datum police ni veljaven (npr. 5.10.2026)."),
  policy_number: z.string().trim().max(64),
  note: z.string().trim().max(2000),
};

const person = {
  first_name: z.string().trim().min(1, "Ime je obvezno polje.").max(120),
  last_name: z.string().trim().min(1, "Priimek je obvezno polje.").max(120),
  phone: phoneSchema,
  email: emailSchema,
  address: z.string().trim().max(300),
  postal_code: optionalPostal,
  city: z.string().trim().max(120),
};

export const telegramSchemas = {
  novastranka: z.object({ ...person, note: z.string().trim().max(2000) }),
  novapolica: z.object({ ...person, ...policyFields }),
  dodajpolico: z.object({ phone: phoneSchema, ...policyFields }),
};

export type NovaStranka = z.infer<typeof telegramSchemas.novastranka>;
export type NovaPolica = z.infer<typeof telegramSchemas.novapolica>;
export type DodajPolico = z.infer<typeof telegramSchemas.dodajpolico>;
export type TelegramInput =
  | { command: "novastranka"; data: NovaStranka }
  | { command: "novapolica"; data: NovaPolica }
  | { command: "dodajpolico"; data: DodajPolico };

/** Validate a parsed template. Errors are human-readable lines in Slovenian. */
export function validateTemplate(parsed: ParsedTemplate, now: Date = new Date()): { ok: true; input: TelegramInput } | { ok: false; errors: string[] } {
  const f = parsed.fields;
  const raw: Record<string, string> = {};
  for (const k of FIELDS[parsed.command]) raw[k] = f[k] ?? "";
  if ("monthly_premium" in raw) raw.monthly_premium = cleanMoney(raw.monthly_premium);
  if ("duration_years" in raw) raw.duration_years = raw.duration_years.replace(/\s*let[aoi]?\.?\s*$/i, "").trim();
  if ("policy_date" in raw) raw.policy_date = parseDate(raw.policy_date, now) ?? "";

  const res = telegramSchemas[parsed.command].safeParse(raw);
  if (!res.success) {
    const seen = new Set<string>();
    const errors: string[] = [];
    for (const issue of res.error.issues) {
      const key = String(issue.path[0]) as FieldKey;
      if (seen.has(key)) continue;
      seen.add(key);
      errors.push(`${LABELS[key] ?? key}: ${issue.message}`);
    }
    return { ok: false, errors };
  }
  return { ok: true, input: { command: parsed.command, data: res.data } as TelegramInput };
}

function fold(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Finds a product by what the user typed: exact name, otherwise the only
 * product whose name contains the text (case/diacritics-insensitive).
 */
export function matchProduct<T extends { id: string; name: string }>(input: string, products: T[]): { product: T } | { candidates: T[] } {
  const q = fold(input);
  const exact = products.filter((p) => fold(p.name) === q);
  if (exact.length === 1) return { product: exact[0] };
  const partial = q ? products.filter((p) => fold(p.name).includes(q)) : [];
  if (partial.length === 1) return { product: partial[0] };
  return { candidates: partial.length ? partial : products };
}
