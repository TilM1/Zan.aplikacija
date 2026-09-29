/**
 * Apply demo seed or cleanup to a Supabase database.
 *   npm run demo:seed      (generates fresh SQL relative to today, then applies)
 *   npm run demo:cleanup
 * Requires SUPABASE_DB_URL in .env.local (Dashboard → Connect → Session pooler).
 * Alternatively paste supabase/seed/*.sql into the Supabase SQL editor.
 */
import "dotenv/config";
import { config } from "dotenv";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { generateDemoSeed, DEMO_EMAIL_DOMAIN, DEMO_PASSWORD } from "./generate-demo-seed";

config({ path: ".env.local" });

async function main() {
  const mode = process.argv[2];
  if (mode !== "seed" && mode !== "cleanup") throw new Error("Usage: apply.ts seed|cleanup");
  const url = process.env.SUPABASE_DB_URL;
  if (!url) throw new Error("SUPABASE_DB_URL is not set (.env.local). Or run the SQL file in the Supabase SQL editor.");

  let file = path.resolve("supabase/seed/demo-cleanup.sql");
  if (mode === "seed") {
    file = path.resolve("supabase/seed/demo-seed.sql");
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, generateDemoSeed());
  }
  const sql = postgres(url, { max: 1, prepare: false });
  try {
    const result = await sql.unsafe(readFileSync(file, "utf8"));
    console.log(mode === "seed" ? `Demo data created. Log in with *@${DEMO_EMAIL_DOMAIN} / ${DEMO_PASSWORD}` : "Demo data removed:", mode === "cleanup" ? JSON.stringify(result.at(-1)) : "");
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
