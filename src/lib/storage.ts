/** Private Supabase Storage bucket for policy documents (see migration 20260929120300). */
export const DOCUMENTS_BUCKET = "documents";
export const DOCUMENT_MAX_BYTES = 25 * 1024 * 1024;
export const DOCUMENT_MIME_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/heic", "image/webp"];
/** Signed download URLs are short-lived. */
export const SIGNED_URL_TTL_SECONDS = 60;
