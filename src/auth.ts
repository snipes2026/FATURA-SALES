import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { authConfig } from "./auth.config";
import { db, schema } from "./db";
import { loginSchema } from "./lib/validation/auth";

// Used to keep timing similar when the username doesn't exist.
const DUMMY_HASH = bcrypt.hashSync("fatura-desk-timing-dummy", 12);

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: { username: {}, password: {} },
      async authorize(raw) {
        const parsed = loginSchema.safeParse(raw);
        if (!parsed.success) return null;
        const { username, password } = parsed.data;

        const [row] = await db
          .select({
            id: schema.users.id,
            name: schema.users.name,
            username: schema.users.username,
            passwordHash: schema.users.passwordHash,
            isActive: schema.users.isActive,
            role: schema.roles.code,
          })
          .from(schema.users)
          .innerJoin(schema.roles, eq(schema.roles.id, schema.users.roleId))
          .where(eq(schema.users.username, username.toLowerCase()));

        const ok = await bcrypt.compare(password, row?.passwordHash ?? DUMMY_HASH);
        if (!row || !ok || !row.isActive) return null;

        await db.update(schema.users).set({ lastLoginAt: new Date() }).where(eq(schema.users.id, row.id));
        await db.insert(schema.auditLog).values({
          userId: row.id,
          tableName: "users",
          recordId: String(row.id),
          action: "LOGIN",
        });

        return { id: String(row.id), name: row.name, username: row.username, role: row.role };
      },
    }),
  ],
});
