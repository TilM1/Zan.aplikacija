/**
 * Apply pending migrations from supabase/migrations to the database in
 * SUPABASE_DB_URL (.env.local). Each file runs in its own transaction and is
 * recorded in supabase_migrations.schema_migrations (same table the Supabase
 * CLI uses), so already-applied files are skipped.
 *
 *   npm run db:migrate            apply pending migrations
 *   npm run db:migrate -- --dry   only list what would run
 */
import { config } from "dotenv";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";

config({ path: ".env.local" });

async function main() {
  const url = process.env.SUPABASE_DB_URL;
  if (!url) throw new Error("SUPABASE_DB_URL is not set in .env.local");
  const dry = process.argv.includes("--dry");
  const dir = path.resolve("supabase/migrations");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

  const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
  try {
    await sql`create schema if not exists supabase_migrations`;
    await sql`create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text)`;
    const applied = new Set((await sql<{ version: string }[]>`select version from supabase_migrations.schema_migrations`).map((r) => r.version));

    const pending = files.filter((f) => !applied.has(f.split("_")[0]));
    if (pending.length === 0) return console.log("Database is up to date.");

    for (const file of pending) {
      const version = file.split("_")[0];
      const name = file.slice(version.length + 1, -".sql".length);
      if (dry) {
        console.log(`would apply ${file}`);
        continue;
      }
      const content = readFileSync(path.join(dir, file), "utf8");
      await sql.begin(async (tx) => {
        await tx.unsafe(content);
        await tx`insert into supabase_migrations.schema_migrations (version, name, statements) values (${version}, ${name}, ${[content]})`;
      });
      console.log(`applied ${file}`);
    }
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error("Migration failed:", e.message ?? e);
  process.exit(1);
});
