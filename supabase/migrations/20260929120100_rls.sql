-- =============================================================================
-- Row Level Security
--
-- Model:
--   * Browsers (anon / authenticated) can only READ, filtered by RLS.
--   * All writes go through crm_* workflow functions, executable only by the
--     service_role from trusted server code, which pass the verified actor id.
--     Each function re-checks authorization for that actor.
--   * A user without an active profile gets nothing.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Helpers (SECURITY DEFINER to avoid recursive RLS evaluation)
-- ---------------------------------------------------------------------------
create or replace function public.crm_role_of(p_user_id uuid)
returns public.user_role
language sql
stable
security definer
set search_path = ''
as $$
  select p.role from public.profiles p where p.id = p_user_id and p.is_active;
$$;

create or replace function public.crm_current_role()
returns public.user_role
language sql
stable
security definer
set search_path = ''
as $$
  select public.crm_role_of(auth.uid());
$$;

create or replace function public.crm_is_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.crm_current_role() = 'owner', false);
$$;

-- Can p_user_id see customer p_customer_id?
--   owner  : everything
--   agent  : customers they currently handle, had an appointment with, or sold a policy to
--   caller : customers they are responsible for, created, or booked an appointment for
create or replace function public.crm_user_can_view_customer(p_user_id uuid, p_customer_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role public.user_role := public.crm_role_of(p_user_id);
begin
  if v_role is null then
    return false;
  elsif v_role = 'owner' then
    return true;
  elsif v_role = 'agent' then
    return exists (select 1 from public.customers c where c.id = p_customer_id and c.current_agent_id = p_user_id)
        or exists (select 1 from public.appointments a where a.customer_id = p_customer_id and a.agent_id = p_user_id)
        or exists (select 1 from public.policies p where p.customer_id = p_customer_id and p.agent_id = p_user_id);
  else
    return exists (
             select 1 from public.customers c
             where c.id = p_customer_id and (c.responsible_caller_id = p_user_id or c.created_by = p_user_id)
           )
        or exists (select 1 from public.appointments a where a.customer_id = p_customer_id and a.caller_id = p_user_id);
  end if;
end;
$$;

create or replace function public.crm_can_view_customer(p_customer_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.crm_user_can_view_customer(auth.uid(), p_customer_id);
$$;

-- ---------------------------------------------------------------------------
-- Privileges: read-only for authenticated, nothing for anon
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
grant select on all tables in schema public to authenticated;

alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from anon, authenticated, public;

-- ---------------------------------------------------------------------------
-- Enable RLS everywhere
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.agent_commission_rates enable row level security;
alter table public.products enable row level security;
alter table public.customers enable row level security;
alter table public.appointments enable row level security;
alter table public.caller_followups enable row level security;
alter table public.policies enable row level security;
alter table public.commissions enable row level security;
alter table public.commission_installments enable row level security;
alter table public.documents enable row level security;
alter table public.activity_log enable row level security;

-- ---------------------------------------------------------------------------
-- SELECT policies
-- ---------------------------------------------------------------------------
-- Team directory: any active CRM user can see colleagues (names/roles for
-- assignment). Payroll data lives in separate tables.
create policy profiles_select on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or public.crm_current_role() is not null);

create policy agent_rates_select on public.agent_commission_rates
  for select to authenticated
  using (public.crm_is_owner() or agent_id = (select auth.uid()));

create policy products_select on public.products
  for select to authenticated
  using (public.crm_current_role() is not null);

create policy customers_select on public.customers
  for select to authenticated
  using (public.crm_can_view_customer(id));

create policy appointments_select on public.appointments
  for select to authenticated
  using (
    public.crm_is_owner()
    or (public.crm_current_role() is not null and (agent_id = (select auth.uid()) or caller_id = (select auth.uid())))
    or public.crm_can_view_customer(customer_id)
  );

create policy caller_followups_select on public.caller_followups
  for select to authenticated
  using (
    public.crm_is_owner()
    or (public.crm_current_role() = 'caller' and caller_id = (select auth.uid()))
  );

create policy policies_select on public.policies
  for select to authenticated
  using (
    public.crm_is_owner()
    or (public.crm_current_role() is not null and (agent_id = (select auth.uid()) or caller_id = (select auth.uid())))
    or (public.crm_current_role() = 'agent' and public.crm_can_view_customer(customer_id))
  );

-- Payroll: only the beneficiary and the owner.
create policy commissions_select on public.commissions
  for select to authenticated
  using (
    public.crm_is_owner()
    or (public.crm_current_role() is not null and beneficiary_id = (select auth.uid()))
  );

create policy commission_installments_select on public.commission_installments
  for select to authenticated
  using (
    public.crm_is_owner()
    or (public.crm_current_role() is not null and beneficiary_id = (select auth.uid()))
  );

-- Documents: owner, uploader, selling agent, or an agent handling the customer. Not callers.
create policy documents_select on public.documents
  for select to authenticated
  using (
    deleted_at is null and (
      public.crm_is_owner()
      or (
        public.crm_current_role() = 'agent' and (
          uploaded_by = (select auth.uid())
          or exists (select 1 from public.policies p where p.id = policy_id and p.agent_id = (select auth.uid()))
          or public.crm_can_view_customer(customer_id)
        )
      )
    )
  );

create policy activity_log_select on public.activity_log
  for select to authenticated
  using (
    public.crm_is_owner()
    or (
      visibility = 'team'
      and customer_id is not null
      and public.crm_can_view_customer(customer_id)
    )
  );

-- Helper functions used inside policies must be executable by authenticated.
revoke execute on function public.crm_role_of(uuid) from public, anon;
revoke execute on function public.crm_user_can_view_customer(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.current_agent_rate(uuid) from public, anon, authenticated;
grant execute on function public.crm_role_of(uuid) to authenticated;
grant execute on function public.crm_current_role() to authenticated;
grant execute on function public.crm_is_owner() to authenticated;
grant execute on function public.crm_can_view_customer(uuid) to authenticated;
revoke execute on function public.crm_current_role() from anon;
revoke execute on function public.crm_is_owner() from anon;
revoke execute on function public.crm_can_view_customer(uuid) from anon;

-- ---------------------------------------------------------------------------
-- Reporting views (security_invoker => RLS of the querying user applies)
-- ---------------------------------------------------------------------------
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
