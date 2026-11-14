/**
 * Applies pending SQL migrations from ./drizzle.
 * Usage: npm run db:migrate   (reads DATABASE_URL)
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    console.log("Running migrations…");
    await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
    console.log("Migrations complete.");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
