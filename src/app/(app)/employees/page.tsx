import type { Metadata } from "next";
import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { ROLE_LABELS } from "@/lib/labels";
import { formatEur } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/misc";
import { Table, TD, TH, THead, TR } from "@/components/ui/table";
import { CreateEmployeeButton } from "@/components/employees/employee-forms";
import { getPeople, getVisibleAgentRates } from "@/server/queries/people";
import { currentMonthRange, policyProduction } from "@/server/queries/metrics";

export const metadata: Metadata = { title: "Zaposleni" };

export default async function EmployeesPage() {
  await requireSession(["owner"]);
  const m = currentMonthRange();
  const [people, rates, prod] = await Promise.all([getPeople(), getVisibleAgentRates(), policyProduction(m.from, m.to)]);
  const list = [...people.values()].sort((a, b) => Number(b.is_active) - Number(a.is_active) || a.role.localeCompare(b.role) || a.first_name.localeCompare(b.first_name));

  return (
    <>
      <PageHeader title="Zaposleni" description="Računi, vloge, odstotki provizij in dostop" actions={<CreateEmployeeButton />} />
      <Card>
        <Table>
          <THead>
            <tr>
              <TH>Ime</TH>
              <TH>Vloga</TH>
              <TH>E-pošta</TH>
              <TH>Telefon</TH>
              <TH className="text-right">Provizija</TH>
              <TH className="text-right">Police (ta mesec)</TH>
              <TH className="text-right">Premija (ta mesec)</TH>
              <TH>Status</TH>
              <TH>Od</TH>
            </tr>
          </THead>
          <tbody>
            {list.map((p) => {
              const agg = p.role === "caller" ? prod.byCaller.get(p.id) : prod.byAgent.get(p.id);
              return (
                <TR key={p.id} className={p.is_active ? undefined : "opacity-60"}>
                  <TD>
                    <Link href={`/employees/${p.id}`} className="font-medium hover:text-brand hover:underline">
                      {p.first_name} {p.last_name}
                    </Link>
                    {p.is_demo && <span className="ml-1.5 text-[10px] font-semibold text-warning">DEMO</span>}
                  </TD>
                  <TD>
                    <Badge tone={p.role === "owner" ? "accent" : p.role === "agent" ? "info" : "neutral"}>{ROLE_LABELS[p.role]}</Badge>
                  </TD>
                  <TD className="text-ink-2">{p.email}</TD>
                  <TD className="text-ink-2">{p.phone ?? "–"}</TD>
                  <TD className="text-right tabular">{p.role === "caller" ? "× 1,5" : rates[p.id] ? `${Number(rates[p.id]).toLocaleString("sl-SI")} %` : <span className="text-warning">ni nastavljeno</span>}</TD>
                  <TD className="text-right tabular">{agg?.count ?? 0}</TD>
                  <TD className="text-right tabular">{formatEur(agg?.premiumCents ?? 0)}</TD>
                  <TD>{p.is_active ? <Badge tone="success">Aktiven</Badge> : <Badge>Neaktiven</Badge>}</TD>
                  <TD className="text-ink-3 tabular">{formatDate(p.created_at)}</TD>
                </TR>
              );
            })}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
