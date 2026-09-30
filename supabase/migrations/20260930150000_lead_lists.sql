-- =============================================================================
-- Call lists ("klicni seznami"): Owner imports Excel/CSV contact lists,
-- Callers work through them (search, filter, statuses, comments).
--
--   lead_lists   one row per imported file ("mapa"), optionally assigned to a caller
--   leads        contacts (unique per phone number across all lists)
--   lead_events  append-only call/status/comment history
--   lead_suppressions  "do not call" phone numbers (GDPR objection) — survive list deletion
--   app_settings owner-configurable settings (e.g. recall period after rejection)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Phone normalisation (Slovenian defaults): 041 123 456 / 38641123456 /
-- 0038641123456 / +386 41 123 456 → +38641123456
-- ---------------------------------------------------------------------------
create or replace function public.crm_normalize_phone(p_phone text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  s text := regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g');
begin
  s := regexp_replace(s, '(?<!^)\+', '', 'g'); -- stray plus signs
  if s like '00%' then
    s := '+' || substr(s, 3);
  elsif s like '386%' and length(s) >= 10 then
    s := '+' || s;
  elsif s like '0%' and length(s) >= 8 then
    s := '+386' || substr(s, 2);
  end if;
  return nullif(s, '');
end;
$$;

-- Customers use the same normalisation (duplicate detection lead ↔ customer)
drop view if exists public.customer_overview;
drop index if exists public.customers_phone_idx;
alter table public.customers drop column phone_normalized;
alter table public.customers
  add column phone_normalized text generated always as (public.crm_normalize_phone(phone)) stored;
create index customers_phone_idx on public.customers (phone_normalized);

create view public.customer_overview
with (security_invoker = true)
as
select
  c.*,
  (select count(*) from public.appointments a where a.customer_id = c.id and a.status = 'completed') as consultation_count,
  (select count(*) from public.appointments a where a.customer_id = c.id and a.status <> 'cancelled') as appointment_count,
  (select count(*) from public.policies p where p.customer_id = c.id and p.status = 'active') as policy_count,
  (select min(a.scheduled_at) from public.appointments a
     where a.customer_id = c.id and a.status = 'scheduled') as next_appointment_at
from public.customers c;
grant select on public.customer_overview to authenticated;

-- ---------------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------------
create table public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id)
);
insert into public.app_settings (key, value) values ('lead_rejected_recall_months', '6'::jsonb);

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create type public.lead_status as enum ('new', 'callback', 'rejected', 'appointment', 'do_not_call');
create type public.lead_list_status as enum ('importing', 'ready', 'archived');

create table public.lead_lists (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) > 0),
  source_file_name text,
  status public.lead_list_status not null default 'importing',
  assigned_caller_id uuid references public.profiles (id),
  column_mapping jsonb not null default '{}'::jsonb,
  extra_columns text[] not null default '{}',
  total_rows integer not null default 0,
  imported_count integer not null default 0,
  skipped_duplicates integer not null default 0,
  skipped_suppressed integer not null default 0,
  skipped_invalid integer not null default 0,
  imported_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index lead_lists_status_idx on public.lead_lists (status, created_at desc);

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references public.lead_lists (id) on delete cascade,
  row_number integer,
  name text not null,
  phone text not null,
  phone_normalized text not null,
  street text,
  postal_code text,
  city text,
  activity text,
  tax_number text,
  email text,
  extra jsonb not null default '{}'::jsonb,
  status public.lead_status not null default 'new',
  next_call_at timestamptz,
  last_contacted_at timestamptz,
  last_contacted_by uuid references public.profiles (id),
  contact_count integer not null default 0,
  last_comment text,
  customer_id uuid references public.customers (id),
  existing_customer_id uuid references public.customers (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  search_text text generated always as (
    lower(
      name || ' ' || phone_normalized || ' ' || coalesce(email, '') || ' ' || coalesce(street, '') || ' '
      || coalesce(postal_code, '') || ' ' || coalesce(city, '') || ' ' || coalesce(tax_number, '') || ' '
      || coalesce(activity, '')
    )
  ) stored
);
create unique index leads_phone_key on public.leads (phone_normalized);
create index leads_list_status_idx on public.leads (list_id, status, next_call_at);
create index leads_status_next_idx on public.leads (status, next_call_at);
create index leads_list_row_idx on public.leads (list_id, row_number);
create index leads_postal_idx on public.leads (postal_code);
create index leads_city_idx on public.leads (lower(city));
create index leads_last_contacted_idx on public.leads (last_contacted_at desc nulls last);
create index leads_search_trgm_idx on public.leads using gin (search_text extensions.gin_trgm_ops);
create index leads_activity_trgm_idx on public.leads using gin (lower(coalesce(activity, '')) extensions.gin_trgm_ops);

create table public.lead_events (
  id bigint generated always as identity primary key,
  lead_id uuid not null references public.leads (id) on delete cascade,
  actor_id uuid references public.profiles (id),
  action text not null check (action in ('status_changed', 'comment', 'converted')),
  status_from public.lead_status,
  status_to public.lead_status,
  next_call_at timestamptz,
  comment text,
  created_at timestamptz not null default now()
);
create index lead_events_lead_idx on public.lead_events (lead_id, created_at desc);

create table public.lead_suppressions (
  phone_normalized text primary key,
  reason text not null default 'do_not_call',
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

create trigger lead_lists_updated_at before update on public.lead_lists
  for each row execute function public.tg_set_updated_at();
create trigger leads_updated_at before update on public.leads
  for each row execute function public.tg_set_updated_at();

-- ---------------------------------------------------------------------------
-- Access
-- Owner: all lists. Caller: ready lists assigned to them or to all callers.
-- Agents: none.
-- ---------------------------------------------------------------------------
create or replace function public.crm_lead_lists_for(p_user_id uuid)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(l.id), '{}')
  from public.lead_lists l
  where case public.crm_role_of(p_user_id)
          when 'owner' then true
          when 'caller' then l.status = 'ready' and (l.assigned_caller_id is null or l.assigned_caller_id = p_user_id)
          else false
        end;
$$;

create or replace function public.crm_accessible_lead_lists()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select case when public.crm_current_role() is null then '{}'::uuid[] else public.crm_lead_lists_for(auth.uid()) end;
$$;

alter table public.app_settings enable row level security;
alter table public.lead_lists enable row level security;
alter table public.leads enable row level security;
alter table public.lead_events enable row level security;
alter table public.lead_suppressions enable row level security;

revoke all on public.app_settings, public.lead_lists, public.leads, public.lead_events, public.lead_suppressions from anon, authenticated;
grant select on public.app_settings, public.lead_lists, public.leads, public.lead_events to authenticated;

create policy app_settings_select on public.app_settings
  for select to authenticated using (public.crm_current_role() is not null);

create policy lead_lists_select on public.lead_lists
  for select to authenticated using (id = any ((select public.crm_accessible_lead_lists())::uuid[]));

create policy leads_select on public.leads
  for select to authenticated using (list_id = any ((select public.crm_accessible_lead_lists())::uuid[]));

create policy lead_events_select on public.lead_events
  for select to authenticated using (exists (select 1 from public.leads l where l.id = lead_id));

-- lead_suppressions: no policies (server only)

-- City facet for filters (RLS of the caller applies: security invoker)
create or replace function public.lead_city_facets(p_list_id uuid default null)
returns table (city text, n bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select initcap(lower(btrim(l.city))) as city, count(*) as n
  from public.leads l
  where l.city is not null and btrim(l.city) <> '' and (p_list_id is null or l.list_id = p_list_id)
  group by 1
  order by 2 desc, 1
  limit 300;
$$;

-- Status counts per list (for overviews)
create or replace function public.lead_list_stats()
returns table (list_id uuid, status public.lead_status, due boolean, n bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select l.list_id, l.status,
         (l.status = 'new' or (l.status in ('callback', 'rejected') and l.next_call_at <= now())) as due,
         count(*)
  from public.leads l
  group by 1, 2, 3;
$$;

grant execute on function public.crm_accessible_lead_lists() to authenticated;
grant execute on function public.lead_city_facets(uuid) to authenticated;
grant execute on function public.lead_list_stats() to authenticated;
revoke execute on function public.crm_accessible_lead_lists() from anon;
revoke execute on function public.lead_city_facets(uuid) from anon;
revoke execute on function public.lead_list_stats() from anon;

-- ---------------------------------------------------------------------------
-- Workflow functions (service_role only)
-- ---------------------------------------------------------------------------
create or replace function public.crm_require_lead_access(p_actor uuid, p_lead_id uuid)
returns public.leads
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lead public.leads;
begin
  perform public.crm_require_actor(p_actor);
  select * into v_lead from public.leads l where l.id = p_lead_id for update;
  if v_lead.id is null or not (v_lead.list_id = any (public.crm_lead_lists_for(p_actor))) then
    perform public.crm_fail('Kontakt ne obstaja ali do njega nimate dostopa.');
  end if;
  return v_lead;
end;
$$;

create or replace function public.crm_create_lead_list(
  p_actor uuid,
  p_name text,
  p_file_name text,
  p_assigned_caller_id uuid,
  p_mapping jsonb,
  p_extra_columns text[],
  p_total_rows integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform public.crm_require_owner(p_actor);
  if p_assigned_caller_id is not null and coalesce(public.crm_role_of(p_assigned_caller_id)::text, '') <> 'caller' then
    perform public.crm_fail('Izbrani klicatelj ne obstaja ali ni aktiven.');
  end if;
  insert into public.lead_lists (name, source_file_name, assigned_caller_id, column_mapping, extra_columns, total_rows, imported_by)
  values (btrim(p_name), p_file_name, p_assigned_caller_id, coalesce(p_mapping, '{}'::jsonb), coalesce(p_extra_columns, '{}'), coalesce(p_total_rows, 0), p_actor)
  returning id into v_id;
  return v_id;
end;
$$;

-- Insert a chunk of rows. Rows without a usable phone/name are skipped; phones
-- already in any list, or on the do-not-call list, are skipped.
create or replace function public.crm_import_leads(p_actor uuid, p_list_id uuid, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_list public.lead_lists;
  v_total integer;
  v_valid integer;
  v_suppressed integer;
  v_inserted integer;
begin
  perform public.crm_require_owner(p_actor);
  select * into v_list from public.lead_lists where id = p_list_id for update;
  if v_list.id is null or v_list.status <> 'importing' then
    perform public.crm_fail('Seznam ne obstaja ali uvoz ni več odprt.');
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 2000 then
    perform public.crm_fail('Neveljaven paket vrstic.');
  end if;

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

create or replace function public.crm_finalize_lead_list(p_actor uuid, p_list_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_list public.lead_lists;
begin
  perform public.crm_require_owner(p_actor);
  update public.lead_lists set status = 'ready' where id = p_list_id and status = 'importing' returning * into v_list;
  if v_list.id is null then
    perform public.crm_fail('Seznam ne obstaja ali je že zaključen.');
  end if;
  perform public.crm_log(null, 'lead_list', v_list.id, 'lead_list_imported', p_actor, 'owner', null,
    jsonb_build_object('name', v_list.name, 'file', v_list.source_file_name, 'imported', v_list.imported_count,
                       'duplicates', v_list.skipped_duplicates, 'suppressed', v_list.skipped_suppressed,
                       'invalid', v_list.skipped_invalid));
  return to_jsonb(v_list);
end;
$$;

create or replace function public.crm_update_lead_list(
  p_actor uuid,
  p_list_id uuid,
  p_name text,
  p_assigned_caller_id uuid,
  p_archived boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.crm_require_owner(p_actor);
  if p_assigned_caller_id is not null and coalesce(public.crm_role_of(p_assigned_caller_id)::text, '') <> 'caller' then
    perform public.crm_fail('Izbrani klicatelj ne obstaja ali ni aktiven.');
  end if;
  update public.lead_lists l
     set name = coalesce(nullif(btrim(p_name), ''), l.name),
         assigned_caller_id = p_assigned_caller_id,
         status = case when l.status = 'importing' then l.status
                       when p_archived then 'archived'::public.lead_list_status
                       else 'ready'::public.lead_list_status end
   where l.id = p_list_id;
end;
$$;

-- Deletes a list with its contacts and their call history (GDPR erasure).
-- Do-not-call numbers remain in lead_suppressions; converted customers remain.
create or replace function public.crm_delete_lead_list(p_actor uuid, p_list_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_count integer;
begin
  perform public.crm_require_owner(p_actor);
  select name into v_name from public.lead_lists where id = p_list_id;
  if v_name is null then
    perform public.crm_fail('Seznam ne obstaja.');
  end if;
  select count(*) into v_count from public.leads where list_id = p_list_id;
  delete from public.lead_lists where id = p_list_id;
  perform public.crm_log(null, 'lead_list', p_list_id, 'lead_list_deleted', p_actor, 'owner', null,
    jsonb_build_object('name', v_name, 'contacts', v_count));
  return v_count;
end;
$$;

create or replace function public.crm_lead_set_status(
  p_actor uuid,
  p_lead_id uuid,
  p_status public.lead_status,
  p_next_call_at timestamptz,
  p_comment text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lead public.leads := public.crm_require_lead_access(p_actor, p_lead_id);
  v_next timestamptz;
  v_months integer;
begin
  if p_status = 'appointment' then
    perform public.crm_fail('Termin se dogovori z gumbom »Termin dogovorjen«.');
  end if;
  if v_lead.status = 'appointment' then
    perform public.crm_fail('Za ta kontakt je termin že dogovorjen.');
  end if;
  if p_status = 'new' and public.crm_role_of(p_actor) <> 'owner' then
    perform public.crm_fail('Status »Nov« lahko nastavi samo lastnik.');
  end if;

  if p_status = 'callback' then
    if p_next_call_at is null or p_next_call_at < now() - interval '5 minutes' then
      perform public.crm_fail('Za ponovni klic izberite datum v prihodnosti.');
    end if;
    v_next := p_next_call_at;
  elsif p_status = 'rejected' then
    select (value #>> '{}')::integer into v_months from public.app_settings where key = 'lead_rejected_recall_months';
    v_next := now() + make_interval(months => coalesce(v_months, 6));
  else
    v_next := null;
  end if;

  if p_status = 'do_not_call' then
    insert into public.lead_suppressions (phone_normalized, created_by)
    values (v_lead.phone_normalized, p_actor) on conflict do nothing;
  end if;

  update public.leads l
     set status = p_status,
         next_call_at = v_next,
         last_contacted_at = now(),
         last_contacted_by = p_actor,
         contact_count = l.contact_count + 1,
         last_comment = coalesce(nullif(btrim(p_comment), ''), l.last_comment)
   where l.id = p_lead_id;

  insert into public.lead_events (lead_id, actor_id, action, status_from, status_to, next_call_at, comment)
  values (p_lead_id, p_actor, 'status_changed', v_lead.status, p_status, v_next, nullif(btrim(p_comment), ''));

  return jsonb_build_object('status', p_status, 'next_call_at', v_next);
end;
$$;

create or replace function public.crm_lead_add_comment(p_actor uuid, p_lead_id uuid, p_comment text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.crm_require_lead_access(p_actor, p_lead_id);
  if nullif(btrim(p_comment), '') is null then
    perform public.crm_fail('Komentar je prazen.');
  end if;
  update public.leads set last_comment = btrim(p_comment) where id = p_lead_id;
  insert into public.lead_events (lead_id, actor_id, action, comment) values (p_lead_id, p_actor, 'comment', btrim(p_comment));
end;
$$;

create or replace function public.crm_set_setting(p_actor uuid, p_key text, p_value jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.crm_require_owner(p_actor);
  if p_key = 'lead_rejected_recall_months' then
    if jsonb_typeof(p_value) <> 'number' or (p_value #>> '{}')::integer not between 1 and 60 then
      perform public.crm_fail('Obdobje mora biti med 1 in 60 meseci.');
    end if;
  else
    perform public.crm_fail('Neznana nastavitev.');
  end if;
  insert into public.app_settings (key, value, updated_at, updated_by) values (p_key, p_value, now(), p_actor)
  on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = p_actor;
  perform public.crm_log(null, 'setting', null, 'setting_changed', p_actor, 'owner', null, jsonb_build_object(p_key, p_value));
end;
$$;

-- ---------------------------------------------------------------------------
-- New customer + appointment: optionally converts a call-list contact
-- ---------------------------------------------------------------------------
drop function if exists public.crm_create_customer_with_appointment(uuid, jsonb, jsonb);

create or replace function public.crm_create_customer_with_appointment(
  p_actor uuid,
  p_customer jsonb,
  p_appointment jsonb,
  p_lead_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.user_role := public.crm_require_actor(p_actor);
  v_caller_id uuid;
  v_customer_id uuid;
  v_appointment_id uuid;
  v_lead public.leads;
begin
  if p_lead_id is not null then
    v_lead := public.crm_require_lead_access(p_actor, p_lead_id);
    if v_lead.status = 'appointment' then
      perform public.crm_fail('Za ta kontakt je termin že dogovorjen.');
    end if;
  end if;

  if v_role = 'caller' then
    v_caller_id := p_actor;
  elsif v_role = 'owner' then
    v_caller_id := nullif(p_appointment ->> 'caller_id', '')::uuid;
    if v_caller_id is not null and coalesce(public.crm_role_of(v_caller_id)::text, '') <> 'caller' then
      perform public.crm_fail('Izbrani klicatelj ne obstaja ali ni aktiven.');
    end if;
  else
    v_caller_id := null;
  end if;

  insert into public.customers
    (first_name, last_name, phone, email, address, postal_code, city,
     responsible_caller_id, current_agent_id, created_by, status)
  values
    (btrim(p_customer ->> 'first_name'), btrim(p_customer ->> 'last_name'), btrim(p_customer ->> 'phone'),
     nullif(lower(btrim(p_customer ->> 'email')), ''), btrim(p_customer ->> 'address'),
     btrim(p_customer ->> 'postal_code'), nullif(btrim(p_customer ->> 'city'), ''),
     v_caller_id, (p_appointment ->> 'agent_id')::uuid, p_actor, 'scheduled')
  returning id into v_customer_id;

  perform public.crm_log(v_customer_id, 'customer', v_customer_id, 'customer_created', p_actor, 'team', null,
    jsonb_build_object('responsible_caller_id', v_caller_id, 'lead_id', p_lead_id));

  v_appointment_id := public.crm_insert_appointment(
    p_actor, v_customer_id, (p_appointment ->> 'agent_id')::uuid, v_caller_id,
    (p_appointment ->> 'scheduled_at')::timestamptz,
    nullif(p_appointment ->> 'duration_minutes', '')::integer,
    btrim(p_customer ->> 'address'), btrim(p_customer ->> 'postal_code'),
    p_appointment ->> 'note', null, case when p_lead_id is null then 'new_customer' else 'call_list' end);

  if p_lead_id is not null then
    update public.leads l
       set status = 'appointment', customer_id = v_customer_id, next_call_at = null,
           last_contacted_at = now(), last_contacted_by = p_actor, contact_count = l.contact_count + 1
     where l.id = p_lead_id;
    insert into public.lead_events (lead_id, actor_id, action, status_from, status_to, comment)
    values (p_lead_id, p_actor, 'converted', v_lead.status, 'appointment', 'Termin dogovorjen');
  end if;

  return jsonb_build_object('customer_id', v_customer_id, 'appointment_id', v_appointment_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Demo purge: also handle call lists touched by demo users
-- ---------------------------------------------------------------------------
create or replace function public.crm_purge_demo_data()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customers uuid[];
  v_profiles uuid[];
  v_storage_paths text[];
begin
  select coalesce(array_agg(id), '{}') into v_customers from public.customers where is_demo;
  select coalesce(array_agg(id), '{}') into v_profiles from public.profiles where is_demo;

  if exists (
    select 1 from public.appointments a
    where not (a.customer_id = any (v_customers))
      and (a.agent_id = any (v_profiles) or a.caller_id = any (v_profiles) or a.created_by = any (v_profiles))
  ) or exists (
    select 1 from public.customers c
    where not c.is_demo
      and (c.created_by = any (v_profiles) or c.responsible_caller_id = any (v_profiles)
           or c.current_agent_id = any (v_profiles))
  ) then
    perform public.crm_fail('Demo uporabniki so povezani z realnimi podatki. Čiščenje prekinjeno.');
  end if;

  perform set_config('crm.allow_demo_purge', 'on', true);

  select coalesce(array_agg(d.storage_path), '{}') into v_storage_paths
    from public.documents d where d.customer_id = any (v_customers);

  delete from public.activity_log where customer_id = any (v_customers)
     or (customer_id is null and (actor_id = any (v_profiles) or entity_id = any (v_profiles)));
  delete from public.documents where customer_id = any (v_customers);
  delete from public.commission_installments
   where policy_id in (select id from public.policies where customer_id = any (v_customers));
  delete from public.commissions
   where policy_id in (select id from public.policies where customer_id = any (v_customers));
  delete from public.policies where customer_id = any (v_customers);
  delete from public.caller_followups where customer_id = any (v_customers);
  update public.appointments set previous_appointment_id = null where customer_id = any (v_customers);
  delete from public.appointments where customer_id = any (v_customers);
  delete from public.customers where id = any (v_customers);
  -- Call lists: remove lists imported by demo users, detach demo users from others
  delete from public.lead_lists where imported_by = any (v_profiles);
  update public.lead_lists set assigned_caller_id = null where assigned_caller_id = any (v_profiles);
  update public.leads set last_contacted_by = null where last_contacted_by = any (v_profiles);
  update public.lead_events set actor_id = null where actor_id = any (v_profiles);
  update public.lead_suppressions set created_by = null where created_by = any (v_profiles);
  update public.app_settings set updated_by = null where updated_by = any (v_profiles);
  delete from public.agent_commission_rates where agent_id = any (v_profiles);
  delete from public.caller_commission_rates where caller_id = any (v_profiles);
  delete from public.profiles where id = any (v_profiles);
  delete from auth.users where id = any (v_profiles);

  return jsonb_build_object(
    'customers_removed', cardinality(v_customers),
    'profiles_removed', cardinality(v_profiles),
    'storage_paths', to_jsonb(v_storage_paths)
  );
end;
$$;

-- Execute privileges
do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('crm_lead_lists_for', 'crm_require_lead_access', 'crm_create_lead_list', 'crm_import_leads',
                        'crm_finalize_lead_list', 'crm_update_lead_list', 'crm_delete_lead_list', 'crm_lead_set_status',
                        'crm_lead_add_comment', 'crm_set_setting', 'crm_create_customer_with_appointment',
                        'crm_purge_demo_data')
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end;
$$;
