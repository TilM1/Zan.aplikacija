import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { normalizePhone } from "@/lib/phone";

export interface DuplicateMatch {
  id: string | null; // null when the user may not see that customer
  label: string;
}

/** Existing active customers with the same phone or e-mail. Hides names the user may not see. */
export async function findDuplicates(phone: string, email: string): Promise<DuplicateMatch[]> {
  const admin = createAdminClient();
  const normalized = normalizePhone(phone) ?? "";
  const filters = [`phone_normalized.eq.${normalized}`];
  if (email) filters.push(`email.eq.${email}`);
  const { data } = await admin
    .from("customers")
    .select("id, first_name, last_name")
    .or(filters.join(","))
    .is("archived_at", null)
    .limit(5);
  if (!data?.length) return [];

  const supabase = await createClient();
  const { data: visible } = await supabase.from("customers").select("id").in("id", data.map((d) => d.id));
  const visibleIds = new Set((visible ?? []).map((r) => r.id));
  return data.map((d) =>
    visibleIds.has(d.id)
      ? { id: d.id, label: `${d.first_name} ${d.last_name}` }
      : { id: null, label: "Stranka z enako telefonsko številko ali e-pošto že obstaja (dodeljena drugemu sodelavcu)." },
  );
}
