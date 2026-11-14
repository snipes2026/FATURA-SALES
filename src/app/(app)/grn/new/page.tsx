import type { Metadata } from "next";
import { can } from "@/lib/permissions";
import { requirePermission } from "@/lib/session";
import { GrnEntry } from "../_components/grn-entry";
import { loadEntryMasters } from "../_lib/load";

export const metadata: Metadata = { title: "New GRN" };

export default async function NewGrnPage() {
  const user = await requirePermission("grn.create");
  const masters = await loadEntryMasters(user);
  return (
    <GrnEntry
      masters={masters}
      initial={{
        grnDate: masters.today,
        locationId: user.currentLocationId ? String(user.currentLocationId) : "",
        supplierId: "",
        invoiceNo: "",
        invoiceDate: "",
        invoiceValue: "",
        transportId: "",
        lrNo: "",
        transportDate: "",
      }}
      canEdit
      canQuickAddSupplier={can(user.role, "supplier.quickCreate")}
      canAddCategoryValue={can(user.role, "category.addValue")}
      canGenerateBarcode={can(user.role, "barcode.generate") && can(user.role, "grn.create")}
      canSave={can(user.role, "grn.save") && can(user.role, "barcode.generate")}
    />
  );
}
