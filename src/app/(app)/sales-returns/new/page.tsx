import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { todayIST } from "@/lib/dates";
import { requirePermission } from "@/lib/session";
import { getWalkin } from "../../sales/_lib/queries";
import { ReturnScreen } from "../_components/return-screen";

export const metadata: Metadata = { title: "Sales Return" };

export default async function NewSalesReturnPage() {
  const user = await requirePermission("salesReturn.create");
  const [[s], walkin] = await Promise.all([db.select().from(schema.salesSettings).where(eq(schema.salesSettings.id, 1)), getWalkin(db)]);
  return (
    <ReturnScreen
      today={todayIST()}
      locations={user.locations}
      defaultLocationId={user.currentLocationId}
      walkin={walkin}
      settings={{
        returnQtyCheck: s?.returnQtyCheck ?? "WARN",
        autoIncrementQty: s?.autoIncrementQty ?? true,
        defaultGstMode: s?.defaultGstMode ?? "INCLUDES",
        bank1Name: s?.bank1Name ?? "Bank 1",
        bank2Name: s?.bank2Name ?? "Bank 2",
        bank2Enabled: s?.bank2Enabled ?? false,
      }}
    />
  );
}
