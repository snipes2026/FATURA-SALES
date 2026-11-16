import "server-only";
import { eq, inArray } from "drizzle-orm";
import type { z } from "zod";
import { schema, type Tx } from "@/db";
import { customerAccount } from "@/lib/customers";
import { todayIST } from "@/lib/dates";
import { formatAmount } from "@/lib/india";
import { fromPaise, toPaise } from "@/lib/money";
import { addCredit, applyCredit } from "@/lib/sales/credits";
import { calcSale } from "@/lib/sales/gst";
import { loadSalesSettings, modeLabel, nextDocNo } from "@/lib/sales/posting";
import { allocateReturn, checkReturnQty, linkedLineTax } from "@/lib/sales/return-calc";
import { settleCredits } from "@/lib/sales/settle";
import { ActionError, audit } from "@/lib/server-action";
import type { CurrentUser } from "@/lib/session";
import type { returnSaveSchema } from "@/lib/validation/sales-return";
import { billLines, returnHints } from "./queries";

type ReturnInput = z.output<typeof returnSaveSchema>;
const rs = (p: number) => `₹${formatAmount(fromPaise(p))}`;

/**
 * Body of "Save Sales Return", run inside ONE transaction by the caller. The
 * server recalculates everything (GST, totals, qty check, allocation); client
 * figures are only compared, never trusted.
 *
 *  1. Lock the customer row (SELECT … FOR UPDATE) — every posting for this
 *     customer (sale, receipt, return, cancel) takes the same lock
 *  2. Return number (FOR UPDATE on counters)
 *  3. Lock the pending bills being adjusted
 *  4. Header + lines → stock_ledger IN → customer_credits (R) + credit_applications
 *     (bills / opening / refund) → customer_ledger (Sales Return Cr, Refund Dr)
 *     → cash_bank_ledger OUT for a refund → audit
 */
export async function saveReturn(tx: Tx, input: ReturnInput, user: Pick<CurrentUser, "id" | "locations">) {
  const settings = await loadSalesSettings(tx);

  // 1. Customer, location, date
  const [customer] = await tx.select().from(schema.customers).where(eq(schema.customers.id, input.customerId)).for("update");
  if (!customer) throw new ActionError("This customer no longer exists");
  if (!user.locations.some((l) => l.id === input.locationId)) throw new ActionError("You don't have access to this location");
  const [location] = await tx.select().from(schema.locations).where(eq(schema.locations.id, input.locationId));
  if (!location?.isActive) throw new ActionError("This location is inactive");
  if (input.returnDate > todayIST()) throw new ActionError("Return date can't be in the future", "returnDate");
  if (input.adjustment.refundMode === "BANK2" && !settings.bank2Enabled) throw new ActionError(`${settings.bank2Name} is not enabled`);

  // The bill it is against (optional)
  const bill = input.againstSalesId
    ? (await tx.select().from(schema.salesHeader).where(eq(schema.salesHeader.id, input.againstSalesId)).for("update"))[0]
    : null;
  if (input.againstSalesId) {
    if (!bill || bill.customerId !== customer.id) throw new ActionError("That bill doesn't belong to this customer");
    if (bill.status !== "SAVED") throw new ActionError(`${bill.billNo} is cancelled — a return can't be made against it`);
    if (input.gstMode !== bill.gstMode) throw new ActionError(`The GST mode must be the bill's (${bill.gstMode === "ADD" ? "Add GST" : "Includes GST"})`);
    if (input.gstOverride !== null) throw new ActionError("GST can't be overridden on a return against a bill");
  }
  const origLines = bill ? await billLines(tx, bill.id) : [];
  const origById = new Map(origLines.map((l) => [l.id, l]));

  // Products (with department GST for free-form lines)
  const productIds = [...new Set(input.lines.map((l) => l.productId))];
  const products = await tx
    .select({
      id: schema.products.id,
      barcode: schema.products.barcode,
      itemName: schema.products.itemName,
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
    if (!p) throw new ActionError("An item on the return no longer exists — remove it and scan again");
    const ratePaise = toPaise(l.rate);
    if (bill) {
      const o = l.originalSalesLineId ? origById.get(l.originalSalesLineId) : undefined;
      if (!o || o.productId !== l.productId) throw new ActionError(`${p.itemName} (${p.barcode}) is not on ${bill.billNo}`);
      const tax = linkedLineTax({ amount: toPaise(o.amount), gstRate: o.gstRate, gst: toPaise(o.gst) }, bill.gstOverridden, ratePaise * l.qty);
      return { ...l, p, ratePaise, orig: o, hsn: o.hsn, tax };
    }
    if (l.originalSalesLineId) throw new ActionError("Choose the bill to return items against it");
    return { ...l, p, ratePaise, orig: null, hsn: p.hsn, tax: {} };
  });

  // Totals
  const taxType = bill ? bill.taxType : customer.stateCode === location.stateCode ? "INTRA" : "INTER";
  const calc = calcSale({
    lines: lines.map((l) => ({ qty: l.qty, ratePaise: l.ratePaise, hsn: l.hsn, dept: l.p, ...l.tax })),
    gstMode: input.gstMode,
    taxType,
    gstOverride: !bill && input.gstMode === "ADD" && input.gstOverride !== null ? toPaise(input.gstOverride) : null,
    roundOff: input.roundOff !== null ? toPaise(input.roundOff) : null,
  });
  if (calc.net <= 0) throw new ActionError("Net Return Value must be more than ₹0");
  if (calc.net !== toPaise(input.expectedNet))
    throw new ActionError(`The return total is ${rs(calc.net)} but the screen shows ${rs(toPaise(input.expectedNet))}. Check the return and save again.`, undefined, "MISMATCH");

  // Return-quantity check
  const hints = bill ? {} : await returnHints(tx, customer.id, productIds);
  const qty = checkReturnQty(
    settings.returnQtyCheck,
    lines.map((l) =>
      l.orig
        ? { key: `L${l.orig.id}`, ref: `${l.p.barcode}`, qty: l.qty, sold: l.orig.qty, returned: l.orig.returned }
        : { key: `P${l.productId}`, ref: `${l.p.barcode}`, qty: l.qty, sold: hints[l.productId]?.sold ?? 0, returned: hints[l.productId]?.returned ?? 0 },
    ),
  );
  if (qty.status === "BLOCK") throw new ActionError(qty.issues[0].message);
  if (qty.status === "WARN" && !input.qtyConfirmed) throw new ActionError(qty.issues[0].message);

  // Allocation against the customer's dues as they are now (customer row is locked)
  const account = await customerAccount(tx, customer.id);
  const manual = input.adjustment.manual ? Object.fromEntries(Object.entries(input.adjustment.manual).map(([k, v]) => [k, toPaise(v || "0")])) : null;
  const alloc = allocateReturn({
    returnValue: calc.net,
    dues: account.dues,
    advanceAvailable: account.advanceAvailable,
    linkedSalesId: bill?.id ?? null,
    manual,
    remainder: input.adjustment.remainder,
    refundMode: input.adjustment.refundMode,
    isWalkin: customer.isWalkin,
  });
  if (!alloc.ok) throw new ActionError(alloc.errors[0].message, undefined, alloc.errors[0].code.startsWith("ALLOC") ? "CONFLICT" : undefined);
  const applied = alloc.rows.filter((r) => r.amount > 0);

  // 3. Lock the bills being adjusted
  const billIds = applied.filter((r) => r.kind === "BILL").map((r) => r.salesId!);
  if (billIds.length) await tx.select({ id: schema.salesHeader.id }).from(schema.salesHeader).where(inArray(schema.salesHeader.id, billIds)).for("update");

  // 2. Number
  const { no: returnNo, fy } = await nextDocNo(tx, "SALES_RETURN", input.returnDate, settings);

  // 4. Header + lines
  const [h] = await tx
    .insert(schema.salesReturnHeader)
    .values({
      returnNo,
      fy,
      returnDate: input.returnDate,
      customerId: customer.id,
      locationId: location.id,
      againstSalesId: bill?.id ?? null,
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
      appliedToDues: fromPaise(alloc.applied),
      advanceCreated: fromPaise(alloc.advanceCreated),
      refundAmount: fromPaise(alloc.refund),
      refundMode: alloc.refund > 0 ? alloc.refundMode : null,
      prevBalance: fromPaise(account.balancePaise),
      balanceAfter: fromPaise(alloc.balanceAfter),
      remarks: input.remarks,
      createdBy: user.id,
    })
    .returning({ id: schema.salesReturnHeader.id });

  const lineRows = await tx
    .insert(schema.salesReturnLines)
    .values(
      lines.map((l, i) => {
        const c = calc.lines[i];
        return {
          returnId: h.id,
          lineNo: i + 1,
          productId: l.productId,
          originalSalesLineId: l.orig?.id ?? null,
          barcode: l.p.barcode,
          itemName: l.orig?.itemName ?? l.p.itemName,
          hsnCode: l.hsn,
          gstRate: String(c.gstRate),
          qty: l.qty,
          rate: fromPaise(l.ratePaise),
          amount: fromPaise(c.amount),
          taxable: fromPaise(c.taxable),
          gstAmount: fromPaise(c.gst),
          cgst: fromPaise(c.cgst),
          sgst: fromPaise(c.sgst),
          igst: fromPaise(c.igst),
        };
      }),
    )
    .returning({ id: schema.salesReturnLines.id, productId: schema.salesReturnLines.productId, qty: schema.salesReturnLines.qty });

  // Stock back into saleable stock at the selected location (same product / barcode)
  await tx.insert(schema.stockLedger).values(
    lineRows.map((l) => ({ locationId: location.id, productId: l.productId, qtyIn: l.qty, qtyOut: 0, refDocType: "SALES_RETURN", refDocId: h.id, refLineId: l.id, createdBy: user.id })),
  );

  // Credit: the whole return value goes into the pool, then is used for dues / refund; the rest stays as advance
  const creditId = (await addCredit(tx, { customerId: customer.id, sourceType: "SALES_RETURN", sourceId: h.id, date: input.returnDate, amount: calc.net, userId: user.id }))!;
  for (const r of applied)
    await applyCredit(tx, {
      customerId: customer.id,
      amount: r.amount,
      target: r.kind === "BILL" ? { type: "BILL", salesId: r.salesId! } : { type: "OPENING" },
      date: input.returnDate,
      userId: user.id,
      creditId,
    });
  if (alloc.refund > 0)
    await applyCredit(tx, { customerId: customer.id, amount: alloc.refund, target: { type: "REFUND" }, date: input.returnDate, userId: user.id, creditId });

  // Ledger: Sales Return Cr (+ Refund Dr)
  const parts = [
    bill ? `Return against ${bill.billNo}` : "Sales return",
    ...applied.map((r) => `applied to ${r.ref} ${rs(r.amount)}`),
    ...(alloc.advanceCreated > 0 ? [`advance ${rs(alloc.advanceCreated)}`] : []),
    ...(alloc.refund > 0 ? [`refund ${rs(alloc.refund)}`] : []),
  ];
  await tx.insert(schema.customerLedger).values({
    customerId: customer.id,
    entryDate: input.returnDate,
    voucherType: "SALES_RETURN",
    voucherId: h.id,
    voucherNo: returnNo,
    particulars: `${parts[0]}${parts.length > 1 ? `; ${parts.slice(1).join("; ")}` : ""} — ${calc.qty} pcs`,
    debit: "0",
    credit: fromPaise(calc.net),
    createdBy: user.id,
  });
  if (alloc.refund > 0) {
    const mode = alloc.refundMode!;
    await tx.insert(schema.customerLedger).values({
      customerId: customer.id,
      entryDate: input.returnDate,
      voucherType: "REFUND",
      voucherId: h.id,
      voucherNo: returnNo,
      particulars: `Refund for ${returnNo} · ${modeLabel(mode, settings)} ${rs(alloc.refund)}`,
      debit: fromPaise(alloc.refund),
      credit: "0",
      createdBy: user.id,
    });
    await tx.insert(schema.cashBankLedger).values({
      entryDate: input.returnDate,
      mode,
      direction: "OUT",
      amount: fromPaise(alloc.refund),
      refType: "SALES_RETURN",
      refId: h.id,
      customerId: customer.id,
      locationId: location.id,
      createdBy: user.id,
    });
  }

  // Invariant: never Dr and Cr at once (a no-op here — the allocation already respects it)
  await settleCredits(tx, customer.id, input.returnDate, user.id);

  await audit(tx, {
    userId: user.id,
    table: "sales_return_header",
    recordId: h.id,
    action: "CREATE",
    newValue: {
      returnNo,
      customer: customer.name,
      againstBill: bill?.billNo ?? null,
      net: fromPaise(calc.net),
      lines: lines.map((l) => ({ barcode: l.p.barcode, qty: l.qty, rate: fromPaise(l.ratePaise) })),
      appliedTo: applied.map((r) => ({ ref: r.ref, amount: fromPaise(r.amount) })),
      advance: fromPaise(alloc.advanceCreated),
      refund: fromPaise(alloc.refund),
      refundMode: alloc.refund > 0 ? alloc.refundMode : null,
      qtyWarningConfirmed: qty.status === "WARN",
    },
  });

  return { id: h.id, returnNo, net: calc.net, refund: alloc.refund, refundMode: alloc.refund > 0 ? alloc.refundMode : null, balanceAfter: alloc.balanceAfter };
}
