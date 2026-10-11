-- =============================================================================
-- Calendar invitations by e-mail (.ics) for appointments.
-- The CRM only SENDS an ordinary invitation e-mail to the agent; nothing is
-- installed in, or connected to, the agent's mailbox or calendar.
-- =============================================================================

alter table public.profiles
  add column invite_enabled boolean not null default true,
  add column invite_email text check (invite_email is null or invite_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$');

alter table public.appointments
  add column invite_sent_to text,
  add column invite_sequence integer not null default 0;

-- Agent/owner: own invitation settings
create or replace function public.crm_set_invite_settings(p_actor uuid, p_enabled boolean, p_email text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.crm_require_actor(p_actor);
  update public.profiles p
     set invite_enabled = coalesce(p_enabled, true),
         invite_email = nullif(lower(btrim(p_email)), '')
   where p.id = p_actor;
end;
$$;

-- Server: remember to whom the invitation of an appointment was last sent.
-- Returns the sequence number for the next message about this appointment.
create or replace function public.crm_mark_invite(p_appointment_id uuid, p_sent_to text, p_error text default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seq integer;
begin
  update public.appointments a
     set invite_sequence = a.invite_sequence + 1,
         invite_sent_to = case when p_error is null then p_sent_to else a.invite_sent_to end,
         external_provider = 'email',
         sync_status = case when p_error is null then 'synced' else 'error' end::public.calendar_sync_status,
         last_synced_at = now(),
         sync_error = p_error
   where a.id = p_appointment_id
  returning a.invite_sequence into v_seq;
  return v_seq;
end;
$$;

revoke execute on function public.crm_set_invite_settings(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.crm_set_invite_settings(uuid, boolean, text) to service_role;
revoke execute on function public.crm_mark_invite(uuid, text, text) from public, anon, authenticated;
grant execute on function public.crm_mark_invite(uuid, text, text) to service_role;
