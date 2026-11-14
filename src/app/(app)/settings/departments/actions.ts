"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { schema } from "@/db";
import type { ActionResult } from "@/lib/action-result";
import { ActionError, audit, db, runAction } from "@/lib/server-action";
import { departmentSchema } from "@/lib/validation/masters";

export async function saveDepartment(raw: unknown): Promise<ActionResult<{ id: number }>> {
  return runAction("settings.manage", departmentSchema, raw, async ({ id, ...input }, user) => {
    const savedId = await db.transaction(async (tx) => {
      if (id) {
        const [old] = await tx.select().from(schema.departments).where(eq(schema.departments.id, id)).for("update");
        if (!old) throw new ActionError("This department no longer exists");
        await tx.update(schema.departments).set(input).where(eq(schema.departments.id, id));
        await audit(tx, { userId: user.id, table: "departments", recordId: id, action: "UPDATE", oldValue: old, newValue: input });
        return id;
      }
      const [row] = await tx.insert(schema.departments).values(input).returning({ id: schema.departments.id });
      await audit(tx, { userId: user.id, table: "departments", recordId: row.id, action: "CREATE", newValue: input });
      return row.id;
    });
    revalidatePath("/settings/departments");
    return { ok: true, data: { id: savedId }, message: id ? "Department updated" : "Department added" };
  });
}
