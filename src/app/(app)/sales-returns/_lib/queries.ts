import "server-only";
import { sql } from "drizzle-orm";
import { schema, type DB, type Tx } from "@/db";

/** A saved sales bill the return can be made against. */
export type ReturnableBill = {
  id: number;
  billNo: string;
  billDate: string;
  net: string;
  gstMode: "ADD" | "INCLUDES";
  taxType: "INTRA" | "INTER";
  gstOverridden: boolean;
};

/**
 * The customer's saved (non-cancelled) bills, newest first. `q` filters by bill
 * number (used for the Walk-in Customer, who has too many bills to list).
 */
export async function customerBills(conn: DB | Tx, customerId: number, q = "", limit = 200): Promise<ReturnableBill[]> {
  const term = q.trim();
  const like = `%${term.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  const { rows } = await conn.execute<{
    id: number;
    bill_no: string;
    bill_date: string;
    net_amount: string;
    gst_mode: "ADD" | "INCLUDES";
    tax_type: "INTRA" | "INTER";
    gst_overridden: boolean;
  }>(sql`
    select id, bill_no, bill_date::text as bill_date, net_amount, gst_mode, tax_type, gst_overridden
    from ${schema.salesHeader}
    where customer_id = ${customerId} and status = 'SAVED' ${term ? sql`and bill_no ilike ${like}` : sql``}
    order by bill_date desc, id desc
    limit ${limit}`);
  return rows.map((r) => ({
    id: r.id,
    billNo: r.bill_no,
    billDate: r.bill_date,
    net: r.net_amount,
    gstMode: r.gst_mode,
    taxType: r.tax_type,
    gstOverridden: r.gst_overridden,
  }));
}

/** One line of the linked bill, with what was already returned against it. */
export type BillLine = {
  id: number;
  productId: number;
  barcode: string;
  itemName: string;
  hsn: string;
  gstRate: number;
  qty: number;
  rate: string;
  amount: string;
  gst: string;
  returned: number;
};

export async function billLines(conn: DB | Tx, salesId: number): Promise<BillLine[]> {
  const { rows } = await conn.execute<{
    id: number;
    product_id: number;
    barcode: string;
    item_name: string;
    hsn_code: string;
    gst_rate: string;
    qty: number;
    rate: string;
    amount: string;
    gst_amount: string;
    returned: number;
  }>(sql`
    select l.id, l.product_id, l.barcode, l.item_name, l.hsn_code, l.gst_rate, l.qty, l.rate, l.amount, l.gst_amount,
      coalesce((select sum(rl.qty) from ${schema.salesReturnLines} rl
                join ${schema.salesReturnHeader} rh on rh.id = rl.return_id
                where rl.original_sales_line_id = l.id and rh.status = 'SAVED'), 0)::int as returned
    from ${schema.salesLines} l
    where l.sales_id = ${salesId}
    order by l.line_no`);
  return rows.map((r) => ({
    id: r.id,
    productId: r.product_id,
    barcode: r.barcode,
    itemName: r.item_name,
    hsn: r.hsn_code,
    gstRate: Number(r.gst_rate),
    qty: r.qty,
    rate: r.rate,
    amount: r.amount,
    gst: r.gst_amount,
    returned: r.returned,
  }));
}

/** Per product: qty sold to the customer, qty already returned, and the last rate billed (non-cancelled only). */
export type ReturnHint = { sold: number; returned: number; lastRate: string | null };

export async function returnHints(conn: DB | Tx, customerId: number, productIds: number[]): Promise<Record<number, ReturnHint>> {
  const out: Record<number, ReturnHint> = Object.fromEntries(productIds.map((id) => [id, { sold: 0, returned: 0, lastRate: null }]));
  if (!productIds.length) return out;
  const ids = sql.join(
    productIds.map((id) => sql`${id}`),
    sql`, `,
  );
  const { rows } = await conn.execute<{ product_id: number; sold: number; returned: number; last_rate: string | null }>(sql`
    select p.id as product_id,
      coalesce((select sum(l.qty) from ${schema.salesLines} l join ${schema.salesHeader} h on h.id = l.sales_id
                where l.product_id = p.id and h.customer_id = ${customerId} and h.status = 'SAVED'), 0)::int as sold,
      coalesce((select sum(rl.qty) from ${schema.salesReturnLines} rl join ${schema.salesReturnHeader} rh on rh.id = rl.return_id
                where rl.product_id = p.id and rh.customer_id = ${customerId} and rh.status = 'SAVED'), 0)::int as returned,
      (select l.rate from ${schema.salesLines} l join ${schema.salesHeader} h on h.id = l.sales_id
        where l.product_id = p.id and h.customer_id = ${customerId} and h.status = 'SAVED'
        order by h.bill_date desc, h.id desc, l.line_no limit 1) as last_rate
    from ${schema.products} p
    where p.id in (${ids})`);
  for (const r of rows) out[r.product_id] = { sold: r.sold, returned: r.returned, lastRate: r.last_rate };
  return out;
}
