import type { Metadata } from "next";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { COUNTER } from "@/lib/counters";
import { financialYear } from "@/lib/dates";
import { GrnNumberingForm } from "./grn-numbering-form";

export const metadata: Metadata = { title: "GRN Numbering" };

export default async function GrnNumberingPage() {
  const fy = financialYear();
  const [[settings], [counter]] = await Promise.all([
    db.select().from(schema.grnNumberSettings).where(eq(schema.grnNumberSettings.id, 1)),
    db
      .select()
      .from(schema.counters)
      .where(and(eq(schema.counters.name, COUNTER.GRN), eq(schema.counters.fy, fy))),
  ]);
  return (
    <GrnNumberingForm
      initial={{ prefix: settings?.prefix ?? "GRN", digits: String(settings?.digits ?? 4) }}
      fy={fy}
      lastIssued={counter?.lastValue ?? 0}
    />
  );
}
