"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActor, isAgentLike } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { DOCUMENTS_BUCKET, DOCUMENT_MAX_BYTES as MAX_BYTES, DOCUMENT_MIME_TYPES as ALLOWED } from "@/lib/storage";
import { callWorkflow, runAction, WorkflowError, type ActionResult } from "@/server/workflow";


const uploadSchema = z.object({
  customer_id: z.string().uuid(),
  policy_id: z.string().uuid().nullable(),
  file_name: z.string().trim().min(1).max(200),
  mime_type: z.string().refine((m) => ALLOWED.includes(m), "Dovoljeni so PDF in slike (JPG, PNG, HEIC, WEBP)."),
  size_bytes: z.number().int().positive().max(MAX_BYTES, "Največja velikost datoteke je 25 MB."),
});

/**
 * Step 1: authorize and return a one-time signed upload URL for a private
 * storage path. The browser uploads the file directly to Storage (no size
 * limits of serverless functions), then calls registerDocument.
 */
export async function createDocumentUpload(input: unknown): Promise<ActionResult<{ path: string; token: string }>> {
  return runAction(async () => {
    const { profile } = await requireActor();
    if (!isAgentLike(profile.role)) throw new WorkflowError("Dokumente lahko nalagajo zastopniki in lastnik.");
    const v = uploadSchema.parse(input);

    const supabase = await createClient();
    const { data: customer } = await supabase.from("customers").select("id").eq("id", v.customer_id).maybeSingle();
    if (!customer) throw new WorkflowError("Stranka ne obstaja ali do nje nimate dostopa.");

    const safeName = v.file_name.normalize("NFKD").replace(/[^\w.-]+/g, "_").slice(-100);
    const path = `customers/${v.customer_id}/${v.policy_id ?? "general"}/${randomUUID()}-${safeName}`;
    const { data, error } = await createAdminClient().storage.from(DOCUMENTS_BUCKET).createSignedUploadUrl(path);
    if (error || !data) throw new WorkflowError("Nalaganja ni bilo mogoče pripraviti.");
    return { path, token: data.token };
  });
}

/** Step 2: verify the object exists and register document metadata (+ history event). */
export async function registerDocument(input: unknown): Promise<ActionResult<{ document_id: string }>> {
  return runAction(async () => {
    const { userId } = await requireActor();
    const v = uploadSchema.extend({ path: z.string().min(1), document_type: z.enum(["signed_policy", "other"]) }).parse(input);
    if (!v.path.startsWith(`customers/${v.customer_id}/`)) throw new WorkflowError("Neveljavna pot dokumenta.");

    const admin = createAdminClient();
    const folder = v.path.slice(0, v.path.lastIndexOf("/"));
    const name = v.path.slice(v.path.lastIndexOf("/") + 1);
    const { data: listing } = await admin.storage.from(DOCUMENTS_BUCKET).list(folder, { search: name, limit: 1 });
    if (!listing?.some((o) => o.name === name)) throw new WorkflowError("Datoteka ni bila naložena.");

    const id = await callWorkflow<string>("crm_register_document", {
      p_actor: userId,
      p_customer_id: v.customer_id,
      p_policy_id: v.policy_id,
      p_document_type: v.document_type,
      p_storage_path: v.path,
      p_file_name: v.file_name,
      p_mime_type: v.mime_type,
      p_size_bytes: v.size_bytes,
    });
    revalidatePath(`/customers/${v.customer_id}`);
    return { document_id: id };
  }, "Dokument je naložen.");
}
