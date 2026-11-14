"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { schema } from "@/db";
import type { ActionResult } from "@/lib/action-result";
import { ActionError, audit, db, runAction } from "@/lib/server-action";
import { supplierSchema } from "@/lib/validation/masters";

export async function saveSupplier(raw: unknown): Promise<ActionResult<{ id: number }>> {
  return runAction("settings.manage", supplierSchema, raw, async ({ id, ...input }, user) => {
    const savedId = await db.transaction(async (tx) => {
      if (id) {
        const [old] = await tx.select().from(schema.suppliers).where(eq(schema.suppliers.id, id)).for("update");
        if (!old) throw new ActionError("This supplier no longer exists");
        await tx.update(schema.suppliers).set(input).where(eq(schema.suppliers.id, id));
        await audit(tx, { userId: user.id, table: "suppliers", recordId: id, action: "UPDATE", oldValue: old, newValue: input });
        return id;
      }
      const [row] = await tx
        .insert(schema.suppliers)
        .values({ ...input, createdBy: user.id })
        .returning({ id: schema.suppliers.id });
      await audit(tx, { userId: user.id, table: "suppliers", recordId: row.id, action: "CREATE", newValue: input });
      return row.id;
    });
    revalidatePath("/settings/suppliers");
    return { ok: true, data: { id: savedId }, message: id ? "Supplier updated" : "Supplier added" };
  });
}
