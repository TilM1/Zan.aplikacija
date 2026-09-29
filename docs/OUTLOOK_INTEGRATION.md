# Future: Outlook calendar sync (per Agent)

Not implemented in V1. The data model is ready for it.

## What exists

`appointments` are real database entities with sync fields:

| Column | Use |
|---|---|
| `external_provider` | e.g. `'outlook'` |
| `external_event_id` | Microsoft Graph event id (unique per provider) |
| `sync_status` | `not_synced` / `pending` / `synced` / `error` |
| `last_synced_at`, `sync_error` | diagnostics |

`crm_update_appointment` and `crm_cancel_appointment` already set `sync_status = 'pending'` when a synced appointment changes, so a sync worker knows what to push.

## Suggested implementation

1. **Per-agent OAuth:** a new table `calendar_connections (agent_id, provider, encrypted refresh token, calendar_id, status)`. Tokens stay server-only (e.g. Supabase Vault). The Agent connects from Profile ("Poveži Outlook") using Microsoft identity platform delegated permission `Calendars.ReadWrite`.
2. **Push (CRM → Outlook):** a background job (Vercel Cron or Supabase Edge Function + `pg_cron`) processes appointments with `sync_status = 'pending'` or `'not_synced'`. It creates, updates or deletes events through Microsoft Graph, stores `external_event_id`, and sets `synced`/`error`.
3. **Reassignment:** when `agent_id` changes, delete the event from the old Agent's calendar and create it in the new Agent's calendar.
4. **Pull (optional):** Graph change notifications can block busy slots in the booking UI. The CRM should remain the source of truth for appointments.
5. Record sync actions in `activity_log` (`calendar_synced`), with metadata only.

Nothing in the UI depends on this. The internal calendar reads `appointments` directly.
