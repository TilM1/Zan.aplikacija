-- New call-list statuses (separate migration: new enum values can only be used after commit)
--   no_answer  "Se ne javi"            → comes back automatically the next day, attempts are counted
--   invalid    "Neveljavna številka"   → out of the calling queue (not a GDPR objection)
alter type public.lead_status add value if not exists 'no_answer';
alter type public.lead_status add value if not exists 'invalid';
