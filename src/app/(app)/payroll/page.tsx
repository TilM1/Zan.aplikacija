import type { Metadata } from "next";
import { requireSession } from "@/lib/auth";
import { formatDate, todayIso } from "@/lib/dates";
import { formatEur } from "@/lib/money";
import { hrefWith, isUuid, pageParam, param } from "@/lib/url";
import { COMMISSION_RULES } from "@/lib/commission/rules";
import { Card } from "@/components/ui/card";
import { EmptyState, PageHeader, Pagination, Stat, Tabs } from "@/components/ui/misc";
import { FilterBar } from "@/components/pipeline/filter-bar";
import { LedgerTable } from "@/components/payroll/ledger-table";
import { ByEmployeeCard, ByMonthCard, summarize } from "@/components/payroll/summaries";
import { getInstallmentsForSummary, listLedger, type LedgerFilters } from "@/server/queries/payroll";
import { getPeople } from "@/server/queries/people";

export const metadata: Metadata = { title: "Provizije in izplačila" };
const PAGE_SIZE = 100;
const TABS = [
  { key: "due", label: "Zapadlo" },
  { key: "upcoming", label: "Prihajajoče" },
  { key: "unpaid", label: "Vse neplačano" },
  { key: "paid", label: "Izplačano" },
  { key: "all", label: "Vse" },
] as const;

export default async function PayrollPage({ searchParams }: PageProps<"/payroll">) {
  await requireSession(["owner"]);
  const sp = await searchParams;
  const today = todayIso();
  const status = (TABS.find((t) => t.key === param(sp, "status"))?.key ?? "due") as LedgerFilters["status"];
  const page = pageParam(sp);
  const beneficiary = isUuid(param(sp, "beneficiary")) ? param(sp, "beneficiary") : undefined;
  const type = param(sp, "type") as "agent" | "caller" | undefined;

  const [{ rows, total }, unpaid, people] = await Promise.all([
    listLedger({ status, beneficiary, type: type === "agent" || type === "caller" ? type : undefined, from: param(sp, "from"), to: param(sp, "to"), today, page, pageSize: PAGE_SIZE }),
    getInstallmentsForSummary({ statuses: ["scheduled"], beneficiary }),
    getPeople(),
  ]);
  const names = Object.fromEntries([...people.values()].map((p) => [p.id, `${p.first_name} ${p.last_name}`]));
  const s = summarize(unpaid, today);
  const employees = [...people.values()];

  return (
    <>
      <PageHeader
        title="Provizije in izplačila"
        description={`Izplačila ${COMMISSION_RULES.payoutDay}. v mesecu · presečni dan ${COMMISSION_RULES.cutoffDay}. · obroki zastopnika ${COMMISSION_RULES.agentInstallments.map((i) => `${i.sharePercent} %`).join(" / ")}`}
      />
      <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Stat label="Zapadlo, neizplačano" value={formatEur(s.dueCents)} tone={s.dueCents > 0 ? "warning" : "default"} />
        <Stat label="Naslednje izplačilo" value={formatEur(s.nextCents)} hint={s.nextDate ? formatDate(s.nextDate) : "–"} />
        <Stat label="Prihodnje obveznosti" value={formatEur(s.futureCents)} hint="Vsi načrtovani obroki" />
        <Stat label="Skupaj neizplačano" value={formatEur(s.unpaidCents)} />
      </div>

      <Tabs active={status ?? "due"} tabs={TABS.map((t) => ({ key: t.key, label: t.label, href: hrefWith("/payroll", sp, { status: t.key === "due" ? undefined : t.key, page: undefined }) }))} />
      <FilterBar
        className="mb-4"
        filters={[
          { key: "beneficiary", label: "Zaposleni", type: "select", options: [{ value: "", label: "Vsi" }, ...employees.map((p) => ({ value: p.id, label: names[p.id] }))] },
          { key: "type", label: "Vrsta", type: "select", options: [{ value: "", label: "Vse" }, { value: "agent", label: "Zastopnik" }, { value: "caller", label: "Klicatelj" }] },
          { key: "from", label: "Zapadlost od", type: "date" },
          { key: "to", label: "Zapadlost do", type: "date" },
        ]}
      />
      <Card className="mb-4">
        {rows.length === 0 ? (
          <EmptyState title="Ni izplačil" description="Za izbrane filtre ni zapisov v knjigi izplačil." />
        ) : (
          <LedgerTable rows={rows} names={names} canMarkPaid showBeneficiary />
        )}
        <div className="border-t border-line">
          <Pagination page={page} pageSize={PAGE_SIZE} total={total} hrefFor={(p) => hrefWith("/payroll", sp, { page: p })} />
        </div>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <ByMonthCard rows={unpaid} />
        <ByEmployeeCard rows={unpaid} names={names} today={today} />
      </div>
    </>
  );
}
