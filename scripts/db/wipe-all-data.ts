/**
 * DANGER: permanently deletes ALL business data and ALL users (auth + profiles)
 * of the database in SUPABASE_DB_URL. Schema, migrations and products stay.
 * Meant for resetting staging, or once before go-live.
 *
 *   npm run db:wipe -- --confirm <project-ref>
 *
 * The project ref must match the one in NEXT_PUBLIC_SUPABASE_URL.
 */
import { config } from "dotenv";
import postgres from "postgres";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const dbUrl = process.env.SUPABASE_DB_URL;
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !dbUrl || !key) throw new Error("Set NEXT_PUBLIC_SUPABASE_URL, SUPABASE_DB_URL and SUPABASE_SECRET_KEY in .env.local");
  const ref = new URL(url).hostname.split(".")[0];
  const i = process.argv.indexOf("--confirm");
  if (i === -1 || process.argv[i + 1] !== ref) {
    throw new Error(`Refusing. This deletes ALL data in project "${ref}". Re-run with: npm run db:wipe -- --confirm ${ref}`);
  }

  // Storage objects first (policy documents)
  const admin = createClient(url, key, { auth: { persistSession: false } });
  const sql = postgres(dbUrl, { max: 1, prepare: false, onnotice: () => {} });
  try {
    const objects = await sql<{ name: string }[]>`select name from storage.objects where bucket_id = 'documents'`;
    for (let k = 0; k < objects.length; k += 100) {
      const { error } = await admin.storage.from("documents").remove(objects.slice(k, k + 100).map((o) => o.name));
      if (error) throw error;
    }

    const counts = await sql.begin(async (tx) => {
      await tx`select set_config('crm.allow_demo_purge', 'on', true)`;
      const before = (await tx`select
        (select count(*)::int from public.customers) customers,
        (select count(*)::int from public.policies) policies,
        (select count(*)::int from public.profiles) profiles,
        (select count(*)::int from auth.users) users`)[0];
      await tx`delete from public.activity_log`;
      await tx`delete from public.documents`;
      await tx`delete from public.commission_installments`;
      await tx`delete from public.commissions`;
      await tx`delete from public.policies`;
      await tx`delete from public.caller_followups`;
      await tx`update public.appointments set previous_appointment_id = null`;
      await tx`delete from public.appointments`;
      await tx`delete from public.customers`;
      await tx`delete from public.agent_commission_rates`;
      await tx`delete from public.caller_commission_rates`;
      await tx`delete from public.login_attempts`;
      await tx`delete from public.lead_lists`; // cascades to leads + lead_events
      // Do-not-call numbers are kept on purpose (GDPR objection must survive resets)
      await tx`update public.lead_suppressions set created_by = null`;
      await tx`update public.app_settings set updated_by = null`;
      await tx`delete from public.profiles`;
      await tx`delete from auth.users`;
      return before;
    });
    console.log(`Wiped project ${ref}:`, counts, `+ ${objects.length} stored documents. Products and schema were kept.`);
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
