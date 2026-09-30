"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { FormError } from "@/components/ui/form";
import { useSubmit } from "@/components/shared/use-submit";
import { purgeBackup, restoreCustomer, revertStorno } from "@/server/actions/storno";

export function BackupActions({ id, kind, restored, customerId }: { id: string; kind: "customer_deleted" | "policy_storno"; restored: boolean; customerId: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<null | "restore" | "purge">(null);
  const { submit, pending, error } = useSubmit();

  if (restored) {
    return (
      <a href={`/customers/${customerId}`} className="text-xs font-medium text-brand hover:underline">
        Odpri stranko
      </a>
    );
  }
  return (
    <div className="flex justify-end gap-1.5">
      <Button size="sm" variant="secondary" onClick={() => setMode("restore")}>
        {kind === "customer_deleted" ? "Obnovi stranko" : "Razveljavi storno"}
      </Button>
      {kind === "customer_deleted" && (
        <Button size="sm" variant="ghost" className="text-danger" onClick={() => setMode("purge")}>
          Trajno izbriši
        </Button>
      )}
      <ConfirmDialog
        open={mode === "restore"}
        onClose={() => setMode(null)}
        tone="primary"
        title={kind === "customer_deleted" ? "Obnovi stranko" : "Razveljavi storno"}
        description={
          kind === "customer_deleted"
            ? "Stranka se vrne z vsemi termini, policami, provizijami, dokumenti in zgodovino – točno tako, kot je bila pred izbrisom."
            : "Polica postane spet aktivna, preklicani obroki se vrnejo med načrtovana izplačila, odbitki se odstranijo. Možno le, če odbitek še ni obračunan."
        }
        confirmLabel={kind === "customer_deleted" ? "Obnovi" : "Razveljavi"}
        loading={pending}
        onConfirm={async () => {
          const res = await submit(() => (kind === "customer_deleted" ? restoreCustomer({ backup_id: id }) : revertStorno({ backup_id: id })));
          if (res?.ok) {
            setMode(null);
            router.refresh();
          }
        }}
      >
        <FormError message={error} />
      </ConfirmDialog>
      <ConfirmDialog
        open={mode === "purge"}
        onClose={() => setMode(null)}
        title="Trajno izbriši varnostno kopijo"
        description="Podatki stranke bodo nepovratno izbrisani (npr. na zahtevo stranke po GDPR). Obnova ne bo več mogoča."
        confirmLabel="Trajno izbriši"
        loading={pending}
        onConfirm={async () => {
          const res = await submit(() => purgeBackup({ backup_id: id }));
          if (res?.ok) {
            setMode(null);
            router.refresh();
          }
        }}
      >
        <FormError message={error} />
      </ConfirmDialog>
    </div>
  );
}
