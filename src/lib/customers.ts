import "server-only";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { schema, type DB, type Tx } from "@/db";
import { formatAmount } from "@/lib/india";
import { toPaise } from "@/lib/money";
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
  advanceAvailable: number; // unused advance (opening Cr + advances kept − advances used)
};

/**
 * Bill-wise position of a customer. Pending per bill = net − receipts allocated
 * to it − advance adjusted against it (reversed rows ignored). Invariant:
 * Σ dues − advance = ledger balance.
 */
export async function customerAccount(conn: DB | Tx, id: number): Promise<CustomerAccount> {
  const [c] = await conn.select().from(schema.customers).where(eq(schema.customers.id, id));
  if (!c) return { balancePaise: 0, dues: [], advanceAvailable: 0 };

  const { rows: allocRows } = await conn.execute<{ target_type: string; amount: string }>(sql`
    select ra.target_type, coalesce(sum(ra.amount), 0)::numeric(14,2) as amount
    from ${schema.receiptAllocations} ra
    join ${schema.receipts} r on r.id = ra.receipt_id
    where r.customer_id = ${id} and ra.reversed_at is null and ra.target_type in ('OPENING', 'ADVANCE')
    group by ra.target_type`);
  const alloc = (t: string) => toPaise(allocRows.find((r) => r.target_type === t)?.amount ?? "0");

  const { rows: billRows } = await conn.execute<{ id: number; bill_no: string; bill_date: string; pending: string }>(sql`
    select h.id, h.bill_no, h.bill_date::text as bill_date,
      (h.net_amount
        - coalesce((select sum(ra.amount) from ${schema.receiptAllocations} ra where ra.sales_id = h.id and ra.target_type = 'BILL' and ra.reversed_at is null), 0)
        - coalesce((select sum(a.amount) from ${schema.advanceAdjustments} a where a.sales_id = h.id and a.reversed_at is null), 0)
      )::numeric(14,2) as pending
    from ${schema.salesHeader} h
    where h.customer_id = ${id} and h.status = 'SAVED'`);

  const [adj] = await conn
    .select({ amount: sql<string>`coalesce(sum(${schema.advanceAdjustments.amount}), 0)::numeric(14,2)` })
    .from(schema.advanceAdjustments)
    .where(and(eq(schema.advanceAdjustments.customerId, id), sql`${schema.advanceAdjustments.reversedAt} is null`));

  const opening = toPaise(c.openingBalance);
  const dues: Due[] = [];
  if (c.openingType === "DR" && opening - alloc("OPENING") > 0)
    dues.push({ key: "OPENING", kind: "OPENING", ref: "Opening balance", date: c.openingDate, pending: opening - alloc("OPENING") });
  for (const b of billRows) {
    const pending = toPaise(b.pending);
    if (pending > 0) dues.push({ key: `BILL:${b.id}`, kind: "BILL", salesId: b.id, ref: b.bill_no, date: b.bill_date, pending });
  }
  dues.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.salesId ?? 0) - (b.salesId ?? 0)));

  const advanceAvailable = (c.openingType === "CR" ? opening : 0) + alloc("ADVANCE") - toPaise(adj.amount);
  return { balancePaise: await customerBalance(conn, id), dues, advanceAvailable: Math.max(0, advanceAvailable) };
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
  await writeOpening(tx, customerId, v, userId);
}
