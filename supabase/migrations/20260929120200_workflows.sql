-- =============================================================================
-- Workflow functions
--
-- Every business write happens here, inside one transaction per call.
-- These functions are executable ONLY by service_role. Trusted server code
-- (Next.js server actions) authenticates the user, then passes the verified
-- user id as p_actor. Each function re-checks what that actor may do.
--
-- Error messages raised with errcode P0001 are user-facing (Slovenian).
-- =============================================================================

-- One scheduled (open) appointment per customer at a time.
create unique index appointments_one_open_per_customer
  on public.appointments (customer_id) where status = 'scheduled';

-- ---------------------------------------------------------------------------
-- Internal helpers
-- ---------------------------------------------------------------------------
create or replace function public.crm_fail(p_message text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  raise exception using message = p_message, errcode = 'P0001';
end;
$$;

create or replace function public.crm_require_actor(p_actor uuid)
returns public.user_role
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role public.user_role;
begin
  v_role := public.crm_role_of(p_actor);
  if v_role is null then
    perform public.crm_fail('Uporabnik nima aktivnega dostopa do CRM.');
  end if;
  return v_role;
end;
$$;

create or replace function public.crm_require_owner(p_actor uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if public.crm_require_actor(p_actor) <> 'owner' then
    perform public.crm_fail('To dejanje lahko izvede samo lastnik.');
  end if;
end;
$$;

create or replace function public.crm_require_agent(p_agent_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if coalesce(public.crm_role_of(p_agent_id)::text, '') not in ('agent', 'owner') then
    perform public.crm_fail('Izbrani zastopnik ne obstaja ali ni aktiven.');
  end if;
end;
$$;

create or replace function public.crm_log(
  p_customer_id uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_action text,
  p_actor uuid,
  p_visibility text default 'team',
  p_old jsonb default null,
  p_new jsonb default null,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.activity_log
    (customer_id, entity_type, entity_id, action, actor_id, visibility, old_value, new_value, metadata)
  values
    (p_customer_id, p_entity_type, p_entity_id, p_action, p_actor, p_visibility, p_old, p_new,
     coalesce(p_metadata, '{}'::jsonb));
$$;

create or replace function public.crm_next_visit_number(p_customer_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(max(a.visit_number), 0) + 1 from public.appointments a where a.customer_id = p_customer_id;
$$;

-- Resolve the customer's open follow-up (if any) when a new appointment is booked.
create or replace function public.crm_resolve_open_followup(
  p_customer_id uuid, p_appointment_id uuid, p_actor uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_followup public.caller_followups;
begin
  update public.caller_followups f
     set status = 'rescheduled',
         resolved_appointment_id = p_appointment_id,
         resolved_at = now(),
         resolved_by = p_actor
   where f.customer_id = p_customer_id and f.status = 'open'
  returning * into v_followup;

  if v_followup.id is not null then
    perform public.crm_log(p_customer_id, 'caller_followup', v_followup.id, 'followup_resolved', p_actor,
      'team', null, jsonb_build_object('appointment_id', p_appointment_id));
  end if;
  return v_followup.id;
end;
$$;

-- Insert an appointment row + activity. Callers of this helper handle authorization.
create or replace function public.crm_insert_appointment(
  p_actor uuid,
  p_customer_id uuid,
  p_agent_id uuid,
  p_caller_id uuid,
  p_scheduled_at timestamptz,
  p_duration_minutes integer,
  p_location text,
  p_postal_code text,
  p_note text,
  p_previous_appointment_id uuid,
  p_source text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_visit integer;
begin
  perform public.crm_require_agent(p_agent_id);
  if p_scheduled_at is null then
    perform public.crm_fail('Datum in ura termina sta obvezna.');
  end if;
  if exists (select 1 from public.appointments a where a.customer_id = p_customer_id and a.status = 'scheduled') then
    perform public.crm_fail('Stranka že ima odprt termin. Najprej zaključite ali prestavite obstoječi termin.');
  end if;

  v_visit := public.crm_next_visit_number(p_customer_id);

  insert into public.appointments
    (customer_id, agent_id, caller_id, created_by, previous_appointment_id, visit_number,
     scheduled_at, duration_minutes, location, postal_code, note)
  values
    (p_customer_id, p_agent_id, p_caller_id, p_actor, p_previous_appointment_id, v_visit,
     p_scheduled_at, coalesce(p_duration_minutes, 60), p_location, p_postal_code, nullif(btrim(p_note), ''))
  returning id into v_id;

  update public.customers c
     set status = 'scheduled', current_agent_id = p_agent_id
   where c.id = p_customer_id;

  perform public.crm_log(p_customer_id, 'appointment', v_id, 'appointment_created', p_actor, 'team', null,
    jsonb_build_object(
      'scheduled_at', p_scheduled_at,
      'agent_id', p_agent_id,
      'caller_id', p_caller_id,
      'visit_number', v_visit,
      'previous_appointment_id', p_previous_appointment_id
    ),
    jsonb_build_object('source', p_source));

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. New customer + first appointment (Caller workflow)
-- ---------------------------------------------------------------------------
create or replace function public.crm_create_customer_with_appointment(
  p_actor uuid,
  p_customer jsonb,
  p_appointment jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.user_role := public.crm_require_actor(p_actor);
  v_caller_id uuid;
  v_customer_id uuid;
  v_appointment_id uuid;
begin
  if v_role = 'caller' then
    v_caller_id := p_actor;
  elsif v_role = 'owner' then
    v_caller_id := nullif(p_appointment ->> 'caller_id', '')::uuid;
    if v_caller_id is not null and coalesce(public.crm_role_of(v_caller_id)::text, '') <> 'caller' then
      perform public.crm_fail('Izbrani klicatelj ne obstaja ali ni aktiven.');
    end if;
  else
    v_caller_id := null; -- agent booking their own lead: no caller attribution
  end if;

  insert into public.customers
    (first_name, last_name, phone, email, address, postal_code, city,
     responsible_caller_id, current_agent_id, created_by, status)
  values
    (btrim(p_customer ->> 'first_name'), btrim(p_customer ->> 'last_name'), btrim(p_customer ->> 'phone'),
     nullif(lower(btrim(p_customer ->> 'email')), ''), btrim(p_customer ->> 'address'),
     btrim(p_customer ->> 'postal_code'), nullif(btrim(p_customer ->> 'city'), ''),
     v_caller_id, (p_appointment ->> 'agent_id')::uuid, p_actor, 'scheduled')
  returning id into v_customer_id;

  perform public.crm_log(v_customer_id, 'customer', v_customer_id, 'customer_created', p_actor, 'team', null,
    jsonb_build_object('responsible_caller_id', v_caller_id));

  v_appointment_id := public.crm_insert_appointment(
    p_actor, v_customer_id, (p_appointment ->> 'agent_id')::uuid, v_caller_id,
    (p_appointment ->> 'scheduled_at')::timestamptz,
    nullif(p_appointment ->> 'duration_minutes', '')::integer,
    btrim(p_customer ->> 'address'), btrim(p_customer ->> 'postal_code'),
    p_appointment ->> 'note', null, 'new_customer');

  return jsonb_build_object('customer_id', v_customer_id, 'appointment_id', v_appointment_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. New appointment for an existing customer
--    (Caller after B follow-up, or Owner/Agent)
-- Caller attribution: open follow-up's caller → acting caller → customer's
-- responsible caller.
-- ---------------------------------------------------------------------------
create or replace function public.crm_schedule_appointment(
  p_actor uuid,
  p_customer_id uuid,
  p_appointment jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.user_role := public.crm_require_actor(p_actor);
  v_customer public.customers;
  v_followup public.caller_followups;
  v_last public.appointments;
  v_caller_id uuid;
  v_appointment_id uuid;
  v_followup_id uuid;
begin
  select * into v_customer from public.customers c where c.id = p_customer_id for update;
  if v_customer.id is null or not public.crm_user_can_view_customer(p_actor, p_customer_id) then
    perform public.crm_fail('Stranka ne obstaja ali do nje nimate dostopa.');
  end if;

  select * into v_followup from public.caller_followups f
   where f.customer_id = p_customer_id and f.status = 'open';

  if v_role = 'caller' and v_followup.id is not null and v_followup.caller_id is distinct from p_actor then
    perform public.crm_fail('Ta klic nazaj je dodeljen drugemu klicatelju.');
  end if;

  select * into v_last from public.appointments a
   where a.customer_id = p_customer_id order by a.visit_number desc limit 1;

  if v_followup.id is not null then
    v_caller_id := v_followup.caller_id;
  elsif v_role = 'caller' then
    v_caller_id := p_actor;
  else
    v_caller_id := v_customer.responsible_caller_id;
  end if;

  v_appointment_id := public.crm_insert_appointment(
    p_actor, p_customer_id, (p_appointment ->> 'agent_id')::uuid, v_caller_id,
    (p_appointment ->> 'scheduled_at')::timestamptz,
    nullif(p_appointment ->> 'duration_minutes', '')::integer,
    coalesce(nullif(btrim(p_appointment ->> 'location'), ''), v_customer.address),
    coalesce(nullif(btrim(p_appointment ->> 'postal_code'), ''), v_customer.postal_code),
    p_appointment ->> 'note', v_last.id,
    case when v_followup.id is not null then 'followup' else 'manual' end);

  v_followup_id := public.crm_resolve_open_followup(p_customer_id, v_appointment_id, p_actor);

  return jsonb_build_object('appointment_id', v_appointment_id, 'followup_id', v_followup_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Record consultation result: A / A0 / A1 / B (atomic)
--
-- p_next (A):      { agent_id, scheduled_at, duration_minutes?, note? }
-- p_policies (A1): [{ product_id, monthly_premium, duration_years, policy_date,
--                     policy_number?, note?,
--                     agent_commission:  { rate_percent, total_amount, rule_version,
--                                          calculation, installments:[{number, share_percent, amount, due_date}] },
--                     caller_commission: { caller_multiplier, total_amount, rule_version,
--                                          calculation, installments:[...] } | null }]
--
-- Commission amounts/dates are produced by the application's commission engine
-- (src/lib/commission). Here they are validated: the rate must equal the
-- agent's current rate, formulas are enforced by CHECK constraints, and
-- installments must sum to the total.
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
begin
  if jsonb_typeof(p_data -> 'installments') <> 'array' or jsonb_array_length(p_data -> 'installments') = 0 then
    perform public.crm_fail('Manjka plačilni načrt provizije.');
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

    v_rate := public.current_agent_rate(v_appt.agent_id);
    if v_rate is null then
      perform public.crm_fail('Zastopnik nima nastavljenega odstotka provizije. Obrnite se na lastnika.');
    end if;

    for v_item in select * from jsonb_array_elements(p_policies) loop
      select * into v_product from public.products p where p.id = (v_item ->> 'product_id')::uuid;
      if v_product.id is null or not v_product.is_active then
        perform public.crm_fail('Izbrani produkt ne obstaja ali ni aktiven.');
      end if;
      if (v_item -> 'agent_commission' ->> 'rate_percent')::numeric <> v_rate then
        perform public.crm_fail('Odstotek provizije zastopnika se je medtem spremenil. Poskusite znova.');
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
-- 4. Reschedule / reassign an open appointment
-- ---------------------------------------------------------------------------
create or replace function public.crm_update_appointment(
  p_actor uuid,
  p_appointment_id uuid,
  p_changes jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.user_role := public.crm_require_actor(p_actor);
  v_appt public.appointments;
  v_agent uuid;
  v_when timestamptz;
begin
  select * into v_appt from public.appointments a where a.id = p_appointment_id for update;
  if v_appt.id is null then
    perform public.crm_fail('Termin ne obstaja.');
  end if;
  if not (v_role = 'owner' or v_appt.agent_id = p_actor
          or (v_role = 'caller' and (v_appt.caller_id = p_actor or v_appt.created_by = p_actor))) then
    perform public.crm_fail('Tega termina ne morete urejati.');
  end if;
  if v_appt.status <> 'scheduled' then
    perform public.crm_fail('Urejati je mogoče samo odprte termine.');
  end if;

  v_agent := coalesce(nullif(p_changes ->> 'agent_id', '')::uuid, v_appt.agent_id);
  v_when := coalesce(nullif(p_changes ->> 'scheduled_at', '')::timestamptz, v_appt.scheduled_at);
  perform public.crm_require_agent(v_agent);

  update public.appointments a
     set agent_id = v_agent,
         scheduled_at = v_when,
         duration_minutes = coalesce(nullif(p_changes ->> 'duration_minutes', '')::integer, a.duration_minutes),
         note = case when p_changes ? 'note' then nullif(btrim(p_changes ->> 'note'), '') else a.note end,
         location = coalesce(nullif(btrim(p_changes ->> 'location'), ''), a.location),
         sync_status = case when a.external_event_id is not null then 'pending'::public.calendar_sync_status
                            else a.sync_status end
   where a.id = v_appt.id;

  if v_agent <> v_appt.agent_id then
    update public.customers c set current_agent_id = v_agent where c.id = v_appt.customer_id;
    perform public.crm_log(v_appt.customer_id, 'appointment', v_appt.id, 'appointment_reassigned', p_actor, 'team',
      jsonb_build_object('agent_id', v_appt.agent_id), jsonb_build_object('agent_id', v_agent));
  end if;
  if v_when <> v_appt.scheduled_at then
    perform public.crm_log(v_appt.customer_id, 'appointment', v_appt.id, 'appointment_rescheduled', p_actor, 'team',
      jsonb_build_object('scheduled_at', v_appt.scheduled_at), jsonb_build_object('scheduled_at', v_when));
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Cancel an open appointment (kept in history)
-- ---------------------------------------------------------------------------
create or replace function public.crm_cancel_appointment(
  p_actor uuid,
  p_appointment_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.user_role := public.crm_require_actor(p_actor);
  v_appt public.appointments;
begin
  select * into v_appt from public.appointments a where a.id = p_appointment_id for update;
  if v_appt.id is null then
    perform public.crm_fail('Termin ne obstaja.');
  end if;
  if not (v_role = 'owner' or v_appt.agent_id = p_actor
          or (v_role = 'caller' and (v_appt.caller_id = p_actor or v_appt.created_by = p_actor))) then
    perform public.crm_fail('Tega termina ne morete preklicati.');
  end if;
  if v_appt.status <> 'scheduled' then
    perform public.crm_fail('Preklicati je mogoče samo odprte termine.');
  end if;
  if nullif(btrim(p_reason), '') is null then
    perform public.crm_fail('Razlog preklica je obvezen.');
  end if;

  update public.appointments a
     set status = 'cancelled', cancelled_at = now(), cancelled_by = p_actor, cancel_reason = btrim(p_reason),
         sync_status = case when a.external_event_id is not null then 'pending'::public.calendar_sync_status
                            else a.sync_status end
   where a.id = v_appt.id;

  update public.customers c set status = 'closed'
   where c.id = v_appt.customer_id and c.status = 'scheduled';

  perform public.crm_log(v_appt.customer_id, 'appointment', v_appt.id, 'appointment_cancelled', p_actor, 'team',
    jsonb_build_object('status', 'scheduled'), jsonb_build_object('status', 'cancelled', 'reason', btrim(p_reason)));
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Close a follow-up without a new appointment
-- ---------------------------------------------------------------------------
create or replace function public.crm_close_followup(
  p_actor uuid,
  p_followup_id uuid,
  p_note text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.user_role := public.crm_require_actor(p_actor);
  v_f public.caller_followups;
begin
  select * into v_f from public.caller_followups f where f.id = p_followup_id for update;
  if v_f.id is null then
    perform public.crm_fail('Klic nazaj ne obstaja.');
  end if;
  if not (v_role = 'owner' or (v_role = 'caller' and v_f.caller_id = p_actor)) then
    perform public.crm_fail('Tega klica nazaj ne morete zapreti.');
  end if;
  if v_f.status <> 'open' then
    perform public.crm_fail('Klic nazaj je že zaključen.');
  end if;

  update public.caller_followups f
     set status = 'closed', resolved_at = now(), resolved_by = p_actor,
         note = coalesce(nullif(btrim(p_note), ''), f.note)
   where f.id = v_f.id;

  update public.customers c set status = 'closed' where c.id = v_f.customer_id and c.status = 'callback';

  perform public.crm_log(v_f.customer_id, 'caller_followup', v_f.id, 'followup_closed', p_actor, 'team',
    null, jsonb_build_object('note', nullif(btrim(p_note), '')));
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Customer data changes / notes / archive
-- ---------------------------------------------------------------------------
create or replace function public.crm_update_customer(
  p_actor uuid,
  p_customer_id uuid,
  p_changes jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.customers;
  v_new public.customers;
  v_old_diff jsonb := '{}'::jsonb;
  v_new_diff jsonb := '{}'::jsonb;
  v_key text;
begin
  perform public.crm_require_actor(p_actor);
  select * into v_old from public.customers c where c.id = p_customer_id for update;
  if v_old.id is null or not public.crm_user_can_view_customer(p_actor, p_customer_id) then
    perform public.crm_fail('Stranka ne obstaja ali do nje nimate dostopa.');
  end if;

  update public.customers c
     set first_name = coalesce(nullif(btrim(p_changes ->> 'first_name'), ''), c.first_name),
         last_name = coalesce(nullif(btrim(p_changes ->> 'last_name'), ''), c.last_name),
         phone = coalesce(nullif(btrim(p_changes ->> 'phone'), ''), c.phone),
         email = case when p_changes ? 'email' then nullif(lower(btrim(p_changes ->> 'email')), '') else c.email end,
         address = coalesce(nullif(btrim(p_changes ->> 'address'), ''), c.address),
         postal_code = coalesce(nullif(btrim(p_changes ->> 'postal_code'), ''), c.postal_code),
         city = case when p_changes ? 'city' then nullif(btrim(p_changes ->> 'city'), '') else c.city end
   where c.id = p_customer_id
  returning * into v_new;

  foreach v_key in array array['first_name', 'last_name', 'phone', 'email', 'address', 'postal_code', 'city'] loop
    if (to_jsonb(v_old) -> v_key) is distinct from (to_jsonb(v_new) -> v_key) then
      v_old_diff := v_old_diff || jsonb_build_object(v_key, to_jsonb(v_old) -> v_key);
      v_new_diff := v_new_diff || jsonb_build_object(v_key, to_jsonb(v_new) -> v_key);
    end if;
  end loop;

  if v_new_diff <> '{}'::jsonb then
    perform public.crm_log(p_customer_id, 'customer', p_customer_id, 'customer_updated', p_actor, 'team',
      v_old_diff, v_new_diff);
  end if;
end;
$$;

create or replace function public.crm_add_customer_note(
  p_actor uuid,
  p_customer_id uuid,
  p_note text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.crm_require_actor(p_actor);
  if not public.crm_user_can_view_customer(p_actor, p_customer_id) then
    perform public.crm_fail('Stranka ne obstaja ali do nje nimate dostopa.');
  end if;
  if nullif(btrim(p_note), '') is null then
    perform public.crm_fail('Opomba je prazna.');
  end if;
  perform public.crm_log(p_customer_id, 'customer', p_customer_id, 'note_added', p_actor, 'team', null,
    jsonb_build_object('note', btrim(p_note)));
end;
$$;

create or replace function public.crm_set_customer_archived(
  p_actor uuid,
  p_customer_id uuid,
  p_archived boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.crm_require_owner(p_actor);
  update public.customers c
     set archived_at = case when p_archived then coalesce(c.archived_at, now()) else null end
   where c.id = p_customer_id;
  perform public.crm_log(p_customer_id, 'customer', p_customer_id,
    case when p_archived then 'customer_archived' else 'customer_restored' end, p_actor, 'team');
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Payroll: mark installments paid (owner only; paid rows are final)
-- ---------------------------------------------------------------------------
create or replace function public.crm_mark_installments_paid(
  p_actor uuid,
  p_installment_ids uuid[],
  p_paid_at timestamptz default now(),
  p_note text default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.commission_installments;
  v_customer_id uuid;
  v_count integer := 0;
begin
  perform public.crm_require_owner(p_actor);
  if p_installment_ids is null or cardinality(p_installment_ids) = 0 then
    perform public.crm_fail('Ni izbranih izplačil.');
  end if;

  for v_row in
    select * from public.commission_installments i where i.id = any (p_installment_ids) for update
  loop
    if v_row.status <> 'scheduled' then
      perform public.crm_fail('Izplačilo je že označeno kot plačano ali preklicano.');
    end if;
    update public.commission_installments i
       set status = 'paid', paid_at = coalesce(p_paid_at, now()), paid_by = p_actor,
           paid_amount = v_row.amount, payment_note = nullif(btrim(p_note), '')
     where i.id = v_row.id;

    select p.customer_id into v_customer_id from public.policies p where p.id = v_row.policy_id;
    perform public.crm_log(v_customer_id, 'commission_installment', v_row.id, 'payout_marked_paid', p_actor, 'owner',
      jsonb_build_object('status', 'scheduled'),
      jsonb_build_object('status', 'paid', 'amount', v_row.amount, 'paid_at', coalesce(p_paid_at, now())),
      jsonb_build_object('beneficiary_id', v_row.beneficiary_id, 'original_due_date', v_row.original_due_date,
                         'installment_number', v_row.installment_number));
    v_count := v_count + 1;
  end loop;

  if v_count <> cardinality(p_installment_ids) then
    perform public.crm_fail('Nekatera izplačila ne obstajajo.');
  end if;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. Documents (metadata; file lives in private Storage bucket)
-- ---------------------------------------------------------------------------
create or replace function public.crm_register_document(
  p_actor uuid,
  p_customer_id uuid,
  p_policy_id uuid,
  p_document_type public.document_type,
  p_storage_path text,
  p_file_name text,
  p_mime_type text,
  p_size_bytes bigint
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.user_role := public.crm_require_actor(p_actor);
  v_id uuid;
begin
  if v_role = 'caller' or not public.crm_user_can_view_customer(p_actor, p_customer_id) then
    perform public.crm_fail('Dokumenta ne morete naložiti za to stranko.');
  end if;
  if p_policy_id is not null and not exists (
    select 1 from public.policies p where p.id = p_policy_id and p.customer_id = p_customer_id
  ) then
    perform public.crm_fail('Polica ne pripada tej stranki.');
  end if;

  insert into public.documents
    (customer_id, policy_id, document_type, storage_path, file_name, mime_type, size_bytes, uploaded_by)
  values
    (p_customer_id, p_policy_id, p_document_type, p_storage_path, p_file_name, p_mime_type, p_size_bytes, p_actor)
  returning id into v_id;

  perform public.crm_log(p_customer_id, 'document', v_id, 'document_uploaded', p_actor, 'team', null,
    jsonb_build_object('file_name', p_file_name, 'document_type', p_document_type, 'policy_id', p_policy_id));
  return v_id;
end;
$$;

create or replace function public.crm_soft_delete_document(p_actor uuid, p_document_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_doc public.documents;
begin
  perform public.crm_require_owner(p_actor);
  update public.documents d set deleted_at = now(), deleted_by = p_actor
   where d.id = p_document_id and d.deleted_at is null
  returning * into v_doc;
  if v_doc.id is not null then
    perform public.crm_log(v_doc.customer_id, 'document', v_doc.id, 'document_removed', p_actor, 'team', null,
      jsonb_build_object('file_name', v_doc.file_name));
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 10. Employees (owner only)
-- ---------------------------------------------------------------------------
create or replace function public.crm_create_employee_profile(
  p_actor uuid,
  p_user_id uuid,
  p_profile jsonb,
  p_rate_percent numeric default null
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

  perform public.crm_log(null, 'profile', p_user_id, 'employee_created', p_actor, 'owner', null,
    jsonb_build_object('role', v_role, 'email', lower(btrim(p_profile ->> 'email')), 'rate_percent', p_rate_percent));
end;
$$;

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

  update public.profiles p
     set first_name = coalesce(nullif(btrim(p_changes ->> 'first_name'), ''), p.first_name),
         last_name = coalesce(nullif(btrim(p_changes ->> 'last_name'), ''), p.last_name),
         phone = case when p_changes ? 'phone' then nullif(btrim(p_changes ->> 'phone'), '') else p.phone end,
         role = coalesce(nullif(p_changes ->> 'role', '')::public.user_role, p.role),
         is_active = coalesce((p_changes ->> 'is_active')::boolean, p.is_active)
   where p.id = p_user_id
  returning * into v_new;

  perform public.crm_log(null, 'profile', p_user_id, 'employee_updated', p_actor, 'owner',
    jsonb_build_object('first_name', v_old.first_name, 'last_name', v_old.last_name, 'phone', v_old.phone,
                       'role', v_old.role, 'is_active', v_old.is_active),
    jsonb_build_object('first_name', v_new.first_name, 'last_name', v_new.last_name, 'phone', v_new.phone,
                       'role', v_new.role, 'is_active', v_new.is_active));
end;
$$;

create or replace function public.crm_set_agent_rate(
  p_actor uuid,
  p_agent_id uuid,
  p_rate_percent numeric
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old numeric := public.current_agent_rate(p_agent_id);
  v_role public.user_role;
begin
  perform public.crm_require_owner(p_actor);
  select p.role into v_role from public.profiles p where p.id = p_agent_id;
  if coalesce(v_role::text, '') not in ('agent', 'owner') then
    perform public.crm_fail('Odstotek provizije je mogoče nastaviti samo zastopniku ali lastniku.');
  end if;
  if p_rate_percent is null or p_rate_percent < 0 or p_rate_percent > 100 then
    perform public.crm_fail('Odstotek provizije mora biti med 0 in 100.');
  end if;
  if v_old is not distinct from p_rate_percent then
    return;
  end if;

  insert into public.agent_commission_rates (agent_id, rate_percent, set_by)
  values (p_agent_id, p_rate_percent, p_actor);

  perform public.crm_log(null, 'profile', p_agent_id, 'agent_rate_changed', p_actor, 'owner',
    jsonb_build_object('rate_percent', v_old), jsonb_build_object('rate_percent', p_rate_percent));
end;
$$;

create or replace function public.crm_update_own_profile(p_actor uuid, p_changes jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.crm_require_actor(p_actor);
  update public.profiles p
     set first_name = coalesce(nullif(btrim(p_changes ->> 'first_name'), ''), p.first_name),
         last_name = coalesce(nullif(btrim(p_changes ->> 'last_name'), ''), p.last_name),
         phone = case when p_changes ? 'phone' then nullif(btrim(p_changes ->> 'phone'), '') else p.phone end
   where p.id = p_actor;
end;
$$;

-- ---------------------------------------------------------------------------
-- 11. Products (owner only)
-- ---------------------------------------------------------------------------
create or replace function public.crm_upsert_product(
  p_actor uuid,
  p_product_id uuid,
  p_name text,
  p_is_active boolean,
  p_sort_order integer
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
  if p_product_id is null then
    insert into public.products (name, is_active, sort_order)
    values (btrim(p_name), coalesce(p_is_active, true), coalesce(p_sort_order, 0))
    returning id into v_id;
  else
    update public.products p
       set name = btrim(p_name), is_active = coalesce(p_is_active, p.is_active),
           sort_order = coalesce(p_sort_order, p.sort_order)
     where p.id = p_product_id
    returning id into v_id;
  end if;
  perform public.crm_log(null, 'product', v_id, 'product_saved', p_actor, 'owner', null,
    jsonb_build_object('name', btrim(p_name), 'is_active', p_is_active));
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 12. Demo data purge (service role / SQL editor only)
-- Removes customers flagged is_demo and everything hanging off them, then
-- demo profiles and their auth users. Refuses if a demo profile is linked to
-- real (non-demo) data.
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
  delete from public.profiles where id = any (v_profiles);
  delete from auth.users where id = any (v_profiles);

  return jsonb_build_object(
    'customers_removed', cardinality(v_customers),
    'profiles_removed', cardinality(v_profiles),
    'storage_paths', to_jsonb(v_storage_paths)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Execute privileges: service_role only for everything crm_* above
-- ---------------------------------------------------------------------------
do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'crm_fail', 'crm_require_actor', 'crm_require_owner', 'crm_require_agent', 'crm_log',
        'crm_next_visit_number', 'crm_resolve_open_followup', 'crm_insert_appointment',
        'crm_create_customer_with_appointment', 'crm_schedule_appointment', 'crm_insert_commission',
        'crm_record_result', 'crm_update_appointment', 'crm_cancel_appointment', 'crm_close_followup',
        'crm_update_customer', 'crm_add_customer_note', 'crm_set_customer_archived',
        'crm_mark_installments_paid', 'crm_register_document', 'crm_soft_delete_document',
        'crm_create_employee_profile', 'crm_update_employee', 'crm_set_agent_rate',
        'crm_update_own_profile', 'crm_upsert_product', 'crm_purge_demo_data', 'current_agent_rate',
        'crm_user_can_view_customer'
      )
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end;
$$;
