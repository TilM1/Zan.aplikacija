-- =============================================================================
-- Two caller tariffs, both set by the Owner per caller (with history):
--   standard – customer from a regular (imported) call list or booked directly
--   live     – customer from a LIVE list (ads / Google Sheets)
-- The tariff is fixed on the customer when the contact is turned into an
-- appointment, and the multiplier valid at the time of sale is snapshotted on
-- the commission as before (never retroactive). A caller without a live tariff
-- gets the standard one.
-- =============================================================================

alter table public.caller_commission_rates
  add column tariff text not null default 'standard' check (tariff in ('standard', 'live'));
drop index if exists public.caller_commission_rates_caller_idx;
create index caller_commission_rates_caller_idx
  on public.caller_commission_rates (caller_id, tariff, effective_from desc, created_at desc);

alter table public.customers
  add column caller_tariff text not null default 'standard' check (caller_tariff in ('standard', 'live'));

-- Customers restored from a deletion backup made before this column existed
create or replace function public.tg_customers_default_tariff()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.caller_tariff := coalesce(new.caller_tariff, 'standard');
  return new;
end;
$$;
create trigger customers_default_tariff before insert on public.customers
  for each row execute function public.tg_customers_default_tariff();

-- Existing customers that came from a live list
update public.customers c
   set caller_tariff = 'live'
  from public.leads l
  join public.lead_lists ll on ll.id = l.list_id
 where l.customer_id = c.id and ll.kind = 'live';

-- A contact from a live list becomes a customer → the customer gets the live tariff
create or replace function public.tg_leads_customer_tariff()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.customer_id is not null
     and exists (select 1 from public.lead_lists ll where ll.id = new.list_id and ll.kind = 'live') then
    update public.customers c set caller_tariff = 'live' where c.id = new.customer_id and c.caller_tariff <> 'live';
  end if;
  return new;
end;
$$;
create trigger leads_customer_tariff after update of customer_id on public.leads
  for each row execute function public.tg_leads_customer_tariff();

-- Standard tariff (unchanged meaning)
create or replace function public.current_caller_multiplier(p_caller_id uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select r.multiplier
  from public.caller_commission_rates r
  where r.caller_id = p_caller_id and r.tariff = 'standard'
  order by r.effective_from desc, r.created_at desc
  limit 1;
$$;

-- Multiplier for a tariff; live falls back to standard when the Owner has not set it
create or replace function public.current_caller_multiplier_for(p_caller_id uuid, p_tariff text)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select r.multiplier
       from public.caller_commission_rates r
      where r.caller_id = p_caller_id and r.tariff = coalesce(p_tariff, 'standard')
      order by r.effective_from desc, r.created_at desc
      limit 1),
    public.current_caller_multiplier(p_caller_id));
$$;

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
    -- Tariff follows the customer's origin: live list (ads) or regular call list
    v_multiplier := public.current_caller_multiplier_for(
      p_beneficiary_id, (select c.caller_tariff from public.customers c where c.id = p_policy.customer_id));
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

-- Owner sets a caller's multiplier for one tariff (new history row; never retroactive)
drop function if exists public.crm_set_caller_multiplier(uuid, uuid, numeric);
create or replace function public.crm_set_caller_multiplier(
  p_actor uuid,
  p_caller_id uuid,
  p_multiplier numeric,
  p_tariff text default 'standard'
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old numeric;
  v_role public.user_role;
begin
  perform public.crm_require_owner(p_actor);
  select p.role into v_role from public.profiles p where p.id = p_caller_id;
  if v_role is distinct from 'caller' then
    perform public.crm_fail('Provizijo klicatelja je mogoče nastaviti samo klicatelju.');
  end if;
  if p_tariff is null or p_tariff not in ('standard', 'live') then
    perform public.crm_fail('Neznana tarifa.');
  end if;
  if p_multiplier is null or p_multiplier < 0 or p_multiplier > 100 then
    perform public.crm_fail('Faktor provizije mora biti med 0 in 100.');
  end if;
  select r.multiplier into v_old
    from public.caller_commission_rates r
   where r.caller_id = p_caller_id and r.tariff = p_tariff
   order by r.effective_from desc, r.created_at desc
   limit 1;
  if v_old is not distinct from p_multiplier then
    return;
  end if;

  insert into public.caller_commission_rates (caller_id, tariff, multiplier, set_by)
  values (p_caller_id, p_tariff, p_multiplier, p_actor);

  perform public.crm_log(null, 'profile', p_caller_id, 'caller_multiplier_changed', p_actor, 'owner',
    jsonb_build_object('multiplier', v_old, 'tariff', p_tariff), jsonb_build_object('multiplier', p_multiplier, 'tariff', p_tariff));
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
      and p.proname in ('current_caller_multiplier', 'current_caller_multiplier_for', 'crm_insert_commission',
                        'crm_set_caller_multiplier', 'tg_leads_customer_tariff', 'tg_customers_default_tariff')
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end;
$$;
