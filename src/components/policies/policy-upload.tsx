"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Upload } from "lucide-react";
import { uploadDocument } from "@/components/shared/upload-document";

export function PolicyUpload({ customerId, policyId }: { customerId: string; policyId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <label className="flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-line-strong px-3 py-2 text-sm text-ink-2 hover:bg-subtle">
      <Upload className="size-4" />
      {busy ? "Nalagam…" : "Naloži podpisano polico"}
      <input
        type="file"
        accept="application/pdf,image/*"
        className="sr-only"
        disabled={busy}
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          setBusy(true);
          try {
            await uploadDocument(file, { customerId, policyId, type: "signed_policy" });
            toast.success("Dokument je naložen.");
            router.refresh();
          } catch (err) {
            toast.error((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      />
    </label>
  );
}
