import "server-only";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { assertNoNegativeStock } from "@/app/(app)/grn/_lib/stock";
import { schema, type Tx } from "@/db";
import { todayIST } from "@/lib/dates";
import { formatAmount } from "@/lib/india";
import { fromPaise, toPaise } from "@/lib/money";
import { creditFor, reverseApplications, withdrawCredit } from "@/lib/sales/credits";
import { settleCredits } from "@/lib/sales/settle";
import { ActionError, audit } from "@/lib/server-action";
import type { CurrentUser } from "@/lib/session";

const rs = (p: number) => `₹${formatAmount(fromPaise(p))}`;
type User = Pick<CurrentUser, "id" | "locations">;

/**
 * Cancel a Sales Return (no edit, no delete) — reversing entries only, in ONE
 * transaction:
 *  - stock goes back out (stock_ledger OUT, SALES_RETURN_CANCEL) — refused if
 *    those pieces have since been sold and stock would go negative
 *  - the credit it created is withdrawn: applications to bills / opening are
 *    reversed (those bills are pending again), the refund application too
 *  - customer ledger: SALES_RETURN_CANCEL Dr for the return value, and for a
 *    refund REFUND_CANCEL Cr with the money back IN to cash / bank
 * Blocked while the advance it left has been used on a later bill — cancel that bill first.
 */
export async function cancelReturn(tx: Tx, p: { id: number; version: number; reason: string }, user: User) {
  const [h] = await tx.select().from(schema.salesReturnHeader).where(eq(schema.salesReturnHeader.id, p.id)).for("update");
  if (!h) throw new ActionError("This credit note no longer exists", undefined, "NOT_FOUND");
  if (!user.locations.some((l) => l.id === h.locationId)) throw new ActionError("You don't have access to this credit note");
  if (h.status === "CANCELLED") throw new ActionError(`${h.returnNo} is already cancelled`);
  if (h.version !== p.version) throw new ActionError("This credit note was changed by someone else. Reload it and try again.", undefined, "CONFLICT");
  await tx.select({ id: schema.customers.id }).from(schema.customers).where(eq(schema.customers.id, h.customerId)).for("update");

  const credit = await creditFor(tx, "SALES_RETURN", h.id);
  if (!credit) throw new Error(`${h.returnNo}: credit pool row missing`);

  // Applications made later (the leftover advance used on a later bill) block the cancel.
  // Those made by the return itself carry the save transaction's timestamp.
  const later = await tx
    .select({ salesId: schema.creditApplications.salesId, targetType: schema.creditApplications.targetType, amount: schema.creditApplications.amount, billNo: schema.salesHeader.billNo })
    .from(schema.creditApplications)
    .leftJoin(schema.salesHeader, eq(schema.salesHeader.id, schema.creditApplications.salesId))
    .where(
      and(
        eq(schema.creditApplications.creditId, credit.id),
        isNull(schema.creditApplications.reversedAt),
        // compared in SQL: a JS Date would lose the microseconds
        sql`${schema.creditApplications.createdAt} <> (select created_at from ${schema.salesReturnHeader} where id = ${h.id})`,
      ),
    );
  if (later.length) {
    const used = later.reduce((a, x) => a + toPaise(x.amount), 0);
    const where = [...new Set(later.map((x) => x.billNo ?? "the opening balance"))].join(", ");
    throw new ActionError(`${rs(used)} of the credit from ${h.returnNo} has since been used on ${where}. Cancel ${later.length > 1 ? "those bills" : "that bill"} first.`);
  }

  const today = todayIST();
  const now = new Date();

  // 1. Stock back out — must not go negative
  const lines = await tx.select().from(schema.salesReturnLines).where(eq(schema.salesReturnLines.returnId, h.id));
  const productIds = [...new Set(lines.map((l) => l.productId))].sort((a, b) => a - b);
  for (const pid of productIds) await tx.execute(sql`select pg_advisory_xact_lock(${h.locationId}, ${pid})`);
  await tx.insert(schema.stockLedger).values(
    lines.map((l) => ({ locationId: h.locationId, productId: l.productId, qtyIn: 0, qtyOut: l.qty, refDocType: "SALES_RETURN_CANCEL", refDocId: h.id, refLineId: l.id, createdBy: user.id })),
  );
  await assertNoNegativeStock(tx, h.locationId, productIds, `Cancelling ${h.returnNo}`);

  // 2. Credit withdrawn: bills / opening it paid are pending again, the refund is undone
  const reversed = await reverseApplications(tx, { creditId: credit.id }, user.id);
  const stillUsed = await withdrawCredit(tx, credit.id, user.id);
  if (stillUsed > 0) throw new Error(`${h.returnNo}: credit still used after reversal`);

  // 3. Ledger
  await tx.insert(schema.customerLedger).values({
    customerId: h.customerId,
    entryDate: today,
    voucherType: "SALES_RETURN_CANCEL",
    voucherId: h.id,
    voucherNo: h.returnNo,
    particulars: `${h.returnNo} cancelled — ${p.reason}`,
    debit: h.netAmount,
    credit: "0",
    createdBy: user.id,
  });
  const refund = toPaise(h.refundAmount);
  if (refund > 0) {
    await tx.insert(schema.customerLedger).values({
      customerId: h.customerId,
      entryDate: today,
      voucherType: "REFUND_CANCEL",
      voucherId: h.id,
      voucherNo: h.returnNo,
      particulars: `Refund for ${h.returnNo} reversed (credit note cancelled)`,
      debit: "0",
      credit: h.refundAmount,
      createdBy: user.id,
    });
    await tx.insert(schema.cashBankLedger).values({
      entryDate: today,
      mode: h.refundMode!,
      direction: "IN",
      amount: h.refundAmount,
      refType: "SALES_RETURN_CANCEL",
      refId: h.id,
      customerId: h.customerId,
      locationId: h.locationId,
      createdBy: user.id,
    });
  }

  // 4. Header
  await tx
    .update(schema.salesReturnHeader)
    .set({ status: "CANCELLED", cancelReason: p.reason, cancelledAt: now, cancelledBy: user.id, version: sql`${schema.salesReturnHeader.version} + 1` })
    .where(eq(schema.salesReturnHeader.id, h.id));

  // Bills it had paid are pending again — any other credit the customer holds goes to them
  const settled = await settleCredits(tx, h.customerId, today, user.id, `${h.returnNo} cancelled`);

  await audit(tx, {
    userId: user.id,
    table: "sales_return_header",
    recordId: h.id,
    action: "CANCEL",
    oldValue: { status: "SAVED", returnNo: h.returnNo, net: h.netAmount },
    newValue: {
      status: "CANCELLED",
      stockReversed: lines.reduce((a, l) => a + l.qty, 0),
      creditApplicationsReversed: fromPaise(reversed),
      refundReversed: fromPaise(refund),
      otherCreditSettled: fromPaise(settled),
    },
    reason: p.reason,
  });

  return { returnNo: h.returnNo, refundReversed: refund };
}

/** Bills whose pending amount this return reduced (for the cancel dialog). */
export async function returnAppliedBills(tx: Tx, returnId: number) {
  const credit = await creditFor(tx, "SALES_RETURN", returnId);
  if (!credit) return [];
  return tx
    .select({ billNo: schema.salesHeader.billNo, amount: schema.creditApplications.amount })
    .from(schema.creditApplications)
    .innerJoin(schema.salesHeader, eq(schema.salesHeader.id, schema.creditApplications.salesId))
    .where(and(eq(schema.creditApplications.creditId, credit.id), isNull(schema.creditApplications.reversedAt), inArray(schema.creditApplications.targetType, ["BILL"])));
}
