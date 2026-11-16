import "server-only";
import { schema, type Tx } from "@/db";
import { customerAccount } from "@/lib/customers";
import { formatAmount } from "@/lib/india";
import { fromPaise } from "@/lib/money";
import { applyCredit } from "@/lib/sales/credits";

const rs = (p: number) => `₹${formatAmount(fromPaise(p))}`;

/**
 * Enforces "a customer is never in Debit and in Credit at the same time": when
 * the customer holds unused credit (advance / return credit) and also has
 * pending dues (opening balance, unpaid bills), the credit is applied to the
 * dues oldest first. Runs at the end of every save / cancel that can create
 * credit or make a bill pending again — inside that transaction, under the
 * customer row lock. Writes an information-only SETTLEMENT row (0 / 0) per due
 * so the ledger shows what happened; the balance doesn't move.
 * Returns the total applied, paise.
 */
export async function settleCredits(tx: Tx, customerId: number, date: string, userId: number, reason?: string): Promise<number> {
  const acc = await customerAccount(tx, customerId);
  let left = acc.advanceAvailable;
  if (left <= 0 || acc.dues.length === 0) return 0;

  let total = 0;
  for (const d of acc.dues) {
    if (left <= 0) break;
    const amount = Math.min(left, d.pending);
    if (amount <= 0) continue;
    await applyCredit(tx, {
      customerId,
      amount,
      target: d.kind === "BILL" ? { type: "BILL", salesId: d.salesId! } : { type: "OPENING" },
      date,
      userId,
    });
    await tx.insert(schema.customerLedger).values({
      customerId,
      entryDate: date,
      voucherType: "SETTLEMENT",
      voucherId: d.kind === "BILL" ? d.salesId! : customerId,
      voucherNo: d.kind === "BILL" ? d.ref : "OPENING",
      particulars: `Advance ${rs(amount)} adjusted against ${d.ref}${reason ? ` — ${reason}` : ""}`,
      debit: "0",
      credit: "0",
      createdBy: userId,
    });
    left -= amount;
    total += amount;
  }
  return total;
}
