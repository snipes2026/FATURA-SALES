"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { signIn, signOut } from "@/auth";
import { AuthError as NextAuthError } from "next-auth";
import { getCurrentUser, LOCATION_COOKIE } from "@/lib/session";
import { loginSchema } from "@/lib/validation/auth";

export type LoginState =
  | { error?: string; username?: string; fieldErrors?: Partial<Record<"username" | "password", string>> }
  | undefined;

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const username = String(formData.get("username") ?? "");
  const parsed = loginSchema.safeParse({ username, password: formData.get("password") });
  if (!parsed.success) {
    const fe = parsed.error.flatten().fieldErrors;
    return { username, fieldErrors: { username: fe.username?.[0], password: fe.password?.[0] } };
  }
  try {
    await signIn("credentials", { ...parsed.data, redirectTo: String(formData.get("callbackUrl") || "/") });
  } catch (err) {
    if (err instanceof NextAuthError) {
      if (err.type === "CredentialsSignin") return { username, error: "Invalid username or password." };
      console.error("[login]", err);
      return { username, error: "Sign-in failed because of a server problem. Please try again." };
    }
    throw err; // NEXT_REDIRECT on success
  }
}

export async function logoutAction() {
  (await cookies()).delete(LOCATION_COOKIE);
  await signOut({ redirectTo: "/login" });
}

export async function setLocationAction(locationId: number) {
  const user = await getCurrentUser();
  if (!user || !user.locations.some((l) => l.id === locationId)) return { error: "Location not allowed" };
  (await cookies()).set(LOCATION_COOKIE, String(locationId), { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 });
  revalidatePath("/", "layout");
  return { ok: true };
}
