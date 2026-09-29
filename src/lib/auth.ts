import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Profile, Role } from "@/types/domain";

export interface Session {
  userId: string;
  profile: Profile;
}

/** Verified session + active CRM profile, or null. Cached per request. */
export const getSession = cache(async (): Promise<Session | null> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) return null;
  const { data: profile } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle<Profile>();
  if (!profile || !profile.is_active) return null;
  return { userId, profile };
});

/** For pages/layouts: redirect when not signed in or role not allowed. */
export async function requireSession(roles?: Role[]): Promise<Session> {
  const session = await getSession();
  if (!session) redirect("/login?reason=noaccess");
  if (roles && !roles.includes(session.profile.role)) redirect("/dashboard");
  return session;
}

export class AuthorizationError extends Error {}

/** For server actions / route handlers: throw instead of redirecting. */
export async function requireActor(roles?: Role[]): Promise<Session> {
  const session = await getSession();
  if (!session) throw new AuthorizationError("Seja je potekla. Prijavite se znova.");
  if (roles && !roles.includes(session.profile.role)) throw new AuthorizationError("Za to dejanje nimate pravic.");
  return session;
}

/** Owner is also an Agent: anyone who can hold appointments/sell policies. */
export function isAgentLike(role: Role): boolean {
  return role === "agent" || role === "owner";
}

export function fullName(p: { first_name: string; last_name: string } | null | undefined): string {
  return p ? `${p.first_name} ${p.last_name}` : "–";
}
