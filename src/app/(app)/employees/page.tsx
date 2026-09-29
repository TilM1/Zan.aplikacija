import type { Metadata } from "next";
import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { ROLE_LABELS } from "@/lib/labels";
import { formatEur } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/misc";
import { SortTH, Table, TD, TH, THead, TR } from "@/components/ui/table";
import { hrefWith, param, parseSort } from "@/lib/url";
import { CreateEmployeeButton } from "@/components/employees/employee-forms";
import { getPeople, getVisibleCommissionRates } from "@/server/queries/people";
import { currentMonthRange, policyProduction } from "@/server/queries/metrics";

export const metadata: Metadata = { title: "Zaposleni" };

export default async function EmployeesPage({ searchParams }: PageProps<"/employees">) {
  await requireSession(["owner"]);
  const sp = await searchParams;
  const m = currentMonthRange();
  const [people, rates, prod] = await Promise.all([getPeople(), getVisibleCommissionRates(), policyProduction(m.from, m.to)]);
  const s = parseSort(param(sp, "sort"), ["name", "role", "email", "rate", "count", "premium", "status", "created_at"] as const, "status");
  const sortProps = { sort: s.sort, hrefFor: (x: string) => hrefWith("/employees", sp, { sort: x }) };
  const aggOf = (id: string, role: string) => (role === "caller" ? prod.byCaller.get(id) : prod.byAgent.get(id));
  const rateOf = (id: string, role: string) => Number((role === "caller" ? rates.callers[id] : rates.agents[id]) ?? -1);
  const keyOf = (p: (typeof all)[number]): string | number => {
    switch (s.column) {
      case "name": return `${p.last_name} ${p.first_name}`.toLowerCase();
      case "role": return p.role;
      case "email": return p.email;
      case "rate": return rateOf(p.id, p.role);
      case "count": return aggOf(p.id, p.role)?.count ?? 0;
      case "premium": return aggOf(p.id, p.role)?.premiumCents ?? 0;
      case "created_at": return p.created_at;
      default: return p.is_active ? 0 : 1;
    }
  };
  const all = [...people.values()];
  const list = all.sort((a, b) => {
    const ka = keyOf(a), kb = keyOf(b);
    const cmp = typeof ka === "number" && typeof kb === "number" ? ka - kb : String(ka).localeCompare(String(kb), "sl");
    return (s.ascending ? cmp : -cmp) || a.first_name.localeCompare(b.first_name, "sl");
  });

  return (
    <>
      <PageHeader title="Zaposleni" description="Računi, vloge in dostop. Provizijo spremenite s klikom na vrednost v stolpcu »Provizija«." actions={<CreateEmployeeButton />} />
      <Card>
        <Table>
          <THead>
            <tr>
              <SortTH label="Ime" column="name" {...sortProps} />
              <SortTH label="Vloga" column="role" {...sortProps} />
              <SortTH label="E-pošta" column="email" {...sortProps} />
              <TH>Telefon</TH>
              <SortTH label="Provizija" column="rate" firstDesc className="text-right" {...sortProps} />
              <SortTH label="Police (ta mesec)" column="count" firstDesc className="text-right" {...sortProps} />
              <SortTH label="Premija (ta mesec)" column="premium" firstDesc className="text-right" {...sortProps} />
              <SortTH label="Status" column="status" {...sortProps} />
              <SortTH label="Od" column="created_at" {...sortProps} />
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
                  <TD className="text-right tabular">
                    <Link href={`/employees/${p.id}#provizija`} className="hover:text-brand hover:underline" title="Spremeni provizijo">
                      {p.role === "caller"
                        ? rates.callers[p.id] ? `× ${Number(rates.callers[p.id]).toLocaleString("sl-SI")}` : <span className="text-warning">ni nastavljeno</span>
                        : rates.agents[p.id] ? `${Number(rates.agents[p.id]).toLocaleString("sl-SI")} %` : <span className="text-warning">ni nastavljeno</span>}
                    </Link>
                  </TD>
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
