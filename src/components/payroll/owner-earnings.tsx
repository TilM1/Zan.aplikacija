import Link from "next/link";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState, Stat, Tabs } from "@/components/ui/misc";
import { Table, TD, TH, THead, TR } from "@/components/ui/table";
import { formatDate } from "@/lib/dates";
import { formatDecimalEur, formatEur } from "@/lib/money";
import type { OwnerEarningRow } from "@/server/queries/owner-earnings";

export function OwnerEarnings({
  rows,
  totals,
  names,
  periodTabs,
  activePeriod,
  periodLabel,
}: {
  rows: OwnerEarningRow[];
  totals: { agency: number; agents: number; callers: number; owner: number; ownSales: number };
  names: Record<string, string>;
  periodTabs: { key: string; label: string; href: string }[];
  activePeriod: string;
  periodLabel: string;
}) {
  return (
    <section className="mb-8">
      <h2 className="mb-1 text-lg font-semibold">Moj zaslužek (agencija)</h2>
      <p className="mb-3 text-sm text-ink-3">
        Provizija zavarovalnice agenciji, zmanjšana za provizije zastopnikov in klicateljev. Pri policah, ki ste jih sklenili sami, vam ostane vse razen dela klicatelja. Po datumu police; stornirane police niso
        upoštevane.
      </p>
      <Tabs tabs={periodTabs} active={activePeriod} />
      <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Stat label={`Provizija zavarovalnice · ${periodLabel}`} value={formatEur(totals.agency)} />
        <Stat label="− provizije zastopnikov" value={formatEur(totals.agents)} />
        <Stat label="− provizije klicateljev" value={formatEur(totals.callers)} />
        <Stat label="= Moj zaslužek" value={formatEur(totals.owner)} tone={totals.owner >= 0 ? "success" : "danger"} hint={totals.ownSales ? `od tega lastne prodaje: ${formatEur(totals.ownSales)}` : undefined} />
      </div>
      <Card>
        <CardHeader title="Po policah" description={`${rows.length} polic`} />
        {rows.length === 0 ? (
          <EmptyState title="V tem obdobju ni polic" />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Datum</TH>
                <TH>Stranka</TH>
                <TH>Produkt</TH>
                <TH className="text-right">Premija</TH>
                <TH className="text-right">Zavarovalnica</TH>
                <TH className="text-right">Zastopnik</TH>
                <TH className="text-right">Klicatelj</TH>
                <TH className="text-right">Moj zaslužek</TH>
              </tr>
            </THead>
            <tbody>
              {rows.map((r) => (
                <TR key={r.policyId}>
                  <TD className="whitespace-nowrap tabular">{formatDate(r.policyDate)}</TD>
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
                      {r.agencyModel === "agent_multiplier" ? `premija × ${r.agencyRate?.toLocaleString("sl-SI")}` : `premija × 12 × ${r.durationYears} let × ${r.agencyRate?.toLocaleString("sl-SI")} %`}
                    </span>
                  </TD>
                  <TD className="text-right whitespace-nowrap tabular">{formatDecimalEur(r.monthlyPremium)}</TD>
                  <TD className="text-right tabular">{formatEur(r.agencyCents)}</TD>
                  <TD className="text-right whitespace-nowrap tabular">
                    {r.soldByOwner ? <span className="text-ink-3">vi</span> : <>−{formatEur(r.agentCents)}</>}
                    <span className="block text-[11px] text-ink-3">{names[r.agentId]}</span>
                  </TD>
                  <TD className="text-right whitespace-nowrap tabular">
                    {r.callerCents ? <>−{formatEur(r.callerCents)}</> : "–"}
                    {r.callerId && <span className="block text-[11px] text-ink-3">{names[r.callerId]}</span>}
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
