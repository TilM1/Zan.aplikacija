-- =============================================================================
-- Storno (policy cancellation after insurer rejection) and customer deletion,
-- both with a restorable backup in deleted_records.
--
-- Storno of a policy:
--   * unpaid installments → cancelled
--   * already PAID installments → a clawback (negative) installment is added,
--     due on the next payout date, so it is deducted from the next payout
--   * paid history is never modified
-- Customer deletion: only when nothing has been paid for the customer yet
-- (otherwise use storno). Full snapshot kept for restore.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Maintenance flag: lets specific SECURITY DEFINER functions bypass the
-- delete/immutability guards inside their own transaction.
-- ---------------------------------------------------------------------------
create or replace function public.crm_maintenance_allowed()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(current_setting('crm.allow_demo_purge', true), '') = 'on'
      or coalesce(current_setting('crm.allow_maintenance', true), '') = 'on';
$$;

create or replace function public.tg_forbid_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if public.crm_maintenance_allowed() then
    return old;
  end if;
  raise exception 'Deleting % records is not allowed. Use archive/deactivate/cancel instead.', tg_table_name
    using errcode = 'P0001';
end;
$$;

create or replace function public.tg_activity_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and public.crm_maintenance_allowed() then
    return old;
  end if;
  raise exception 'activity_log is append-only' using errcode = 'P0001';
end;
$$;

create or replace function public.tg_installments_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(current_setting('crm.allow_storno_revert', true), '') = 'on' then
    return new; -- only used by crm_revert_storno
  end if;
  if old.status <> 'scheduled' then
    raise exception 'Installment % is % and can no longer be modified', old.id, old.status
      using errcode = 'P0001';
  end if;
  if new.commission_id is distinct from old.commission_id
     or new.policy_id is distinct from old.policy_id
     or new.beneficiary_id is distinct from old.beneficiary_id
     or new.beneficiary_type is distinct from old.beneficiary_type
     or new.installment_number is distinct from old.installment_number
     or new.share_percent is distinct from old.share_percent
     or new.amount is distinct from old.amount
     or new.original_due_date is distinct from old.original_due_date then
    raise exception 'Installment amounts and identity are immutable' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Ledger: clawback installments (negative amounts)
-- ---------------------------------------------------------------------------
create type public.installment_kind as enum ('regular', 'clawback');

alter table public.commission_installments
  add column kind public.installment_kind not null default 'regular',
  add column reverses_installment_id uuid references public.commission_installments (id);

alter table public.commission_installments drop constraint commission_installments_amount_check;
alter table public.commission_installments drop constraint commission_installments_installment_number_check;
alter table public.commission_installments
  add constraint commission_installments_amount_sign check (
    (kind = 'regular' and amount >= 0) or (kind = 'clawback' and amount < 0 and reverses_installment_id is not null)
  ),
  add constraint commission_installments_number_range check (
    (kind = 'regular' and installment_number between 1 and 12)
    or (kind = 'clawback' and installment_number between 101 and 112)
  );

alter table public.policies
  add column cancel_reason text,
  add column cancelled_by uuid references public.profiles (id);

-- ---------------------------------------------------------------------------
-- Backup of storno / deletions
-- ---------------------------------------------------------------------------
create table public.deleted_records (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('customer_deleted', 'policy_storno')),
  customer_id uuid not null,         -- no FK: the customer may no longer exist
  customer_name text not null,
  policy_id uuid,
  summary text not null,
  reason text not null,
  snapshot jsonb not null,
  meta jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  restored_at timestamptz,
  restored_by uuid references public.profiles (id)
);
create index deleted_records_created_idx on public.deleted_records (created_at desc);
create index deleted_records_customer_idx on public.deleted_records (customer_id);

alter table public.deleted_records enable row level security;
revoke all on public.deleted_records from anon, authenticated;
grant select on public.deleted_records to authenticated;
create policy deleted_records_select on public.deleted_records
  for select to authenticated using (public.crm_is_owner());

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
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
    'lead_links', (select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'customer_id', l.customer_id, 'existing_customer_id', l.existing_customer_id)), '[]')
                     from public.leads l where l.customer_id = p_customer_id or l.existing_customer_id = p_customer_id)
  );
$$;

-- Insert rows (jsonb array of to_jsonb(row)) back into a table, skipping generated/identity columns.
create or replace function public.crm_restore_rows(p_table text, p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cols text;
  v_count integer;
begin
  if p_rows is null or jsonb_array_length(p_rows) = 0 then
    return 0;
  end if;
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into v_cols
  from information_schema.columns
  where table_schema = 'public' and table_name = p_table and is_generated = 'NEVER' and is_identity = 'NO';
  execute format('insert into public.%I (%s) select %s from jsonb_populate_recordset(null::public.%I, $1)',
                 p_table, v_cols, v_cols, p_table) using p_rows;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Storno of one policy
-- ---------------------------------------------------------------------------
create or replace function public.crm_storno_policy(
  p_actor uuid,
  p_policy_id uuid,
  p_reason text,
  p_clawback_due date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_policy public.policies;
  v_customer public.customers;
  v_inst public.commission_installments;
  v_cancelled uuid[] := '{}';
  v_clawbacks uuid[] := '{}';
  v_cancelled_sum numeric(12, 2) := 0;
  v_clawback_sum numeric(12, 2) := 0;
  v_new_id uuid;
  v_backup uuid;
  v_snapshot jsonb;
begin
  perform public.crm_require_owner(p_actor);
  if nullif(btrim(p_reason), '') is null then
    perform public.crm_fail('Vnesite razlog storna.');
  end if;
  if p_clawback_due is null or p_clawback_due < current_date then
    perform public.crm_fail('Datum odbitka mora biti danes ali kasneje.');
  end if;

  select * into v_policy from public.policies where id = p_policy_id for update;
  if v_policy.id is null then
    perform public.crm_fail('Polica ne obstaja.');
  end if;
  if v_policy.status <> 'active' then
    perform public.crm_fail('Polica je že stornirana.');
  end if;
  select * into v_customer from public.customers where id = v_policy.customer_id for update;

  -- Backup before any change
  v_snapshot := jsonb_build_object(
    'policies', jsonb_build_array(to_jsonb(v_policy)),
    'commissions', (select coalesce(jsonb_agg(to_jsonb(c)), '[]') from public.commissions c where c.policy_id = p_policy_id),
    'commission_installments', (select coalesce(jsonb_agg(to_jsonb(i)), '[]') from public.commission_installments i where i.policy_id = p_policy_id)
  );

  for v_inst in
    select * from public.commission_installments i
    where i.policy_id = p_policy_id and i.kind = 'regular'
    order by i.beneficiary_type, i.installment_number
    for update
  loop
    if v_inst.status = 'scheduled' then
      update public.commission_installments
         set status = 'cancelled', cancelled_at = now(), cancelled_by = p_actor, cancel_reason = 'Storno police: ' || btrim(p_reason)
       where id = v_inst.id;
      v_cancelled := v_cancelled || v_inst.id;
      v_cancelled_sum := v_cancelled_sum + v_inst.amount;
    elsif v_inst.status = 'paid' and v_inst.paid_amount > 0 then
      insert into public.commission_installments
        (commission_id, policy_id, beneficiary_id, beneficiary_type, installment_number, share_percent, amount,
         due_date, original_due_date, kind, reverses_installment_id)
      values
        (v_inst.commission_id, v_inst.policy_id, v_inst.beneficiary_id, v_inst.beneficiary_type,
         100 + v_inst.installment_number, v_inst.share_percent, -v_inst.paid_amount,
         p_clawback_due, p_clawback_due, 'clawback', v_inst.id)
      returning id into v_new_id;
      v_clawbacks := v_clawbacks || v_new_id;
      v_clawback_sum := v_clawback_sum + v_inst.paid_amount;
    end if;
  end loop;

  update public.commissions set status = 'cancelled' where policy_id = p_policy_id;
  update public.policies
     set status = 'cancelled', cancelled_at = now(), cancel_reason = btrim(p_reason), cancelled_by = p_actor
   where id = p_policy_id;

  if not exists (select 1 from public.policies p where p.customer_id = v_customer.id and p.status = 'active') then
    update public.customers set status = 'lost' where id = v_customer.id and status = 'won';
  end if;

  insert into public.deleted_records (kind, customer_id, customer_name, policy_id, summary, reason, snapshot, meta, created_by)
  values ('policy_storno', v_customer.id, v_customer.first_name || ' ' || v_customer.last_name, p_policy_id,
          'Storno: ' || v_policy.product_name || ' (' || v_policy.monthly_premium || ' €/mes.)',
          btrim(p_reason), v_snapshot,
          jsonb_build_object('cancelled_installments', to_jsonb(v_cancelled), 'clawbacks', to_jsonb(v_clawbacks),
                             'cancelled_sum', v_cancelled_sum, 'clawback_sum', v_clawback_sum, 'clawback_due', p_clawback_due),
          p_actor)
  returning id into v_backup;

  perform public.crm_log(v_customer.id, 'policy', p_policy_id, 'policy_cancelled', p_actor, 'team',
    jsonb_build_object('status', 'active'), jsonb_build_object('status', 'cancelled', 'reason', btrim(p_reason)),
    jsonb_build_object('product', v_policy.product_name));
  perform public.crm_log(v_customer.id, 'policy', p_policy_id, 'commission_reversed', p_actor, 'owner', null,
    jsonb_build_object('cancelled_sum', v_cancelled_sum, 'clawback_sum', v_clawback_sum, 'clawback_due', p_clawback_due));

  return jsonb_build_object('backup_id', v_backup, 'cancelled_sum', v_cancelled_sum, 'clawback_sum', v_clawback_sum,
                            'cancelled_count', cardinality(v_cancelled), 'clawback_count', cardinality(v_clawbacks));
end;
$$;

-- Undo a storno while none of its clawbacks has been settled
create or replace function public.crm_revert_storno(p_actor uuid, p_backup_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rec public.deleted_records;
  v_cancelled uuid[];
  v_clawbacks uuid[];
begin
  perform public.crm_require_owner(p_actor);
  select * into v_rec from public.deleted_records where id = p_backup_id for update;
  if v_rec.id is null or v_rec.kind <> 'policy_storno' then
    perform public.crm_fail('Zapis storna ne obstaja.');
  end if;
  if v_rec.restored_at is not null then
    perform public.crm_fail('Storno je že razveljavljen.');
  end if;
  select coalesce(array_agg(x::uuid), '{}') into v_cancelled from jsonb_array_elements_text(v_rec.meta -> 'cancelled_installments') x;
  select coalesce(array_agg(x::uuid), '{}') into v_clawbacks from jsonb_array_elements_text(v_rec.meta -> 'clawbacks') x;
  if exists (select 1 from public.commission_installments where id = any (v_clawbacks) and status <> 'scheduled') then
    perform public.crm_fail('Odbitek je že obračunan – storna ni več mogoče razveljaviti.');
  end if;

  perform set_config('crm.allow_storno_revert', 'on', true);
  perform set_config('crm.allow_maintenance', 'on', true);
  update public.commission_installments
     set status = 'scheduled', cancelled_at = null, cancelled_by = null, cancel_reason = null
   where id = any (v_cancelled);
  delete from public.commission_installments where id = any (v_clawbacks);
  perform set_config('crm.allow_storno_revert', 'off', true);
  perform set_config('crm.allow_maintenance', 'off', true);

  update public.commissions set status = 'active' where policy_id = v_rec.policy_id;
  update public.policies set status = 'active', cancelled_at = null, cancel_reason = null, cancelled_by = null
   where id = v_rec.policy_id;
  update public.customers set status = 'won' where id = v_rec.customer_id and status = 'lost';
  update public.deleted_records set restored_at = now(), restored_by = p_actor where id = v_rec.id;

  perform public.crm_log(v_rec.customer_id, 'policy', v_rec.policy_id, 'policy_storno_reverted', p_actor, 'team');
end;
$$;

-- ---------------------------------------------------------------------------
-- Customer deletion (with backup) and restore
-- ---------------------------------------------------------------------------
create or replace function public.crm_delete_customer(p_actor uuid, p_customer_id uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customer public.customers;
  v_backup uuid;
  v_snapshot jsonb;
begin
  perform public.crm_require_owner(p_actor);
  if nullif(btrim(p_reason), '') is null then
    perform public.crm_fail('Vnesite razlog izbrisa.');
  end if;
  select * into v_customer from public.customers where id = p_customer_id for update;
  if v_customer.id is null then
    perform public.crm_fail('Stranka ne obstaja.');
  end if;
  if exists (
    select 1 from public.commission_installments i join public.policies p on p.id = i.policy_id
    where p.customer_id = p_customer_id and i.status = 'paid'
  ) then
    perform public.crm_fail('Za to stranko so bile provizije že izplačane. Stranke ni mogoče izbrisati – uporabite storno police.');
  end if;

  v_snapshot := public.crm_customer_snapshot(p_customer_id);
  insert into public.deleted_records (kind, customer_id, customer_name, summary, reason, snapshot, meta, created_by)
  values ('customer_deleted', p_customer_id, v_customer.first_name || ' ' || v_customer.last_name,
          'Izbris stranke (' || jsonb_array_length(v_snapshot -> 'appointments') || ' terminov, '
            || jsonb_array_length(v_snapshot -> 'policies') || ' polic)',
          btrim(p_reason), v_snapshot,
          jsonb_build_object('documents', jsonb_array_length(v_snapshot -> 'documents')), p_actor)
  returning id into v_backup;

  perform set_config('crm.allow_maintenance', 'on', true);
  update public.leads set customer_id = null where customer_id = p_customer_id;
  update public.leads set existing_customer_id = null where existing_customer_id = p_customer_id;
  delete from public.activity_log where customer_id = p_customer_id;
  delete from public.documents where customer_id = p_customer_id; -- files stay in private storage for restore
  delete from public.commission_installments where policy_id in (select id from public.policies where customer_id = p_customer_id);
  delete from public.commissions where policy_id in (select id from public.policies where customer_id = p_customer_id);
  delete from public.policies where customer_id = p_customer_id;
  delete from public.caller_followups where customer_id = p_customer_id;
  update public.appointments set previous_appointment_id = null where customer_id = p_customer_id;
  delete from public.appointments where customer_id = p_customer_id;
  delete from public.customers where id = p_customer_id;
  perform set_config('crm.allow_maintenance', 'off', true);

  perform public.crm_log(null, 'customer', p_customer_id, 'customer_deleted', p_actor, 'owner', null,
    jsonb_build_object('name', v_customer.first_name || ' ' || v_customer.last_name, 'reason', btrim(p_reason), 'backup_id', v_backup));
  return v_backup;
end;
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

-- GDPR: permanently remove a deletion backup (e.g. erasure request)
create or replace function public.crm_purge_deleted_record(p_actor uuid, p_backup_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rec public.deleted_records;
begin
  perform public.crm_require_owner(p_actor);
  select * into v_rec from public.deleted_records where id = p_backup_id;
  if v_rec.id is null then
    perform public.crm_fail('Zapis ne obstaja.');
  end if;
  if v_rec.kind <> 'customer_deleted' then
    perform public.crm_fail('Zapisi storna so del finančne sledi in jih ni mogoče trajno izbrisati.');
  end if;
  delete from public.deleted_records where id = p_backup_id;
  perform public.crm_log(null, 'deleted_record', p_backup_id, 'backup_purged', p_actor, 'owner', null,
    jsonb_build_object('customer_name', v_rec.customer_name));
end;
$$;

-- ---------------------------------------------------------------------------
-- Demo purge: also remove demo backups
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
      and p.proname in ('crm_customer_snapshot', 'crm_restore_rows', 'crm_storno_policy', 'crm_revert_storno',
                        'crm_delete_customer', 'crm_restore_customer', 'crm_purge_deleted_record', 'crm_purge_demo_data',
                        'crm_maintenance_allowed')
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end;
$$;
