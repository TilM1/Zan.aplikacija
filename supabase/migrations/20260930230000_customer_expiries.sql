-- =============================================================================
-- Skadence: expiry dates of customers' other insurance products, recorded by
-- agents (e.g. during a consultation). Reminder (call list) N days before
-- expiry (owner setting, default 14).
-- =============================================================================

create type public.expiry_status as enum ('open', 'done', 'dismissed');

create table public.customer_expiries (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete cascade,
  category text not null check (category in ('avto', 'dom', 'zivljenjsko', 'nezgodno', 'zdravstveno', 'potovalno', 'drugo')),
  description text,
  insurer text,
  expiry_date date not null,
  note text,
  assigned_agent_id uuid not null references public.profiles (id),
  status public.expiry_status not null default 'open',
  outcome text,
  snoozed_until date,
  handled_at timestamptz,
  handled_by uuid references public.profiles (id),
  source_appointment_id uuid references public.appointments (id) on delete set null,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index customer_expiries_agent_idx on public.customer_expiries (assigned_agent_id, status, expiry_date);
create index customer_expiries_status_idx on public.customer_expiries (status, expiry_date);
create index customer_expiries_customer_idx on public.customer_expiries (customer_id, expiry_date);
create trigger customer_expiries_updated_at before update on public.customer_expiries
  for each row execute function public.tg_set_updated_at();

insert into public.app_settings (key, value) values ('expiry_reminder_days', '14'::jsonb) on conflict do nothing;

alter table public.customer_expiries enable row level security;
revoke all on public.customer_expiries from anon, authenticated;
grant select on public.customer_expiries to authenticated;
create policy customer_expiries_select on public.customer_expiries
  for select to authenticated
  using (
    public.crm_is_owner()
    or (public.crm_current_role() = 'agent' and (assigned_agent_id = (select auth.uid()) or public.crm_can_view_customer(customer_id)))
  );

-- ---------------------------------------------------------------------------
-- Functions (service_role only)
-- ---------------------------------------------------------------------------
create or replace function public.crm_add_expiries(
  p_actor uuid,
  p_customer_id uuid,
  p_items jsonb,
  p_appointment_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.user_role := public.crm_require_actor(p_actor);
  v_assignee uuid;
  v_item jsonb;
  v_count integer := 0;
begin
  if v_role = 'caller' or not public.crm_user_can_view_customer(p_actor, p_customer_id) then
    perform public.crm_fail('Skadence lahko vnašajo zastopniki za svoje stranke.');
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 20 then
    perform public.crm_fail('Ni skadenc za shranjevanje.');
  end if;
  -- Reminder goes to the agent who records it (owner: to the customer's current agent, else self)
  v_assignee := case when v_role = 'owner'
                     then coalesce((select current_agent_id from public.customers where id = p_customer_id), p_actor)
                     else p_actor end;

  for v_item in select * from jsonb_array_elements(p_items) loop
    if nullif(v_item ->> 'expiry_date', '') is null then
      perform public.crm_fail('Vsaka skadenca potrebuje datum poteka.');
    end if;
    insert into public.customer_expiries
      (customer_id, category, description, insurer, expiry_date, note, assigned_agent_id, source_appointment_id, created_by)
    values
      (p_customer_id, v_item ->> 'category', nullif(btrim(v_item ->> 'description'), ''), nullif(btrim(v_item ->> 'insurer'), ''),
       (v_item ->> 'expiry_date')::date, nullif(btrim(v_item ->> 'note'), ''), v_assignee, p_appointment_id, p_actor);
    v_count := v_count + 1;
  end loop;

  perform public.crm_log(p_customer_id, 'customer', p_customer_id, 'expiry_added', p_actor, 'team', null,
    jsonb_build_object('count', v_count, 'items', p_items));
  return v_count;
end;
$$;

create or replace function public.crm_update_expiry(
  p_actor uuid,
  p_expiry_id uuid,
  p_status public.expiry_status,
  p_outcome text,
  p_snooze_until date,
  p_repeat_next_year boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.user_role := public.crm_require_actor(p_actor);
  v_e public.customer_expiries;
  v_new uuid;
begin
  select * into v_e from public.customer_expiries where id = p_expiry_id for update;
  if v_e.id is null or not (v_role = 'owner' or v_e.assigned_agent_id = p_actor) then
    perform public.crm_fail('Skadenca ne obstaja ali ni dodeljena vam.');
  end if;
  if p_snooze_until is not null and p_snooze_until < current_date then
    perform public.crm_fail('Datum odloga mora biti danes ali kasneje.');
  end if;

  update public.customer_expiries
     set status = p_status,
         outcome = coalesce(nullif(btrim(p_outcome), ''), outcome),
         snoozed_until = case when p_status = 'open' then p_snooze_until else null end,
         handled_at = case when p_status = 'open' then null else now() end,
         handled_by = case when p_status = 'open' then null else p_actor end
   where id = p_expiry_id;

  if p_status = 'done' and p_repeat_next_year then
    insert into public.customer_expiries
      (customer_id, category, description, insurer, expiry_date, note, assigned_agent_id, created_by)
    values
      (v_e.customer_id, v_e.category, v_e.description, v_e.insurer, (v_e.expiry_date + interval '1 year')::date, v_e.note,
       v_e.assigned_agent_id, p_actor)
    returning id into v_new;
  end if;

  perform public.crm_log(v_e.customer_id, 'customer', v_e.customer_id, 'expiry_updated', p_actor, 'team',
    jsonb_build_object('status', v_e.status),
    jsonb_build_object('status', p_status, 'category', v_e.category, 'expiry_date', v_e.expiry_date,
                       'outcome', nullif(btrim(p_outcome), ''), 'snoozed_until', p_snooze_until, 'repeated', v_new is not null));
  return v_new;
end;
$$;

create or replace function public.crm_set_expiry_reminder_days(p_actor uuid, p_days integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.crm_require_owner(p_actor);
  if p_days is null or p_days < 1 or p_days > 120 then
    perform public.crm_fail('Opomnik mora biti med 1 in 120 dni pred potekom.');
  end if;
  insert into public.app_settings (key, value, updated_at, updated_by) values ('expiry_reminder_days', to_jsonb(p_days), now(), p_actor)
  on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = p_actor;
end;
$$;

-- Deletion backup / restore include expiries
create or replace function public.crm_customer_snapshot(p_customer_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'customers', (select coalesce(jsonb_agg(to_jsonb(c)), '[]') from public.customers c where c.id = p_customer_id),
    'appointments', (select coalesce(jsonb_agg(to_jsonb(a) order by a.visit_number), '[]') from public.appointments a where a.customer_id = p_customer_id),
    'caller_followups', (select coalesce(jsonb_agg(to_jsonb(f)), '[]') from public.caller_followups f where f.customer_id = p_customer_id),
    'policies', (select coalesce(jsonb_agg(to_jsonb(p)), '[]') from public.policies p where p.customer_id = p_customer_id),
    'commissions', (select coalesce(jsonb_agg(to_jsonb(c)), '[]') from public.commissions c
                      join public.policies p on p.id = c.policy_id where p.customer_id = p_customer_id),
    'commission_installments', (select coalesce(jsonb_agg(to_jsonb(i) order by i.kind, i.installment_number), '[]') from public.commission_installments i
                      join public.policies p on p.id = i.policy_id where p.customer_id = p_customer_id),
    'documents', (select coalesce(jsonb_agg(to_jsonb(d)), '[]') from public.documents d where d.customer_id = p_customer_id),
    'activity_log', (select coalesce(jsonb_agg(to_jsonb(l) order by l.id), '[]') from public.activity_log l where l.customer_id = p_customer_id),
    'customer_expiries', (select coalesce(jsonb_agg(to_jsonb(e)), '[]') from public.customer_expiries e where e.customer_id = p_customer_id),
    'lead_links', (select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'customer_id', l.customer_id, 'existing_customer_id', l.existing_customer_id)), '[]')
                     from public.leads l where l.customer_id = p_customer_id or l.existing_customer_id = p_customer_id)
  );
$$;

create or replace function public.crm_restore_customer(p_actor uuid, p_backup_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rec public.deleted_records;
  v_s jsonb;
  v_link jsonb;
begin
  perform public.crm_require_owner(p_actor);
  select * into v_rec from public.deleted_records where id = p_backup_id for update;
  if v_rec.id is null or v_rec.kind <> 'customer_deleted' then
    perform public.crm_fail('Zapis izbrisa ne obstaja.');
  end if;
  if v_rec.restored_at is not null then
    perform public.crm_fail('Stranka je že obnovljena.');
  end if;
  if exists (select 1 from public.customers where id = v_rec.customer_id) then
    perform public.crm_fail('Stranka že obstaja.');
  end if;
  v_s := v_rec.snapshot;

  perform public.crm_restore_rows('customers', v_s -> 'customers');
  perform public.crm_restore_rows('appointments', v_s -> 'appointments');
  perform public.crm_restore_rows('caller_followups', v_s -> 'caller_followups');
  perform public.crm_restore_rows('policies', v_s -> 'policies');
  perform public.crm_restore_rows('commissions', v_s -> 'commissions');
  perform public.crm_restore_rows('commission_installments', v_s -> 'commission_installments');
  perform public.crm_restore_rows('documents', v_s -> 'documents');
  perform public.crm_restore_rows('activity_log', v_s -> 'activity_log');
  perform public.crm_restore_rows('customer_expiries', coalesce(v_s -> 'customer_expiries', '[]'::jsonb));

  for v_link in select * from jsonb_array_elements(coalesce(v_s -> 'lead_links', '[]')) loop
    update public.leads
       set customer_id = coalesce(customer_id, nullif(v_link ->> 'customer_id', '')::uuid),
           existing_customer_id = coalesce(existing_customer_id, nullif(v_link ->> 'existing_customer_id', '')::uuid)
     where id = (v_link ->> 'id')::uuid;
  end loop;

  update public.deleted_records set restored_at = now(), restored_by = p_actor where id = v_rec.id;
  perform public.crm_log(v_rec.customer_id, 'customer', v_rec.customer_id, 'customer_restored', p_actor, 'team', null,
    jsonb_build_object('backup_id', v_rec.id));
  return v_rec.customer_id;
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
      and p.proname in ('crm_add_expiries', 'crm_update_expiry', 'crm_set_expiry_reminder_days', 'crm_customer_snapshot', 'crm_restore_customer')
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end;
$$;
