"use server";

import { and, eq, ne, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { schema } from "@/db";
import type { ActionResult } from "@/lib/action-result";
import { can } from "@/lib/permissions";
import { ActionError, audit, CONFLICT_MESSAGE, db, runAction } from "@/lib/server-action";
import { saveFinalGrn } from "./_lib/save-final";
import { assertNoNegativeStock, grnLockReason, REF, reverseGrnStock } from "./_lib/stock";
import { assertPermission, AuthError } from "@/lib/session";
import { saveImage, uploadUrl } from "@/lib/uploads";
import { assignBarcodes } from "./_lib/barcodes";
import { persistDraft } from "./_lib/persist-draft";
import { grnDraftSchema, normalizeInvoiceNo } from "@/lib/validation/grn";
import { supplierSchema } from "@/lib/validation/masters";

// ------------------------------------------------------------ duplicate invoice check
const dupSchema = z.object({
  supplierId: z.number().int().positive(),
  invoiceNo: z.string().trim().min(1).max(60),
  excludeId: z.number().int().positive().optional(),
});

/** Live check used by the header card; the unique index enforces it on save. */
export async function checkDuplicateInvoice(raw: unknown): Promise<ActionResult<{ duplicate: null | { id: number; label: string } }>> {
  return runAction("grn.view", dupSchema, raw, async ({ supplierId, invoiceNo, excludeId }) => {
    const conds = [
      eq(schema.grnHeader.supplierId, supplierId),
      sql`upper(trim(${schema.grnHeader.invoiceNo})) = ${normalizeInvoiceNo(invoiceNo)}`,
      ne(schema.grnHeader.status, "CANCELLED"),
    ];
    if (excludeId) conds.push(ne(schema.grnHeader.id, excludeId));
    const [hit] = await db
      .select({ id: schema.grnHeader.id, grnNo: schema.grnHeader.grnNo, status: schema.grnHeader.status })
      .from(schema.grnHeader)
      .where(and(...conds))
      .limit(1);
    return {
      ok: true,
      data: { duplicate: hit ? { id: hit.id, label: hit.grnNo ?? `draft #${hit.id}` } : null },
    };
  });
}

// ------------------------------------------------------------ save draft
export async function saveGrnDraft(raw: unknown): Promise<ActionResult<{ id: number; version: number; lineCount: number; lineIds: Record<string, number> }>> {
  return runAction("grn.create", grnDraftSchema(), raw, async (input, user) => {
    const result = await db.transaction((tx) => persistDraft(tx, input, user));
    revalidatePath("/grn");
    return { ok: true, data: result, message: input.id ? "Draft saved" : "Draft created" };
  });
}

// ------------------------------------------------------------ generate barcodes
/**
 * Saves the draft and gives every line without a barcode one — in ONE
 * transaction, so either everything is saved and numbered or nothing is.
 */
export async function generateBarcodes(
  raw: unknown,
): Promise<ActionResult<{ id: number; version: number; lineIds: Record<string, number>; barcodes: Record<number, string> }>> {
  return runAction("barcode.generate", grnDraftSchema(), raw, async (input, user) => {
    if (!can(user.role, "grn.create")) throw new ActionError("You don't have permission to change this GRN");
    if (input.lines.length === 0) throw new ActionError("Add and populate items before generating barcodes");
    const { saved, result, barcodes } = await db.transaction(async (tx) => {
      const saved = await persistDraft(tx, input, user);
      const result = await assignBarcodes(tx, saved.id, user.id);
      const rows = await tx
        .select({ id: schema.grnLines.id, barcode: schema.grnLines.barcode })
        .from(schema.grnLines)
        .where(eq(schema.grnLines.grnId, saved.id));
      if (result.assigned)
        await audit(tx, { userId: user.id, table: "grn_header", recordId: saved.id, action: "UPDATE", newValue: { barcodesGenerated: result } });
      return { saved, result, barcodes: Object.fromEntries(rows.map((r) => [r.id, r.barcode ?? ""])) };
    });
    revalidatePath("/grn");
    const message =
      result.assigned === 0
        ? "All items already have barcodes"
        : `${result.assigned} new barcode${result.assigned > 1 ? "s" : ""}: ${result.first}${result.last !== result.first ? ` – ${result.last}` : ""}`;
    return { ok: true, data: { id: saved.id, version: saved.version, lineIds: saved.lineIds, barcodes }, message };
  });
}
// ------------------------------------------------------------ save GRN (final)
const saveGrnSchema = grnDraftSchema().extend({ editSaved: z.boolean().optional() });

/**
 * Save GRN — ONE transaction: save header/lines/summary → barcodes for any
 * line without one → GRN number (FY counter, row lock) → stock ledger → SKU
 * rates. Editing an already saved GRN reverses its old stock first.
 */
export async function saveGrn(raw: unknown): Promise<ActionResult<{ id: number; grnNo: string; version: number; totalQty: number; edited: boolean }>> {
  return runAction("grn.save", saveGrnSchema, raw, async ({ editSaved, ...input }, user) => {
    if (editSaved && !can(user.role, "grn.edit")) throw new ActionError("You don't have permission to edit saved GRNs");
    if (!can(user.role, "barcode.generate")) throw new ActionError("You don't have permission to generate barcodes");
    if (input.lines.length === 0) throw new ActionError("Add and populate at least one item before saving the GRN");

    const out = await db.transaction((tx) => saveFinalGrn(tx, input, user, !!editSaved));
    revalidatePath("/grn");
    return {
      ok: true,
      data: { id: out.id, grnNo: out.grnNo, version: out.version, totalQty: out.totalQty, edited: out.edited },
      message: `${out.grnNo} ${out.edited ? "updated" : "saved"} · ${out.totalQty} pcs added to stock`,
    };
  });
}

// ------------------------------------------------------------ delete (cancel) GRN
const cancelSchema = z.object({
  id: z.number().int().positive(),
  version: z.number().int().positive(),
  reason: z.string().trim().min(5, "Enter a reason (at least 5 characters)").max(500, "Max 500 characters"),
});

/** Soft delete: status → CANCELLED with a reason, stock reversed. Blocked once items have moved out. */
export async function cancelGrn(raw: unknown): Promise<ActionResult<{ id: number }>> {
  return runAction("grn.delete", cancelSchema, raw, async ({ id, version, reason }, user) => {
    const label = await db.transaction(async (tx) => {
      const [h] = await tx.select().from(schema.grnHeader).where(eq(schema.grnHeader.id, id)).for("update");
      if (!h) throw new ActionError("This GRN no longer exists", undefined, "NOT_FOUND");
      if (!user.locations.some((l) => l.id === h.locationId)) throw new ActionError("You don't have access to this GRN");
      if (h.status === "CANCELLED") throw new ActionError("This GRN is already cancelled");
      if (h.version !== version) throw new ActionError(CONFLICT_MESSAGE, undefined, "CONFLICT");
      if (h.status === "SAVED") {
        const lockReason = await grnLockReason(tx, id);
        if (lockReason) throw new ActionError(`${lockReason} — this GRN can't be deleted`);
        await reverseGrnStock(tx, id, REF.GRN_CANCEL, user.id);
        const productIds = (await tx.select({ productId: schema.grnLines.productId }).from(schema.grnLines).where(eq(schema.grnLines.grnId, id)))
          .map((r) => r.productId)
          .filter((x): x is number => x != null);
        await assertNoNegativeStock(tx, h.locationId, productIds, "Deleting this GRN");
      }
      await tx
        .update(schema.grnHeader)
        .set({
          status: "CANCELLED",
          cancelReason: reason,
          cancelledAt: new Date(),
          cancelledBy: user.id,
          updatedBy: user.id,
          version: sql`${schema.grnHeader.version} + 1`,
        })
        .where(eq(schema.grnHeader.id, id));
      await audit(tx, { userId: user.id, table: "grn_header", recordId: id, action: "CANCEL", oldValue: { status: h.status, grnNo: h.grnNo }, newValue: { status: "CANCELLED" }, reason });
      return h.grnNo ?? `Draft #${id}`;
    });
    revalidatePath("/grn");
    return { ok: true, data: { id }, message: `${label} deleted (cancelled)` };
  });
}

/** For the list / view screens: can this saved GRN still be edited or deleted? */
export async function grnMovementStatus(raw: unknown): Promise<ActionResult<{ moved: boolean; reason: string | null }>> {
  return runAction("grn.view", z.object({ id: z.number().int().positive() }), raw, async ({ id }) => {
    const reason = await db.transaction((tx) => grnLockReason(tx, id));
    return { ok: true, data: { moved: !!reason, reason } };
  });
}

// ------------------------------------------------------------ product image upload
/** Stores an already-compressed product photo; returns the relative path kept on the line. */
export async function uploadProductImage(formData: FormData): Promise<ActionResult<{ imagePath: string; url: string }>> {
  try {
    await assertPermission("grn.create");
    const file = formData.get("image");
    if (!(file instanceof File)) return { ok: false, error: "Choose an image" };
    const imagePath = await saveImage(file, "products", 5 * 1024 * 1024);
    return { ok: true, data: { imagePath, url: uploadUrl(imagePath)! } };
  } catch (err) {
    if (err instanceof AuthError) return { ok: false, error: err.message };
    return { ok: false, error: err instanceof Error ? err.message : "Upload failed" };
  }
}

// ------------------------------------------------------------ item name suggestions
const suggestSchema = z.object({ departmentId: z.number().int().positive(), q: z.string().trim().max(100) });

/** Past item names in a department (products + earlier GRN lines), best matches first. */
export async function suggestItemNames(raw: unknown): Promise<ActionResult<string[]>> {
  return runAction("grn.view", suggestSchema, raw, async ({ departmentId, q }) => {
    const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const rows = await db.execute<{ name: string }>(sql`
      select name from (
        select ${schema.products.itemName} as name from ${schema.products}
          where ${schema.products.departmentId} = ${departmentId} and ${schema.products.itemName} ilike ${like}
        union
        select ${schema.grnLines.itemName} as name from ${schema.grnLines}
          where ${schema.grnLines.departmentId} = ${departmentId} and ${schema.grnLines.itemName} ilike ${like}
      ) t
      order by ${q ? sql`similarity(name, ${q}) desc,` : sql``} name
      limit 10`);
    return { ok: true, data: rows.rows.map((r) => r.name) };
  });
}

// ------------------------------------------------------------ quick-create supplier
export async function quickCreateSupplier(raw: unknown): Promise<ActionResult<{ id: number; name: string; gstin: string; stateCode: string }>> {
  return runAction("supplier.quickCreate", supplierSchema, raw, async ({ id: _ignored, ...input }, user) => {
    const row = await db.transaction(async (tx) => {
      const [r] = await tx
        .insert(schema.suppliers)
        .values({ ...input, isActive: true, createdBy: user.id })
        .returning({ id: schema.suppliers.id, name: schema.suppliers.name, gstin: schema.suppliers.gstin, stateCode: schema.suppliers.stateCode });
      await audit(tx, { userId: user.id, table: "suppliers", recordId: r.id, action: "CREATE", newValue: { ...input, via: "GRN quick add" } });
      return r;
    });
    revalidatePath("/settings/suppliers");
    return { ok: true, data: { ...row, gstin: row.gstin ?? "" }, message: `Supplier "${row.name}" added` };
  });
}
