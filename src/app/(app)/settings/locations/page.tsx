import type { Metadata } from "next";
import { asc } from "drizzle-orm";
import { db, schema } from "@/db";
import { LocationsClient } from "./locations-client";

export const metadata: Metadata = { title: "Locations" };

export default async function LocationsPage() {
  const rows = await db.select().from(schema.locations).orderBy(asc(schema.locations.name));
  return (
    <LocationsClient
      rows={rows.map((r) => ({
        id: r.id,
        name: r.name,
        type: r.type,
        gstin: r.gstin ?? "",
        stateCode: r.stateCode,
        address: r.address ?? "",
        isActive: r.isActive,
      }))}
    />
  );
}
