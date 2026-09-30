"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Ban, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, FormError, Input, Textarea } from "@/components/ui/form";
import { useSubmit } from "@/components/shared/use-submit";
import { deleteCustomer, stornoPolicy } from "@/server/actions/storno";
import { nextPayoutDayOnOrAfter } from "@/lib/commission/engine";
import { formatDate, todayIso } from "@/lib/dates";
import { formatEur } from "@/lib/money";
import { BENEFICIARY_LABELS } from "@/lib/labels";

export interface StornoPreview {
  /** Per beneficiary: unpaid (will be cancelled) and paid (will be deducted) amounts in cents. */
  rows: { name: string; type: "agent" | "caller"; unpaid: number; paid: number }[];
}

export function StornoButton({ policyId, label, preview, size = "sm" }: { policyId: string; label: string; preview: StornoPreview; size?: "sm" | "md" }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [due, setDue] = useState(() => nextPayoutDayOnOrAfter(todayIso()));
  const { submit, pending, error, fieldErrors } = useSubmit();
  const unpaid = preview.rows.reduce((a, r) => a + r.unpaid, 0);
  const paid = preview.rows.reduce((a, r) => a + r.paid, 0);

  return (
    <>
      <Button variant="secondary" size={size} className="text-danger" onClick={() => setOpen(true)}>
        <Ban className="size-4" /> Storno
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Storno police"
        description={label}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Prekliči
            </Button>
            <Button
              variant="danger"
              loading={pending}
              onClick={async () => {
                const res = await submit(() => stornoPolicy({ policy_id: policyId, reason, clawback_due: due }));
                if (res?.ok) {
                  setOpen(false);
                  router.refresh();
                }
              }}
            >
              Potrdi storno
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4 text-sm">
          <p>Uporabite, ko zavarovalnica polico naknadno zavrne. Polica ostane v zgodovini kot »Stornirana«.</p>
          <div className="rounded-lg border border-line">
            <table className="w-full text-sm">
              <thead className="bg-subtle text-left text-xs text-ink-2">
                <tr>
                  <th className="px-3 py-2">Prejemnik</th>
                  <th className="px-3 py-2 text-right">Še ni izplačano → prekliče se</th>
                  <th className="px-3 py-2 text-right">Že izplačano → odbitek</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((r) => (
                  <tr key={r.type} className="border-t border-line">
                    <td className="px-3 py-2">
                      {r.name} <span className="text-xs text-ink-3">({BENEFICIARY_LABELS[r.type]})</span>
                    </td>
                    <td className="px-3 py-2 text-right tabular">{formatEur(r.unpaid)}</td>
                    <td className="px-3 py-2 text-right font-semibold text-danger tabular">{r.paid ? `−${formatEur(r.paid)}` : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {paid > 0 ? (
            <p className="rounded-lg bg-warning-soft px-3 py-2 text-warning">
              Že izplačanih <b>{formatEur(paid)}</b> se odšteje pri izplačilu na izbrani dan (negativna postavka v izplačilih). Plačana zgodovina ostane nespremenjena.
            </p>
          ) : (
            <p className="rounded-lg bg-subtle px-3 py-2 text-ink-2">Nič še ni bilo izplačano – preklicanih bo {formatEur(unpaid)} bodočih provizij.</p>
          )}
          {paid > 0 && (
            <Field label="Odbitek pri izplačilu dne" hint={`Privzeto naslednji dan izplačila (${formatDate(nextPayoutDayOnOrAfter(todayIso()))}).`}>
              <Input type="date" value={due} min={todayIso()} onChange={(e) => setDue(e.target.value)} className="max-w-48" />
            </Field>
          )}
          <Field label="Razlog storna" required error={fieldErrors.reason}>
            <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="npr. Zavarovalnica zavrnila zaradi zdravstvenih pogojev" />
          </Field>
          <FormError message={error} />
          <p className="text-xs text-ink-3">Storno se shrani v »Storno in izbrisi«, kjer ga lahko razveljavite, dokler odbitek še ni obračunan.</p>
        </div>
      </Dialog>
    </>
  );
}

export function DeleteCustomerButton({ customerId, name, hasPaid }: { customerId: string; name: string; hasPaid: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [confirm, setConfirm] = useState("");
  const { submit, pending, error, fieldErrors } = useSubmit<string>();
  return (
    <>
      <Button variant="ghost" className="text-danger" onClick={() => setOpen(true)}>
        <Trash2 className="size-4" /> Izbriši
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Izbriši stranko"
        description={name}
        size="sm"
        footer={
          hasPaid ? (
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Zapri
            </Button>
          ) : (
            <>
              <Button variant="secondary" onClick={() => setOpen(false)}>
                Prekliči
              </Button>
              <Button
                variant="danger"
                disabled={confirm.trim().toLowerCase() !== "izbriši"}
                loading={pending}
                onClick={async () => {
                  const res = await submit(() => deleteCustomer({ customer_id: customerId, reason }));
                  if (res?.ok) {
                    router.push("/customers");
                    router.refresh();
                  }
                }}
              >
                Izbriši stranko
              </Button>
            </>
          )
        }
      >
        {hasPaid ? (
          <p className="rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning">
            Za to stranko so bile provizije že izplačane, zato je ni mogoče izbrisati (izginil bi zapis o plačah). Uporabite <b>Storno</b> pri polici v zavihku »Police« – s tem se
            provizije prekličejo oziroma odbijejo.
          </p>
        ) : (
          <div className="flex flex-col gap-3 text-sm">
            <p>
              Izbrisani bodo stranka, termini, police, neizplačane provizije, dokumenti in zgodovina. Vse se prej shrani v <b>»Storno in izbrisi«</b>, od koder lahko stranko
              obnovite.
            </p>
            <Field label="Razlog izbrisa" required error={fieldErrors.reason}>
              <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="npr. Vnesena po pomoti / dvojnik" />
            </Field>
            <Field label="Za potrditev vpišite: izbriši">
              <Input value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </Field>
            <FormError message={error} />
          </div>
        )}
      </Dialog>
    </>
  );
}
