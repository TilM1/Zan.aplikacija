"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Download, Pencil, Trash2 } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/misc";
import { Field, FormError, Input, Select } from "@/components/ui/form";
import { Table, TD, TH, THead, TR } from "@/components/ui/table";
import { useSubmit } from "@/components/shared/use-submit";
import { deleteLeadList, updateLeadList } from "@/server/actions/leads";
import { formatDate } from "@/lib/dates";
import type { LeadList } from "@/types/domain";
import type { ListStats } from "@/server/queries/leads";
import type { PersonOption } from "@/server/queries/people";

const n = (x: number | undefined) => (x ?? 0).toLocaleString("sl-SI");

export function ListsTable({ lists, stats, callers, names }: { lists: LeadList[]; stats: Record<string, ListStats>; callers: PersonOption[]; names: Record<string, string> }) {
  const [editing, setEditing] = useState<LeadList | null>(null);
  const [deleting, setDeleting] = useState<LeadList | null>(null);
  return (
    <Card>
      <CardHeader title="Klicni seznami" description="Stanje po seznamih. »Za klic« = novi in tisti, ki jih je treba danes poklicati ponovno." />
      {lists.length === 0 ? (
        <EmptyState title="Še ni uvoženih seznamov" />
      ) : (
        <Table>
          <THead>
            <tr>
              <TH>Seznam</TH>
              <TH>Uvoženo</TH>
              <TH>Klicateljica</TH>
              <TH className="text-right">Kontaktov</TH>
              <TH className="text-right">Za klic</TH>
              <TH className="text-right">Ponovni klic</TH>
              <TH className="text-right">Termin</TH>
              <TH className="text-right">Zavrnjen</TH>
              <TH className="text-right">Ne kliči</TH>
              <TH>Status</TH>
              <TH className="text-right">Dejanja</TH>
            </tr>
          </THead>
          <tbody>
            {lists.map((l) => {
              const s = stats[l.id];
              return (
                <TR key={l.id}>
                  <TD>
                    <a href={`/leads?list=${l.id}&view=all`} className="font-semibold hover:text-brand hover:underline">
                      {l.name}
                    </a>
                    <span className="block text-[11px] text-ink-3">{l.source_file_name}</span>
                  </TD>
                  <TD className="text-xs whitespace-nowrap text-ink-2">
                    {formatDate(l.created_at)}
                    {(l.skipped_duplicates > 0 || l.skipped_suppressed > 0 || l.skipped_invalid > 0) && (
                      <span className="block text-[11px] text-ink-3" title="Preskočeno pri uvozu">
                        preskočeno: {n(l.skipped_duplicates + l.skipped_suppressed + l.skipped_invalid)}
                      </span>
                    )}
                  </TD>
                  <TD className="whitespace-nowrap">{l.assigned_caller_id ? names[l.assigned_caller_id] : <span className="text-ink-3">Vse</span>}</TD>
                  <TD className="text-right tabular">{n(s?.total)}</TD>
                  <TD className="text-right font-semibold tabular">{n(s?.due)}</TD>
                  <TD className="text-right tabular">{n(s?.byStatus.callback)}</TD>
                  <TD className="text-right text-success tabular">{n(s?.byStatus.appointment)}</TD>
                  <TD className="text-right tabular">{n(s?.byStatus.rejected)}</TD>
                  <TD className="text-right text-danger tabular">{n(s?.byStatus.do_not_call)}</TD>
                  <TD>
                    {l.status === "ready" ? <Badge tone="success">Aktiven</Badge> : l.status === "archived" ? <Badge>Arhiviran</Badge> : <Badge tone="warning">Nedokončan uvoz</Badge>}
                  </TD>
                  <TD className="text-right whitespace-nowrap">
                    <a href={`/api/export/leads?format=xlsx&list=${l.id}`} className="mr-1 inline-grid size-8 place-items-center rounded-md border border-line hover:border-gold" title="Izvozi seznam (Excel) s statusi in komentarji">
                      <Download className="size-4" />
                    </a>
                    <button onClick={() => setEditing(l)} className="mr-1 inline-grid size-8 place-items-center rounded-md border border-line hover:border-gold" title="Uredi">
                      <Pencil className="size-4" />
                    </button>
                    <button onClick={() => setDeleting(l)} className="inline-grid size-8 place-items-center rounded-md border border-line text-danger hover:bg-danger-soft" title="Izbriši">
                      <Trash2 className="size-4" />
                    </button>
                  </TD>
                </TR>
              );
            })}
          </tbody>
        </Table>
      )}
      {editing && <EditListDialog list={editing} callers={callers} onClose={() => setEditing(null)} />}
      <DeleteListDialog list={deleting} total={deleting ? (stats[deleting.id]?.total ?? 0) : 0} onClose={() => setDeleting(null)} />
    </Card>
  );
}

function EditListDialog({ list, callers, onClose }: { list: LeadList; callers: PersonOption[]; onClose: () => void }) {
  const router = useRouter();
  const { submit, pending, error } = useSubmit();
  const [v, setV] = useState({ name: list.name, assigned_caller_id: list.assigned_caller_id ?? "", archived: list.status === "archived" });
  return (
    <Dialog
      open
      onClose={onClose}
      title="Uredi klicni seznam"
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Prekliči
          </Button>
          <Button
            loading={pending}
            onClick={async () => {
              const res = await submit(() => updateLeadList({ list_id: list.id, name: v.name, assigned_caller_id: v.assigned_caller_id || null, archived: v.archived }));
              if (res?.ok) {
                router.refresh();
                onClose();
              }
            }}
          >
            Shrani
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <FormError message={error} />
        <Field label="Ime seznama">
          <Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
        </Field>
        <Field label="Kdo kliče ta seznam?">
          <Select value={v.assigned_caller_id} onChange={(e) => setV({ ...v, assigned_caller_id: e.target.value })}>
            <option value="">Vse klicateljice</option>
            {callers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="size-4 accent-[#c6a24b]" checked={v.archived} onChange={(e) => setV({ ...v, archived: e.target.checked })} />
          Arhiviraj (klicateljice seznama ne vidijo več, podatki ostanejo)
        </label>
      </div>
    </Dialog>
  );
}

function DeleteListDialog({ list, total, onClose }: { list: LeadList | null; total: number; onClose: () => void }) {
  const router = useRouter();
  const { submit, pending, error } = useSubmit<number>();
  const [confirm, setConfirm] = useState("");
  return (
    <ConfirmDialog
      open={!!list}
      onClose={() => {
        setConfirm("");
        onClose();
      }}
      title="Izbriši klicni seznam"
      confirmLabel="Trajno izbriši"
      loading={pending}
      onConfirm={async () => {
        if (!list || confirm.trim().toLowerCase() !== "izbriši") return;
        const res = await submit(() => deleteLeadList({ list_id: list.id }));
        if (res?.ok) {
          setConfirm("");
          router.refresh();
          onClose();
        }
      }}
      description={
        <>
          Trajno boste izbrisali seznam <b>{list?.name}</b> z <b>{total.toLocaleString("sl-SI")}</b> kontakti, njihovimi statusi in komentarji. Stranke, ki so že dobile termin, ostanejo v CRM.
          Številke »Ne kliči« ostanejo blokirane. Priporočamo, da seznam prej izvozite.
        </>
      }
    >
      <div className="mt-3 flex flex-col gap-2">
        <FormError message={error} />
        <Field label="Za potrditev vpišite: izbriši">
          <Input value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </Field>
      </div>
    </ConfirmDialog>
  );
}
