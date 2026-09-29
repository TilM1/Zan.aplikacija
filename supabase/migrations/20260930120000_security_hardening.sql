-- =============================================================================
-- Security hardening
--  1. Temporary passwords: users whose JWT carries
--     app_metadata.must_change_password = true get NO data access (RLS),
--     until they set their own password.
--  2. Login brute-force protection (per e-mail and per IP).
--  3. Session revocation (deactivation / password reset).
--  4. Owner can change an employee's login e-mail.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. RLS: no data access while a temporary password is active
-- ---------------------------------------------------------------------------
create or replace function public.crm_must_change_password()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'must_change_password')::boolean, false);
$$;

create or replace function public.crm_current_role()
returns public.user_role
language sql
stable
security definer
set search_path = ''
as $$
  select case when public.crm_must_change_password() then null else public.crm_role_of(auth.uid()) end;
$$;

create or replace function public.crm_can_view_customer(p_customer_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.crm_current_role() is not null
     and public.crm_user_can_view_customer(auth.uid(), p_customer_id);
$$;

grant execute on function public.crm_must_change_password() to authenticated;
revoke execute on function public.crm_must_change_password() from anon;

-- ---------------------------------------------------------------------------
-- 2. Login attempts (service role only; no RLS policies = no browser access)
-- ---------------------------------------------------------------------------
create table public.login_attempts (
  id bigint generated always as identity primary key,
  email text not null,
  ip text,
  success boolean not null,
  created_at timestamptz not null default now()
);
create index login_attempts_email_idx on public.login_attempts (email, created_at desc);
create index login_attempts_ip_idx on public.login_attempts (ip, created_at desc);
alter table public.login_attempts enable row level security;
revoke all on public.login_attempts from anon, authenticated;

-- Max 5 failed attempts per e-mail and 30 per IP within 15 minutes.
create or replace function public.crm_login_allowed(p_email text, p_ip text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select count(*) from public.login_attempts a
      where a.email = lower(btrim(p_email)) and not a.success and a.created_at > now() - interval '15 minutes') < 5
    and
    (p_ip is null or (select count(*) from public.login_attempts a
      where a.ip = p_ip and not a.success and a.created_at > now() - interval '15 minutes') < 30);
$$;

create or replace function public.crm_login_record(p_email text, p_ip text, p_success boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.login_attempts (email, ip, success) values (lower(btrim(p_email)), p_ip, p_success);
  -- A successful login clears that e-mail's failure counter
  if p_success then
    delete from public.login_attempts where email = lower(btrim(p_email)) and not success;
  end if;
  -- Housekeeping
  delete from public.login_attempts where created_at < now() - interval '30 days';
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Revoke all sessions (refresh tokens) of a user
-- ---------------------------------------------------------------------------
create or replace function public.crm_revoke_sessions(p_actor uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_actor is distinct from p_user_id then
    perform public.crm_require_owner(p_actor);
  end if;
  delete from auth.sessions where user_id = p_user_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Employee update incl. login e-mail
-- ---------------------------------------------------------------------------
create or replace function public.crm_update_employee(
  p_actor uuid,
  p_user_id uuid,
  p_changes jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.profiles;
  v_new public.profiles;
  v_email text := nullif(lower(btrim(p_changes ->> 'email')), '');
begin
  perform public.crm_require_owner(p_actor);
  select * into v_old from public.profiles p where p.id = p_user_id for update;
  if v_old.id is null then
    perform public.crm_fail('Zaposleni ne obstaja.');
  end if;
  if p_user_id = p_actor and (
       (p_changes ? 'is_active' and not (p_changes ->> 'is_active')::boolean)
       or (p_changes ? 'role' and p_changes ->> 'role' <> 'owner')) then
    perform public.crm_fail('Sebi ne morete odvzeti lastniškega dostopa ali se deaktivirati.');
  end if;
  if v_email is not null and v_email <> v_old.email
     and exists (select 1 from public.profiles p where lower(p.email) = v_email and p.id <> p_user_id) then
    perform public.crm_fail('Ta e-poštni naslov že uporablja drug zaposleni.');
  end if;

  update public.profiles p
     set first_name = coalesce(nullif(btrim(p_changes ->> 'first_name'), ''), p.first_name),
         last_name = coalesce(nullif(btrim(p_changes ->> 'last_name'), ''), p.last_name),
         phone = case when p_changes ? 'phone' then nullif(btrim(p_changes ->> 'phone'), '') else p.phone end,
         email = coalesce(v_email, p.email),
         role = coalesce(nullif(p_changes ->> 'role', '')::public.user_role, p.role),
         is_active = coalesce((p_changes ->> 'is_active')::boolean, p.is_active)
   where p.id = p_user_id
  returning * into v_new;

  perform public.crm_log(null, 'profile', p_user_id, 'employee_updated', p_actor, 'owner',
    jsonb_build_object('first_name', v_old.first_name, 'last_name', v_old.last_name, 'phone', v_old.phone,
                       'email', v_old.email, 'role', v_old.role, 'is_active', v_old.is_active),
    jsonb_build_object('first_name', v_new.first_name, 'last_name', v_new.last_name, 'phone', v_new.phone,
                       'email', v_new.email, 'role', v_new.role, 'is_active', v_new.is_active));
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
      and p.proname in ('crm_login_allowed', 'crm_login_record', 'crm_revoke_sessions', 'crm_update_employee')
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end;
$$;
