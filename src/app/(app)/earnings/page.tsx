import type { Metadata } from "next";
import { requireSession } from "@/lib/auth";
import { formatDate, todayIso } from "@/lib/dates";
import { formatEur, sumDecimals } from "@/lib/money";
import { hrefWith, pageParam, param } from "@/lib/url";
import { COMMISSION_RULES } from "@/lib/commission/rules";
import { Card } from "@/components/ui/card";
import { EmptyState, PageHeader, Pagination, Stat, Tabs } from "@/components/ui/misc";
import { LedgerTable } from "@/components/payroll/ledger-table";
import { ByMonthCard, summarize } from "@/components/payroll/summaries";
import { getInstallmentsForSummary, LEDGER_SORTS, listLedger, type LedgerFilters } from "@/server/queries/payroll";
import { buildSortHrefs } from "@/lib/sort-links";
import { getPeople } from "@/server/queries/people";
import { getOwnerEarnings } from "@/server/queries/owner-earnings";
import { OwnerEarnings } from "@/components/payroll/owner-earnings";
import { addDays, addMonthsToMonthStart, formatMonth, monthStart } from "@/lib/dates";

export const metadata: Metadata = { title: "Moji zaslužki" };
const PAGE_SIZE = 50;

/** Own commission ledger. Always filtered to the signed-in user (and enforced by RLS). */
export default async function EarningsPage({ searchParams }: PageProps<"/earnings">) {
  const { profile } = await requireSession();
  const sp = await searchParams;
  const today = todayIso();
  const status = (param(sp, "status") ?? "unpaid") as LedgerFilters["status"];
  const page = pageParam(sp);
  const [{ rows, total, sort }, all, people] = await Promise.all([
    listLedger({ status, beneficiary: profile.id, today, sort: param(sp, "sort"), page, pageSize: PAGE_SIZE }),
    getInstallmentsForSummary({ beneficiary: profile.id }),
    getPeople(),
  ]);
  const names = Object.fromEntries([...people.values()].map((p) => [p.id, `${p.first_name} ${p.last_name}`]));

  // Owner: agency earnings (insurer commission − agents − callers)
  const periods = [
    { key: "month", label: "Ta mesec", from: monthStart(today), to: addDays(addMonthsToMonthStart(today, 1), -1) },
    { key: "last", label: "Prejšnji mesec", from: addMonthsToMonthStart(today, -1), to: addDays(monthStart(today), -1) },
    { key: "year", label: "Letos", from: `${today.slice(0, 4)}-01-01`, to: `${today.slice(0, 4)}-12-31` },
    { key: "all", label: "Vse", from: null, to: null },
  ] as const;
  const period = periods.find((p) => p.key === param(sp, "period")) ?? periods[0];
  const owner = profile.role === "owner" ? await getOwnerEarnings(profile.id, period.from, period.to) : null;
  const periodLabel = period.key === "month" || period.key === "last" ? formatMonth(period.from!) : period.label.toLowerCase();
  const s = summarize(all, today);
  const year = today.slice(0, 4);
  const paidThisYear = sumDecimals(all.filter((r) => r.status === "paid" && (r.paid_at ?? "").startsWith(year)).map((r) => r.amount));

  return (
    <>
      {owner && (
        <OwnerEarnings
          rows={owner.rows}
          totals={owner.totals}
          names={names}
          activePeriod={period.key}
          periodLabel={periodLabel}
          periodTabs={periods.map((p) => ({ key: p.key, label: p.label, href: hrefWith("/earnings", sp, { period: p.key === "month" ? undefined : p.key }) }))}
        />
      )}
      <PageHeader
        title={profile.role === "owner" ? "Moje provizije kot zastopnik" : "Moji zaslužki"}
        description={
          profile.role === "caller"
            ? `Enkratna provizija: mesečna premija × vaš faktor ob prodaji, izplačilo ${COMMISSION_RULES.payoutDay}. v mesecu po sklenitvi (presečni dan ${COMMISSION_RULES.cutoffDay}.).`
            : `Provizija: premija × 12 × leta × vaš odstotek ob prodaji; izplačilo v treh obrokih (${COMMISSION_RULES.agentInstallments.map((i) => `${i.sharePercent} %`).join(" / ")}).`
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Stat label="Naslednje izplačilo" value={formatEur(s.nextCents)} hint={s.nextDate ? formatDate(s.nextDate) : "–"} tone="success" />
        <Stat label="Zapadlo, še ni izplačano" value={formatEur(s.dueCents)} tone={s.dueCents ? "warning" : "default"} />
        <Stat label="Vsa prihodnja izplačila" value={formatEur(s.futureCents)} />
        <Stat label={`Izplačano v ${year}`} value={formatEur(paidThisYear)} />
      </div>
      <Tabs
        active={status ?? "unpaid"}
        tabs={[
          { key: "unpaid", label: "Neizplačano" },
          { key: "paid", label: "Izplačano" },
          { key: "all", label: "Vse" },
        ].map((t) => ({ ...t, href: hrefWith("/earnings", sp, { status: t.key === "unpaid" ? undefined : t.key, page: undefined }) }))}
      />
      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          {rows.length === 0 ? <EmptyState title="Ni zapisov" /> : <LedgerTable rows={rows} names={names} canMarkPaid={false} showBeneficiary={false} sort={sort} sortHrefs={buildSortHrefs("/earnings", sp, LEDGER_SORTS)} />}
          <div className="border-t border-line">
            <Pagination page={page} pageSize={PAGE_SIZE} total={total} hrefFor={(p) => hrefWith("/earnings", sp, { page: p })} />
          </div>
        </Card>
        <ByMonthCard rows={all.filter((r) => r.status === "scheduled")} title="Moja izplačila po mesecih" />
      </div>
    </>
  );
}
