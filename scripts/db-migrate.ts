/**
 * Applies db/migrations/*.sql that haven't run yet, in name order, each in one transaction.
 *
 * Run with: npm run db:migrate
 * Needs DATABASE_URL in .env.local (or the environment).
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { neon } from "@neondatabase/serverless";

const ENV_FILE = resolve(process.cwd(), ".env.local");
if (existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);

const DIR = resolve(process.cwd(), "db/migrations");

/**
 * Splits a file into statements on ";" at a line end, dropping "--" comments. Simple on purpose:
 * keep migrations to plain statements (no "--" inside strings, no $$ function bodies).
 */
function statements(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n")
    .split(/;\s*$/m)
    .map((s) => s.trim())
    .filter(Boolean);
}

async function main() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) throw new Error("DATABASE_URL is not set. Add it to .env.local.");
  const sql = neon(url);

  await sql`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`;
  const done = new Set((await sql`SELECT name FROM schema_migrations`).map((r) => r.name as string));

  const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
  let applied = 0;
  for (const file of files) {
    if (done.has(file)) continue;
    const queries = statements(readFileSync(resolve(DIR, file), "utf8")).map((s) => sql.query(s));
    await sql.transaction([...queries, sql`INSERT INTO schema_migrations (name) VALUES (${file})`]);
    console.log(`Applied ${file}`);
    applied += 1;
  }
  console.log(applied ? `Done: ${applied} applied.` : "Up to date.");
}

main().catch((err: unknown) => {
  console.error("Migration failed:", err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
