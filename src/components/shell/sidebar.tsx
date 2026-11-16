"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { Wordmark } from "@/components/brand";
import { can } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { NAV_ITEMS } from "./nav";

export function Sidebar({ role, collapsed, onToggle }: { role: string; collapsed: boolean; onToggle: () => void }) {
  const pathname = usePathname();
  const items = NAV_ITEMS.filter((i) => !i.permission || i.comingSoon || can(role, i.permission));

  return (
    <aside
      className={cn(
        "no-print sticky top-0 hidden h-screen shrink-0 flex-col border-r border-border bg-surface transition-[width] duration-200 md:flex",
        collapsed ? "w-[68px]" : "w-60",
      )}
    >
      <div className="flex h-14 items-center border-b border-border px-4">
        <Link href="/" aria-label="Fatura Desk home">
          <Wordmark collapsed={collapsed} />
        </Link>
      </div>
      <nav className="flex-1 space-y-0.5 overflow-y-auto p-2">
        {items.map((item) => {
          const section = item.href.split("/").slice(0, 2).join("/"); // "/customers/ledger" is active on any /customers page
          // whole path segments only — "/sales" must not light up on "/sales-returns"
          const active = item.href === "/" ? pathname === "/" : pathname === section || pathname.startsWith(`${section}/`);
          const Icon = item.icon;
          const inner = (
            <>
              <Icon className="size-[18px] shrink-0" />
              {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
              {!collapsed && item.comingSoon && (
                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted">Soon</span>
              )}
            </>
          );
          const base = "flex h-9 items-center gap-3 rounded-md px-3 text-sm";
          return item.comingSoon ? (
            <span key={item.href} title={`${item.label} — coming soon`} aria-disabled className={cn(base, "cursor-not-allowed text-slate-400")}>
              {inner}
            </span>
          ) : (
            <Link
              key={item.href}
              href={item.href}
              title={collapsed ? item.label : undefined}
              className={cn(base, active ? "bg-primary-soft font-medium text-primary" : "text-slate-700 hover:bg-slate-100")}
            >
              {inner}
            </Link>
          );
        })}
      </nav>
      <button
        type="button"
        onClick={onToggle}
        className="flex h-10 items-center gap-3 border-t border-border px-5 text-sm text-muted hover:text-ink"
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      >
        {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
        {!collapsed && "Collapse"}
      </button>
    </aside>
  );
}

/** Mobile/tablet: slide-over version of the sidebar. */
export function MobileNav({ role, open, onClose }: { role: string; open: boolean; onClose: () => void }) {
  const pathname = usePathname();
  if (!open) return null;
  const items = NAV_ITEMS.filter((i) => !i.comingSoon && (!i.permission || can(role, i.permission)));
  return (
    <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal>
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="absolute inset-y-0 left-0 w-64 bg-surface p-3 shadow-xl">
        <div className="mb-3 px-2 py-2">
          <Wordmark />
        </div>
        {items.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            onClick={onClose}
            className={cn(
              "flex h-10 items-center gap-3 rounded-md px-3 text-sm",
              (item.href === "/" ? pathname === "/" : pathname === item.href || pathname.startsWith(`${item.href}/`)) ? "bg-primary-soft text-primary" : "text-slate-700",
            )}
          >
            <item.icon className="size-[18px]" />
            {item.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
