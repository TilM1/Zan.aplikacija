-- =============================================================================
-- Telegram bot (owner only): enter contacts and policies from Telegram.
--   * lead_lists.kind = 'private': "Zasebna baza", the owner's own contacts.
--     Visible to the Owner only (callers never see it, whatever its members).
--   * crm_add_private_lead: /novastranka → one contact into the private list.
--   * crm_add_policy_to_customer: /dodajpolico → a sold policy for an EXISTING
--     customer. Same chain as in the app (appointment → result A1 → policies →
--     commissions), so reports, payroll and storno work unchanged.
--   * telegram_submissions: what was sent from Telegram, awaiting confirmation
--     or done. One row per Telegram message (protects against double saves).
-- Additive only: no existing column, row or business rule is changed.
-- =============================================================================

-- 1) Private list kind --------------------------------------------------------
alter table public.lead_lists drop constraint lead_lists_kind_check;
alter table public.lead_lists add constraint lead_lists_kind_check
  check (kind in ('import', 'live', 'private'));

-- At most one active private list (prevents a race creating two)
create unique index lead_lists_one_private_idx on public.lead_lists (kind)
  where kind = 'private' and status <> 'archived';

-- Callers never see private lists. Otherwise identical to the previous version.
create or replace function public.crm_lead_lists_for(p_user_id uuid)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(l.id), '{}')
  from public.lead_lists l
  where case public.crm_role_of(p_user_id)
          when 'owner' then true
          when 'caller' then l.status = 'ready' and l.kind <> 'private' and (
            exists (select 1 from public.lead_list_members m where m.list_id = l.id and m.caller_id = p_user_id)
            or (not exists (select 1 from public.lead_list_members m where m.list_id = l.id)
                and (l.assigned_caller_id is null or l.assigned_caller_id = p_user_id))
          )
          else false
        end;
$$;

-- 2) /novastranka → contact into "Zasebna baza" -------------------------------
-- p_lead: { name, phone, email, street, postal_code, city, note, extra }
-- Returns { status: 'created' | 'exists', lead_id, list_id, list_name, existing_customer_id }
create or replace function public.crm_add_private_lead(p_actor uuid, p_lead jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := left(btrim(coalesce(p_lead ->> 'name', '')), 300);
  v_phone text := left(btrim(coalesce(p_lead ->> 'phone', '')), 40);
  v_pn text := public.crm_normalize_phone(p_lead ->> 'phone');
  v_note text := nullif(left(btrim(coalesce(p_lead ->> 'note', '')), 2000), '');
  v_list public.lead_lists;
  v_existing record;
  v_customer_id uuid;
  v_lead_id uuid;
begin
  perform public.crm_require_owner(p_actor);
  if v_name = '' then
    perform public.crm_fail('Ime in priimek sta obvezna.');
  end if;
  if v_pn is null or length(v_pn) < 8 then
    perform public.crm_fail('Vnesite veljavno telefonsko številko.');
  end if;
  if exists (select 1 from public.lead_suppressions s where s.phone_normalized = v_pn) then
    perform public.crm_fail('Ta številka je na seznamu »Ne kliči« in je ni mogoče dodati.');
  end if;

  -- Phone numbers are unique across all call lists: report where it already is
  select l.id, l.list_id, ll.name as list_name into v_existing
    from public.leads l join public.lead_lists ll on ll.id = l.list_id
   where l.phone_normalized = v_pn;
  if v_existing.id is not null then
    return jsonb_build_object('status', 'exists', 'lead_id', v_existing.id, 'list_id', v_existing.list_id,
                              'list_name', v_existing.list_name);
  end if;

  select * into v_list from public.lead_lists
   where kind = 'private' and status <> 'archived'
   order by created_at desc limit 1
   for update;
  if v_list.id is null then
    insert into public.lead_lists (name, kind, status, source_label, imported_by)
    values ('Zasebna baza', 'private', 'ready', 'Telegram', p_actor)
    returning * into v_list;
  end if;

  select c.id into v_customer_id from public.customers c where c.phone_normalized = v_pn limit 1;

  insert into public.leads (list_id, name, phone, phone_normalized, street, postal_code, city, email, extra,
                            last_comment, existing_customer_id, source_created_at)
  values (v_list.id, v_name, v_phone, v_pn,
          nullif(left(btrim(coalesce(p_lead ->> 'street', '')), 300), ''),
          nullif(left(btrim(coalesce(p_lead ->> 'postal_code', '')), 20), ''),
          nullif(left(btrim(coalesce(p_lead ->> 'city', '')), 120), ''),
          nullif(lower(left(btrim(coalesce(p_lead ->> 'email', '')), 200)), ''),
          case when jsonb_typeof(p_lead -> 'extra') = 'object' then p_lead -> 'extra' else '{}'::jsonb end,
          v_note, v_customer_id, now())
  returning id into v_lead_id;

  if v_note is not null then
    insert into public.lead_events (lead_id, actor_id, action, comment)
    values (v_lead_id, p_actor, 'comment', v_note);
  end if;

  update public.lead_lists
     set total_rows = total_rows + 1, imported_count = imported_count + 1
   where id = v_list.id;

  return jsonb_build_object('status', 'created', 'lead_id', v_lead_id, 'list_id', v_list.id, 'list_name', v_list.name,
                            'existing_customer_id', v_customer_id);
end;
$$;

-- 3) /dodajpolico → policy for an existing customer ---------------------------
-- p_sale: { agent_id, caller_id (the caller the server computed commissions for), signed_at, note }
-- The caller is attributed exactly as when the Owner books a visit in the app
-- (open "call again" → its caller, otherwise the customer's responsible caller).
-- If that differs from p_sale.caller_id (data changed meanwhile), nothing is saved.
create or replace function public.crm_add_policy_to_customer(
  p_actor uuid,
  p_customer_id uuid,
  p_sale jsonb,
  p_policies jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_at timestamptz := least(coalesce(nullif(p_sale ->> 'signed_at', '')::timestamptz, now()), now());
  v_customer public.customers;
  v_caller_id uuid;
  v_scheduled jsonb;
  v_appointment_id uuid;
  v_result jsonb;
begin
  perform public.crm_require_owner(p_actor);

  select * into v_customer from public.customers c where c.id = p_customer_id for update;
  if v_customer.id is null then
    perform public.crm_fail('Stranka ne obstaja.');
  end if;
  if v_customer.archived_at is not null then
    perform public.crm_fail('Stranka je arhivirana. Najprej jo obnovite v CRM.');
  end if;

  select f.caller_id into v_caller_id from public.caller_followups f
   where f.customer_id = p_customer_id and f.status = 'open';
  v_caller_id := coalesce(v_caller_id, v_customer.responsible_caller_id);
  if v_caller_id is distinct from nullif(p_sale ->> 'caller_id', '')::uuid then
    perform public.crm_fail('Podatki stranke so se medtem spremenili. Pošljite polico znova.');
  end if;

  v_scheduled := public.crm_schedule_appointment(
    p_actor, p_customer_id,
    jsonb_build_object(
      'agent_id', p_sale ->> 'agent_id',
      'scheduled_at', v_at,
      'duration_minutes', 60,
      'note', 'Polica vnesena prek Telegrama, brez termina.'));
  v_appointment_id := (v_scheduled ->> 'appointment_id')::uuid;

  v_result := public.crm_record_result(p_actor, v_appointment_id, 'A1', p_sale ->> 'note', null, p_policies);

  -- Count the consultation in the month it was actually signed, not today
  update public.appointments a set completed_at = v_at where a.id = v_appointment_id;

  return v_result || jsonb_build_object('customer_id', p_customer_id);
end;
$$;

-- 4) Telegram submissions -----------------------------------------------------
create table public.telegram_submissions (
  id uuid primary key default gen_random_uuid(),
  chat_id bigint not null,
  message_id bigint not null,
  telegram_user_id bigint not null,
  actor_id uuid not null references public.profiles (id),
  command text not null check (command in ('novastranka', 'novapolica', 'dodajpolico')),
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'processing', 'done', 'cancelled', 'failed')),
  result jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (chat_id, message_id)
);
create index telegram_submissions_created_idx on public.telegram_submissions (created_at desc);
create trigger telegram_submissions_updated_at before update on public.telegram_submissions
  for each row execute function public.tg_set_updated_at();

-- Server (service role) only: no browser access at all
alter table public.telegram_submissions enable row level security;
revoke all on table public.telegram_submissions from public, anon, authenticated;
grant select, insert, update on table public.telegram_submissions to service_role;

revoke execute on function public.crm_add_private_lead(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.crm_add_private_lead(uuid, jsonb) to service_role;
revoke execute on function public.crm_add_policy_to_customer(uuid, uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.crm_add_policy_to_customer(uuid, uuid, jsonb, jsonb) to service_role;
