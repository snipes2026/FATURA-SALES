import "server-only";
import { eq } from "drizzle-orm";
import type { z } from "zod";
import { schema, type Tx } from "@/db";
import { computePayment } from "@/components/payments/payment-state";
import { customerAccount } from "@/lib/customers";
import { todayIST } from "@/lib/dates";
import { fromPaise, toPaise } from "@/lib/money";
import { loadSalesSettings, postReceipt } from "@/lib/sales/posting";
import { ActionError, audit } from "@/lib/server-action";
import type { CurrentUser } from "@/lib/session";
import type { receiptSaveSchema } from "@/lib/validation/sales";

type ReceiptInput = z.output<typeof receiptSaveSchema>;

/**
 * Standalone customer receipt (collecting credit later), in ONE transaction:
 * lock the customer → allocate with the same rules as billing (previous-first
 * FIFO by default, editable; advance only when nothing stays pending) →
 * receipt, modes, allocations, customer ledger, cash/bank ledger → audit.
 */
export async function saveReceipt(tx: Tx, input: ReceiptInput, user: Pick<CurrentUser, "id" | "locations">) {
  const settings = await loadSalesSettings(tx);
  const [customer] = await tx.select().from(schema.customers).where(eq(schema.customers.id, input.customerId)).for("update");
  if (!customer) throw new ActionError("This customer no longer exists");
  if (customer.isWalkin) throw new ActionError("Receipts can't be taken for the Walk-in Customer");
  if (!user.locations.some((l) => l.id === input.locationId)) throw new ActionError("You don't have access to this location");
  if (input.receiptDate > todayIST()) throw new ActionError("Receipt date can't be in the future", "receiptDate");

  const account = await customerAccount(tx, customer.id);
  const pay = computePayment(
    { ...input.payment, advanceUsed: null },
    {
      billAmount: 0,
      dues: account.dues,
      advanceAvailable: account.advanceAvailable,
      isWalkin: false,
      walkinAllowCredit: false,
      walkinAllowAdvance: false,
      bank2Enabled: settings.bank2Enabled,
    },
  );
  if (!pay.ok) throw new ActionError(pay.errors[0].message, undefined, pay.errors[0].code.startsWith("ALLOC") ? "CONFLICT" : undefined);

  const cash = toPaise(input.payment.cash || "0");
  const modes = { CASH: cash - pay.change, BANK1: toPaise(input.payment.bank1 || "0"), BANK2: settings.bank2Enabled ? toPaise(input.payment.bank2 || "0") : 0 };
  const receipt = await postReceipt(tx, {
    customerId: customer.id,
    locationId: input.locationId,
    date: input.receiptDate,
    source: "STANDALONE",
    salesId: null,
    currentBillNo: null,
    modes,
    pay,
    settings,
    userId: user.id,
    remarks: input.remarks,
  });
  if (!receipt) throw new ActionError("Enter the amount received");

  const balanceAfter = account.balancePaise - pay.kept;
  await audit(tx, {
    userId: user.id,
    table: "receipts",
    recordId: receipt.id,
    action: "CREATE",
    newValue: {
      receiptNo: receipt.receiptNo,
      customer: customer.name,
      total: fromPaise(receipt.total),
      allocations: pay.rows.filter((r) => r.amount > 0).map((r) => ({ ref: r.ref, amount: fromPaise(r.amount) })),
      advance: fromPaise(pay.advanceCreated),
      change: fromPaise(pay.change),
    },
  });
  return { id: receipt.id, receiptNo: receipt.receiptNo, total: receipt.total, change: pay.change, balanceAfter };
}
