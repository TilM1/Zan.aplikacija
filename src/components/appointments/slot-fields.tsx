"use client";

import { Field, Input, Select, Textarea } from "@/components/ui/form";
import type { PersonOption } from "@/server/queries/people";

export interface SlotValue {
  agent_id: string;
  date: string;
  time: string;
  duration_minutes: number;
  note: string;
}

export const emptySlot = (agentId = ""): SlotValue => ({ agent_id: agentId, date: "", time: "", duration_minutes: 60, note: "" });

/** Agent + date + time + duration + note — shared by every "book an appointment" form. */
export function SlotFields({
  value,
  onChange,
  agents,
  errors = {},
  prefix = "",
  agentLabel = "Zastopnik",
  noteLabel = "Opomba za zastopnika",
}: {
  value: SlotValue;
  onChange: (v: SlotValue) => void;
  agents: PersonOption[];
  errors?: Record<string, string>;
  prefix?: string;
  agentLabel?: string;
  noteLabel?: string;
}) {
  const set = <K extends keyof SlotValue>(k: K, v: SlotValue[K]) => onChange({ ...value, [k]: v });
  const err = (k: string) => errors[`${prefix}${k}`];
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-6">
      <Field label={agentLabel} required error={err("agent_id")} className="sm:col-span-6">
        <Select value={value.agent_id} onChange={(e) => set("agent_id", e.target.value)} aria-invalid={!!err("agent_id")}>
          <option value="">Izberite zastopnika…</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Datum" required error={err("date")} className="sm:col-span-2">
        <Input type="date" value={value.date} onChange={(e) => set("date", e.target.value)} aria-invalid={!!err("date")} />
      </Field>
      <Field label="Ura" required error={err("time")} className="sm:col-span-2">
        <Input type="time" step={300} value={value.time} onChange={(e) => set("time", e.target.value)} aria-invalid={!!err("time")} />
      </Field>
      <Field label="Trajanje" className="sm:col-span-2">
        <Select value={value.duration_minutes} onChange={(e) => set("duration_minutes", Number(e.target.value))}>
          {[30, 45, 60, 90, 120].map((m) => (
            <option key={m} value={m}>
              {m} min
            </option>
          ))}
        </Select>
      </Field>
      <Field label={noteLabel} error={err("note")} className="sm:col-span-6">
        <Textarea rows={2} value={value.note} onChange={(e) => set("note", e.target.value)} />
      </Field>
    </div>
  );
}
