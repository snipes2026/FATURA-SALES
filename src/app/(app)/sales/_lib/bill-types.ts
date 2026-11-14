import type { DeptTax } from "@/lib/grn-calc";

/** One row of the bill being entered (client state). */
export type BillItem = {
  key: string;
  productId: number;
  barcode: string;
  itemName: string;
  hsn: string;
  dept: DeptTax;
  wsp: string | null;
  mrp: string;
  purchaseRate: string;
  stock: number; // at the bill's location, when scanned / location changed
  qty: number;
  rate: string; // rupees as typed ("" when the product has no WSP)
  priceEdited: boolean;
  belowCostConfirmed: boolean;
  rev?: number; // bumped to make the row discard a refused edit
};

export type SalesScreenSettings = {
  allowPriceEdit: boolean;
  allowNegativeStock: boolean;
  autoIncrementQty: boolean;
  defaultGstMode: "ADD" | "INCLUDES";
  bank1Name: string;
  bank2Name: string;
  bank2Enabled: boolean;
  walkinAllowCredit: boolean;
  walkinAllowAdvance: boolean;
};

/** Total qty per product across all rows (the same barcode may be on several rows when auto-increase is off). */
export function qtyByProduct(items: BillItem[]): Map<number, number> {
  const m = new Map<number, number>();
  for (const i of items) m.set(i.productId, (m.get(i.productId) ?? 0) + i.qty);
  return m;
}
