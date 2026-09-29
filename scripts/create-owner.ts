/**
 * Bootstrap the first (real) Owner account — needed once per environment,
 * because only an Owner can create employees in the app.
 *
 *   npm run create-owner -- owner@company.si "Ime" "Priimek" [15]
 *
 * Uses NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SECRET_KEY from .env.local.
 * Prints a generated initial password; change it after first login (Profil).
 */
import { config } from "dotenv";
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

async function main() {
  const [email, firstName, lastName, rate] = process.argv.slice(2);
  if (!email || !firstName || !lastName) throw new Error('Usage: npm run create-owner -- email "First" "Last" [ratePercent]');
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY in .env.local");

  const admin = createClient(url, key, { auth: { persistSession: false } });
  // Temporary password (letters + digits); must be changed at first login (enforced by RLS)
  const password = `${randomBytes(9).toString("base64url").replace(/[^A-Za-z]/g, "x")}${Math.floor(1000 + Math.random() * 9000)}`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { app: "zan_crm", must_change_password: true },
  });
  if (error || !data.user) throw error ?? new Error("createUser failed");

  const { error: pErr } = await admin.from("profiles").insert({ id: data.user.id, first_name: firstName, last_name: lastName, email: email.toLowerCase(), role: "owner" });
  if (pErr) {
    await admin.auth.admin.deleteUser(data.user.id);
    throw pErr;
  }
  if (rate) {
    const { error: rErr } = await admin.from("agent_commission_rates").insert({ agent_id: data.user.id, rate_percent: Number(rate.replace(",", ".")), set_by: data.user.id });
    if (rErr) throw rErr;
  }
  console.log(`Owner created: ${email}\nTemporary password: ${password}\nA new password must be set at the first login.`);
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
