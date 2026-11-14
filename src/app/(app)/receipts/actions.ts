"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/action-result";
import { db, runAction } from "@/lib/server-action";
import { receiptSaveSchema } from "@/lib/validation/sales";
import { saveReceipt } from "./_lib/save-receipt";

export type SaveReceiptResult = { id: number; receiptNo: string; total: number; change: number; balanceAfter: number };

export async function saveReceiptAction(raw: unknown): Promise<ActionResult<SaveReceiptResult>> {
  return runAction("receipt.create", receiptSaveSchema, raw, async (input, user) => {
    const r = await db.transaction((tx) => saveReceipt(tx, input, user));
    revalidatePath("/customers", "layout");
    return { ok: true, data: r, message: `Saved receipt ${r.receiptNo}` };
  });
}
