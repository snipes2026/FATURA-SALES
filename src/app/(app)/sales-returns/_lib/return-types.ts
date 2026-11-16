import type { DeptTax } from "@/lib/grn-calc";
import type { QtyCheckMode } from "@/lib/sales/return-calc";

/** The bill line a returned item comes from (return against a bill). */
export type OriginLine = {
  id: number;
  qty: number;
  rate: string;
  amount: string;
  gst: string;
  gstRate: number;
  returned: number;
};

/** One row of the return being entered (client state). */
export type ReturnItem = {
  key: string;
  productId: number;
  barcode: string;
  itemName: string;
  hsn: string;
  dept: DeptTax;
  qty: number;
  rate: string; // rupees as typed
  /** Sold to this customer / already returned (free-form return). */
  sold: number;
  returned: number;
  lastRate: string | null;
  /** Set when the return is against a bill. */
  origin: OriginLine | null;
  rev?: number;
};

export type ReturnScreenSettings = {
  returnQtyCheck: QtyCheckMode;
  autoIncrementQty: boolean;
  defaultGstMode: "ADD" | "INCLUDES";
  bank1Name: string;
  bank2Name: string;
  bank2Enabled: boolean;
};

/** What the qty check compares for one row: the linked bill line, or everything sold to the customer. */
export function qtyBasis(i: ReturnItem): { key: string; sold: number; returned: number } {
  return i.origin ? { key: `L${i.origin.id}`, sold: i.origin.qty, returned: i.origin.returned } : { key: `P${i.productId}`, sold: i.sold, returned: i.returned };
}
