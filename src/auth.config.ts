import type { NextAuthConfig } from "next-auth";

/**
 * Edge-safe Auth.js config (no DB / bcrypt imports) — used by middleware.
 * The full config with the Credentials provider lives in src/auth.ts.
 */
export const authConfig = {
  pages: { signIn: "/login" },
  session: { strategy: "jwt", maxAge: 12 * 60 * 60 }, // one working day
  trustHost: true,
  providers: [],
  callbacks: {
    authorized({ auth, request }) {
      const { pathname } = request.nextUrl;
      const isLoggedIn = !!auth?.user;
      if (pathname.startsWith("/login")) {
        if (isLoggedIn) return Response.redirect(new URL("/", request.nextUrl));
        return true;
      }
      return isLoggedIn; // false -> redirect to /login
    },
    jwt({ token, user }) {
      if (user) {
        token.uid = Number(user.id);
        token.username = user.username;
        token.role = user.role;
      }
      return token;
    },
    session({ session, token }) {
      session.user.id = String(token.uid);
      session.user.username = token.username as string;
      session.user.role = token.role as string;
      return session;
    },
  },
} satisfies NextAuthConfig;
