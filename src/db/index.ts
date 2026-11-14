import "server-only";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

/**
 * Single shared connection pool for the whole app (max 10 by default).
 * Cached on globalThis so `next dev` hot-reloads don't open new pools.
 */
const globalForDb = globalThis as unknown as { faturaPool?: Pool; faturaDb?: NodePgDatabase<typeof schema> };

function createPool() {
  // Not validated here so `next build` works without a database; the first query fails clearly instead.
  const connectionString = process.env.DATABASE_URL;
  return new Pool({
    connectionString,
    max: Number(process.env.DB_POOL_MAX ?? 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
}

export const pool = globalForDb.faturaPool ?? createPool();
export const db = globalForDb.faturaDb ?? drizzle(pool, { schema, casing: "snake_case" });

if (process.env.NODE_ENV !== "production") {
  globalForDb.faturaPool = pool;
  globalForDb.faturaDb = db;
}

export type DB = typeof db;
/** Transaction handle type, for helpers that must run inside db.transaction(). */
export type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];
export { schema };
