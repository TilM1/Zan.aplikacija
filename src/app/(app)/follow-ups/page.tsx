import type { Metadata } from "next";
import Link from "next/link";
import { PhoneCall } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { daysBetween, formatDate, formatDateTime, localParts, todayIso } from "@/lib/dates";
import { hrefWith, isUuid, pageParam, param } from "@/lib/url";
import { createClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui/card";
import { EmptyState, PageHeader, Pagination, Tabs } from "@/components/ui/misc";
import { Table, TD, TH, THead, TR } from "@/components/ui/table";
import { FollowupStatusBadge } from "@/components/ui/status";
import { FilterBar } from "@/components/pipeline/filter-bar";
import { FollowupActions } from "@/components/customers/followup-actions";
import { getAgents, getCallers, getPeople, nameOf, toOptions } from "@/server/queries/people";

export const metadata: Metadata = { title: "Klici nazaj" };
const PAGE_SIZE = 50;

type Row = {
  id: string;
  status: "open" | "rescheduled" | "closed";
  caller_id: string | null;
  note: string | null;
  created_at: string;
  resolved_at: string | null;
  customer: { id: string; first_name: string; last_name: string; phone: string; city: string | null; postal_code: string };
  source: { id: string; agent_id: string; scheduled_at: string; visit_number: number; result_note: string | null };
};

export default async function FollowupsPage({ searchParams }: PageProps<"/follow-ups">) {
  const { profile } = await requireSession(["caller", "owner"]);
  const sp = await searchParams;
  const tab = param(sp, "tab") === "done" ? "done" : "open";
  const page = pageParam(sp);
  const supabase = await createClient();
  const today = todayIso();

  let q = supabase
    .from("caller_followups")
    .select(
      "id, status, caller_id, note, created_at, resolved_at, customer:customers!inner(id, first_name, last_name, phone, city, postal_code), source:appointments!caller_followups_source_appointment_id_fkey(id, agent_id, scheduled_at, visit_number, result_note)",
      { count: "exact" },
    );
  q = tab === "open" ? q.eq("status", "open").order("created_at") : q.neq("status", "open").order("resolved_at", { ascending: false });
  if (profile.role === "caller") q = q.eq("caller_id", profile.id);
  else if (isUuid(param(sp, "caller"))) q = q.eq("caller_id", param(sp, "caller")!);
  const { data, count } = await q.range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  const rows = (data ?? []) as unknown as Row[];

  const [people, agents, callers] = await Promise.all([getPeople(), getAgents(), getCallers()]);
  const agentOptions = toOptions(agents);

  return (
    <>
      <PageHeader title="Klici nazaj" description="Stranke, ki jih ob terminu ni bilo doma (B). Pokličite jih in dogovorite nov termin." />
      {profile.role === "owner" && (
        <FilterBar className="mb-3" filters={[{ key: "caller", label: "Klicatelj", type: "select", options: [{ value: "", label: "Vsi" }, ...toOptions(callers).map((c) => ({ value: c.id, label: c.name }))] }]} />
      )}
      <Tabs
        active={tab}
        tabs={[
          { key: "open", label: "Za klic", href: hrefWith("/follow-ups", sp, { tab: undefined, page: undefined }) },
          { key: "done", label: "Zaključeni", href: hrefWith("/follow-ups", sp, { tab: "done", page: undefined }) },
        ]}
      />
      <Card>
        {rows.length === 0 ? (
          <EmptyState icon={PhoneCall} title={tab === "open" ? "Ni odprtih klicev nazaj" : "Ni zaključenih klicev nazaj"} />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Stranka</TH>
                <TH>Telefon</TH>
                <TH>Kraj</TH>
                <TH>Neuspešen obisk</TH>
                <TH>Zastopnik</TH>
                {profile.role === "owner" && <TH>Klicatelj</TH>}
                <TH>Opomba zastopnika</TH>
                {tab === "open" ? <TH>Čaka</TH> : <TH>Status</TH>}
                {tab === "open" && <TH className="text-right">Dejanja</TH>}
              </tr>
            </THead>
            <tbody>
              {rows.map((f) => {
                const days = daysBetween(localParts(f.created_at).date, today);
                return (
                  <TR key={f.id}>
                    <TD>
                      <Link href={`/customers/${f.customer.id}`} className="font-medium hover:text-brand hover:underline">
                        {f.customer.first_name} {f.customer.last_name}
                      </Link>
                    </TD>
                    <TD className="whitespace-nowrap">
                      <a href={`tel:${f.customer.phone}`} className="font-medium text-brand hover:underline">
                        {f.customer.phone}
                      </a>
                    </TD>
                    <TD className="whitespace-nowrap text-ink-2">
                      {f.customer.postal_code} {f.customer.city}
                    </TD>
                    <TD className="whitespace-nowrap tabular">
                      {formatDateTime(f.source.scheduled_at)} <span className="text-ink-3">({f.source.visit_number}. obisk)</span>
                    </TD>
                    <TD className="whitespace-nowrap">{nameOf(people, f.source.agent_id)}</TD>
                    {profile.role === "owner" && <TD className="whitespace-nowrap">{f.caller_id ? nameOf(people, f.caller_id) : <span className="text-warning">Brez klicatelja</span>}</TD>}
                    <TD className="max-w-64 truncate text-ink-2">{f.source.result_note ?? f.note ?? "–"}</TD>
                    {tab === "open" ? (
                      <TD className={days >= 3 ? "font-medium text-warning" : "text-ink-2"}>{days === 0 ? "danes" : `${days} dni`}</TD>
                    ) : (
                      <TD>
                        <FollowupStatusBadge status={f.status} /> <span className="ml-1 text-xs text-ink-3">{formatDate(f.resolved_at)}</span>
                      </TD>
                    )}
                    {tab === "open" && (
                      <TD>
                        <FollowupActions
                          followupId={f.id}
                          customerId={f.customer.id}
                          customerName={`${f.customer.first_name} ${f.customer.last_name}`}
                          previousAgentId={f.source.agent_id}
                          agents={agentOptions}
                        />
                      </TD>
                    )}
                  </TR>
                );
              })}
            </tbody>
          </Table>
        )}
        <div className="border-t border-line">
          <Pagination page={page} pageSize={PAGE_SIZE} total={count ?? 0} hrefFor={(p) => hrefWith("/follow-ups", sp, { page: p })} />
        </div>
      </Card>
    </>
  );
}
