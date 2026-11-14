"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { ChevronDown, ChevronRight, LogOut, MapPin, Menu } from "lucide-react";
import { logoutAction, setLocationAction } from "@/app/actions/session";
import type { CurrentUser } from "@/lib/session";
import { titleFor } from "./nav";
import { TOPBAR_SLOT_ID } from "./topbar-slot";

export function Topbar({ user, onMenu }: { user: CurrentUser; onMenu: () => void }) {
  const pathname = usePathname();
  const { title, crumbs } = titleFor(pathname);

  useEffect(() => {
    document.title = `${title} · Fatura Desk`;
  }, [title]);

  return (
    <header className="no-print sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-surface px-4">
      <button type="button" className="rounded-md p-1.5 hover:bg-slate-100 md:hidden" onClick={onMenu} aria-label="Open menu">
        <Menu className="size-5" />
      </button>
      <div className="min-w-[5.5rem] flex-1">
        <h1 className="truncate text-[15px] font-semibold leading-tight">{title}</h1>
        <nav aria-label="Breadcrumb" className="hidden items-center gap-1 text-xs text-muted sm:flex">
          <span>Home</span>
          {crumbs.map((c) => (
            <span key={c} className="flex items-center gap-1">
              <ChevronRight className="size-3" />
              {c}
            </span>
          ))}
        </nav>
      </div>
      <div id={TOPBAR_SLOT_ID} className="flex items-center gap-2" />
      <LocationSelector user={user} />
      <UserMenu user={user} />
    </header>
  );
}

function LocationSelector({ user }: { user: CurrentUser }) {
  const [pending, start] = useTransition();
  if (user.locations.length === 0) {
    return <span className="rounded-md bg-warning-soft px-2 py-1 text-xs text-warning">No location assigned</span>;
  }
  return (
    <label className="flex items-center gap-1.5 text-sm">
      <MapPin className="hidden size-4 text-muted sm:block" aria-hidden />
      <span className="sr-only">Location</span>
      <select
        className="h-9 max-w-[6.5rem] rounded-md sm:max-w-[11rem] border border-border bg-surface px-2 text-sm focus:border-primary focus:outline-none"
        value={user.currentLocationId ?? undefined}
        disabled={pending || user.locations.length === 1}
        onChange={(e) => start(() => void setLocationAction(Number(e.target.value)))}
      >
        {user.locations.map((l) => (
          <option key={l.id} value={l.id}>
            {l.name} {l.type === "GODOWN" ? "(Godown)" : ""}
          </option>
        ))}
      </select>
    </label>
  );
}

function UserMenu({ user }: { user: CurrentUser }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const initials = user.name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-slate-100"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="flex size-8 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-700">{initials}</span>
        <span className="hidden text-left leading-tight lg:block">
          <span className="block text-sm font-medium">{user.name}</span>
          <span className="block text-xs text-muted">{user.roleName}</span>
        </span>
        <ChevronDown className="size-4 text-muted" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 mt-1 w-52 rounded-md border border-border bg-surface py-1 shadow-lg">
          <div className="border-b border-border px-3 py-2">
            <p className="text-sm font-medium">{user.name}</p>
            <p className="text-xs text-muted">
              @{user.username} · {user.roleName}
            </p>
          </div>
          <form action={logoutAction}>
            <button type="submit" role="menuitem" className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-slate-100">
              <LogOut className="size-4" /> Sign out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
