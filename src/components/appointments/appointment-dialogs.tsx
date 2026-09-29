"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog, ConfirmDialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, FormError, Textarea } from "@/components/ui/form";
import { SlotFields, emptySlot, type SlotValue } from "./slot-fields";
import { useSubmit } from "@/components/shared/use-submit";
import { cancelAppointment, scheduleAppointment, updateAppointment } from "@/server/actions/appointments";
import { localParts } from "@/lib/dates";
import type { PersonOption } from "@/server/queries/people";

/** Book a new appointment for an existing customer (also resolves an open follow-up). */
export function ScheduleAppointmentDialog({
  open,
  onClose,
  customerId,
  customerName,
  defaultAgentId,
  agents,
  context,
}: {
  open: boolean;
  onClose: () => void;
  customerId: string;
  customerName: string;
  defaultAgentId?: string | null;
  agents: PersonOption[];
  context?: string;
}) {
  const router = useRouter();
  const { submit, pending, error, fieldErrors } = useSubmit<{ appointment_id: string }>();
  const [slot, setSlot] = useState<SlotValue>(emptySlot(defaultAgentId ?? ""));

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Nov termin"
      description={customerName}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Prekliči
          </Button>
          <Button
            loading={pending}
            onClick={async () => {
              const res = await submit(() => scheduleAppointment({ customer_id: customerId, ...slot }));
              if (res?.ok) {
                router.refresh();
                onClose();
              }
            }}
          >
            Shrani termin
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {context && <p className="rounded-md bg-subtle px-3 py-2 text-sm text-ink-2">{context}</p>}
        <FormError message={error} />
        <SlotFields value={slot} onChange={setSlot} agents={agents} errors={fieldErrors} />
      </div>
    </Dialog>
  );
}

/** Reschedule and/or reassign an open appointment. */
export function EditAppointmentDialog({
  appointment,
  agents,
  onClose,
}: {
  appointment: { id: string; agent_id: string; scheduled_at: string; duration_minutes: number; note: string | null; customerName: string } | null;
  agents: PersonOption[];
  onClose: () => void;
}) {
  return (
    <Dialog open={!!appointment} onClose={onClose} title="Uredi termin" description={appointment?.customerName}>
      {appointment && <EditForm key={appointment.id} appointment={appointment} agents={agents} onClose={onClose} />}
    </Dialog>
  );
}

function EditForm({
  appointment,
  agents,
  onClose,
}: {
  appointment: { id: string; agent_id: string; scheduled_at: string; duration_minutes: number; note: string | null };
  agents: PersonOption[];
  onClose: () => void;
}) {
  const router = useRouter();
  const { submit, pending, error, fieldErrors } = useSubmit();
  const local = localParts(appointment.scheduled_at);
  const [slot, setSlot] = useState<SlotValue>({
    agent_id: appointment.agent_id,
    date: local.date,
    time: local.time,
    duration_minutes: appointment.duration_minutes,
    note: appointment.note ?? "",
  });
  return (
    <div className="flex flex-col gap-4">
      <FormError message={error} />
      <SlotFields value={slot} onChange={setSlot} agents={agents} errors={fieldErrors} />
      <p className="text-xs text-ink-3">Sprememba zastopnika ali časa se zabeleži v zgodovino stranke. Pripis klicatelja ostane nespremenjen.</p>
      <div className="flex justify-end gap-2 border-t border-line pt-4">
        <Button variant="secondary" onClick={onClose}>
          Prekliči
        </Button>
        <Button
          loading={pending}
          onClick={async () => {
            const res = await submit(() => updateAppointment({ appointment_id: appointment.id, ...slot }));
            if (res?.ok) {
              router.refresh();
              onClose();
            }
          }}
        >
          Shrani
        </Button>
      </div>
    </div>
  );
}

export function CancelAppointmentDialog({ appointmentId, onClose }: { appointmentId: string | null; onClose: () => void }) {
  const router = useRouter();
  const { submit, pending, error } = useSubmit();
  const [reason, setReason] = useState("");
  return (
    <ConfirmDialog
      open={!!appointmentId}
      onClose={onClose}
      title="Preklic termina"
      description="Termin ostane v zgodovini kot preklican."
      confirmLabel="Prekliči termin"
      loading={pending}
      onConfirm={async () => {
        const res = await submit(() => cancelAppointment({ appointment_id: appointmentId, reason }));
        if (res?.ok) {
          setReason("");
          router.refresh();
          onClose();
        }
      }}
    >
      <div className="mt-3 flex flex-col gap-2">
        <FormError message={error} />
        <Field label="Razlog" required>
          <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </div>
    </ConfirmDialog>
  );
}
