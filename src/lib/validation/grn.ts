/**
 * GRN header validation — shared by the entry screen and the server actions.
 * Dates are YYYY-MM-DD strings compared lexically (same format, so safe).
 */
import { z } from "zod";
import { todayIST } from "@/lib/dates";
import { priceOrderIssues } from "@/lib/grn-calc";
import { MONEY_RE, toPaise } from "@/lib/money";

const isoDate = (label: string) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required`)
    .regex(/^\d{4}-\d{2}-\d{2}$/, `${label} is not a valid date`)
    .refine((v) => !Number.isNaN(Date.parse(v)), `${label} is not a valid date`);

const optionalIsoDate = z
  .string()
  .trim()
  .refine((v) => v === "" || (/^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v))), "Not a valid date")
  .transform((v) => (v === "" ? null : v));

const requiredId = (label: string) =>
  z
    .string()
    .min(1, `Select ${label}`)
    .regex(/^\d+$/, `Select ${label}`)
    .transform(Number);

const optionalId = z
  .string()
  .regex(/^\d*$/)
  .transform((v) => (v === "" ? null : Number(v)));

/** Raw form values (all strings) as kept by the entry screen. */
export type GrnHeaderForm = {
  grnDate: string;
  locationId: string;
  supplierId: string;
  invoiceNo: string;
  invoiceDate: string;
  invoiceValue: string;
  transportId: string;
  lrNo: string;
  transportDate: string;
};

export function grnHeaderSchema(today: string = todayIST()) {
  return z
    .object({
      grnDate: isoDate("GRN date"),
      locationId: requiredId("the receiving location"),
      supplierId: requiredId("a supplier"),
      invoiceNo: z
        .string()
        .trim()
        .min(1, "Supplier invoice no. is required")
        .max(60, "Too long (max 60)")
        .regex(/^[A-Za-z0-9/\-_.# ]+$/, "Use letters, digits and / - _ . # only"),
      invoiceDate: isoDate("Invoice date"),
      invoiceValue: z
        .string()
        .transform(clean)
        .refine((v) => v !== "", "Invoice value is required")
        .refine((v) => v === "" || MONEY_RE.test(v), "Enter the bill amount (max 2 decimals)")
        .refine((v) => !MONEY_RE.test(v) || Number(v) > 0, "Invoice value must be more than 0"),
      transportId: optionalId,
      lrNo: z
        .string()
        .trim()
        .max(60, "Too long (max 60)")
        .transform((v) => (v === "" ? null : v)),
      transportDate: optionalIsoDate,
    })
    .superRefine((v, ctx) => {
      if (v.grnDate > today) ctx.addIssue({ code: "custom", path: ["grnDate"], message: "GRN date can't be in the future" });
      if (v.invoiceDate > today) ctx.addIssue({ code: "custom", path: ["invoiceDate"], message: "Invoice date can't be in the future" });
      else if (v.invoiceDate > v.grnDate)
        ctx.addIssue({ code: "custom", path: ["invoiceDate"], message: "Invoice date can't be after the GRN date" });
      if (v.transportDate && v.transportDate > today)
        ctx.addIssue({ code: "custom", path: ["transportDate"], message: "Transport date can't be in the future" });
      if (v.lrNo && !v.transportId) ctx.addIssue({ code: "custom", path: ["transportId"], message: "Select the transporter for this LR" });
    });
}

/** Draft save payload: header + lines (validated separately, they need category config) + summary + optimistic-lock version. */
export function grnDraftSchema(today?: string) {
  return z.object({
    id: z.number().int().positive().optional(),
    version: z.number().int().positive().optional(),
    header: grnHeaderSchema(today),
    lines: z.array(z.unknown()).max(MAX_LINES, `A GRN can have at most ${MAX_LINES} lines`).default([]),
    summary: grnSummarySchema,
  });
}

// ------------------------------------------------------------ summary (discount, GST, charges, round off)

export type OtherChargeForm = { uid: string; description: string; amount: string };
export type GrnSummaryForm = {
  discountType: "PERCENT" | "AMOUNT";
  discountValue: string;
  gstMode: "PERCENT" | "AMOUNT";
  gstValue: string; // blank = 0 (purchases without GST)
  transport: string; // no GST
  otherCharges: OtherChargeForm[]; // no GST, amounts may be negative
  roundOffManual: boolean;
  roundOff: string;
  remarks: string;
};

export const emptySummary = (): GrnSummaryForm => ({
  discountType: "PERCENT",
  discountValue: "",
  gstMode: "PERCENT",
  gstValue: "",
  transport: "",
  otherCharges: [],
  roundOffManual: false,
  roundOff: "0.00",
  remarks: "",
});

/** Round off may be typed by hand, but only within ±₹10. */
export const MAX_ROUND_OFF = 10;
export const MAX_OTHER_CHARGES = 20;
const SIGNED_MONEY_RE = /^-?\d{1,10}(\.\d{1,2})?$/;
const clean = (v: string) => v.trim().replace(/,/g, "");

export const grnSummarySchema = z
  .object({
    discountType: z.enum(["PERCENT", "AMOUNT"]),
    discountValue: z.string().transform(clean),
    gstMode: z.enum(["PERCENT", "AMOUNT"]),
    gstValue: z.string().transform(clean),
    transport: z
      .string()
      .transform(clean)
      .refine((v) => v === "" || MONEY_RE.test(v), "Transport: enter an amount (max 2 decimals)"),
    otherCharges: z
      .array(
        z.object({
          uid: z.string().max(64),
          description: z.string().trim().max(100, "Max 100 characters"),
          amount: z.string().transform(clean),
        }),
      )
      .max(MAX_OTHER_CHARGES, `At most ${MAX_OTHER_CHARGES} other charges`),
    roundOffManual: z.boolean(),
    roundOff: z.string().trim(),
    remarks: z.string().trim().max(1000, "Remarks: max 1000 characters"),
  })
  .superRefine((v, ctx) => {
    if (v.discountValue !== "") {
      if (!MONEY_RE.test(v.discountValue)) ctx.addIssue({ code: "custom", path: ["discountValue"], message: "Enter a number (max 2 decimals)" });
      else if (v.discountType === "PERCENT" && Number(v.discountValue) > 100)
        ctx.addIssue({ code: "custom", path: ["discountValue"], message: "Discount can't be more than 100%" });
    }
    if (v.gstValue !== "") {
      if (!MONEY_RE.test(v.gstValue)) ctx.addIssue({ code: "custom", path: ["gstValue"], message: "Enter a number (max 2 decimals)" });
      else if (v.gstMode === "PERCENT" && Number(v.gstValue) > 100)
        ctx.addIssue({ code: "custom", path: ["gstValue"], message: "GST can't be more than 100%" });
    }
    v.otherCharges.forEach((o, i) => {
      if (o.description === "" && o.amount === "") return; // empty row — ignored
      if (o.description === "") ctx.addIssue({ code: "custom", path: ["otherCharges", i, "description"], message: "Enter a description" });
      if (o.amount === "") ctx.addIssue({ code: "custom", path: ["otherCharges", i, "amount"], message: "Enter an amount" });
      else if (!SIGNED_MONEY_RE.test(o.amount))
        ctx.addIssue({ code: "custom", path: ["otherCharges", i, "amount"], message: "Enter an amount like 150 or -200.50" });
    });
    if (v.roundOffManual) {
      if (!/^-?\d{1,2}(\.\d{1,2})?$/.test(v.roundOff)) ctx.addIssue({ code: "custom", path: ["roundOff"], message: "Enter an amount like 0.40 or -0.60" });
      else if (Math.abs(Number(v.roundOff)) > MAX_ROUND_OFF)
        ctx.addIssue({ code: "custom", path: ["roundOff"], message: `Round off must be within ±₹${MAX_ROUND_OFF}` });
    }
  });
export type GrnSummaryParsed = z.output<typeof grnSummarySchema>;

/** Paise from a possibly half-typed field (invalid -> 0), so live totals never show NaN. */
const safePaise = (v: string, signed = false) => {
  const s = clean(v);
  return (signed ? SIGNED_MONEY_RE : MONEY_RE).test(s) ? toPaise(s) : 0;
};

/** Other-charge rows that count (empty rows are ignored). */
export const filledOtherCharges = (rows: OtherChargeForm[]) =>
  rows.filter((o) => o.description.trim() !== "" || clean(o.amount) !== "").map((o) => ({ description: o.description.trim(), amount: safePaise(o.amount, true) }));

/** Summary form -> calcGrn options (shared by the screen and the server). */
export function summaryCalcOptions(s: GrnSummaryForm) {
  return {
    discountType: s.discountType,
    discountValue: MONEY_RE.test(clean(s.discountValue)) ? clean(s.discountValue) : "0",
    gstMode: s.gstMode,
    gstValue: MONEY_RE.test(clean(s.gstValue)) ? clean(s.gstValue) : "0",
    transport: safePaise(s.transport),
    others: filledOtherCharges(s.otherCharges),
    roundOffManual: s.roundOffManual,
    roundOffPaise: s.roundOffManual ? safePaise(s.roundOff, true) : 0,
  };
}
export const MAX_LINES = 500;

// ------------------------------------------------------------ item lines

export type CategoryMode = "MANDATORY" | "OPTIONAL" | "HIDDEN";
export type CatCfg = { slot: number; label: string; mode: CategoryMode };

/** One item line as kept by the entry screen (strings, like the form). */
export type GrnLineForm = {
  uid: string; // client-side key
  id?: number; // grn_lines.id once saved
  departmentId: string;
  itemName: string;
  cat1: string;
  cat2: string;
  cat3: string;
  cat4: string;
  qty: string;
  purchaseRate: string;
  wsp: string;
  rsp: string;
  mrp: string;
  imagePath: string | null;
  priceWarningOverridden: boolean;
  barcode?: string | null; // read-only, set by barcode generation (Step 6)
};

export const IMAGE_PATH_RE = /^products\/[0-9a-f-]{36}\.(jpg|png|webp)$/;

const moneyField = (label: string, required: boolean) =>
  z
    .string()
    .trim()
    .transform((v) => v.replace(/,/g, ""))
    .superRefine((v, ctx) => {
      if (v === "") {
        if (required) ctx.addIssue({ code: "custom", message: `${label} is required` });
      } else if (!MONEY_RE.test(v)) ctx.addIssue({ code: "custom", message: `${label}: enter an amount (max 2 decimals)` });
    });

const catField = z.string().regex(/^\d*$/, "Invalid value");

export function grnLineSchema(cats: CatCfg[]) {
  const modeOf = (slot: number) => cats.find((c) => c.slot === slot)?.mode ?? "HIDDEN";
  const toCat = (slot: number, v: string) => (modeOf(slot) === "HIDDEN" || v === "" ? null : Number(v));
  return z
    .object({
      uid: z.string().min(1).max(64),
      id: z.number().int().positive().optional(),
      departmentId: requiredId("a department"),
      itemName: z.string().trim().min(1, "Item name is required").max(200, "Too long (max 200)"),
      cat1: catField,
      cat2: catField,
      cat3: catField,
      cat4: catField,
      qty: z
        .string()
        .trim()
        .min(1, "Qty is required")
        .regex(/^\d+$/, "Qty must be a whole number")
        .transform(Number)
        .refine((n) => n >= 1 && n <= 999_999, "Qty must be 1 to 9,99,999"),
      purchaseRate: moneyField("Purchase rate", true),
      wsp: moneyField("WSP", false),
      rsp: moneyField("RSP", false),
      mrp: moneyField("MRP", true).refine((v) => v === "" || Number(v) > 0, "MRP must be more than 0"),
      imagePath: z.string().regex(IMAGE_PATH_RE, "Invalid image").nullable(),
      priceWarningOverridden: z.boolean(),
      barcode: z.string().nullable().optional(),
    })
    .superRefine((v, ctx) => {
      for (const c of cats) {
        const key = `cat${c.slot}` as "cat1" | "cat2" | "cat3" | "cat4";
        if (c.mode === "MANDATORY" && !v[key]) ctx.addIssue({ code: "custom", path: [key], message: `Select ${c.label}` });
      }
      const issues = priceOrderIssues({ purchaseRate: v.purchaseRate, wsp: v.wsp, rsp: v.rsp, mrp: v.mrp });
      if (issues.length && !v.priceWarningOverridden)
        ctx.addIssue({ code: "custom", path: ["mrp"], message: `${issues[0]} — confirm to override` });
    })
    .transform((v) => ({
      ...v,
      cat1: toCat(1, v.cat1),
      cat2: toCat(2, v.cat2),
      cat3: toCat(3, v.cat3),
      cat4: toCat(4, v.cat4),
      wsp: v.wsp === "" ? null : v.wsp,
      rsp: v.rsp === "" ? null : v.rsp,
    }));
}
export type GrnLineParsed = z.output<ReturnType<typeof grnLineSchema>>;

/** Same supplier + invoice no. is considered a duplicate regardless of case / spaces. */
export const normalizeInvoiceNo = (v: string) => v.trim().toUpperCase();
