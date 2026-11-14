import "server-only";
import { asc, eq, or } from "drizzle-orm";
import { db, schema } from "@/db";
import { todayIST } from "@/lib/dates";
import type { CurrentUser } from "@/lib/session";
import { fromPaise, toPaise } from "@/lib/money";
import type { GrnLineForm, GrnSummaryForm } from "@/lib/validation/grn";

export type EntryMasters = Awaited<ReturnType<typeof loadEntryMasters>>;
export type DeptOption = EntryMasters["departments"][number];
export type CatSlot = EntryMasters["categories"][number];

/**
 * Master data for the GRN entry screen. Inactive suppliers/transporters are
 * left out, except the ones already used by the GRN being edited. Departments
 * and category values come with an isActive flag (old lines may use inactive ones).
 */
export async function loadEntryMasters(user: CurrentUser, keep?: { supplierId?: number; transportId?: number | null }) {
  const [suppliers, transports, departments, catConfig, catValues] = await Promise.all([
    db
      .select({ id: schema.suppliers.id, name: schema.suppliers.name, gstin: schema.suppliers.gstin, stateCode: schema.suppliers.stateCode })
      .from(schema.suppliers)
      .where(keep?.supplierId ? or(eq(schema.suppliers.isActive, true), eq(schema.suppliers.id, keep.supplierId)) : eq(schema.suppliers.isActive, true))
      .orderBy(asc(schema.suppliers.name)),
    db
      .select({ id: schema.transports.id, name: schema.transports.name })
      .from(schema.transports)
      .where(keep?.transportId ? or(eq(schema.transports.isActive, true), eq(schema.transports.id, keep.transportId)) : eq(schema.transports.isActive, true))
      .orderBy(asc(schema.transports.name)),
    db.select().from(schema.departments).orderBy(asc(schema.departments.name)),
    db.select().from(schema.categoryConfig).orderBy(asc(schema.categoryConfig.slot)),
    db.select().from(schema.categoryValues).orderBy(asc(schema.categoryValues.sortOrder), asc(schema.categoryValues.id)),
  ]);
  return {
    today: todayIST(),
    locations: user.locations.map((l) => ({ id: l.id, name: l.name, type: l.type, stateCode: l.stateCode })),
    suppliers: suppliers.map((s) => ({ ...s, gstin: s.gstin ?? "" })),
    transports,
    departments: departments.map((d) => ({
      id: d.id,
      name: d.name,
      hsnCode: d.hsnCode,
      gstRate: d.gstRate,
      slabEnabled: d.slabEnabled,
      slabThreshold: d.slabThreshold,
      slabRateAbove: d.slabRateAbove,
      isActive: d.isActive,
    })),
    categories: [1, 2, 3, 4].map((slot) => {
      const c = catConfig.find((x) => x.slot === slot);
      return {
        slot,
        label: c?.label ?? `Category ${slot}`,
        mode: c?.mode ?? ("HIDDEN" as const),
        values: catValues.filter((v) => v.slot === slot).map((v) => ({ id: v.id, value: v.value, isActive: v.isActive })),
      };
    }),
  };
}

/** Discount / charges / round off / remarks of a saved GRN in the form's string format. */
export async function loadGrnSummary(h: typeof schema.grnHeader.$inferSelect): Promise<GrnSummaryForm> {
  const charges = await db
    .select()
    .from(schema.grnCharges)
    .where(eq(schema.grnCharges.grnId, h.id))
    .orderBy(asc(schema.grnCharges.sortOrder), asc(schema.grnCharges.id));
  const transport = charges.filter((c) => c.chargeType === "FREIGHT").reduce((a, c) => a + toPaise(c.amount), 0);
  return {
    discountType: h.discountType,
    discountValue: Number(h.discountValue) === 0 ? "" : h.discountValue,
    gstMode: h.gstMode,
    gstValue: Number(h.gstInput) === 0 ? "" : h.gstInput,
    transport: transport ? fromPaise(transport) : "",
    otherCharges: charges
      .filter((c) => c.chargeType === "OTHER")
      .map((c) => ({ uid: `db-${c.id}`, description: c.description ?? "Other charges", amount: c.amount })),
    roundOffManual: h.roundOffManual,
    roundOff: h.roundOff,
    remarks: h.remarks ?? "",
  };
}
/** Saved lines of a GRN in the entry screen's string format. */
export async function loadGrnLines(grnId: number): Promise<GrnLineForm[]> {
  const rows = await db.select().from(schema.grnLines).where(eq(schema.grnLines.grnId, grnId)).orderBy(asc(schema.grnLines.lineNo));
  const s = (v: number | null) => (v == null ? "" : String(v));
  return rows.map((r) => ({
    uid: `db-${r.id}`,
    id: r.id,
    departmentId: String(r.departmentId),
    itemName: r.itemName,
    cat1: s(r.cat1ValueId),
    cat2: s(r.cat2ValueId),
    cat3: s(r.cat3ValueId),
    cat4: s(r.cat4ValueId),
    qty: String(r.qty),
    purchaseRate: r.purchaseRate,
    wsp: r.wsp ?? "",
    rsp: r.rsp ?? "",
    mrp: r.mrp,
    imagePath: r.imagePath,
    priceWarningOverridden: r.priceWarningOverridden,
    barcode: r.barcode,
  }));
}
