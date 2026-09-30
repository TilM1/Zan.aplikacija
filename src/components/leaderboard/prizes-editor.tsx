"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, FormError, Input } from "@/components/ui/form";
import { useSubmit } from "@/components/shared/use-submit";
import { setLeaderboardPrizes } from "@/server/actions/leaderboard";

export function PrizesEditor({ month, monthLabel, agent, caller }: { month: string; monthLabel: string; agent: string | null; caller: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ agent_prize: agent ?? "", caller_prize: caller ?? "" });
  const { submit, pending, error } = useSubmit();
  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <Pencil className="size-4" /> Uredi nagrade
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        size="sm"
        title="Nagrade meseca"
        description={monthLabel}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Prekliči
            </Button>
            <Button
              variant="gold"
              loading={pending}
              onClick={async () => {
                const res = await submit(() => setLeaderboardPrizes({ month, ...v }));
                if (res?.ok) {
                  setOpen(false);
                  router.refresh();
                }
              }}
            >
              Shrani
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <FormError message={error} />
          <Field label="Nagrada za najboljšega zastopnika">
            <Input value={v.agent_prize} onChange={(e) => setV({ ...v, agent_prize: e.target.value })} placeholder="npr. Večerja za dva v restavraciji …" />
          </Field>
          <Field label="Nagrada za najboljšega klicatelja">
            <Input value={v.caller_prize} onChange={(e) => setV({ ...v, caller_prize: e.target.value })} placeholder="npr. Darilni bon 100 €" />
          </Field>
        </div>
      </Dialog>
    </>
  );
}
