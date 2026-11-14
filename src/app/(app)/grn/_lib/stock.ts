import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import { ActionError } from "@/lib/server-action";

/** stock_ledger.ref_doc_type values written by the GRN module. */
export const REF = { GRN: "GRN", GRN_EDIT: "GRN_EDIT", GRN_CANCEL: "GRN_CANCEL" } as const;
const GRN_REFS = [REF.GRN, REF.GRN_EDIT, REF.GRN_CANCEL];

/** Sales documents are checked through their lines (below), so a cancelled bill no longer blocks. */
const SALE_REFS = ["SALE", "SALE_CANCEL"];

/**
 * Has any item of this GRN moved out of its location by something other than a
 * sale (transfer, …) since the GRN was saved? Any qty_out written by a future
 * module counts — so Transfers will block GRN edit/delete automatically.
 */
export async function hasOutwardMovement(tx: Tx, grnId: number): Promise<boolean> {
  const rows = await tx.execute(sql`
    select 1
    from ${schema.stockLedger} sl
    join ${schema.grnHeader} h on h.id = ${grnId}
    where sl.location_id = h.location_id
      and sl.qty_out > 0
      and sl.ref_doc_type not in (${sql.join([...GRN_REFS, ...SALE_REFS].map((r) => sql`${r}`), sql`, `)})
      and h.saved_at is not null
      and sl.created_at >= h.saved_at
      and sl.product_id in (select product_id from ${schema.grnLines} where grn_id = ${grnId} and product_id is not null)
    limit 1`);
  return rows.rows.length > 0;
}

/** Bill numbers of saved (not cancelled) sales that include any product of this GRN. */
export async function grnSoldOn(tx: Tx, grnId: number, limit = 5): Promise<string[]> {
  const { rows } = await tx.execute<{ bill_no: string }>(sql`
    select distinct h.bill_no
    from ${schema.salesLines} sl
    join ${schema.salesHeader} h on h.id = sl.sales_id
    where h.status = 'SAVED'
      and sl.product_id in (select product_id from ${schema.grnLines} where grn_id = ${grnId} and product_id is not null)
    order by h.bill_no
    limit ${limit}`);
  return rows.map((r) => r.bill_no);
}

/**
 * Why this saved GRN can't be edited or deleted (null = it can):
 * items on sales bills, or moved out of the location by another document.
 */
export async function grnLockReason(tx: Tx, grnId: number): Promise<string | null> {
  const bills = await grnSoldOn(tx, grnId);
  if (bills.length) return `Items of this GRN have been sold (${bills.join(", ")}${bills.length === 5 ? ", …" : ""}). Cancel those bills first`;
  if (await hasOutwardMovement(tx, grnId)) return "Items of this GRN have already been transferred out of this location";
  return null;
}

/** After a GRN edit/delete: no product may end up with negative stock at the location. */
export async function assertNoNegativeStock(tx: Tx, locationId: number, productIds: number[], what: string) {
  if (!productIds.length) return;
  const { rows } = await tx.execute<{ barcode: string; qty: number }>(sql`
    select p.barcode, sum(sl.qty_in - sl.qty_out)::int as qty
    from ${schema.stockLedger} sl join ${schema.products} p on p.id = sl.product_id
    where sl.location_id = ${locationId} and sl.product_id in (${sql.join(productIds.map((id) => sql`${id}`), sql`, `)})
    group by p.barcode
    having sum(sl.qty_in - sl.qty_out) < 0
    limit 5`);
  if (rows.length)
    throw new ActionError(`${what} would make stock negative for ${rows.map((r) => `${r.barcode} (${r.qty})`).join(", ")} — those pieces have already gone out`);
}

/**
 * Posts a reversal of everything this GRN has put into stock so far (net per
 * product + location). The ledger is append-only: we never delete rows.
 */
export async function reverseGrnStock(tx: Tx, grnId: number, refType: typeof REF.GRN_EDIT | typeof REF.GRN_CANCEL, userId: number) {
  const nets = await tx
    .select({
      productId: schema.stockLedger.productId,
      locationId: schema.stockLedger.locationId,
      net: sql<number>`sum(${schema.stockLedger.qtyIn} - ${schema.stockLedger.qtyOut})::int`,
    })
    .from(schema.stockLedger)
    .where(and(eq(schema.stockLedger.refDocId, grnId), inArray(schema.stockLedger.refDocType, GRN_REFS)))
    .groupBy(schema.stockLedger.productId, schema.stockLedger.locationId);
  const rows = nets
    .filter((n) => n.net !== 0)
    .map((n) => ({
      locationId: n.locationId,
      productId: n.productId,
      qtyIn: n.net < 0 ? -n.net : 0,
      qtyOut: n.net > 0 ? n.net : 0,
      refDocType: refType,
      refDocId: grnId,
      createdBy: userId,
    }));
  if (rows.length) await tx.insert(schema.stockLedger).values(rows);
  return rows.length;
}
