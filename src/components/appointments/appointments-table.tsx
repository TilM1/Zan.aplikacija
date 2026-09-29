import Link from "next/link";
import { Repeat } from "lucide-react";
import { SortTH, Table, TD, TH, THead, TR } from "@/components/ui/table";
import { AppointmentStatusBadge, ResultBadge } from "@/components/ui/status";
import { EmptyState } from "@/components/ui/misc";
import { formatDate, formatTime } from "@/lib/dates";
import { nameOf } from "@/server/queries/people";
import type { AppointmentWithRelations, Profile } from "@/types/domain";
import { AppointmentRowActions } from "./row-actions";
import type { PipelineCard } from "@/components/pipeline/types";

export function AppointmentsTable({
  rows,
  people,
  cards,
  sortHref,
  sort,
  showAgent = true,
  showCaller = true,
  actionsProps,
}: {
  rows: AppointmentWithRelations[];
  people: Map<string, Profile>;
  cards: Map<string, PipelineCard>;
  sortHref: (sort: string) => string;
  sort: string;
  showAgent?: boolean;
  showCaller?: boolean;
  actionsProps: Omit<React.ComponentProps<typeof AppointmentRowActions>, "card">;
}) {
  if (rows.length === 0) return <EmptyState title="Ni terminov" description="Ni terminov, ki ustrezajo filtrom." />;
  const sp = { sort, hrefFor: sortHref };
  return (
    <Table>
      <THead>
        <tr>
          <SortTH label="Termin" column="scheduled_at" firstDesc {...sp} />
          <TH>Stranka</TH>
          <TH>Telefon</TH>
          <SortTH label="Lokacija" column="location" {...sp} />
          {showAgent && <SortTH label="Zastopnik" column="agent_id" {...sp} />}
          {showCaller && <SortTH label="Klicatelj" column="caller_id" {...sp} />}
          <SortTH label="Obisk" column="visit_number" firstDesc {...sp} />
          <SortTH label="Status" column="status" {...sp} />
          <SortTH label="Rezultat" column="result" {...sp} />
          <TH className="text-right">Dejanja</TH>
        </tr>
      </THead>
      <tbody>
        {rows.map((a) => (
          <TR key={a.id}>
            <TD className="whitespace-nowrap tabular">
              {formatDate(a.scheduled_at)} <span className="text-ink-3">{formatTime(a.scheduled_at)}</span>
            </TD>
            <TD>
              <Link href={`/customers/${a.customer_id}`} className="font-medium hover:text-brand hover:underline">
                {a.customer.first_name} {a.customer.last_name}
              </Link>
            </TD>
            <TD className="whitespace-nowrap">
              <a href={`tel:${a.customer.phone}`} className="hover:text-brand">
                {a.customer.phone}
              </a>
            </TD>
            <TD className="max-w-56 truncate text-ink-2">
              {a.location}, {a.postal_code}
            </TD>
            {showAgent && <TD className="whitespace-nowrap">{nameOf(people, a.agent_id)}</TD>}
            {showCaller && <TD className="whitespace-nowrap text-ink-2">{a.caller_id ? nameOf(people, a.caller_id) : "–"}</TD>}
            <TD>
              {a.visit_number > 1 ? (
                <span className="inline-flex items-center gap-1 text-accent">
                  <Repeat className="size-3.5" /> {a.visit_number}.
                </span>
              ) : (
                <span className="text-ink-3">1.</span>
              )}
            </TD>
            <TD>
              <AppointmentStatusBadge status={a.status} result={null} />
            </TD>
            <TD>{a.result ? <ResultBadge result={a.result} /> : <span className="text-ink-3">–</span>}</TD>
            <TD className="text-right">
              <AppointmentRowActions card={cards.get(a.id)!} {...actionsProps} />
            </TD>
          </TR>
        ))}
      </tbody>
    </Table>
  );
}
