"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, CalendarPlus, ClipboardCheck, MessageSquarePlus, Pencil, Upload, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, ConfirmDialog } from "@/components/ui/dialog";
import { Field, FormError, Input, Select, Textarea } from "@/components/ui/form";
import { useSubmit } from "@/components/shared/use-submit";
import { uploadDocument } from "@/components/shared/upload-document";
import { RecordResultDialog } from "@/components/appointments/record-result-dialog";
import { ScheduleAppointmentDialog, EditAppointmentDialog } from "@/components/appointments/appointment-dialogs";
import { addCustomerNote, setCustomerArchived, updateCustomer } from "@/server/actions/customers";
import { toast } from "sonner";
import type { CommissionRates, PersonOption } from "@/server/queries/people";
import type { Customer } from "@/types/domain";

export interface OpenAppointmentInfo {
  id: string;
  agentId: string;
  scheduledAt: string;
  durationMinutes: number;
  note: string | null;
  callerId: string | null;
  callerName?: string;
  canRecord: boolean;
  canEdit: boolean;
}

export function CustomerActions({
  customer,
  open,
  canSchedule,
  canUpload,
  isOwner,
  agents,
  products,
  rates,
  policies,
  defaultAgentId,
}: {
  customer: Customer;
  open: OpenAppointmentInfo | null;
  canSchedule: boolean;
  canUpload: boolean;
  isOwner: boolean;
  agents: PersonOption[];
  products: { id: string; name: string }[];
  rates: CommissionRates;
  policies: { id: string; label: string }[];
  defaultAgentId: string | null;
}) {
  const [mode, setMode] = useState<null | "edit" | "note" | "schedule" | "result" | "editAppt" | "upload" | "archive">(null);
  const close = () => setMode(null);
  const name = `${customer.first_name} ${customer.last_name}`;

  return (
    <div className="flex flex-wrap gap-2">
      {open?.canRecord && (
        <Button variant="gold" onClick={() => setMode("result")}>
          <ClipboardCheck className="size-4" /> Vnesi rezultat
        </Button>
      )}
      {open?.canEdit && (
        <Button variant="secondary" onClick={() => setMode("editAppt")}>
          <Pencil className="size-4" /> Uredi termin
        </Button>
      )}
      {!open && canSchedule && !customer.archived_at && (
        <Button variant="gold" onClick={() => setMode("schedule")}>
          <CalendarPlus className="size-4" /> Nov termin
        </Button>
      )}
      <Button variant="secondary" onClick={() => setMode("note")}>
        <MessageSquarePlus className="size-4" /> Opomba
      </Button>
      {canUpload && (
        <Button variant="secondary" onClick={() => setMode("upload")}>
          <Upload className="size-4" /> Dokument
        </Button>
      )}
      <Button variant="secondary" onClick={() => setMode("edit")}>
        <Pencil className="size-4" /> Uredi podatke
      </Button>
      {isOwner && (
        <Button variant="ghost" onClick={() => setMode("archive")}>
          {customer.archived_at ? <RotateCcw className="size-4" /> : <Archive className="size-4" />}
          {customer.archived_at ? "Obnovi" : "Arhiviraj"}
        </Button>
      )}

      {open && (
        <RecordResultDialog
          target={mode === "result" ? { id: open.id, customerId: customer.id, customerName: name, scheduledAt: open.scheduledAt, agentId: open.agentId, callerId: open.callerId, callerName: open.callerName } : null}
          agents={agents}
          products={products}
          rates={rates}
          onClose={close}
        />
      )}
      {open && (
        <EditAppointmentDialog
          appointment={mode === "editAppt" ? { id: open.id, agent_id: open.agentId, scheduled_at: open.scheduledAt, duration_minutes: open.durationMinutes, note: open.note, customerName: name } : null}
          agents={agents}
          onClose={close}
        />
      )}
      <ScheduleAppointmentDialog
        open={mode === "schedule"}
        onClose={close}
        customerId={customer.id}
        customerName={name}
        defaultAgentId={defaultAgentId}
        agents={agents}
        context={customer.status === "callback" ? "Stranka je na seznamu za ponoven klic (B). Nov termin zaključi klic nazaj." : undefined}
      />
      {mode === "edit" && <EditCustomerDialog customer={customer} onClose={close} />}
      {mode === "note" && <NoteDialog customerId={customer.id} onClose={close} />}
      {mode === "upload" && <UploadDialog customerId={customer.id} policies={policies} onClose={close} />}
      {isOwner && <ArchiveDialog open={mode === "archive"} customer={customer} onClose={close} />}
    </div>
  );
}

function EditCustomerDialog({ customer, onClose }: { customer: Customer; onClose: () => void }) {
  const router = useRouter();
  const { submit, pending, error, fieldErrors } = useSubmit();
  const [v, setV] = useState({
    first_name: customer.first_name,
    last_name: customer.last_name,
    phone: customer.phone,
    email: customer.email ?? "",
    address: customer.address,
    postal_code: customer.postal_code,
    city: customer.city ?? "",
  });
  const f = (k: keyof typeof v, label: string, span = "sm:col-span-3", required = true) => (
    <Field label={label} required={required} error={fieldErrors[k]} className={span}>
      <Input value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} aria-invalid={!!fieldErrors[k]} />
    </Field>
  );
  return (
    <Dialog
      open
      onClose={onClose}
      title="Uredi podatke stranke"
      description="Spremembe se zabeležijo v zgodovino."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Prekliči
          </Button>
          <Button
            loading={pending}
            onClick={async () => {
              const res = await submit(() => updateCustomer({ customer_id: customer.id, ...v }));
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
      <FormError message={error} />
      <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-6">
        {f("first_name", "Ime")}
        {f("last_name", "Priimek")}
        {f("phone", "Telefon")}
        {f("email", "E-pošta", "sm:col-span-3", false)}
        {f("address", "Naslov obiska", "sm:col-span-6")}
        {f("postal_code", "Poštna št.", "sm:col-span-2")}
        {f("city", "Kraj", "sm:col-span-4", false)}
      </div>
    </Dialog>
  );
}

function NoteDialog({ customerId, onClose }: { customerId: string; onClose: () => void }) {
  const router = useRouter();
  const { submit, pending, error } = useSubmit();
  const [note, setNote] = useState("");
  return (
    <Dialog
      open
      onClose={onClose}
      title="Nova opomba"
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Prekliči
          </Button>
          <Button
            loading={pending}
            onClick={async () => {
              const res = await submit(() => addCustomerNote({ customer_id: customerId, note }));
              if (res?.ok) {
                router.refresh();
                onClose();
              }
            }}
          >
            Dodaj opombo
          </Button>
        </>
      }
    >
      <FormError message={error} />
      <Textarea rows={4} autoFocus value={note} onChange={(e) => setNote(e.target.value)} className="mt-2" />
    </Dialog>
  );
}

function UploadDialog({ customerId, policies, onClose }: { customerId: string; policies: { id: string; label: string }[]; onClose: () => void }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [policyId, setPolicyId] = useState(policies[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog
      open
      onClose={onClose}
      title="Naloži dokument"
      description="Dokumenti so shranjeni v zasebni shrambi in dostopni samo pooblaščenim."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Prekliči
          </Button>
          <Button
            loading={busy}
            disabled={!file}
            onClick={async () => {
              if (!file || busy) return;
              setBusy(true);
              setError(null);
              try {
                await uploadDocument(file, { customerId, policyId: policyId || null, type: policyId ? "signed_policy" : "other" });
                toast.success("Dokument je naložen.");
                router.refresh();
                onClose();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Naloži
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <FormError message={error} />
        <Field label="Povezava">
          <Select value={policyId} onChange={(e) => setPolicyId(e.target.value)}>
            {policies.map((p) => (
              <option key={p.id} value={p.id}>
                Podpisana polica – {p.label}
              </option>
            ))}
            <option value="">Drug dokument stranke</option>
          </Select>
        </Field>
        <Field label="Datoteka" hint="PDF ali slika, do 25 MB">
          <Input type="file" accept="application/pdf,image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="py-1.5" />
        </Field>
      </div>
    </Dialog>
  );
}

function ArchiveDialog({ open, customer, onClose }: { open: boolean; customer: Customer; onClose: () => void }) {
  const router = useRouter();
  const { submit, pending } = useSubmit();
  const archiving = !customer.archived_at;
  return (
    <ConfirmDialog
      open={open}
      onClose={onClose}
      tone={archiving ? "danger" : "primary"}
      title={archiving ? "Arhiviraj stranko" : "Obnovi stranko"}
      description={archiving ? "Stranka bo skrita iz seznamov. Vsa zgodovina, police in provizije ostanejo nespremenjene. Arhiviranje je mogoče razveljaviti." : "Stranka bo ponovno vidna v seznamih."}
      confirmLabel={archiving ? "Arhiviraj" : "Obnovi"}
      loading={pending}
      onConfirm={async () => {
        const res = await submit(() => setCustomerArchived({ customer_id: customer.id, archived: archiving }));
        if (res?.ok) {
          router.refresh();
          onClose();
        }
      }}
    />
  );
}
