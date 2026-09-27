import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { Pool, type QueryResultRow } from "pg";

const globalForPg = globalThis as typeof globalThis & { taoPool?: Pool; taoMigrations?: Promise<void> };
export const db = globalForPg.taoPool ?? new Pool({ connectionString: process.env.DATABASE_URL });
if (process.env.NODE_ENV !== "production") globalForPg.taoPool = db;

export const LOCAL_OWNER_ID = "local-demo";

export async function initializeDatabase() {
  if (!globalForPg.taoMigrations) globalForPg.taoMigrations = runMigrations();
  await globalForPg.taoMigrations;
}

async function runMigrations() {
  const client = await db.connect();
  try {
    await client.query("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
    const dir = path.join(process.cwd(), "db", "migrations");
    const files = (await readdir(dir)).filter((name) => name.endsWith(".sql")).sort();
    for (const name of files) {
      await client.query("BEGIN");
      try {
        const alreadyApplied = await client.query("SELECT 1 FROM schema_migrations WHERE name = $1", [name]);
        if (alreadyApplied.rowCount === 0) {
          await client.query(await readFile(path.join(dir, name), "utf8"));
          await client.query("INSERT INTO schema_migrations(name) VALUES ($1)", [name]);
        }
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    client.release();
  }
}

export async function query<T extends QueryResultRow = QueryResultRow>(text: string, values: unknown[] = []) {
  await initializeDatabase();
  return db.query<T>(text, values);
}

export async function transaction<T>(work: (client: import("pg").PoolClient) => Promise<T>) {
  await initializeDatabase();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const value = await work(client);
    await client.query("COMMIT");
    return value;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export function jsonError(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

export function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
