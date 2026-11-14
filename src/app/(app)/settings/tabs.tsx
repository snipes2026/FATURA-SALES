"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export const SETTINGS_TABS = [
  { href: "/settings/company", label: "Company Profile" },
  { href: "/settings/suppliers", label: "Suppliers" },
  { href: "/settings/customers", label: "Customers" },
  { href: "/settings/transport", label: "Transport" },
  { href: "/settings/departments", label: "Departments" },
  { href: "/settings/categories", label: "Categories" },
  { href: "/settings/barcode", label: "Barcode" },
  { href: "/settings/grn-numbering", label: "GRN Numbering" },
  { href: "/settings/sales", label: "Sales & Payments" },
  { href: "/settings/locations", label: "Locations" },
  { href: "/settings/users", label: "Users" },
];

export function SettingsTabs() {
  const pathname = usePathname();
  return (
    <nav className="no-print -mx-4 overflow-x-auto px-4 md:-mx-6 md:px-6" aria-label="Settings sections">
      <div className="flex min-w-max gap-1 border-b border-border">
        {SETTINGS_TABS.map((t) => {
          const active = pathname.startsWith(t.href);
          return (
            <Link
              key={t.href}
              href={t.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "-mb-px border-b-2 px-3 py-2 text-sm whitespace-nowrap",
                active ? "border-primary font-medium text-primary" : "border-transparent text-muted hover:text-ink",
              )}
            >
              {t.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
