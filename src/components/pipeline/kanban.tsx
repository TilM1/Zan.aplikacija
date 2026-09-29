"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { CalendarClock, MapPin, Pencil, Phone, Repeat, UserRound } from "lucide-react";
import { RecordResultDialog, type ResultTarget } from "@/components/appointments/record-result-dialog";
import { EditAppointmentDialog } from "@/components/appointments/appointment-dialogs";
import { RESULT_LABELS } from "@/lib/labels";
import { formatDate, formatTime, formatWeekday } from "@/lib/dates";
import { cn } from "@/lib/utils";
import type { ConsultationResult } from "@/types/domain";
import type { CommissionRates, PersonOption } from "@/server/queries/people";
import type { PipelineCard } from "./types";

type ColumnKey = "upcoming" | "pending" | ConsultationResult;

const COLUMNS: { key: ColumnKey; title: string; hint: string; accent: string }[] = [
  { key: "upcoming", title: "Prihajajoči termini", hint: "Dogovorjeni termini", accent: "bg-info" },
  { key: "pending", title: "Čaka na rezultat", hint: "Termin je minil – vnesite rezultat", accent: "bg-warning" },
  { key: "A1", title: "A1 · Uspešno", hint: "Sklenjene police", accent: "bg-success" },
  { key: "A", title: "A · Nov termin", hint: "Svetovanje se nadaljuje", accent: "bg-info" },
  { key: "B", title: "B · Ni bilo doma", hint: "Vrnjeno klicatelju", accent: "bg-warning" },
  { key: "A0", title: "A0 · Neuspešno", hint: "Izgubljeno", accent: "bg-danger" },
];

export function KanbanBoard({
  cards,
  agents,
  products,
  rates,
  now,
}: {
  cards: PipelineCard[];
  agents: PersonOption[];
  products: { id: string; name: string }[];
  rates: CommissionRates;
  now: string;
}) {
  const [target, setTarget] = useState<{ card: PipelineCard; result?: ConsultationResult } | null>(null);
  const [editing, setEditing] = useState<PipelineCard | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<ColumnKey | null>(null);

  const grouped = useMemo(() => {
    const g: Record<ColumnKey, PipelineCard[]> = { upcoming: [], pending: [], A: [], A0: [], A1: [], B: [] };
    for (const c of cards) {
      if (c.status === "scheduled") g[c.scheduledAt > now ? "upcoming" : "pending"].push(c);
      else if (c.status === "completed" && c.result) g[c.result].push(c);
    }
    g.upcoming.sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
    g.pending.sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
    return g;
  }, [cards, now]);

  const dragged = dragId ? cards.find((c) => c.id === dragId) : null;
  const toTarget = (c: PipelineCard): ResultTarget => ({
    id: c.id,
    customerId: c.customerId,
    customerName: c.customerName,
    scheduledAt: c.scheduledAt,
    agentId: c.agentId,
    callerId: c.callerId,
    callerName: c.callerName ?? undefined,
  });

  return (
    <>
      <div className="-mx-4 overflow-x-auto px-4 pb-2 lg:-mx-6 lg:px-6">
        <div className="grid min-w-[1200px] grid-cols-6 gap-3">
          {COLUMNS.map((col) => {
            const isResultCol = col.key !== "upcoming" && col.key !== "pending";
            const droppable = isResultCol && !!dragged?.canRecord;
            return (
              <section
                key={col.key}
                onDragOver={(e) => {
                  if (droppable) {
                    e.preventDefault();
                    setOverCol(col.key);
                  }
                }}
                onDragLeave={() => setOverCol((c) => (c === col.key ? null : c))}
                onDrop={(e) => {
                  e.preventDefault();
                  setOverCol(null);
                  if (droppable && dragged) setTarget({ card: dragged, result: col.key as ConsultationResult });
                  setDragId(null);
                }}
                className={cn(
                  "flex max-h-[calc(100dvh-13rem)] min-h-64 flex-col rounded-lg border bg-subtle/70",
                  overCol === col.key ? "border-brand bg-brand-soft" : "border-line",
                  droppable && overCol !== col.key && "border-dashed border-line-strong",
                )}
              >
                <header className="flex items-center gap-2 border-b border-line px-3 py-2.5">
                  <span className={cn("size-2 rounded-full", col.accent)} />
                  <h2 className="flex-1 truncate text-[13px] font-semibold">{col.title}</h2>
                  <span className="rounded bg-surface px-1.5 text-xs text-ink-3 tabular">{grouped[col.key].length}</span>
                </header>
                <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-2">
                  {grouped[col.key].length === 0 && <p className="px-1 py-6 text-center text-xs text-ink-3">{col.hint}</p>}
                  {grouped[col.key].map((c) => (
                    <Card
                      key={c.id}
                      card={c}
                      overdue={col.key === "pending"}
                      onDragStart={() => setDragId(c.id)}
                      onDragEnd={() => {
                        setDragId(null);
                        setOverCol(null);
                      }}
                      onRecord={() => setTarget({ card: c })}
                      onEdit={() => setEditing(c)}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      </div>
      <p className="mt-2 text-xs text-ink-3">Namig: kartico odprtega termina povlecite v stolpec rezultata ali kliknite »Rezultat«.</p>

      <RecordResultDialog
        target={target ? toTarget(target.card) : null}
        initialResult={target?.result}
        agents={agents}
        products={products}
        rates={rates}
        onClose={() => setTarget(null)}
      />
      <EditAppointmentDialog
        appointment={
          editing
            ? { id: editing.id, agent_id: editing.agentId, scheduled_at: editing.scheduledAt, duration_minutes: editing.durationMinutes, note: editing.note, customerName: editing.customerName }
            : null
        }
        agents={agents}
        onClose={() => setEditing(null)}
      />
    </>
  );
}

function Card({
  card,
  overdue,
  onDragStart,
  onDragEnd,
  onRecord,
  onEdit,
}: {
  card: PipelineCard;
  overdue: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onRecord: () => void;
  onEdit: () => void;
}) {
  return (
    <article
      draggable={card.canRecord}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      className={cn(
        "group rounded-md border bg-surface p-2.5 text-[13px] shadow-xs transition-shadow hover:shadow-sm",
        overdue ? "border-warning/40" : "border-line",
        card.canRecord && "cursor-grab active:cursor-grabbing",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <Link href={`/customers/${card.customerId}`} className="min-w-0 font-medium text-ink hover:text-brand hover:underline">
          <span className="block truncate">{card.customerName}</span>
        </Link>
        {card.visitNumber > 1 && (
          <span className="flex shrink-0 items-center gap-0.5 rounded bg-accent-soft px-1 text-[11px] font-medium text-accent" title={`${card.visitNumber}. obisk`}>
            <Repeat className="size-3" />
            {card.visitNumber}.
          </span>
        )}
      </div>
      <div className="mt-1.5 flex flex-col gap-0.5 text-xs text-ink-2">
        <span className={cn("flex items-center gap-1.5", overdue && "font-medium text-warning")}>
          <CalendarClock className="size-3.5 shrink-0 text-ink-3" />
          {formatWeekday(card.scheduledAt)} {formatDate(card.scheduledAt)} · {formatTime(card.scheduledAt)}
        </span>
        <span className="flex items-center gap-1.5 truncate">
          <MapPin className="size-3.5 shrink-0 text-ink-3" />
          <span className="truncate">
            {card.location}
            {card.postalCode ? `, ${card.postalCode}` : ""} {card.city ?? ""}
          </span>
        </span>
        <a href={`tel:${card.phone}`} className="flex items-center gap-1.5 hover:text-brand">
          <Phone className="size-3.5 shrink-0 text-ink-3" />
          {card.phone}
        </a>
        <span className="flex items-center gap-1.5 truncate text-ink-3">
          <UserRound className="size-3.5 shrink-0" />
          <span className="truncate">
            {card.agentName}
            {card.callerName ? ` · klic: ${card.callerName}` : ""}
          </span>
        </span>
      </div>
      {card.result && (
        <p className="mt-1.5 text-[11px] text-ink-3">
          {RESULT_LABELS[card.result].short} – {RESULT_LABELS[card.result].label}
        </p>
      )}
      {(card.canRecord || card.canEdit) && (
        <div className="mt-2 flex gap-1.5">
          {card.canRecord && (
            <button onClick={onRecord} className="h-7 flex-1 rounded border border-brand/30 bg-brand-soft text-xs font-medium text-brand hover:bg-brand hover:text-white">
              Rezultat
            </button>
          )}
          {card.canEdit && (
            <button onClick={onEdit} className="grid h-7 w-7 place-items-center rounded border border-line text-ink-3 hover:bg-subtle hover:text-ink" aria-label="Uredi termin" title="Prestavi / prerazporedi">
              <Pencil className="size-3.5" />
            </button>
          )}
        </div>
      )}
    </article>
  );
}
