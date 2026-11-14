import "server-only";
import { eq } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import { ActionError, audit } from "@/lib/server-action";
import type { CurrentUser } from "@/lib/session";
import { assignBarcodes } from "./barcodes";
import { finalizeGrn } from "./finalize";
import { persistDraft, type DraftInput } from "./persist-draft";
import { assertNoNegativeStock, grnLockReason } from "./stock";

/**
 * Body of "Save GRN", run inside ONE transaction by the caller:
 * save header/lines/summary → barcodes → Invoice Value check → GRN number →
 * stock → SKU rates. Any error rolls everything back.
 */
export async function saveFinalGrn(tx: Tx, input: DraftInput, user: CurrentUser, editSaved: boolean) {
  if (editSaved && input.id) {
    const reason = await grnLockReason(tx, input.id);
    if (reason) throw new ActionError(`${reason} — this GRN can't be edited`);
  }
  // Products this GRN held before the edit (a removed line must not leave negative stock behind)
  const before = input.id
    ? (await tx.select({ productId: schema.grnLines.productId }).from(schema.grnLines).where(eq(schema.grnLines.grnId, input.id))).map((r) => r.productId)
    : [];
  const saved = await persistDraft(tx, input, user, { allowSaved: editSaved });
  const barcodes = await assignBarcodes(tx, saved.id, user.id);
  const fin = await finalizeGrn(tx, saved.id, user.id, saved.wasSaved);
  if (saved.wasSaved) {
    const [h] = await tx.select({ locationId: schema.grnHeader.locationId }).from(schema.grnHeader).where(eq(schema.grnHeader.id, saved.id));
    const after = (await tx.select({ productId: schema.grnLines.productId }).from(schema.grnLines).where(eq(schema.grnLines.grnId, saved.id))).map((r) => r.productId);
    const ids = [...new Set([...before, ...after].filter((x): x is number => x != null))];
    await assertNoNegativeStock(tx, h.locationId, ids, "This edit");
  }
  await audit(tx, {
    userId: user.id,
    table: "grn_header",
    recordId: saved.id,
    action: "UPDATE",
    newValue: { event: saved.wasSaved ? "GRN_EDITED" : "GRN_SAVED", grnNo: fin.grnNo, totalQty: fin.totalQty, barcodes },
  });
  return { id: saved.id, version: saved.version, edited: saved.wasSaved, ...fin };
}
