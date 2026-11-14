import "server-only";
import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { toPaise } from "@/lib/money";
import { modeLabel } from "@/lib/sales/posting";

/** Everything the invoice print / bill view needs. */
export async function loadBill(id: number) {
  const [h] = await db.select().from(schema.salesHeader).where(eq(schema.salesHeader.id, id));
  if (!h) return null;
  const [lines, [company], [location], receipts, [createdBy], [s]] = await Promise.all([
    db.select().from(schema.salesLines).where(eq(schema.salesLines.salesId, id)).orderBy(asc(schema.salesLines.lineNo)),
    db.select().from(schema.companyProfile).where(eq(schema.companyProfile.id, 1)),
    db.select().from(schema.locations).where(eq(schema.locations.id, h.locationId)),
    db.select().from(schema.receipts).where(eq(schema.receipts.salesId, id)),
    db.select({ name: schema.users.name }).from(schema.users).where(eq(schema.users.id, h.createdBy)),
    db.select().from(schema.salesSettings).where(eq(schema.salesSettings.id, 1)),
  ]);
  const settings = s ?? { bank1Name: "Bank 1", bank2Name: "Bank 2", printFormat: "A4" as const };
  const receipt = receipts.find((r) => r.source === "SALE") ?? null;
  const modes = receipt ? await db.select().from(schema.receiptModes).where(eq(schema.receiptModes.receiptId, receipt.id)) : [];

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

  const payments = modes
    .map((m) => ({ mode: m.mode, label: modeLabel(m.mode, settings), amount: toPaise(m.amount) }))
    .sort((a, b) => ["CASH", "BANK1", "BANK2"].indexOf(a.mode) - ["CASH", "BANK1", "BANK2"].indexOf(b.mode));

  return {
    h,
    lines,
    company: company ?? null,
    location: location ?? null,
    receipt,
    payments,
    breakup,
    createdBy: createdBy?.name ?? "—",
    printFormat: settings.printFormat,
    received: receipt ? toPaise(receipt.totalAmount) : 0,
  };
}
export type LoadedBill = NonNullable<Awaited<ReturnType<typeof loadBill>>>;
