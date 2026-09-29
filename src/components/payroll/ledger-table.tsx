"use client";

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, FormError, Input } from "@/components/ui/form";
import { SortLink, Table, TD, TH, THead, TR } from "@/components/ui/table";
import { InstallmentStatusBadge } from "@/components/ui/status";
import { useSubmit } from "@/components/shared/use-submit";
import { markInstallmentsPaid } from "@/server/actions/payroll";
import { BENEFICIARY_LABELS } from "@/lib/labels";
import { formatDate, todayIso } from "@/lib/dates";
import { formatDecimalEur, formatEur, sumDecimals } from "@/lib/money";
import { displayStatus } from "@/lib/payroll";
import type { LedgerRow } from "@/server/queries/payroll";

export function LedgerTable({
  rows,
  names,
  canMarkPaid,
  showBeneficiary,
  sort,
  sortHrefs,
}: {
  rows: LedgerRow[];
  names: Record<string, string>;
  canMarkPaid: boolean;
  showBeneficiary: boolean;
  /** Current ?sort value and prebuilt links (asc/desc) per sortable column. */
  sort: string;
  sortHrefs: Record<string, { asc: string; desc: string }>;
}) {
  const sortTh = (label: string, column: string, className?: string, firstDesc = false) => {
    const active = sort.replace(/^-/, "") === column;
    const desc = sort.startsWith("-");
    const href = active ? (desc ? sortHrefs[column].asc : sortHrefs[column].desc) : firstDesc ? sortHrefs[column].desc : sortHrefs[column].asc;
    return (
      <TH className={className}>
        <SortLink href={href} active={active} desc={desc} label={label} />
      </TH>
    );
  };
  const router = useRouter();
  const today = todayIso();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<string | null>(null);
  const [dialog, setDialog] = useState(false);
  const [paidOn, setPaidOn] = useState(today);
  const [note, setNote] = useState("");
  const { submit, pending, error } = useSubmit<number>();

  const selectable = rows.filter((r) => r.status === "scheduled");
  const selectedRows = rows.filter((r) => selected.has(r.id));
  const selectedTotal = useMemo(() => sumDecimals(selectedRows.map((r) => r.amount)), [selectedRows]);
  const toggle = (id: string) => setSelected((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });

  return (
    <>
      {canMarkPaid && selected.size > 0 && (
        <div className="sticky top-14 z-10 flex flex-wrap items-center justify-between gap-2 border-b border-line bg-brand-soft px-4 py-2 text-sm">
          <span>
            Izbrano: <b>{selected.size}</b> · skupaj <b className="tabular">{formatEur(selectedTotal)}</b>
          </span>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              Počisti
            </Button>
            <Button size="sm" variant="success" onClick={() => setDialog(true)}>
              Označi kot plačano
            </Button>
          </div>
        </div>
      )}
      <Table>
        <THead>
          <tr>
            {canMarkPaid && (
              <TH className="w-8">
                <input
                  type="checkbox"
                  aria-label="Izberi vse"
                  checked={selectable.length > 0 && selectable.every((r) => selected.has(r.id))}
                  onChange={(e) => setSelected(e.target.checked ? new Set(selectable.map((r) => r.id)) : new Set())}
                />
              </TH>
            )}
            <TH className="w-6" />
            {sortTh("Zapadlost", "due_date")}
            {showBeneficiary && sortTh("Prejemnik", "beneficiary_id")}
            {sortTh("Vrsta", "beneficiary_type")}
            <TH>Stranka</TH>
            <TH>Polica</TH>
            {sortTh("Obrok", "installment_number")}
            {sortTh("Znesek", "amount", "text-right", true)}
            {sortTh("Status", "status")}
          </tr>
        </THead>
        <tbody>
          {rows.map((r) => {
            const open = expanded === r.id;
            const calc = r.commission.calculation as Record<string, unknown>;
            return (
              <Fragment key={r.id}>
                <TR className={selected.has(r.id) ? "bg-brand-soft/50" : undefined}>
                  {canMarkPaid && (
                    <TD>{r.status === "scheduled" && <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} aria-label="Izberi" />}</TD>
                  )}
                  <TD>
                    <button onClick={() => setExpanded(open ? null : r.id)} className="text-ink-3 hover:text-ink" aria-label="Podrobnosti izračuna">
                      {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                    </button>
                  </TD>
                  <TD className="whitespace-nowrap tabular">{formatDate(r.due_date)}</TD>
                  {showBeneficiary && <TD className="whitespace-nowrap font-medium">{names[r.beneficiary_id] ?? "–"}</TD>}
                  <TD className="text-ink-2">{BENEFICIARY_LABELS[r.beneficiary_type]}</TD>
                  <TD>
                    <Link href={`/customers/${r.policy.customer.id}`} className="hover:text-brand hover:underline">
                      {r.policy.customer.first_name} {r.policy.customer.last_name}
                    </Link>
                  </TD>
                  <TD>
                    <Link href={`/policies/${r.policy.id}`} className="text-ink-2 hover:text-brand hover:underline">
                      {r.policy.product_name}
                    </Link>
                  </TD>
                  <TD className="whitespace-nowrap text-ink-2">
                    {r.beneficiary_type === "caller" ? "enkratno" : `${r.installment_number}. (${Number(r.share_percent)} %)`}
                  </TD>
                  <TD className="text-right font-medium tabular">{formatDecimalEur(r.amount)}</TD>
                  <TD className="whitespace-nowrap">
                    <InstallmentStatusBadge status={displayStatus(r, today)} />
                    {r.paid_at && <span className="ml-1.5 text-xs text-ink-3">{formatDate(r.paid_at)}</span>}
                  </TD>
                </TR>
                {open && (
                  <tr className="bg-subtle/60">
                    <td colSpan={canMarkPaid ? 10 : 9} className="px-4 py-3 text-xs text-ink-2">
                      <p className="font-mono text-[13px] text-ink">
                        {String(calc.expression ?? "")} = {formatDecimalEur(r.commission.total_amount)}
                      </p>
                      <p className="mt-1">
                        Datum police {formatDate(r.policy.policy_date)} · prvotna zapadlost {formatDate(r.original_due_date)} · pravila {r.commission.rule_version}
                        {r.commission.rate_percent !== null && ` · odstotek ob prodaji ${Number(r.commission.rate_percent).toFixed(2)} %`}
                        {r.paid_at && ` · izplačano ${formatDate(r.paid_at)} (${formatDecimalEur(r.paid_amount)}) · označil ${names[r.paid_by ?? ""] ?? "–"}`}
                        {r.payment_note && ` · ${r.payment_note}`}
                      </p>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </Table>

      <Dialog
        open={dialog}
        onClose={() => setDialog(false)}
        title="Označi izplačila kot plačana"
        description={`${selected.size} izplačil · skupaj ${formatEur(selectedTotal)}`}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDialog(false)}>
              Prekliči
            </Button>
            <Button
              variant="success"
              loading={pending}
              onClick={async () => {
                const res = await submit(() => markInstallmentsPaid({ installment_ids: [...selected], paid_on: paidOn, note }));
                if (res?.ok) {
                  setSelected(new Set());
                  setDialog(false);
                  router.refresh();
                }
              }}
            >
              Potrdi plačilo
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <FormError message={error} />
          <p className="text-sm text-ink-2">Plačana izplačila so dokončna in jih ni mogoče več spreminjati.</p>
          <Field label="Datum plačila" required>
            <Input type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
          </Field>
          <Field label="Opomba (npr. sklic nakazila)">
            <Input value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
      </Dialog>
    </>
  );
}
