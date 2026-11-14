import {
  BarChart3,
  BookUser,
  HandCoins,
  Boxes,
  FileInput,
  LayoutDashboard,
  Receipt,
  Settings,
  Undo2,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import type { Permission } from "@/lib/permissions";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  comingSoon?: boolean;
  permission?: Permission;
};

export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/grn", label: "GRN", icon: FileInput, permission: "grn.view" },
  { href: "/sales", label: "Sales", icon: Receipt, permission: "sales.view" },
  { href: "/receipts/new", label: "Receipts", icon: HandCoins, permission: "receipt.create" },
  { href: "/customers/ledger", label: "Customer Ledger", icon: BookUser, permission: "sales.view" },
  { href: "/sales-return", label: "Sales Return", icon: Undo2, comingSoon: true },
  { href: "/stock", label: "Stock", icon: Boxes, comingSoon: true },
  { href: "/accounts", label: "Accounts", icon: Wallet, comingSoon: true },
  { href: "/reports", label: "Reports", icon: BarChart3, comingSoon: true },
  { href: "/settings", label: "Settings", icon: Settings, permission: "settings.manage" },
];

/** Page titles + breadcrumbs for the top bar, longest prefix wins. */
const TITLES: { prefix: string; title: string; crumbs: string[] }[] = [
  { prefix: "/receipts/new", title: "Customer Receipt", crumbs: ["Receipts", "New Receipt"] },
  { prefix: "/customers/ledger", title: "Customer Ledger", crumbs: ["Customers", "Ledger"] },
  { prefix: "/customers/outstanding", title: "Outstanding Bills", crumbs: ["Customers", "Outstanding Bills"] },
  { prefix: "/sales/new",title: "New Sale", crumbs: ["Sales", "New Sale"] },
  { prefix: "/sales/", title: "Sales Bill", crumbs: ["Sales", "Bill"] },
  { prefix: "/sales", title: "Sales", crumbs: ["Sales"] },
  { prefix: "/grn/new",title: "New GRN", crumbs: ["GRN", "New GRN"] },
  { prefix: "/grn/", title: "GRN", crumbs: ["GRN", "View"] },
  { prefix: "/grn", title: "GRN", crumbs: ["GRN"] },
  { prefix: "/settings/company", title: "Company Profile", crumbs: ["Settings", "Company Profile"] },
  { prefix: "/settings/suppliers", title: "Suppliers", crumbs: ["Settings", "Suppliers"] },
  { prefix: "/settings/customers", title: "Customers", crumbs: ["Settings", "Customers"] },
  { prefix: "/settings/sales", title: "Sales & Payments", crumbs: ["Settings", "Sales & Payments"] },
  { prefix: "/settings/transport", title: "Transport", crumbs: ["Settings", "Transport"] },
  { prefix: "/settings/departments", title: "Departments", crumbs: ["Settings", "Departments"] },
  { prefix: "/settings/categories", title: "Categories", crumbs: ["Settings", "Categories"] },
  { prefix: "/settings/barcode", title: "Barcode Settings", crumbs: ["Settings", "Barcode"] },
  { prefix: "/settings/grn-numbering", title: "GRN Numbering", crumbs: ["Settings", "GRN Numbering"] },
  { prefix: "/settings/locations", title: "Locations", crumbs: ["Settings", "Locations"] },
  { prefix: "/settings/users", title: "Users", crumbs: ["Settings", "Users"] },
  { prefix: "/settings", title: "Settings", crumbs: ["Settings"] },
  { prefix: "/", title: "Dashboard", crumbs: ["Dashboard"] },
];

export function titleFor(pathname: string) {
  if (/^\/grn\/\d+\/edit$/.test(pathname)) return { prefix: pathname, title: "Edit GRN", crumbs: ["GRN", "Edit GRN"] };
  return TITLES.find((t) => (t.prefix === "/" ? pathname === "/" : pathname.startsWith(t.prefix))) ?? TITLES[TITLES.length - 1];
}
