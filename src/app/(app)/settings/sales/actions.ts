"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { schema } from "@/db";
import type { ActionResult } from "@/lib/action-result";
import { audit, db, runAction } from "@/lib/server-action";
import { salesSettingsSchema } from "@/lib/validation/sales";

/** Admin-only (settings.manage) — this is also what makes "Allow price edit" Admin-only. */
export async function saveSalesSettings(raw: unknown): Promise<ActionResult> {
  return runAction("settings.manage", salesSettingsSchema, raw, async (input, user) => {
    await db.transaction(async (tx) => {
      const [old] = await tx.select().from(schema.salesSettings).where(eq(schema.salesSettings.id, 1)).for("update");
      await tx
        .insert(schema.salesSettings)
        .values({ id: 1, ...input })
        .onConflictDoUpdate({ target: schema.salesSettings.id, set: input });
      await audit(tx, { userId: user.id, table: "sales_settings", recordId: 1, action: old ? "UPDATE" : "CREATE", oldValue: old, newValue: input });
    });
    revalidatePath("/settings/sales");
    revalidatePath("/sales", "layout");
    revalidatePath("/sales-returns", "layout");
    return { ok: true, message: "Sales & Payments settings saved" };
  });
}
