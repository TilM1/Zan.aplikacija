import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FileText, Mail, MapPin, Phone, Repeat } from "lucide-react";
import { requireSession, isAgentLike } from "@/lib/auth";
import { describeActivity } from "@/lib/activity";
import { formatDate, formatDateTime } from "@/lib/dates";
import { formatDecimalEur, sumDecimals, formatEur } from "@/lib/money";
import { hrefWith, isUuid, param } from "@/lib/url";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState, KeyValue, Tabs } from "@/components/ui/misc";
import { Table, TD, TH, THead, TR } from "@/components/ui/table";
import { AppointmentStatusBadge, CustomerStatusBadge, FollowupStatusBadge } from "@/components/ui/status";
import { Timeline } from "@/components/customers/timeline";
import { CustomerActions } from "@/components/customers/customer-actions";
import { getCustomerDetail } from "@/server/queries/customers";
import { getAgents, getPeople, getVisibleCommissionRates, nameOf, toOptions } from "@/server/queries/people";
import { getActiveProducts } from "@/server/queries/policies";

export const metadata: Metadata = { title: "Stranka" };

type Tab = "timeline" | "appointments" | "policies" | "documents" | "notes";

export default async function CustomerPage({ params, searchParams }: PageProps<"/customers/[id]">) {
  const { profile } = await requireSession();
  const { id } = await params;
  const sp = await searchParams;
  if (!isUuid(id)) notFound();

  const [detail, people, agents, products, rates] = await Promise.all([getCustomerDetail(id), getPeople(), getAgents(), getActiveProducts(), getVisibleCommissionRates()]);
  if (!detail) notFound();
  const { customer, appointments, policies, documents, activity, followups, commissions } = detail;

  const tab = (param(sp, "tab") as Tab) ?? "timeline";
  const who = (pid: string | null | undefined) => nameOf(people, pid);
  const openAppt = appointments.find((a) => a.status === "scheduled") ?? null;
  const isOwner = profile.role === "owner";
  const openFollowup = followups.find((f) => f.status === "open");
  const canSchedule = isOwner || isAgentLike(profile.role) || (profile.role === "caller" && (!openFollowup || openFollowup.caller_id === profile.id));
  const timeline = activity.map((row) => describeActivity(row, who));
  const notes = timeline.filter((e) => e.kind === "note");
  const monthlyTotal = sumDecimals(policies.filter((p) => p.status === "active").map((p) => p.monthly_premium));

  const tabs = [
    { key: "timeline", label: "Časovnica", count: timeline.length },
    { key: "appointments", label: "Termini in svetovanja", count: appointments.length },
    { key: "policies", label: "Police", count: policies.length },
    ...(profile.role !== "caller" ? [{ key: "documents", label: "Dokumenti", count: documents.length }] : []),
    { key: "notes", label: "Opombe", count: notes.length },
  ].map((t) => ({ ...t, href: hrefWith(`/customers/${id}`, sp, { tab: t.key === "timeline" ? undefined : t.key, created: undefined }) }));

  return (
    <>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">
              {customer.first_name} {customer.last_name}
            </h1>
            <CustomerStatusBadge status={customer.status} />
            {customer.consultation_count > 1 && (
              <Badge tone="accent">
                <Repeat className="size-3" /> {customer.consultation_count} svetovanj
              </Badge>
            )}
            {customer.archived_at && <Badge>Arhivirana</Badge>}
            {customer.is_demo && <Badge tone="warning">DEMO</Badge>}
          </div>
          <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-2">
            <a href={`tel:${customer.phone}`} className="flex items-center gap-1.5 hover:text-brand">
              <Phone className="size-3.5 text-ink-3" /> {customer.phone}
            </a>
            {customer.email && (
              <a href={`mailto:${customer.email}`} className="flex items-center gap-1.5 hover:text-brand">
                <Mail className="size-3.5 text-ink-3" /> {customer.email}
              </a>
            )}
            <span className="flex items-center gap-1.5">
              <MapPin className="size-3.5 text-ink-3" /> {customer.address}, {customer.postal_code} {customer.city}
            </span>
          </div>
        </div>
        <CustomerActions
          customer={customer}
          open={
            openAppt
              ? {
                  id: openAppt.id,
                  agentId: openAppt.agent_id,
                  scheduledAt: openAppt.scheduled_at,
                  durationMinutes: openAppt.duration_minutes,
                  note: openAppt.note,
                  callerId: openAppt.caller_id,
                  callerName: openAppt.caller_id ? who(openAppt.caller_id) : undefined,
                  canRecord: isOwner || openAppt.agent_id === profile.id,
                  canEdit: isOwner || openAppt.agent_id === profile.id || (profile.role === "caller" && (openAppt.caller_id === profile.id || openAppt.created_by === profile.id)),
                }
              : null
          }
          canSchedule={canSchedule}
          canUpload={isAgentLike(profile.role)}
          isOwner={isOwner}
          agents={toOptions(agents)}
          products={products}
          rates={rates}
          policies={policies.map((p) => ({ id: p.id, label: `${p.product_name}${p.policy_number ? ` (${p.policy_number})` : ""} – ${formatDate(p.policy_date)}` }))}
          defaultAgentId={appointments[0]?.agent_id ?? customer.current_agent_id}
        />
      </div>

      {openAppt && (
        <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-info/20 bg-info-soft px-4 py-2.5 text-sm text-info">
          <b>Odprt termin:</b> {formatDateTime(openAppt.scheduled_at)} · {who(openAppt.agent_id)} · {openAppt.visit_number}. obisk
          {openAppt.note && <span className="text-ink-2">„{openAppt.note}“</span>}
        </div>
      )}
      {openFollowup && (
        <div className="mb-4 rounded-lg border border-warning/25 bg-warning-soft px-4 py-2.5 text-sm text-warning">
          <b>Ponoven klic:</b> stranke ni bilo doma ({formatDate(openFollowup.created_at)}). Dodeljeno klicatelju {who(openFollowup.caller_id)}.
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="h-fit xl:order-2">
          <CardHeader title="Pregled" />
          <div className="p-4">
            <KeyValue
              className="sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2"
              items={[
                { label: "Odgovorni klicatelj", value: who(customer.responsible_caller_id) },
                { label: "Trenutni zastopnik", value: who(customer.current_agent_id) },
                { label: "Število svetovanj", value: customer.consultation_count },
                { label: "Število polic", value: customer.policy_count },
                { label: "Mesečna premija (aktivne)", value: formatEur(monthlyTotal) },
                { label: "Ustvarjena", value: `${formatDate(customer.created_at)} · ${who(customer.created_by)}` },
              ]}
            />
          </div>
        </Card>

        <div className="min-w-0 xl:order-1 xl:col-span-2">
          <Tabs tabs={tabs} active={tab} />
          <Card>
            {tab === "timeline" && <Timeline entries={timeline} />}
            {tab === "notes" && (notes.length ? <Timeline entries={notes} /> : <EmptyState title="Ni opomb" />)}

            {tab === "appointments" &&
              (appointments.length === 0 ? (
                <EmptyState title="Ni terminov" />
              ) : (
                <Table>
                  <THead>
                    <tr>
                      <TH>Obisk</TH>
                      <TH>Termin</TH>
                      <TH>Zastopnik</TH>
                      <TH>Klicatelj</TH>
                      <TH>Status / rezultat</TH>
                      <TH>Opomba</TH>
                    </tr>
                  </THead>
                  <tbody>
                    {appointments.map((a) => (
                      <TR key={a.id}>
                        <TD className="font-medium tabular">{a.visit_number}.</TD>
                        <TD className="whitespace-nowrap tabular">{formatDateTime(a.scheduled_at)}</TD>
                        <TD className="whitespace-nowrap">{who(a.agent_id)}</TD>
                        <TD className="whitespace-nowrap text-ink-2">{a.caller_id ? who(a.caller_id) : "–"}</TD>
                        <TD>
                          <AppointmentStatusBadge status={a.status} result={a.result} />
                        </TD>
                        <TD className="max-w-72 text-ink-2">{a.result_note ?? a.cancel_reason ?? a.note ?? "–"}</TD>
                      </TR>
                    ))}
                  </tbody>
                </Table>
              ))}

            {tab === "policies" &&
              (policies.length === 0 ? (
                <EmptyState title="Ni polic" />
              ) : (
                <Table>
                  <THead>
                    <tr>
                      <TH>Produkt</TH>
                      <TH>Št. police</TH>
                      <TH>Datum</TH>
                      <TH className="text-right">Mesečna premija</TH>
                      <TH className="text-right">Trajanje</TH>
                      <TH>Zastopnik</TH>
                      <TH>Klicatelj</TH>
                      {commissions.length > 0 && <TH className="text-right">Moja / vidna provizija</TH>}
                      <TH>Dokument</TH>
                    </tr>
                  </THead>
                  <tbody>
                    {policies.map((p) => {
                      const comm = commissions.filter((c) => c.policy_id === p.id);
                      const doc = documents.find((d) => d.policy_id === p.id);
                      return (
                        <TR key={p.id}>
                          <TD>
                            <Link href={`/policies/${p.id}`} className="font-medium hover:text-brand hover:underline">
                              {p.product_name}
                            </Link>
                          </TD>
                          <TD className="text-ink-2">{p.policy_number ?? "–"}</TD>
                          <TD className="tabular">{formatDate(p.policy_date)}</TD>
                          <TD className="text-right tabular">{formatDecimalEur(p.monthly_premium)}</TD>
                          <TD className="text-right tabular">{p.duration_years} let</TD>
                          <TD className="whitespace-nowrap">{who(p.agent_id)}</TD>
                          <TD className="whitespace-nowrap text-ink-2">{p.caller_id ? who(p.caller_id) : "–"}</TD>
                          {commissions.length > 0 && (
                            <TD className="text-right tabular">{comm.length ? formatEur(sumDecimals(comm.map((c) => c.total_amount))) : "–"}</TD>
                          )}
                          <TD>
                            {doc ? (
                              <a href={`/api/documents/${doc.id}`} target="_blank" className="inline-flex items-center gap-1 text-brand hover:underline">
                                <FileText className="size-3.5" /> PDF
                              </a>
                            ) : profile.role !== "caller" ? (
                              <Badge tone="warning">Manjka</Badge>
                            ) : (
                              "–"
                            )}
                          </TD>
                        </TR>
                      );
                    })}
                  </tbody>
                </Table>
              ))}

            {tab === "documents" &&
              (documents.length === 0 ? (
                <EmptyState icon={FileText} title="Ni dokumentov" description="Naložite podpisano polico prek gumba »Dokument«." />
              ) : (
                <ul className="divide-y divide-line">
                  {documents.map((d) => (
                    <li key={d.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                      <FileText className="size-4 text-ink-3" />
                      <a href={`/api/documents/${d.id}`} target="_blank" className="min-w-0 flex-1 truncate font-medium hover:text-brand hover:underline">
                        {d.file_name}
                      </a>
                      <span className="text-xs text-ink-3">{d.document_type === "signed_policy" ? "Podpisana polica" : "Dokument"}</span>
                      <span className="text-xs text-ink-3 tabular">
                        {formatDateTime(d.created_at)} · {who(d.uploaded_by)}
                      </span>
                    </li>
                  ))}
                </ul>
              ))}
          </Card>

          {followups.length > 0 && tab === "timeline" && (
            <Card className="mt-4">
              <CardHeader title="Klici nazaj" />
              <ul className="divide-y divide-line">
                {followups.map((f) => (
                  <li key={f.id} className="flex items-center gap-3 px-4 py-2 text-sm">
                    <FollowupStatusBadge status={f.status} />
                    <span className="flex-1 text-ink-2">
                      {formatDate(f.created_at)} · {who(f.caller_id)}
                    </span>
                    {f.resolved_at && <span className="text-xs text-ink-3">rešeno {formatDate(f.resolved_at)}</span>}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
