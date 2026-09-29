"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

async function clientIp(): Promise<string | null> {
  const h = await headers();
  return h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
}

export interface SignInState {
  error?: string;
}

export async function signIn(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const parsed = z
    .object({ email: z.email(), password: z.string().min(1) })
    .safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) return { error: "Vnesite e-pošto in geslo." };

  // Brute-force protection: max 5 failures per e-mail / 30 per IP in 15 minutes
  const admin = createAdminClient();
  const ip = await clientIp();
  const email = parsed.data.email.toLowerCase();
  const { data: allowed } = await admin.rpc("crm_login_allowed", { p_email: email, p_ip: ip });
  if (allowed === false) return { error: "Preveč neuspešnih poskusov prijave. Poskusite znova čez 15 minut." };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password: parsed.data.password });
  await admin.rpc("crm_login_record", { p_email: email, p_ip: ip, p_success: !error && !!data.user });
  if (error || !data.user) return { error: "Napačna e-pošta ali geslo." };

  const { data: profile } = await supabase.from("profiles").select("is_active").eq("id", data.user.id).maybeSingle();
  if (!profile?.is_active) {
    await supabase.auth.signOut();
    return { error: "Vaš račun nima aktivnega dostopa do CRM. Obrnite se na lastnika." };
  }
  if ((data.user.app_metadata as { must_change_password?: boolean })?.must_change_password) redirect("/set-password");
  redirect("/dashboard");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
