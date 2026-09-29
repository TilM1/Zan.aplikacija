"use client";

import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import type { ActionResult } from "@/server/workflow";

/**
 * Runs a server action once at a time (prevents double submission),
 * exposes field errors and shows toast feedback.
 */
export function useSubmit<T>() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const inFlight = useRef(false);

  const submit = useCallback(
    async (action: () => Promise<ActionResult<T>>, opts: { toastOnSuccess?: boolean } = {}): Promise<ActionResult<T> | null> => {
      if (inFlight.current) return null;
      inFlight.current = true;
      setPending(true);
      setError(null);
      setFieldErrors({});
      try {
        const res = await action();
        if (res.ok) {
          if (opts.toastOnSuccess !== false && res.message) toast.success(res.message);
        } else {
          setError(res.error);
          setFieldErrors(res.fieldErrors ?? {});
        }
        return res;
      } catch (e) {
        console.error(e);
        setError("Povezava ni uspela. Poskusite znova.");
        return null;
      } finally {
        inFlight.current = false;
        setPending(false);
      }
    },
    [],
  );

  return { submit, pending, error, fieldErrors, setError };
}
