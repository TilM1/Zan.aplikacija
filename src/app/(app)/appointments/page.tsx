import type { Metadata } from "next";
import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { addDays, dayBoundsIso } from "@/lib/dates";
import { RESULT_LABELS } from "@/lib/labels";
import { hrefWith, isUuid, pageParam, param } from "@/lib/url";
import { Card } from "@/components/ui/card";
import { PageHeader, Pagination } from "@/components/ui/misc";
import { buttonClasses } from "@/components/ui/button";
import { FilterBar, type FilterDef } from "@/components/pipeline/filter-bar";
import { AppointmentsTable } from "@/components/appointments/appointments-table";
import { toPipelineCard } from "@/components/pipeline/to-card";
import { listAppointments } from "@/server/queries/appointments";
import { getAgents, getPeople, getVisibleCommissionRates, toOptions } from "@/server/queries/people";
import { getActiveProducts } from "@/server/queries/policies";

export const metadata: Metadata = { title: "Termini" };
const PAGE_SIZE = 50;

/** Appointments list. Callers see the appointments they booked; others see what RLS allows. */
export default async function AppointmentsPage({ searchParams }: PageProps<"/appointments">) {
  const { profile } = await requireSession();
  const sp = await searchParams;
  const page = pageParam(sp);
  const sort = param(sp, "sort") ?? "-scheduled_at";
  const from = param(sp, "from");
  const to = param(sp, "to");
  const [people, agents, products, rates] = await Promise.all([getPeople(), getAgents(), getActiveProducts(), getVisibleCommissionRates()]);
  const { rows, total } = await listAppointments({
    q: param(sp, "q"),
    status: param(sp, "status"),
    result: param(sp, "result"),
    agent: isUuid(param(sp, "agent")) ? param(sp, "agent") : undefined,
    callerScope: profile.role === "caller" ? profile.id : undefined,
    from: from ? dayBoundsIso(from).start : undefined,
    to: to ? dayBoundsIso(addDays(to, 1)).start : undefined,
    sort,
    page,
    pageSize: PAGE_SIZE,
  });
  const cards = new Map(rows.map((a) => [a.id, toPipelineCard(a, people, profile)]));
  const filters: FilterDef[] = [
    { key: "q", label: "Iskanje", type: "search", placeholder: "Ime, telefon…" },
    {
      key: "status",
      label: "Status",
      type: "select",
      options: [
        { value: "", label: "Vsi" },
        { value: "upcoming", label: "Prihajajoči" },
        { value: "pending", label: "Čaka na rezultat" },
        { value: "completed", label: "Opravljeni" },
        { value: "cancelled", label: "Preklicani" },
      ],
    },
    { key: "result", label: "Rezultat", type: "select", options: [{ value: "", label: "Vsi" }, ...(["A1", "A", "B", "A0"] as const).map((r) => ({ value: r, label: `${r} – ${RESULT_LABELS[r].label}` }))] },
    { key: "agent", label: "Zastopnik", type: "select", options: [{ value: "", label: "Vsi" }, ...toOptions(agents).map((a) => ({ value: a.id, label: a.name }))] },
    { key: "from", label: "Od", type: "date" },
    { key: "to", label: "Do", type: "date" },
  ];

  return (
    <>
      <PageHeader
        title={profile.role === "caller" ? "Moji termini" : "Termini"}
        description={profile.role === "caller" ? "Termini, ki ste jih dogovorili, in njihovi rezultati" : undefined}
        actions={
          <Link href="/appointments/new" className={buttonClasses("gold")}>
            Nov termin
          </Link>
        }
      />
      <FilterBar className="mb-4" filters={filters} />
      <Card>
        <AppointmentsTable
          rows={rows}
          people={people}
          cards={cards}
          sort={sort}
          sortHref={(s) => hrefWith("/appointments", sp, { sort: s, page: undefined })}
          showCaller={profile.role !== "caller"}
          actionsProps={{ agents: toOptions(agents), products, rates }}
        />
        <div className="border-t border-line">
          <Pagination page={page} pageSize={PAGE_SIZE} total={total} hrefFor={(p) => hrefWith("/appointments", sp, { page: p })} />
        </div>
      </Card>
    </>
  );
}
