import { addDays, addMonthsToMonthStart, isValidIsoDate, monthStart, todayIso } from "@/lib/dates";

/** Resolve ?from=&to= (inclusive dates) with a default of the current month. */
export function resolvePeriod(from?: string, to?: string) {
  const today = todayIso();
  const f = from && isValidIsoDate(from) ? from : monthStart(today);
  const t = to && isValidIsoDate(to) ? to : addDays(addMonthsToMonthStart(today, 1), -1);
  return { from: f, to: t, toExclusive: addDays(t, 1) };
}

export function lastMonths(n: number) {
  const today = todayIso();
  return { from: addMonthsToMonthStart(today, -(n - 1)), to: today };
}
