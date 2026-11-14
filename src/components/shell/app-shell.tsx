"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { APP_NAME, APP_VERSION } from "@/components/brand";
import { ToastProvider } from "@/components/ui/toast";
import type { CurrentUser } from "@/lib/session";
import { MobileNav, Sidebar } from "./sidebar";
import { Topbar } from "./topbar";

const COLLAPSE_KEY = "fd.sidebarCollapsed";

/** Full-height working screens (billing, receipts): sidebar auto-collapsed, no page scroll, no footer. */
const FULL_SCREEN = ["/sales/new", "/receipts/new"];

export function AppShell({ user, children }: { user: CurrentUser; children: React.ReactNode }) {
  const pathname = usePathname();
  const fullScreen = FULL_SCREEN.some((p) => pathname.startsWith(p));
  const [savedCollapsed, setSavedCollapsed] = useState(false);
  const [fullScreenExpanded, setFullScreenExpanded] = useState(false); // expanded by hand on a full-screen page (not remembered)
  const [mobileOpen, setMobileOpen] = useState(false);
  const collapsed = fullScreen ? !fullScreenExpanded : savedCollapsed;

  useEffect(() => setFullScreenExpanded(false), [pathname]);

  useEffect(() => {
    try {
      setSavedCollapsed(localStorage.getItem(COLLAPSE_KEY) === "1");
    } catch {}
  }, []);

  const toggle = () => {
    if (fullScreen) return setFullScreenExpanded((x) => !x);
    setSavedCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, c ? "0" : "1");
      } catch {}
      return !c;
    });
  };

  return (
    <ToastProvider>
    <div
      className={fullScreen ? "flex h-screen overflow-hidden" : "flex min-h-screen"}
      style={{ "--sidebar-w": collapsed ? "68px" : "240px" } as React.CSSProperties}
    >
      <Sidebar role={user.role} collapsed={collapsed} onToggle={toggle} />
      <MobileNav role={user.role} open={mobileOpen} onClose={() => setMobileOpen(false)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar user={user} onMenu={() => setMobileOpen(true)} />
        {fullScreen ? (
          <main className="min-h-0 flex-1 overflow-hidden p-3">{children}</main>
        ) : (
          <>
            <main className="flex-1 p-4 md:p-6">{children}</main>
            <footer className="no-print border-t border-border px-6 py-3 text-xs text-muted">
              {APP_NAME} v{APP_VERSION}
            </footer>
          </>
        )}
      </div>
    </div>
    </ToastProvider>
  );
}
