/**
 * In-process PostgreSQL (PGlite) with minimal Supabase stubs, running the real
 * migration files. Used to test workflow functions, constraints and RLS.
 */
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const SUPABASE_STUBS = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema extensions;
create extension pgcrypto with schema extensions;
create schema auth;
create table auth.users (
  id uuid primary key,
  email text,
  instance_id uuid, aud text, role text, encrypted_password text,
  email_confirmed_at timestamptz, raw_app_meta_data jsonb, raw_user_meta_data jsonb,
  created_at timestamptz default now(), updated_at timestamptz default now(),
  confirmation_token text, recovery_token text, email_change_token_new text, email_change text
);
create table auth.identities (
  id uuid primary key, provider_id text, user_id uuid, identity_data jsonb, provider text,
  last_sign_in_at timestamptz, created_at timestamptz, updated_at timestamptz
);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
create schema storage;
create table storage.buckets (
  id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]
);
grant usage on schema public to anon, authenticated, service_role;
`;

export const MIGRATIONS_DIR = path.resolve(__dirname, "../../supabase/migrations");

export class TestDb {
  constructor(public readonly pg: PGlite) {}

  static async create(): Promise<TestDb> {
    const pg = new PGlite({ extensions: { pg_trgm, pgcrypto } });
    await pg.exec(SUPABASE_STUBS);
    for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort()) {
      try {
        await pg.exec(readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"));
      } catch (e) {
        throw new Error(`Migration ${file} failed: ${(e as Error).message}`);
      }
    }
    return new TestDb(pg);
  }

  /** Run as the database owner (equivalent to service_role: bypasses RLS). */
  async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    const res = await this.pg.query<T>(sql, params);
    return res.rows;
  }

  async one<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T> {
    const rows = await this.query<T>(sql, params);
    if (rows.length !== 1) throw new Error(`Expected 1 row, got ${rows.length}`);
    return rows[0];
  }

  /** Run as an authenticated end user (RLS applies), like a browser with a JWT. */
  async asUser<T = Record<string, unknown>>(userId: string, sql: string, params: unknown[] = []): Promise<T[]> {
    return this.pg.transaction(async (tx) => {
      await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId]);
      await tx.exec("set local role authenticated");
      const res = await tx.query<T>(sql, params);
      return res.rows;
    });
  }

  async createUser(role: "owner" | "agent" | "caller", name: string, ratePercent?: string, opts?: { isDemo?: boolean }) {
    const id = randomUUID();
    const email = `${name.toLowerCase()}@test.local`;
    await this.query(`insert into auth.users (id, email) values ($1, $2)`, [id, email]);
    await this.query(
      `insert into public.profiles (id, first_name, last_name, email, role, is_demo) values ($1, $2, 'Test', $3, $4, $5)`,
      [id, name, email, role, opts?.isDemo ?? false],
    );
    if (ratePercent !== undefined) {
      await this.query(`insert into public.agent_commission_rates (agent_id, rate_percent) values ($1, $2)`, [id, ratePercent]);
    }
    return id;
  }

  async rpc<T = unknown>(fn: string, args: Record<string, unknown>): Promise<T> {
    const names = Object.keys(args);
    const sql = `select public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(", ")}) as result`;
    const values = names.map((n) => {
      const v = args[n];
      if (Array.isArray(v)) return v.some((x) => typeof x === "object") ? JSON.stringify(v) : v;
      return v !== null && typeof v === "object" ? JSON.stringify(v) : v;
    });
    const row = await this.one<{ result: T }>(sql, values);
    return row.result;
  }

  async close() {
    await this.pg.close();
  }
}
