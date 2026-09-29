import type { Metadata } from "next";
import { requireSession } from "@/lib/auth";
import { formatDate } from "@/lib/dates";
import { formatEur } from "@/lib/money";
import { param } from "@/lib/url";
import { lastMonths, resolvePeriod } from "@/lib/periods";
import { PageHeader, Stat } from "@/components/ui/misc";
import { FilterBar } from "@/components/pipeline/filter-bar";
import { AggTable, monthRows } from "@/components/dashboard/report-tables";
import { appointmentsBooked, policyProduction, resultBreakdown } from "@/server/queries/metrics";
import { getPeople, nameOf } from "@/server/queries/people";

export const metadata: Metadata = { title: "Poročila" };

/** Owner V1 reports — built on the same metric functions as the dashboard. */
export default async function ReportsPage({ searchParams }: PageProps<"/reports">) {
  await requireSession(["owner"]);
  const sp = await searchParams;
  const period = resolvePeriod(param(sp, "from"), param(sp, "to"));
  const trend = lastMonths(12);
  const [prod, results, booked, trendProd, people] = await Promise.all([
    policyProduction(period.from, period.to),
    resultBreakdown(period.from, period.toExclusive),
    appointmentsBooked(period.from, period.toExclusive),
    policyProduction(trend.from, trend.to),
    getPeople(),
  ]);

  const perAgent = new Map<string, { total: number; a1: number }>();
  const perCaller = new Map<string, { total: number; a1: number; b: number }>();
  for (const r of results.rows) {
    const a = perAgent.get(r.agent_id) ?? { total: 0, a1: 0 };
    a.total++;
    if (r.result === "A1") a.a1++;
    perAgent.set(r.agent_id, a);
    if (r.caller_id) {
      const c = perCaller.get(r.caller_id) ?? { total: 0, a1: 0, b: 0 };
      c.total++;
      if (r.result === "A1") c.a1++;
      if (r.result === "B") c.b++;
      perCaller.set(r.caller_id, c);
    }
  }
  const agentIds = new Set([...prod.byAgent.keys(), ...perAgent.keys()]);
  const callerIds = new Set([...prod.byCaller.keys(), ...perCaller.keys(), ...booked.byCaller.keys()]);
  const zero = { count: 0, premiumCents: 0 };
  const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)} %` : "–");

  return (
    <>
      <PageHeader title="Poročila" description={`${formatDate(period.from)} – ${formatDate(period.to)} · po datumu police / zaključka svetovanja`} />
      <FilterBar className="mb-4" filters={[{ key: "from", label: "Od", type: "date" }, { key: "to", label: "Do", type: "date" }]} />
      <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-5">
        <Stat label="Dogovorjeni termini" value={booked.total} />
        <Stat label="Svetovanja" value={results.total} />
        <Stat label="Uspešnost A1" value={pct(results.counts.A1, results.total)} tone="success" />
        <Stat label="Police" value={prod.count} />
        <Stat label="Mesečna premija" value={formatEur(prod.premiumCents)} />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <AggTable
          title="Produkcija po zastopnikih"
          keyLabel="Zastopnik"
          extra={["Svetovanja", "A1 %"]}
          rows={[...agentIds].map((id) => ({
            key: id,
            label: nameOf(people, id),
            agg: prod.byAgent.get(id) ?? zero,
            extra: [perAgent.get(id)?.total ?? 0, pct(perAgent.get(id)?.a1 ?? 0, perAgent.get(id)?.total ?? 0)],
          })).sort((a, b) => b.agg.premiumCents - a.agg.premiumCents)}
        />
        <AggTable
          title="Produkcija po klicateljih"
          keyLabel="Klicatelj"
          extra={["Termini", "Svetovanja", "B", "A1 %"]}
          rows={[...callerIds].map((id) => ({
            key: id,
            label: nameOf(people, id),
            agg: prod.byCaller.get(id) ?? zero,
            extra: [booked.byCaller.get(id) ?? 0, perCaller.get(id)?.total ?? 0, perCaller.get(id)?.b ?? 0, pct(perCaller.get(id)?.a1 ?? 0, perCaller.get(id)?.total ?? 0)],
          })).sort((a, b) => b.agg.premiumCents - a.agg.premiumCents)}
        />
        <AggTable title="Po produktih" keyLabel="Produkt" rows={[...prod.byProduct.entries()].map(([k, agg]) => ({ key: k, label: k, agg }))} />
        <AggTable title="Trend – zadnjih 12 mesecev" keyLabel="Mesec" rows={monthRows(trendProd.byMonth)} />
      </div>
    </>
  );
}
