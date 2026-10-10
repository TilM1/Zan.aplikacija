/**
 * Maps rows of a live Google Sheet (e.g. Facebook lead-form export) to ingest
 * rows. Pure and tested. The sheet is only a source: nothing is written back.
 */
import { normalizePhone } from "@/lib/phone";

export interface IngestRow {
  /** Stable identity of a sheet row, so each row is processed exactly once. */
  source_key: string;
  name: string;
  phone: string;
  email: string | null;
  /** When the person submitted the form (ISO), if the sheet has it. */
  created_at: string | null;
  /** All other columns (form answers), with readable labels. */
  extra: Record<string, string>;
  /** Rows already handled in the sheet before the CRM (not imported). */
  skip: boolean;
}

/** Sheet statuses that must NOT be imported (already handled / unusable). */
export const SKIP_SHEET_STATUSES = new Set(["SALES IN PROCESS", "INVALID"]);

const norm = (h: string) => (h ?? "").toLowerCase().replace(/_/g, " ").replace(/\s+/g, " ").trim();

const pretty = (s: string) => {
  const t = (s ?? "").replace(/_/g, " ").replace(/\s+/g, " ").trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
};

function findColumn(headers: string[], re: RegExp, exclude: Set<number> = new Set()): number {
  return headers.findIndex((h, i) => !exclude.has(i) && re.test(norm(h)));
}

export function mapSheetRows(headers: string[], rows: string[][]): IngestRow[] {
  const used = new Set<number>();
  const take = (re: RegExp) => {
    const i = findColumn(headers, re, used);
    if (i >= 0) used.add(i);
    return i;
  };
  const iStatus = take(/^status$/);
  const iPhone = take(/(phone|telefon|gsm|mobi)/);
  const iEmail = take(/(e-?mail|e-?pošta|eposta)/);
  const iName = take(/(full name|ime in priimek|^name$|^ime$|naziv)/);
  const iCreated = take(/(created time|created|datum|^date$|čas oddaje)/);

  const out: IngestRow[] = [];
  for (const r of rows) {
    const cell = (i: number) => (i >= 0 ? String(r[i] ?? "").trim() : "");
    const rawPhone = cell(iPhone).replace(/^p\s*:\s*/i, "");
    const name = cell(iName);
    const createdRaw = cell(iCreated);
    if (!rawPhone && !name) continue; // empty line

    const extra: Record<string, string> = {};
    headers.forEach((h, i) => {
      if (used.has(i) || !norm(h)) return;
      // Columns to the right of STATUS are the callers' old notes in the sheet – not imported
      if (iStatus >= 0 && i > iStatus) return;
      const v = pretty(String(r[i] ?? ""));
      if (v) extra[pretty(h).slice(0, 80)] = v.slice(0, 500);
    });

    const ts = createdRaw ? Date.parse(createdRaw) : NaN;
    const status = cell(iStatus).toUpperCase().replace(/\s+/g, " ");
    out.push({
      source_key: `${createdRaw}|${normalizePhone(rawPhone) ?? rawPhone}|${createdRaw ? "" : name}`.slice(0, 300),
      name,
      phone: rawPhone,
      email: cell(iEmail).toLowerCase() || null,
      created_at: Number.isNaN(ts) ? null : new Date(ts).toISOString(),
      extra,
      skip: SKIP_SHEET_STATUSES.has(status),
    });
  }
  return out;
}
