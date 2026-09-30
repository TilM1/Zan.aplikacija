import type { Metadata } from "next";
import { requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatDateTime } from "@/lib/dates";
import { formatDecimalEur } from "@/lib/money";
import { hrefWith, pageParam, param } from "@/lib/url";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState, PageHeader, Pagination, Tabs } from "@/components/ui/misc";
import { Table, TD, TH, THead, TR } from "@/components/ui/table";
import { BackupActions } from "@/components/storno/backup-actions";
import { getPeople, nameOf } from "@/server/queries/people";
import type { DeletedRecord } from "@/types/domain";

export const metadata: Metadata = { title: "Storno in izbrisi" };
const PAGE_SIZE = 50;

export default async function DeletedPage({ searchParams }: PageProps<"/deleted">) {
  await requireSession(["owner"]);
  const sp = await searchParams;
  const tab = param(sp, "tab") === "customer_deleted" ? "customer_deleted" : param(sp, "tab") === "policy_storno" ? "policy_storno" : "all";
  const page = pageParam(sp);
  const supabase = await createClient();
  let q = supabase
    .from("deleted_records")
    .select("id, kind, customer_id, customer_name, policy_id, summary, reason, meta, created_by, created_at, restored_at, restored_by", { count: "exact" })
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (tab !== "all") q = q.eq("kind", tab);
  const [{ data, count }, people] = await Promise.all([q, getPeople()]);
  const rows = (data ?? []) as DeletedRecord[];

  return (
    <>
      <PageHeader
        title="Storno in izbrisi"
        description="Varnostna kopija vseh stornov in izbrisanih strank. Če je prišlo do pomote, stranko obnovite ali storno razveljavite."
      />
      <Tabs
        active={tab}
        tabs={[
          { key: "all", label: "Vse", href: hrefWith("/deleted", sp, { tab: undefined, page: undefined }) },
          { key: "policy_storno", label: "Storno polic", href: hrefWith("/deleted", sp, { tab: "policy_storno", page: undefined }) },
          { key: "customer_deleted", label: "Izbrisane stranke", href: hrefWith("/deleted", sp, { tab: "customer_deleted", page: undefined }) },
        ]}
      />
      <Card>
        {rows.length === 0 ? (
          <EmptyState title="Ni stornov ali izbrisov" />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Datum</TH>
                <TH>Vrsta</TH>
                <TH>Stranka</TH>
                <TH>Kaj</TH>
                <TH>Razlog</TH>
                <TH className="text-right">Preklicano / odbitek</TH>
                <TH>Izvedel</TH>
                <TH>Stanje</TH>
                <TH className="text-right">Dejanja</TH>
              </tr>
            </THead>
            <tbody>
              {rows.map((r) => {
                const m = r.meta as { cancelled_sum?: number; clawback_sum?: number; clawback_due?: string };
                return (
                  <TR key={r.id}>
                    <TD className="whitespace-nowrap tabular">{formatDateTime(r.created_at)}</TD>
                    <TD>{r.kind === "policy_storno" ? <Badge tone="warning">Storno</Badge> : <Badge tone="danger">Izbris</Badge>}</TD>
                    <TD className="font-medium whitespace-nowrap">
                      {r.kind === "policy_storno" || r.restored_at ? (
                        <a href={`/customers/${r.customer_id}`} className="hover:text-brand hover:underline">
                          {r.customer_name}
                        </a>
                      ) : (
                        r.customer_name
                      )}
                    </TD>
                    <TD className="text-ink-2">{r.summary}</TD>
                    <TD className="max-w-72 text-ink-2">{r.reason}</TD>
                    <TD className="text-right whitespace-nowrap tabular">
                      {r.kind === "policy_storno" ? (
                        <>
                          {formatDecimalEur(m.cancelled_sum ?? 0)}
                          {Number(m.clawback_sum) > 0 && (
                            <span className="block text-xs text-danger">
                              odbitek −{formatDecimalEur(m.clawback_sum ?? 0)} ({formatDate(m.clawback_due)})
                            </span>
                          )}
                        </>
                      ) : (
                        "–"
                      )}
                    </TD>
                    <TD className="whitespace-nowrap">{nameOf(people, r.created_by)}</TD>
                    <TD className="whitespace-nowrap">
                      {r.restored_at ? (
                        <span className="text-xs text-success">
                          {r.kind === "policy_storno" ? "Razveljavljeno" : "Obnovljeno"} {formatDate(r.restored_at)}
                          <span className="block text-ink-3">{nameOf(people, r.restored_by)}</span>
                        </span>
                      ) : (
                        <span className="text-xs text-ink-3">Aktivno</span>
                      )}
                    </TD>
                    <TD className="text-right">
                      <BackupActions id={r.id} kind={r.kind} restored={!!r.restored_at} customerId={r.customer_id} />
                    </TD>
                  </TR>
                );
              })}
            </tbody>
          </Table>
        )}
        <div className="border-t border-line">
          <Pagination page={page} pageSize={PAGE_SIZE} total={count ?? 0} hrefFor={(p) => hrefWith("/deleted", sp, { page: p })} />
        </div>
      </Card>
    </>
  );
}
