export const ROLE_CODES = ["ADMIN", "GRN_ENTRY", "SALES", "VIEWER"] as const;
export type RoleCode = (typeof ROLE_CODES)[number];

export const PERMISSIONS = [
  "settings.manage", // all Settings masters, users, numbering, Sales & Payments settings (incl. price edit)
  "grn.view",
  "grn.create", // create/edit drafts, add items
  "grn.save", // finalise GRN (numbering + stock posting)
  "grn.edit", // edit a saved GRN (only when no item sold/transferred)
  "grn.delete", // cancel a GRN (reverses stock)
  "barcode.generate",
  "category.addValue", // add a category value inline from the GRN screen
  "supplier.quickCreate", // "+ Add" supplier from the GRN screen
  "sales.view", // sales list, bills, customer ledger, outstanding
  "sales.create", // create sales bills
  "sales.cancel", // cancel a sales bill (reverses stock, ledger, allocations)
  "receipt.create", // customer receipts
  "customer.quickCreate", // "+ Add Customer" from billing / receipts
  "salesReturn.view", // sales return list, credit notes
  "salesReturn.create", // create a sales return (credit note)
  "salesReturn.cancel", // cancel a sales return (reverses stock, ledger, credit, refund)
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ROLE_PERMISSIONS: Record<RoleCode, readonly Permission[]> = {
  ADMIN: PERMISSIONS,
  GRN_ENTRY: ["grn.view", "grn.create", "grn.save", "grn.edit", "barcode.generate", "category.addValue", "supplier.quickCreate"],
  SALES: ["sales.view", "sales.create", "receipt.create", "customer.quickCreate", "salesReturn.view", "salesReturn.create"],
  VIEWER: ["grn.view", "sales.view", "salesReturn.view"],
};

export function can(role: string | undefined | null, permission: Permission): boolean {
  if (!role) return false;
  return (ROLE_PERMISSIONS[role as RoleCode] ?? []).includes(permission);
}
