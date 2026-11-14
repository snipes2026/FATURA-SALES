import type { Metadata } from "next";
import { APP_NAME, APP_VERSION, Monogram } from "@/components/brand";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

/** Keep only the path + query of the callback URL so we never redirect off-site. */
function toLocalPath(callbackUrl?: string): string {
  if (!callbackUrl) return "/";
  try {
    const u = new URL(callbackUrl, "http://local");
    const path = `${u.pathname}${u.search}`;
    return path.startsWith("/") && !path.startsWith("//") && !path.startsWith("/login") ? path : "/";
  } catch {
    return "/";
  }
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ callbackUrl?: string }> }) {
  const { callbackUrl } = await searchParams;
  const safeCallback = toLocalPath(callbackUrl);
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-[var(--radius-card)] border border-border bg-surface p-8 shadow-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <Monogram className="size-12 rounded-xl text-base" />
          <h1 className="mt-3 text-xl font-semibold tracking-tight">{APP_NAME}</h1>
          <p className="mt-1 text-sm text-muted">Billing · Inventory · Accounts</p>
        </div>
        <LoginForm callbackUrl={safeCallback} />
      </div>
      <p className="mt-6 text-xs text-muted">
        {APP_NAME} v{APP_VERSION}
      </p>
    </main>
  );
}
