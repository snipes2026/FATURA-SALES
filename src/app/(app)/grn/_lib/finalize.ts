import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import { COUNTER } from "@/lib/counters";
import { financialYear } from "@/lib/dates";
import { invoiceMismatchMessage } from "@/lib/grn-calc";
import { formatAmount } from "@/lib/india";
import { fromPaise, toPaise } from "@/lib/money";
import { ActionError } from "@/lib/server-action";
import { formatGrnNo } from "@/lib/validation/masters";
import { REF, reverseGrnStock } from "./stock";

/**
 * Final step of "Save GRN" (runs in the same transaction as the draft save and
 * barcode generation):
 *  1. GRN number from the financial year of the GRN date, allocated under a
 *     SELECT … FOR UPDATE lock on the counters row — no duplicates, no gaps.
 *     An edited GRN keeps its number.
 *  2. Stock: an edit first reverses what the GRN posted before, then every line
 *     posts qty_in at the receiving location.
 *  3. The SKU master gets the latest purchase rate / WSP / RSP (and a photo if it had none).
 */
export async function finalizeGrn(tx: Tx, grnId: number, userId: number, wasSaved: boolean) {
  const [h] = await tx.select().from(schema.grnHeader).where(eq(schema.grnHeader.id, grnId)).for("update");
  if (!h) throw new ActionError("This GRN no longer exists");
  const lines = await tx.select().from(schema.grnLines).where(eq(schema.grnLines.grnId, grnId)).orderBy(asc(schema.grnLines.lineNo));
  if (lines.length === 0) throw new ActionError("Add at least one item before saving the GRN");
  if (lines.some((l) => !l.productId || !l.barcode)) throw new ActionError("Some items have no barcode");

  // The GRN must add up to the supplier's bill (checked here too, not only on screen).
  const net = toPaise(h.netPayable);
  const invoice = toPaise(h.invoiceValue);
  if (net <= 0) throw new ActionError("Net payable must be more than ₹0 to save the GRN");
  if (net !== invoice) throw new ActionError(invoiceMismatchMessage(net, invoice, (p) => formatAmount(fromPaise(p))), "invoiceValue", "MISMATCH");

  // 1. Number
  let grnNo = h.grnNo;
  let fy = h.fy;
  if (grnNo && fy && financialYear(h.grnDate) !== fy)
    throw new ActionError(`${grnNo} belongs to financial year ${fy}; the GRN date must stay in that year`, "grnDate");
  if (!grnNo) {
    fy = financialYear(h.grnDate);
    await tx.insert(schema.counters).values({ name: COUNTER.GRN, fy, lastValue: 0 }).onConflictDoNothing();
    const [counter] = await tx
      .select()
      .from(schema.counters)
      .where(and(eq(schema.counters.name, COUNTER.GRN), eq(schema.counters.fy, fy)))
      .for("update");
    const [settings] = await tx.select().from(schema.grnNumberSettings).where(eq(schema.grnNumberSettings.id, 1));
    const next = counter.lastValue + 1;
    grnNo = formatGrnNo({ prefix: settings?.prefix ?? "GRN", digits: settings?.digits ?? 4 }, fy, next);
    await tx
      .update(schema.counters)
      .set({ lastValue: next })
      .where(and(eq(schema.counters.name, COUNTER.GRN), eq(schema.counters.fy, fy)));
  }

  // 2. Stock
  if (wasSaved) await reverseGrnStock(tx, grnId, REF.GRN_EDIT, userId);
  await tx.insert(schema.stockLedger).values(
    lines.map((l) => ({
      locationId: h.locationId,
      productId: l.productId!,
      qtyIn: l.qty,
      qtyOut: 0,
      refDocType: REF.GRN,
      refDocId: grnId,
      refLineId: l.id,
      createdBy: userId,
    })),
  );

  // 3. Latest rates on the SKU master (last line of the GRN wins)
  for (const l of lines) {
    const [p] = await tx.select({ imagePath: schema.products.imagePath }).from(schema.products).where(eq(schema.products.id, l.productId!));
    await tx
      .update(schema.products)
      .set({
        purchaseRate: l.purchaseRate,
        ...(l.wsp ? { wsp: l.wsp } : {}),
        ...(l.rsp ? { rsp: l.rsp } : {}),
        ...(!p?.imagePath && l.imagePath ? { imagePath: l.imagePath } : {}),
      })
      .where(eq(schema.products.id, l.productId!));
  }

  await tx
    .update(schema.grnHeader)
    .set({ status: "SAVED", grnNo, fy, savedAt: h.savedAt ?? new Date(), updatedBy: userId })
    .where(eq(schema.grnHeader.id, grnId));

  return { grnNo: grnNo!, lineCount: lines.length, totalQty: lines.reduce((a, l) => a + l.qty, 0) };
}
