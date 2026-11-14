"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { schema } from "@/db";
import type { ActionResult } from "@/lib/action-result";
import { audit, db, runAction } from "@/lib/server-action";
import { barcodeSettingsSchema } from "@/lib/validation/masters";

export async function saveBarcodeSettings(raw: unknown): Promise<ActionResult> {
  return runAction("settings.manage", barcodeSettingsSchema, raw, async (input, user) => {
    await db.transaction(async (tx) => {
      const [old] = await tx.select().from(schema.barcodeSettings).where(eq(schema.barcodeSettings.id, 1)).for("update");
      await tx
        .insert(schema.barcodeSettings)
        .values({ id: 1, ...input })
        .onConflictDoUpdate({ target: schema.barcodeSettings.id, set: input });
      await audit(tx, { userId: user.id, table: "barcode_settings", recordId: 1, action: old ? "UPDATE" : "CREATE", oldValue: old, newValue: input });
    });
    revalidatePath("/settings/barcode");
    return { ok: true, message: "Barcode settings saved" };
  });
}
