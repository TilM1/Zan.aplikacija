-- =============================================================================
-- Agency commission (what the insurer pays the agency) → owner's earnings
--   standard products:         premium × 12 × years × agency % (default 6 %)
--   agent_multiplier products: premium × agency number (Specialisti: 10.25)
-- Snapshotted per policy at sale in an OWNER-ONLY table; product settings
-- changes affect only new policies. Owner earnings = agency − agent − caller
-- (when the owner sells himself, the agent part is his own).
-- =============================================================================

alter table public.products
  add column agency_rate_percent numeric(5, 2) not null default 6 check (agency_rate_percent >= 0 and agency_rate_percent <= 100),
  add column agency_multiplier numeric(8, 3) check (agency_multiplier >= 0 and agency_multiplier <= 1000);
update public.products set agency_multiplier = 10.25 where name = 'Specialisti';

create table public.policy_agency_commissions (
  policy_id uuid primary key references public.policies (id) on delete cascade,
  calc_model text not null check (calc_model in ('standard', 'agent_multiplier')),
  base_monthly_premium numeric(12, 2) not null,
  base_duration_years integer not null,
  rate numeric(8, 3) not null,
  total_amount numeric(12, 2) not null,
  created_at timestamptz not null default now(),
  constraint policy_agency_formula check (
    (calc_model = 'standard' and total_amount = round(base_monthly_premium * 12 * base_duration_years * rate / 100, 2))
    or (calc_model = 'agent_multiplier' and total_amount = round(base_monthly_premium * rate, 2))
  )
);

alter table public.policy_agency_commissions enable row level security;
revoke all on public.policy_agency_commissions from anon, authenticated;
grant select on public.policy_agency_commissions to authenticated;
create policy policy_agency_commissions_select on public.policy_agency_commissions
  for select to authenticated using (public.crm_is_owner());

create or replace function public.tg_policy_agency_commission()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product public.products;
  v_rate numeric;
begin
  if coalesce(current_setting('crm.restoring', true), '') = 'on' then
    return new; -- restore brings its own original snapshot
  end if;
  select * into v_product from public.products where id = new.product_id;
  v_rate := case when v_product.commission_model = 'agent_multiplier' then coalesce(v_product.agency_multiplier, 0)
                 else v_product.agency_rate_percent end;
  insert into public.policy_agency_commissions (policy_id, calc_model, base_monthly_premium, base_duration_years, rate, total_amount)
  values (new.id, v_product.commission_model, new.monthly_premium, new.duration_years, v_rate,
          case when v_product.commission_model = 'agent_multiplier' then round(new.monthly_premium * v_rate, 2)
               else round(new.monthly_premium * 12 * new.duration_years * v_rate / 100, 2) end)
  on conflict (policy_id) do nothing;
  return new;
end;
$$;
create trigger policies_agency_commission after insert on public.policies
  for each row execute function public.tg_policy_agency_commission();

-- Backfill existing policies with the current product settings
insert into public.policy_agency_commissions (policy_id, calc_model, base_monthly_premium, base_duration_years, rate, total_amount)
select po.id, pr.commission_model, po.monthly_premium, po.duration_years,
       case when pr.commission_model = 'agent_multiplier' then coalesce(pr.agency_multiplier, 0) else pr.agency_rate_percent end,
       case when pr.commission_model = 'agent_multiplier' then round(po.monthly_premium * coalesce(pr.agency_multiplier, 0), 2)
            else round(po.monthly_premium * 12 * po.duration_years * pr.agency_rate_percent / 100, 2) end
from public.policies po join public.products pr on pr.id = po.product_id
on conflict do nothing;

-- Deletion backup / restore include the agency snapshot
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
    'policy_agency_commissions', (select coalesce(jsonb_agg(to_jsonb(g)), '[]') from public.policy_agency_commissions g
                      join public.policies p on p.id = g.policy_id where p.customer_id = p_customer_id),
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
  -- Restore the ORIGINAL agency snapshot, not a recalculation at today's rates
  perform set_config('crm.restoring', 'on', true);
  perform public.crm_restore_rows('policies', v_s -> 'policies');
  perform set_config('crm.restoring', 'off', true);
  perform public.crm_restore_rows('policy_agency_commissions', coalesce(v_s -> 'policy_agency_commissions', '[]'::jsonb));
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

-- Products: owner sets agency % / agency number
drop function if exists public.crm_upsert_product(uuid, uuid, text, boolean, integer, text);
create or replace function public.crm_upsert_product(
  p_actor uuid,
  p_product_id uuid,
  p_name text,
  p_is_active boolean,
  p_sort_order integer,
  p_commission_model text default null,
  p_agency_rate_percent numeric default null,
  p_agency_multiplier numeric default null
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
  if p_agency_rate_percent is not null and (p_agency_rate_percent < 0 or p_agency_rate_percent > 100) then
    perform public.crm_fail('Provizija agencije mora biti med 0 in 100 %.');
  end if;
  if p_agency_multiplier is not null and (p_agency_multiplier < 0 or p_agency_multiplier > 1000) then
    perform public.crm_fail('Število za agencijo mora biti med 0 in 1000.');
  end if;
  if p_product_id is null then
    insert into public.products (name, is_active, sort_order, commission_model, agency_rate_percent, agency_multiplier)
    values (btrim(p_name), coalesce(p_is_active, true), coalesce(p_sort_order, 0), coalesce(p_commission_model, 'standard'),
            coalesce(p_agency_rate_percent, 6), p_agency_multiplier)
    returning id into v_id;
  else
    update public.products p
       set name = btrim(p_name), is_active = coalesce(p_is_active, p.is_active),
           sort_order = coalesce(p_sort_order, p.sort_order),
           commission_model = coalesce(p_commission_model, p.commission_model),
           agency_rate_percent = coalesce(p_agency_rate_percent, p.agency_rate_percent),
           agency_multiplier = coalesce(p_agency_multiplier, p.agency_multiplier)
     where p.id = p_product_id
    returning id into v_id;
  end if;
  perform public.crm_log(null, 'product', v_id, 'product_saved', p_actor, 'owner', null,
    jsonb_build_object('name', btrim(p_name), 'is_active', p_is_active, 'commission_model', p_commission_model,
                       'agency_rate_percent', p_agency_rate_percent, 'agency_multiplier', p_agency_multiplier));
  return v_id;
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
      and p.proname in ('crm_customer_snapshot', 'crm_restore_customer', 'crm_upsert_product', 'tg_policy_agency_commission')
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end;
$$;
