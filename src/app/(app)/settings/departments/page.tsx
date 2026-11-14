import type { Metadata } from "next";
import { asc } from "drizzle-orm";
import { db, schema } from "@/db";
import { DepartmentsClient } from "./departments-client";

export const metadata: Metadata = { title: "Departments" };

/** "5.00" -> "5", "0.25" -> "0.25" */
const rateStr = (v: string | null) => (v == null ? "" : String(Number(v)));

export default async function DepartmentsPage() {
  const rows = await db.select().from(schema.departments).orderBy(asc(schema.departments.name));
  return (
    <DepartmentsClient
      rows={rows.map((r) => ({
        id: r.id,
        name: r.name,
        hsnCode: r.hsnCode,
        gstRate: rateStr(r.gstRate),
        slabEnabled: r.slabEnabled,
        slabThreshold: r.slabThreshold ?? "",
        slabRateAbove: rateStr(r.slabRateAbove),
        isActive: r.isActive,
      }))}
    />
  );
}
