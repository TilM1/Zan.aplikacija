import type { Metadata } from "next";
import { requireSession } from "@/lib/auth";
import { hrefWith, isUuid, pageParam, param } from "@/lib/url";
import { dayBoundsIso, addDays } from "@/lib/dates";
import { RESULT_LABELS } from "@/lib/labels";
import { PageHeader, Pagination } from "@/components/ui/misc";
import { Card } from "@/components/ui/card";
import { buttonClasses } from "@/components/ui/button";
import { KanbanBoard } from "@/components/pipeline/kanban";
import { FilterBar, type FilterDef } from "@/components/pipeline/filter-bar";
import { ViewSwitch } from "@/components/pipeline/view-switch";
import { AppointmentsTable } from "@/components/appointments/appointments-table";
import { toPipelineCard } from "@/components/pipeline/to-card";
import { getPipeline, listAppointments, resolveAgentScope } from "@/server/queries/appointments";
import { getAgents, getCallers, getPeople, getVisibleCommissionRates, toOptions } from "@/server/queries/people";
import { getActiveProducts } from "@/server/queries/policies";
import Link from "next/link";

export const metadata: Metadata = { title: "Pipeline" };

const PAGE_SIZE = 50;

export default async function PipelinePage({ searchParams }: PageProps<"/pipeline">) {
  const { profile } = await requireSession(["owner", "agent"]);
  const sp = await searchParams;
  const view = param(sp, "view") === "table" ? "table" : "kanban";
  const isOwner = profile.role === "owner";

  const [people, agents, callers, products, rates] = await Promise.all([getPeople(), getAgents(), getCallers(), getActiveProducts(), getVisibleCommissionRates()]);
  const agentOptions = toOptions(agents);
  const actionsProps = { agents: agentOptions, products, rates };

  const agentFilterOptions = [
    { value: "", label: "Moji termini" },
    { value: "all", label: "Vsi zastopniki" },
    ...agentOptions.filter((a) => a.id !== profile.id).map((a) => ({ value: a.id, label: a.name })),
  ];

  const header = (
    <PageHeader
      title="Pipeline"
      description={view === "kanban" ? "Odprti termini in rezultati zadnjih 30 dni" : "Vsi termini s filtri in razvrščanjem"}
      actions={
        <>
          <ViewSwitch view={view} hrefFor={(v) => hrefWith("/pipeline", sp, { view: v === "kanban" ? undefined : v, page: undefined })} />
          {isOwner && (
            <Link href="/appointments/new" className={buttonClasses("gold", "md")}>
              Nov termin
            </Link>
          )}
        </>
      }
    />
  );

  if (view === "kanban") {
    const scope = resolveAgentScope(profile, param(sp, "agent"));
    const rows = await getPipeline(profile, scope);
    const cards = rows.map((a) => toPipelineCard(a, people, profile));
    return (
      <>
        {header}
        {isOwner && <FilterBar className="mb-4" filters={[{ key: "agent", label: "Zastopnik", type: "select", options: agentFilterOptions }]} />}
        <KanbanBoard cards={cards} agents={agentOptions} products={products} rates={rates} now={new Date().toISOString()} />
      </>
    );
  }

  // Table view
  const agentParam = param(sp, "agent");
  const agentScope = isOwner ? (agentParam === "all" ? null : isUuid(agentParam) ? agentParam : agentParam ? null : profile.id) : profile.id;
  const from = param(sp, "from");
  const to = param(sp, "to");
  const sort = param(sp, "sort") ?? "-scheduled_at";
  const page = pageParam(sp);
  const { rows, total } = await listAppointments({
    q: param(sp, "q"),
    status: param(sp, "status"),
    result: param(sp, "result"),
    caller: isUuid(param(sp, "caller")) ? param(sp, "caller") : undefined,
    agentScope,
    from: from ? dayBoundsIso(from).start : undefined,
    to: to ? dayBoundsIso(addDays(to, 1)).start : undefined,
    sort,
    page,
    pageSize: PAGE_SIZE,
  });
  const cards = new Map(rows.map((a) => [a.id, toPipelineCard(a, people, profile)]));

  const filters: FilterDef[] = [
    { key: "q", label: "Iskanje", type: "search", placeholder: "Ime, telefon, e-pošta…" },
    ...(isOwner ? [{ key: "agent", label: "Zastopnik", type: "select", options: agentFilterOptions } as FilterDef] : []),
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
    { key: "caller", label: "Klicatelj", type: "select", options: [{ value: "", label: "Vsi" }, ...toOptions(callers).map((c) => ({ value: c.id, label: c.name }))] },
    { key: "from", label: "Od", type: "date" },
    { key: "to", label: "Do", type: "date" },
  ];

  return (
    <>
      {header}
      <FilterBar className="mb-4" filters={filters} />
      <Card>
        <AppointmentsTable rows={rows} people={people} cards={cards} sort={sort} sortHref={(s) => hrefWith("/pipeline", sp, { sort: s, page: undefined })} actionsProps={actionsProps} />
        <div className="border-t border-line">
          <Pagination page={page} pageSize={PAGE_SIZE} total={total} hrefFor={(p) => hrefWith("/pipeline", sp, { page: p })} />
        </div>
      </Card>
    </>
  );
}
