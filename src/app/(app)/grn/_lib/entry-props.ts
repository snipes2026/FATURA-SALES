import "server-only";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { formatDateTime } from "@/lib/dates";
import { can } from "@/lib/permissions";
import type { CurrentUser } from "@/lib/session";
import { loadEntryMasters, loadGrnLines, loadGrnSummary } from "./load";

/** Everything the entry screen needs for an existing GRN (draft, saved or cancelled). */
export async function loadExistingGrnProps(user: CurrentUser, id: number) {
  const [h] = await db.select().from(schema.grnHeader).where(eq(schema.grnHeader.id, id));
  // Users only see GRNs of their own locations.
  if (!h || !user.locations.some((l) => l.id === h.locationId)) return null;

  const [masters, lines, summary, canceller] = await Promise.all([
    loadEntryMasters(user, { supplierId: h.supplierId, transportId: h.transportId }),
    loadGrnLines(h.id),
    loadGrnSummary(h),
    h.cancelledBy ? db.select({ name: schema.users.name }).from(schema.users).where(eq(schema.users.id, h.cancelledBy)) : Promise.resolve([]),
  ]);

  return {
    header: h,
    props: {
      id: h.id,
      version: h.version,
      status: h.status,
      grnNo: h.grnNo,
      masters,
      initial: {
        grnDate: h.grnDate,
        locationId: String(h.locationId),
        supplierId: String(h.supplierId),
        invoiceNo: h.invoiceNo,
        invoiceDate: h.invoiceDate,
        invoiceValue: h.invoiceValue,
        transportId: h.transportId ? String(h.transportId) : "",
        lrNo: h.lrNo ?? "",
        transportDate: h.transportDate ?? "",
      },
      initialLines: lines,
      initialSummary: summary,
      canQuickAddSupplier: can(user.role, "supplier.quickCreate"),
      canAddCategoryValue: can(user.role, "category.addValue"),
      canGenerateBarcode: can(user.role, "barcode.generate") && can(user.role, "grn.create"),
      canSave: can(user.role, "grn.save") && can(user.role, "barcode.generate"),
      canDelete: can(user.role, "grn.delete"),
      canEditSaved: can(user.role, "grn.edit"),
      cancelInfo:
        h.status === "CANCELLED"
          ? { reason: h.cancelReason, at: h.cancelledAt ? formatDateTime(h.cancelledAt) : null, by: canceller[0]?.name ?? null }
          : undefined,
    },
  };
}
