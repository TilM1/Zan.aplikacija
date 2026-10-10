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
import { getOwnerEarnings, totalsOf } from "@/server/queries/owner-earnings";
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

  // Owner: agency earnings (insurer commission − agents − callers), by payout date
  const thisYear = today.slice(0, 4);
  const nextYear = String(Number(thisYear) + 1);
  const yearParam = /^\d{4}$/.test(param(sp, "period") ?? "") ? param(sp, "period")! : null;
  const periods: { key: string; label: string; from: string | null; to: string | null }[] = [
    { key: "month", label: "Ta mesec", from: monthStart(today), to: addDays(addMonthsToMonthStart(today, 1), -1) },
    { key: "last", label: "Prejšnji mesec", from: addMonthsToMonthStart(today, -1), to: addDays(monthStart(today), -1) },
    { key: "year", label: `Letos (${thisYear})`, from: `${thisYear}-01-01`, to: `${thisYear}-12-31` },
    { key: "next", label: `Naslednje leto (${nextYear})`, from: `${nextYear}-01-01`, to: `${nextYear}-12-31` },
    ...(yearParam && yearParam !== thisYear && yearParam !== nextYear ? [{ key: yearParam, label: yearParam, from: `${yearParam}-01-01`, to: `${yearParam}-12-31` }] : []),
    { key: "all", label: "Vse", from: null, to: null },
  ];
  const periodKey = yearParam === thisYear ? "year" : yearParam === nextYear ? "next" : param(sp, "period");
  const period = periods.find((p) => p.key === periodKey) ?? periods[0];
  const periodHref = (key: string) => hrefWith("/earnings", sp, { period: key === "month" ? undefined : key });
  const ownerAll = profile.role === "owner" ? await getOwnerEarnings(profile.id) : null;
  const ownerRows = (ownerAll ?? []).filter((r) => (!period.from || r.date >= period.from) && (!period.to || r.date <= period.to));
  const ownerYears = [...new Set((ownerAll ?? []).map((r) => r.date.slice(0, 4)))].sort().map((y) => ({
    year: y,
    totals: totalsOf((ownerAll ?? []).filter((r) => r.date.startsWith(y))),
    href: periodHref(y === thisYear ? "year" : y === nextYear ? "next" : y),
  }));
  const periodLabel = period.key === "month" || period.key === "last" ? formatMonth(period.from!) : period.key === "all" ? "vse" : period.from!.slice(0, 4);
  const s = summarize(all, today);
  const year = today.slice(0, 4);
  const paidThisYear = sumDecimals(all.filter((r) => r.status === "paid" && (r.paid_at ?? "").startsWith(year)).map((r) => r.amount));

  return (
    <>
      {ownerAll && (
        <OwnerEarnings
          rows={ownerRows}
          totals={totalsOf(ownerRows)}
          years={ownerYears}
          thisYear={thisYear}
          names={names}
          activePeriod={period.key}
          periodLabel={periodLabel}
          showSplit={period.key !== "all"}
          periodTabs={periods.map((p) => ({ key: p.key, label: p.label, href: periodHref(p.key) }))}
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
