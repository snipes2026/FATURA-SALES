import type { Metadata } from "next";
import { asc } from "drizzle-orm";
import { db, schema } from "@/db";
import { TransportClient } from "./transport-client";

export const metadata: Metadata = { title: "Transport" };

export default async function TransportPage() {
  const rows = await db.select().from(schema.transports).orderBy(asc(schema.transports.name));
  return <TransportClient rows={rows.map((r) => ({ id: r.id, name: r.name, gstin: r.gstin ?? "", phone: r.phone ?? "", isActive: r.isActive }))} />;
}
