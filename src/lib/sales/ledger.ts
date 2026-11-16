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
  SALES_RETURN: "Sales Return",
  SALES_RETURN_CANCEL: "Sales Return Cancel",
  REFUND_CANCEL: "Refund Cancel",
};

export type VoucherDoc = "sale" | "receipt" | "return";

/** Where a voucher number links to (bill, receipt or credit note print). */
export function voucherHref(doc: VoucherDoc | null, id: number): string | null {
  if (doc === "sale") return `/print/sales/${id}`;
  if (doc === "receipt") return `/print/receipts/${id}`;
  if (doc === "return") return `/print/sales-returns/${id}`;
  return null;
}

/**
 * Which document a ledger row belongs to. Settlement and Refund rows are written
 * by several documents (bill, receipt, credit note), so the voucher no. decides.
 */
const voucherDocSql = sql`
  case
    when l.voucher_type in ('SALE', 'SALE_CANCEL') then 'sale'
    when l.voucher_type in ('RECEIPT', 'ADVANCE', 'RECEIPT_CANCEL') then 'receipt'
    when l.voucher_type in ('SALES_RETURN', 'SALES_RETURN_CANCEL', 'REFUND_CANCEL') then 'return'
    when exists (select 1 from ${schema.salesReturnHeader} x where x.id = l.voucher_id and x.return_no = l.voucher_no) then 'return'
    when exists (select 1 from ${schema.salesHeader} x where x.id = l.voucher_id and x.bill_no = l.voucher_no) then 'sale'
    when exists (select 1 from ${schema.receipts} x where x.id = l.voucher_id and x.receipt_no = l.voucher_no) then 'receipt'
  end`;

export type LedgerRow = {
  id: number;
  date: string;
  type: string;
  voucherId: number;
  voucherNo: string | null;
  /** The document the voucher no. opens (null: no link, e.g. opening balance). */
  doc: VoucherDoc | null;
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
    doc: VoucherDoc | null;
    particulars: string | null;
    debit: string;
    credit: string;
    run: string;
  }>(sql`
    select l.id, l.entry_date::text as entry_date, l.voucher_type, l.voucher_id, l.voucher_no, ${voucherDocSql} as doc, l.particulars, l.debit, l.credit,
      sum(l.debit - l.credit) over (order by l.entry_date, l.id rows between unbounded preceding and current row)::numeric(14,2) as run
    from ${schema.customerLedger} l
    where l.customer_id = ${customerId} and l.entry_date between ${from}::date and ${to}::date
    order by l.entry_date, l.id`);

  const entries: LedgerRow[] = rows.map((r) => ({
    id: Number(r.id),
    date: r.entry_date,
    type: r.voucher_type,
    voucherId: r.voucher_id,
    voucherNo: r.voucher_no,
    doc: r.doc,
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
  /** Receipts allocated (cash / bank). */
  received: number;
  /** Credit adjusted: advances and sales-return credit. */
  adjusted: number;
  pending: number;
  ageDays: number;
};

/**
 * Bill-wise pending list (opening balance + unpaid bills), oldest first.
 * Pending = amount − receipts allocated − credit adjusted (advances, sales
 * returns); reversed rows ignored.
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
    adjusted: string;
    age: number;
  }>(sql`
    with opening as (
      select c.id as customer_id, c.name as customer_name, c.phone, null::int as sales_id, 'Opening balance' as ref, c.opening_date as d,
        c.opening_balance as amount,
        coalesce((select sum(ra.amount) from ${schema.receiptAllocations} ra join ${schema.receipts} r on r.id = ra.receipt_id
                  where r.customer_id = c.id and ra.target_type = 'OPENING' and ra.reversed_at is null), 0) as received,
        coalesce((select sum(a.amount) from ${schema.creditApplications} a
                  where a.customer_id = c.id and a.target_type = 'OPENING' and a.reversed_at is null), 0) as adjusted
      from ${schema.customers} c
      where c.opening_type = 'DR' and c.opening_balance > 0 ${cust}
    ), bills as (
      select c.id, c.name, c.phone, h.id, h.bill_no, h.bill_date, h.net_amount,
        coalesce((select sum(ra.amount) from ${schema.receiptAllocations} ra where ra.sales_id = h.id and ra.target_type = 'BILL' and ra.reversed_at is null), 0),
        coalesce((select sum(a.amount) from ${schema.creditApplications} a where a.sales_id = h.id and a.target_type = 'BILL' and a.reversed_at is null), 0)
      from ${schema.salesHeader} h join ${schema.customers} c on c.id = h.customer_id
      where h.status = 'SAVED' ${cust}
    )
    select customer_id, customer_name, phone, sales_id, ref, d::text as d, amount::numeric(14,2) as amount,
      received::numeric(14,2) as received, adjusted::numeric(14,2) as adjusted,
      (${opts.asOf}::date - d)::int as age
    from (select * from opening union all select * from bills) x
    where amount - received - adjusted > 0
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
    adjusted: toPaise(r.adjusted),
    pending: toPaise(r.amount) - toPaise(r.received) - toPaise(r.adjusted),
    ageDays: Number(r.age),
  }));
}
