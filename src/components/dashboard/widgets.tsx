import Link from "next/link";
import { ArrowRight, PhoneCall } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState, Stat } from "@/components/ui/misc";
import { Table, TD, TH, THead, TR } from "@/components/ui/table";
import { ResultBadge } from "@/components/ui/status";
import { addDays, dayBoundsIso, formatDate, formatDateTime, formatMonth, formatTime, todayIso } from "@/lib/dates";
import { formatEur, sumDecimals } from "@/lib/money";
import { ACTIVITY_LABELS, RESULT_LABELS } from "@/lib/labels";
import { nameOf, getPeople } from "@/server/queries/people";
import { getAppointmentsInRange } from "@/server/queries/appointments";
import {
  appointmentsBooked, countAppointmentsOnDay, countPendingResults, currentMonthRange, openFollowupCount,
  policyProduction, recentActivity, resultBreakdown, type MetricScope,
} from "@/server/queries/metrics";
import { getInstallmentsForSummary } from "@/server/queries/payroll";
import { createClient } from "@/lib/supabase/server";
import type { ConsultationResult, Profile } from "@/types/domain";
import { cn } from "@/lib/utils";

export interface WidgetContext {
  profile: Profile;
  /** Data scope for this dashboard (owner: whole business). */
  scope: MetricScope;
  today: string;
}

const month = () => currentMonthRange();

// ---------------------------------------------------------------------------
export async function KpisWidget({ ctx }: { ctx: WidgetContext }) {
  const m = month();
  const isCaller = ctx.profile.role === "caller";
  const [today, pending, prod, followups, booked] = await Promise.all([
    countAppointmentsOnDay(ctx.today, ctx.scope),
    isCaller ? Promise.resolve(0) : countPendingResults(ctx.scope),
    policyProduction(m.from, m.to, ctx.scope),
    isCaller || ctx.profile.role === "owner" ? openFollowupCount(isCaller ? ctx.profile.id : undefined) : Promise.resolve(0),
    isCaller ? appointmentsBooked(m.from, m.toExclusive, ctx.scope) : Promise.resolve(null),
  ]);
  return (
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      <Stat label="Termini danes" value={today} href={isCaller ? "/appointments" : "/calendar"} />
      {isCaller ? (
        <Stat label="Dogovorjeni termini ta mesec" value={booked?.total ?? 0} href="/appointments" />
      ) : (
        <Stat label="Čaka na rezultat" value={pending} tone={pending > 0 ? "warning" : "default"} href="/pipeline?view=table&status=pending" />
      )}
      <Stat label={`Police – ${formatMonth(m.from)}`} value={prod.count} tone="success" href={isCaller ? "/production" : "/policies"} />
      {isCaller || ctx.profile.role === "owner" ? (
        <Stat label="Odprti klici nazaj" value={followups} tone={followups > 0 ? "warning" : "default"} href="/follow-ups" />
      ) : (
        <Stat label="Mesečna premija (prodano)" value={formatEur(prod.premiumCents)} href="/production" />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
async function AppointmentList({ title, from, to, ctx, emptyText, href }: { title: string; from: string; to: string; ctx: WidgetContext; emptyText: string; href: string }) {
  const [rows, people] = await Promise.all([getAppointmentsInRange(from, to, ctx.scope.agentId ?? null, 50), getPeople()]);
  const filtered = ctx.scope.callerId ? rows.filter((r) => r.caller_id === ctx.scope.callerId) : rows;
  return (
    <Card>
      <CardHeader title={title} actions={<Link href={href} className="text-xs font-medium text-brand hover:underline">Vse</Link>} />
      {filtered.length === 0 ? (
        <EmptyState title={emptyText} className="py-8" />
      ) : (
        <ul className="divide-y divide-line">
          {filtered.slice(0, 12).map((a) => (
            <li key={a.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
              <span className="w-24 shrink-0 text-ink-2 tabular">
                {from.slice(0, 10) === to.slice(0, 10) ? "" : `${formatDate(a.scheduled_at).slice(0, 6)} `}
                {formatTime(a.scheduled_at)}
              </span>
              <Link href={`/customers/${a.customer_id}`} className="min-w-0 flex-1 truncate font-medium hover:text-brand">
                {a.customer.first_name} {a.customer.last_name}
                <span className="ml-2 font-normal text-ink-3">{a.customer.city ?? a.postal_code}</span>
              </Link>
              <span className="hidden truncate text-xs text-ink-3 sm:block">{nameOf(people, a.agent_id)}</span>
              {a.status === "completed" ? <ResultBadge result={a.result} withLabel={false} /> : null}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export async function TodayWidget({ ctx }: { ctx: WidgetContext }) {
  const { start, end } = dayBoundsIso(ctx.today);
  return <AppointmentList title="Termini danes" from={start} to={end} ctx={ctx} emptyText="Danes ni terminov." href="/calendar" />;
}

export async function UpcomingWidget({ ctx }: { ctx: WidgetContext }) {
  const start = dayBoundsIso(addDays(ctx.today, 1)).start;
  const end = dayBoundsIso(addDays(ctx.today, 8)).start;
  return <AppointmentList title="Prihajajočih 7 dni" from={start} to={end} ctx={ctx} emptyText="Ni prihajajočih terminov." href={ctx.profile.role === "caller" ? "/appointments" : "/calendar"} />;
}

// ---------------------------------------------------------------------------
export async function ResultsWidget({ ctx }: { ctx: WidgetContext }) {
  const m = month();
  const { counts, total } = await resultBreakdown(m.from, m.toExclusive, ctx.scope);
  const order: ConsultationResult[] = ["A1", "A", "B", "A0"];
  const colors: Record<ConsultationResult, string> = { A1: "bg-success", A: "bg-info", B: "bg-warning", A0: "bg-danger" };
  return (
    <Card>
      <CardHeader title="Rezultati svetovanj" description={formatMonth(m.from)} />
      <CardBody>
        {total === 0 ? (
          <p className="text-sm text-ink-3">Ta mesec še ni zaključenih svetovanj.</p>
        ) : (
          <>
            <div className="flex h-2.5 overflow-hidden rounded-full bg-subtle">
              {order.map((r) => (counts[r] ? <div key={r} className={colors[r]} style={{ width: `${(counts[r] / total) * 100}%` }} /> : null))}
            </div>
            <ul className="mt-3 flex flex-col gap-1.5 text-sm">
              {order.map((r) => (
                <li key={r} className="flex items-center gap-2">
                  <span className={cn("size-2 rounded-full", colors[r])} />
                  <span className="flex-1 text-ink-2">
                    <b className="text-ink">{r}</b> · {RESULT_LABELS[r].label}
                  </span>
                  <span className="font-medium tabular">{counts[r]}</span>
                  <span className="w-10 text-right text-xs text-ink-3 tabular">{Math.round((counts[r] / total) * 100)}%</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 border-t border-line pt-2 text-xs text-ink-3">
              Skupaj {total} svetovanj · uspešnost {Math.round((counts.A1 / total) * 100)}%
            </p>
          </>
        )}
      </CardBody>
    </Card>
  );
}

// ---------------------------------------------------------------------------
async function ProductionTable({ by }: { by: "agent" | "caller" }) {
  const m = month();
  const [prod, people, booked] = await Promise.all([
    policyProduction(m.from, m.to),
    getPeople(),
    by === "caller" ? appointmentsBooked(m.from, m.toExclusive) : Promise.resolve(null),
  ]);
  const map = by === "agent" ? prod.byAgent : prod.byCaller;
  const ids = new Set([...map.keys(), ...(booked ? booked.byCaller.keys() : [])]);
  const rows = [...ids].map((id) => ({ id, name: nameOf(people, id), ...(map.get(id) ?? { count: 0, premiumCents: 0 }), booked: booked?.byCaller.get(id) ?? 0 }));
  rows.sort((a, b) => b.premiumCents - a.premiumCents || b.booked - a.booked);
  return (
    <Card>
      <CardHeader title={by === "agent" ? "Produkcija po zastopnikih" : "Produkcija po klicateljih"} description={formatMonth(m.from)} actions={<Link href="/reports" className="text-xs font-medium text-brand hover:underline">Poročila</Link>} />
      {rows.length === 0 ? (
        <EmptyState title="Ta mesec še ni podatkov." className="py-8" />
      ) : (
        <Table>
          <THead>
            <tr>
              <TH>{by === "agent" ? "Zastopnik" : "Klicatelj"}</TH>
              {by === "caller" && <TH className="text-right">Termini</TH>}
              <TH className="text-right">Police</TH>
              <TH className="text-right">Mesečna premija</TH>
            </tr>
          </THead>
          <tbody>
            {rows.map((r) => (
              <TR key={r.id}>
                <TD>
                  <Link href={`/employees/${r.id}`} className="hover:text-brand">
                    {r.name}
                  </Link>
                </TD>
                {by === "caller" && <TD className="text-right tabular">{r.booked}</TD>}
                <TD className="text-right tabular">{r.count}</TD>
                <TD className="text-right font-medium tabular">{formatEur(r.premiumCents)}</TD>
              </TR>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

export const ProductionByAgentWidget = () => <ProductionTable by="agent" />;
export const ProductionByCallerWidget = () => <ProductionTable by="caller" />;

// ---------------------------------------------------------------------------
export async function UpcomingPayoutsWidget({ ctx }: { ctx: WidgetContext }) {
  const isOwner = ctx.profile.role === "owner";
  const rows = await getInstallmentsForSummary({
    beneficiary: isOwner ? undefined : ctx.profile.id,
    statuses: ["scheduled"],
    toDue: addDays(ctx.today, 120),
  });
  const byDate = new Map<string, number>();
  for (const r of rows) byDate.set(r.due_date, (byDate.get(r.due_date) ?? 0) + sumDecimals([r.amount]));
  const dates = [...byDate.keys()].sort().slice(0, 5);
  return (
    <Card>
      <CardHeader title={isOwner ? "Prihajajoča izplačila" : "Moja prihajajoča izplačila"} actions={<Link href={isOwner ? "/payroll" : "/earnings"} className="text-xs font-medium text-brand hover:underline">Podrobno</Link>} />
      {dates.length === 0 ? (
        <EmptyState title="Ni načrtovanih izplačil." className="py-8" />
      ) : (
        <ul className="divide-y divide-line">
          {dates.map((d) => (
            <li key={d} className="flex items-center justify-between px-4 py-2.5 text-sm">
              <span className={cn("tabular", d <= ctx.today && "font-medium text-warning")}>
                {formatDate(d)} {d <= ctx.today && "· zapadlo"}
              </span>
              <span className="font-medium tabular">{formatEur(byDate.get(d)!)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export async function ObligationsWidget() {
  const rows = await getInstallmentsForSummary({ statuses: ["scheduled"] });
  const today = todayIso();
  const total = sumDecimals(rows.map((r) => r.amount));
  const due = sumDecimals(rows.filter((r) => r.due_date <= today).map((r) => r.amount));
  const next12 = sumDecimals(rows.filter((r) => r.due_date <= addDays(today, 365)).map((r) => r.amount));
  return (
    <Card>
      <CardHeader title="Obveznosti za provizije" description="Vsa neizplačana načrtovana izplačila" />
      <CardBody className="grid grid-cols-1 gap-3">
        <div>
          <p className="text-xs text-ink-3">Skupaj prihodnje obveznosti</p>
          <p className="text-2xl font-semibold tabular">{formatEur(total)}</p>
        </div>
        <div className="grid grid-cols-2 gap-3 border-t border-line pt-3 text-sm">
          <div>
            <p className="text-xs text-ink-3">Zapadlo (neplačano)</p>
            <p className={cn("font-semibold tabular", due > 0 && "text-warning")}>{formatEur(due)}</p>
          </div>
          <div>
            <p className="text-xs text-ink-3">V naslednjih 12 mesecih</p>
            <p className="font-semibold tabular">{formatEur(next12)}</p>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}

// ---------------------------------------------------------------------------
export async function RecentActivityWidget() {
  const [rows, people] = await Promise.all([recentActivity(12), getPeople()]);
  return (
    <Card>
      <CardHeader title="Nedavna aktivnost" />
      {rows.length === 0 ? (
        <EmptyState title="Še ni aktivnosti." className="py-8" />
      ) : (
        <ul className="divide-y divide-line">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center gap-3 px-4 py-2 text-sm">
              <span className="w-28 shrink-0 text-xs text-ink-3 tabular">{formatDateTime(r.created_at)}</span>
              <span className="min-w-0 flex-1 truncate">
                <span className="font-medium">{ACTIVITY_LABELS[r.action] ?? r.action}</span>
                {r.customer && (
                  <Link href={`/customers/${r.customer.id}`} className="ml-2 text-ink-2 hover:text-brand">
                    {r.customer.first_name} {r.customer.last_name}
                  </Link>
                )}
              </span>
              <span className="hidden shrink-0 text-xs text-ink-3 sm:block">{nameOf(people, r.actor_id)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
export async function FollowupsWidget({ ctx }: { ctx: WidgetContext }) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("caller_followups")
    .select("id, created_at, note, customer:customers(id, first_name, last_name, phone)")
    .eq("status", "open")
    .eq("caller_id", ctx.profile.id)
    .order("created_at")
    .limit(8);
  const rows = (data ?? []) as unknown as { id: string; created_at: string; note: string | null; customer: { id: string; first_name: string; last_name: string; phone: string } }[];
  return (
    <Card>
      <CardHeader title="Klici nazaj" description="Stranke, ki jih ni bilo doma (B)" actions={<Link href="/follow-ups" className="flex items-center gap-1 text-xs font-medium text-brand hover:underline">Vsi <ArrowRight className="size-3" /></Link>} />
      {rows.length === 0 ? (
        <EmptyState icon={PhoneCall} title="Ni odprtih klicev nazaj." className="py-8" />
      ) : (
        <ul className="divide-y divide-line">
          {rows.map((f) => (
            <li key={f.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
              <Link href={`/customers/${f.customer.id}`} className="min-w-0 flex-1 truncate font-medium hover:text-brand">
                {f.customer.first_name} {f.customer.last_name}
              </Link>
              <a href={`tel:${f.customer.phone}`} className="text-ink-2 tabular hover:text-brand">
                {f.customer.phone}
              </a>
              <span className="hidden text-xs text-ink-3 sm:block">{formatDate(f.created_at)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
