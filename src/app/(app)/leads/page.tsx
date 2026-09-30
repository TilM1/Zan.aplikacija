import type { Metadata } from "next";
import Link from "next/link";
import { PhoneCall } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { hrefWith, isUuid, pageParam, param } from "@/lib/url";
import { buildSortHrefs } from "@/lib/sort-links";
import { Card } from "@/components/ui/card";
import { EmptyState, PageHeader, Pagination, Tabs } from "@/components/ui/misc";
import { buttonClasses } from "@/components/ui/button";
import { FilterBar, type FilterDef } from "@/components/pipeline/filter-bar";
import { LeadsTable } from "@/components/leads/leads-table";
import { getCityFacets, getLeadListStats, getLeadLists, getRecallMonths, LEAD_SORTS, listLeads, type LeadView } from "@/server/queries/leads";
import { getPeople } from "@/server/queries/people";

export const metadata: Metadata = { title: "Klicni seznam" };
const PAGE_SIZE = 50;
const VIEWS: { key: LeadView; label: string }[] = [
  { key: "due", label: "Za klic" },
  { key: "scheduled", label: "Načrtovani ponovni klici" },
  { key: "appointment", label: "Termini" },
  { key: "rejected", label: "Zavrnjeni" },
  { key: "do_not_call", label: "Ne kliči" },
  { key: "all", label: "Vsi" },
];

export default async function LeadsPage({ searchParams }: PageProps<"/leads">) {
  const { profile } = await requireSession(["caller", "owner"]);
  const sp = await searchParams;
  const view = (VIEWS.find((v) => v.key === param(sp, "view"))?.key ?? "due") as LeadView;
  const listId = isUuid(param(sp, "list")) ? param(sp, "list") : undefined;
  const page = pageParam(sp);

  const [lists, stats, cities, people, recallMonths, result] = await Promise.all([
    getLeadLists({ includeInactive: false }),
    getLeadListStats(),
    getCityFacets(listId),
    getPeople(),
    getRecallMonths(),
    listLeads({
      view,
      list: listId,
      q: param(sp, "q"),
      city: param(sp, "city"),
      postal: param(sp, "postal"),
      activity: param(sp, "activity"),
      sort: param(sp, "sort"),
      page,
      pageSize: PAGE_SIZE,
    }),
  ]);

  if (lists.length === 0) {
    return (
      <>
        <PageHeader title="Klicni seznam" />
        <Card>
          <EmptyState
            icon={PhoneCall}
            title="Ni klicnih seznamov"
            description={profile.role === "owner" ? "Uvozite Excel datoteko s kontakti v »Uvoz / izvoz«." : "Lastnik še ni uvozil kontaktov za vas."}
            action={profile.role === "owner" ? <Link href="/export" className={buttonClasses("gold")}>Uvozi kontakte</Link> : undefined}
          />
        </Card>
      </>
    );
  }

  // Tab counts (for the selected list or all visible lists)
  const relevant = Object.entries(stats).filter(([id]) => (listId ? id === listId : lists.some((l) => l.id === id)));
  const sum = (fn: (s: (typeof stats)[string]) => number) => relevant.reduce((a, [, s]) => a + fn(s), 0);
  const counts: Record<string, number> = {
    due: sum((s) => s.due),
    appointment: sum((s) => s.byStatus.appointment ?? 0),
    rejected: sum((s) => s.byStatus.rejected ?? 0),
    do_not_call: sum((s) => s.byStatus.do_not_call ?? 0),
    all: sum((s) => s.total),
  };
  counts.scheduled = sum((s) => (s.byStatus.callback ?? 0) + (s.byStatus.rejected ?? 0)) - (sum((s) => s.due) - sum((s) => s.byStatus.new ?? 0));

  const names = Object.fromEntries([...people.values()].map((p) => [p.id, `${p.first_name} ${p.last_name}`]));
  const listNames = Object.fromEntries(lists.map((l) => [l.id, l.name]));

  const filters: FilterDef[] = [
    { key: "q", label: "Iskanje", type: "search", placeholder: "Naziv, telefon, e-pošta, davčna…" },
    ...(lists.length > 1
      ? [{ key: "list", label: "Seznam (mapa)", type: "select", options: [{ value: "", label: "Vsi seznami" }, ...lists.map((l) => ({ value: l.id, label: l.name }))] } as FilterDef]
      : []),
    { key: "city", label: "Kraj", type: "select", options: [{ value: "", label: "Vsi kraji" }, ...cities.map((c) => ({ value: c.city, label: `${c.city} (${c.n})` }))] },
    { key: "postal", label: "Poštna št.", type: "search", placeholder: "npr. 1000", className: "min-w-28 max-w-32 flex-none" },
    { key: "activity", label: "Dejavnost", type: "search", placeholder: "npr. gradbeništvo", className: "min-w-44 max-w-56" },
  ];

  return (
    <>
      <PageHeader
        title="Klicni seznam"
        description="Kliknite na kontakt, pokličite in izberite, kako se je klic končal. Zavihek »Za klic« vsebuje nove kontakte in tiste, ki jih je treba danes poklicati ponovno."
      />
      <Tabs
        active={view}
        tabs={VIEWS.map((v) => ({ key: v.key, label: v.label, count: counts[v.key], href: hrefWith("/leads", sp, { view: v.key === "due" ? undefined : v.key, page: undefined, sort: undefined }) }))}
      />
      <FilterBar className="mb-4" filters={filters} />
      <Card>
        <LeadsTable
          rows={result.rows}
          names={names}
          listNames={listNames}
          showList={lists.length > 1 && !listId}
          sort={result.sort}
          sortHrefs={buildSortHrefs("/leads", sp, LEAD_SORTS)}
          recallMonths={recallMonths}
        />
        <div className="border-t border-line">
          <Pagination page={page} pageSize={PAGE_SIZE} total={result.total} hrefFor={(p) => hrefWith("/leads", sp, { page: p })} />
        </div>
      </Card>
    </>
  );
}
