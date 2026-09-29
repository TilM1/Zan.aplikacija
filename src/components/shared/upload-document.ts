"use client";

import { createBrowserSupabase } from "@/lib/supabase/client";
import { DOCUMENTS_BUCKET } from "@/lib/storage";
import { createDocumentUpload, registerDocument } from "@/server/actions/documents";

/**
 * Upload a document to the private bucket:
 * server authorizes + issues a signed upload URL → browser uploads →
 * server verifies the object and records metadata + history.
 */
export async function uploadDocument(file: File, target: { customerId: string; policyId: string | null; type: "signed_policy" | "other" }) {
  const meta = { customer_id: target.customerId, policy_id: target.policyId, file_name: file.name, mime_type: file.type || "application/pdf", size_bytes: file.size };
  const prep = await createDocumentUpload(meta);
  if (!prep.ok) throw new Error(prep.error);

  const supabase = createBrowserSupabase();
  const { error } = await supabase.storage.from(DOCUMENTS_BUCKET).uploadToSignedUrl(prep.data.path, prep.data.token, file, { contentType: meta.mime_type });
  if (error) throw new Error("Nalaganje datoteke ni uspelo.");

  const reg = await registerDocument({ ...meta, path: prep.data.path, document_type: target.type });
  if (!reg.ok) throw new Error(reg.error);
  return reg.data.document_id;
}
