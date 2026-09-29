-- =============================================================================
-- Private document storage
--
-- Bucket "documents" is PRIVATE and has no storage.objects policies for
-- anon/authenticated: browsers can never list or read objects directly.
-- Access works only through short-lived signed URLs that the server issues
-- after checking the user's permission on the matching documents row (RLS).
-- Uploads use server-issued signed upload URLs.
--
-- Path convention: customers/<customer_id>/<policy_id|general>/<uuid>-<file>
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'documents',
  'documents',
  false,
  26214400, -- 25 MB
  array['application/pdf', 'image/jpeg', 'image/png', 'image/heic', 'image/webp']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
