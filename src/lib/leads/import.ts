/**
 * Call-list import helpers (pure; used in the browser and tested).
 * Maps spreadsheet columns to lead fields; everything unmapped is kept in `extra`.
 */
export const LEAD_FIELDS = ["name", "phone", "street", "postal_code", "city", "activity", "tax_number", "email"] as const;
export type LeadField = (typeof LEAD_FIELDS)[number];

export const LEAD_FIELD_LABELS: Record<LeadField, string> = {
  name: "Naziv / ime",
  phone: "Telefon (GSM)",
  street: "Ulica in hišna št.",
  postal_code: "Poštna številka",
  city: "Kraj / pošta",
  activity: "Dejavnost",
  tax_number: "Davčna številka",
  email: "E-pošta",
};

export type Mapping = Partial<Record<LeadField, number>>; // field → column index
export type Cell = string | number | boolean | Date | null | undefined;

export interface LeadImportRow {
  row_number: number;
  name: string;
  phone: string;
  street: string | null;
  postal_code: string | null;
  city: string | null;
  activity: string | null;
  tax_number: string | null;
  email: string | null;
  extra: Record<string, string>;
}

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

export function cellToString(v: Cell): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return isNaN(v.getTime()) ? "" : v.toISOString().slice(0, 10);
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(v).replace(".", ",");
  return String(v).trim();
}

const HEADER_RULES: { field: LeadField; re: RegExp }[] = [
  { field: "phone", re: /\b(gsm|mobi|mobitel|telefon|tel|phone)\b/ },
  { field: "email", re: /(e-?mail|e-?posta|^mail$)/ },
  { field: "tax_number", re: /(davcn|ddv|tax|vat|id za ddv)/ },
  { field: "activity", re: /(dejavnost|panoga|activity|skd)/ },
  { field: "street", re: /(ulica|naslov|address|street)/ },
  { field: "name", re: /(naziv|ime in priimek|^ime$|podjetje|firma|stranka|^name$|kontakt)/ },
];

const share = (values: string[], test: (v: string) => boolean) => {
  const filled = values.filter((v) => v !== "");
  return filled.length === 0 ? 0 : filled.filter(test).length / filled.length;
};

/** Guess which column holds which field, using header names and sample values. */
export function detectMapping(headers: string[], sample: Cell[][]): Mapping {
  const mapping: Mapping = {};
  const used = new Set<number>();
  const colValues = (i: number) => sample.map((r) => cellToString(r[i]));
  const h = headers.map((x) => fold(x ?? ""));

  for (const rule of HEADER_RULES) {
    const idx = h.findIndex((x, i) => !used.has(i) && rule.re.test(x));
    if (idx >= 0) {
      mapping[rule.field] = idx;
      used.add(idx);
    }
  }
  // Postal code vs city: "pošta" columns — numeric 4-digit values = postal code, text = city
  h.forEach((x, i) => {
    if (used.has(i)) return;
    const vals = colValues(i);
    const isPostal = share(vals, (v) => /^\d{4}$/.test(v)) > 0.8;
    if (mapping.postal_code === undefined && (isPostal && /(post|posta|zip|\bpo\b|sn po)/.test(x))) {
      mapping.postal_code = i;
      used.add(i);
    } else if (mapping.city === undefined && !isPostal && /(posta|kraj|mesto|city|obcina)/.test(x)) {
      mapping.city = i;
      used.add(i);
    }
  });
  // Value-based fallbacks
  if (mapping.phone === undefined) {
    const idx = h.findIndex((_, i) => !used.has(i) && share(colValues(i), (v) => /^\+?[\d\s/-]{8,16}$/.test(v)) > 0.8);
    if (idx >= 0) {
      mapping.phone = idx;
      used.add(idx);
    }
  }
  if (mapping.email === undefined) {
    const idx = h.findIndex((_, i) => !used.has(i) && share(colValues(i), (v) => /@/.test(v)) > 0.5);
    if (idx >= 0) {
      mapping.email = idx;
      used.add(idx);
    }
  }
  if (mapping.postal_code === undefined) {
    const idx = h.findIndex((_, i) => !used.has(i) && share(colValues(i), (v) => /^\d{4}$/.test(v)) > 0.9);
    if (idx >= 0) {
      mapping.postal_code = idx;
      used.add(idx);
    }
  }
  return mapping;
}

const EMPTY_MARKERS = new Set(["n/a", "na", "-", "/", "#n/a"]);

/** Excel stores dates as serial numbers (days since 1899-12-30); convert them in date-like columns. */
function excelSerialToIso(v: Cell): string | null {
  if (typeof v !== "number" || v < 20000 || v > 80000) return null;
  const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86400_000);
  return d.toISOString().slice(0, 10);
}
const clean = (v: string) => (EMPTY_MARKERS.has(v.toLowerCase()) ? "" : v);

/** Convert sheet rows (without the header row) to import rows. */
export function toLeadRows(headers: string[], rows: Cell[][], mapping: Mapping, firstRowNumber = 2): LeadImportRow[] {
  const mappedIdx = new Set(Object.values(mapping));
  const get = (r: Cell[], f: LeadField) => (mapping[f] === undefined ? "" : clean(cellToString(r[mapping[f]!])));
  return rows.map((r, i) => {
    const extra: Record<string, string> = {};
    headers.forEach((header, idx) => {
      if (mappedIdx.has(idx)) return;
      const isDateColumn = /datum|date/.test(fold(header ?? ""));
      const v = (isDateColumn && excelSerialToIso(r[idx])) || clean(cellToString(r[idx]));
      if (v !== "" && header) extra[header.slice(0, 80)] = v.slice(0, 500);
    });
    return {
      row_number: firstRowNumber + i,
      name: get(r, "name"),
      phone: get(r, "phone"),
      street: get(r, "street") || null,
      postal_code: get(r, "postal_code") || null,
      city: get(r, "city") || null,
      activity: get(r, "activity") || null,
      tax_number: get(r, "tax_number") || null,
      email: get(r, "email").toLowerCase() || null,
      extra,
    };
  });
}

/** Split rows into request-sized chunks (by count and serialized size). */
export function chunkRows<T>(rows: T[], maxRows = 1000, maxBytes = 700_000): T[][] {
  const chunks: T[][] = [];
  let cur: T[] = [];
  let size = 0;
  for (const row of rows) {
    const s = JSON.stringify(row).length;
    if (cur.length > 0 && (cur.length >= maxRows || size + s > maxBytes)) {
      chunks.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(row);
    size += s;
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}

const titleCase = (s: string) =>
  s
    .toLowerCase()
    .split(/(\s+|-)/)
    .map((w) => (w.trim() && w !== "-" ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join("");

/**
 * Guess the person behind a sole-proprietor name, e.g.
 *  "PIA MRŠEK, SAMOSTOJNA DELAVKA V KULTURI"      → Pia / Mršek
 *  "KURIRSKA DOSTAVA, ALBIAS PIRKUQI S.P."         → Albias / Pirkuqi
 *  "CREATIVE STUDIO, OGLAŠEVALSKE STORITVE D.O.O." → null (company)
 */
export function guessPersonName(name: string): { first_name: string; last_name: string } | null {
  const n = name.trim();
  let person: string | null = null;
  const sp = /,\s*([^,]+?)\s+s\.?\s*p\.?\s*$/i.exec(n);
  if (sp) person = sp[1];
  else {
    const self = /^([^,]+?),\s*samostojn/i.exec(n);
    if (self) person = self[1];
  }
  if (!person) return null;
  const words = person.trim().split(/\s+/);
  if (words.length < 2 || words.length > 4) return null;
  return { first_name: titleCase(words[0]), last_name: titleCase(words.slice(1).join(" ")) };
}
