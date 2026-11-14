"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { schema } from "@/db";
import type { ActionResult } from "@/lib/action-result";
import { createCustomer, customerIsUsed, replaceOpening } from "@/lib/customers";
import { toPaise } from "@/lib/money";
import { ActionError, audit, db, runAction } from "@/lib/server-action";
import { customerSchema } from "@/lib/validation/sales";

export async function saveCustomer(raw: unknown): Promise<ActionResult<{ id: number }>> {
  return runAction("settings.manage", customerSchema, raw, async ({ id, ...input }, user) => {
    const savedId = await db.transaction(async (tx) => {
      if (!id) return (await createCustomer(tx, input, user.id)).id;

      const [old] = await tx.select().from(schema.customers).where(eq(schema.customers.id, id)).for("update");
      if (!old) throw new ActionError("This customer no longer exists");
      if (old.isWalkin) {
        if (!input.isActive) throw new ActionError("Walk-in Customer can't be deactivated", "isActive");
        if (toPaise(input.openingBalance) !== 0) throw new ActionError("Walk-in Customer can't have an opening balance", "openingBalance");
      }
      const openingChanged =
        toPaise(old.openingBalance) !== toPaise(input.openingBalance) || old.openingType !== input.openingType || old.openingDate !== input.openingDate;
      if (openingChanged) {
        if (await customerIsUsed(tx, id))
          throw new ActionError("This customer already has bills or receipts — the opening balance can no longer be changed", "openingBalance");
        await replaceOpening(tx, id, input, user.id);
      }
      await tx.update(schema.customers).set(input).where(eq(schema.customers.id, id));
      await audit(tx, { userId: user.id, table: "customers", recordId: id, action: "UPDATE", oldValue: old, newValue: input });
      return id;
    });
    revalidatePath("/settings/customers");
    return { ok: true, data: { id: savedId }, message: id ? "Customer updated" : "Customer added" };
  });
}

export async function deleteCustomer(raw: unknown): Promise<ActionResult> {
  return runAction("settings.manage", z.object({ id: z.number().int().positive() }), raw, async ({ id }, user) => {
    await db.transaction(async (tx) => {
      const [old] = await tx.select().from(schema.customers).where(eq(schema.customers.id, id)).for("update");
      if (!old) throw new ActionError("This customer no longer exists");
      if (old.isWalkin) throw new ActionError("Walk-in Customer can't be deleted");
      if (await customerIsUsed(tx, id)) throw new ActionError("This customer has bills or receipts — deactivate it instead");
      await tx.delete(schema.customerLedger).where(eq(schema.customerLedger.customerId, id)); // OPENING row only
      await tx.delete(schema.customers).where(eq(schema.customers.id, id));
      await audit(tx, { userId: user.id, table: "customers", recordId: id, action: "DELETE", oldValue: old });
    });
    revalidatePath("/settings/customers");
    return { ok: true, message: "Customer deleted" };
  });
}

export type NewCustomer = { id: number; name: string; phone: string; gstin: string; stateCode: string; balancePaise: number };

/** "+ Add Customer" from the billing / receipt screens. */
export async function quickCreateCustomer(raw: unknown): Promise<ActionResult<NewCustomer>> {
  return runAction("customer.quickCreate", customerSchema, raw, async ({ id: _id, ...input }, user) => {
    const row = await db.transaction((tx) => createCustomer(tx, { ...input, isActive: true }, user.id));
    revalidatePath("/settings/customers");
    const ob = toPaise(row.openingBalance);
    return {
      ok: true,
      message: "Customer added",
      data: {
        id: row.id,
        name: row.name,
        phone: row.phone,
        gstin: row.gstin ?? "",
        stateCode: row.stateCode,
        balancePaise: row.openingType === "DR" ? ob : -ob,
      },
    };
  });
}
