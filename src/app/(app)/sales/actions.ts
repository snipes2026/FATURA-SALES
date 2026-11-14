"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { cancelReceipt, cancelSale } from "@/lib/sales/cancel";
import { saleSaveSchema } from "@/lib/validation/sales";
import { saveSale } from "./_lib/save-sale";
import type { ActionResult } from "@/lib/action-result";
import { customerAccount, type CustomerAccount } from "@/lib/customers";
import { ActionError, db, runAction } from "@/lib/server-action";
import { findByBarcode, getCustomer, searchCustomers, stockAt, type CustomerHit, type ScannedProduct } from "./_lib/queries";

export async function searchCustomersAction(raw: unknown): Promise<ActionResult<CustomerHit[]>> {
  return runAction("sales.view", z.object({ q: z.string().max(100) }), raw, async ({ q }) => ({ ok: true, data: await searchCustomers(db, q) }));
}

export async function getCustomerAction(raw: unknown): Promise<ActionResult<CustomerHit>> {
  return runAction("sales.view", z.object({ id: z.number().int().positive() }), raw, async ({ id }) => {
    const c = await getCustomer(db, id);
    if (!c) throw new ActionError("This customer no longer exists");
    return { ok: true, data: c };
  });
}

/** Balance, pending bills and unused advance — for the payment panel. */
export async function customerAccountAction(raw: unknown): Promise<ActionResult<CustomerAccount>> {
  return runAction("sales.view", z.object({ id: z.number().int().positive() }), raw, async ({ id }) => ({
    ok: true,
    data: await customerAccount(db, id),
  }));
}

/** Stock at a location for products already on the bill (after the location is changed). */
export async function stockAtAction(raw: unknown): Promise<ActionResult<Record<number, number>>> {
  return runAction(
    "sales.create",
    z.object({ locationId: z.number().int().positive(), productIds: z.array(z.number().int().positive()).max(500) }),
    raw,
    async ({ locationId, productIds }, user) => {
      if (!user.locations.some((l) => l.id === locationId)) throw new ActionError("You don't have access to this location");
      return { ok: true, data: await stockAt(db, locationId, productIds) };
    },
  );
}

export type SaveSaleResult = { id: number; billNo: string; receiptNo: string | null; net: number; change: number; balanceAfter: number };

/** Save Sale — one transaction (see saveSale). */
export async function saveSaleAction(raw: unknown): Promise<ActionResult<SaveSaleResult>> {
  return runAction("sales.create", saleSaveSchema, raw, async (input, user) => {
    const r = await db.transaction((tx) => saveSale(tx, input, user));
    revalidatePath("/sales");
    return { ok: true, data: r, message: `Saved ${r.billNo}` };
  });
}

const reasonSchema = z.string().trim().min(5, "Enter a reason (at least 5 characters)").max(500, "Max 500 characters");

/** Cancel a bill — reverses stock, ledger, advance and allocations (Admin). */
export async function cancelSaleAction(raw: unknown): Promise<ActionResult<{ billNo: string }>> {
  return runAction(
    "sales.cancel",
    z.object({ id: z.number().int().positive(), version: z.number().int().positive(), reason: reasonSchema }),
    raw,
    async (input, user) => {
      const r = await db.transaction((tx) => cancelSale(tx, input, user));
      revalidatePath("/sales", "layout");
      revalidatePath("/customers", "layout");
      const money = r.refunded ? ` · refund ₹${(r.refunded / 100).toFixed(2)}` : r.paid ? ` · ₹${(r.paid / 100).toFixed(2)} kept as advance` : "";
      return { ok: true, data: { billNo: r.billNo }, message: `${r.billNo} cancelled${money}` };
    },
  );
}

/** Cancel a receipt — reverses its allocations, ledger and cash/bank entries (Admin). */
export async function cancelReceiptAction(raw: unknown): Promise<ActionResult<{ receiptNo: string }>> {
  return runAction("sales.cancel", z.object({ id: z.number().int().positive(), reason: reasonSchema }), raw, async (input, user) => {
    const r = await db.transaction((tx) => cancelReceipt(tx, input, user));
    revalidatePath("/sales", "layout");
    revalidatePath("/customers", "layout");
    return { ok: true, data: r, message: `${r.receiptNo} cancelled` };
  });
}

export async function lookupBarcodeAction(raw: unknown): Promise<ActionResult<ScannedProduct>> {
  return runAction(
    "sales.create",
    z.object({ barcode: z.string().trim().min(1).max(40), locationId: z.number().int().positive() }),
    raw,
    async ({ barcode, locationId }, user) => {
      if (!user.locations.some((l) => l.id === locationId)) throw new ActionError("You don't have access to this location");
      const p = await findByBarcode(db, barcode, locationId);
      if (!p) return { ok: false, error: `Barcode "${barcode}" not found` };
      return { ok: true, data: p };
    },
  );
}
