"use server";

import { and, eq, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { schema } from "@/db";
import type { ActionResult } from "@/lib/action-result";
import { ActionError, audit, db, runAction } from "@/lib/server-action";
import { locationSchema } from "@/lib/validation/masters";

export async function saveLocation(raw: unknown): Promise<ActionResult<{ id: number }>> {
  return runAction("settings.manage", locationSchema, raw, async ({ id, ...input }, user) => {
    const savedId = await db.transaction(async (tx) => {
      if (id) {
        const [old] = await tx.select().from(schema.locations).where(eq(schema.locations.id, id)).for("update");
        if (!old) throw new ActionError("This location no longer exists");
        if (old.isActive && !input.isActive) {
          const others = await tx
            .select({ id: schema.locations.id })
            .from(schema.locations)
            .where(and(eq(schema.locations.isActive, true), ne(schema.locations.id, id)));
          if (others.length === 0) throw new ActionError("At least one location must stay active", "isActive");
        }
        await tx.update(schema.locations).set(input).where(eq(schema.locations.id, id));
        await audit(tx, { userId: user.id, table: "locations", recordId: id, action: "UPDATE", oldValue: old, newValue: input });
        return id;
      }
      const [row] = await tx.insert(schema.locations).values(input).returning({ id: schema.locations.id });
      // Admins can work everywhere: give every active admin access to the new location.
      const admins = await tx
        .select({ id: schema.users.id })
        .from(schema.users)
        .innerJoin(schema.roles, eq(schema.roles.id, schema.users.roleId))
        .where(eq(schema.roles.code, "ADMIN"));
      if (admins.length) await tx.insert(schema.userLocations).values(admins.map((a) => ({ userId: a.id, locationId: row.id })));
      await audit(tx, { userId: user.id, table: "locations", recordId: row.id, action: "CREATE", newValue: input });
      return row.id;
    });
    revalidatePath("/settings/locations");
    revalidatePath("/", "layout"); // location selector in the top bar
    return { ok: true, data: { id: savedId }, message: id ? "Location updated" : "Location added" };
  });
}
