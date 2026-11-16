"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { cancelReturn } from "@/lib/sales/return-cancel";
import { returnSaveSchema } from "@/lib/validation/sales-return";
import { saveReturn } from "./_lib/save-return";
import type { ActionResult } from "@/lib/action-result";
import { customerAccount, type CustomerAccount } from "@/lib/customers";
import { ActionError, db, runAction } from "@/lib/server-action";
import { findByBarcode, type ScannedProduct } from "../sales/_lib/queries";
import { billLines, customerBills, returnHints, type BillLine, type ReturnableBill, type ReturnHint } from "./_lib/queries";

const id = z.number().int().positive();

/** Balance / pending bills / credit, plus the bills a return can be made against. */
export async function returnCustomerAction(raw: unknown): Promise<ActionResult<{ account: CustomerAccount; bills: ReturnableBill[] }>> {
  return runAction("salesReturn.create", z.object({ id, q: z.string().max(40).optional() }), raw, async ({ id: customerId, q }) => {
    const [account, bills] = await Promise.all([customerAccount(db, customerId), customerBills(db, customerId, q)]);
    return { ok: true, data: { account, bills } };
  });
}

/** Bills of a customer matching a bill-number fragment (Walk-in Customer search). */
export async function searchReturnBillsAction(raw: unknown): Promise<ActionResult<ReturnableBill[]>> {
  return runAction("salesReturn.create", z.object({ customerId: id, q: z.string().max(40) }), raw, async ({ customerId, q }) => ({
    ok: true,
    data: await customerBills(db, customerId, q, 30),
  }));
}

/** Lines of the bill the return is against (with qty already returned per line). */
export async function returnBillLinesAction(raw: unknown): Promise<ActionResult<BillLine[]>> {
  return runAction("salesReturn.create", z.object({ salesId: id }), raw, async ({ salesId }) => ({ ok: true, data: await billLines(db, salesId) }));
}

/** Sold / returned / last rate for products already on the return (after the customer changes). */
export async function returnHintsAction(raw: unknown): Promise<ActionResult<Record<number, ReturnHint>>> {
  return runAction("salesReturn.create", z.object({ customerId: id, productIds: z.array(id).max(500) }), raw, async ({ customerId, productIds }) => ({
    ok: true,
    data: await returnHints(db, customerId, productIds),
  }));
}

export type SaveReturnResult = { id: number; returnNo: string; net: number; refund: number; refundMode: "CASH" | "BANK1" | "BANK2" | null; balanceAfter: number };

/** Save Sales Return — one transaction (see saveReturn). */
export async function saveReturnAction(raw: unknown): Promise<ActionResult<SaveReturnResult>> {
  return runAction("salesReturn.create", returnSaveSchema, raw, async (input, user) => {
    const r = await db.transaction((tx) => saveReturn(tx, input, user));
    revalidatePath("/sales-returns", "layout");
    revalidatePath("/customers", "layout");
    return { ok: true, data: r, message: `Saved ${r.returnNo}` };
  });
}

/** Cancel a credit note — reverses stock, credit applications, ledger and any refund (Admin). */
export async function cancelReturnAction(raw: unknown): Promise<ActionResult<{ returnNo: string }>> {
  return runAction(
    "salesReturn.cancel",
    z.object({
      id,
      version: id,
      reason: z.string().trim().min(5, "Enter a reason (at least 5 characters)").max(500, "Max 500 characters"),
    }),
    raw,
    async (input, user) => {
      const r = await db.transaction((tx) => cancelReturn(tx, input, user));
      revalidatePath("/sales-returns", "layout");
      revalidatePath("/sales", "layout");
      revalidatePath("/customers", "layout");
      return { ok: true, data: { returnNo: r.returnNo }, message: `${r.returnNo} cancelled${r.refundReversed ? ` · refund ₹${(r.refundReversed / 100).toFixed(2)} reversed` : ""}` };
    },
  );
}

export type ReturnScan = ScannedProduct & { hint: ReturnHint };

/** Product by barcode, with what this customer bought of it. */
export async function returnLookupAction(raw: unknown): Promise<ActionResult<ReturnScan>> {
  return runAction(
    "salesReturn.create",
    z.object({ barcode: z.string().trim().min(1).max(40), locationId: id, customerId: id }),
    raw,
    async ({ barcode, locationId, customerId }, user) => {
      if (!user.locations.some((l) => l.id === locationId)) throw new ActionError("You don't have access to this location");
      const p = await findByBarcode(db, barcode, locationId);
      if (!p) return { ok: false, error: `Barcode "${barcode}" not found` };
      const hint = (await returnHints(db, customerId, [p.productId]))[p.productId];
      return { ok: true, data: { ...p, hint } };
    },
  );
}
