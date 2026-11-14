import type { Metadata } from "next";
import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/session";
import { UsersClient } from "./users-client";

export const metadata: Metadata = { title: "Users" };

export default async function UsersPage() {
  const me = await requireUser();
  const [users, roles, locations, links] = await Promise.all([
    db
      .select({
        id: schema.users.id,
        name: schema.users.name,
        username: schema.users.username,
        roleId: schema.users.roleId,
        roleName: schema.roles.name,
        isActive: schema.users.isActive,
        lastLoginAt: schema.users.lastLoginAt,
      })
      .from(schema.users)
      .innerJoin(schema.roles, eq(schema.roles.id, schema.users.roleId))
      .orderBy(asc(schema.users.name)),
    db.select().from(schema.roles).orderBy(asc(schema.roles.id)),
    db.select({ id: schema.locations.id, name: schema.locations.name, isActive: schema.locations.isActive }).from(schema.locations).orderBy(asc(schema.locations.name)),
    db.select().from(schema.userLocations),
  ]);

  return (
    <UsersClient
      meId={me.id}
      roles={roles.map((r) => ({ id: r.id, code: r.code, name: r.name }))}
      locations={locations}
      rows={users.map((u) => ({
        ...u,
        lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
        locationIds: links.filter((l) => l.userId === u.id).map((l) => l.locationId),
      }))}
    />
  );
}
