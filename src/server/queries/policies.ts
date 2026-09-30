import "server-only";
import { createClient } from "@/lib/supabase/server";
import { parseSort } from "@/lib/url";

export const POLICY_SORTS = ["policy_date", "product_name", "policy_number", "monthly_premium", "duration_years", "agent_id", "caller_id", "created_at"] as const;
import type { Commission, Customer, DocumentRow, Installment, Policy } from "@/types/domain";

export type PolicyWithCustomer = Policy & { customer: Pick<Customer, "id" | "first_name" | "last_name" | "phone"> };

export interface PolicyFilters {
  q?: string;
  product?: string;
  agent?: string;
  caller?: string;
  from?: string; // date
  to?: string; // date (inclusive)
  sort?: string;
  page: number;
  pageSize: number;
}

export async function listPolicies(f: PolicyFilters) {
  const supabase = await createClient();
  let q = supabase
    .from("policies")
    .select("*, customer:customers!inner(id, first_name, last_name, phone, search_text)", { count: "exact" });
  if (f.q) {
    const term = f.q.toLowerCase().replace(/[%_,()]/g, "");
    // Terms with digits and no spaces are treated as policy numbers, otherwise as customer search
    q = /\d/.test(term) && !/\s/.test(term.trim())
      ? q.ilike("policy_number", `%${term.trim()}%`)
      : q.ilike("customer.search_text", `%${term.trim()}%`);
  }
  if (f.product) q = q.eq("product_id", f.product);
  if (f.agent) q = q.eq("agent_id", f.agent);
  if (f.caller) q = q.eq("caller_id", f.caller);
  if (f.from) q = q.gte("policy_date", f.from);
  if (f.to) q = q.lte("policy_date", f.to);
  const s = parseSort(f.sort, POLICY_SORTS, "-policy_date");
  q = q.order(s.column, { ascending: s.ascending, nullsFirst: false }).order("created_at", { ascending: false }).range((f.page - 1) * f.pageSize, f.page * f.pageSize - 1);
  const { data, count, error } = await q;
  if (error) throw error;
  return { rows: (data ?? []) as PolicyWithCustomer[], total: count ?? 0, sort: s.sort };
}

export async function getPolicyDetail(id: string) {
  const supabase = await createClient();
  const { data: policy } = await supabase
    .from("policies")
    .select("*, customer:customers(id, first_name, last_name, phone, email, address, postal_code, city)")
    .eq("id", id)
    .maybeSingle();
  if (!policy) return null;
  const [commissions, documents] = await Promise.all([
    supabase.from("commissions").select("*, installments:commission_installments(*)").eq("policy_id", id),
    supabase.from("documents").select("id, customer_id, policy_id, document_type, file_name, mime_type, size_bytes, uploaded_by, created_at").eq("policy_id", id).order("created_at", { ascending: false }),
  ]);
  return {
    policy: policy as PolicyWithCustomer & { customer: Customer },
    commissions: (commissions.data ?? []) as (Commission & { installments: Installment[] })[],
    documents: (documents.data ?? []) as DocumentRow[],
  };
}

export interface ProductRow {
  id: string;
  name: string;
  is_active: boolean;
  sort_order: number;
  commission_model: "standard" | "agent_multiplier";
}

export async function getActiveProducts() {
  const supabase = await createClient();
  const { data } = await supabase.from("products").select("id, name, is_active, sort_order, commission_model").eq("is_active", true).order("sort_order");
  return (data ?? []) as ProductRow[];
}

export async function getAllProducts() {
  const supabase = await createClient();
  const { data } = await supabase.from("products").select("id, name, is_active, sort_order, commission_model").order("sort_order");
  return (data ?? []) as ProductRow[];
}
