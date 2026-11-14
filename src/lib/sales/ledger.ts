import "server-only";
import { sql } from "drizzle-orm";
import { schema, type DB, type Tx } from "@/db";
import { toPaise } from "@/lib/money";

export const VOUCHER_LABEL: Record<string, string> = {
  OPENING: "Opening",
  SALE: "Sale",
  RECEIPT: "Receipt",
  ADVANCE: "Advance",
  SETTLEMENT: "Settlement",
  SALE_CANCEL: "Sale Cancel",
  RECEIPT_CANCEL: "Receipt Cancel",
  REFUND: "Refund",
};

/** Where a voucher number links to (bill or receipt print/view). */
export function voucherHref(type: string, id: number): string | null {
  if (type === "SALE" || type === "SETTLEMENT" || type === "SALE_CANCEL") return `/print/sales/${id}`;
  if (type === "RECEIPT" || type === "ADVANCE" || type === "RECEIPT_CANCEL" || type === "REFUND") return `/print/receipts/${id}`;
  return null;
}

export type LedgerRow = {
  id: number;
  date: string;
  type: string;
  voucherId: number;
  voucherNo: string | null;
  particulars: string;
  debit: number;
  credit: number;
  balance: number; // running, signed: + Dr / − Cr
};

/**
 * Customer ledger for a date range: opening balance as of `from` (everything
 * before it), every entry in the range with a running balance (window function,
 * never stored), and the closing balance.
 */
export async function customerLedger(conn: DB | Tx, customerId: number, from: string, to: string) {
  const { rows: op } = await conn.execute<{ b: string }>(sql`
    select coalesce(sum(debit - credit), 0)::numeric(14,2) as b
    from ${schema.customerLedger} where customer_id = ${customerId} and entry_date < ${from}::date`);
  const opening = toPaise(op[0]?.b ?? "0");

  const { rows } = await conn.execute<{
    id: number;
    entry_date: string;
    voucher_type: string;
    voucher_id: number;
    voucher_no: string | null;
    particulars: string | null;
    debit: string;
    credit: string;
    run: string;
  }>(sql`
    select id, entry_date::text as entry_date, voucher_type, voucher_id, voucher_no, particulars, debit, credit,
      sum(debit - credit) over (order by entry_date, id rows between unbounded preceding and current row)::numeric(14,2) as run
    from ${schema.customerLedger}
    where customer_id = ${customerId} and entry_date between ${from}::date and ${to}::date
    order by entry_date, id`);

  const entries: LedgerRow[] = rows.map((r) => ({
    id: Number(r.id),
    date: r.entry_date,
    type: r.voucher_type,
    voucherId: r.voucher_id,
    voucherNo: r.voucher_no,
    particulars: r.particulars ?? "",
    debit: toPaise(r.debit),
    credit: toPaise(r.credit),
    balance: opening + toPaise(r.run),
  }));
  const totalDebit = entries.reduce((a, e) => a + e.debit, 0);
  const totalCredit = entries.reduce((a, e) => a + e.credit, 0);
  return { opening, entries, totalDebit, totalCredit, closing: opening + totalDebit - totalCredit };
}
export type CustomerLedger = Awaited<ReturnType<typeof customerLedger>>;

export type OutstandingRow = {
  customerId: number;
  customerName: string;
  phone: string;
  key: string;
  salesId: number | null;
  ref: string;
  date: string;
  amount: number;
  received: number;
  pending: number;
  ageDays: number;
};

/**
 * Bill-wise pending list (opening balance + unpaid bills), oldest first.
 * Received = receipts allocated + advance adjusted (reversed rows ignored).
 */
export async function outstandingBills(conn: DB | Tx, opts: { customerId?: number; asOf: string }): Promise<OutstandingRow[]> {
  const cust = opts.customerId ? sql`and c.id = ${opts.customerId}` : sql``;
  const { rows } = await conn.execute<{
    customer_id: number;
    customer_name: string;
    phone: string;
    sales_id: number | null;
    ref: string;
    d: string;
    amount: string;
    received: string;
    age: number;
  }>(sql`
    with opening as (
      select c.id as customer_id, c.name as customer_name, c.phone, null::int as sales_id, 'Opening balance' as ref, c.opening_date as d,
        c.opening_balance as amount,
        coalesce((select sum(ra.amount) from ${schema.receiptAllocations} ra join ${schema.receipts} r on r.id = ra.receipt_id
                  where r.customer_id = c.id and ra.target_type = 'OPENING' and ra.reversed_at is null), 0) as received
      from ${schema.customers} c
      where c.opening_type = 'DR' and c.opening_balance > 0 ${cust}
    ), bills as (
      select c.id, c.name, c.phone, h.id, h.bill_no, h.bill_date, h.net_amount,
        coalesce((select sum(ra.amount) from ${schema.receiptAllocations} ra where ra.sales_id = h.id and ra.target_type = 'BILL' and ra.reversed_at is null), 0)
        + coalesce((select sum(a.amount) from ${schema.advanceAdjustments} a where a.sales_id = h.id and a.reversed_at is null), 0)
      from ${schema.salesHeader} h join ${schema.customers} c on c.id = h.customer_id
      where h.status = 'SAVED' ${cust}
    )
    select customer_id, customer_name, phone, sales_id, ref, d::text as d, amount::numeric(14,2) as amount, received::numeric(14,2) as received,
      (${opts.asOf}::date - d)::int as age
    from (select * from opening union all select * from bills) x
    where amount - received > 0
    order by customer_name, customer_id, d, sales_id nulls first`);

  return rows.map((r) => ({
    customerId: r.customer_id,
    customerName: r.customer_name,
    phone: r.phone,
    key: r.sales_id ? `BILL:${r.sales_id}` : "OPENING",
    salesId: r.sales_id,
    ref: r.ref,
    date: r.d,
    amount: toPaise(r.amount),
    received: toPaise(r.received),
    pending: toPaise(r.amount) - toPaise(r.received),
    ageDays: Number(r.age),
  }));
}
