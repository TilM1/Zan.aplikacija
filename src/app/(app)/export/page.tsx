import type { Metadata } from "next";
import { Download, ShieldAlert } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { param } from "@/lib/url";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import { buttonClasses } from "@/components/ui/button";
import { FilterBar } from "@/components/pipeline/filter-bar";
import { EXPORT_DATASETS } from "@/server/export/datasets";
import { ImportCard } from "@/components/leads/import-card";
import { ListsTable } from "@/components/leads/lists-table";
import { getLeadListStats, getLeadLists } from "@/server/queries/leads";
import { getCallers, getPeople, toOptions } from "@/server/queries/people";

export const metadata: Metadata = { title: "Uvoz / izvoz" };

export default async function ExportPage({ searchParams }: PageProps<"/export">) {
  await requireSession(["owner"]);
  const sp = await searchParams;
  const [lists, stats, callers, people] = await Promise.all([getLeadLists({ includeInactive: true }), getLeadListStats(), getCallers(), getPeople()]);
  const names = Object.fromEntries([...people.values()].map((p) => [p.id, `${p.first_name} ${p.last_name}`]));
  const qs = new URLSearchParams();
  if (param(sp, "from")) qs.set("from", param(sp, "from")!);
  if (param(sp, "to")) qs.set("to", param(sp, "to")!);
  const suffix = (format: string) => `?${new URLSearchParams({ ...Object.fromEntries(qs), format }).toString()}`;

  return (
    <>
      <PageHeader title="Uvoz / izvoz" description="Uvoz kontaktov za klicanje in izvoz podatkov CRM (samo lastnik)." />
      <div className="mb-8 flex flex-col gap-4">
        <ImportCard callers={toOptions(callers)} />
        <ListsTable lists={lists} stats={stats} callers={toOptions(callers)} names={names} />
      </div>
      <h2 className="mb-3 text-lg font-semibold">Izvoz podatkov</h2>
      <div className="mb-4 flex gap-3 rounded-lg border border-warning/30 bg-warning-soft px-4 py-3 text-sm text-ink-2">
        <ShieldAlert className="mt-0.5 size-5 shrink-0 text-warning" />
        <div>
          <p className="font-medium text-ink">Izvoz CSV/XLSX ni varnostna kopija baze.</p>
          <p className="mt-0.5">
            Izvoz je namenjen pregledu in zasilni offline kopiji. Varnostne kopije in obnova baze potekajo v Supabase (dnevne kopije / Point-in-Time Recovery) – glejte
            dokument <code className="rounded bg-surface px-1">docs/BACKUP_AND_RECOVERY.md</code>. Izvozi vsebujejo osebne podatke: hranite jih varno in v skladu z GDPR.
          </p>
        </div>
      </div>
      <FilterBar className="mb-4" filters={[{ key: "from", label: "Od (neobvezno)", type: "date" }, { key: "to", label: "Do (neobvezno)", type: "date" }]} />
      <Card className="mb-4">
        <CardHeader title="Celoten izvoz" description="Vsi nabori podatkov v enem Excel delovnem zvezku (en list na nabor)" />
        <CardBody>
          <a href={`/api/export/all${suffix("xlsx")}`} className={buttonClasses("primary")}>
            <Download className="size-4" /> Prenesi vse (XLSX)
          </a>
        </CardBody>
      </Card>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {EXPORT_DATASETS.map((ds) => (
          <Card key={ds.key}>
            <CardBody className="flex h-full flex-col">
              <p className="font-medium">{ds.label}</p>
              <p className="mt-1 flex-1 text-sm text-ink-3">{ds.description}</p>
              <p className="mt-2 text-xs text-ink-3">{ds.dateColumn ? `Filter po: ${ds.dateColumn}` : "Vedno celoten nabor"}</p>
              <div className="mt-3 flex gap-2">
                <a href={`/api/export/${ds.key}${suffix("csv")}`} className={buttonClasses("secondary", "sm")}>
                  <Download className="size-3.5" /> CSV
                </a>
                <a href={`/api/export/${ds.key}${suffix("xlsx")}`} className={buttonClasses("secondary", "sm")}>
                  <Download className="size-3.5" /> XLSX
                </a>
              </div>
            </CardBody>
          </Card>
        ))}
      </div>
    </>
  );
}
