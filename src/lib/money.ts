/**
 * Money helpers. All arithmetic happens in integer cents; values cross the
 * database boundary as decimal strings (PostgreSQL numeric(12,2)).
 */

export type Cents = number;

const MONEY_RE = /^\d{1,10}([.,]\d{1,2})?$/;

/** Parse "100", "100.5", "100,50" or a number into integer cents. Throws on invalid input. */
export function toCents(value: string | number): Cents {
  const raw = typeof value === "number" ? value.toFixed(2) : value.trim().replace(/\s/g, "");
  if (!MONEY_RE.test(raw)) {
    throw new Error(`Invalid money amount: ${value}`);
  }
  const [whole, frac = ""] = raw.replace(",", ".").split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

export function isValidMoneyInput(value: string): boolean {
  return MONEY_RE.test(value.trim().replace(/\s/g, ""));
}

/** Integer cents → "1234.56" (for numeric columns). */
export function centsToDecimal(cents: Cents): string {
  if (!Number.isSafeInteger(cents)) throw new Error(`Invalid cents: ${cents}`);
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** Integer division with round-half-up (for non-negative numerators). */
export function divRoundHalfUp(numerator: number, denominator: number): number {
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || denominator <= 0) {
    throw new Error("divRoundHalfUp requires safe integers and a positive denominator");
  }
  if (numerator < 0) throw new Error("divRoundHalfUp requires a non-negative numerator");
  const q = Math.floor(numerator / denominator);
  const r = numerator - q * denominator;
  return r * 2 >= denominator ? q + 1 : q;
}

/** Percent string/number with up to 2 decimals → hundredths of a percent (10.5% → 1050). */
export function percentToBasisHundredths(value: string | number): number {
  const raw = typeof value === "number" ? value.toFixed(2) : value.trim().replace(",", ".");
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(raw)) throw new Error(`Invalid percentage: ${value}`);
  const [whole, frac = ""] = raw.split(".");
  const result = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  if (result > 10000) throw new Error(`Percentage above 100: ${value}`);
  return result;
}

export function basisHundredthsToPercent(bh: number): string {
  return `${Math.floor(bh / 100)}.${String(bh % 100).padStart(2, "0")}`;
}

const eurFormatter = new Intl.NumberFormat("sl-SI", { style: "currency", currency: "EUR" });

export function formatEur(value: Cents | string | null | undefined, opts?: { cents?: boolean }): string {
  if (value === null || value === undefined || value === "") return "–";
  const cents = typeof value === "string" ? toCents(value) : opts?.cents === false ? Math.round(value * 100) : value;
  return eurFormatter.format(cents / 100);
}

/** Format a numeric-column string ("1234.50") as EUR. */
export function formatDecimalEur(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "–";
  return formatEur(toCents(typeof value === "number" ? value.toFixed(2) : value));
}

export function sumDecimals(values: Array<string | number | null | undefined>): Cents {
  return values.reduce<number>((acc, v) => (v === null || v === undefined || v === "" ? acc : acc + toCents(String(v))), 0);
}
