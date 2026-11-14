"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { schema } from "@/db";
import type { ActionResult } from "@/lib/action-result";
import { ActionError, audit, db, runAction } from "@/lib/server-action";
import { categoryConfigSchema, categoryValueSchema } from "@/lib/validation/masters";

export async function saveCategoryConfig(raw: unknown): Promise<ActionResult> {
  return runAction("settings.manage", categoryConfigSchema, raw, async ({ slots }, user) => {
    await db.transaction(async (tx) => {
      const old = await tx.select().from(schema.categoryConfig);
      for (const s of slots) {
        await tx
          .insert(schema.categoryConfig)
          .values(s)
          .onConflictDoUpdate({ target: schema.categoryConfig.slot, set: { label: s.label, mode: s.mode } });
      }
      await audit(tx, { userId: user.id, table: "category_config", recordId: "1-4", action: "UPDATE", oldValue: old, newValue: slots });
    });
    revalidatePath("/settings/categories");
    return { ok: true, message: "Category settings saved" };
  });
}

/**
 * Adds a value to a category. Also used from the GRN screen (inline add),
 * hence the narrower `category.addValue` permission.
 */
export async function addCategoryValue(raw: unknown): Promise<ActionResult<{ id: number; value: string }>> {
  return runAction("category.addValue", categoryValueSchema, raw, async ({ slot, value }, user) => {
    const row = await db.transaction(async (tx) => {
      const [cfg] = await tx.select().from(schema.categoryConfig).where(eq(schema.categoryConfig.slot, slot));
      if (!cfg) throw new ActionError("Category not configured");
      const [{ next }] = await tx
        .select({ next: sql<number>`coalesce(max(${schema.categoryValues.sortOrder}), -1)::int + 1` })
        .from(schema.categoryValues)
        .where(eq(schema.categoryValues.slot, slot));
      const [inserted] = await tx
        .insert(schema.categoryValues)
        .values({ slot, value, sortOrder: next, createdBy: user.id })
        .returning({ id: schema.categoryValues.id, value: schema.categoryValues.value });
      await audit(tx, { userId: user.id, table: "category_values", recordId: inserted.id, action: "CREATE", newValue: { slot, value } });
      return inserted;
    });
    revalidatePath("/settings/categories");
    return { ok: true, data: row, message: `Added "${row.value}"` };
  });
}

export async function updateCategoryValue(raw: unknown): Promise<ActionResult> {
  return runAction("settings.manage", categoryValueSchema, raw, async ({ id, slot, value, isActive }, user) => {
    if (!id) throw new ActionError("Missing value id");
    await db.transaction(async (tx) => {
      const [old] = await tx
        .select()
        .from(schema.categoryValues)
        .where(and(eq(schema.categoryValues.id, id), eq(schema.categoryValues.slot, slot)))
        .for("update");
      if (!old) throw new ActionError("This value no longer exists");
      await tx.update(schema.categoryValues).set({ value, isActive }).where(eq(schema.categoryValues.id, id));
      await audit(tx, { userId: user.id, table: "category_values", recordId: id, action: "UPDATE", oldValue: old, newValue: { value, isActive } });
    });
    revalidatePath("/settings/categories");
    return { ok: true };
  });
}
