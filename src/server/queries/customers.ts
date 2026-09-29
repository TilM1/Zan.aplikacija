import "server-only";
import { createClient } from "@/lib/supabase/server";
import { parseSort } from "@/lib/url";

export const CUSTOMER_SORTS = [
  "last_name", "phone", "postal_code", "status", "last_result", "consultation_count", "policy_count",
  "next_appointment_at", "current_agent_id", "responsible_caller_id", "created_at", "updated_at",
] as const;
import type {
  ActivityRow, Appointment, CallerFollowup, Commission, CustomerOverview, DocumentRow, Installment, Policy,
} from "@/types/domain";

/**
 * If the term looks like a phone number, return the digits to match against
 * phone_normalized, independent of national (0…) / international (+386, 00386) prefix.
 */
export function searchablePhoneDigits(term: string): string | null {
  const compact = term.replace(/[\s/().-]/g, "");
  if (!/^\+?\d{4,}$/.test(compact)) return null;
  return compact.replace(/^(\+386|00386|0)/, "");
}

export interface CustomerFilters {
  q?: string;
  status?: string;
  archived?: boolean;
  sort?: string;
  page: number;
  pageSize: number;
}

export async function listCustomers(f: CustomerFilters) {
  const supabase = await createClient();
  let q = supabase.from("customer_overview").select("*", { count: "exact" });
  if (f.q) {
    const term = f.q.toLowerCase().replace(/[%_,()]/g, "").trim();
    const phoneDigits = searchablePhoneDigits(term);
    q = phoneDigits ? q.ilike("phone_normalized", `%${phoneDigits}%`) : q.ilike("search_text", `%${term}%`);
  }
  if (f.status) q = q.eq("status", f.status);
  q = f.archived ? q.not("archived_at", "is", null) : q.is("archived_at", null);
  const s = parseSort(f.sort, CUSTOMER_SORTS, "-created_at");
  q = q.order(s.column, { ascending: s.ascending, nullsFirst: false });
  if (s.column === "last_name") q = q.order("first_name", { ascending: s.ascending });
  q = q.order("id").range((f.page - 1) * f.pageSize, f.page * f.pageSize - 1);
  const { data, count, error } = await q;
  if (error) throw error;
  return { rows: (data ?? []) as CustomerOverview[], total: count ?? 0, sort: s.sort };
}

export async function getCustomerDetail(id: string) {
  const supabase = await createClient();
  const { data: customer } = await supabase.from("customer_overview").select("*").eq("id", id).maybeSingle();
  if (!customer) return null;

  const [appointments, policies, documents, activity, followups, commissions] = await Promise.all([
    supabase.from("appointments").select("*").eq("customer_id", id).order("visit_number", { ascending: false }),
    supabase.from("policies").select("*").eq("customer_id", id).order("policy_date", { ascending: false }),
    supabase.from("documents").select("id, customer_id, policy_id, document_type, file_name, mime_type, size_bytes, uploaded_by, created_at").eq("customer_id", id).order("created_at", { ascending: false }),
    supabase.from("activity_log").select("*").eq("customer_id", id).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(300),
    supabase.from("caller_followups").select("*").eq("customer_id", id).order("created_at", { ascending: false }),
    supabase.from("commissions").select("*, installments:commission_installments(*)").in(
      "policy_id",
      // policies are fetched in parallel; commissions RLS limits to own/owner anyway
      (await supabase.from("policies").select("id").eq("customer_id", id)).data?.map((p) => p.id) ?? [],
    ),
  ]);

  return {
    customer: customer as CustomerOverview,
    appointments: (appointments.data ?? []) as Appointment[],
    policies: (policies.data ?? []) as Policy[],
    documents: (documents.data ?? []) as DocumentRow[],
    activity: (activity.data ?? []) as ActivityRow[],
    followups: (followups.data ?? []) as CallerFollowup[],
    commissions: (commissions.data ?? []) as (Commission & { installments: Installment[] })[],
  };
}
