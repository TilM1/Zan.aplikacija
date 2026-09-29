import type { Metadata } from "next";
import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { formatDate } from "@/lib/dates";
import { formatDecimalEur, formatEur, sumDecimals } from "@/lib/money";
import { hrefWith, isUuid, pageParam, param } from "@/lib/url";
import { Card } from "@/components/ui/card";
import { EmptyState, PageHeader, Pagination } from "@/components/ui/misc";
import { SortTH, Table, TD, TH, THead, TR } from "@/components/ui/table";
import { FilterBar, type FilterDef } from "@/components/pipeline/filter-bar";
import { listPolicies, getAllProducts } from "@/server/queries/policies";
import { getAgents, getCallers, getPeople, nameOf, toOptions } from "@/server/queries/people";

export const metadata: Metadata = { title: "Police" };
const PAGE_SIZE = 50;

export default async function PoliciesPage({ searchParams }: PageProps<"/policies">) {
  const { profile } = await requireSession(["owner", "agent"]);
  const sp = await searchParams;
  const page = pageParam(sp);
  const isOwner = profile.role === "owner";
  const agentParam = param(sp, "agent");
  const [{ rows, total, sort }, people, products, agents, callers] = await Promise.all([
    listPolicies({
      q: param(sp, "q"),
      product: isUuid(param(sp, "product")) ? param(sp, "product") : undefined,
      agent: isOwner ? (isUuid(agentParam) ? agentParam : undefined) : undefined,
      caller: isUuid(param(sp, "caller")) ? param(sp, "caller") : undefined,
      from: param(sp, "from"),
      to: param(sp, "to"),
      sort: param(sp, "sort"),
      page,
      pageSize: PAGE_SIZE,
    }),
    getPeople(),
    getAllProducts(),
    getAgents({ includeInactive: true }),
    getCallers({ includeInactive: true }),
  ]);

  const sortProps = { sort, hrefFor: (s: string) => hrefWith("/policies", sp, { sort: s, page: undefined }) };

  const filters: FilterDef[] = [
    { key: "q", label: "Iskanje", type: "search", placeholder: "Stranka ali št. police…" },
    { key: "product", label: "Produkt", type: "select", options: [{ value: "", label: "Vsi" }, ...products.map((p) => ({ value: p.id, label: p.name }))] },
    ...(isOwner ? [{ key: "agent", label: "Zastopnik", type: "select", options: [{ value: "", label: "Vsi" }, ...toOptions(agents).map((a) => ({ value: a.id, label: a.name }))] } as FilterDef] : []),
    { key: "caller", label: "Klicatelj", type: "select", options: [{ value: "", label: "Vsi" }, ...toOptions(callers).map((a) => ({ value: a.id, label: a.name }))] },
    { key: "from", label: "Datum od", type: "date" },
    { key: "to", label: "Datum do", type: "date" },
  ];

  return (
    <>
      <PageHeader title="Police" description={isOwner ? "Vse sklenjene police" : "Police vaših strank"} />
      <FilterBar className="mb-4" filters={filters} />
      <Card>
        {rows.length === 0 ? (
          <EmptyState title="Ni polic" description="Police nastanejo ob rezultatu A1." />
        ) : (
          <Table>
            <THead>
              <tr>
                <SortTH label="Datum" column="policy_date" firstDesc {...sortProps} />
                <TH>Stranka</TH>
                <SortTH label="Produkt" column="product_name" {...sortProps} />
                <SortTH label="Št. police" column="policy_number" {...sortProps} />
                <SortTH label="Mesečna premija" column="monthly_premium" firstDesc className="text-right" {...sortProps} />
                <SortTH label="Trajanje" column="duration_years" firstDesc className="text-right" {...sortProps} />
                <SortTH label="Zastopnik" column="agent_id" {...sortProps} />
                <SortTH label="Klicatelj" column="caller_id" {...sortProps} />
              </tr>
            </THead>
            <tbody>
              {rows.map((p) => (
                <TR key={p.id}>
                  <TD className="tabular">{formatDate(p.policy_date)}</TD>
                  <TD>
                    <Link href={`/customers/${p.customer_id}`} className="hover:text-brand hover:underline">
                      {p.customer.first_name} {p.customer.last_name}
                    </Link>
                  </TD>
                  <TD>
                    <Link href={`/policies/${p.id}`} className="font-medium hover:text-brand hover:underline">
                      {p.product_name}
                    </Link>
                  </TD>
                  <TD className="text-ink-2">{p.policy_number ?? "–"}</TD>
                  <TD className="text-right tabular">{formatDecimalEur(p.monthly_premium)}</TD>
                  <TD className="text-right tabular">{p.duration_years} let</TD>
                  <TD className="whitespace-nowrap">{nameOf(people, p.agent_id)}</TD>
                  <TD className="whitespace-nowrap text-ink-2">{p.caller_id ? nameOf(people, p.caller_id) : "–"}</TD>
                </TR>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-subtle/60 text-xs text-ink-2">
                <TD colSpan={4}>Na tej strani</TD>
                <TD className="text-right font-medium tabular">{formatEur(sumDecimals(rows.map((r) => r.monthly_premium)))}</TD>
                <TD colSpan={3} />
              </tr>
            </tfoot>
          </Table>
        )}
        <div className="border-t border-line">
          <Pagination page={page} pageSize={PAGE_SIZE} total={total} hrefFor={(p) => hrefWith("/policies", sp, { page: p })} />
        </div>
      </Card>
    </>
  );
}
