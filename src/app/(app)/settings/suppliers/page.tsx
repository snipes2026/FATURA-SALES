import type { Metadata } from "next";
import { asc, count } from "drizzle-orm";
import { db, schema } from "@/db";
import { SuppliersClient, type SupplierRow } from "./suppliers-client";

export const metadata: Metadata = { title: "Suppliers" };

export default async function SuppliersPage() {
  const [rows, usage] = await Promise.all([
    db.select().from(schema.suppliers).orderBy(asc(schema.suppliers.name)),
    db.select({ supplierId: schema.grnHeader.supplierId, n: count() }).from(schema.grnHeader).groupBy(schema.grnHeader.supplierId),
  ]);
  const used = new Map(usage.map((u) => [u.supplierId, u.n]));
  const data: SupplierRow[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    gstin: r.gstin ?? "",
    stateCode: r.stateCode,
    address: r.address ?? "",
    contactPerson: r.contactPerson ?? "",
    phone: r.phone ?? "",
    email: r.email ?? "",
    pan: r.pan ?? "",
    openingBalance: r.openingBalance,
    isActive: r.isActive,
    grnCount: used.get(r.id) ?? 0,
  }));
  return <SuppliersClient rows={data} />;
}
