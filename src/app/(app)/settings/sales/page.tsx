import type { Metadata } from "next";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { COUNTER } from "@/lib/counters";
import { financialYear } from "@/lib/dates";
import { SalesSettingsForm } from "./sales-settings-form";

export const metadata: Metadata = { title: "Sales & Payments" };

export default async function SalesSettingsPage() {
  const fy = financialYear();
  const [[s], counters] = await Promise.all([
    db.select().from(schema.salesSettings).where(eq(schema.salesSettings.id, 1)),
    db
      .select()
      .from(schema.counters)
      .where(and(inArray(schema.counters.name, [COUNTER.INVOICE, COUNTER.RECEIPT]), eq(schema.counters.fy, fy))),
  ]);
  const last = (name: string) => counters.find((c) => c.name === name)?.lastValue ?? 0;
  return (
    <SalesSettingsForm
      fy={fy}
      lastInvoice={last(COUNTER.INVOICE)}
      lastReceipt={last(COUNTER.RECEIPT)}
      initial={{
        allowPriceEdit: s?.allowPriceEdit ?? false,
        bank1Name: s?.bank1Name ?? "Bank 1",
        bank2Name: s?.bank2Name ?? "Bank 2",
        bank2Enabled: s?.bank2Enabled ?? false,
        defaultGstMode: s?.defaultGstMode ?? "INCLUDES",
        allowNegativeStock: s?.allowNegativeStock ?? false,
        autoIncrementQty: s?.autoIncrementQty ?? true,
        invoicePrefix: s?.invoicePrefix ?? "INV",
        invoiceDigits: String(s?.invoiceDigits ?? 4),
        receiptPrefix: s?.receiptPrefix ?? "RCT",
        receiptDigits: String(s?.receiptDigits ?? 4),
        printFormat: s?.printFormat ?? "A4",
        walkinAllowCredit: s?.walkinAllowCredit ?? false,
        walkinAllowAdvance: s?.walkinAllowAdvance ?? false,
      }}
    />
  );
}
