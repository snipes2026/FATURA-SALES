import "server-only";
import { and, eq } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import { COUNTER } from "@/lib/counters";
import { financialYear } from "@/lib/dates";
import { formatAmount } from "@/lib/india";
import { fromPaise, toPaise } from "@/lib/money";
import type { AllocateResult } from "@/lib/sales/allocate";
import { addCredit } from "@/lib/sales/credits";
import { formatDocNo } from "@/lib/validation/sales";

type SalesSettingsRow = typeof schema.salesSettings.$inferSelect;

export async function loadSalesSettings(tx: Tx): Promise<SalesSettingsRow> {
  const [s] = await tx.select().from(schema.salesSettings).where(eq(schema.salesSettings.id, 1));
  if (s) return s;
  const [created] = await tx.insert(schema.salesSettings).values({ id: 1 }).onConflictDoNothing().returning();
  return created ?? (await tx.select().from(schema.salesSettings).where(eq(schema.salesSettings.id, 1)))[0];
}

/**
 * Next bill / receipt number for the financial year of `date`, under a
 * SELECT … FOR UPDATE lock on the counters row (gap-free, no duplicates).
 */
export async function nextDocNo(tx: Tx, kind: "INVOICE" | "RECEIPT" | "SALES_RETURN", date: string, s: SalesSettingsRow) {
  const fy = financialYear(date);
  const name = COUNTER[kind];
  await tx.insert(schema.counters).values({ name, fy, lastValue: 0 }).onConflictDoNothing();
  const [c] = await tx
    .select()
    .from(schema.counters)
    .where(and(eq(schema.counters.name, name), eq(schema.counters.fy, fy)))
    .for("update");
  const next = c.lastValue + 1;
  await tx
    .update(schema.counters)
    .set({ lastValue: next })
    .where(and(eq(schema.counters.name, name), eq(schema.counters.fy, fy)));
  const fmt =
    kind === "INVOICE"
      ? { prefix: s.invoicePrefix, digits: s.invoiceDigits }
      : kind === "RECEIPT"
        ? { prefix: s.receiptPrefix, digits: s.receiptDigits }
        : { prefix: s.returnPrefix, digits: s.returnDigits };
  return { no: formatDocNo(fmt, fy, next), fy };
}

export type KeptModes = { CASH: number; BANK1: number; BANK2: number }; // paise actually kept per mode (cash net of change)

export function modeLabel(mode: "CASH" | "BANK1" | "BANK2", s: Pick<SalesSettingsRow, "bank1Name" | "bank2Name">) {
  return mode === "CASH" ? "Cash" : mode === "BANK1" ? s.bank1Name : s.bank2Name;
}

const rs = (p: number) => `₹${formatAmount(fromPaise(p))}`;

/**
 * Writes a receipt (with a sale or standalone): receipts, receipt_modes,
 * receipt_allocations, customer_ledger (RECEIPT Cr per allocation, ADVANCE Cr)
 * and cash_bank_ledger (IN per mode). Returns null when nothing was received.
 */
export async function postReceipt(
  tx: Tx,
  p: {
    customerId: number;
    locationId: number;
    date: string;
    source: "SALE" | "STANDALONE";
    salesId: number | null;
    currentBillNo: string | null; // ref for the CURRENT row (sale receipts)
    modes: KeptModes;
    pay: AllocateResult;
    settings: SalesSettingsRow;
    userId: number;
    remarks?: string | null;
  },
) {
  const total = p.modes.CASH + p.modes.BANK1 + p.modes.BANK2;
  if (total <= 0) return null;
  const { no, fy } = await nextDocNo(tx, "RECEIPT", p.date, p.settings);
  const [r] = await tx
    .insert(schema.receipts)
    .values({
      receiptNo: no,
      fy,
      receiptDate: p.date,
      customerId: p.customerId,
      locationId: p.locationId,
      source: p.source,
      salesId: p.salesId,
      totalAmount: fromPaise(total),
      remarks: p.remarks ?? null,
      createdBy: p.userId,
    })
    .returning({ id: schema.receipts.id });

  const modes = (["CASH", "BANK1", "BANK2"] as const).filter((m) => p.modes[m] > 0);
  await tx.insert(schema.receiptModes).values(modes.map((m) => ({ receiptId: r.id, mode: m, amount: fromPaise(p.modes[m]) })));
  const modeText = modes.map((m) => `${modeLabel(m, p.settings)} ${rs(p.modes[m])}`).join(" + ");

  // Allocations (previous dues / this bill) + advance
  type Alloc = { targetType: "OPENING" | "BILL" | "ADVANCE"; salesId: number | null; ref: string; amount: number };
  const allocs: Alloc[] = p.pay.rows
    .filter((row) => row.amount > 0)
    .map((row) => ({
      targetType: row.kind === "OPENING" ? "OPENING" : "BILL",
      salesId: row.kind === "CURRENT" ? p.salesId : (row.salesId ?? null),
      ref: row.kind === "CURRENT" ? (p.currentBillNo ?? "this bill") : row.ref,
      amount: row.amount,
    }));
  if (p.pay.advanceCreated > 0) allocs.push({ targetType: "ADVANCE", salesId: null, ref: "Advance", amount: p.pay.advanceCreated });
  const allocated = allocs.reduce((a, x) => a + x.amount, 0);
  if (allocated !== total) throw new Error(`Receipt ${no}: allocated ${allocated} ≠ received ${total}`);

  const allocRows = await tx
    .insert(schema.receiptAllocations)
    .values(allocs.map((a) => ({ receiptId: r.id, targetType: a.targetType, salesId: a.salesId, amount: fromPaise(a.amount) })))
    .returning({ id: schema.receiptAllocations.id, targetType: schema.receiptAllocations.targetType, amount: schema.receiptAllocations.amount });
  // Money kept as advance goes into the customer's credit pool
  for (const a of allocRows)
    if (a.targetType === "ADVANCE")
      await addCredit(tx, { customerId: p.customerId, sourceType: "ADVANCE", sourceId: a.id, date: p.date, amount: toPaise(a.amount), userId: p.userId });

  await tx.insert(schema.customerLedger).values(
    allocs.map((a) => ({
      customerId: p.customerId,
      entryDate: p.date,
      voucherType: a.targetType === "ADVANCE" ? ("ADVANCE" as const) : ("RECEIPT" as const),
      voucherId: r.id,
      voucherNo: no,
      particulars:
        a.targetType === "ADVANCE"
          ? `Advance received · ${modeText}${allocs.length > 1 ? " (receipt total)" : ""}`
          : `Against ${a.ref} · ${modeText}${allocs.length > 1 ? " (receipt total)" : ""}`,
      debit: "0",
      credit: fromPaise(a.amount),
      createdBy: p.userId,
    })),
  );

  await tx.insert(schema.cashBankLedger).values(
    modes.map((m) => ({
      entryDate: p.date,
      mode: m,
      direction: "IN" as const,
      amount: fromPaise(p.modes[m]),
      refType: "RECEIPT",
      refId: r.id,
      customerId: p.customerId,
      locationId: p.locationId,
      createdBy: p.userId,
    })),
  );

  return { id: r.id, receiptNo: no, total };
}
