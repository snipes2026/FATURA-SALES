import type { Metadata } from "next";
import { asc, desc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { customerBalances } from "@/lib/customers";
import { todayIST } from "@/lib/dates";
import { CustomersClient, type CustomerRow } from "./customers-client";

export const metadata: Metadata = { title: "Customers" };

export default async function CustomersPage() {
  const [rows, balances, used, [company]] = await Promise.all([
    db.select().from(schema.customers).orderBy(desc(schema.customers.isWalkin), asc(schema.customers.name)),
    customerBalances(db),
    db
      .select({ customerId: schema.customerLedger.customerId, n: sql<number>`count(*)::int` })
      .from(schema.customerLedger)
      .where(sql`${schema.customerLedger.voucherType} <> 'OPENING'`)
      .groupBy(schema.customerLedger.customerId),
    db.select({ stateCode: schema.companyProfile.stateCode }).from(schema.companyProfile).where(eq(schema.companyProfile.id, 1)),
  ]);
  const usedMap = new Map(used.map((u) => [u.customerId, u.n]));
  const data: CustomerRow[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    address: r.address ?? "",
    gstin: r.gstin ?? "",
    stateCode: r.stateCode,
    phone: r.phone,
    openingBalance: r.openingBalance,
    openingType: r.openingType,
    openingDate: r.openingDate,
    isActive: r.isActive,
    isWalkin: r.isWalkin,
    balancePaise: balances.get(r.id) ?? 0,
    voucherCount: usedMap.get(r.id) ?? 0,
  }));
  return <CustomersClient rows={data} companyStateCode={company?.stateCode ?? ""} today={todayIST()} />;
}
