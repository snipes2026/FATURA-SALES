import NextAuth from "next-auth";
import { authConfig } from "./auth.config";

export default NextAuth(authConfig).auth;

export const config = {
  // Everything except static assets, the health check and Auth.js endpoints.
  matcher: ["/((?!api/health|api/auth|_next/static|_next/image|icon.svg|favicon.ico|uploads/).*)"],
};
