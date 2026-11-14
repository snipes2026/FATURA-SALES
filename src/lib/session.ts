import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { auth } from "@/auth";
import { db, schema } from "@/db";
import { can, type Permission } from "./permissions";

export const LOCATION_COOKIE = "fd_location";

export type CurrentUser = {
  id: number;
  name: string;
  username: string;
  role: string;
  roleName: string;
  locations: { id: number; name: string; type: "STORE" | "GODOWN"; stateCode: string }[];
  currentLocationId: number | null;
};

/**
 * The logged-in user, re-read from the database once per request so that
 * deactivation / role / location changes take effect immediately (the JWT
 * only proves identity).
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const session = await auth();
  const id = Number(session?.user?.id);
  if (!id) return null;

  const [u] = await db
    .select({
      id: schema.users.id,
      name: schema.users.name,
      username: schema.users.username,
      isActive: schema.users.isActive,
      role: schema.roles.code,
      roleName: schema.roles.name,
    })
    .from(schema.users)
    .innerJoin(schema.roles, eq(schema.roles.id, schema.users.roleId))
    .where(eq(schema.users.id, id));
  if (!u || !u.isActive) return null;

  const locs = await db
    .select({ id: schema.locations.id, name: schema.locations.name, type: schema.locations.type, stateCode: schema.locations.stateCode })
    .from(schema.userLocations)
    .innerJoin(schema.locations, eq(schema.locations.id, schema.userLocations.locationId))
    .where(and(eq(schema.userLocations.userId, id), eq(schema.locations.isActive, true)))
    .orderBy(asc(schema.locations.name));

  const cookieLoc = Number((await cookies()).get(LOCATION_COOKIE)?.value);
  const currentLocationId = locs.find((l) => l.id === cookieLoc)?.id ?? locs[0]?.id ?? null;

  return { id: u.id, name: u.name, username: u.username, role: u.role, roleName: u.roleName, locations: locs, currentLocationId };
});

/** For pages: redirects to /login when not signed in. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/** For pages: redirects home when the permission is missing. */
export async function requirePermission(permission: Permission): Promise<CurrentUser> {
  const user = await requireUser();
  if (!can(user.role, permission)) redirect("/?denied=1");
  return user;
}

export class AuthError extends Error {}

/** For server actions / route handlers: throws instead of redirecting. */
export async function assertPermission(permission: Permission, locationId?: number): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) throw new AuthError("Your session has expired. Please sign in again.");
  if (!can(user.role, permission)) throw new AuthError("You don't have permission to do this.");
  if (locationId !== undefined && !user.locations.some((l) => l.id === locationId))
    throw new AuthError("You don't have access to this location.");
  return user;
}
