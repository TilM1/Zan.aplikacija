import type { Metadata } from "next";
import Link from "next/link";
import { CalendarClock } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { daysBetween, formatDate, todayIso } from "@/lib/dates";
import { EXPIRY_CATEGORY_LABELS } from "@/lib/labels";
import { hrefWith, isUuid, pageParam, param } from "@/lib/url";
import { formatPhone } from "@/lib/phone";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState, PageHeader, Pagination, Tabs } from "@/components/ui/misc";
import { SortTH, Table, TD, TH, THead, TR } from "@/components/ui/table";
import { FilterBar, type FilterDef } from "@/components/pipeline/filter-bar";
import { ExpiryActions } from "@/components/expiries/expiry-actions";
import { listExpiries, type ExpiryView } from "@/server/queries/expiries";
import { getAgents, getPeople, nameOf, toOptions } from "@/server/queries/people";

export const metadata: Metadata = { title: "Skadence" };
const PAGE_SIZE = 50;
const VIEWS: { key: ExpiryView; label: string }[] = [
  { key: "due", label: "Za klic" },
  { key: "upcoming", label: "Prihajajoče" },
  { key: "done", label: "Urejene" },
  { key: "all", label: "Vse" },
];

export default async function RenewalsPage({ searchParams }: PageProps<"/renewals">) {
  const { profile } = await requireSession(["agent", "owner"]);
  const sp = await searchParams;
  const view = (VIEWS.find((v) => v.key === param(sp, "view"))?.key ?? "due") as ExpiryView;
  const isOwner = profile.role === "owner";
  const agentParam = param(sp, "agent");
  const agentId = isOwner ? (agentParam === "all" ? null : isUuid(agentParam) ? agentParam : profile.id) : profile.id;
  const page = pageParam(sp);
  const [{ rows, total, sort, days }, people, agents] = await Promise.all([
    listExpiries({ view, agentId, category: param(sp, "category"), q: param(sp, "q"), sort: param(sp, "sort"), page, pageSize: PAGE_SIZE }),
    getPeople(),
    getAgents(),
  ]);
  const today = todayIso();
  const sortProps = { sort, hrefFor: (s: string) => hrefWith("/renewals", sp, { sort: s, page: undefined }) };
  const filters: FilterDef[] = [
    { key: "q", label: "Iskanje", type: "search", placeholder: "Ime, telefon…" },
    { key: "category", label: "Vrsta", type: "select", options: [{ value: "", label: "Vse" }, ...Object.entries(EXPIRY_CATEGORY_LABELS).map(([k, v]) => ({ value: k, label: v }))] },
    ...(isOwner
      ? [{ key: "agent", label: "Zastopnik", type: "select", options: [{ value: "", label: "Moje" }, { value: "all", label: "Vsi zastopniki" }, ...toOptions(agents).filter((a) => a.id !== profile.id).map((a) => ({ value: a.id, label: a.name }))] } as FilterDef]
      : []),
  ];

  return (
    <>
      <PageHeader
        title="Skadence"
        description={`Druga zavarovanja strank, ki kmalu potečejo. V »Za klic« so tista, ki potečejo v naslednjih ${days} dneh – pokličite stranko in ji ponudite zavarovanje.`}
      />
      <Tabs active={view} tabs={VIEWS.map((v) => ({ key: v.key, label: v.label, href: hrefWith("/renewals", sp, { view: v.key === "due" ? undefined : v.key, page: undefined, sort: undefined }) }))} />
      <FilterBar className="mb-4" filters={filters} />
      <Card>
        {rows.length === 0 ? (
          <EmptyState icon={CalendarClock} title={view === "due" ? "Ni skadenc za klic" : "Ni skadenc"} description="Skadence vpišete pri stranki ali ob vnosu rezultata svetovanja." />
        ) : (
          <Table>
            <THead>
              <tr>
                <SortTH label="Poteče" column="expiry_date" {...sortProps} />
                <TH>Stranka</TH>
                <TH>Telefon</TH>
                <SortTH label="Vrsta" column="category" {...sortProps} />
                <TH>Opis / zavarovalnica</TH>
                <TH>Opomba</TH>
                {isOwner && <TH>Zastopnik</TH>}
                {view === "done" || view === "all" ? <SortTH label="Stanje" column="status" {...sortProps} /> : null}
                {view !== "done" && <TH className="text-right">Dejanja</TH>}
              </tr>
            </THead>
            <tbody>
              {rows.map((e) => {
                const left = daysBetween(today, e.expiry_date);
                return (
                  <TR key={e.id}>
                    <TD className="whitespace-nowrap">
                      <span className="font-semibold tabular">{formatDate(e.expiry_date)}</span>
                      {e.status === "open" && (
                        <span className={`block text-xs ${left < 0 ? "text-danger" : left <= 7 ? "font-semibold text-warning" : "text-ink-3"}`}>
                          {left < 0 ? `poteklo pred ${-left} dnevi` : left === 0 ? "poteče danes" : `čez ${left} dni`}
                        </span>
                      )}
                      {e.snoozed_until && e.status === "open" && <span className="block text-[11px] text-ink-3">odloženo do {formatDate(e.snoozed_until)}</span>}
                    </TD>
                    <TD>
                      <Link href={`/customers/${e.customer.id}?tab=expiries`} className="font-medium hover:text-brand hover:underline">
                        {e.customer.first_name} {e.customer.last_name}
                      </Link>
                      <span className="block text-xs text-ink-3">{e.customer.city}</span>
                    </TD>
                    <TD className="whitespace-nowrap">
                      <a href={`tel:${e.customer.phone}`} className="font-medium text-brand hover:underline">
                        {formatPhone(e.customer.phone)}
                      </a>
                    </TD>
                    <TD className="whitespace-nowrap">{EXPIRY_CATEGORY_LABELS[e.category]}</TD>
                    <TD className="max-w-56 text-ink-2">
                      {e.description ?? "–"}
                      {e.insurer && <span className="block text-xs text-ink-3">{e.insurer}</span>}
                    </TD>
                    <TD className="max-w-64 text-ink-2">{e.outcome ?? e.note ?? ""}</TD>
                    {isOwner && <TD className="whitespace-nowrap">{nameOf(people, e.assigned_agent_id)}</TD>}
                    {view === "done" || view === "all" ? (
                      <TD>{e.status === "open" ? <Badge tone="info">Odprto</Badge> : e.status === "done" ? <Badge tone="success">Urejeno</Badge> : <Badge>Ni aktualno</Badge>}</TD>
                    ) : null}
                    {view !== "done" && <TD>{e.status === "open" && <ExpiryActions id={e.id} category={e.category} />}</TD>}
                  </TR>
                );
              })}
            </tbody>
          </Table>
        )}
        <div className="border-t border-line">
          <Pagination page={page} pageSize={PAGE_SIZE} total={total} hrefFor={(p) => hrefWith("/renewals", sp, { page: p })} />
        </div>
      </Card>
    </>
  );
}
