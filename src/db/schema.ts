/**
 * Fatura Desk — database schema (Drizzle ORM, PostgreSQL 16).
 *
 * Shared masters (locations, suppliers, departments, categories, products,
 * stock_ledger, counters, audit_log) are designed to be reused by the later
 * Sales, Sales Return, Transfer and Accounts modules.
 *
 * Conventions
 *  - Money: NUMERIC(14,2)  (returned as string by node-postgres — never float)
 *  - Quantity: INTEGER
 *  - Timestamps: TIMESTAMPTZ (displayed in Asia/Kolkata)
 *
 * NOTE: the pg_trgm extension, the products(item_name) trigram index and the
 * current_stock view live in a hand-written migration (drizzle/0001_*.sql)
 * because drizzle-kit does not generate extensions.
 */
import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  char,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  serial,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------- helpers
const money = (name: string) => numeric(name, { precision: 14, scale: 2 });
const rate = (name: string) => numeric(name, { precision: 5, scale: 2 });
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

// ---------------------------------------------------------------- enums
export const locationTypeEnum = pgEnum("location_type", ["STORE", "GODOWN"]);
export const categoryModeEnum = pgEnum("category_mode", ["MANDATORY", "OPTIONAL", "HIDDEN"]);
export const grnStatusEnum = pgEnum("grn_status", ["DRAFT", "SAVED", "CANCELLED"]);
export const discountTypeEnum = pgEnum("discount_type", ["PERCENT", "AMOUNT"]);
export const taxTypeEnum = pgEnum("tax_type", ["INTRA", "INTER"]); // CGST+SGST vs IGST
export const chargeTypeEnum = pgEnum("charge_type", ["FREIGHT", "OTHER"]); // FREIGHT = Transport / Freight
export const gstModeEnum = pgEnum("gst_mode", ["PERCENT", "AMOUNT"]); // GRN GST: % of taxable value, or a ₹ amount
export const labelSizeEnum = pgEnum("label_size", ["50x25", "38x25"]);
export const auditActionEnum = pgEnum("audit_action", ["CREATE", "UPDATE", "DELETE", "CANCEL", "LOGIN"]);
// Sales
export const drCrEnum = pgEnum("dr_cr", ["DR", "CR"]);
export const saleStatusEnum = pgEnum("sale_status", ["SAVED", "CANCELLED"]);
export const saleGstModeEnum = pgEnum("sale_gst_mode", ["ADD", "INCLUDES"]); // GST on top of WSP vs WSP includes GST
export const payModeEnum = pgEnum("pay_mode", ["CASH", "BANK1", "BANK2"]);
export const receiptSourceEnum = pgEnum("receipt_source", ["SALE", "STANDALONE"]);
export const receiptStatusEnum = pgEnum("receipt_status", ["SAVED", "CANCELLED"]);
export const allocTargetEnum = pgEnum("alloc_target", ["BILL", "OPENING", "ADVANCE"]);
export const voucherTypeEnum = pgEnum("voucher_type", [
  "OPENING",
  "SALE",
  "RECEIPT",
  "ADVANCE",
  "SETTLEMENT",
  "SALE_CANCEL",
  "RECEIPT_CANCEL",
  "REFUND",
  "SALES_RETURN",
  "SALES_RETURN_CANCEL",
  "REFUND_CANCEL",
]);
export const cashDirectionEnum = pgEnum("cash_direction", ["IN", "OUT"]);
export const printFormatEnum = pgEnum("print_format", ["A4", "THERMAL80"]);
// Credit pool (advances, return credit) and Sales Return
export const creditSourceEnum = pgEnum("credit_source", ["OPENING_CR", "ADVANCE", "SALES_RETURN"]);
export const creditTargetEnum = pgEnum("credit_target", ["BILL", "OPENING", "REFUND"]);
export const returnQtyCheckEnum = pgEnum("return_qty_check", ["OFF", "WARN", "BLOCK"]);

// ---------------------------------------------------------------- users & roles
export const roles = pgTable("roles", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 32 }).notNull().unique(), // ADMIN | GRN_ENTRY | VIEWER
  name: varchar("name", { length: 64 }).notNull(),
});

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 120 }).notNull(),
  username: varchar("username", { length: 60 }).notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  roleId: integer("role_id").notNull().references(() => roles.id),
  isActive: boolean("is_active").notNull().default(true),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const locations = pgTable("locations", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 120 }).notNull().unique(),
  type: locationTypeEnum("type").notNull(),
  gstin: varchar("gstin", { length: 15 }),
  stateCode: char("state_code", { length: 2 }).notNull(), // GST state code, e.g. "27"
  address: text("address"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const userLocations = pgTable(
  "user_locations",
  {
    userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    locationId: integer("location_id").notNull().references(() => locations.id),
  },
  (t) => [primaryKey({ columns: [t.userId, t.locationId] })],
);

// ---------------------------------------------------------------- settings (single-row tables, id = 1)
export const companyProfile = pgTable(
  "company_profile",
  {
    id: smallint("id").primaryKey().default(1),
    name: varchar("name", { length: 160 }).notNull(),
    address: text("address"),
    gstin: varchar("gstin", { length: 15 }),
    stateCode: char("state_code", { length: 2 }),
    phone: varchar("phone", { length: 30 }),
    email: varchar("email", { length: 120 }),
    logoPath: text("logo_path"),
    updatedAt: updatedAt(),
  },
  (t) => [check("company_profile_single_row", sql`${t.id} = 1`)],
);

export const barcodeSettings = pgTable(
  "barcode_settings",
  {
    id: smallint("id").primaryKey().default(1),
    prefix: varchar("prefix", { length: 10 }).notNull().default(""),
    suffix: varchar("suffix", { length: 10 }).notNull().default(""),
    digits: smallint("digits").notNull().default(6),
    startNumber: integer("start_number").notNull().default(1),
    symbology: varchar("symbology", { length: 20 }).notNull().default("CODE128"),
    labelSize: labelSizeEnum("label_size").notNull().default("50x25"),
    // e.g. ["itemName","mrp","rsp","size","color","barcodeText"]
    labelFields: jsonb("label_fields").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    labelsPerRow: smallint("labels_per_row").notNull().default(1),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("barcode_settings_single_row", sql`${t.id} = 1`),
    check("barcode_settings_digits", sql`${t.digits} between 3 and 12`),
  ],
);

export const grnNumberSettings = pgTable(
  "grn_number_settings",
  {
    id: smallint("id").primaryKey().default(1),
    prefix: varchar("prefix", { length: 20 }).notNull().default("GRN"),
    digits: smallint("digits").notNull().default(4),
    updatedAt: updatedAt(),
  },
  (t) => [check("grn_number_settings_single_row", sql`${t.id} = 1`)],
);

// ---------------------------------------------------------------- masters
export const suppliers = pgTable(
  "suppliers",
  {
    id: serial("id").primaryKey(),
    name: varchar("name", { length: 160 }).notNull(),
    gstin: varchar("gstin", { length: 15 }),
    stateCode: char("state_code", { length: 2 }).notNull(),
    address: text("address"),
    contactPerson: varchar("contact_person", { length: 120 }),
    phone: varchar("phone", { length: 30 }),
    email: varchar("email", { length: 120 }),
    pan: varchar("pan", { length: 10 }),
    openingBalance: money("opening_balance").notNull().default("0"),
    isActive: boolean("is_active").notNull().default(true),
    createdBy: integer("created_by").references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("suppliers_gstin_uq").on(t.gstin).where(sql`${t.gstin} is not null`),
    index("suppliers_name_idx").on(t.name),
  ],
);

export const transports = pgTable("transports", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 160 }).notNull().unique(),
  gstin: varchar("gstin", { length: 15 }),
  phone: varchar("phone", { length: 30 }),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const departments = pgTable(
  "departments",
  {
    id: serial("id").primaryKey(),
    name: varchar("name", { length: 120 }).notNull().unique(),
    hsnCode: varchar("hsn_code", { length: 8 }).notNull(),
    gstRate: rate("gst_rate").notNull(),
    // Optional price-based slab: if unit rate <= slabThreshold -> gstRate, else slabRateAbove
    slabEnabled: boolean("slab_enabled").notNull().default(false),
    slabThreshold: money("slab_threshold"),
    slabRateAbove: rate("slab_rate_above"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("departments_hsn_format", sql`${t.hsnCode} ~ '^([0-9]{4}|[0-9]{6}|[0-9]{8})$'`),
    check(
      "departments_slab_complete",
      sql`not ${t.slabEnabled} or (${t.slabThreshold} is not null and ${t.slabRateAbove} is not null)`,
    ),
  ],
);

/** Four configurable category slots (1–4), e.g. Style / Color / Size / Type. */
export const categoryConfig = pgTable(
  "category_config",
  {
    slot: smallint("slot").primaryKey(),
    label: varchar("label", { length: 40 }).notNull(),
    mode: categoryModeEnum("mode").notNull().default("OPTIONAL"),
    updatedAt: updatedAt(),
  },
  (t) => [check("category_config_slot", sql`${t.slot} between 1 and 4`)],
);

export const categoryValues = pgTable(
  "category_values",
  {
    id: serial("id").primaryKey(),
    slot: smallint("slot").notNull().references(() => categoryConfig.slot),
    value: varchar("value", { length: 60 }).notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdBy: integer("created_by").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("category_values_slot_value_uq").on(t.slot, sql`lower(${t.value})`)],
);

// ---------------------------------------------------------------- products (one row per barcode)
/**
 * One row per barcode. Created when a barcode is generated for a GRN line —
 * every GRN line gets its own new barcode (never reused, not even for an
 * identical item), so the same item can have many rows. Sales / Returns
 * look items up by barcode.
 */
export const products = pgTable(
  "products",
  {
    id: serial("id").primaryKey(),
    departmentId: integer("department_id").notNull().references(() => departments.id),
    itemName: varchar("item_name", { length: 200 }).notNull(),
    cat1ValueId: integer("cat1_value_id").references(() => categoryValues.id),
    cat2ValueId: integer("cat2_value_id").references(() => categoryValues.id),
    cat3ValueId: integer("cat3_value_id").references(() => categoryValues.id),
    cat4ValueId: integer("cat4_value_id").references(() => categoryValues.id),
    barcode: varchar("barcode", { length: 40 }).notNull().unique(),
    purchaseRate: money("purchase_rate").notNull(), // latest purchase rate (excl. GST)
    wsp: money("wsp"),
    rsp: money("rsp"),
    mrp: money("mrp").notNull(),
    imagePath: text("image_path"),
    isActive: boolean("is_active").notNull().default(true),
    createdBy: integer("created_by").references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("products_department_idx").on(t.departmentId),
    check("products_mrp_positive", sql`${t.mrp} > 0`),
  ],
);

// ---------------------------------------------------------------- GRN
export const grnHeader = pgTable(
  "grn_header",
  {
    id: serial("id").primaryKey(),
    grnNo: varchar("grn_no", { length: 40 }).unique(), // null while DRAFT; assigned on Save
    fy: varchar("fy", { length: 5 }), // "25-26"
    grnDate: date("grn_date").notNull(),
    status: grnStatusEnum("status").notNull().default("DRAFT"),
    locationId: integer("location_id").notNull().references(() => locations.id),
    supplierId: integer("supplier_id").notNull().references(() => suppliers.id),
    invoiceNo: varchar("invoice_no", { length: 60 }).notNull(),
    invoiceDate: date("invoice_date").notNull(),
    invoiceValue: money("invoice_value").notNull(), // total printed on the supplier's bill; must equal net payable on Save GRN
    transportId: integer("transport_id").references(() => transports.id),
    lrNo: varchar("lr_no", { length: 60 }),
    transportDate: date("transport_date"),
    taxType: taxTypeEnum("tax_type").notNull().default("INTRA"),

    totalQty: integer("total_qty").notNull().default(0),
    grossAmount: money("gross_amount").notNull().default("0"),
    discountType: discountTypeEnum("discount_type").notNull().default("PERCENT"),
    discountValue: money("discount_value").notNull().default("0"),
    discountAmount: money("discount_amount").notNull().default("0"),
    taxableValue: money("taxable_value").notNull().default("0"),
    // GST is entered once for the whole bill (not per item): % of taxable value or a ₹ amount.
    gstMode: gstModeEnum("gst_mode").notNull().default("PERCENT"),
    gstInput: money("gst_input").notNull().default("0"), // the % or ₹ the user typed
    gstAmount: money("gst_amount").notNull().default("0"),
    // Split of gst_amount: same state -> CGST + SGST (50% each), different state -> IGST.
    cgstAmount: money("cgst_amount").notNull().default("0"),
    sgstAmount: money("sgst_amount").notNull().default("0"),
    igstAmount: money("igst_amount").notNull().default("0"),
    chargesAmount: money("charges_amount").notNull().default("0"), // transport + all other-charge rows (no GST)
    roundOff: money("round_off").notNull().default("0"),
    roundOffManual: boolean("round_off_manual").notNull().default(false), // true = user typed the round off
    netPayable: money("net_payable").notNull().default("0"),
    supplierInvoiceTotal: money("supplier_invoice_total"),
    remarks: text("remarks"),

    cancelReason: text("cancel_reason"),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelledBy: integer("cancelled_by").references(() => users.id),
    savedAt: timestamp("saved_at", { withTimezone: true }),

    version: integer("version").notNull().default(1), // optimistic locking
    createdBy: integer("created_by").notNull().references(() => users.id),
    updatedBy: integer("updated_by").references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // Same supplier + invoice no. can't be entered twice (cancelled GRNs excluded so the
    // invoice can be re-entered after a delete). Case/space-insensitive.
    uniqueIndex("grn_header_supplier_invoice_uq")
      .on(t.supplierId, sql`upper(trim(${t.invoiceNo}))`)
      .where(sql`${t.status} <> 'CANCELLED'`),
    index("grn_header_grn_date_idx").on(t.grnDate),
    index("grn_header_supplier_idx").on(t.supplierId),
    index("grn_header_location_idx").on(t.locationId),
    index("grn_header_status_idx").on(t.status),
    // A saved GRN always has a number; drafts (and drafts that were cancelled) may not.
    check("grn_header_saved_has_no", sql`${t.status} <> 'SAVED' or ${t.grnNo} is not null`),
  ],
);

export const grnLines = pgTable(
  "grn_lines",
  {
    id: serial("id").primaryKey(),
    grnId: integer("grn_id").notNull().references(() => grnHeader.id, { onDelete: "cascade" }),
    lineNo: integer("line_no").notNull(),
    productId: integer("product_id").references(() => products.id), // set at barcode generation
    departmentId: integer("department_id").notNull().references(() => departments.id),
    hsnCode: varchar("hsn_code", { length: 8 }).notNull(),
    itemName: varchar("item_name", { length: 200 }).notNull(),
    cat1ValueId: integer("cat1_value_id").references(() => categoryValues.id),
    cat2ValueId: integer("cat2_value_id").references(() => categoryValues.id),
    cat3ValueId: integer("cat3_value_id").references(() => categoryValues.id),
    cat4ValueId: integer("cat4_value_id").references(() => categoryValues.id),
    qty: integer("qty").notNull(),
    purchaseRate: money("purchase_rate").notNull(),
    amount: money("amount").notNull(), // qty * rate
    discountAmount: money("discount_amount").notNull().default("0"), // share of header discount
    taxableValue: money("taxable_value").notNull(),
    // Line-level GST is no longer calculated (GST is entered on the GRN summary). These columns are
    // kept, nullable, only so GRNs saved before that change keep their original per-line figures.
    gstRate: rate("gst_rate"),
    cgstAmount: money("cgst_amount"),
    sgstAmount: money("sgst_amount"),
    igstAmount: money("igst_amount"),
    gstAmount: money("gst_amount"),
    wsp: money("wsp"),
    rsp: money("rsp"),
    mrp: money("mrp").notNull(),
    barcode: varchar("barcode", { length: 40 }),
    imagePath: text("image_path"),
    priceWarningOverridden: boolean("price_warning_overridden").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("grn_lines_grn_line_uq").on(t.grnId, t.lineNo),
    // One barcode (product) belongs to exactly one GRN line — a barcode is never reused.
    uniqueIndex("grn_lines_product_uq").on(t.productId).where(sql`${t.productId} is not null`),
    check("grn_lines_qty_positive", sql`${t.qty} > 0`),
    check("grn_lines_rate_nonneg", sql`${t.purchaseRate} >= 0`),
  ],
);

export const grnCharges = pgTable(
  "grn_charges",
  {
    id: serial("id").primaryKey(),
    grnId: integer("grn_id").notNull().references(() => grnHeader.id, { onDelete: "cascade" }),
    chargeType: chargeTypeEnum("charge_type").notNull(),
    description: varchar("description", { length: 100 }),
    amount: money("amount").notNull().default("0"), // OTHER may be negative (e.g. an extra vendor discount)
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [index("grn_charges_grn_idx").on(t.grnId)],
);

// ---------------------------------------------------------------- stock
/**
 * Every stock movement in the system. GRN posts qty_in; Sales/Transfers/Returns
 * will post qty_out / qty_in later. Current stock = SUM(qty_in - qty_out),
 * see the `current_stock` view.
 */
export const stockLedger = pgTable(
  "stock_ledger",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    locationId: integer("location_id").notNull().references(() => locations.id),
    productId: integer("product_id").notNull().references(() => products.id),
    qtyIn: integer("qty_in").notNull().default(0),
    qtyOut: integer("qty_out").notNull().default(0),
    refDocType: varchar("ref_doc_type", { length: 20 }).notNull(), // GRN | GRN_CANCEL | SALE | ...
    refDocId: integer("ref_doc_id").notNull(),
    refLineId: integer("ref_line_id"),
    createdBy: integer("created_by").notNull().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    index("stock_ledger_product_location_idx").on(t.productId, t.locationId),
    index("stock_ledger_ref_idx").on(t.refDocType, t.refDocId),
    check("stock_ledger_qty_nonneg", sql`${t.qtyIn} >= 0 and ${t.qtyOut} >= 0`),
    check("stock_ledger_one_side", sql`${t.qtyIn} > 0 or ${t.qtyOut} > 0`),
  ],
);

// ---------------------------------------------------------------- sales: settings & customers
export const salesSettings = pgTable(
  "sales_settings",
  {
    id: smallint("id").primaryKey().default(1),
    allowPriceEdit: boolean("allow_price_edit").notNull().default(false),
    bank1Name: varchar("bank1_name", { length: 40 }).notNull().default("Bank 1"),
    bank2Name: varchar("bank2_name", { length: 40 }).notNull().default("Bank 2"),
    bank2Enabled: boolean("bank2_enabled").notNull().default(false),
    defaultGstMode: saleGstModeEnum("default_gst_mode").notNull().default("INCLUDES"),
    allowNegativeStock: boolean("allow_negative_stock").notNull().default(false),
    autoIncrementQty: boolean("auto_increment_qty").notNull().default(true),
    invoicePrefix: varchar("invoice_prefix", { length: 20 }).notNull().default("INV"),
    invoiceDigits: smallint("invoice_digits").notNull().default(4),
    receiptPrefix: varchar("receipt_prefix", { length: 20 }).notNull().default("RCT"),
    receiptDigits: smallint("receipt_digits").notNull().default(4),
    printFormat: printFormatEnum("print_format").notNull().default("A4"),
    walkinAllowCredit: boolean("walkin_allow_credit").notNull().default(false),
    walkinAllowAdvance: boolean("walkin_allow_advance").notNull().default(false),
    // Sales Return
    returnQtyCheck: returnQtyCheckEnum("return_qty_check").notNull().default("WARN"),
    returnPrefix: varchar("return_prefix", { length: 20 }).notNull().default("SR"),
    returnDigits: smallint("return_digits").notNull().default(4),
    returnPrintFormat: printFormatEnum("return_print_format").notNull().default("A4"),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("sales_settings_single_row", sql`${t.id} = 1`),
    check(
      "sales_settings_digits",
      sql`${t.invoiceDigits} between 3 and 8 and ${t.receiptDigits} between 3 and 8 and ${t.returnDigits} between 3 and 8`,
    ),
  ],
);

/**
 * Customers. The opening balance is also written to customer_ledger as an
 * OPENING entry (the customer's first "bill"); the ledger is the source of truth
 * for the balance.
 */
export const customers = pgTable(
  "customers",
  {
    id: serial("id").primaryKey(),
    name: varchar("name", { length: 160 }).notNull(),
    address: text("address"),
    gstin: varchar("gstin", { length: 15 }),
    stateCode: char("state_code", { length: 2 }).notNull(),
    phone: varchar("phone", { length: 30 }).notNull(),
    openingBalance: money("opening_balance").notNull().default("0"),
    openingType: drCrEnum("opening_type").notNull().default("DR"),
    openingDate: date("opening_date").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    isWalkin: boolean("is_walkin").notNull().default(false),
    createdBy: integer("created_by").references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("customers_gstin_uq").on(t.gstin).where(sql`${t.gstin} is not null`),
    uniqueIndex("customers_walkin_uq").on(t.isWalkin).where(sql`${t.isWalkin}`),
    index("customers_phone_idx").on(t.phone),
    check("customers_opening_nonneg", sql`${t.openingBalance} >= 0`),
    check("customers_walkin_no_opening", sql`not ${t.isWalkin} or ${t.openingBalance} = 0`),
  ],
);

// ---------------------------------------------------------------- sales
export const salesHeader = pgTable(
  "sales_header",
  {
    id: serial("id").primaryKey(),
    billNo: varchar("bill_no", { length: 40 }).notNull().unique(),
    fy: varchar("fy", { length: 5 }).notNull(),
    billDate: date("bill_date").notNull(),
    customerId: integer("customer_id").notNull().references(() => customers.id),
    locationId: integer("location_id").notNull().references(() => locations.id),
    // Snapshot of the customer as printed on the invoice
    customerName: varchar("customer_name", { length: 160 }).notNull(),
    customerGstin: varchar("customer_gstin", { length: 15 }),
    customerStateCode: char("customer_state_code", { length: 2 }).notNull(),
    customerAddress: text("customer_address"),
    customerPhone: varchar("customer_phone", { length: 30 }),
    gstMode: saleGstModeEnum("gst_mode").notNull(),
    taxType: taxTypeEnum("tax_type").notNull(),
    totalQty: integer("total_qty").notNull(),
    gross: money("gross").notNull(),
    taxable: money("taxable").notNull(),
    gstAmount: money("gst_amount").notNull(),
    gstOverridden: boolean("gst_overridden").notNull().default(false),
    cgst: money("cgst").notNull().default("0"),
    sgst: money("sgst").notNull().default("0"),
    igst: money("igst").notNull().default("0"),
    roundOff: money("round_off").notNull().default("0"),
    netAmount: money("net_amount").notNull(),
    creditAmount: money("credit_amount").notNull().default("0"), // part of this bill left unpaid
    advanceUsed: money("advance_used").notNull().default("0"), // customer's earlier advance applied to this bill
    cashTendered: money("cash_tendered").notNull().default("0"), // cash handed over (before change)
    changeReturned: money("change_returned").notNull().default("0"),
    prevBalance: money("prev_balance").notNull().default("0"), // signed: + Dr (to receive), − Cr (advance)
    balanceAfter: money("balance_after").notNull().default("0"), // signed, after this bill and its receipt
    status: saleStatusEnum("status").notNull().default("SAVED"),
    cancelReason: text("cancel_reason"),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelledBy: integer("cancelled_by").references(() => users.id),
    version: integer("version").notNull().default(1),
    createdBy: integer("created_by").notNull().references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("sales_header_customer_date_idx").on(t.customerId, t.billDate),
    index("sales_header_bill_date_idx").on(t.billDate),
    index("sales_header_location_idx").on(t.locationId),
    index("sales_header_status_idx").on(t.status),
    check(
      "sales_header_amounts_nonneg",
      sql`${t.gross} >= 0 and ${t.taxable} >= 0 and ${t.gstAmount} >= 0 and ${t.cgst} >= 0 and ${t.sgst} >= 0 and ${t.igst} >= 0 and ${t.netAmount} >= 0 and ${t.creditAmount} >= 0`,
    ),
    check("sales_header_credit_le_net", sql`${t.creditAmount} <= ${t.netAmount}`),
    check("sales_header_qty_positive", sql`${t.totalQty} > 0`),
    check("sales_header_cancel_reason", sql`${t.status} <> 'CANCELLED' or ${t.cancelReason} is not null`),
  ],
);

export const salesLines = pgTable(
  "sales_lines",
  {
    id: serial("id").primaryKey(),
    salesId: integer("sales_id").notNull().references(() => salesHeader.id),
    lineNo: integer("line_no").notNull(),
    productId: integer("product_id").notNull().references(() => products.id),
    barcode: varchar("barcode", { length: 40 }).notNull(),
    itemName: varchar("item_name", { length: 200 }).notNull(),
    hsnCode: varchar("hsn_code", { length: 8 }).notNull(),
    gstRate: rate("gst_rate").notNull(),
    qty: integer("qty").notNull(),
    rate: money("rate").notNull(), // WSP as charged (incl. GST in INCLUDES mode)
    purchaseRate: money("purchase_rate").notNull().default("0"), // snapshot, for the below-cost check
    priceEdited: boolean("price_edited").notNull().default(false),
    amount: money("amount").notNull(), // qty × rate
    taxable: money("taxable").notNull(),
    gstAmount: money("gst_amount").notNull(),
    cgst: money("cgst").notNull().default("0"),
    sgst: money("sgst").notNull().default("0"),
    igst: money("igst").notNull().default("0"),
  },
  (t) => [
    uniqueIndex("sales_lines_sales_line_uq").on(t.salesId, t.lineNo),
    index("sales_lines_product_idx").on(t.productId),
    check("sales_lines_qty_positive", sql`${t.qty} > 0`),
    check(
      "sales_lines_amounts_nonneg",
      sql`${t.rate} >= 0 and ${t.amount} >= 0 and ${t.taxable} >= 0 and ${t.gstAmount} >= 0 and ${t.cgst} >= 0 and ${t.sgst} >= 0 and ${t.igst} >= 0`,
    ),
  ],
);

// ---------------------------------------------------------------- receipts
/** Money received from a customer — with a sale (source SALE) or on its own (STANDALONE). */
export const receipts = pgTable(
  "receipts",
  {
    id: serial("id").primaryKey(),
    receiptNo: varchar("receipt_no", { length: 40 }).notNull().unique(),
    fy: varchar("fy", { length: 5 }).notNull(),
    receiptDate: date("receipt_date").notNull(),
    customerId: integer("customer_id").notNull().references(() => customers.id),
    locationId: integer("location_id").notNull().references(() => locations.id),
    source: receiptSourceEnum("source").notNull(),
    salesId: integer("sales_id").references(() => salesHeader.id),
    totalAmount: money("total_amount").notNull(),
    remarks: text("remarks"),
    status: receiptStatusEnum("status").notNull().default("SAVED"),
    cancelReason: text("cancel_reason"),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelledBy: integer("cancelled_by").references(() => users.id),
    createdBy: integer("created_by").notNull().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    index("receipts_customer_date_idx").on(t.customerId, t.receiptDate),
    index("receipts_sales_idx").on(t.salesId),
    check("receipts_total_positive", sql`${t.totalAmount} > 0`),
    check("receipts_sale_has_bill", sql`${t.source} <> 'SALE' or ${t.salesId} is not null`),
  ],
);

export const receiptModes = pgTable(
  "receipt_modes",
  {
    id: serial("id").primaryKey(),
    receiptId: integer("receipt_id").notNull().references(() => receipts.id),
    mode: payModeEnum("mode").notNull(),
    amount: money("amount").notNull(),
  },
  (t) => [uniqueIndex("receipt_modes_receipt_mode_uq").on(t.receiptId, t.mode), check("receipt_modes_amount_positive", sql`${t.amount} > 0`)],
);

/**
 * How a receipt was applied: to the opening balance, to a bill, or kept as an
 * advance. Never deleted — a cancel marks the row reversed (and posts reversing
 * ledger entries).
 */
export const receiptAllocations = pgTable(
  "receipt_allocations",
  {
    id: serial("id").primaryKey(),
    receiptId: integer("receipt_id").notNull().references(() => receipts.id),
    targetType: allocTargetEnum("target_type").notNull(),
    salesId: integer("sales_id").references(() => salesHeader.id),
    amount: money("amount").notNull(),
    reversedAt: timestamp("reversed_at", { withTimezone: true }),
    reversedBy: integer("reversed_by").references(() => users.id),
  },
  (t) => [
    index("receipt_allocations_receipt_idx").on(t.receiptId),
    index("receipt_allocations_sales_idx").on(t.salesId),
    check("receipt_allocations_amount_positive", sql`${t.amount} > 0`),
    check("receipt_allocations_bill_has_sale", sql`(${t.targetType} = 'BILL') = (${t.salesId} is not null)`),
  ],
);

// ---------------------------------------------------------------- credit pool
/**
 * Unapplied credit a customer holds: an opening balance entered as Cr, money kept
 * as an advance (one row per ADVANCE receipt allocation), or a sales return's
 * value. `remaining` is what is still unused; it only changes under the customer
 * row lock. Never deleted — a cancel sets reversed_at (and remaining = 0).
 * Advance available = Σ remaining of the customer's live credits.
 */
export const customerCredits = pgTable(
  "customer_credits",
  {
    id: serial("id").primaryKey(),
    customerId: integer("customer_id").notNull().references(() => customers.id),
    sourceType: creditSourceEnum("source_type").notNull(),
    // OPENING_CR → customers.id · ADVANCE → receipt_allocations.id · SALES_RETURN → sales_return_header.id
    sourceId: integer("source_id").notNull(),
    creditDate: date("credit_date").notNull(),
    amount: money("amount").notNull(),
    remaining: money("remaining").notNull(),
    reversedAt: timestamp("reversed_at", { withTimezone: true }),
    reversedBy: integer("reversed_by").references(() => users.id),
    createdBy: integer("created_by").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    index("customer_credits_customer_idx").on(t.customerId),
    uniqueIndex("customer_credits_source_uq").on(t.sourceType, t.sourceId),
    check("customer_credits_amount_positive", sql`${t.amount} > 0`),
    check("customer_credits_remaining_range", sql`${t.remaining} >= 0 and ${t.remaining} <= ${t.amount}`),
    check("customer_credits_reversed_empty", sql`${t.reversedAt} is null or ${t.remaining} = 0`),
  ],
);

/**
 * How credit was used: against a bill, against the opening balance, or paid out
 * as a refund. Moves no money by itself and doesn't change the ledger balance —
 * it only makes the bill / opening show as paid. A cancel marks it reversed (and
 * puts the amount back into the credit's remaining).
 */
export const creditApplications = pgTable(
  "credit_applications",
  {
    id: serial("id").primaryKey(),
    creditId: integer("credit_id").notNull().references(() => customerCredits.id),
    customerId: integer("customer_id").notNull().references(() => customers.id),
    targetType: creditTargetEnum("target_type").notNull(),
    salesId: integer("sales_id").references(() => salesHeader.id),
    appliedDate: date("applied_date").notNull(),
    amount: money("amount").notNull(),
    reversedAt: timestamp("reversed_at", { withTimezone: true }),
    reversedBy: integer("reversed_by").references(() => users.id),
    createdBy: integer("created_by").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    index("credit_applications_credit_idx").on(t.creditId),
    index("credit_applications_customer_idx").on(t.customerId),
    index("credit_applications_sales_idx").on(t.salesId),
    check("credit_applications_amount_positive", sql`${t.amount} > 0`),
    check("credit_applications_bill_has_sale", sql`(${t.targetType} = 'BILL') = (${t.salesId} is not null)`),
  ],
);

// ---------------------------------------------------------------- sales return (credit note)
export const salesReturnHeader = pgTable(
  "sales_return_header",
  {
    id: serial("id").primaryKey(),
    returnNo: varchar("return_no", { length: 40 }).notNull().unique(),
    fy: varchar("fy", { length: 5 }).notNull(),
    returnDate: date("return_date").notNull(),
    customerId: integer("customer_id").notNull().references(() => customers.id),
    locationId: integer("location_id").notNull().references(() => locations.id), // stock goes back here
    againstSalesId: integer("against_sales_id").references(() => salesHeader.id),
    // Snapshot of the customer as printed on the credit note
    customerName: varchar("customer_name", { length: 160 }).notNull(),
    customerGstin: varchar("customer_gstin", { length: 15 }),
    customerStateCode: char("customer_state_code", { length: 2 }).notNull(),
    customerAddress: text("customer_address"),
    customerPhone: varchar("customer_phone", { length: 30 }),
    gstMode: saleGstModeEnum("gst_mode").notNull(),
    taxType: taxTypeEnum("tax_type").notNull(),
    totalQty: integer("total_qty").notNull(),
    gross: money("gross").notNull(),
    taxable: money("taxable").notNull(),
    gstAmount: money("gst_amount").notNull(),
    gstOverridden: boolean("gst_overridden").notNull().default(false),
    cgst: money("cgst").notNull().default("0"),
    sgst: money("sgst").notNull().default("0"),
    igst: money("igst").notNull().default("0"),
    roundOff: money("round_off").notNull().default("0"),
    netAmount: money("net_amount").notNull(),
    // How the return value was settled: applied to dues + kept as advance + refunded = net
    appliedToDues: money("applied_to_dues").notNull().default("0"),
    advanceCreated: money("advance_created").notNull().default("0"),
    refundAmount: money("refund_amount").notNull().default("0"),
    refundMode: payModeEnum("refund_mode"),
    prevBalance: money("prev_balance").notNull().default("0"), // signed: + Dr / − Cr
    balanceAfter: money("balance_after").notNull().default("0"),
    remarks: text("remarks"),
    status: saleStatusEnum("status").notNull().default("SAVED"),
    cancelReason: text("cancel_reason"),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelledBy: integer("cancelled_by").references(() => users.id),
    version: integer("version").notNull().default(1),
    createdBy: integer("created_by").notNull().references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("sales_return_customer_date_idx").on(t.customerId, t.returnDate),
    index("sales_return_date_idx").on(t.returnDate),
    index("sales_return_against_idx").on(t.againstSalesId),
    index("sales_return_status_idx").on(t.status),
    check(
      "sales_return_amounts_nonneg",
      sql`${t.gross} >= 0 and ${t.taxable} >= 0 and ${t.gstAmount} >= 0 and ${t.cgst} >= 0 and ${t.sgst} >= 0 and ${t.igst} >= 0 and ${t.appliedToDues} >= 0 and ${t.advanceCreated} >= 0 and ${t.refundAmount} >= 0`,
    ),
    check("sales_return_net_positive", sql`${t.netAmount} > 0`),
    check("sales_return_qty_positive", sql`${t.totalQty} > 0`),
    check("sales_return_settled", sql`${t.appliedToDues} + ${t.advanceCreated} + ${t.refundAmount} = ${t.netAmount}`),
    check("sales_return_refund_mode", sql`(${t.refundAmount} > 0) = (${t.refundMode} is not null)`),
    check("sales_return_cancel_reason", sql`${t.status} <> 'CANCELLED' or ${t.cancelReason} is not null`),
  ],
);

export const salesReturnLines = pgTable(
  "sales_return_lines",
  {
    id: serial("id").primaryKey(),
    returnId: integer("return_id").notNull().references(() => salesReturnHeader.id),
    lineNo: integer("line_no").notNull(),
    productId: integer("product_id").notNull().references(() => products.id),
    originalSalesLineId: integer("original_sales_line_id").references(() => salesLines.id),
    barcode: varchar("barcode", { length: 40 }).notNull(),
    itemName: varchar("item_name", { length: 200 }).notNull(),
    hsnCode: varchar("hsn_code", { length: 8 }).notNull(),
    gstRate: rate("gst_rate").notNull(),
    qty: integer("qty").notNull(),
    rate: money("rate").notNull(),
    amount: money("amount").notNull(), // qty × rate
    taxable: money("taxable").notNull(),
    gstAmount: money("gst_amount").notNull(),
    cgst: money("cgst").notNull().default("0"),
    sgst: money("sgst").notNull().default("0"),
    igst: money("igst").notNull().default("0"),
  },
  (t) => [
    uniqueIndex("sales_return_lines_line_uq").on(t.returnId, t.lineNo),
    index("sales_return_lines_product_idx").on(t.productId),
    index("sales_return_lines_orig_idx").on(t.originalSalesLineId),
    check("sales_return_lines_qty_positive", sql`${t.qty} > 0`),
    check("sales_return_lines_rate_positive", sql`${t.rate} > 0`),
    check(
      "sales_return_lines_amounts_nonneg",
      sql`${t.amount} >= 0 and ${t.taxable} >= 0 and ${t.gstAmount} >= 0 and ${t.cgst} >= 0 and ${t.sgst} >= 0 and ${t.igst} >= 0`,
    ),
  ],
);

// ---------------------------------------------------------------- ledgers
/**
 * Customer ledger — append-only (a trigger blocks UPDATE/DELETE except on the
 * OPENING row while the customer has no other entries). Debit = customer owes
 * us, Credit = receipts / advances. Balance = SUM(debit − credit); the running
 * balance is computed with a window function, never stored.
 */
export const customerLedger = pgTable(
  "customer_ledger",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    customerId: integer("customer_id").notNull().references(() => customers.id),
    entryDate: date("entry_date").notNull(),
    voucherType: voucherTypeEnum("voucher_type").notNull(),
    voucherId: integer("voucher_id").notNull(), // sales_header.id / receipts.id / customers.id (OPENING)
    voucherNo: varchar("voucher_no", { length: 40 }),
    particulars: text("particulars"),
    debit: money("debit").notNull().default("0"),
    credit: money("credit").notNull().default("0"),
    createdBy: integer("created_by").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    index("customer_ledger_customer_date_idx").on(t.customerId, t.entryDate, t.id),
    index("customer_ledger_voucher_idx").on(t.voucherType, t.voucherId),
    check("customer_ledger_nonneg", sql`${t.debit} >= 0 and ${t.credit} >= 0`),
  ],
);

/** Money in / out by mode — fed by receipts now, used by the Accounts module later. */
export const cashBankLedger = pgTable(
  "cash_bank_ledger",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    entryDate: date("entry_date").notNull(),
    mode: payModeEnum("mode").notNull(),
    direction: cashDirectionEnum("direction").notNull(),
    amount: money("amount").notNull(),
    refType: varchar("ref_type", { length: 20 }).notNull(), // RECEIPT | RECEIPT_CANCEL | REFUND
    refId: integer("ref_id").notNull(),
    customerId: integer("customer_id").references(() => customers.id),
    locationId: integer("location_id").references(() => locations.id),
    createdBy: integer("created_by").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    index("cash_bank_ledger_mode_date_idx").on(t.mode, t.entryDate),
    index("cash_bank_ledger_ref_idx").on(t.refType, t.refId),
    check("cash_bank_ledger_amount_positive", sql`${t.amount} > 0`),
  ],
);

// ---------------------------------------------------------------- counters & audit
/**
 * Gap-free document numbering. Rows are locked with SELECT ... FOR UPDATE inside
 * the same transaction that uses the number. fy = "25-26" for GRN numbers,
 * "ALL" for the barcode counter (never resets).
 */
export const counters = pgTable(
  "counters",
  {
    name: varchar("name", { length: 40 }).notNull(),
    fy: varchar("fy", { length: 5 }).notNull(),
    lastValue: integer("last_value").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.name, t.fy] })],
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: integer("user_id").references(() => users.id),
    tableName: varchar("table_name", { length: 60 }).notNull(),
    recordId: varchar("record_id", { length: 60 }).notNull(),
    action: auditActionEnum("action").notNull(),
    oldJson: jsonb("old_json"),
    newJson: jsonb("new_json"),
    reason: text("reason"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("audit_log_table_record_idx").on(t.tableName, t.recordId),
    index("audit_log_at_idx").on(t.at),
  ],
);
