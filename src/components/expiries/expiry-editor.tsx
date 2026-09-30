"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";
import { EXPIRY_CATEGORY_LABELS } from "@/lib/labels";
import type { ExpiryCategory } from "@/types/domain";

export interface ExpiryDraft {
  key: number;
  category: ExpiryCategory | "";
  description: string;
  insurer: string;
  expiry_date: string;
  note: string;
}

export const newExpiryDraft = (key: number): ExpiryDraft => ({ key, category: "", description: "", insurer: "", expiry_date: "", note: "" });
export const filledExpiries = (rows: ExpiryDraft[]) =>
  rows
    .filter((r) => r.category && r.expiry_date)
    .map((r) => ({ category: r.category, description: r.description, insurer: r.insurer, expiry_date: r.expiry_date, note: r.note }));

/** Repeatable rows: what, which insurer, when it expires. */
export function ExpiryEditor({ rows, onChange }: { rows: ExpiryDraft[]; onChange: (rows: ExpiryDraft[]) => void }) {
  const set = (key: number, patch: Partial<ExpiryDraft>) => onChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  return (
    <div className="flex flex-col gap-2">
      {rows.map((r) => (
        <div key={r.key} className="grid grid-cols-2 gap-2 rounded-lg border border-line p-2 sm:grid-cols-[1.2fr_1.4fr_1fr_1fr_auto]">
          <Select value={r.category} onChange={(e) => set(r.key, { category: e.target.value as ExpiryCategory })} aria-label="Vrsta">
            <option value="">Vrsta zavarovanja…</option>
            {Object.entries(EXPIRY_CATEGORY_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
          <Input placeholder="Opis (npr. kasko Golf, hiša)" value={r.description} onChange={(e) => set(r.key, { description: e.target.value })} />
          <Input placeholder="Zavarovalnica" value={r.insurer} onChange={(e) => set(r.key, { insurer: e.target.value })} />
          <Input type="date" value={r.expiry_date} onChange={(e) => set(r.key, { expiry_date: e.target.value })} aria-label="Datum poteka" title="Datum poteka" />
          <button
            type="button"
            onClick={() => onChange(rows.filter((x) => x.key !== r.key))}
            className="grid size-10 place-items-center rounded-lg text-ink-3 hover:bg-danger-soft hover:text-danger"
            aria-label="Odstrani"
          >
            <Trash2 className="size-4" />
          </button>
          <Input className="col-span-2 sm:col-span-5" placeholder="Opomba (neobvezno)" value={r.note} onChange={(e) => set(r.key, { note: e.target.value })} />
        </div>
      ))}
      <Button type="button" variant="secondary" size="sm" className="self-start" onClick={() => onChange([...rows, newExpiryDraft(Math.max(0, ...rows.map((r) => r.key)) + 1)])}>
        <Plus className="size-4" /> Dodaj skadenco
      </Button>
    </div>
  );
}
