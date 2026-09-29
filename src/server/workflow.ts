import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { AuthorizationError } from "@/lib/auth";
import { ZodError } from "zod";

export type ActionResult<T = undefined> =
  | { ok: true; data: T; message?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

export class WorkflowError extends Error {}

/**
 * Call a crm_* workflow function with the service role. Callers MUST pass the
 * verified actor id (from requireActor) as p_actor; the SQL function re-checks
 * the actor's permissions and runs everything in one transaction.
 */
export async function callWorkflow<T = unknown>(fn: string, args: Record<string, unknown>): Promise<T> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc(fn, args as never);
  if (error) {
    // P0001 = business-rule violation with a user-facing message from SQL
    if (error.code === "P0001") throw new WorkflowError(error.message);
    if (error.code === "23505") throw new WorkflowError("Zapis s temi podatki že obstaja.");
    console.error(`[workflow] ${fn} failed`, error);
    throw new Error("Pri shranjevanju je prišlo do napake. Poskusite znova.");
  }
  return data as T;
}

/** Wrap a server action body: converts known errors into ActionResult. */
export async function runAction<T>(fn: () => Promise<T>, message?: string): Promise<ActionResult<T>> {
  try {
    const data = await fn();
    return { ok: true, data, message };
  } catch (e) {
    if (e instanceof ZodError) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of e.issues) {
        const key = issue.path.join(".");
        if (!fieldErrors[key]) fieldErrors[key] = issue.message;
      }
      return { ok: false, error: "Preverite označena polja.", fieldErrors };
    }
    if (e instanceof WorkflowError || e instanceof AuthorizationError) {
      return { ok: false, error: e.message };
    }
    if (e && typeof e === "object" && "digest" in e && String((e as { digest?: string }).digest).startsWith("NEXT_")) {
      throw e; // let Next.js handle redirect()/notFound()
    }
    console.error("[action] unexpected error", e);
    return { ok: false, error: e instanceof Error ? e.message : "Nepričakovana napaka." };
  }
}
