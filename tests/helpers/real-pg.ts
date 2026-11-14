/**
 * A throwaway REAL PostgreSQL server for tests that need true concurrency
 * (PGlite runs one query at a time, so row locks / advisory locks are never
 * contended there).
 *
 * Order of preference:
 *  1. TEST_DATABASE_URL — an existing server; a fresh database is created and dropped.
 *  2. Local PostgreSQL binaries (PG_BIN, PATH, or C:\Program Files\PostgreSQL\<ver>\bin):
 *     initdb a temp cluster (trust auth, 127.0.0.1 only, random port), start it, delete it after.
 *  3. Neither → null (the caller skips).
 * The user's own PostgreSQL service is never touched.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import pg from "pg";

const exe = (name: string) => (process.platform === "win32" ? `${name}.exe` : name);

function findPgBin(): string | null {
  const candidates: string[] = [];
  if (process.env.PG_BIN) candidates.push(process.env.PG_BIN);
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) candidates.push(dir);
  for (const root of ["C:\\Program Files\\PostgreSQL", "/usr/lib/postgresql"]) {
    if (!existsSync(root)) continue;
    for (const v of readdirSync(root).sort().reverse()) candidates.push(path.join(root, v, "bin"));
  }
  return candidates.find((d) => d && existsSync(path.join(d, exe("initdb"))) && existsSync(path.join(d, exe("pg_ctl")))) ?? null;
}

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => resolve(port));
    });
  });
}

export type RealPg = { url: string; source: string; stop: () => Promise<void> };

export async function startRealPg(): Promise<RealPg | null> {
  const dbName = `fd_test_${process.pid}_${Date.now()}`;

  if (process.env.TEST_DATABASE_URL) {
    const admin = new pg.Client(process.env.TEST_DATABASE_URL);
    await admin.connect();
    await admin.query(`create database ${dbName}`);
    await admin.end();
    const u = new URL(process.env.TEST_DATABASE_URL);
    u.pathname = `/${dbName}`;
    return {
      url: u.toString(),
      source: "TEST_DATABASE_URL",
      async stop() {
        const a = new pg.Client(process.env.TEST_DATABASE_URL);
        await a.connect();
        await a.query(`drop database if exists ${dbName} with (force)`);
        await a.end();
      },
    };
  }

  const bin = findPgBin();
  if (!bin) return null;
  const dir = mkdtempSync(path.join(tmpdir(), "fd-pg-"));
  const data = path.join(dir, "data");
  const port = await freePort();
  execFileSync(path.join(bin, exe("initdb")), ["-D", data, "-U", "postgres", "-A", "trust", "-E", "UTF8", "--no-locale"], { stdio: "ignore" });
  const start = spawnSync(
    path.join(bin, exe("pg_ctl")),
    ["-D", data, "-l", path.join(dir, "log.txt"), "-w", "-t", "60", "-o", `-p ${port} -h 127.0.0.1 -c max_connections=50 -c fsync=off`, "start"],
    { stdio: "ignore" },
  );
  if (start.status !== 0) {
    rmSync(dir, { recursive: true, force: true });
    throw new Error(`Could not start a temporary PostgreSQL from ${bin} (see ${path.join(dir, "log.txt")})`);
  }
  const base = `postgres://postgres@127.0.0.1:${port}`;
  const admin = new pg.Client(`${base}/postgres`);
  await admin.connect();
  await admin.query(`create database ${dbName}`);
  await admin.end();
  return {
    url: `${base}/${dbName}`,
    source: `temporary server from ${bin}`,
    async stop() {
      spawnSync(path.join(bin, exe("pg_ctl")), ["-D", data, "-m", "immediate", "-w", "stop"], { stdio: "ignore" });
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
