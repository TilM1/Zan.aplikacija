import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { ROLE_LABELS } from "@/lib/labels";
import { formatEur, sumDecimals } from "@/lib/money";
import { formatDate, formatDateTime, todayIso } from "@/lib/dates";
import { isUuid } from "@/lib/url";
import { lastMonths } from "@/lib/periods";
import { createClient } from "@/lib/supabase/server";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader, Stat } from "@/components/ui/misc";
import { Table, TD, TH, THead, TR } from "@/components/ui/table";
import { EditEmployeeForm, EmailForm, PasswordReset, RateForm } from "@/components/employees/employee-forms";
import { AggTable, monthRows } from "@/components/dashboard/report-tables";
import { summarize } from "@/components/payroll/summaries";
import { getPeople, nameOf } from "@/server/queries/people";
import { currentMonthRange, policyProduction, resultBreakdown } from "@/server/queries/metrics";
import { getInstallmentsForSummary } from "@/server/queries/payroll";
import { buttonClasses } from "@/components/ui/button";

export const metadata: Metadata = { title: "Zaposleni" };

export default async function EmployeePage({ params }: PageProps<"/employees/[id]">) {
  const { profile: me } = await requireSession(["owner"]);
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const people = await getPeople();
  const emp = people.get(id);
  if (!emp) notFound();

  const isCaller = emp.role === "caller";
  const scope = isCaller ? { callerId: id } : { agentId: id };
  const m = currentMonthRange();
  const trend = lastMonths(12);
  const today = todayIso();
  const supabase = await createClient();
  const [rates, prodMonth, prodTrend, results, installments, upcoming] = await Promise.all([
    isCaller
      ? supabase.from("caller_commission_rates").select("id, value:multiplier, effective_from, set_by").eq("caller_id", id).order("effective_from", { ascending: false }).order("created_at", { ascending: false })
      : supabase.from("agent_commission_rates").select("id, value:rate_percent, effective_from, set_by").eq("agent_id", id).order("effective_from", { ascending: false }).order("created_at", { ascending: false }),
    policyProduction(m.from, m.to, scope),
    policyProduction(trend.from, trend.to, scope),
    resultBreakdown(m.from, m.toExclusive, scope),
    getInstallmentsForSummary({ beneficiary: id }),
    supabase
      .from("appointments")
      .select("id, scheduled_at, customer:customers(id, first_name, last_name)")
      .eq(isCaller ? "caller_id" : "agent_id", id)
      .eq("status", "scheduled")
      .order("scheduled_at")
      .limit(10),
  ]);
  const rateRows = (rates.data ?? []) as { id: string; value: number; effective_from: string; set_by: string | null }[];
  const fmtRate = (v: number) => (isCaller ? `× ${Number(v).toLocaleString("sl-SI")}` : `${Number(v).toLocaleString("sl-SI")} %`);
  const s = summarize(installments, today);
  const paidTotal = sumDecimals(installments.filter((i) => i.status === "paid").map((i) => i.amount));
  const upcomingRows = (upcoming.data ?? []) as unknown as { id: string; scheduled_at: string; customer: { id: string; first_name: string; last_name: string } }[];

  return (
    <>
      <PageHeader
        title={`${emp.first_name} ${emp.last_name}`}
        description={`${ROLE_LABELS[emp.role]} · ${emp.email}`}
        actions={
          <>
            {emp.is_active ? <Badge tone="success">Aktiven</Badge> : <Badge>Neaktiven</Badge>}
            <Link href={`/payroll?status=all&beneficiary=${id}`} className={buttonClasses("secondary")}>
              Izplačila
            </Link>
          </>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-5">
        <Stat label="Svetovanja (ta mesec)" value={results.total} />
        <Stat label="Police (ta mesec)" value={prodMonth.count} />
        <Stat label="Premija (ta mesec)" value={formatEur(prodMonth.premiumCents)} />
        <Stat label="Neizplačane provizije" value={formatEur(s.unpaidCents)} hint={s.dueCents ? `zapadlo ${formatEur(s.dueCents)}` : undefined} />
        <Stat label="Izplačano skupaj" value={formatEur(paidTotal)} />
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="flex flex-col gap-4 xl:col-span-2">
          <Card>
            <CardHeader title="Podatki in dostop" />
            <CardBody>
              <EditEmployeeForm employee={emp} isSelf={emp.id === me.id} />
            </CardBody>
          </Card>
          <AggTable title="Produkcija – zadnjih 12 mesecev" keyLabel="Mesec" rows={monthRows(prodTrend.byMonth)} />
        </div>
        <div className="flex flex-col gap-4">
          <Card id="provizija">
            <CardHeader
              title={isCaller ? "Provizija klicatelja" : "Odstotek provizije"}
              description={isCaller ? "Enkratno na polico: mesečna premija × faktor" : "Premija × 12 × leta × odstotek, izplačilo 55 / 20 / 25 %"}
            />
            <CardBody className="flex flex-col gap-4">
              <RateForm employeeId={id} kind={isCaller ? "caller" : "agent"} current={rateRows[0] ? String(Number(rateRows[0].value)) : null} />
              {rateRows.length > 0 && (
                <Table>
                  <THead>
                    <tr>
                      <TH>Velja od</TH>
                      <TH className="text-right">{isCaller ? "Faktor" : "Odstotek"}</TH>
                      <TH>Nastavil</TH>
                    </tr>
                  </THead>
                  <tbody>
                    {rateRows.map((r, i) => (
                      <TR key={r.id}>
                        <TD className="tabular">
                          {formatDateTime(r.effective_from)} {i === 0 && <Badge tone="success">trenutno</Badge>}
                        </TD>
                        <TD className="text-right tabular">{fmtRate(r.value)}</TD>
                        <TD className="text-ink-2">{r.set_by ? nameOf(people, r.set_by) : "sistem"}</TD>
                      </TR>
                    ))}
                  </tbody>
                </Table>
              )}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Odprti termini" />
            {upcomingRows.length === 0 ? (
              <p className="px-4 py-4 text-sm text-ink-3">Ni odprtih terminov.</p>
            ) : (
              <ul className="divide-y divide-line">
                {upcomingRows.map((a) => (
                  <li key={a.id} className="flex justify-between gap-2 px-4 py-2 text-sm">
                    <Link href={`/customers/${a.customer.id}`} className="truncate hover:text-brand">
                      {a.customer.first_name} {a.customer.last_name}
                    </Link>
                    <span className="text-ink-3 tabular">{formatDate(a.scheduled_at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <CardHeader title="Prijava" description="E-pošta za prijavo in začasno geslo" />
            <CardBody className="flex flex-col gap-5">
              <EmailForm userId={id} current={emp.email} />
              {emp.id !== me.id ? (
                <PasswordReset userId={id} />
              ) : (
                <p className="text-xs text-ink-3">Svoje geslo spremenite v Profilu.</p>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
