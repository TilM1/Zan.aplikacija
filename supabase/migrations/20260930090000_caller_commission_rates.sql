-- =============================================================================
-- Per-caller commission multiplier (with history), like agent rates.
--
-- Caller commission = monthly premium × the caller's multiplier AT SALE.
-- The multiplier is snapshotted onto commissions.caller_multiplier, so a
-- change only affects policies saved after it. History is append-only.
-- Existing callers are backfilled with the previous fixed value 1.5.
-- =============================================================================

create table public.caller_commission_rates (
  id uuid primary key default gen_random_uuid(),
  caller_id uuid not null references public.profiles (id),
  multiplier numeric(6, 3) not null check (multiplier >= 0 and multiplier <= 100),
  effective_from timestamptz not null default now(),
  set_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);
create index caller_commission_rates_caller_idx
  on public.caller_commission_rates (caller_id, effective_from desc, created_at desc);

create trigger caller_commission_rates_no_delete before delete on public.caller_commission_rates
  for each row execute function public.tg_forbid_delete();

alter table public.caller_commission_rates enable row level security;
revoke all on public.caller_commission_rates from anon, authenticated;
grant select on public.caller_commission_rates to authenticated;

-- Payroll privacy: owner sees all, a caller only their own.
create policy caller_rates_select on public.caller_commission_rates
  for select to authenticated
  using (public.crm_is_owner() or (public.crm_current_role() is not null and caller_id = (select auth.uid())));

-- Backfill: every existing caller keeps the previous fixed ×1.5 from the day they joined.
insert into public.caller_commission_rates (caller_id, multiplier, effective_from, created_at)
select p.id, 1.5, p.created_at, p.created_at
from public.profiles p
where p.role = 'caller'
  and not exists (select 1 from public.caller_commission_rates r where r.caller_id = p.id);

create or replace function public.current_caller_multiplier(p_caller_id uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select r.multiplier
  from public.caller_commission_rates r
  where r.caller_id = p_caller_id
  order by r.effective_from desc, r.created_at desc
  limit 1;
$$;

-- ---------------------------------------------------------------------------
-- Commission insert: additionally verify the caller multiplier snapshot
-- equals the caller's current multiplier (agent rate is verified in
-- crm_record_result).
-- ---------------------------------------------------------------------------
create or replace function public.crm_insert_commission(
  p_actor uuid,
  p_policy public.policies,
  p_type public.commission_beneficiary,
  p_beneficiary_id uuid,
  p_data jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_commission_id uuid;
  v_inst jsonb;
  v_sum numeric(12, 2) := 0;
  v_share numeric(7, 2) := 0;
  v_total numeric(12, 2) := (p_data ->> 'total_amount')::numeric;
  v_multiplier numeric;
begin
  if jsonb_typeof(p_data -> 'installments') <> 'array' or jsonb_array_length(p_data -> 'installments') = 0 then
    perform public.crm_fail('Manjka plačilni načrt provizije.');
  end if;

  if p_type = 'caller' then
    v_multiplier := public.current_caller_multiplier(p_beneficiary_id);
    if v_multiplier is null then
      perform public.crm_fail('Klicatelj nima nastavljene provizije. Obrnite se na lastnika.');
    end if;
    if (p_data ->> 'caller_multiplier')::numeric <> v_multiplier then
      perform public.crm_fail('Provizija klicatelja se je medtem spremenila. Poskusite znova.');
    end if;
  end if;

  insert into public.commissions
    (policy_id, beneficiary_id, beneficiary_type, base_monthly_premium, base_duration_years,
     rate_percent, caller_multiplier, total_amount, policy_date, rule_version, calculation)
  values
    (p_policy.id, p_beneficiary_id, p_type, p_policy.monthly_premium,
     case when p_type = 'agent' then p_policy.duration_years end,
     case when p_type = 'agent' then (p_data ->> 'rate_percent')::numeric end,
     case when p_type = 'caller' then (p_data ->> 'caller_multiplier')::numeric end,
     v_total, p_policy.policy_date, p_data ->> 'rule_version', coalesce(p_data -> 'calculation', '{}'::jsonb))
  returning id into v_commission_id;

  for v_inst in select * from jsonb_array_elements(p_data -> 'installments') loop
    insert into public.commission_installments
      (commission_id, policy_id, beneficiary_id, beneficiary_type, installment_number,
       share_percent, amount, due_date, original_due_date)
    values
      (v_commission_id, p_policy.id, p_beneficiary_id, p_type, (v_inst ->> 'number')::smallint,
       (v_inst ->> 'share_percent')::numeric, (v_inst ->> 'amount')::numeric,
       (v_inst ->> 'due_date')::date, (v_inst ->> 'due_date')::date);
    v_sum := v_sum + (v_inst ->> 'amount')::numeric;
    v_share := v_share + (v_inst ->> 'share_percent')::numeric;
  end loop;

  if v_sum <> v_total or v_share <> 100 then
    perform public.crm_fail('Obroki provizije se ne ujemajo s skupnim zneskom.');
  end if;

  perform public.crm_log(p_policy.customer_id, 'commission', v_commission_id, 'commission_generated', p_actor,
    'owner', null,
    jsonb_build_object('beneficiary_type', p_type, 'beneficiary_id', p_beneficiary_id, 'total_amount', v_total,
                       'policy_id', p_policy.id));
  return v_commission_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Owner sets a caller's multiplier (new history row; never retroactive)
-- ---------------------------------------------------------------------------
create or replace function public.crm_set_caller_multiplier(
  p_actor uuid,
  p_caller_id uuid,
  p_multiplier numeric
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old numeric := public.current_caller_multiplier(p_caller_id);
  v_role public.user_role;
begin
  perform public.crm_require_owner(p_actor);
  select p.role into v_role from public.profiles p where p.id = p_caller_id;
  if v_role is distinct from 'caller' then
    perform public.crm_fail('Provizijo klicatelja je mogoče nastaviti samo klicatelju.');
  end if;
  if p_multiplier is null or p_multiplier < 0 or p_multiplier > 100 then
    perform public.crm_fail('Faktor provizije mora biti med 0 in 100.');
  end if;
  if v_old is not distinct from p_multiplier then
    return;
  end if;

  insert into public.caller_commission_rates (caller_id, multiplier, set_by)
  values (p_caller_id, p_multiplier, p_actor);

  perform public.crm_log(null, 'profile', p_caller_id, 'caller_multiplier_changed', p_actor, 'owner',
    jsonb_build_object('multiplier', v_old), jsonb_build_object('multiplier', p_multiplier));
end;
$$;

-- ---------------------------------------------------------------------------
-- Employee creation: optional caller multiplier (defaults to 1.5 for callers)
-- ---------------------------------------------------------------------------
drop function if exists public.crm_create_employee_profile(uuid, uuid, jsonb, numeric);

create or replace function public.crm_create_employee_profile(
  p_actor uuid,
  p_user_id uuid,
  p_profile jsonb,
  p_rate_percent numeric default null,
  p_caller_multiplier numeric default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.user_role := (p_profile ->> 'role')::public.user_role;
begin
  perform public.crm_require_owner(p_actor);
  insert into public.profiles (id, first_name, last_name, email, phone, role)
  values (p_user_id, btrim(p_profile ->> 'first_name'), btrim(p_profile ->> 'last_name'),
          lower(btrim(p_profile ->> 'email')), nullif(btrim(p_profile ->> 'phone'), ''), v_role);

  if v_role in ('agent', 'owner') and p_rate_percent is not null then
    insert into public.agent_commission_rates (agent_id, rate_percent, set_by)
    values (p_user_id, p_rate_percent, p_actor);
  end if;
  if v_role = 'caller' then
    insert into public.caller_commission_rates (caller_id, multiplier, set_by)
    values (p_user_id, coalesce(p_caller_multiplier, 1.5), p_actor);
  end if;

  perform public.crm_log(null, 'profile', p_user_id, 'employee_created', p_actor, 'owner', null,
    jsonb_build_object('role', v_role, 'email', lower(btrim(p_profile ->> 'email')),
                       'rate_percent', p_rate_percent,
                       'caller_multiplier', case when v_role = 'caller' then coalesce(p_caller_multiplier, 1.5) end));
end;
$$;

-- Role change to caller without a multiplier: give the default so sales never fail silently.
create or replace function public.tg_profiles_default_caller_multiplier()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.role = 'caller' and not exists (select 1 from public.caller_commission_rates r where r.caller_id = new.id) then
    insert into public.caller_commission_rates (caller_id, multiplier) values (new.id, 1.5);
  end if;
  return new;
end;
$$;
create trigger profiles_default_caller_multiplier after update of role on public.profiles
  for each row execute function public.tg_profiles_default_caller_multiplier();

-- ---------------------------------------------------------------------------
-- Demo purge must also remove demo callers' multiplier history
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

-- Execute privileges: service_role only
do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('current_caller_multiplier', 'crm_insert_commission', 'crm_set_caller_multiplier',
                        'crm_create_employee_profile', 'crm_purge_demo_data', 'tg_profiles_default_caller_multiplier')
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end;
$$;
