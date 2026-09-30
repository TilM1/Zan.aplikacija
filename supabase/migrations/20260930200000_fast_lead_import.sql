-- =============================================================================
-- Faster call-list import
--  * The owner's browser sends chunks directly to Supabase (no Vercel hop),
--    via crm_import_leads_as_owner (checks auth.uid() is an active owner).
--  * Chunks can run in parallel: no long lock on the list row; counters are
--    updated atomically at the end of each chunk.
--  * Temp table is dropped defensively (pooled connections).
-- =============================================================================

create or replace function public.crm_import_leads(p_actor uuid, p_list_id uuid, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.lead_list_status;
  v_total integer;
  v_valid integer;
  v_suppressed integer;
  v_inserted integer;
begin
  perform public.crm_require_owner(p_actor);
  select status into v_status from public.lead_lists where id = p_list_id;
  if v_status is null or v_status <> 'importing' then
    perform public.crm_fail('Seznam ne obstaja ali uvoz ni več odprt.');
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 5000 then
    perform public.crm_fail('Neveljaven paket vrstic.');
  end if;

  drop table if exists pg_temp.tmp_import;
  create temporary table tmp_import on commit drop as
  select r.row_number, left(btrim(r.name), 300) as name, left(btrim(r.phone), 40) as phone,
         public.crm_normalize_phone(r.phone) as pn,
         nullif(left(btrim(r.street), 300), '') as street, nullif(left(btrim(r.postal_code), 20), '') as postal_code,
         nullif(left(btrim(r.city), 120), '') as city, nullif(left(btrim(r.activity), 300), '') as activity,
         nullif(left(btrim(r.tax_number), 40), '') as tax_number, nullif(lower(left(btrim(r.email), 200)), '') as email,
         coalesce(r.extra, '{}'::jsonb) as extra
  from jsonb_to_recordset(p_rows) as r(row_number integer, name text, phone text, street text, postal_code text,
                                       city text, activity text, tax_number text, email text, extra jsonb);

  select count(*) into v_total from tmp_import;
  delete from tmp_import where pn is null or length(pn) < 8 or coalesce(name, '') = '';
  select count(*) into v_valid from tmp_import;
  delete from tmp_import t using public.lead_suppressions s where s.phone_normalized = t.pn;
  get diagnostics v_suppressed = row_count;

  with ins as (
    insert into public.leads (list_id, row_number, name, phone, phone_normalized, street, postal_code, city, activity,
                              tax_number, email, extra, existing_customer_id)
    select distinct on (t.pn) p_list_id, t.row_number, t.name, t.phone, t.pn, t.street, t.postal_code, t.city, t.activity,
           t.tax_number, t.email, t.extra,
           (select c.id from public.customers c where c.phone_normalized = t.pn limit 1)
    from tmp_import t
    order by t.pn, t.row_number
    on conflict (phone_normalized) do nothing
    returning 1
  )
  select count(*) into v_inserted from ins;

  update public.lead_lists
     set imported_count = imported_count + v_inserted,
         skipped_invalid = skipped_invalid + (v_total - v_valid),
         skipped_suppressed = skipped_suppressed + v_suppressed,
         skipped_duplicates = skipped_duplicates + (v_valid - v_suppressed - v_inserted)
   where id = p_list_id;

  return jsonb_build_object('inserted', v_inserted, 'invalid', v_total - v_valid, 'suppressed', v_suppressed,
                            'duplicates', v_valid - v_suppressed - v_inserted);
end;
$$;

-- Browser-callable wrapper: the signed-in user must be an active owner
-- (temporary-password sessions are rejected via crm_current_role()).
create or replace function public.crm_import_leads_as_owner(p_list_id uuid, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(public.crm_current_role()::text, '') <> 'owner' then
    perform public.crm_fail('Uvoz lahko izvede samo lastnik.');
  end if;
  return public.crm_import_leads(auth.uid(), p_list_id, p_rows);
end;
$$;

revoke execute on function public.crm_import_leads(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.crm_import_leads(uuid, uuid, jsonb) to service_role;
revoke execute on function public.crm_import_leads_as_owner(uuid, jsonb) from public, anon;
grant execute on function public.crm_import_leads_as_owner(uuid, jsonb) to authenticated, service_role;
