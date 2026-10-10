-- =============================================================================
-- Live call lists (e.g. Facebook lead form → Google Sheet → CRM)
--   * lead_lists.kind = 'live': rows arrive through /api/leads/ingest,
--     authenticated by a per-list token (only its SHA-256 hash is stored)
--   * lead_list_members: which callers see a list and who gets a push
--     notification for new contacts (no members = old behaviour)
--   * re-inquiries: a person already in another list is MOVED to the live list
--     with a visible notice; their existing data and history are kept
--   * statuses: no_answer (back tomorrow, attempts counted), invalid
-- =============================================================================

alter table public.lead_lists
  add column kind text not null default 'import' check (kind in ('import', 'live')),
  add column source_label text,
  add column source_tab text,
  add column ingest_token_hash text unique,
  add column last_ingest_at timestamptz;

alter table public.leads
  add column source_created_at timestamptz,
  add column reinquiry_at timestamptz,
  add column reinquiry_note text,
  add column no_answer_count integer not null default 0;
create index leads_source_created_idx on public.leads (source_created_at desc nulls last);

alter table public.lead_events drop constraint lead_events_action_check;
alter table public.lead_events add constraint lead_events_action_check
  check (action in ('status_changed', 'comment', 'converted', 'reinquiry'));

-- Who sees a list / who is notified. caller_id references auth.users so that
-- removing a user cleans up automatically.
create table public.lead_list_members (
  list_id uuid not null references public.lead_lists (id) on delete cascade,
  caller_id uuid not null references auth.users (id) on delete cascade,
  notify boolean not null default false,
  primary key (list_id, caller_id)
);
alter table public.lead_list_members enable row level security;
revoke all on public.lead_list_members from anon, authenticated;
grant select on public.lead_list_members to authenticated;
create policy lead_list_members_select on public.lead_list_members
  for select to authenticated
  using (public.crm_is_owner() or (public.crm_current_role() is not null and caller_id = (select auth.uid())));

-- Every sheet row is processed exactly once
create table public.lead_ingest_log (
  list_id uuid not null references public.lead_lists (id) on delete cascade,
  source_key text not null,
  outcome text not null,
  created_at timestamptz not null default now(),
  primary key (list_id, source_key)
);
alter table public.lead_ingest_log enable row level security;
revoke all on public.lead_ingest_log from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Access: members (if any) decide; otherwise the single assignment / everyone
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
          when 'caller' then l.status = 'ready' and (
            exists (select 1 from public.lead_list_members m where m.list_id = l.id and m.caller_id = p_user_id)
            or (not exists (select 1 from public.lead_list_members m where m.list_id = l.id)
                and (l.assigned_caller_id is null or l.assigned_caller_id = p_user_id))
          )
          else false
        end;
$$;

-- "Due" now also covers no_answer contacts whose retry time has come
create or replace function public.lead_list_stats()
returns table (list_id uuid, status public.lead_status, due boolean, n bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select l.list_id, l.status,
         (l.status = 'new' or (l.status in ('callback', 'rejected', 'no_answer') and l.next_call_at <= now())) as due,
         count(*)
  from public.leads l
  group by 1, 2, 3;
$$;

-- ---------------------------------------------------------------------------
-- Statuses
-- ---------------------------------------------------------------------------
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
  elsif p_status = 'no_answer' then
    -- back in the queue tomorrow at 08:00 (Europe/Ljubljana)
    v_next := (((now() at time zone 'Europe/Ljubljana')::date + 1) + time '08:00') at time zone 'Europe/Ljubljana';
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
         no_answer_count = case when p_status = 'no_answer' then l.no_answer_count + 1 else l.no_answer_count end,
         last_comment = coalesce(nullif(btrim(p_comment), ''), l.last_comment)
   where l.id = p_lead_id;

  insert into public.lead_events (lead_id, actor_id, action, status_from, status_to, next_call_at, comment)
  values (p_lead_id, p_actor, 'status_changed', v_lead.status, p_status, v_next, nullif(btrim(p_comment), ''));

  return jsonb_build_object('status', p_status, 'next_call_at', v_next);
end;
$$;

-- ---------------------------------------------------------------------------
-- Owner: create a live list / rotate its token / members
-- ---------------------------------------------------------------------------
create or replace function public.crm_set_lead_list_members(p_list_id uuid, p_members jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_m jsonb;
begin
  delete from public.lead_list_members where list_id = p_list_id;
  for v_m in select * from jsonb_array_elements(coalesce(p_members, '[]'::jsonb)) loop
    if coalesce(public.crm_role_of((v_m ->> 'caller_id')::uuid)::text, '') <> 'caller' then
      perform public.crm_fail('Izbrani klicatelj ne obstaja ali ni aktiven.');
    end if;
    insert into public.lead_list_members (list_id, caller_id, notify)
    values (p_list_id, (v_m ->> 'caller_id')::uuid, coalesce((v_m ->> 'notify')::boolean, false));
  end loop;
end;
$$;

create or replace function public.crm_create_live_list(
  p_actor uuid,
  p_name text,
  p_source_label text,
  p_source_tab text,
  p_token_hash text,
  p_members jsonb
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
  if nullif(btrim(p_name), '') is null or length(coalesce(p_token_hash, '')) < 32 then
    perform public.crm_fail('Manjka ime seznama.');
  end if;
  insert into public.lead_lists (name, kind, status, source_label, source_tab, ingest_token_hash, imported_by)
  values (btrim(p_name), 'live', 'ready', nullif(btrim(p_source_label), ''), nullif(btrim(p_source_tab), ''), p_token_hash, p_actor)
  returning id into v_id;
  perform public.crm_set_lead_list_members(v_id, p_members);
  perform public.crm_log(null, 'lead_list', v_id, 'live_list_created', p_actor, 'owner', null, jsonb_build_object('name', btrim(p_name)));
  return v_id;
end;
$$;

create or replace function public.crm_rotate_live_list_token(p_actor uuid, p_list_id uuid, p_token_hash text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.crm_require_owner(p_actor);
  update public.lead_lists set ingest_token_hash = p_token_hash where id = p_list_id and kind = 'live';
  if not found then
    perform public.crm_fail('Live seznam ne obstaja.');
  end if;
end;
$$;

drop function if exists public.crm_update_lead_list(uuid, uuid, text, uuid, boolean);
create or replace function public.crm_update_lead_list(
  p_actor uuid,
  p_list_id uuid,
  p_name text,
  p_archived boolean,
  p_members jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.crm_require_owner(p_actor);
  update public.lead_lists l
     set name = coalesce(nullif(btrim(p_name), ''), l.name),
         assigned_caller_id = null, -- access is defined by lead_list_members (none = all callers)
         status = case when l.status = 'importing' then l.status
                       when p_archived then 'archived'::public.lead_list_status
                       else 'ready'::public.lead_list_status end
   where l.id = p_list_id;
  perform public.crm_set_lead_list_members(p_list_id, p_members);
end;
$$;

-- Existing single assignments become members
insert into public.lead_list_members (list_id, caller_id, notify)
select l.id, l.assigned_caller_id, false from public.lead_lists l where l.assigned_caller_id is not null
on conflict do nothing;
update public.lead_lists set assigned_caller_id = null where assigned_caller_id is not null;

-- ---------------------------------------------------------------------------
-- Ingest rows for a live list. Called by the server after verifying the token.
-- p_rows: [{ source_key, name, phone, email, created_at, extra, skip }]
-- ---------------------------------------------------------------------------
create or replace function public.crm_ingest_live_leads(p_list_id uuid, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_list public.lead_lists;
  v_row jsonb;
  v_key text;
  v_pn text;
  v_created timestamptz;
  v_existing public.leads;
  v_old_list text;
  v_note text;
  v_id uuid;
  v_inserted integer := 0;
  v_reinquiries integer := 0;
  v_skipped integer := 0;
  v_invalid integer := 0;
  v_new jsonb := '[]'::jsonb;
  v_outcome text;
begin
  select * into v_list from public.lead_lists where id = p_list_id;
  if v_list.id is null or v_list.kind <> 'live' or v_list.status = 'archived' then
    perform public.crm_fail('Live seznam ne obstaja ali je arhiviran.');
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 1000 then
    perform public.crm_fail('Neveljaven paket vrstic.');
  end if;

  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_key := v_row ->> 'source_key';
    if v_key is null or exists (select 1 from public.lead_ingest_log g where g.list_id = p_list_id and g.source_key = v_key) then
      continue; -- already processed
    end if;

    v_pn := public.crm_normalize_phone(v_row ->> 'phone');
    v_created := nullif(v_row ->> 'created_at', '')::timestamptz;

    if coalesce((v_row ->> 'skip')::boolean, false) then
      v_outcome := 'skipped';
      v_skipped := v_skipped + 1;
    elsif v_pn is null or length(v_pn) < 9 or v_pn ~ '^\+?0+$' or nullif(btrim(v_row ->> 'name'), '') is null then
      v_outcome := 'invalid';
      v_invalid := v_invalid + 1;
    else
      select * into v_existing from public.leads l where l.phone_normalized = v_pn for update;
      if v_existing.id is null then
        -- A person who asked to be contacted overrides an older "do not call" entry
        delete from public.lead_suppressions where phone_normalized = v_pn;
        v_note := case when found then 'Prej označen »Ne želi klicev« – zdaj je sam/a oddal/a povpraševanje.' end;
        insert into public.leads (list_id, name, phone, phone_normalized, email, extra, source_created_at, reinquiry_note,
                                  reinquiry_at, existing_customer_id)
        values (p_list_id, left(btrim(v_row ->> 'name'), 300), v_pn, v_pn, nullif(lower(btrim(v_row ->> 'email')), ''),
                coalesce(v_row -> 'extra', '{}'::jsonb), v_created, v_note, case when v_note is not null then coalesce(v_created, now()) end,
                (select c.id from public.customers c where c.phone_normalized = v_pn limit 1))
        returning id into v_id;
        v_outcome := 'inserted';
        v_inserted := v_inserted + 1;
      else
        -- Duplicate: keep the richer existing data, move to the live list and flag it
        select name into v_old_list from public.lead_lists where id = v_existing.list_id;
        v_note := case
          when v_existing.list_id = p_list_id then 'Ponovno povpraševanje – oseba je obrazec oddala še enkrat.'
          else 'Dvojnik – oseba je že v seznamu »' || coalesce(v_old_list, '?') || '«. Zdaj se je dodatno zanimala prek oglasa.'
        end
        || case v_existing.status
             when 'rejected' then ' Prej: zavrnjen.'
             when 'do_not_call' then ' Prej: ne želi klicev.'
             when 'appointment' then ' Prej: termin že dogovorjen (obstaja kot stranka).'
             when 'callback' then ' Prej: ponovni klic.'
             when 'no_answer' then ' Prej: se ne javi.'
             when 'invalid' then ' Prej: neveljavna številka.'
             else '' end;
        delete from public.lead_suppressions where phone_normalized = v_pn;
        update public.leads l
           set list_id = p_list_id,
               status = 'new',
               next_call_at = null,
               no_answer_count = 0,
               email = coalesce(l.email, nullif(lower(btrim(v_row ->> 'email')), '')),
               extra = l.extra || coalesce(v_row -> 'extra', '{}'::jsonb),
               source_created_at = coalesce(v_created, now()),
               reinquiry_at = coalesce(v_created, now()),
               reinquiry_note = v_note,
               existing_customer_id = coalesce(l.customer_id, l.existing_customer_id),
               customer_id = null
         where l.id = v_existing.id;
        insert into public.lead_events (lead_id, action, status_from, status_to, comment)
        values (v_existing.id, 'reinquiry', v_existing.status, 'new', v_note);
        v_id := v_existing.id;
        v_outcome := 'reinquiry';
        v_reinquiries := v_reinquiries + 1;
      end if;
      v_new := v_new || jsonb_build_object('id', v_id, 'name', btrim(v_row ->> 'name'), 'reinquiry', v_outcome = 'reinquiry');
    end if;

    insert into public.lead_ingest_log (list_id, source_key, outcome) values (p_list_id, v_key, v_outcome);
  end loop;

  update public.lead_lists
     set last_ingest_at = now(),
         imported_count = imported_count + v_inserted + v_reinquiries,
         skipped_invalid = skipped_invalid + v_invalid
   where id = p_list_id;

  return jsonb_build_object('inserted', v_inserted, 'reinquiries', v_reinquiries, 'skipped', v_skipped, 'invalid', v_invalid, 'new', v_new);
end;
$$;

do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('crm_lead_lists_for', 'crm_lead_set_status', 'crm_set_lead_list_members', 'crm_create_live_list',
                        'crm_rotate_live_list_token', 'crm_update_lead_list', 'crm_ingest_live_leads')
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end;
$$;
