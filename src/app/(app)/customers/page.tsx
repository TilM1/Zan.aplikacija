import type { Metadata } from "next";
import Link from "next/link";
import { Repeat } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { hrefWith, pageParam, param } from "@/lib/url";
import { formatDate, formatDateTime } from "@/lib/dates";
import { CUSTOMER_STATUS_LABELS } from "@/lib/labels";
import { Card } from "@/components/ui/card";
import { EmptyState, PageHeader, Pagination } from "@/components/ui/misc";
import { SortTH, Table, TD, THead, TR } from "@/components/ui/table";
import { CustomerStatusBadge, ResultBadge } from "@/components/ui/status";
import { buttonClasses } from "@/components/ui/button";
import { FilterBar } from "@/components/pipeline/filter-bar";
import { listCustomers } from "@/server/queries/customers";
import { getPeople, nameOf } from "@/server/queries/people";

export const metadata: Metadata = { title: "Stranke" };
const PAGE_SIZE = 50;

export default async function CustomersPage({ searchParams }: PageProps<"/customers">) {
  const { profile } = await requireSession();
  const sp = await searchParams;
  const page = pageParam(sp);
  const archived = param(sp, "archived") === "1";
  const [{ rows, total, sort }, people] = await Promise.all([
    listCustomers({ q: param(sp, "q"), status: param(sp, "status"), archived, sort: param(sp, "sort"), page, pageSize: PAGE_SIZE }),
    getPeople(),
  ]);

  const sortProps = { sort, hrefFor: (s: string) => hrefWith("/customers", sp, { sort: s, page: undefined }) };

  return (
    <>
      <PageHeader
        title={profile.role === "caller" ? "Moje stranke" : "Stranke"}
        description={profile.role === "owner" ? "Vse stranke v CRM" : "Stranke, s katerimi ste povezani"}
        actions={
          profile.role !== "agent" && (
            <Link href="/appointments/new" className={buttonClasses("gold")}>
              Nov termin
            </Link>
          )
        }
      />
      <FilterBar
        className="mb-4"
        filters={[
          { key: "q", label: "Iskanje", type: "search", placeholder: "Ime, priimek, telefon, e-pošta, pošta…" },
          { key: "status", label: "Status", type: "select", options: [{ value: "", label: "Vsi" }, ...Object.entries(CUSTOMER_STATUS_LABELS).map(([k, v]) => ({ value: k, label: v.label }))] },
          ...(profile.role === "owner"
            ? [{ key: "archived", label: "Arhiv", type: "select" as const, options: [{ value: "", label: "Aktivne" }, { value: "1", label: "Arhivirane" }] }]
            : []),
        ]}
      />
      <Card>
        {rows.length === 0 ? (
          <EmptyState title="Ni strank" description={param(sp, "q") ? "Poskusite z drugim iskalnim nizom." : "Stranke nastanejo, ko klicatelj dogovori termin."} />
        ) : (
          <Table>
            <THead>
              <tr>
                <SortTH label="Stranka" column="last_name" {...sortProps} />
                <SortTH label="Telefon" column="phone" {...sortProps} />
                <SortTH label="Kraj" column="postal_code" {...sortProps} />
                <SortTH label="Status" column="status" {...sortProps} />
                <SortTH label="Zadnji rezultat" column="last_result" {...sortProps} />
                <SortTH label="Svetovanja" column="consultation_count" firstDesc className="text-right" {...sortProps} />
                <SortTH label="Police" column="policy_count" firstDesc className="text-right" {...sortProps} />
                <SortTH label="Naslednji termin" column="next_appointment_at" {...sortProps} />
                <SortTH label="Zastopnik" column="current_agent_id" {...sortProps} />
                <SortTH label="Klicatelj" column="responsible_caller_id" {...sortProps} />
                <SortTH label="Ustvarjena" column="created_at" firstDesc {...sortProps} />
              </tr>
            </THead>
            <tbody>
              {rows.map((c) => (
                <TR key={c.id}>
                  <TD>
                    <Link href={`/customers/${c.id}`} className="font-medium hover:text-brand hover:underline">
                      {c.first_name} {c.last_name}
                    </Link>
                    {c.is_demo && <span className="ml-1.5 text-[10px] font-semibold text-warning">DEMO</span>}
                  </TD>
                  <TD className="whitespace-nowrap">{c.phone}</TD>
                  <TD className="whitespace-nowrap text-ink-2">
                    {c.postal_code} {c.city}
                  </TD>
                  <TD>
                    <CustomerStatusBadge status={c.status} />
                  </TD>
                  <TD>
                    <ResultBadge result={c.last_result} withLabel={false} />
                  </TD>
                  <TD className="text-right tabular">
                    {c.consultation_count > 1 ? (
                      <span className="inline-flex items-center gap-1 text-accent">
                        <Repeat className="size-3.5" />
                        {c.consultation_count}
                      </span>
                    ) : (
                      c.consultation_count
                    )}
                  </TD>
                  <TD className="text-right tabular">{c.policy_count}</TD>
                  <TD className="whitespace-nowrap tabular">{c.next_appointment_at ? formatDateTime(c.next_appointment_at) : "–"}</TD>
                  <TD className="whitespace-nowrap">{nameOf(people, c.current_agent_id)}</TD>
                  <TD className="whitespace-nowrap text-ink-2">{nameOf(people, c.responsible_caller_id)}</TD>
                  <TD className="whitespace-nowrap text-ink-3 tabular">{formatDate(c.created_at)}</TD>
                </TR>
              ))}
            </tbody>
          </Table>
        )}
        <div className="border-t border-line">
          <Pagination page={page} pageSize={PAGE_SIZE} total={total} hrefFor={(p) => hrefWith("/customers", sp, { page: p })} />
        </div>
      </Card>
    </>
  );
}
