import "server-only";
import { eq, inArray, sql } from "drizzle-orm";
import type { z } from "zod";
import { schema, type Tx } from "@/db";
import { computePayment } from "@/components/payments/payment-state";
import { customerAccount } from "@/lib/customers";
import { todayIST } from "@/lib/dates";
import { formatAmount } from "@/lib/india";
import { fromPaise, toPaise } from "@/lib/money";
import { applyCredit } from "@/lib/sales/credits";
import { calcSale } from "@/lib/sales/gst";
import { settleCredits } from "@/lib/sales/settle";
import { loadSalesSettings, nextDocNo, postReceipt } from "@/lib/sales/posting";
import { ActionError, audit } from "@/lib/server-action";
import type { CurrentUser } from "@/lib/session";
import type { saleSaveSchema } from "@/lib/validation/sales";
import { stockAt } from "./queries";

type SaleInput = z.output<typeof saleSaveSchema>;
const rs = (p: number) => `₹${formatAmount(fromPaise(p))}`;

/**
 * Body of "Save Sale", run inside ONE transaction by the caller. The server
 * recalculates everything (prices, GST, totals, allocation) — client totals are
 * only compared, never trusted.
 *
 *  1. Lock the customer row (two cashiers can't allocate against the same dues at once)
 *  2. Bill number (FOR UPDATE on counters)
 *  3. Stock re-check under advisory locks per product+location, taken in sorted order
 *  4. Header + lines → stock_ledger OUT → advance adjustment → receipt/modes/allocations
 *     → customer_ledger (Sale Dr, Receipt Cr per allocation, Advance Cr) → cash_bank_ledger → audit
 */
export async function saveSale(tx: Tx, input: SaleInput, user: Pick<CurrentUser, "id" | "locations">) {
  const settings = await loadSalesSettings(tx);

  // 1. Customer
  const [customer] = await tx.select().from(schema.customers).where(eq(schema.customers.id, input.customerId)).for("update");
  if (!customer) throw new ActionError("This customer no longer exists");
  if (!customer.isActive) throw new ActionError(`${customer.name} is inactive`);
  if (!user.locations.some((l) => l.id === input.locationId)) throw new ActionError("You don't have access to this location");
  const [location] = await tx.select().from(schema.locations).where(eq(schema.locations.id, input.locationId));
  if (!location?.isActive) throw new ActionError("This location is inactive");
  if (input.billDate > todayIST()) throw new ActionError("Bill date can't be in the future", "billDate");

  // Prices: forced to the current WSP when price edit is off
  const productIds = [...new Set(input.lines.map((l) => l.productId))];
  const products = await tx
    .select({
      id: schema.products.id,
      barcode: schema.products.barcode,
      itemName: schema.products.itemName,
      isActive: schema.products.isActive,
      wsp: schema.products.wsp,
      purchaseRate: schema.products.purchaseRate,
      hsn: schema.departments.hsnCode,
      gstRate: schema.departments.gstRate,
      slabEnabled: schema.departments.slabEnabled,
      slabThreshold: schema.departments.slabThreshold,
      slabRateAbove: schema.departments.slabRateAbove,
    })
    .from(schema.products)
    .innerJoin(schema.departments, eq(schema.departments.id, schema.products.departmentId))
    .where(inArray(schema.products.id, productIds));
  const byId = new Map(products.map((p) => [p.id, p]));
  const lines = input.lines.map((l) => {
    const p = byId.get(l.productId);
    if (!p || !p.isActive) throw new ActionError("An item on the bill no longer exists — remove it and scan again");
    const rate = settings.allowPriceEdit ? l.rate : (p.wsp ?? "0");
    if (toPaise(rate) <= 0) throw new ActionError(`${p.itemName} (${p.barcode}) has no price`);
    return { ...l, p, ratePaise: toPaise(rate) };
  });

  // 2. Bill number
  const { no: billNo, fy } = await nextDocNo(tx, "INVOICE", input.billDate, settings);

  // 3. Stock, under advisory locks in a fixed order so parallel bills can't deadlock or oversell
  for (const pid of [...productIds].sort((a, b) => a - b)) await tx.execute(sql`select pg_advisory_xact_lock(${input.locationId}, ${pid})`);
  if (!settings.allowNegativeStock) {
    const stock = await stockAt(tx, input.locationId, productIds);
    const wanted = new Map<number, number>();
    for (const l of lines) wanted.set(l.productId, (wanted.get(l.productId) ?? 0) + l.qty);
    for (const [pid, q] of wanted)
      if (q > (stock[pid] ?? 0)) {
        const p = byId.get(pid)!;
        throw new ActionError(`${p.itemName} (${p.barcode}): only ${Math.max(stock[pid] ?? 0, 0)} in stock at ${location.name} — the bill has ${q}`);
      }
  }

  // Totals
  const taxType = customer.stateCode === location.stateCode ? "INTRA" : "INTER";
  const calc = calcSale({
    lines: lines.map((l) => ({ qty: l.qty, ratePaise: l.ratePaise, hsn: l.p.hsn, dept: l.p })),
    gstMode: input.gstMode,
    taxType,
    gstOverride: input.gstMode === "ADD" && input.gstOverride !== null ? toPaise(input.gstOverride) : null,
    roundOff: input.roundOff !== null ? toPaise(input.roundOff) : null,
  });
  if (calc.net <= 0) throw new ActionError("Net payable must be more than ₹0");
  if (calc.net !== toPaise(input.expectedNet))
    throw new ActionError(`The bill total changed to ${rs(calc.net)} (screen shows ${rs(toPaise(input.expectedNet))}) — prices may have been updated. Check the bill and save again.`, undefined, "MISMATCH");

  // Payment, against the customer's dues as they are now (row is locked)
  const account = await customerAccount(tx, customer.id);
  const pay = computePayment(
    { cash: input.payment.cash, bank1: input.payment.bank1, bank2: input.payment.bank2, advanceUsed: input.payment.advanceUsed, manual: input.payment.manual, excess: input.payment.excess },
    {
      billAmount: calc.net,
      dues: account.dues,
      advanceAvailable: account.advanceAvailable,
      isWalkin: customer.isWalkin,
      walkinAllowCredit: settings.walkinAllowCredit,
      walkinAllowAdvance: settings.walkinAllowAdvance,
      bank2Enabled: settings.bank2Enabled,
    },
  );
  if (!pay.ok) throw new ActionError(pay.errors[0].message, undefined, pay.errors[0].code.startsWith("ALLOC") ? "CONFLICT" : undefined);
  const cashTendered = toPaise(input.payment.cash || "0");
  const kept = { CASH: cashTendered - pay.change, BANK1: toPaise(input.payment.bank1 || "0"), BANK2: settings.bank2Enabled ? toPaise(input.payment.bank2 || "0") : 0 };
  const balanceAfter = account.balancePaise + calc.net - pay.kept;

  // 4. Header + lines
  const [h] = await tx
    .insert(schema.salesHeader)
    .values({
      billNo,
      fy,
      billDate: input.billDate,
      customerId: customer.id,
      locationId: location.id,
      customerName: customer.name,
      customerGstin: customer.gstin,
      customerStateCode: customer.stateCode,
      customerAddress: customer.address,
      customerPhone: customer.isWalkin ? null : customer.phone,
      gstMode: input.gstMode,
      taxType,
      totalQty: calc.qty,
      gross: fromPaise(calc.gross),
      taxable: fromPaise(calc.taxable),
      gstAmount: fromPaise(calc.gst),
      gstOverridden: calc.gstOverridden,
      cgst: fromPaise(calc.cgst),
      sgst: fromPaise(calc.sgst),
      igst: fromPaise(calc.igst),
      roundOff: fromPaise(calc.roundOff),
      netAmount: fromPaise(calc.net),
      creditAmount: fromPaise(pay.credit),
      advanceUsed: fromPaise(pay.advanceUsed),
      cashTendered: fromPaise(cashTendered),
      changeReturned: fromPaise(pay.change),
      prevBalance: fromPaise(account.balancePaise),
      balanceAfter: fromPaise(balanceAfter),
      createdBy: user.id,
    })
    .returning({ id: schema.salesHeader.id });

  const lineRows = await tx
    .insert(schema.salesLines)
    .values(
      lines.map((l, i) => {
        const c = calc.lines[i];
        return {
          salesId: h.id,
          lineNo: i + 1,
          productId: l.productId,
          barcode: l.p.barcode,
          itemName: l.p.itemName,
          hsnCode: l.p.hsn,
          gstRate: String(c.gstRate),
          qty: l.qty,
          rate: fromPaise(l.ratePaise),
          purchaseRate: l.p.purchaseRate,
          priceEdited: l.ratePaise !== toPaise(l.p.wsp ?? "0"),
          amount: fromPaise(c.amount),
          taxable: fromPaise(c.taxable),
          gstAmount: fromPaise(c.gst),
          cgst: fromPaise(c.cgst),
          sgst: fromPaise(c.sgst),
          igst: fromPaise(c.igst),
        };
      }),
    )
    .returning({ id: schema.salesLines.id, productId: schema.salesLines.productId, qty: schema.salesLines.qty });

  // Stock out
  await tx.insert(schema.stockLedger).values(
    lineRows.map((l) => ({ locationId: location.id, productId: l.productId, qtyIn: 0, qtyOut: l.qty, refDocType: "SALE", refDocId: h.id, refLineId: l.id, createdBy: user.id })),
  );

  // Ledger: sale Dr
  await tx.insert(schema.customerLedger).values({
    customerId: customer.id,
    entryDate: input.billDate,
    voucherType: "SALE",
    voucherId: h.id,
    voucherNo: billNo,
    particulars: `Sales bill — ${calc.qty} pcs`,
    debit: fromPaise(calc.net),
    credit: "0",
    createdBy: user.id,
  });

  // Earlier credit (advance / return credit) used for this bill — no money moves; the balance already has it as Cr
  if (pay.advanceUsed > 0) {
    await applyCredit(tx, { customerId: customer.id, amount: pay.advanceUsed, target: { type: "BILL", salesId: h.id }, date: input.billDate, userId: user.id });
    await tx.insert(schema.customerLedger).values({
      customerId: customer.id,
      entryDate: input.billDate,
      voucherType: "SETTLEMENT",
      voucherId: h.id,
      voucherNo: billNo,
      particulars: `Advance ${rs(pay.advanceUsed)} adjusted against ${billNo}`,
      debit: "0",
      credit: "0",
      createdBy: user.id,
    });
  }

  // Money received now
  const receipt = await postReceipt(tx, {
    customerId: customer.id,
    locationId: location.id,
    date: input.billDate,
    source: "SALE",
    salesId: h.id,
    currentBillNo: billNo,
    modes: kept,
    pay,
    settings,
    userId: user.id,
  });

  // Invariant: never Dr and Cr at once (normally a no-op here — the allocation already respects it)
  await settleCredits(tx, customer.id, input.billDate, user.id);

  await audit(tx, {
    userId: user.id,
    table: "sales_header",
    recordId: h.id,
    action: "CREATE",
    newValue: {
      billNo,
      customer: customer.name,
      net: fromPaise(calc.net),
      lines: lines.map((l) => ({ barcode: l.p.barcode, qty: l.qty, rate: fromPaise(l.ratePaise) })),
      receiptNo: receipt?.receiptNo ?? null,
      received: fromPaise(pay.received),
      change: fromPaise(pay.change),
      credit: fromPaise(pay.credit),
      advanceUsed: fromPaise(pay.advanceUsed),
      advanceCreated: fromPaise(pay.advanceCreated),
    },
  });

  return { id: h.id, billNo, receiptNo: receipt?.receiptNo ?? null, net: calc.net, change: pay.change, balanceAfter };
}
