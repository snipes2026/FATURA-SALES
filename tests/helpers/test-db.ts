/**
 * Throwaway in-memory Postgres (PGlite) exposed on a local port, so the app's
 * real node-postgres code paths can run against it in tests.
 */
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

const MIGRATIONS = path.resolve(__dirname, "../../drizzle");

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => resolve(port));
    });
  });
}

export async function startTestDb() {
  const db = await PGlite.create({ extensions: { pg_trgm } });
  const port = await freePort();
  const server = new PGLiteSocketServer({ db, port, host: "127.0.0.1", maxConnections: 4, idleTimeout: 0 });
  await server.start();
  const url = `postgres://postgres:postgres@127.0.0.1:${port}/postgres`;
  return {
    url,
    async stop() {
      await server.stop();
      await db.close();
    },
  };
}

/** Applies migrations; with `upTo`, only the first `upTo` entries of the journal (to build an "old" database). */
export async function runMigrations(url: string, upTo?: number) {
  let folder = MIGRATIONS;
  let tmp: string | null = null;
  if (upTo !== undefined) {
    tmp = mkdtempSync(path.join(tmpdir(), "fd-mig-"));
    cpSync(MIGRATIONS, tmp, { recursive: true });
    const journalPath = path.join(tmp, "meta", "_journal.json");
    const journal = JSON.parse(readFileSync(journalPath, "utf8"));
    journal.entries = journal.entries.slice(0, upTo);
    writeFileSync(journalPath, JSON.stringify(journal));
    folder = tmp;
  }
  const pool = new pg.Pool({ connectionString: url, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: folder });
  } finally {
    await pool.end();
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  }
}

/** Minimal master data shared by the integration tests. Returns ids. */
export async function seedBasics(url: string) {
  const c = new pg.Client(url);
  await c.connect();
  try {
    const q = async (sql: string, params: unknown[] = []) => (await c.query(sql, params)).rows[0];
    const role = await q(`insert into roles (code, name) values ('ADMIN','Admin') returning id`);
    const user = await q(`insert into users (name, username, password_hash, role_id) values ('Tester','tester','x',$1) returning id`, [role.id]);
    const loc = await q(`insert into locations (name, type, state_code) values ('Main Store','STORE','27') returning id`);
    await c.query(`insert into user_locations (user_id, location_id) values ($1,$2)`, [user.id, loc.id]);
    const supIntra = await q(`insert into suppliers (name, gstin, state_code) values ('Local Supplier','27AAPFU0939F1ZV','27') returning id`);
    const supInter = await q(`insert into suppliers (name, gstin, state_code) values ('Gujarat Supplier','24AAACS1234A1Z8','24') returning id`);
    const dept = await q(`insert into departments (name, hsn_code, gst_rate) values ('Apparel','6205',5) returning id`);
    await c.query(`insert into barcode_settings (id, prefix, digits, start_number) values (1,'T',6,1)`);
    await c.query(`insert into grn_number_settings (id, prefix, digits) values (1,'GRN',4)`);
    return { userId: user.id as number, locationId: loc.id as number, supIntra: supIntra.id as number, supInter: supInter.id as number, deptId: dept.id as number };
  } finally {
    await c.end();
  }
}
