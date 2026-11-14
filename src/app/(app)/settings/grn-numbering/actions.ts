"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { schema } from "@/db";
import type { ActionResult } from "@/lib/action-result";
import { audit, db, runAction } from "@/lib/server-action";
import { grnNumberSettingsSchema } from "@/lib/validation/masters";

export async function saveGrnNumberSettings(raw: unknown): Promise<ActionResult> {
  return runAction("settings.manage", grnNumberSettingsSchema, raw, async (input, user) => {
    await db.transaction(async (tx) => {
      const [old] = await tx.select().from(schema.grnNumberSettings).where(eq(schema.grnNumberSettings.id, 1)).for("update");
      await tx
        .insert(schema.grnNumberSettings)
        .values({ id: 1, ...input })
        .onConflictDoUpdate({ target: schema.grnNumberSettings.id, set: input });
      await audit(tx, { userId: user.id, table: "grn_number_settings", recordId: 1, action: old ? "UPDATE" : "CREATE", oldValue: old, newValue: input });
    });
    revalidatePath("/settings/grn-numbering");
    return { ok: true, message: "GRN numbering saved" };
  });
}
