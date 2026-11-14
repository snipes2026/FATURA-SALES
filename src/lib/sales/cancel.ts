import "server-only";
import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import { customerAccount } from "@/lib/customers";
import { todayIST } from "@/lib/dates";
import { formatAmount } from "@/lib/india";
import { fromPaise, toPaise } from "@/lib/money";
import { ActionError, audit } from "@/lib/server-action";
import type { CurrentUser } from "@/lib/session";

const rs = (p: number) => `₹${formatAmount(fromPaise(p))}`;
type User = Pick<CurrentUser, "id" | "locations">;

/**
 * Cancel a sales bill (no edit, no delete) — reversing entries only:
 *  - stock comes back (stock_ledger IN, SALE_CANCEL)
 *  - customer ledger: SALE_CANCEL Cr for the net amount
 *  - earlier advance used on the bill is released (adjustment reversed)
 *  - money paid against the bill with its own receipt stays with the customer as
 *    an ADVANCE; for the Walk-in Customer (who can't hold an advance) it is refunded
 * Blocked while a later receipt is allocated to the bill — cancel that receipt first.
 */
export async function cancelSale(tx: Tx, p: { id: number; version: number; reason: string }, user: User) {
  const [h] = await tx.select().from(schema.salesHeader).where(eq(schema.salesHeader.id, p.id)).for("update");
  if (!h) throw new ActionError("This bill no longer exists", undefined, "NOT_FOUND");
  if (!user.locations.some((l) => l.id === h.locationId)) throw new ActionError("You don't have access to this bill");
  if (h.status === "CANCELLED") throw new ActionError(`${h.billNo} is already cancelled`);
  if (h.version !== p.version) throw new ActionError("This bill was changed by someone else. Reload it and try again.", undefined, "CONFLICT");
  const [customer] = await tx.select().from(schema.customers).where(eq(schema.customers.id, h.customerId)).for("update");

  const [own] = await tx
    .select()
    .from(schema.receipts)
    .where(and(eq(schema.receipts.salesId, h.id), eq(schema.receipts.source, "SALE"), eq(schema.receipts.status, "SAVED")));

  // Later receipts allocated to this bill block the cancel
  const later = await tx
    .select({ receiptNo: schema.receipts.receiptNo })
    .from(schema.receiptAllocations)
    .innerJoin(schema.receipts, eq(schema.receipts.id, schema.receiptAllocations.receiptId))
    .where(
      and(
        eq(schema.receiptAllocations.salesId, h.id),
        eq(schema.receiptAllocations.targetType, "BILL"),
        isNull(schema.receiptAllocations.reversedAt),
        own ? ne(schema.receipts.id, own.id) : undefined,
      ),
    );
  if (later.length)
    throw new ActionError(
      `Receipt${later.length > 1 ? "s" : ""} ${[...new Set(later.map((l) => l.receiptNo))].join(", ")} ${later.length > 1 ? "were" : "was"} allocated to ${h.billNo}. Cancel ${later.length > 1 ? "those receipts" : "that receipt"} first.`,
    );

  const today = todayIST();
  const now = new Date();

  // 1. Stock back
  const lines = await tx.select().from(schema.salesLines).where(eq(schema.salesLines.salesId, h.id));
  await tx.insert(schema.stockLedger).values(
    lines.map((l) => ({ locationId: h.locationId, productId: l.productId, qtyIn: l.qty, qtyOut: 0, refDocType: "SALE_CANCEL", refDocId: h.id, refLineId: l.id, createdBy: user.id })),
  );

  // 2. Ledger: reverse the sale
  await tx.insert(schema.customerLedger).values({
    customerId: h.customerId,
    entryDate: today,
    voucherType: "SALE_CANCEL",
    voucherId: h.id,
    voucherNo: h.billNo,
    particulars: `${h.billNo} cancelled — ${p.reason}`,
    debit: "0",
    credit: h.netAmount,
    createdBy: user.id,
  });

  // 3. Earlier advance used on this bill goes back to the customer
  const adjs = await tx
    .update(schema.advanceAdjustments)
    .set({ reversedAt: now, reversedBy: user.id })
    .where(and(eq(schema.advanceAdjustments.salesId, h.id), isNull(schema.advanceAdjustments.reversedAt)))
    .returning({ amount: schema.advanceAdjustments.amount });
  const advanceReleased = adjs.reduce((a, x) => a + toPaise(x.amount), 0);
  if (advanceReleased > 0)
    await tx.insert(schema.customerLedger).values({
      customerId: h.customerId,
      entryDate: today,
      voucherType: "SETTLEMENT",
      voucherId: h.id,
      voucherNo: h.billNo,
      particulars: `Advance ${rs(advanceReleased)} released — ${h.billNo} cancelled`,
      debit: "0",
      credit: "0",
      createdBy: user.id,
    });

  // 4. Money paid against this bill with its own receipt
  let paid = 0;
  let refunded = 0;
  if (own) {
    const allocs = await tx
      .update(schema.receiptAllocations)
      .set({ reversedAt: now, reversedBy: user.id })
      .where(
        and(
          eq(schema.receiptAllocations.receiptId, own.id),
          eq(schema.receiptAllocations.salesId, h.id),
          eq(schema.receiptAllocations.targetType, "BILL"),
          isNull(schema.receiptAllocations.reversedAt),
        ),
      )
      .returning({ amount: schema.receiptAllocations.amount });
    paid = allocs.reduce((a, x) => a + toPaise(x.amount), 0);
    if (paid > 0 && !customer.isWalkin) {
      await tx.insert(schema.receiptAllocations).values({ receiptId: own.id, targetType: "ADVANCE", salesId: null, amount: fromPaise(paid) });
      await tx.insert(schema.customerLedger).values({
        customerId: h.customerId,
        entryDate: today,
        voucherType: "SETTLEMENT",
        voucherId: own.id,
        voucherNo: own.receiptNo,
        particulars: `${rs(paid)} paid against ${h.billNo} kept as advance (bill cancelled)`,
        debit: "0",
        credit: "0",
        createdBy: user.id,
      });
    } else if (paid > 0) {
      // Walk-in: refund out of the same modes, cash first
      const modes = await tx.select().from(schema.receiptModes).where(eq(schema.receiptModes.receiptId, own.id));
      let left = paid;
      const out: { mode: "CASH" | "BANK1" | "BANK2"; amount: number }[] = [];
      for (const m of ["CASH", "BANK1", "BANK2"] as const) {
        const avail = toPaise(modes.find((x) => x.mode === m)?.amount ?? "0");
        const take = Math.min(avail, left);
        if (take > 0) out.push({ mode: m, amount: take });
        left -= take;
      }
      refunded = paid;
      await tx.insert(schema.customerLedger).values({
        customerId: h.customerId,
        entryDate: today,
        voucherType: "REFUND",
        voucherId: own.id,
        voucherNo: own.receiptNo,
        particulars: `Refund for cancelled ${h.billNo}`,
        debit: fromPaise(paid),
        credit: "0",
        createdBy: user.id,
      });
      await tx.insert(schema.cashBankLedger).values(
        out.map((o) => ({
          entryDate: today,
          mode: o.mode,
          direction: "OUT" as const,
          amount: fromPaise(o.amount),
          refType: "REFUND",
          refId: own.id,
          customerId: h.customerId,
          locationId: h.locationId,
          createdBy: user.id,
        })),
      );
    }
  }

  // 5. Header
  await tx
    .update(schema.salesHeader)
    .set({ status: "CANCELLED", cancelReason: p.reason, cancelledAt: now, cancelledBy: user.id, version: sql`${schema.salesHeader.version} + 1` })
    .where(eq(schema.salesHeader.id, h.id));

  await audit(tx, {
    userId: user.id,
    table: "sales_header",
    recordId: h.id,
    action: "CANCEL",
    oldValue: { status: "SAVED", billNo: h.billNo, net: h.netAmount },
    newValue: { status: "CANCELLED", stockReturned: lines.reduce((a, l) => a + l.qty, 0), advanceReleased: fromPaise(advanceReleased), paidKeptAsAdvance: fromPaise(paid - refunded), refunded: fromPaise(refunded) },
    reason: p.reason,
  });

  return { billNo: h.billNo, paid, refunded, advanceReleased };
}

/**
 * Cancel a receipt (money recorded by mistake / cheque bounced): its allocations
 * are reversed, the customer ledger gets RECEIPT_CANCEL Dr, cash/bank gets OUT.
 * Blocked when the advance it created has already been used on a later bill.
 */
export async function cancelReceipt(tx: Tx, p: { id: number; reason: string }, user: User) {
  const [r] = await tx.select().from(schema.receipts).where(eq(schema.receipts.id, p.id)).for("update");
  if (!r) throw new ActionError("This receipt no longer exists", undefined, "NOT_FOUND");
  if (!user.locations.some((l) => l.id === r.locationId)) throw new ActionError("You don't have access to this receipt");
  if (r.status === "CANCELLED") throw new ActionError(`${r.receiptNo} is already cancelled`);
  await tx.select({ id: schema.customers.id }).from(schema.customers).where(eq(schema.customers.id, r.customerId)).for("update");

  const allocs = await tx
    .select()
    .from(schema.receiptAllocations)
    .where(and(eq(schema.receiptAllocations.receiptId, r.id), isNull(schema.receiptAllocations.reversedAt)));
  const advance = allocs.filter((a) => a.targetType === "ADVANCE").reduce((s, a) => s + toPaise(a.amount), 0);
  if (advance > 0) {
    const acc = await customerAccount(tx, r.customerId);
    if (acc.advanceAvailable < advance)
      throw new ActionError(`${rs(advance - acc.advanceAvailable)} of the advance from ${r.receiptNo} has already been used on a later bill — cancel that bill first`);
  }

  // A walk-in refund already paid this receipt's money back — don't reverse it twice
  const [refund] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.customerLedger)
    .where(and(eq(schema.customerLedger.voucherType, "REFUND"), eq(schema.customerLedger.voucherId, r.id)));
  if (refund.n > 0) throw new ActionError(`${r.receiptNo} was already refunded when its bill was cancelled`);

  const now = new Date();
  const today = todayIST();
  await tx
    .update(schema.receiptAllocations)
    .set({ reversedAt: now, reversedBy: user.id })
    .where(and(eq(schema.receiptAllocations.receiptId, r.id), isNull(schema.receiptAllocations.reversedAt)));
  await tx.insert(schema.customerLedger).values({
    customerId: r.customerId,
    entryDate: today,
    voucherType: "RECEIPT_CANCEL",
    voucherId: r.id,
    voucherNo: r.receiptNo,
    particulars: `${r.receiptNo} cancelled — ${p.reason}`,
    debit: r.totalAmount,
    credit: "0",
    createdBy: user.id,
  });
  const modes = await tx.select().from(schema.receiptModes).where(eq(schema.receiptModes.receiptId, r.id));
  if (modes.length)
    await tx.insert(schema.cashBankLedger).values(
      modes.map((m) => ({
        entryDate: today,
        mode: m.mode,
        direction: "OUT" as const,
        amount: m.amount,
        refType: "RECEIPT_CANCEL",
        refId: r.id,
        customerId: r.customerId,
        locationId: r.locationId,
        createdBy: user.id,
      })),
    );
  await tx.update(schema.receipts).set({ status: "CANCELLED", cancelReason: p.reason, cancelledAt: now, cancelledBy: user.id }).where(eq(schema.receipts.id, r.id));
  await audit(tx, {
    userId: user.id,
    table: "receipts",
    recordId: r.id,
    action: "CANCEL",
    oldValue: { status: "SAVED", receiptNo: r.receiptNo, total: r.totalAmount },
    newValue: { status: "CANCELLED", allocationsReversed: allocs.length },
    reason: p.reason,
  });
  return { receiptNo: r.receiptNo };
}
