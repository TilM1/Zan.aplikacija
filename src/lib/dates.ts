/**
 * Date/time handling.
 *  - Instants (appointments, audit timestamps) are stored as timestamptz (UTC).
 *  - Calendar dates (policy date, payout dates) are plain DATE values.
 *  - All user-facing input/output uses the business time zone Europe/Ljubljana,
 *    so appointments never shift with the server's or browser's time zone.
 */
import { TZDate } from "@date-fns/tz";

export const BUSINESS_TZ = "Europe/Ljubljana";
const LOCALE = "sl-SI";

const dateFmt = new Intl.DateTimeFormat(LOCALE, { timeZone: BUSINESS_TZ, day: "2-digit", month: "2-digit", year: "numeric" });
const timeFmt = new Intl.DateTimeFormat(LOCALE, { timeZone: BUSINESS_TZ, hour: "2-digit", minute: "2-digit" });
const weekdayFmt = new Intl.DateTimeFormat(LOCALE, { timeZone: BUSINESS_TZ, weekday: "short" });
const partsFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: BUSINESS_TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

/** 23. 10. 2026 → normalised to "23.10.2026" */
export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "–";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split("-");
    return `${d}.${m}.${y}`;
  }
  return dateFmt.format(new Date(value)).replace(/\s/g, "");
}

export function formatTime(value: string | Date | null | undefined): string {
  if (!value) return "–";
  return timeFmt.format(new Date(value));
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return "–";
  return `${formatDate(value)} ${formatTime(value)}`;
}

export function formatWeekday(value: string | Date): string {
  return weekdayFmt.format(new Date(value));
}

/** Local (Ljubljana) parts of an instant. */
export function localParts(value: string | Date) {
  const parts = Object.fromEntries(partsFmt.formatToParts(new Date(value)).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

/** "2026-10-20" + "09:30" in Europe/Ljubljana → ISO UTC string. */
export function localDateTimeToIso(date: string, time: string): string {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const tm = /^(\d{2}):(\d{2})$/.exec(time);
  if (!dm || !tm) throw new Error("Invalid date/time");
  const d = new TZDate(Number(dm[1]), Number(dm[2]) - 1, Number(dm[3]), Number(tm[1]), Number(tm[2]), BUSINESS_TZ);
  return new Date(d.getTime()).toISOString();
}

/** Today's calendar date in Ljubljana, YYYY-MM-DD. */
export function todayIso(now: Date = new Date()): string {
  return localParts(now).date;
}

/** UTC ISO bounds of a local calendar day [start, end). */
export function dayBoundsIso(date: string): { start: string; end: string } {
  return { start: localDateTimeToIso(date, "00:00"), end: localDateTimeToIso(addDays(date, 1), "00:00") };
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

export function addMonthsToMonthStart(date: string, months: number): string {
  const [y, m] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + months, 1));
  return dt.toISOString().slice(0, 10);
}

export function monthStart(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

/** Monday of the ISO week containing the date. */
export function weekStart(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  return addDays(date, dow === 0 ? -6 : 1 - dow);
}

export function formatMonth(date: string): string {
  const [y, m] = date.split("-").map(Number);
  return new Intl.DateTimeFormat(LOCALE, { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, 1)));
}

export function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Whole calendar days from date a to date b (YYYY-MM-DD). */
export function daysBetween(a: string, b: string): number {
  const [y1, m1, d1] = a.split("-").map(Number);
  const [y2, m2, d2] = b.split("-").map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400_000);
}
