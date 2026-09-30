"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, FormError, Input, Textarea } from "@/components/ui/form";
import { useSubmit } from "@/components/shared/use-submit";
import { addExpiries, updateExpiry } from "@/server/actions/expiries";
import { addDays, todayIso } from "@/lib/dates";
import { YEARLY_EXPIRY_CATEGORIES } from "@/lib/labels";
import { ExpiryEditor, filledExpiries, newExpiryDraft, type ExpiryDraft } from "./expiry-editor";
import { cn } from "@/lib/utils";

type Mode = null | "done" | "snooze" | "dismissed";

export function ExpiryActions({ id, category }: { id: string; category: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(null);
  const [outcome, setOutcome] = useState("");
  const [repeat, setRepeat] = useState(YEARLY_EXPIRY_CATEGORIES.has(category));
  const [snooze, setSnooze] = useState(addDays(todayIso(), 7));
  const { submit, pending, error } = useSubmit();

  const save = async () => {
    const res = await submit(() =>
      updateExpiry({
        expiry_id: id,
        status: mode === "snooze" ? "open" : mode,
        outcome,
        snooze_until: mode === "snooze" ? snooze : null,
        repeat_next_year: mode === "done" && repeat,
      }),
    );
    if (res?.ok) {
      setMode(null);
      setOutcome("");
      router.refresh();
    }
  };

  return (
    <div className="flex justify-end gap-1">
      <Button size="sm" variant="gold" onClick={() => setMode("done")}>
        Urejeno
      </Button>
      <Button size="sm" variant="secondary" onClick={() => setMode("snooze")}>
        Odloži
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setMode("dismissed")} title="Ni več aktualno">
        Ni aktualno
      </Button>
      <Dialog
        open={!!mode}
        onClose={() => setMode(null)}
        size="sm"
        title={mode === "done" ? "Skadenca urejena" : mode === "snooze" ? "Odloži opomnik" : "Ni več aktualno"}
        footer={
          <>
            <Button variant="secondary" onClick={() => setMode(null)}>
              Prekliči
            </Button>
            <Button variant="gold" loading={pending} onClick={save}>
              Shrani
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <FormError message={error} />
          {mode === "snooze" && (
            <>
              <div className="flex flex-wrap gap-1.5">
                {[3, 7, 14].map((d) => {
                  const v = addDays(todayIso(), d);
                  return (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setSnooze(v)}
                      className={cn("rounded-lg border px-3 py-1.5 text-sm", snooze === v ? "border-gold bg-gold-soft font-semibold" : "border-line hover:border-gold")}
                    >
                      Čez {d} dni
                    </button>
                  );
                })}
              </div>
              <Field label="Opomni me ponovno">
                <Input type="date" min={todayIso()} value={snooze} onChange={(e) => setSnooze(e.target.value)} />
              </Field>
            </>
          )}
          <Field label={mode === "done" ? "Kaj je bilo dogovorjeno?" : "Opomba"}>
            <Textarea rows={2} value={outcome} onChange={(e) => setOutcome(e.target.value)} placeholder={mode === "done" ? "npr. Podpisal kasko pri nas / ostaja pri svoji zavarovalnici" : ""} />
          </Field>
          {mode === "done" && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-4 accent-[#c6a24b]" checked={repeat} onChange={(e) => setRepeat(e.target.checked)} />
              Opomni me spet čez 1 leto (naslednja skadenca)
            </label>
          )}
        </div>
      </Dialog>
    </div>
  );
}

export function AddExpiriesButton({ customerId }: { customerId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<ExpiryDraft[]>([newExpiryDraft(1)]);
  const { submit, pending, error } = useSubmit<number>();
  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        Dodaj skadenco
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        size="lg"
        title="Skadence stranke"
        description="Kdaj potečejo stranki druga zavarovanja? Opomnik za klic dobite pred potekom."
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Prekliči
            </Button>
            <Button
              variant="gold"
              loading={pending}
              disabled={filledExpiries(rows).length === 0}
              onClick={async () => {
                const res = await submit(() => addExpiries({ customer_id: customerId, items: filledExpiries(rows) }));
                if (res?.ok) {
                  setOpen(false);
                  setRows([newExpiryDraft(1)]);
                  router.refresh();
                }
              }}
            >
              Shrani
            </Button>
          </>
        }
      >
        <FormError message={error} />
        <ExpiryEditor rows={rows} onChange={setRows} />
      </Dialog>
    </>
  );
}
