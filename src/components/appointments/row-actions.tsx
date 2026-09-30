"use client";

import { useState } from "react";
import { Ban, Pencil } from "lucide-react";
import { RecordResultDialog } from "./record-result-dialog";
import { CancelAppointmentDialog, EditAppointmentDialog } from "./appointment-dialogs";
import type { PipelineCard } from "@/components/pipeline/types";
import type { CommissionRates, PersonOption } from "@/server/queries/people";

export function AppointmentRowActions({
  card,
  agents,
  products,
  rates,
}: {
  card: PipelineCard;
  agents: PersonOption[];
  products: { id: string; name: string }[];
  rates: CommissionRates;
}) {
  const [mode, setMode] = useState<"result" | "edit" | "cancel" | null>(null);
  if (!card.canRecord && !card.canEdit) return null;
  return (
    <div className="flex justify-end gap-1">
      {card.canRecord && (
        <button onClick={() => setMode("result")} className="h-8 rounded-md bg-gold px-2.5 text-xs font-semibold text-ink hover:bg-gold-hover">
          Vnesi rezultat
        </button>
      )}
      {card.canEdit && (
        <>
          <button onClick={() => setMode("edit")} className="grid size-8 place-items-center rounded-md border border-line text-ink-3 hover:bg-subtle hover:text-ink" title="Prestavi / prerazporedi" aria-label="Uredi">
            <Pencil className="size-3.5" />
          </button>
          <button onClick={() => setMode("cancel")} className="grid size-8 place-items-center rounded-md border border-line text-ink-3 hover:bg-danger-soft hover:text-danger" title="Prekliči termin" aria-label="Prekliči">
            <Ban className="size-3.5" />
          </button>
        </>
      )}
      <RecordResultDialog
        target={mode === "result" ? { id: card.id, customerId: card.customerId, customerName: card.customerName, scheduledAt: card.scheduledAt, agentId: card.agentId, callerId: card.callerId, callerName: card.callerName ?? undefined } : null}
        agents={agents}
        products={products}
        rates={rates}
        onClose={() => setMode(null)}
      />
      <EditAppointmentDialog
        appointment={mode === "edit" ? { id: card.id, agent_id: card.agentId, scheduled_at: card.scheduledAt, duration_minutes: card.durationMinutes, note: card.note, customerName: card.customerName } : null}
        agents={agents}
        onClose={() => setMode(null)}
      />
      <CancelAppointmentDialog appointmentId={mode === "cancel" ? card.id : null} onClose={() => setMode(null)} />
    </div>
  );
}
