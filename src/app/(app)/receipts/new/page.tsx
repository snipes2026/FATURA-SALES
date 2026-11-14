import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { getCustomer } from "@/app/(app)/sales/_lib/queries";
import { db, schema } from "@/db";
import { todayIST } from "@/lib/dates";
import { requirePermission } from "@/lib/session";
import { ReceiptScreen } from "../_components/receipt-screen";

export const metadata: Metadata = { title: "Customer Receipt" };

export default async function NewReceiptPage({ searchParams }: { searchParams: Promise<{ customer?: string }> }) {
  const user = await requirePermission("receipt.create");
  const id = Number((await searchParams).customer);
  const [[s], initial] = await Promise.all([
    db.select().from(schema.salesSettings).where(eq(schema.salesSettings.id, 1)),
    Number.isInteger(id) && id > 0 ? getCustomer(db, id) : Promise.resolve(null),
  ]);
  return (
    <ReceiptScreen
      today={todayIST()}
      locations={user.locations}
      defaultLocationId={user.currentLocationId}
      initialCustomer={initial && !initial.isWalkin ? initial : null}
      bank1Name={s?.bank1Name ?? "Bank 1"}
      bank2Name={s?.bank2Name ?? "Bank 2"}
      bank2Enabled={s?.bank2Enabled ?? false}
    />
  );
}
