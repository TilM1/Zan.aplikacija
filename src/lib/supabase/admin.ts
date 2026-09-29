import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

let adminClient: SupabaseClient | null = null;

/**
 * Service-role client. SERVER ONLY — bypasses RLS.
 * Used exclusively to call crm_* workflow functions (which re-check the actor's
 * permissions), for Auth admin operations and for Storage signing.
 */
export function createAdminClient() {
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("Missing SUPABASE_SECRET_KEY (server-only). See .env.example.");
  adminClient ??= createClient(env.supabaseUrl, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return adminClient;
}
