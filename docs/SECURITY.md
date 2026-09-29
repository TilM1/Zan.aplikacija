# Security

## Layers

| Threat | Protection |
|---|---|
| Reading someone else's data by calling the API directly | PostgreSQL **Row Level Security** on every table. The browser key only reads what RLS allows. Anonymous users get nothing. |
| Changing data / amounts via the API | Browsers have **no write privileges** on any table. All writes go through `crm_*` database functions, callable only by the server, which re-check the user's role and ownership. Commission formulas are also enforced by CHECK constraints. |
| Password guessing | App-level lockout: 5 failed logins per e-mail / 30 per IP within 15 minutes (`login_attempts`). Supabase Auth adds its own rate limits. |
| Weak / leaked temporary passwords | Owner-issued passwords are **temporary**. Until the employee sets their own, the account sees **no data at all** (enforced in RLS via `app_metadata.must_change_password`). Password policy: ≥ 10 characters, letters + digits, not trivially common. |
| Stolen session after deactivation / password reset | Sessions are revoked (`crm_revoke_sessions`). Deactivated users get no data even with a still-valid token (RLS requires an active profile). Changing your own password signs out other devices. |
| Self-registration | Public sign-ups disabled in Supabase Auth. Only the Owner creates accounts. |
| Service keys in the browser | The secret key is used only in server code. It is never prefixed `NEXT_PUBLIC_`, never committed (`.env*` git-ignored). |
| Private documents | Private bucket, no storage policies. Access only through 60-second signed URLs issued after an RLS check. |
| XSS / clickjacking / MIME sniffing | Content-Security-Policy (scripts/connections only to own origin + Supabase), `X-Frame-Options: DENY`, `frame-ancestors 'none'`, `nosniff`, HSTS, strict referrer policy. React escapes all output. |
| CSRF | Next.js Server Actions verify the request Origin. Supabase session cookies are `SameSite=Lax`. |
| Spreadsheet formula injection in exports | CSV cells starting with `= + - @` (non-numeric) are neutralised. |
| Accidental data loss | Business records cannot be hard-deleted (triggers). The ledger and activity log are immutable/append-only. Wiping requires `--confirm <project-ref>`. The demo seed refuses to run on a database with real users. |
| Vulnerable dependencies | `npm audit` = 0 known vulnerabilities (uuid pinned via `overrides`). |

Automated tests (`tests/db/workflows.test.ts`) cover RLS isolation, blocked direct writes, temporary-password lockout, login throttling, session revocation and ledger immutability.

## Recommended settings (Supabase Dashboard)

- Authentication → Sign In / Providers: **Allow new users to sign up = off** ✔
- Authentication → Providers → Email: **Minimum password length 10**, require letters + digits.
- Authentication → Attack Protection: **Leaked password protection** (Pro plan), CAPTCHA optional.
- Authentication → Multi-Factor: TOTP enabled. Owner 2FA can be enforced later; the app is prepared for it.
- Rotate the secret key and database password whenever they may have been exposed (e.g. shared in chat). Then update `.env.local` and Vercel.

## Operational rules

- Accounts: personal logins only, never shared. Deactivate leavers the same day (Zaposleni → Status → Neaktiven).
- Give temporary passwords in person or by phone, not by e-mail or chat.
- Turn on 2FA for the GitHub, Vercel and Supabase accounts of everyone with access.
- Never use real customer data outside production (staging uses demo data only).
- Store exports encrypted and delete them when no longer needed (GDPR).
