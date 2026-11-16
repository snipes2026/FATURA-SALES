/** zod schema for Save Sales Return — shared by the return screen and the server action. */
import { z } from "zod";

const isoDate = (label: string) => z.string().regex(/^\d{4}-\d{2}-\d{2}$/, `${label}: enter a valid date`);
const amountStr = z
  .string()
  .trim()
  .transform((v) => v.replace(/,/g, ""))
  .refine((v) => v === "" || /^\d{1,10}(\.\d{1,2})?$/.test(v), "Enter an amount with up to 2 decimals");
const signedAmountStr = z.string().trim().regex(/^-?\d{1,10}(\.\d{1,2})?$/, "Enter an amount with up to 2 decimals");

export const returnSaveSchema = z.object({
  customerId: z.number().int().positive(),
  locationId: z.number().int().positive(),
  returnDate: isoDate("Return date"),
  againstSalesId: z.number().int().positive().nullable(),
  gstMode: z.enum(["ADD", "INCLUDES"]),
  gstOverride: signedAmountStr.nullable(), // ADD mode, free-form returns only
  roundOff: signedAmountStr.nullable(),
  lines: z
    .array(
      z.object({
        productId: z.number().int().positive(),
        qty: z.number().int().min(1, "Qty must be at least 1").max(100000),
        rate: z
          .string()
          .trim()
          .regex(/^\d{1,10}(\.\d{1,2})?$/, "Invalid rate")
          .refine((v) => Number(v) > 0, "Rate must be more than 0"),
        originalSalesLineId: z.number().int().positive().nullable(),
      }),
    )
    .min(1, "Add at least one item")
    .max(500),
  adjustment: z.object({
    /** null = default (linked bill first, then oldest first); otherwise due key → amount */
    manual: z.record(z.string().max(40), amountStr).nullable(),
    remainder: z.enum(["ADVANCE", "REFUND"]).nullable(),
    refundMode: z.enum(["CASH", "BANK1", "BANK2"]).nullable(),
  }),
  /** The user confirmed the amber return-quantity warning (Warn mode). */
  qtyConfirmed: z.boolean(),
  remarks: z
    .string()
    .trim()
    .max(300, "Too long (max 300)")
    .transform((v) => (v === "" ? null : v)),
  /** Net Return Value the user saw — the save is refused if the server's figure differs. */
  expectedNet: signedAmountStr,
});
export type ReturnSaveInput = z.input<typeof returnSaveSchema>;
