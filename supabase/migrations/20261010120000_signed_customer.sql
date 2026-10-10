-- Owner: add an already signed customer in one step (no appointment to type in).
-- Internally it is the same chain as a normal sale (customer → consultation →
-- result A1 → policies → commissions), so reports, payroll and storno work
-- unchanged. The consultation is dated on the day of signing.

create or replace function public.crm_add_signed_customer(
  p_actor uuid,
  p_customer jsonb,
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
  v_created jsonb;
  v_result jsonb;
  v_appointment_id uuid;
begin
  perform public.crm_require_owner(p_actor);

  v_created := public.crm_create_customer_with_appointment(
    p_actor,
    p_customer,
    jsonb_build_object(
      'agent_id', p_sale ->> 'agent_id',
      'scheduled_at', v_at,
      'duration_minutes', 60,
      'note', 'Podpisana stranka – vnesena neposredno, brez termina.',
      'caller_id', nullif(p_sale ->> 'caller_id', '')),
    null);
  v_appointment_id := (v_created ->> 'appointment_id')::uuid;

  v_result := public.crm_record_result(p_actor, v_appointment_id, 'A1', p_sale ->> 'note', null, p_policies);

  -- Count the consultation in the month it was actually signed, not today
  update public.appointments a set completed_at = v_at where a.id = v_appointment_id;

  perform public.crm_log((v_created ->> 'customer_id')::uuid, 'customer', (v_created ->> 'customer_id')::uuid,
    'signed_customer_added', p_actor, 'team', null,
    jsonb_build_object('signed_at', v_at, 'policies', jsonb_array_length(p_policies)));

  return v_result || jsonb_build_object('customer_id', v_created ->> 'customer_id');
end;
$$;

revoke execute on function public.crm_add_signed_customer(uuid, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.crm_add_signed_customer(uuid, jsonb, jsonb, jsonb) to service_role;
