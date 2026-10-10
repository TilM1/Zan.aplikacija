import Link from "next/link";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState, Stat, Tabs } from "@/components/ui/misc";
import { Table, TD, TH, THead, TR } from "@/components/ui/table";
import { formatDate } from "@/lib/dates";
import { formatEur } from "@/lib/money";
import type { OwnerEarningRow, OwnerTotals } from "@/server/queries/owner-earnings";

export function OwnerEarnings({
  rows,
  totals,
  years,
  thisYear,
  names,
  periodTabs,
  activePeriod,
  periodLabel,
  showSplit,
}: {
  /** Payouts falling into the selected period. */
  rows: OwnerEarningRow[];
  totals: OwnerTotals;
  /** Totals per payout year, from all signed policies. */
  years: { year: string; totals: OwnerTotals; href: string }[];
  thisYear: string;
  names: Record<string, string>;
  periodTabs: { key: string; label: string; href: string }[];
  activePeriod: string;
  periodLabel: string;
  showSplit: boolean;
}) {
  return (
    <section className="mb-8">
      <h2 className="mb-1 text-lg font-semibold">Moj zaslužek (agencija)</h2>
      <p className="mb-3 text-sm text-ink-3">
        Prikazano po <b>datumu izplačila</b>, ne po datumu police: provizija zavarovalnice pride v obrokih (55 % / 20 % / 25 % v treh letih, Specialisti v 11 mesečnih obrokih), od nje se odštejejo provizije
        zastopnikov in klicateljev, ko zapadejo. Stornirane police niso upoštevane.
      </p>
      <Tabs tabs={periodTabs} active={activePeriod} />
      <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Stat label={`Provizija zavarovalnice · ${periodLabel}`} value={formatEur(totals.agency)} />
        <Stat label="− provizije zastopnikov" value={formatEur(totals.agents)} />
        <Stat label="− provizije klicateljev" value={formatEur(totals.callers)} />
        <Stat
          label="= Moj zaslužek"
          value={formatEur(totals.owner)}
          tone={totals.owner >= 0 ? "success" : "danger"}
          hint={showSplit ? `nove police: ${formatEur(totals.fromNew)} · prejšnje police: ${formatEur(totals.fromEarlier)}` : undefined}
        />
      </div>

      <Card className="mb-4">
        <CardHeader title="Po letih" description="Koliko dobim v posameznem letu od polic, ki so že podpisane. Nove police tega leta so ločene od obrokov prejšnjih polic." />
        {years.length === 0 ? (
          <EmptyState title="Ni polic" />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Leto izplačila</TH>
                <TH className="text-right">Zavarovalnica</TH>
                <TH className="text-right">− zastopniki</TH>
                <TH className="text-right">− klicatelji</TH>
                <TH className="text-right">Od novih polic</TH>
                <TH className="text-right">Od prejšnjih polic</TH>
                <TH className="text-right">Moj zaslužek</TH>
              </tr>
            </THead>
            <tbody>
              {years.map(({ year, totals: t, href }) => (
                <TR key={year}>
                  <TD className="whitespace-nowrap font-semibold">
                    <Link href={href} className="hover:text-brand hover:underline">
                      {year}
                    </Link>
                    {year === thisYear && <span className="ml-1.5 text-[11px] font-normal text-ink-3">letos</span>}
                    {Number(year) === Number(thisYear) + 1 && <span className="ml-1.5 text-[11px] font-normal text-ink-3">naslednje leto</span>}
                  </TD>
                  <TD className="text-right tabular">{formatEur(t.agency)}</TD>
                  <TD className="text-right tabular">{t.agents ? `−${formatEur(t.agents)}` : "–"}</TD>
                  <TD className="text-right tabular">{t.callers ? `−${formatEur(t.callers)}` : "–"}</TD>
                  <TD className="text-right tabular">{formatEur(t.fromNew)}</TD>
                  <TD className="text-right tabular">{formatEur(t.fromEarlier)}</TD>
                  <TD className={`text-right font-semibold tabular ${t.owner < 0 ? "text-danger" : "text-success"}`}>{formatEur(t.owner)}</TD>
                </TR>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Card>
        <CardHeader title={`Izplačila · ${periodLabel}`} description={`${rows.length} obrokov`} />
        {rows.length === 0 ? (
          <EmptyState title="V tem obdobju ni izplačil" />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Izplačilo</TH>
                <TH>Stranka</TH>
                <TH>Polica</TH>
                <TH>Obrok</TH>
                <TH className="text-right">Zavarovalnica</TH>
                <TH className="text-right">Zastopnik</TH>
                <TH className="text-right">Klicatelj</TH>
                <TH className="text-right">Moj zaslužek</TH>
              </tr>
            </THead>
            <tbody>
              {rows.map((r) => (
                <TR key={`${r.policyId}-${r.date}`}>
                  <TD className="whitespace-nowrap tabular">{formatDate(r.date)}</TD>
                  <TD>
                    <Link href={`/customers/${r.customerId}`} className="hover:text-brand hover:underline">
                      {r.customerName}
                    </Link>
                  </TD>
                  <TD>
                    <Link href={`/policies/${r.policyId}`} className="hover:text-brand hover:underline">
                      {r.productName}
                    </Link>
                    <span className="block text-[11px] text-ink-3">
                      podpisana {formatDate(r.policyDate)}
                      {r.policyDate.slice(0, 4) !== r.date.slice(0, 4) && " · prejšnja polica"}
                    </span>
                  </TD>
                  <TD className="whitespace-nowrap text-ink-2">
                    {r.number ? `${r.number}. od ${r.of} (${r.sharePercent?.toLocaleString("sl-SI")} %)` : "–"}
                  </TD>
                  <TD className="text-right tabular">{formatEur(r.agencyCents)}</TD>
                  <TD className="text-right whitespace-nowrap tabular">
                    {r.soldByOwner ? <span className="text-ink-3">vi</span> : r.agentCents ? <>−{formatEur(r.agentCents)}</> : "–"}
                    <span className="block text-[11px] text-ink-3">{names[r.agentId]}</span>
                  </TD>
                  <TD className="text-right whitespace-nowrap tabular">
                    {r.callerCents ? <>−{formatEur(r.callerCents)}</> : "–"}
                    {r.callerId && r.callerCents !== 0 && <span className="block text-[11px] text-ink-3">{names[r.callerId]}</span>}
                  </TD>
                  <TD className={`text-right font-semibold tabular ${r.ownerCents < 0 ? "text-danger" : "text-success"}`}>{formatEur(r.ownerCents)}</TD>
                </TR>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </section>
  );
}
