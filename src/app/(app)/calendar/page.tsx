import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { addDays, dayBoundsIso, formatDate, isValidIsoDate, todayIso, weekStart } from "@/lib/dates";
import { hrefWith, param } from "@/lib/url";
import { PageHeader } from "@/components/ui/misc";
import { buttonClasses } from "@/components/ui/button";
import { FilterBar } from "@/components/pipeline/filter-bar";
import { WeekView } from "@/components/calendar/week-view";
import { getAppointmentsInRange, resolveAgentScope } from "@/server/queries/appointments";
import { getAgents, getPeople, nameOf, toOptions } from "@/server/queries/people";

export const metadata: Metadata = { title: "Koledar" };

export default async function CalendarPage({ searchParams }: PageProps<"/calendar">) {
  const { profile } = await requireSession();
  const sp = await searchParams;
  const requested = param(sp, "week");
  const start = weekStart(requested && isValidIsoDate(requested) ? requested : todayIso());
  const end = addDays(start, 7);

  const scope = resolveAgentScope(profile, param(sp, "agent"));
  const agentId = profile.role === "caller" ? null : scope.kind === "me" ? profile.id : scope.kind === "agent" ? scope.id : null;
  const [rows, people, agents] = await Promise.all([
    getAppointmentsInRange(dayBoundsIso(start).start, dayBoundsIso(end).start, agentId),
    getPeople(),
    getAgents(),
  ]);
  // Callers: the appointments they booked
  const appointments = profile.role === "caller" ? rows.filter((a) => a.caller_id === profile.id || a.created_by === profile.id) : rows;

  return (
    <>
      <PageHeader
        title="Koledar"
        description={`Teden ${formatDate(start)} – ${formatDate(addDays(start, 6))} · ${appointments.length} terminov`}
        actions={
          <div className="flex items-center gap-1">
            <Link href={hrefWith("/calendar", sp, { week: addDays(start, -7) })} className={buttonClasses("secondary", "md", "px-2")} aria-label="Prejšnji teden">
              <ChevronLeft className="size-4" />
            </Link>
            <Link href={hrefWith("/calendar", sp, { week: undefined })} className={buttonClasses("secondary")}>
              Danes
            </Link>
            <Link href={hrefWith("/calendar", sp, { week: addDays(start, 7) })} className={buttonClasses("secondary", "md", "px-2")} aria-label="Naslednji teden">
              <ChevronRight className="size-4" />
            </Link>
          </div>
        }
      />
      {profile.role === "owner" && (
        <FilterBar
          className="mb-4"
          filters={[
            {
              key: "agent",
              label: "Zastopnik",
              type: "select",
              options: [{ value: "", label: "Moji termini" }, { value: "all", label: "Vsi zastopniki" }, ...toOptions(agents).filter((a) => a.id !== profile.id).map((a) => ({ value: a.id, label: a.name }))],
            },
          ]}
        />
      )}
      <WeekView weekStart={start} appointments={appointments} agentName={(id) => nameOf(people, id)} showAgent={profile.role !== "agent" && !(profile.role === "owner" && scope.kind === "me")} />
      <p className="mt-3 text-xs text-ink-3">
        Časi so prikazani v časovnem pasu Europe/Ljubljana. Sinhronizacija z Outlook koledarjem je pripravljena v podatkovnem modelu (external_event_id, sync_status).
      </p>
    </>
  );
}
