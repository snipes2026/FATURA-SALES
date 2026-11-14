import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { z } from "zod";
import { schema, type Tx } from "@/db";
import { ActionError, audit, CONFLICT_MESSAGE } from "@/lib/server-action";
import type { CurrentUser } from "@/lib/session";
import type { grnDraftSchema } from "@/lib/validation/grn";
import { saveDraftLines } from "./save-lines";

export type DraftInput = z.output<ReturnType<typeof grnDraftSchema>>;

/**
 * Saves a draft GRN (header + lines + summary) inside the caller's transaction,
 * with optimistic locking on grn_header.version. Used by "Save as Draft" and
 * by "Generate Barcode" (which saves first, in the same transaction).
 */
export async function persistDraft(
  tx: Tx,
  { id, version, header, lines, summary }: DraftInput,
  user: CurrentUser,
  opts: { allowSaved?: boolean } = {},
) {
  const editable: ("DRAFT" | "SAVED")[] = opts.allowSaved ? ["DRAFT", "SAVED"] : ["DRAFT"];
  if (!user.locations.some((l) => l.id === header.locationId)) throw new ActionError("You don't have access to this location", "locationId");

  const [location] = await tx.select().from(schema.locations).where(eq(schema.locations.id, header.locationId));
  if (!location?.isActive) throw new ActionError("This location is inactive", "locationId");
  const [supplier] = await tx.select().from(schema.suppliers).where(eq(schema.suppliers.id, header.supplierId));
  if (!supplier) throw new ActionError("Supplier not found", "supplierId");
  if (header.transportId) {
    const [t] = await tx.select({ id: schema.transports.id }).from(schema.transports).where(eq(schema.transports.id, header.transportId));
    if (!t) throw new ActionError("Transporter not found", "transportId");
  }

  const values = {
    ...header,
    invoiceNo: header.invoiceNo.trim(),
    taxType: supplier.stateCode === location.stateCode ? ("INTRA" as const) : ("INTER" as const),
    updatedBy: user.id,
  };

  if (!id) {
    if (!supplier.isActive) throw new ActionError("This supplier is inactive", "supplierId");
    const [row] = await tx
      .insert(schema.grnHeader)
      .values({ ...values, status: "DRAFT", createdBy: user.id })
      .returning({ id: schema.grnHeader.id, version: schema.grnHeader.version });
    const { totals, lineCount, lineIds } = await saveDraftLines(tx, row.id, lines, values.taxType, summary);
    await tx.update(schema.grnHeader).set(totals).where(eq(schema.grnHeader.id, row.id));
    await audit(tx, { userId: user.id, table: "grn_header", recordId: row.id, action: "CREATE", newValue: { ...values, ...totals, lineCount } });
    return { ...row, lineCount, lineIds, created: true, wasSaved: false };
  }

  const [old] = await tx.select().from(schema.grnHeader).where(eq(schema.grnHeader.id, id));
  if (!old) throw new ActionError("This GRN no longer exists", undefined, "NOT_FOUND");
  if (!user.locations.some((l) => l.id === old.locationId)) throw new ActionError("You don't have access to this GRN");
  if (!editable.includes(old.status as "DRAFT" | "SAVED"))
    throw new ActionError(old.status === "CANCELLED" ? "This GRN is cancelled" : "This GRN is already saved — use Edit to change it");
  if (!supplier.isActive && supplier.id !== old.supplierId) throw new ActionError("This supplier is inactive", "supplierId");

  // Optimistic locking: only update if nobody saved since this user loaded it.
  const [row] = await tx
    .update(schema.grnHeader)
    .set({ ...values, version: sql`${schema.grnHeader.version} + 1` })
    .where(and(eq(schema.grnHeader.id, id), eq(schema.grnHeader.version, version ?? -1), inArray(schema.grnHeader.status, editable)))
    .returning({ id: schema.grnHeader.id, version: schema.grnHeader.version });
  if (!row) throw new ActionError(CONFLICT_MESSAGE, undefined, "CONFLICT");
  const { totals, lineCount, lineIds } = await saveDraftLines(tx, id, lines, values.taxType, summary);
  await tx.update(schema.grnHeader).set(totals).where(eq(schema.grnHeader.id, id));
  await audit(tx, { userId: user.id, table: "grn_header", recordId: id, action: "UPDATE", oldValue: old, newValue: { ...values, ...totals, lineCount } });
  return { ...row, lineCount, lineIds, created: false, wasSaved: old.status === "SAVED" };
}
