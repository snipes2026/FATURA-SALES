import "server-only";
import { and, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { schema, type DB, type Tx } from "@/db";
import { customerBalances } from "@/lib/customers";

export type CustomerHit = {
  id: number;
  name: string;
  phone: string;
  gstin: string;
  stateCode: string;
  address: string;
  isWalkin: boolean;
  balancePaise: number;
};

function toHit(r: typeof schema.customers.$inferSelect, bal: Map<number, number>): CustomerHit {
  return {
    id: r.id,
    name: r.name,
    phone: r.phone,
    gstin: r.gstin ?? "",
    stateCode: r.stateCode,
    address: r.address ?? "",
    isWalkin: r.isWalkin,
    balancePaise: bal.get(r.id) ?? 0,
  };
}

/** Active customers matching a name / phone / GSTIN fragment (Walk-in first, then by name). */
export async function searchCustomers(conn: DB | Tx, q: string, limit = 20): Promise<CustomerHit[]> {
  const term = q.trim();
  const like = `%${term.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  const rows = await conn
    .select()
    .from(schema.customers)
    .where(
      and(
        eq(schema.customers.isActive, true),
        term ? or(ilike(schema.customers.name, like), ilike(schema.customers.phone, like), ilike(schema.customers.gstin, like)) : undefined,
      ),
    )
    .orderBy(desc(schema.customers.isWalkin), term ? sql`position(lower(${term}) in lower(${schema.customers.name}))` : sql`1`, asc(schema.customers.name))
    .limit(limit);
  const bal = await customerBalances(conn, rows.map((r) => r.id));
  return rows.map((r) => toHit(r, bal));
}

export async function getCustomer(conn: DB | Tx, id: number): Promise<CustomerHit | null> {
  const [r] = await conn.select().from(schema.customers).where(eq(schema.customers.id, id));
  if (!r) return null;
  return toHit(r, await customerBalances(conn, [id]));
}

export async function getWalkin(conn: DB | Tx): Promise<CustomerHit | null> {
  const [r] = await conn.select().from(schema.customers).where(eq(schema.customers.isWalkin, true));
  return r ? toHit(r, new Map()) : null;
}

export async function stockAt(conn: DB | Tx, locationId: number, productIds: number[]): Promise<Record<number, number>> {
  const out: Record<number, number> = Object.fromEntries(productIds.map((id) => [id, 0]));
  if (!productIds.length) return out;
  const rows = await conn
    .select({ productId: schema.stockLedger.productId, qty: sql<number>`sum(${schema.stockLedger.qtyIn} - ${schema.stockLedger.qtyOut})::int` })
    .from(schema.stockLedger)
    .where(and(eq(schema.stockLedger.locationId, locationId), inArray(schema.stockLedger.productId, productIds)))
    .groupBy(schema.stockLedger.productId);
  for (const r of rows) out[r.productId] = r.qty;
  return out;
}

export type ScannedProduct = {
  productId: number;
  barcode: string;
  itemName: string;
  hsn: string;
  wsp: string | null;
  mrp: string;
  purchaseRate: string;
  stock: number;
  dept: { gstRate: string; slabEnabled: boolean; slabThreshold: string | null; slabRateAbove: string | null };
};

/** Product by barcode (exact; input upper-cased) with its stock at the location. */
export async function findByBarcode(conn: DB | Tx, barcode: string, locationId: number): Promise<ScannedProduct | null> {
  const [p] = await conn
    .select({
      productId: schema.products.id,
      barcode: schema.products.barcode,
      itemName: schema.products.itemName,
      isActive: schema.products.isActive,
      hsn: schema.departments.hsnCode,
      wsp: schema.products.wsp,
      mrp: schema.products.mrp,
      purchaseRate: schema.products.purchaseRate,
      gstRate: schema.departments.gstRate,
      slabEnabled: schema.departments.slabEnabled,
      slabThreshold: schema.departments.slabThreshold,
      slabRateAbove: schema.departments.slabRateAbove,
      stock: sql<number>`coalesce((select sum(sl.qty_in - sl.qty_out) from ${schema.stockLedger} sl where sl.product_id = ${schema.products.id} and sl.location_id = ${locationId}), 0)::int`,
    })
    .from(schema.products)
    .innerJoin(schema.departments, eq(schema.departments.id, schema.products.departmentId))
    .where(eq(schema.products.barcode, barcode.trim().toUpperCase())); // barcodes are generated upper-case; uses the unique index
  if (!p || !p.isActive) return null;
  return {
    productId: p.productId,
    barcode: p.barcode,
    itemName: p.itemName,
    hsn: p.hsn,
    wsp: p.wsp,
    mrp: p.mrp,
    purchaseRate: p.purchaseRate,
    stock: p.stock,
    dept: { gstRate: p.gstRate, slabEnabled: p.slabEnabled, slabThreshold: p.slabThreshold, slabRateAbove: p.slabRateAbove },
  };
}
