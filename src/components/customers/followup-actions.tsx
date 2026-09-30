"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Field, FormError, Textarea } from "@/components/ui/form";
import { ScheduleAppointmentDialog } from "@/components/appointments/appointment-dialogs";
import { useSubmit } from "@/components/shared/use-submit";
import { closeFollowup } from "@/server/actions/followups";
import type { PersonOption } from "@/server/queries/people";

export function FollowupActions({
  followupId,
  customerId,
  customerName,
  previousAgentId,
  agents,
}: {
  followupId: string;
  customerId: string;
  customerName: string;
  previousAgentId: string;
  agents: PersonOption[];
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"schedule" | "close" | null>(null);
  const [note, setNote] = useState("");
  const { submit, pending, error } = useSubmit();

  return (
    <div className="flex justify-end gap-1.5">
      <Button size="sm" variant="gold" onClick={() => setMode("schedule")}>
        <CalendarPlus className="size-3.5" /> Nov termin
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setMode("close")} title="Zapri brez termina">
        <X className="size-3.5" />
      </Button>
      <ScheduleAppointmentDialog
        open={mode === "schedule"}
        onClose={() => setMode(null)}
        customerId={customerId}
        customerName={customerName}
        defaultAgentId={previousAgentId}
        agents={agents}
        context="Zastopnik je privzeto isti kot pri prejšnjem obisku – lahko izberete drugega."
      />
      <ConfirmDialog
        open={mode === "close"}
        onClose={() => setMode(null)}
        title="Zapri klic nazaj"
        description="Stranka ne želi novega termina ali ni dosegljiva. Stranka in zgodovina ostaneta v CRM."
        confirmLabel="Zapri"
        loading={pending}
        onConfirm={async () => {
          const res = await submit(() => closeFollowup({ followup_id: followupId, note }));
          if (res?.ok) {
            setMode(null);
            router.refresh();
          }
        }}
      >
        <div className="mt-3 flex flex-col gap-2">
          <FormError message={error} />
          <Field label="Razlog" required>
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
      </ConfirmDialog>
    </div>
  );
}
