"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/form";
import { useSubmit } from "@/components/shared/use-submit";
import { setExpiryReminderDays } from "@/server/actions/expiries";
import { cn } from "@/lib/utils";

export function ExpiryDaysForm({ current }: { current: number }) {
  const router = useRouter();
  const { submit, pending, error } = useSubmit();
  const [days, setDays] = useState(current);
  return (
    <div className="flex flex-col gap-3">
      <FormError message={error} />
      <div className="flex flex-wrap items-center gap-2">
        {[7, 14, 21, 30].map((d) => (
          <button key={d} type="button" onClick={() => setDays(d)} className={cn("h-10 rounded-lg border px-4 text-sm", days === d ? "border-gold bg-gold-soft font-semibold" : "border-line-strong hover:border-gold")}>
            {d} dni
          </button>
        ))}
        <label className="flex items-center gap-2 text-sm">
          ali
          <input type="number" min={1} max={120} value={days} onChange={(e) => setDays(Number(e.target.value))} className="h-10 w-20 rounded-lg border border-line-strong px-2 text-sm" />
          dni pred potekom
        </label>
      </div>
      <div>
        <Button
          variant="gold"
          disabled={days === current}
          loading={pending}
          onClick={async () => {
            const res = await submit(() => setExpiryReminderDays({ days }));
            if (res?.ok) router.refresh();
          }}
        >
          Shrani
        </Button>
      </div>
    </div>
  );
}
