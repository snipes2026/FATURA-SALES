import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { todayIST } from "@/lib/dates";
import { can } from "@/lib/permissions";
import { requirePermission } from "@/lib/session";
import { BillingScreen } from "../_components/billing-screen";
import { getWalkin } from "../_lib/queries";

export const metadata: Metadata = { title: "New Sale" };

export default async function NewSalePage() {
  const user = await requirePermission("sales.create");
  const [[settings], [company], walkin] = await Promise.all([
    db.select().from(schema.salesSettings).where(eq(schema.salesSettings.id, 1)),
    db.select({ stateCode: schema.companyProfile.stateCode }).from(schema.companyProfile).where(eq(schema.companyProfile.id, 1)),
    getWalkin(db),
  ]);

  return (
    <BillingScreen
      today={todayIST()}
      companyStateCode={company?.stateCode ?? ""}
      locations={user.locations}
      defaultLocationId={user.currentLocationId}
      walkin={walkin}
      canQuickAddCustomer={can(user.role, "customer.quickCreate")}
      settings={{
        allowPriceEdit: settings?.allowPriceEdit ?? false,
        allowNegativeStock: settings?.allowNegativeStock ?? false,
        autoIncrementQty: settings?.autoIncrementQty ?? true,
        defaultGstMode: settings?.defaultGstMode ?? "INCLUDES",
        bank1Name: settings?.bank1Name ?? "Bank 1",
        bank2Name: settings?.bank2Name ?? "Bank 2",
        bank2Enabled: settings?.bank2Enabled ?? false,
        walkinAllowCredit: settings?.walkinAllowCredit ?? false,
        walkinAllowAdvance: settings?.walkinAllowAdvance ?? false,
      }}
    />
  );
}
