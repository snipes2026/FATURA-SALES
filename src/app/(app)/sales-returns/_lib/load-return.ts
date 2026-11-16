import "server-only";
import { asc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { toPaise } from "@/lib/money";
import { modeLabel } from "@/lib/sales/posting";

/** Everything the credit note view / print needs. */
export async function loadReturn(id: number) {
  const [h] = await db.select().from(schema.salesReturnHeader).where(eq(schema.salesReturnHeader.id, id));
  if (!h) return null;
  const [lines, [company], [location], [createdBy], [s], against] = await Promise.all([
    db.select().from(schema.salesReturnLines).where(eq(schema.salesReturnLines.returnId, id)).orderBy(asc(schema.salesReturnLines.lineNo)),
    db.select().from(schema.companyProfile).where(eq(schema.companyProfile.id, 1)),
    db.select().from(schema.locations).where(eq(schema.locations.id, h.locationId)),
    db.select({ name: schema.users.name }).from(schema.users).where(eq(schema.users.id, h.createdBy)),
    db.select().from(schema.salesSettings).where(eq(schema.salesSettings.id, 1)),
    h.againstSalesId
      ? db.select({ id: schema.salesHeader.id, billNo: schema.salesHeader.billNo, billDate: schema.salesHeader.billDate }).from(schema.salesHeader).where(eq(schema.salesHeader.id, h.againstSalesId))
      : Promise.resolve([]),
  ]);
  const settings = s ?? { bank1Name: "Bank 1", bank2Name: "Bank 2", returnPrintFormat: "A4" as const };

  // How the return was settled when it was saved (applications made in the save transaction)
  const { rows: applied } = await db.execute<{ target_type: "BILL" | "OPENING"; sales_id: number | null; bill_no: string | null; bill_date: string | null; amount: string }>(sql`
    select ca.target_type, ca.sales_id, h.bill_no, h.bill_date::text as bill_date, sum(ca.amount)::numeric(14,2) as amount
    from ${schema.creditApplications} ca
    join ${schema.customerCredits} cc on cc.id = ca.credit_id
    left join ${schema.salesHeader} h on h.id = ca.sales_id
    where cc.source_type = 'SALES_RETURN' and cc.source_id = ${id} and ca.target_type in ('BILL', 'OPENING')
      and ca.created_at = (select created_at from ${schema.salesReturnHeader} where id = ${id})
    group by ca.target_type, ca.sales_id, h.bill_no, h.bill_date
    order by h.bill_date nulls first, ca.sales_id`);

  // Rate-wise GST breakup from the stored line figures
  const map = new Map<string, { hsn: string; rate: number; taxable: number; cgst: number; sgst: number; igst: number; gst: number }>();
  for (const l of lines) {
    const k = `${l.hsnCode}|${Number(l.gstRate)}`;
    const r = map.get(k) ?? { hsn: l.hsnCode, rate: Number(l.gstRate), taxable: 0, cgst: 0, sgst: 0, igst: 0, gst: 0 };
    r.taxable += toPaise(l.taxable);
    r.cgst += toPaise(l.cgst);
    r.sgst += toPaise(l.sgst);
    r.igst += toPaise(l.igst);
    r.gst += toPaise(l.gstAmount);
    map.set(k, r);
  }
  const breakup = [...map.values()].sort((a, b) => a.rate - b.rate || a.hsn.localeCompare(b.hsn));

  return {
    h,
    lines,
    company: company ?? null,
    location: location ?? null,
    against: against[0] ?? null,
    applied: applied.map((a) => ({ ref: a.target_type === "OPENING" ? "Opening balance" : (a.bill_no ?? "—"), salesId: a.sales_id, date: a.bill_date, amount: toPaise(a.amount) })),
    refundLabel: h.refundMode ? modeLabel(h.refundMode, settings) : null,
    breakup,
    createdBy: createdBy?.name ?? "—",
    printFormat: settings.returnPrintFormat,
  };
}
export type LoadedReturn = NonNullable<Awaited<ReturnType<typeof loadReturn>>>;
