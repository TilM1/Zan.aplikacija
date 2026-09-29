/** CSV/XLSX serialisation (pure). */
export function toCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/**
 * Neutralise spreadsheet formula injection (OWASP): values starting with
 * = @ or a tab/CR, or + / - followed by non-numeric content, get a leading
 * apostrophe. Phone numbers ("+386 41 …") and negative numbers stay intact.
 */
export function neutraliseFormula(s: string): string {
  if (/^[=@\t\r]/.test(s)) return `'${s}`;
  if (/^[+-]/.test(s) && !/^[+-][\d\s().\/-]*$/.test(s)) return `'${s}`;
  return s;
}

export function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "﻿";
  const headers = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const esc = (raw: string) => {
    const s = neutraliseFormula(raw);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.join(","), ...rows.map((r) => headers.map((h) => esc(toCell(r[h]))).join(","))];
  return "﻿" + lines.join("\r\n");
}
