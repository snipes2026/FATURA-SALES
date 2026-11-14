/**
 * zod schemas for the Sales module masters/settings — shared by the client
 * forms and the server actions.
 */
import { z } from "zod";
import { GST_STATES, isValidGstin } from "@/lib/india";

const id = z.number().int().positive().optional();

const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Too long (max ${max})`)
    .transform((v) => (v === "" ? null : v));

const isoDate = (label: string) => z.string().regex(/^\d{4}-\d{2}-\d{2}$/, `${label}: enter a valid date`);

// ------------------------------------------------------------ customer
export const customerSchema = z
  .object({
    id,
    name: z.string().trim().min(1, "Customer name is required").max(160, "Too long (max 160)"),
    address: optional(500),
    gstin: z
      .string()
      .trim()
      .toUpperCase()
      .refine((v) => v === "" || isValidGstin(v), "Invalid GSTIN (15 characters, check digit must match)")
      .transform((v) => (v === "" ? null : v)),
    stateCode: z.string().refine((v) => !!GST_STATES[v], "Select a state"),
    phone: z
      .string()
      .trim()
      .min(1, "Contact number is required")
      .refine((v) => /^[0-9+\-\s()]{6,20}$/.test(v), "Enter a valid contact number"),
    openingBalance: z
      .string()
      .trim()
      .transform((v) => (v === "" ? "0" : v.replace(/,/g, "")))
      .refine((v) => /^\d{1,12}(\.\d{1,2})?$/.test(v), "Enter an amount with up to 2 decimals"),
    openingType: z.enum(["DR", "CR"]),
    openingDate: isoDate("Opening date"),
    isActive: z.boolean(),
  })
  .superRefine((v, ctx) => {
    if (v.gstin && v.gstin.slice(0, 2) !== v.stateCode)
      ctx.addIssue({ code: "custom", path: ["stateCode"], message: "State must match the GSTIN" });
  });
export type CustomerInput = z.input<typeof customerSchema>;

// ------------------------------------------------------------ sales & payments settings
const docPrefix = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9-]{1,20}$/, "Letters, digits and '-' only (1–20)");

const digits = z
  .string()
  .trim()
  .regex(/^\d+$/, "Digits must be a whole number")
  .transform(Number)
  .refine((n) => n >= 3 && n <= 8, "Digits must be between 3 and 8");

const bankName = (label: string) => z.string().trim().min(1, `${label} name is required`).max(40, "Too long (max 40)");

export const salesSettingsSchema = z
  .object({
    allowPriceEdit: z.boolean(),
    bank1Name: bankName("Bank 1"),
    bank2Name: bankName("Bank 2"),
    bank2Enabled: z.boolean(),
    defaultGstMode: z.enum(["ADD", "INCLUDES"]),
    allowNegativeStock: z.boolean(),
    autoIncrementQty: z.boolean(),
    invoicePrefix: docPrefix,
    invoiceDigits: digits,
    receiptPrefix: docPrefix,
    receiptDigits: digits,
    printFormat: z.enum(["A4", "THERMAL80"]),
    walkinAllowCredit: z.boolean(),
    walkinAllowAdvance: z.boolean(),
  })
  .superRefine((v, ctx) => {
    if (v.invoicePrefix === v.receiptPrefix)
      ctx.addIssue({ code: "custom", path: ["receiptPrefix"], message: "Must differ from the invoice prefix" });
    if (v.bank2Enabled && v.bank1Name.toLowerCase() === v.bank2Name.toLowerCase())
      ctx.addIssue({ code: "custom", path: ["bank2Name"], message: "Must differ from Bank 1" });
  });
export type SalesSettingsInput = z.input<typeof salesSettingsSchema>;

// ------------------------------------------------------------ save sale / receipt payloads
const amountStr = z
  .string()
  .trim()
  .transform((v) => v.replace(/,/g, ""))
  .refine((v) => v === "" || /^\d{1,10}(\.\d{1,2})?$/.test(v), "Enter an amount with up to 2 decimals");
const signedAmountStr = z.string().trim().regex(/^-?\d{1,10}(\.\d{1,2})?$/, "Enter an amount with up to 2 decimals");

export const paymentInputSchema = z.object({
  cash: amountStr,
  bank1: amountStr,
  bank2: amountStr,
  advanceUsed: amountStr.nullable(),
  manual: z.record(z.string().max(40), amountStr).nullable(),
  excess: z.enum(["ADVANCE", "CHANGE"]).nullable(),
});
export type PaymentInput = z.input<typeof paymentInputSchema>;

export const saleSaveSchema = z.object({
  customerId: z.number().int().positive(),
  locationId: z.number().int().positive(),
  billDate: isoDate("Bill date"),
  gstMode: z.enum(["ADD", "INCLUDES"]),
  gstOverride: signedAmountStr.nullable(), // ADD mode only
  roundOff: signedAmountStr.nullable(),
  lines: z
    .array(
      z.object({
        productId: z.number().int().positive(),
        qty: z.number().int().min(1, "Qty must be at least 1").max(100000),
        rate: z.string().trim().regex(/^\d{1,10}(\.\d{1,2})?$/, "Invalid price"),
      }),
    )
    .min(1, "Add at least one item")
    .max(500),
  payment: paymentInputSchema,
  /** Net payable the cashier saw — the save is refused if the server's figure differs. */
  expectedNet: signedAmountStr,
});
export type SaleSaveInput = z.input<typeof saleSaveSchema>;

export const receiptSaveSchema = z.object({
  customerId: z.number().int().positive(),
  locationId: z.number().int().positive(),
  receiptDate: isoDate("Receipt date"),
  payment: paymentInputSchema,
  remarks: optional(300),
});
export type ReceiptSaveInput = z.input<typeof receiptSaveSchema>;

/** INV/25-26/0001 — same shape as GRN numbers. */
export function formatDocNo(s: { prefix: string; digits: number }, fy: string, n: number) {
  return `${s.prefix}/${fy}/${String(n).padStart(s.digits, "0")}`;
}

/** Signed balance (+ = Dr / to receive, − = Cr / advance) as shown on screen. */
export function balanceLabel(paise: number): { side: "DR" | "CR" | "NIL"; text: string } {
  if (paise === 0) return { side: "NIL", text: "Nil" };
  return paise > 0 ? { side: "DR", text: "Dr (To Receive)" } : { side: "CR", text: "Cr (Advance)" };
}
