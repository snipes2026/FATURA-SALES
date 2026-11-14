"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { schema } from "@/db";
import type { ActionResult } from "@/lib/action-result";
import { ActionError, audit, db, runAction } from "@/lib/server-action";
import { transportSchema } from "@/lib/validation/masters";

export async function saveTransport(raw: unknown): Promise<ActionResult<{ id: number }>> {
  return runAction("settings.manage", transportSchema, raw, async ({ id, ...input }, user) => {
    const savedId = await db.transaction(async (tx) => {
      if (id) {
        const [old] = await tx.select().from(schema.transports).where(eq(schema.transports.id, id)).for("update");
        if (!old) throw new ActionError("This transporter no longer exists");
        await tx.update(schema.transports).set(input).where(eq(schema.transports.id, id));
        await audit(tx, { userId: user.id, table: "transports", recordId: id, action: "UPDATE", oldValue: old, newValue: input });
        return id;
      }
      const [row] = await tx.insert(schema.transports).values(input).returning({ id: schema.transports.id });
      await audit(tx, { userId: user.id, table: "transports", recordId: row.id, action: "CREATE", newValue: input });
      return row.id;
    });
    revalidatePath("/settings/transport");
    return { ok: true, data: { id: savedId }, message: id ? "Transporter updated" : "Transporter added" };
  });
}
