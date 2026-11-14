import type { Metadata } from "next";
import { asc } from "drizzle-orm";
import { db, schema } from "@/db";
import { CategoriesClient, type SlotData } from "./categories-client";

export const metadata: Metadata = { title: "Categories" };

export default async function CategoriesPage() {
  const [config, values] = await Promise.all([
    db.select().from(schema.categoryConfig).orderBy(asc(schema.categoryConfig.slot)),
    db.select().from(schema.categoryValues).orderBy(asc(schema.categoryValues.sortOrder), asc(schema.categoryValues.id)),
  ]);
  const slots: SlotData[] = [1, 2, 3, 4].map((slot) => {
    const c = config.find((x) => x.slot === slot);
    return {
      slot,
      label: c?.label ?? `Category ${slot}`,
      mode: c?.mode ?? "HIDDEN",
      values: values.filter((v) => v.slot === slot).map((v) => ({ id: v.id, value: v.value, isActive: v.isActive })),
    };
  });
  return <CategoriesClient slots={slots} />;
}
