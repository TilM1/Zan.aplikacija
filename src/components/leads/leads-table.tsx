"use client";

import { useState } from "react";
import { Phone } from "lucide-react";
import { Table, TD, TH, THead, TR, SortLink } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/misc";
import { LEAD_STATUS_LABELS } from "@/lib/labels";
import { formatDate, formatDateTime } from "@/lib/dates";
import { formatPhone } from "@/lib/phone";
import type { Lead } from "@/types/domain";
import { LeadDialog } from "./lead-dialog";

export function LeadsTable({
  rows,
  names,
  listNames,
  showList,
  sort,
  sortHrefs,
  recallMonths,
}: {
  rows: Lead[];
  names: Record<string, string>;
  listNames: Record<string, string>;
  showList: boolean;
  sort: string;
  sortHrefs: Record<string, { asc: string; desc: string }>;
  recallMonths: number;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const th = (label: string, column: string, className?: string, firstDesc = false) => {
    const active = sort.replace(/^-/, "") === column;
    const desc = sort.startsWith("-");
    const h = sortHrefs[column];
    return (
      <TH className={className}>
        <SortLink href={active ? (desc ? h.asc : h.desc) : firstDesc ? h.desc : h.asc} active={active} desc={desc} label={label} />
      </TH>
    );
  };

  if (rows.length === 0) return <EmptyState icon={Phone} title="Ni kontaktov" description="Za izbrane filtre ni kontaktov. Poskusite spremeniti filter ali zavihek." />;

  return (
    <>
      <Table>
        <THead>
          <tr>
            {th("#", "row_number")}
            {th("Naziv", "name")}
            <TH>Telefon</TH>
            {th("Kraj", "city")}
            {th("Pošta", "postal_code")}
            {th("Dejavnost", "activity")}
            {th("Status", "status")}
            {th("Naslednji klic", "next_call_at")}
            {th("Zadnji klic", "last_contacted_at", undefined, true)}
            <TH>Komentar</TH>
            {showList && <TH>Seznam</TH>}
            <TH className="text-right" />
          </tr>
        </THead>
        <tbody>
          {rows.map((l) => {
            const st = LEAD_STATUS_LABELS[l.status];
            return (
              <TR key={l.id} className="cursor-pointer" onClick={() => setOpenId(l.id)}>
                <TD className="text-xs text-ink-3 tabular">{l.row_number}</TD>
                <TD className="max-w-80">
                  <span className="block truncate font-semibold">{l.name}</span>
                  {l.existing_customer_id && <span className="text-[11px] font-medium text-warning">Že stranka v CRM</span>}
                </TD>
                <TD className="whitespace-nowrap">
                  <a href={`tel:${l.phone_normalized}`} onClick={(e) => e.stopPropagation()} className="font-medium text-brand tabular hover:underline">
                    {formatPhone(l.phone_normalized)}
                  </a>
                </TD>
                <TD className="whitespace-nowrap">{l.city}</TD>
                <TD className="tabular">{l.postal_code}</TD>
                <TD className="max-w-56 truncate text-ink-2">{l.activity}</TD>
                <TD>
                  <Badge tone={st.tone}>{st.label}</Badge>
                </TD>
                <TD className="whitespace-nowrap tabular">{l.next_call_at && l.status !== "appointment" ? formatDate(l.next_call_at) : "–"}</TD>
                <TD className="whitespace-nowrap text-ink-2 tabular">
                  {l.last_contacted_at ? (
                    <>
                      {formatDateTime(l.last_contacted_at)}
                      <span className="block text-[11px] text-ink-3">{names[l.last_contacted_by ?? ""]}</span>
                    </>
                  ) : (
                    "–"
                  )}
                </TD>
                <TD className="max-w-64 truncate text-ink-2">{l.last_comment ?? ""}</TD>
                {showList && <TD className="whitespace-nowrap text-xs text-ink-3">{listNames[l.list_id]}</TD>}
                <TD className="text-right">
                  <span className="inline-flex h-8 items-center rounded-md bg-gold px-3 text-xs font-semibold text-ink">Odpri</span>
                </TD>
              </TR>
            );
          })}
        </tbody>
      </Table>
      <LeadDialog leadIds={rows.map((r) => r.id)} openId={openId} onOpenChange={setOpenId} names={names} recallMonths={recallMonths} />
    </>
  );
}
