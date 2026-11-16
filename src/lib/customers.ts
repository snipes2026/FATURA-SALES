import "server-only";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { schema, type DB, type Tx } from "@/db";
import { formatAmount } from "@/lib/india";
import { toPaise } from "@/lib/money";
import { addCredit, creditSummary } from "@/lib/sales/credits";
import type { Due } from "@/lib/sales/allocate";
import { audit } from "@/lib/server-action";
import type { customerSchema } from "@/lib/validation/sales";
import type { z } from "zod";

export type CustomerValues = Omit<z.output<typeof customerSchema>, "id">;

/** Balance in paise per customer: + Dr (to receive), − Cr (advance). Sum of the ledger — the single source of truth. */
export async function customerBalances(conn: DB | Tx, ids?: number[]): Promise<Map<number, number>> {
  const rows = await conn
    .select({
      customerId: schema.customerLedger.customerId,
      bal: sql<string>`coalesce(sum(${schema.customerLedger.debit} - ${schema.customerLedger.credit}), 0)::numeric(14,2)`,
    })
    .from(schema.customerLedger)
    .where(ids ? inArray(schema.customerLedger.customerId, ids) : undefined)
    .groupBy(schema.customerLedger.customerId);
  return new Map(rows.map((r) => [r.customerId, toPaise(r.bal)]));
}

export async function customerBalance(conn: DB | Tx, id: number): Promise<number> {
  return (await customerBalances(conn, [id])).get(id) ?? 0;
}

export type CustomerAccount = {
  balancePaise: number; // ledger balance: + Dr / − Cr
  dues: Due[]; // pending opening balance + unpaid bills, oldest first
  advanceAvailable: number; // unused credit in the pool: opening Cr + advances kept + return credit − used
  advanceFromReturns: number; // of which from sales returns
};

/**
 * Bill-wise position of a customer. Pending per bill = net − receipts allocated
 * to it − credit applied to it (reversed rows ignored). Invariant:
 * Σ dues − advance = ledger balance.
 */
export async function customerAccount(conn: DB | Tx, id: number): Promise<CustomerAccount> {
  const [c] = await conn.select().from(schema.customers).where(eq(schema.customers.id, id));
  if (!c) return { balancePaise: 0, dues: [], advanceAvailable: 0, advanceFromReturns: 0 };

  const { rows: allocRows } = await conn.execute<{ target_type: string; amount: string }>(sql`
    select ra.target_type, coalesce(sum(ra.amount), 0)::numeric(14,2) as amount
    from ${schema.receiptAllocations} ra
    join ${schema.receipts} r on r.id = ra.receipt_id
    where r.customer_id = ${id} and ra.reversed_at is null and ra.target_type = 'OPENING'
    group by ra.target_type`);
  const alloc = (t: string) => toPaise(allocRows.find((r) => r.target_type === t)?.amount ?? "0");

  const { rows: billRows } = await conn.execute<{ id: number; bill_no: string; bill_date: string; pending: string }>(sql`
    select h.id, h.bill_no, h.bill_date::text as bill_date,
      (h.net_amount
        - coalesce((select sum(ra.amount) from ${schema.receiptAllocations} ra where ra.sales_id = h.id and ra.target_type = 'BILL' and ra.reversed_at is null), 0)
        - coalesce((select sum(a.amount) from ${schema.creditApplications} a where a.sales_id = h.id and a.target_type = 'BILL' and a.reversed_at is null), 0)
      )::numeric(14,2) as pending
    from ${schema.salesHeader} h
    where h.customer_id = ${id} and h.status = 'SAVED'`);

  const [openingCredit] = await conn
    .select({ amount: sql<string>`coalesce(sum(${schema.creditApplications.amount}), 0)::numeric(14,2)` })
    .from(schema.creditApplications)
    .where(
      and(
        eq(schema.creditApplications.customerId, id),
        eq(schema.creditApplications.targetType, "OPENING"),
        sql`${schema.creditApplications.reversedAt} is null`,
      ),
    );
  const credit = await creditSummary(conn, id);

  const opening = toPaise(c.openingBalance);
  const openingPending = c.openingType === "DR" ? opening - alloc("OPENING") - toPaise(openingCredit.amount) : 0;
  const dues: Due[] = [];
  if (openingPending > 0) dues.push({ key: "OPENING", kind: "OPENING", ref: "Opening balance", date: c.openingDate, pending: openingPending });
  for (const b of billRows) {
    const pending = toPaise(b.pending);
    if (pending > 0) dues.push({ key: `BILL:${b.id}`, kind: "BILL", salesId: b.id, ref: b.bill_no, date: b.bill_date, pending });
  }
  dues.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.salesId ?? 0) - (b.salesId ?? 0)));

  return { balancePaise: await customerBalance(conn, id), dues, advanceAvailable: credit.total, advanceFromReturns: credit.fromReturns };
}

/** True once the customer has any voucher other than its opening balance. */
export async function customerIsUsed(conn: DB | Tx, id: number): Promise<boolean> {
  const [r] = await conn
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.customerLedger)
    .where(and(eq(schema.customerLedger.customerId, id), ne(schema.customerLedger.voucherType, "OPENING")));
  if (r.n > 0) return true;
  const [s] = await conn.select({ n: sql<number>`count(*)::int` }).from(schema.salesHeader).where(eq(schema.salesHeader.customerId, id));
  return s.n > 0;
}

async function writeOpening(tx: Tx, customerId: number, v: Pick<CustomerValues, "openingBalance" | "openingType" | "openingDate">, userId: number) {
  if (toPaise(v.openingBalance) <= 0) return;
  await tx.insert(schema.customerLedger).values({
    customerId,
    entryDate: v.openingDate,
    voucherType: "OPENING",
    voucherId: customerId,
    voucherNo: "OPENING",
    particulars: `Opening balance ₹${formatAmount(v.openingBalance)} ${v.openingType === "DR" ? "Dr" : "Cr"}`,
    debit: v.openingType === "DR" ? v.openingBalance : "0",
    credit: v.openingType === "CR" ? v.openingBalance : "0",
    createdBy: userId,
  });
  // An opening Cr is credit the customer holds — it goes into the credit pool
  if (v.openingType === "CR")
    await addCredit(tx, { customerId, sourceType: "OPENING_CR", sourceId: customerId, date: v.openingDate, amount: toPaise(v.openingBalance), userId });
}

export async function createCustomer(tx: Tx, v: CustomerValues, userId: number) {
  const [row] = await tx
    .insert(schema.customers)
    .values({ ...v, createdBy: userId })
    .returning();
  await writeOpening(tx, row.id, v, userId);
  await audit(tx, { userId, table: "customers", recordId: row.id, action: "CREATE", newValue: v });
  return row;
}

/** Replaces the OPENING ledger row — only allowed while the customer is unused (the ledger trigger enforces it too). */
export async function replaceOpening(tx: Tx, customerId: number, v: Pick<CustomerValues, "openingBalance" | "openingType" | "openingDate">, userId: number) {
  await tx
    .delete(schema.customerLedger)
    .where(and(eq(schema.customerLedger.customerId, customerId), eq(schema.customerLedger.voucherType, "OPENING")));
  // Unused customer → its opening credit was never applied, safe to replace
  await tx
    .delete(schema.customerCredits)
    .where(and(eq(schema.customerCredits.sourceType, "OPENING_CR"), eq(schema.customerCredits.sourceId, customerId)));
  await writeOpening(tx, customerId, v, userId);
}
