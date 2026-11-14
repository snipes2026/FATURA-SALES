import type { Metadata } from "next";
import { and, asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { BARCODE_FY, COUNTER } from "@/lib/counters";
import { LABEL_FIELDS } from "@/lib/validation/masters";
import { BarcodeForm } from "./barcode-form";

export const metadata: Metadata = { title: "Barcode Settings" };

export default async function BarcodePage() {
  const [[settings], [counter], cats, [company]] = await Promise.all([
    db.select().from(schema.barcodeSettings).where(eq(schema.barcodeSettings.id, 1)),
    db
      .select()
      .from(schema.counters)
      .where(and(eq(schema.counters.name, COUNTER.BARCODE), eq(schema.counters.fy, BARCODE_FY))),
    db.select().from(schema.categoryConfig).orderBy(asc(schema.categoryConfig.slot)),
    db.select({ name: schema.companyProfile.name }).from(schema.companyProfile).where(eq(schema.companyProfile.id, 1)),
  ]);

  return (
    <BarcodeForm
      initial={{
        prefix: settings?.prefix ?? "",
        suffix: settings?.suffix ?? "",
        digits: String(settings?.digits ?? 6),
        startNumber: String(settings?.startNumber ?? 1),
        labelSize: settings?.labelSize ?? "50x25",
        labelFields: ((settings?.labelFields as string[] | undefined) ?? ["itemName", "mrp", "barcodeText"]).filter((k) =>
          LABEL_FIELDS.some((f) => f.key === k),
        ),
        labelsPerRow: String(settings?.labelsPerRow ?? 1),
      }}
      lastIssued={counter?.lastValue ?? 0}
      companyName={company?.name ?? "Your Company"}
      categories={cats.map((c) => ({ key: `cat${c.slot}`, label: c.label, hidden: c.mode === "HIDDEN" }))}
    />
  );
}
