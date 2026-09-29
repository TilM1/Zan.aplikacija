-- =============================================================================
-- ZAN CRM — core schema
--
-- Entity chain:
--   customers → appointments (an appointment + its result IS the consultation)
--             → policies (sold at an A1 appointment)
--             → commissions (one per beneficiary per policy, snapshotted inputs)
--             → commission_installments (payout schedule / ledger)
--
-- Attribution:
--   appointments.caller_id  = Caller credited for this appointment (survives
--                             agent reassignment; inherited by A follow-ups)
--   appointments.agent_id   = Agent who runs the consultation
--   policies.agent_id/caller_id copied from the consultation appointment
-- =============================================================================

create extension if not exists pg_trgm with schema extensions;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.user_role as enum ('owner', 'agent', 'caller');
create type public.customer_status as enum ('scheduled', 'callback', 'won', 'lost', 'closed');
create type public.appointment_status as enum ('scheduled', 'completed', 'cancelled');
create type public.consultation_result as enum ('A', 'A0', 'A1', 'B');
create type public.followup_status as enum ('open', 'rescheduled', 'closed');
create type public.policy_status as enum ('active', 'cancelled');
create type public.commission_beneficiary as enum ('agent', 'caller');
create type public.commission_status as enum ('active', 'cancelled');
create type public.installment_status as enum ('scheduled', 'paid', 'cancelled');
create type public.document_type as enum ('signed_policy', 'other');
create type public.calendar_sync_status as enum ('not_synced', 'pending', 'synced', 'error');

-- ---------------------------------------------------------------------------
-- Shared trigger helpers
-- ---------------------------------------------------------------------------
create or replace function public.tg_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Business records are never hard-deleted. The only exception is the demo
-- purge (crm_purge_demo_data), which sets crm.allow_demo_purge for its own
-- transaction.
create or replace function public.tg_forbid_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(current_setting('crm.allow_demo_purge', true), '') = 'on' then
    return old;
  end if;
  raise exception 'Deleting % records is not allowed. Use archive/deactivate/cancel instead.', tg_table_name
    using errcode = 'P0001';
end;
$$;

-- ---------------------------------------------------------------------------
-- Profiles (1:1 with auth.users; id = auth user id)
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete restrict,
  first_name text not null check (length(btrim(first_name)) > 0),
  last_name text not null check (length(btrim(last_name)) > 0),
  email text not null,
  phone text,
  role public.user_role not null,
  is_active boolean not null default true,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index profiles_email_key on public.profiles (lower(email));
create index profiles_role_active_idx on public.profiles (role, is_active);

create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.tg_set_updated_at();
create trigger profiles_no_delete before delete on public.profiles
  for each row execute function public.tg_forbid_delete();

-- Agent commission rate history. The current rate is the latest row.
-- Policies snapshot the rate at sale, so changing a rate never touches history.
create table public.agent_commission_rates (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.profiles (id),
  rate_percent numeric(5, 2) not null check (rate_percent >= 0 and rate_percent <= 100),
  effective_from timestamptz not null default now(),
  set_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);
create index agent_commission_rates_agent_idx
  on public.agent_commission_rates (agent_id, effective_from desc, created_at desc);

create trigger agent_commission_rates_no_delete before delete on public.agent_commission_rates
  for each row execute function public.tg_forbid_delete();

create or replace function public.current_agent_rate(p_agent_id uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select r.rate_percent
  from public.agent_commission_rates r
  where r.agent_id = p_agent_id
  order by r.effective_from desc, r.created_at desc
  limit 1;
$$;

-- ---------------------------------------------------------------------------
-- Products (configurable, never hardcoded in the app)
-- ---------------------------------------------------------------------------
create table public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) > 0),
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index products_name_key on public.products (lower(name));

create trigger products_updated_at before update on public.products
  for each row execute function public.tg_set_updated_at();
create trigger products_no_delete before delete on public.products
  for each row execute function public.tg_forbid_delete();

insert into public.products (name, sort_order) values
  ('Moj življenjski bonus', 10),
  ('Moj življenjski kasko', 20),
  ('Specialisti', 30);

-- ---------------------------------------------------------------------------
-- Customers — one persistent record per person
-- ---------------------------------------------------------------------------
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  first_name text not null check (length(btrim(first_name)) > 0),
  last_name text not null check (length(btrim(last_name)) > 0),
  phone text not null check (length(btrim(phone)) > 0),
  phone_normalized text generated always as (regexp_replace(phone, '[^0-9+]', '', 'g')) stored,
  email text,
  address text not null,
  postal_code text not null,
  city text,
  status public.customer_status not null default 'scheduled',
  last_result public.consultation_result,
  responsible_caller_id uuid references public.profiles (id),
  current_agent_id uuid references public.profiles (id),
  created_by uuid not null references public.profiles (id),
  archived_at timestamptz,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  search_text text generated always as (
    lower(
      first_name || ' ' || last_name || ' ' || last_name || ' ' || first_name || ' '
      || regexp_replace(phone, '[^0-9+]', '', 'g') || ' ' || coalesce(email, '') || ' '
      || postal_code || ' ' || coalesce(city, '')
    )
  ) stored
);
create index customers_search_trgm_idx on public.customers using gin (search_text extensions.gin_trgm_ops);
create index customers_phone_idx on public.customers (phone_normalized);
create index customers_email_idx on public.customers (lower(email));
create index customers_caller_idx on public.customers (responsible_caller_id);
create index customers_agent_idx on public.customers (current_agent_id);
create index customers_status_idx on public.customers (status);
create index customers_created_idx on public.customers (created_at desc);

create trigger customers_updated_at before update on public.customers
  for each row execute function public.tg_set_updated_at();
create trigger customers_no_delete before delete on public.customers
  for each row execute function public.tg_forbid_delete();

-- ---------------------------------------------------------------------------
-- Appointments — appointment + result = consultation. Never overwritten:
-- every new visit is a new row linked via previous_appointment_id.
-- ---------------------------------------------------------------------------
create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id),
  agent_id uuid not null references public.profiles (id),
  caller_id uuid references public.profiles (id),
  created_by uuid not null references public.profiles (id),
  previous_appointment_id uuid references public.appointments (id),
  visit_number integer not null check (visit_number > 0),
  scheduled_at timestamptz not null,
  duration_minutes integer not null default 60 check (duration_minutes between 5 and 600),
  location text not null,
  postal_code text,
  note text,
  status public.appointment_status not null default 'scheduled',
  result public.consultation_result,
  result_note text,
  completed_at timestamptz,
  completed_by uuid references public.profiles (id),
  cancelled_at timestamptz,
  cancelled_by uuid references public.profiles (id),
  cancel_reason text,
  -- Calendar integration layer (future Outlook sync per agent)
  external_provider text,
  external_event_id text,
  sync_status public.calendar_sync_status not null default 'not_synced',
  last_synced_at timestamptz,
  sync_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint appointments_result_matches_status check (
    (status = 'completed' and result is not null and completed_at is not null)
    or (status <> 'completed' and result is null)
  ),
  constraint appointments_cancel_matches_status check (
    (status = 'cancelled') = (cancelled_at is not null)
  )
);
create unique index appointments_external_event_key
  on public.appointments (external_provider, external_event_id)
  where external_event_id is not null;
create index appointments_agent_time_idx on public.appointments (agent_id, scheduled_at);
create index appointments_caller_time_idx on public.appointments (caller_id, scheduled_at);
create index appointments_customer_idx on public.appointments (customer_id, scheduled_at);
create index appointments_status_time_idx on public.appointments (status, scheduled_at);
create index appointments_completed_idx on public.appointments (completed_at desc) where status = 'completed';

create trigger appointments_updated_at before update on public.appointments
  for each row execute function public.tg_set_updated_at();
create trigger appointments_no_delete before delete on public.appointments
  for each row execute function public.tg_forbid_delete();

-- ---------------------------------------------------------------------------
-- Caller follow-ups ("call again" queue) — created by result B
-- ---------------------------------------------------------------------------
create table public.caller_followups (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id),
  caller_id uuid references public.profiles (id),
  source_appointment_id uuid not null references public.appointments (id),
  reason public.consultation_result not null default 'B',
  status public.followup_status not null default 'open',
  note text,
  resolved_appointment_id uuid references public.appointments (id),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint caller_followups_source_key unique (source_appointment_id),
  constraint caller_followups_resolution check (
    (status = 'open' and resolved_at is null)
    or (status = 'rescheduled' and resolved_appointment_id is not null and resolved_at is not null)
    or (status = 'closed' and resolved_at is not null)
  )
);
create index caller_followups_caller_idx on public.caller_followups (caller_id, status, created_at);
create index caller_followups_customer_idx on public.caller_followups (customer_id);
create unique index caller_followups_one_open_per_customer
  on public.caller_followups (customer_id) where status = 'open';

create trigger caller_followups_updated_at before update on public.caller_followups
  for each row execute function public.tg_set_updated_at();
create trigger caller_followups_no_delete before delete on public.caller_followups
  for each row execute function public.tg_forbid_delete();

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------
create table public.policies (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id),
  appointment_id uuid not null references public.appointments (id),
  product_id uuid not null references public.products (id),
  product_name text not null,
  policy_number text,
  monthly_premium numeric(12, 2) not null check (monthly_premium > 0),
  duration_years integer not null check (duration_years between 1 and 100),
  policy_date date not null,
  agent_id uuid not null references public.profiles (id),
  caller_id uuid references public.profiles (id),
  status public.policy_status not null default 'active',
  note text,
  created_by uuid not null references public.profiles (id),
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index policies_customer_idx on public.policies (customer_id);
create index policies_appointment_idx on public.policies (appointment_id);
create index policies_agent_date_idx on public.policies (agent_id, policy_date desc);
create index policies_caller_date_idx on public.policies (caller_id, policy_date desc);
create index policies_date_idx on public.policies (policy_date desc);
create index policies_number_idx on public.policies (policy_number) where policy_number is not null;

create trigger policies_updated_at before update on public.policies
  for each row execute function public.tg_set_updated_at();
create trigger policies_no_delete before delete on public.policies
  for each row execute function public.tg_forbid_delete();

-- Financial inputs of a policy are frozen: commissions were calculated from them.
create or replace function public.tg_policies_freeze_financials()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.monthly_premium is distinct from old.monthly_premium
     or new.duration_years is distinct from old.duration_years
     or new.policy_date is distinct from old.policy_date
     or new.agent_id is distinct from old.agent_id
     or new.caller_id is distinct from old.caller_id
     or new.customer_id is distinct from old.customer_id
     or new.appointment_id is distinct from old.appointment_id then
    raise exception 'Financial fields of a policy cannot be changed after creation (use a correction/adjustment instead)'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger policies_freeze_financials before update on public.policies
  for each row execute function public.tg_policies_freeze_financials();

-- ---------------------------------------------------------------------------
-- Commissions — one row per (policy, beneficiary type). All inputs snapshotted.
-- ---------------------------------------------------------------------------
create table public.commissions (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid not null references public.policies (id),
  beneficiary_id uuid not null references public.profiles (id),
  beneficiary_type public.commission_beneficiary not null,
  base_monthly_premium numeric(12, 2) not null check (base_monthly_premium > 0),
  base_duration_years integer check (base_duration_years > 0),
  rate_percent numeric(5, 2) check (rate_percent >= 0 and rate_percent <= 100),
  caller_multiplier numeric(6, 3) check (caller_multiplier >= 0),
  total_amount numeric(12, 2) not null check (total_amount >= 0),
  policy_date date not null,
  rule_version text not null,
  calculation jsonb not null,
  status public.commission_status not null default 'active',
  created_at timestamptz not null default now(),
  constraint commissions_policy_type_key unique (policy_id, beneficiary_type),
  -- Agent: premium × 12 × years × rate%
  constraint commissions_agent_formula check (
    beneficiary_type <> 'agent' or (
      rate_percent is not null and base_duration_years is not null
      and total_amount = round(base_monthly_premium * 12 * base_duration_years * rate_percent / 100, 2)
    )
  ),
  -- Caller: premium × multiplier (1.5)
  constraint commissions_caller_formula check (
    beneficiary_type <> 'caller' or (
      caller_multiplier is not null
      and total_amount = round(base_monthly_premium * caller_multiplier, 2)
    )
  )
);
create index commissions_beneficiary_idx on public.commissions (beneficiary_id);

create trigger commissions_no_delete before delete on public.commissions
  for each row execute function public.tg_forbid_delete();

create or replace function public.tg_commissions_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (to_jsonb(new) - 'status') is distinct from (to_jsonb(old) - 'status') then
    raise exception 'Commission records are immutable (only status may change)' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger commissions_immutable before update on public.commissions
  for each row execute function public.tg_commissions_immutable();

-- ---------------------------------------------------------------------------
-- Commission installments — the payout ledger
-- "due" is derived (scheduled and due_date <= today), not stored.
-- ---------------------------------------------------------------------------
create table public.commission_installments (
  id uuid primary key default gen_random_uuid(),
  commission_id uuid not null references public.commissions (id),
  policy_id uuid not null references public.policies (id),
  beneficiary_id uuid not null references public.profiles (id),
  beneficiary_type public.commission_beneficiary not null,
  installment_number smallint not null check (installment_number between 1 and 12),
  share_percent numeric(5, 2) not null check (share_percent > 0 and share_percent <= 100),
  amount numeric(12, 2) not null check (amount >= 0),
  due_date date not null,
  original_due_date date not null,
  status public.installment_status not null default 'scheduled',
  paid_at timestamptz,
  paid_by uuid references public.profiles (id),
  paid_amount numeric(12, 2),
  payment_note text,
  cancelled_at timestamptz,
  cancelled_by uuid references public.profiles (id),
  cancel_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint commission_installments_number_key unique (commission_id, installment_number),
  constraint commission_installments_paid check (
    status <> 'paid' or (paid_at is not null and paid_by is not null and paid_amount is not null)
  ),
  constraint commission_installments_cancelled check (
    status <> 'cancelled' or (cancelled_at is not null and cancelled_by is not null)
  )
);
create index commission_installments_beneficiary_idx
  on public.commission_installments (beneficiary_id, due_date);
create index commission_installments_status_due_idx
  on public.commission_installments (status, due_date);
create index commission_installments_policy_idx on public.commission_installments (policy_id);

create trigger commission_installments_updated_at before update on public.commission_installments
  for each row execute function public.tg_set_updated_at();
create trigger commission_installments_no_delete before delete on public.commission_installments
  for each row execute function public.tg_forbid_delete();

-- Ledger rules: amounts and identity never change; only scheduled rows may
-- transition (to paid or cancelled); paid/cancelled rows are final.
create or replace function public.tg_installments_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
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
create trigger commission_installments_guard before update on public.commission_installments
  for each row execute function public.tg_installments_guard();

-- ---------------------------------------------------------------------------
-- Documents (private storage; extensible document types)
-- ---------------------------------------------------------------------------
create table public.documents (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id),
  policy_id uuid references public.policies (id),
  document_type public.document_type not null,
  storage_bucket text not null default 'documents',
  storage_path text not null,
  file_name text not null,
  mime_type text,
  size_bytes bigint check (size_bytes >= 0),
  uploaded_by uuid not null references public.profiles (id),
  deleted_at timestamptz,
  deleted_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  constraint documents_path_key unique (storage_bucket, storage_path)
);
create index documents_customer_idx on public.documents (customer_id);
create index documents_policy_idx on public.documents (policy_id);

create trigger documents_no_delete before delete on public.documents
  for each row execute function public.tg_forbid_delete();

-- ---------------------------------------------------------------------------
-- Activity log — append-only business history / audit trail
-- visibility 'owner' hides financial events from non-owners.
-- ---------------------------------------------------------------------------
create table public.activity_log (
  id bigint generated always as identity primary key,
  customer_id uuid references public.customers (id),
  entity_type text not null,
  entity_id uuid,
  action text not null,
  actor_id uuid references public.profiles (id),
  visibility text not null default 'team' check (visibility in ('team', 'owner')),
  old_value jsonb,
  new_value jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index activity_log_customer_idx on public.activity_log (customer_id, created_at desc);
create index activity_log_created_idx on public.activity_log (created_at desc);
create index activity_log_entity_idx on public.activity_log (entity_type, entity_id);

create or replace function public.tg_activity_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and coalesce(current_setting('crm.allow_demo_purge', true), '') = 'on' then
    return old;
  end if;
  raise exception 'activity_log is append-only' using errcode = 'P0001';
end;
$$;
create trigger activity_log_append_only before update or delete on public.activity_log
  for each row execute function public.tg_activity_append_only();
