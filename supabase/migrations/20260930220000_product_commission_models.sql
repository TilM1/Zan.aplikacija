-- =============================================================================
-- Product commission models
--   standard          agent: premium × 12 × years × agent rate %, 55/20/25
--   agent_multiplier  agent: premium × the agent's own multiplier for that
--                     product (history per agent), 11 monthly installments
--                     50/15/10/5/5/2.5×6 (e.g. "Specialisti")
-- The caller commission is unchanged. Existing commissions keep their snapshot.
-- =============================================================================

alter table public.products
  add column commission_model text not null default 'standard'
  check (commission_model in ('standard', 'agent_multiplier'));
update public.products set commission_model = 'agent_multiplier' where name = 'Specialisti';

create table public.agent_product_multipliers (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.profiles (id),
  product_id uuid not null references public.products (id),
  multiplier numeric(8, 3) not null check (multiplier >= 0 and multiplier <= 1000),
  effective_from timestamptz not null default now(),
  set_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);
create index agent_product_multipliers_idx on public.agent_product_multipliers (agent_id, product_id, effective_from desc, created_at desc);
create trigger agent_product_multipliers_no_delete before delete on public.agent_product_multipliers
  for each row execute function public.tg_forbid_delete();

alter table public.agent_product_multipliers enable row level security;
revoke all on public.agent_product_multipliers from anon, authenticated;
grant select on public.agent_product_multipliers to authenticated;
create policy agent_product_multipliers_select on public.agent_product_multipliers
  for select to authenticated
  using (public.crm_is_owner() or (public.crm_current_role() is not null and agent_id = (select auth.uid())));

create or replace function public.current_agent_product_multiplier(p_agent_id uuid, p_product_id uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select m.multiplier from public.agent_product_multipliers m
  where m.agent_id = p_agent_id and m.product_id = p_product_id
  order by m.effective_from desc, m.created_at desc
  limit 1;
$$;

-- Commission snapshot of the model used
alter table public.commissions
  add column calc_model text not null default 'standard' check (calc_model in ('standard', 'agent_multiplier')),
  add column agent_multiplier numeric(8, 3);

alter table public.commissions drop constraint commissions_agent_formula;
alter table public.commissions add constraint commissions_agent_formula check (
  beneficiary_type <> 'agent'
  or (calc_model = 'standard' and rate_percent is not null and base_duration_years is not null
      and total_amount = round(base_monthly_premium * 12 * base_duration_years * rate_percent / 100, 2))
  or (calc_model = 'agent_multiplier' and agent_multiplier is not null
      and total_amount = round(base_monthly_premium * agent_multiplier, 2))
);

-- ---------------------------------------------------------------------------
-- Commission insert: validates the agent snapshot against the product model
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
  v_rate numeric;
  v_model text := 'standard';
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
  else
    select commission_model into v_model from public.products where id = p_policy.product_id;
    if v_model = 'agent_multiplier' then
      v_multiplier := public.current_agent_product_multiplier(p_beneficiary_id, p_policy.product_id);
      if v_multiplier is null then
        perform public.crm_fail('Zastopnik nima nastavljene provizije za produkt »' || p_policy.product_name || '«. Obrnite se na lastnika.');
      end if;
      if coalesce(p_data ->> 'calc_model', '') <> 'agent_multiplier' or (p_data ->> 'agent_multiplier')::numeric <> v_multiplier then
        perform public.crm_fail('Provizija zastopnika za »' || p_policy.product_name || '« se je medtem spremenila. Poskusite znova.');
      end if;
    else
      v_rate := public.current_agent_rate(p_beneficiary_id);
      if v_rate is null then
        perform public.crm_fail('Zastopnik nima nastavljenega odstotka provizije. Obrnite se na lastnika.');
      end if;
      if coalesce(p_data ->> 'calc_model', 'standard') <> 'standard' or (p_data ->> 'rate_percent')::numeric <> v_rate then
        perform public.crm_fail('Odstotek provizije zastopnika se je medtem spremenil. Poskusite znova.');
      end if;
    end if;
  end if;

  insert into public.commissions
    (policy_id, beneficiary_id, beneficiary_type, base_monthly_premium, base_duration_years,
     rate_percent, caller_multiplier, calc_model, agent_multiplier, total_amount, policy_date, rule_version, calculation)
  values
    (p_policy.id, p_beneficiary_id, p_type, p_policy.monthly_premium,
     case when p_type = 'agent' then p_policy.duration_years end,
     case when p_type = 'agent' and v_model = 'standard' then (p_data ->> 'rate_percent')::numeric end,
     case when p_type = 'caller' then (p_data ->> 'caller_multiplier')::numeric end,
     case when p_type = 'agent' then v_model else 'standard' end,
     case when p_type = 'agent' and v_model = 'agent_multiplier' then (p_data ->> 'agent_multiplier')::numeric end,
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

-- Result recording: rate requirements are now checked per policy/product in crm_insert_commission
create or replace function public.crm_record_result(
  p_actor uuid,
  p_appointment_id uuid,
  p_result public.consultation_result,
  p_note text default null,
  p_next jsonb default null,
  p_policies jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.user_role := public.crm_require_actor(p_actor);
  v_appt public.appointments;
  v_customer public.customers;
  v_next_id uuid;
  v_followup_id uuid;
  v_policy public.policies;
  v_policy_ids uuid[] := '{}';
  v_item jsonb;
  v_product public.products;
  v_rate numeric;
  v_caller_id uuid;
  v_status public.customer_status;
begin
  select * into v_appt from public.appointments a where a.id = p_appointment_id for update;
  if v_appt.id is null then
    perform public.crm_fail('Termin ne obstaja.');
  end if;
  if v_role <> 'owner' and v_appt.agent_id <> p_actor then
    perform public.crm_fail('Rezultat lahko vnese samo zastopnik termina ali lastnik.');
  end if;
  if v_appt.status <> 'scheduled' then
    perform public.crm_fail('Rezultat za ta termin je že vnesen ali je termin preklican.');
  end if;

  select * into v_customer from public.customers c where c.id = v_appt.customer_id for update;

  update public.appointments a
     set status = 'completed', result = p_result, result_note = nullif(btrim(p_note), ''),
         completed_at = now(), completed_by = p_actor
   where a.id = v_appt.id;

  perform public.crm_log(v_appt.customer_id, 'appointment', v_appt.id, 'consultation_completed', p_actor, 'team',
    jsonb_build_object('status', 'scheduled'),
    jsonb_build_object('status', 'completed', 'result', p_result, 'note', nullif(btrim(p_note), '')),
    jsonb_build_object('agent_id', v_appt.agent_id, 'visit_number', v_appt.visit_number));

  if p_result = 'A' then
    if p_next is null or nullif(p_next ->> 'agent_id', '') is null or nullif(p_next ->> 'scheduled_at', '') is null then
      perform public.crm_fail('Za status A sta obvezna nov termin in zastopnik.');
    end if;
    v_next_id := public.crm_insert_appointment(
      p_actor, v_appt.customer_id, (p_next ->> 'agent_id')::uuid, v_appt.caller_id,
      (p_next ->> 'scheduled_at')::timestamptz,
      nullif(p_next ->> 'duration_minutes', '')::integer,
      v_appt.location, v_appt.postal_code, p_next ->> 'note', v_appt.id, 'result_A');
    if (p_next ->> 'agent_id')::uuid <> v_appt.agent_id then
      perform public.crm_log(v_appt.customer_id, 'appointment', v_next_id, 'appointment_reassigned', p_actor, 'team',
        jsonb_build_object('agent_id', v_appt.agent_id), jsonb_build_object('agent_id', (p_next ->> 'agent_id')::uuid));
    end if;
    v_status := 'scheduled';

  elsif p_result = 'A0' then
    v_status := 'lost';

  elsif p_result = 'B' then
    v_caller_id := coalesce(v_appt.caller_id, v_customer.responsible_caller_id);
    insert into public.caller_followups (customer_id, caller_id, source_appointment_id, reason, note)
    values (v_appt.customer_id, v_caller_id, v_appt.id, 'B', nullif(btrim(p_note), ''))
    returning id into v_followup_id;
    perform public.crm_log(v_appt.customer_id, 'caller_followup', v_followup_id, 'followup_created', p_actor, 'team',
      null, jsonb_build_object('caller_id', v_caller_id, 'source_appointment_id', v_appt.id));
    v_status := 'callback';

  elsif p_result = 'A1' then
    if p_policies is null or jsonb_typeof(p_policies) <> 'array' or jsonb_array_length(p_policies) = 0 then
      perform public.crm_fail('Za status A1 je obvezna vsaj ena polica.');
    end if;


    for v_item in select * from jsonb_array_elements(p_policies) loop
      select * into v_product from public.products p where p.id = (v_item ->> 'product_id')::uuid;
      if v_product.id is null or not v_product.is_active then
        perform public.crm_fail('Izbrani produkt ne obstaja ali ni aktiven.');
      end if;
      if (v_appt.caller_id is null) <> (v_item -> 'caller_commission' is null or jsonb_typeof(v_item -> 'caller_commission') = 'null') then
        perform public.crm_fail('Provizija klicatelja se ne ujema s terminom.');
      end if;

      insert into public.policies
        (customer_id, appointment_id, product_id, product_name, policy_number, monthly_premium,
         duration_years, policy_date, agent_id, caller_id, note, created_by)
      values
        (v_appt.customer_id, v_appt.id, v_product.id, v_product.name,
         nullif(btrim(v_item ->> 'policy_number'), ''),
         (v_item ->> 'monthly_premium')::numeric, (v_item ->> 'duration_years')::integer,
         (v_item ->> 'policy_date')::date, v_appt.agent_id, v_appt.caller_id,
         nullif(btrim(v_item ->> 'note'), ''), p_actor)
      returning * into v_policy;

      v_policy_ids := v_policy_ids || v_policy.id;

      perform public.crm_log(v_appt.customer_id, 'policy', v_policy.id, 'policy_created', p_actor, 'team', null,
        jsonb_build_object('product', v_product.name, 'monthly_premium', v_policy.monthly_premium,
                           'duration_years', v_policy.duration_years, 'policy_date', v_policy.policy_date,
                           'agent_id', v_policy.agent_id, 'caller_id', v_policy.caller_id));

      perform public.crm_insert_commission(p_actor, v_policy, 'agent', v_appt.agent_id, v_item -> 'agent_commission');
      if v_appt.caller_id is not null then
        perform public.crm_insert_commission(p_actor, v_policy, 'caller', v_appt.caller_id, v_item -> 'caller_commission');
      end if;
    end loop;
    v_status := 'won';
  end if;

  update public.customers c
     set status = v_status,
         last_result = p_result,
         current_agent_id = case when p_result = 'A' then (p_next ->> 'agent_id')::uuid else c.current_agent_id end
   where c.id = v_appt.customer_id;

  if v_customer.status is distinct from v_status then
    perform public.crm_log(v_appt.customer_id, 'customer', v_appt.customer_id, 'status_changed', p_actor, 'team',
      jsonb_build_object('status', v_customer.status), jsonb_build_object('status', v_status, 'result', p_result));
  end if;

  return jsonb_build_object(
    'appointment_id', v_appt.id,
    'next_appointment_id', v_next_id,
    'followup_id', v_followup_id,
    'policy_ids', to_jsonb(v_policy_ids)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Owner: set an agent's multiplier for a product (history, never retroactive)
-- ---------------------------------------------------------------------------
create or replace function public.crm_set_agent_product_multiplier(
  p_actor uuid,
  p_agent_id uuid,
  p_product_id uuid,
  p_multiplier numeric
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old numeric := public.current_agent_product_multiplier(p_agent_id, p_product_id);
  v_product public.products;
begin
  perform public.crm_require_owner(p_actor);
  if coalesce(public.crm_role_of(p_agent_id)::text, '') not in ('agent', 'owner') then
    perform public.crm_fail('Provizijo je mogoče nastaviti samo zastopniku ali lastniku.');
  end if;
  select * into v_product from public.products where id = p_product_id;
  if v_product.id is null or v_product.commission_model <> 'agent_multiplier' then
    perform public.crm_fail('Ta produkt ne uporablja provizije »premija × število«.');
  end if;
  if p_multiplier is null or p_multiplier < 0 or p_multiplier > 1000 then
    perform public.crm_fail('Število mora biti med 0 in 1000.');
  end if;
  if v_old is not distinct from p_multiplier then
    return;
  end if;
  insert into public.agent_product_multipliers (agent_id, product_id, multiplier, set_by)
  values (p_agent_id, p_product_id, p_multiplier, p_actor);
  perform public.crm_log(null, 'profile', p_agent_id, 'agent_product_multiplier_changed', p_actor, 'owner',
    jsonb_build_object('multiplier', v_old), jsonb_build_object('multiplier', p_multiplier, 'product', v_product.name));
end;
$$;

-- Products: commission model is owner-configurable (applies to new policies only)
drop function if exists public.crm_upsert_product(uuid, uuid, text, boolean, integer);
create or replace function public.crm_upsert_product(
  p_actor uuid,
  p_product_id uuid,
  p_name text,
  p_is_active boolean,
  p_sort_order integer,
  p_commission_model text default null
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
  if nullif(btrim(p_name), '') is null then
    perform public.crm_fail('Ime produkta je obvezno.');
  end if;
  if p_commission_model is not null and p_commission_model not in ('standard', 'agent_multiplier') then
    perform public.crm_fail('Neznan model provizije.');
  end if;
  if p_product_id is null then
    insert into public.products (name, is_active, sort_order, commission_model)
    values (btrim(p_name), coalesce(p_is_active, true), coalesce(p_sort_order, 0), coalesce(p_commission_model, 'standard'))
    returning id into v_id;
  else
    update public.products p
       set name = btrim(p_name), is_active = coalesce(p_is_active, p.is_active),
           sort_order = coalesce(p_sort_order, p.sort_order),
           commission_model = coalesce(p_commission_model, p.commission_model)
     where p.id = p_product_id
    returning id into v_id;
  end if;
  perform public.crm_log(null, 'product', v_id, 'product_saved', p_actor, 'owner', null,
    jsonb_build_object('name', btrim(p_name), 'is_active', p_is_active, 'commission_model', p_commission_model));
  return v_id;
end;
$$;

-- Demo purge also removes demo agents' product multipliers
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

  delete from public.deleted_records where customer_id = any (v_customers) or created_by = any (v_profiles);
  update public.deleted_records set restored_by = null where restored_by = any (v_profiles);
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
  update public.leads set customer_id = null where customer_id = any (v_customers);
  update public.leads set existing_customer_id = null where existing_customer_id = any (v_customers);
  delete from public.customers where id = any (v_customers);
  delete from public.lead_lists where imported_by = any (v_profiles);
  update public.lead_lists set assigned_caller_id = null where assigned_caller_id = any (v_profiles);
  update public.leads set last_contacted_by = null where last_contacted_by = any (v_profiles);
  update public.lead_events set actor_id = null where actor_id = any (v_profiles);
  update public.lead_suppressions set created_by = null where created_by = any (v_profiles);
  update public.app_settings set updated_by = null where updated_by = any (v_profiles);
  delete from public.agent_product_multipliers where agent_id = any (v_profiles);
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

do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('current_agent_product_multiplier', 'crm_insert_commission', 'crm_record_result',
                        'crm_set_agent_product_multiplier', 'crm_upsert_product', 'crm_purge_demo_data')
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end;
$$;
