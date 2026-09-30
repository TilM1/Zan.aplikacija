"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/form";
import { useSubmit } from "@/components/shared/use-submit";
import { setRecallMonths } from "@/server/actions/leads";
import { cn } from "@/lib/utils";

const OPTIONS = [1, 3, 6, 12];

/** How long after "Zavrnjen" a contact reappears in the "Za klic" list. */
export function RecallForm({ current }: { current: number }) {
  const router = useRouter();
  const { submit, pending, error } = useSubmit();
  const [months, setMonths] = useState(current);
  return (
    <div className="flex flex-col gap-3">
      <FormError message={error} />
      <div className="flex flex-wrap items-center gap-2">
        {OPTIONS.map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMonths(m)}
            className={cn("h-10 rounded-lg border px-4 text-sm", months === m ? "border-gold bg-gold-soft font-semibold" : "border-line-strong hover:border-gold")}
          >
            {m === 12 ? "1 leto" : m === 1 ? "1 mesec" : `${m} mesecev`}
          </button>
        ))}
        <label className="flex items-center gap-2 text-sm">
          ali
          <input
            type="number"
            min={1}
            max={60}
            value={months}
            onChange={(e) => setMonths(Number(e.target.value))}
            className="h-10 w-20 rounded-lg border border-line-strong px-2 text-sm"
          />
          mesecev
        </label>
      </div>
      <div>
        <Button
          variant="gold"
          disabled={months === current}
          loading={pending}
          onClick={async () => {
            const res = await submit(() => setRecallMonths({ months }));
            if (res?.ok) router.refresh();
          }}
        >
          Shrani
        </Button>
      </div>
      <p className="text-xs text-ink-3">Velja za kontakte, ki bodo zavrnjeni od zdaj naprej. Že zavrnjeni obdržijo svoj datum ponovnega klica.</p>
    </div>
  );
}
