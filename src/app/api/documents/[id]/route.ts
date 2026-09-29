import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { SIGNED_URL_TTL_SECONDS } from "@/lib/storage";
import { isUuid } from "@/lib/url";

/**
 * Private document access: the documents row is read through RLS (so only
 * permitted users get it), then a short-lived signed URL is issued.
 * No permanent public URLs exist for policy documents.
 */
export async function GET(_req: Request, ctx: RouteContext<"/api/documents/[id]">) {
  const session = await getSession();
  if (!session || session.mustChangePassword) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const supabase = await createClient();
  const { data: doc } = await supabase.from("documents").select("storage_bucket, storage_path, file_name").eq("id", id).maybeSingle();
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data, error } = await createAdminClient()
    .storage.from(doc.storage_bucket)
    .createSignedUrl(doc.storage_path, SIGNED_URL_TTL_SECONDS, { download: false });
  if (error || !data) return NextResponse.json({ error: "Unavailable" }, { status: 502 });

  const res = NextResponse.redirect(data.signedUrl, 302);
  res.headers.set("Cache-Control", "private, no-store");
  return res;
}
