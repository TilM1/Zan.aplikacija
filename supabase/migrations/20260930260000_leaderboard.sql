-- =============================================================================
-- Monthly leaderboard (visible to every active user) + owner-defined prizes.
-- Only aggregated sales stats are exposed – no customer data, no commissions.
-- =============================================================================

create table public.leaderboard_prizes (
  month date primary key check (month = date_trunc('month', month)::date),
  agent_prize text,
  caller_prize text,
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now()
);
alter table public.leaderboard_prizes enable row level security;
revoke all on public.leaderboard_prizes from anon, authenticated;
grant select on public.leaderboard_prizes to authenticated;
create policy leaderboard_prizes_select on public.leaderboard_prizes
  for select to authenticated using (public.crm_current_role() is not null);

-- Aggregates for one calendar month (Europe/Ljubljana).
create or replace function public.leaderboard(p_month date)
returns table (
  kind text,
  user_id uuid,
  first_name text,
  last_name text,
  policies integer,
  premium numeric,
  consultations integer,
  successful integer,
  booked integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_from_date date := date_trunc('month', p_month)::date;
  v_to_date date := (date_trunc('month', p_month) + interval '1 month')::date;
  v_from timestamptz := v_from_date::timestamp at time zone 'Europe/Ljubljana';
  v_to timestamptz := v_to_date::timestamp at time zone 'Europe/Ljubljana';
begin
  if public.crm_current_role() is null then
    return;
  end if;

  return query
  with agents as (
    select p.id, p.first_name, p.last_name from public.profiles p where p.role in ('agent', 'owner') and p.is_active
  ), callers as (
    select p.id, p.first_name, p.last_name from public.profiles p where p.role = 'caller' and p.is_active
  ), pol as (
    select po.agent_id, po.caller_id, po.monthly_premium from public.policies po
    where po.status = 'active' and po.policy_date >= v_from_date and po.policy_date < v_to_date
  ), cons as (
    select a.agent_id, a.caller_id, a.result from public.appointments a
    where a.status = 'completed' and a.completed_at >= v_from and a.completed_at < v_to
  ), book as (
    select a.caller_id from public.appointments a
    where a.caller_id is not null and a.created_at >= v_from and a.created_at < v_to
  )
  select 'agent'::text, g.id, g.first_name, g.last_name,
         (select count(*)::integer from pol where pol.agent_id = g.id),
         (select coalesce(sum(pol.monthly_premium), 0) from pol where pol.agent_id = g.id),
         (select count(*)::integer from cons where cons.agent_id = g.id),
         (select count(*)::integer from cons where cons.agent_id = g.id and cons.result = 'A1'),
         0
  from agents g
  union all
  select 'caller'::text, c.id, c.first_name, c.last_name,
         (select count(*)::integer from pol where pol.caller_id = c.id),
         (select coalesce(sum(pol.monthly_premium), 0) from pol where pol.caller_id = c.id),
         (select count(*)::integer from cons where cons.caller_id = c.id),
         (select count(*)::integer from cons where cons.caller_id = c.id and cons.result = 'A1'),
         (select count(*)::integer from book where book.caller_id = c.id)
  from callers c;
end;
$$;

revoke execute on function public.leaderboard(date) from public, anon;
grant execute on function public.leaderboard(date) to authenticated, service_role;

create or replace function public.crm_set_leaderboard_prizes(p_actor uuid, p_month date, p_agent_prize text, p_caller_prize text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.crm_require_owner(p_actor);
  insert into public.leaderboard_prizes (month, agent_prize, caller_prize, updated_by, updated_at)
  values (date_trunc('month', p_month)::date, nullif(btrim(p_agent_prize), ''), nullif(btrim(p_caller_prize), ''), p_actor, now())
  on conflict (month) do update
    set agent_prize = excluded.agent_prize, caller_prize = excluded.caller_prize, updated_by = p_actor, updated_at = now();
end;
$$;
revoke execute on function public.crm_set_leaderboard_prizes(uuid, date, text, text) from public, anon, authenticated;
grant execute on function public.crm_set_leaderboard_prizes(uuid, date, text, text) to service_role;
