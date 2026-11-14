"use server";

import bcrypt from "bcryptjs";
import { and, eq, inArray, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { schema, type Tx } from "@/db";
import type { ActionResult } from "@/lib/action-result";
import { ActionError, audit, db, runAction } from "@/lib/server-action";
import { userSchema } from "@/lib/validation/masters";

async function countOtherActiveAdmins(tx: Tx, excludeUserId: number) {
  const rows = await tx
    .select({ id: schema.users.id })
    .from(schema.users)
    .innerJoin(schema.roles, eq(schema.roles.id, schema.users.roleId))
    .where(and(eq(schema.roles.code, "ADMIN"), eq(schema.users.isActive, true), ne(schema.users.id, excludeUserId)));
  return rows.length;
}

export async function saveUser(raw: unknown): Promise<ActionResult<{ id: number }>> {
  return runAction("settings.manage", userSchema, raw, async ({ id, password, locationIds, ...input }, me) => {
    const savedId = await db.transaction(async (tx) => {
      const [role] = await tx.select().from(schema.roles).where(eq(schema.roles.id, input.roleId));
      if (!role) throw new ActionError("Select a role", "roleId");
      const locs = await tx.select({ id: schema.locations.id }).from(schema.locations).where(inArray(schema.locations.id, locationIds));
      if (locs.length !== new Set(locationIds).size) throw new ActionError("One of the locations no longer exists", "locationIds");

      const passwordHash = password ? await bcrypt.hash(password, 12) : undefined;

      let userId: number;
      if (id) {
        const [old] = await tx.select().from(schema.users).where(eq(schema.users.id, id)).for("update");
        if (!old) throw new ActionError("This user no longer exists");
        const [oldRole] = await tx.select().from(schema.roles).where(eq(schema.roles.id, old.roleId));

        if (id === me.id && !input.isActive) throw new ActionError("You can't deactivate your own account", "isActive");
        if (id === me.id && role.code !== "ADMIN") throw new ActionError("You can't remove your own Admin role", "roleId");
        const losingAdmin = oldRole?.code === "ADMIN" && old.isActive && (role.code !== "ADMIN" || !input.isActive);
        if (losingAdmin && (await countOtherActiveAdmins(tx, id)) === 0)
          throw new ActionError("At least one active Admin is required", role.code !== "ADMIN" ? "roleId" : "isActive");

        await tx
          .update(schema.users)
          .set({ ...input, ...(passwordHash ? { passwordHash } : {}) })
          .where(eq(schema.users.id, id));
        const oldLocs = await tx.select().from(schema.userLocations).where(eq(schema.userLocations.userId, id));
        await tx.delete(schema.userLocations).where(eq(schema.userLocations.userId, id));
        await audit(tx, {
          userId: me.id,
          table: "users",
          recordId: id,
          action: "UPDATE",
          oldValue: { ...old, locationIds: oldLocs.map((l) => l.locationId) },
          newValue: { ...input, locationIds, passwordChanged: !!passwordHash },
        });
        userId = id;
      } else {
        const [row] = await tx
          .insert(schema.users)
          .values({ ...input, passwordHash: passwordHash! })
          .returning({ id: schema.users.id });
        await audit(tx, { userId: me.id, table: "users", recordId: row.id, action: "CREATE", newValue: { ...input, locationIds } });
        userId = row.id;
      }
      await tx.insert(schema.userLocations).values([...new Set(locationIds)].map((locationId) => ({ userId, locationId })));
      return userId;
    });
    revalidatePath("/settings/users");
    return { ok: true, data: { id: savedId }, message: id ? "User updated" : "User added" };
  });
}
