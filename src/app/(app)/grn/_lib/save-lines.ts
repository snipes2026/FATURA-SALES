import "server-only";
import { eq, inArray, sql } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import { calcGrn, type TaxType } from "@/lib/grn-calc";
import { fromPaise, toPaise } from "@/lib/money";
import { ActionError } from "@/lib/server-action";
import { grnLineSchema, summaryCalcOptions, type GrnLineParsed, type GrnSummaryParsed } from "@/lib/validation/grn";

/**
 * Replaces the lines of a draft GRN with `rawLines` (validated here, because
 * the rules depend on the category configuration), rewrites the charges, and returns the header totals.
 * Existing lines are updated in place so their barcode / product link (Step 6)
 * survives; lines that are gone are deleted.
 */
export async function saveDraftLines(tx: Tx, grnId: number, rawLines: unknown[], taxType: TaxType, summary: GrnSummaryParsed) {
  const cats = await tx.select().from(schema.categoryConfig);
  const lineSchema = grnLineSchema(cats.map((c) => ({ slot: c.slot, label: c.label, mode: c.mode })));

  const lines: GrnLineParsed[] = rawLines.map((raw, i) => {
    const p = lineSchema.safeParse(raw);
    if (!p.success) throw new ActionError(`Line ${i + 1}: ${p.error.issues[0]?.message ?? "invalid"}`);
    return p.data;
  });

  // Departments and category values must exist (and values must belong to the right category).
  const deptIds = [...new Set(lines.map((l) => l.departmentId))];
  const depts = deptIds.length ? await tx.select().from(schema.departments).where(inArray(schema.departments.id, deptIds)) : [];
  const deptMap = new Map(depts.map((d) => [d.id, d]));
  const valueIds = [...new Set(lines.flatMap((l) => [l.cat1, l.cat2, l.cat3, l.cat4]).filter((v): v is number => v != null))];
  const values = valueIds.length
    ? await tx.select({ id: schema.categoryValues.id, slot: schema.categoryValues.slot }).from(schema.categoryValues).where(inArray(schema.categoryValues.id, valueIds))
    : [];
  const valueSlot = new Map(values.map((v) => [v.id, v.slot]));

  const existing = await tx.select().from(schema.grnLines).where(eq(schema.grnLines.grnId, grnId));
  const existingMap = new Map(existing.map((e) => [e.id, e]));

  lines.forEach((l, i) => {
    const n = i + 1;
    const dept = deptMap.get(l.departmentId);
    if (!dept) throw new ActionError(`Line ${n}: department not found`);
    const old = l.id ? existingMap.get(l.id) : undefined;
    if (l.id && !old) throw new ActionError(`Line ${n} was removed by someone else. Reload the GRN.`);
    if (!dept.isActive && old?.departmentId !== dept.id) throw new ActionError(`Line ${n}: department ${dept.name} is inactive`);
    ([1, 2, 3, 4] as const).forEach((slot) => {
      const v = l[`cat${slot}`];
      if (v != null && valueSlot.get(v) !== slot) throw new ActionError(`Line ${n}: invalid category value`);
    });
    // Once a barcode is assigned, the SKU fields of that line are fixed.
    if (old?.barcode) {
      const same =
        old.departmentId === l.departmentId &&
        old.itemName === l.itemName &&
        old.cat1ValueId === l.cat1 &&
        old.cat2ValueId === l.cat2 &&
        old.cat3ValueId === l.cat3 &&
        old.cat4ValueId === l.cat4 &&
        toPaise(old.mrp) === toPaise(l.mrp);
      if (!same) throw new ActionError(`Line ${n} already has barcode ${old.barcode}; its item, categories and MRP can't change`);
    }
  });

  // Move kept lines out of the way of the (grn_id, line_no) unique index, then renumber.
  await tx.update(schema.grnLines).set({ lineNo: sql`-${schema.grnLines.id}` }).where(eq(schema.grnLines.grnId, grnId));
  const keepIds = new Set(lines.map((l) => l.id).filter(Boolean));
  const removeIds = existing.filter((e) => !keepIds.has(e.id)).map((e) => e.id);
  if (removeIds.length) await tx.delete(schema.grnLines).where(inArray(schema.grnLines.id, removeIds));

  // One calculation for the whole GRN: discount split across lines, GST, charges, round off.
  const calc = calcGrn({
    lines: lines.map((l) => ({ qty: l.qty, ratePaise: toPaise(l.purchaseRate) })),
    taxType,
    ...summaryCalcOptions(summary),
  });
  if (calc.discountExceedsGross) throw new ActionError("Discount can't be more than the gross amount");

  const lineIds: Record<string, number> = {};
  for (const [i, l] of lines.entries()) {
    const dept = deptMap.get(l.departmentId)!;
    const c = calc.lines[i];
    const row = {
      grnId,
      lineNo: i + 1,
      departmentId: l.departmentId,
      hsnCode: dept.hsnCode, // for reference only — HSN no longer drives GRN tax
      itemName: l.itemName,
      cat1ValueId: l.cat1,
      cat2ValueId: l.cat2,
      cat3ValueId: l.cat3,
      cat4ValueId: l.cat4,
      qty: l.qty,
      purchaseRate: l.purchaseRate,
      amount: fromPaise(c.amount),
      discountAmount: fromPaise(c.discount),
      taxableValue: fromPaise(c.taxable),
      // GST is entered once on the summary, so lines carry no GST of their own.
      gstRate: null,
      cgstAmount: null,
      sgstAmount: null,
      igstAmount: null,
      gstAmount: null,
      wsp: l.wsp,
      rsp: l.rsp,
      mrp: l.mrp,
      imagePath: l.imagePath,
      priceWarningOverridden: l.priceWarningOverridden,
    };
    if (l.id) {
      await tx.update(schema.grnLines).set(row).where(eq(schema.grnLines.id, l.id));
      lineIds[l.uid] = l.id;
    } else {
      const [ins] = await tx.insert(schema.grnLines).values(row).returning({ id: schema.grnLines.id });
      lineIds[l.uid] = ins.id;
    }
  }

  // Charges (no GST): one Transport row when there is an amount, then each Other row in order.
  await tx.delete(schema.grnCharges).where(eq(schema.grnCharges.grnId, grnId));
  const chargeRows = [
    ...(calc.transport ? [{ grnId, chargeType: "FREIGHT" as const, description: "Transport / Freight", amount: fromPaise(calc.transport), sortOrder: 0 }] : []),
    ...calc.others.map((o, i) => ({ grnId, chargeType: "OTHER" as const, description: o.description, amount: fromPaise(o.amount), sortOrder: i + 1 })),
  ];
  if (chargeRows.length) await tx.insert(schema.grnCharges).values(chargeRows);

  return {
    lineIds,
    lineCount: lines.length,
    totals: {
      totalQty: calc.qty,
      grossAmount: fromPaise(calc.gross),
      discountType: summary.discountType,
      discountValue: summary.discountValue === "" ? "0" : summary.discountValue,
      discountAmount: fromPaise(calc.discount),
      taxableValue: fromPaise(calc.taxable),
      gstMode: summary.gstMode,
      gstInput: summary.gstValue === "" ? "0" : summary.gstValue,
      gstAmount: fromPaise(calc.gst),
      cgstAmount: fromPaise(calc.cgst),
      sgstAmount: fromPaise(calc.sgst),
      igstAmount: fromPaise(calc.igst),
      chargesAmount: fromPaise(calc.chargesTotal),
      roundOff: fromPaise(calc.roundOff),
      roundOffManual: summary.roundOffManual,
      netPayable: fromPaise(calc.net),
      supplierInvoiceTotal: null, // field removed from the screen; Invoice Value (header) replaces it
      remarks: summary.remarks === "" ? null : summary.remarks,
    },
  };
}
