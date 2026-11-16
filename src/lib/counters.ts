/** Names of rows in the `counters` table. */
export const COUNTER = {
  GRN: "GRN", // one row per financial year
  BARCODE: "BARCODE", // fy = "ALL", never resets
  INVOICE: "INVOICE", // sales bill numbers, one row per financial year
  RECEIPT: "RECEIPT", // customer receipt numbers, one row per financial year
  SALES_RETURN: "SALES_RETURN", // credit note numbers (SR/26-27/0001), one row per financial year
} as const;

export const BARCODE_FY = "ALL";
