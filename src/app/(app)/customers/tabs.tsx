"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/customers/ledger", label: "Customer Ledger" },
  { href: "/customers/outstanding", label: "Outstanding Bills" },
];

/** Keeps the selected customer when switching tabs. */
export function CustomerTabs() {
  const pathname = usePathname();
  const customer = useSearchParams().get("customer");
  return (
    <nav className="flex gap-1 border-b border-border" aria-label="Customer reports">
      {TABS.map((t) => (
        <Link
          key={t.href}
          href={customer ? `${t.href}?customer=${customer}` : t.href}
          className={cn(
            "-mb-px border-b-2 px-3 py-2 text-sm",
            pathname.startsWith(t.href) ? "border-primary font-medium text-primary" : "border-transparent text-muted hover:text-ink",
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
