import "server-only";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { financialYear, todayIST } from "@/lib/dates";

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Start of the current financial year (1 April). */
export function fyStart(today = todayIST()) {
  return `20${financialYear(today).slice(0, 2)}-04-01`;
}

/** customer / from / to from the URL, with defaults (this financial year to today). */
export async function readLedgerParams(sp: { customer?: string; from?: string; to?: string }) {
  const today = todayIST();
  const from = sp.from && ISO.test(sp.from) ? sp.from : fyStart(today);
  const to = sp.to && ISO.test(sp.to) ? sp.to : today;
  const id = Number(sp.customer);
  const customer = Number.isInteger(id) && id > 0 ? ((await db.select().from(schema.customers).where(eq(schema.customers.id, id)))[0] ?? null) : null;
  return { customer, from, to: to < from ? from : to, today };
}
