"use client";

import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto mt-16 max-w-md rounded-lg border border-line bg-surface p-6 text-center">
      <AlertTriangle className="mx-auto size-6 text-warning" />
      <h1 className="mt-3 text-base font-semibold">Stran se ni naložila</h1>
      <p className="mt-1 text-sm text-ink-3">Prišlo je do napake. Poskusite znova ali osvežite stran.</p>
      {error.digest && <p className="mt-2 font-mono text-xs text-ink-3">Koda: {error.digest}</p>}
      <Button className="mt-4" onClick={reset}>
        Poskusi znova
      </Button>
    </div>
  );
}
