/**
 * zod schemas for Settings masters — shared by the client forms and the
 * server actions. Inputs are the raw form values (strings / booleans);
 * outputs are normalised for the database ('' -> null, upper-cased GSTIN, …).
 */
import { z } from "zod";
import { GST_RATES, GST_STATES, isValidGstin, PAN_REGEX } from "@/lib/india";

// ------------------------------------------------------------ primitives
const required = (label: string, max: number) =>
  z.string().trim().min(1, `${label} is required`).max(max, `${label} is too long (max ${max})`);

const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Too long (max ${max})`)
    .transform((v) => (v === "" ? null : v));

const gstinOptional = z
  .string()
  .trim()
  .toUpperCase()
  .refine((v) => v === "" || isValidGstin(v), "Invalid GSTIN (15 characters, check digit must match)")
  .transform((v) => (v === "" ? null : v));

const stateCode = z.string().refine((v) => !!GST_STATES[v], "Select a state");

const phoneOptional = z
  .string()
  .trim()
  .refine((v) => v === "" || /^[0-9+\-\s()]{6,20}$/.test(v), "Enter a valid phone number")
  .transform((v) => (v === "" ? null : v));

const emailOptional = z
  .string()
  .trim()
  .toLowerCase()
  .refine((v) => v === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), "Enter a valid email")
  .transform((v) => (v === "" ? null : v));

const panOptional = z
  .string()
  .trim()
  .toUpperCase()
  .refine((v) => v === "" || PAN_REGEX.test(v), "Invalid PAN (e.g. ABCDE1234F)")
  .transform((v) => (v === "" ? null : v));

/** Money as a string so it never goes through floating point. */
const moneyString = (label: string, { allowNegative = false } = {}) =>
  z
    .string()
    .trim()
    .transform((v) => (v === "" ? "0" : v.replace(/,/g, "")))
    .refine((v) => (allowNegative ? /^-?\d{1,12}(\.\d{1,2})?$/ : /^\d{1,12}(\.\d{1,2})?$/).test(v), `${label}: enter an amount with up to 2 decimals`);

const intString = (label: string, min: number, max: number) =>
  z
    .string()
    .trim()
    .regex(/^\d+$/, `${label} must be a whole number`)
    .transform(Number)
    .refine((n) => n >= min && n <= max, `${label} must be between ${min} and ${max}`);

const gstRateString = z
  .string()
  .refine((v) => v !== "" && (GST_RATES as readonly number[]).includes(Number(v)), "Select a GST rate");

const id = z.number().int().positive().optional();

// ------------------------------------------------------------ company
export const companySchema = z
  .object({
    name: required("Company name", 160),
    address: optional(500),
    gstin: gstinOptional,
    stateCode: z.string().transform((v) => (v === "" ? null : v)),
    phone: phoneOptional,
    email: emailOptional,
  })
  .superRefine((v, ctx) => {
    if (v.stateCode && !GST_STATES[v.stateCode]) ctx.addIssue({ code: "custom", path: ["stateCode"], message: "Select a state" });
    if (v.gstin && v.stateCode && v.gstin.slice(0, 2) !== v.stateCode)
      ctx.addIssue({ code: "custom", path: ["stateCode"], message: "State must match the GSTIN" });
  });

// ------------------------------------------------------------ supplier
export const supplierSchema = z
  .object({
    id,
    name: required("Supplier name", 160),
    gstin: gstinOptional,
    stateCode,
    address: optional(500),
    contactPerson: optional(120),
    phone: phoneOptional,
    email: emailOptional,
    pan: panOptional,
    openingBalance: moneyString("Opening balance", { allowNegative: true }),
    isActive: z.boolean(),
  })
  .superRefine((v, ctx) => {
    if (v.gstin && v.gstin.slice(0, 2) !== v.stateCode)
      ctx.addIssue({ code: "custom", path: ["stateCode"], message: "State must match the GSTIN" });
    if (v.gstin && v.pan && v.gstin.slice(2, 12) !== v.pan)
      ctx.addIssue({ code: "custom", path: ["pan"], message: "PAN doesn't match the GSTIN" });
  });
export type SupplierInput = z.input<typeof supplierSchema>;

// ------------------------------------------------------------ transport
export const transportSchema = z.object({
  id,
  name: required("Transporter name", 160),
  gstin: gstinOptional,
  phone: phoneOptional,
  isActive: z.boolean(),
});
export type TransportInput = z.input<typeof transportSchema>;

// ------------------------------------------------------------ department
export const departmentSchema = z
  .object({
    id,
    name: required("Department name", 120),
    hsnCode: z.string().trim().regex(/^(\d{4}|\d{6}|\d{8})$/, "HSN code must be 4, 6 or 8 digits"),
    gstRate: gstRateString,
    slabEnabled: z.boolean(),
    slabThreshold: z.string().trim(),
    slabRateAbove: z.string(),
    isActive: z.boolean(),
  })
  .superRefine((v, ctx) => {
    if (!v.slabEnabled) return;
    if (!/^\d{1,12}(\.\d{1,2})?$/.test(v.slabThreshold) || Number(v.slabThreshold) <= 0)
      ctx.addIssue({ code: "custom", path: ["slabThreshold"], message: "Enter the price limit (₹)" });
    if (v.slabRateAbove === "" || !(GST_RATES as readonly number[]).includes(Number(v.slabRateAbove)))
      ctx.addIssue({ code: "custom", path: ["slabRateAbove"], message: "Select the rate above the limit" });
    else if (Number(v.slabRateAbove) === Number(v.gstRate))
      ctx.addIssue({ code: "custom", path: ["slabRateAbove"], message: "Must differ from the base rate" });
  })
  .transform((v) => ({
    ...v,
    slabThreshold: v.slabEnabled ? v.slabThreshold : null,
    slabRateAbove: v.slabEnabled ? v.slabRateAbove : null,
  }));
export type DepartmentInput = z.input<typeof departmentSchema>;

// ------------------------------------------------------------ categories
export const CATEGORY_MODES = ["MANDATORY", "OPTIONAL", "HIDDEN"] as const;

export const categoryConfigSchema = z
  .object({
    slots: z
      .array(
        z.object({
          slot: z.number().int().min(1).max(4),
          label: required("Label", 40),
          mode: z.enum(CATEGORY_MODES),
        }),
      )
      .length(4),
  })
  .superRefine((v, ctx) => {
    const seen = new Map<string, number>();
    v.slots.forEach((s, i) => {
      const key = s.label.toLowerCase();
      if (seen.has(key)) ctx.addIssue({ code: "custom", path: ["slots", i, "label"], message: "Labels must be different" });
      seen.set(key, i);
    });
  });
export type CategoryConfigInput = z.input<typeof categoryConfigSchema>;

export const categoryValueSchema = z.object({
  id,
  slot: z.number().int().min(1).max(4),
  value: required("Value", 60),
  isActive: z.boolean(),
});
export type CategoryValueInput = z.input<typeof categoryValueSchema>;

// ------------------------------------------------------------ barcode
export const LABEL_FIELDS = [
  { key: "itemName", label: "Item name" },
  { key: "mrp", label: "MRP" },
  { key: "rsp", label: "RSP" },
  { key: "cat1", label: "Category 1" },
  { key: "cat2", label: "Category 2" },
  { key: "cat3", label: "Category 3" },
  { key: "cat4", label: "Category 4" },
  { key: "barcodeText", label: "Barcode text" },
] as const;
export type LabelFieldKey = (typeof LABEL_FIELDS)[number]["key"];

const codeAffix = (label: string) =>
  z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{0,10}$/, `${label}: letters and digits only (max 10)`);

export const barcodeSettingsSchema = z
  .object({
    prefix: codeAffix("Prefix"),
    suffix: codeAffix("Suffix"),
    digits: intString("Digits", 3, 12),
    startNumber: intString("Starting number", 1, 999_999_999),
    labelSize: z.enum(["50x25", "38x25"]),
    labelFields: z.array(z.enum(LABEL_FIELDS.map((f) => f.key) as [LabelFieldKey, ...LabelFieldKey[]])).min(1, "Pick at least one field"),
    labelsPerRow: intString("Labels per row", 1, 6),
  })
  .superRefine((v, ctx) => {
    if (String(v.startNumber).length > v.digits)
      ctx.addIssue({ code: "custom", path: ["startNumber"], message: `Doesn't fit in ${v.digits} digits` });
  });
export type BarcodeSettingsInput = z.input<typeof barcodeSettingsSchema>;

export function formatBarcode(s: { prefix: string; suffix: string; digits: number }, n: number) {
  return `${s.prefix}${String(n).padStart(s.digits, "0")}${s.suffix}`;
}

// ------------------------------------------------------------ GRN numbering
export const grnNumberSettingsSchema = z.object({
  prefix: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]{1,20}$/, "Letters, digits and '-' only (1–20)"),
  digits: intString("Digits", 3, 8),
});
export type GrnNumberSettingsInput = z.input<typeof grnNumberSettingsSchema>;

export function formatGrnNo(s: { prefix: string; digits: number }, fy: string, n: number) {
  return `${s.prefix}/${fy}/${String(n).padStart(s.digits, "0")}`;
}

// ------------------------------------------------------------ location
export const locationSchema = z
  .object({
    id,
    name: required("Location name", 120),
    type: z.enum(["STORE", "GODOWN"], { error: "Select a type" }),
    gstin: gstinOptional,
    stateCode,
    address: optional(500),
    isActive: z.boolean(),
  })
  .superRefine((v, ctx) => {
    if (v.gstin && v.gstin.slice(0, 2) !== v.stateCode)
      ctx.addIssue({ code: "custom", path: ["stateCode"], message: "State must match the GSTIN" });
  });
export type LocationInput = z.input<typeof locationSchema>;

// ------------------------------------------------------------ user
export const userSchema = z
  .object({
    id,
    name: required("Name", 120),
    username: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9._-]{3,60}$/, "3–60 characters: letters, digits, '.', '_' or '-'"),
    roleId: z.number({ error: "Select a role" }).int().positive("Select a role"),
    locationIds: z.array(z.number().int().positive()).min(1, "Allow at least one location"),
    isActive: z.boolean(),
    password: z.string().max(200),
  })
  .superRefine((v, ctx) => {
    if (!v.id && v.password.length === 0) ctx.addIssue({ code: "custom", path: ["password"], message: "Password is required" });
    else if (v.password.length > 0 && v.password.length < 8)
      ctx.addIssue({ code: "custom", path: ["password"], message: "At least 8 characters" });
  });
export type UserInput = z.input<typeof userSchema>;
