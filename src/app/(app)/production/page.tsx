import type { Metadata } from "next";
import { requireSession } from "@/lib/auth";
import { formatDate } from "@/lib/dates";
import { formatEur } from "@/lib/money";
import { param } from "@/lib/url";
import { lastMonths, resolvePeriod } from "@/lib/periods";
import { RESULT_LABELS } from "@/lib/labels";
import { PageHeader, Stat } from "@/components/ui/misc";
import { FilterBar } from "@/components/pipeline/filter-bar";
import { AggTable, monthRows } from "@/components/dashboard/report-tables";
import { appointmentsBooked, policyProduction, resultBreakdown, type MetricScope } from "@/server/queries/metrics";

export const metadata: Metadata = { title: "Moja produkcija" };

export default async function ProductionPage({ searchParams }: PageProps<"/production">) {
  const { profile } = await requireSession();
  const sp = await searchParams;
  const period = resolvePeriod(param(sp, "from"), param(sp, "to"));
  const isCaller = profile.role === "caller";
  const scope: MetricScope = isCaller ? { callerId: profile.id } : { agentId: profile.id };
  const trend = lastMonths(12);

  const [prod, results, booked, trendProd] = await Promise.all([
    policyProduction(period.from, period.to, scope),
    resultBreakdown(period.from, period.toExclusive, scope),
    isCaller ? appointmentsBooked(period.from, period.toExclusive, scope) : Promise.resolve(null),
    policyProduction(trend.from, trend.to, scope),
  ]);
  const successRate = results.total ? Math.round((results.counts.A1 / results.total) * 100) : 0;

  return (
    <>
      <PageHeader title="Moja produkcija" description={`${formatDate(period.from)} – ${formatDate(period.to)}`} />
      <FilterBar className="mb-4" filters={[{ key: "from", label: "Od", type: "date" }, { key: "to", label: "Do", type: "date" }]} />
      <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-5">
        {isCaller && <Stat label="Dogovorjeni termini" value={booked?.total ?? 0} />}
        <Stat label="Opravljena svetovanja" value={results.total} />
        <Stat label="Uspešnost (A1)" value={`${successRate} %`} tone="success" />
        <Stat label="Police" value={prod.count} />
        <Stat label="Mesečna premija" value={formatEur(prod.premiumCents)} />
        {!isCaller && <Stat label="B – ni bilo doma" value={results.counts.B} />}
      </div>
      <div className="mb-4 flex flex-wrap gap-2 text-sm">
        {(["A1", "A", "B", "A0"] as const).map((r) => (
          <span key={r} className="rounded-md border border-line bg-surface px-2.5 py-1">
            <b>{r}</b> {RESULT_LABELS[r].label}: <b className="tabular">{results.counts[r]}</b>
          </span>
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <AggTable title="Po produktih" keyLabel="Produkt" rows={[...prod.byProduct.entries()].map(([k, agg]) => ({ key: k, label: k, agg }))} />
        <AggTable title="Zadnjih 12 mesecev" keyLabel="Mesec" rows={monthRows(trendProd.byMonth)} />
      </div>
    </>
  );
}
