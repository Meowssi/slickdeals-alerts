#!/usr/bin/env node
/**
 * Apply Supabase SQL migrations idempotently against the project's Postgres.
 *
 * Runs from `prebuild` so a fresh Vercel + Supabase deploy gets its schema
 * applied automatically. Reads .sql files from ../../supabase/migrations/,
 * tracks applied versions in supabase_migrations.schema_migrations.
 *
 * Skips silently if no DB connection string is set (e.g., local dev without
 * Supabase env vars, or a Vercel preview build before the integration runs).
 */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, "..", "..", "..", "supabase", "migrations");

const CONNECTION_STRING =
  process.env.POSTGRES_URL_NON_POOLING ||
  process.env.POSTGRES_URL ||
  process.env.SUPABASE_DB_URL ||
  process.env.DATABASE_URL;

if (!CONNECTION_STRING) {
  console.log("[migrate] No DB connection string set — skipping migration step.");
  console.log("[migrate]   (Expected one of POSTGRES_URL_NON_POOLING, POSTGRES_URL, SUPABASE_DB_URL, DATABASE_URL.)");
  process.exit(0);
}

// pg-connection-string >=2.7 treats sslmode=require as verify-full, which
// rejects Supabase's cert chain on Vercel's build runtime. Strip whatever
// sslmode is in the URL and rely on the explicit ssl option below.
const NORMALIZED_CS = CONNECTION_STRING.replace(/[?&]sslmode=[^&]*/g, "").replace(/\?$/, "");

const client = new Client({
  connectionString: NORMALIZED_CS,
  ssl: { rejectUnauthorized: false },
});

async function main() {
  await client.connect();
  console.log("[migrate] Connected to Postgres.");

  await client.query(`
    create schema if not exists supabase_migrations;
    create table if not exists supabase_migrations.schema_migrations (
      version text primary key,
      statements text[],
      name text
    );
  `);

  const files = (await readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith(".sql"))
    .sort();

  if (files.length === 0) {
    console.log(`[migrate] No migration files found in ${MIGRATIONS_DIR}.`);
    return;
  }

  const { rows: applied } = await client.query(
    "select version from supabase_migrations.schema_migrations",
  );
  const appliedSet = new Set(applied.map((r) => r.version));

  let appliedCount = 0;
  for (const file of files) {
    const version = file.split("_")[0];
    const name = file.replace(/^\d+_/, "").replace(/\.sql$/, "");
    if (appliedSet.has(version)) {
      console.log(`[migrate] -- already applied: ${file}`);
      continue;
    }
    console.log(`[migrate] ++ applying: ${file}`);
    const sql = await readFile(path.join(MIGRATIONS_DIR, file), "utf8");
    try {
      await client.query("begin");
      await client.query(sql);
      await client.query(
        "insert into supabase_migrations.schema_migrations (version, name) values ($1, $2) on conflict (version) do nothing",
        [version, name],
      );
      await client.query("commit");
      appliedCount += 1;
    } catch (e) {
      await client.query("rollback");
      console.error(`[migrate] !! failed on ${file}:`, e.message);
      throw e;
    }
  }

  if (appliedCount > 0) {
    console.log(`[migrate] Applied ${appliedCount} new migration(s). Reloading PostgREST schema cache.`);
    await client.query("notify pgrst, 'reload schema'");
  } else {
    console.log("[migrate] All migrations already applied. No changes.");
  }
}

main()
  .catch((e) => {
    console.error("[migrate] Fatal error:", e);
    process.exit(1);
  })
  .finally(() => client.end());
