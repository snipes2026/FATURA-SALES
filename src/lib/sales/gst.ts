/**
 * Sales bill calculation — shared by the billing screen (live) and the server
 * (authoritative). All amounts are integer paise.
 *
 * GST rate per line comes from the item's department (HSN), with the optional
 * price slab applied on the per-unit taxable value.
 *
 *  INCLUDES — the rate charged includes GST: taxable = amount × 100 ÷ (100 + rate),
 *             GST = amount − taxable. GST can't be overridden.
 *  ADD      — GST = taxable × rate ÷ 100 on top of the amount. The bill's GST
 *             total may be overridden (e.g. 0); it is then spread across the
 *             lines and the rate-wise breakup is hidden.
 *  Split    — same state as the location → CGST + SGST (50/50, odd paisa to
 *             CGST), otherwise IGST.
 */
import { distribute, gstRateFor, type DeptTax, type TaxType } from "@/lib/grn-calc";
import { percentOf, toPaise } from "@/lib/money";

export type SaleGstMode = "ADD" | "INCLUDES";

export type SaleLineInput = {
  qty: number;
  ratePaise: number;
  hsn: string;
  dept: DeptTax;
};

export type SaleCalcInput = {
  lines: SaleLineInput[];
  gstMode: SaleGstMode;
  taxType: TaxType;
  /** ADD mode only: manual GST total in paise (null = auto). */
  gstOverride?: number | null;
  /** Manual round off in paise (null = auto to the nearest rupee). */
  roundOff?: number | null;
};

export type SaleLineCalc = {
  amount: number;
  gstRate: number;
  taxable: number;
  gst: number;
  cgst: number;
  sgst: number;
  igst: number;
};

export type GstBreakupRow = { hsn: string; rate: number; taxable: number; cgst: number; sgst: number; igst: number; gst: number };

/** Rate for one unit. INCLUDES: the slab is checked on the unit price less GST at the base rate. */
export function saleRateFor(dept: DeptTax, unitPaise: number, mode: SaleGstMode): number {
  const base = Number(dept.gstRate);
  const unitTaxable = mode === "INCLUDES" ? Math.round((unitPaise * 100) / (100 + base)) : unitPaise;
  return gstRateFor(dept, unitTaxable);
}

/** Taxable part of a GST-inclusive amount, in paise. */
export function taxableFromInclusive(amountPaise: number, rate: number): number {
  const bp = Math.round(rate * 100); // basis points, so 2.5% stays exact
  return Math.round((amountPaise * 10000) / (10000 + bp));
}

function split(gst: number, taxType: TaxType) {
  const cgst = taxType === "INTRA" ? Math.ceil(gst / 2) : 0;
  return { cgst, sgst: taxType === "INTRA" ? gst - cgst : 0, igst: taxType === "INTER" ? gst : 0 };
}

export function calcSale(inp: SaleCalcInput) {
  const lines: SaleLineCalc[] = inp.lines.map((l) => {
    const amount = l.qty * l.ratePaise;
    const gstRate = saleRateFor(l.dept, l.ratePaise, inp.gstMode);
    const taxable = inp.gstMode === "INCLUDES" ? taxableFromInclusive(amount, gstRate) : amount;
    const gst = inp.gstMode === "INCLUDES" ? amount - taxable : percentOf(amount, gstRate);
    return { amount, gstRate, taxable, gst, ...split(gst, inp.taxType) };
  });

  const autoGst = lines.reduce((a, l) => a + l.gst, 0);
  const gstOverridden = inp.gstMode === "ADD" && inp.gstOverride !== null && inp.gstOverride !== undefined && inp.gstOverride !== autoGst;
  if (gstOverridden) {
    const total = Math.max(0, inp.gstOverride!);
    // Spread the manual total over the lines (by their auto GST, or by taxable value if that is all zero).
    const weights = autoGst > 0 ? lines.map((l) => l.gst) : lines.map((l) => l.taxable);
    const shares = distribute(total, weights);
    lines.forEach((l, i) => Object.assign(l, { gst: shares[i] }, split(shares[i], inp.taxType)));
  }

  const qty = inp.lines.reduce((a, l) => a + l.qty, 0);
  const gross = lines.reduce((a, l) => a + l.amount, 0);
  const taxable = lines.reduce((a, l) => a + l.taxable, 0);
  const gst = lines.reduce((a, l) => a + l.gst, 0);
  const cgst = lines.reduce((a, l) => a + l.cgst, 0);
  const sgst = lines.reduce((a, l) => a + l.sgst, 0);
  const igst = lines.reduce((a, l) => a + l.igst, 0);

  const beforeRound = taxable + gst; // INCLUDES: = gross
  const autoRoundOff = Math.round(beforeRound / 100) * 100 - beforeRound;
  const roundOff = inp.roundOff ?? autoRoundOff;

  // Rate-wise breakup (HSN + rate), hidden on screen/print when GST was overridden.
  const map = new Map<string, GstBreakupRow>();
  inp.lines.forEach((l, i) => {
    const c = lines[i];
    const k = `${l.hsn}|${c.gstRate}`;
    const row = map.get(k) ?? { hsn: l.hsn, rate: c.gstRate, taxable: 0, cgst: 0, sgst: 0, igst: 0, gst: 0 };
    row.taxable += c.taxable;
    row.cgst += c.cgst;
    row.sgst += c.sgst;
    row.igst += c.igst;
    row.gst += c.gst;
    map.set(k, row);
  });
  const breakup = [...map.values()].sort((a, b) => a.rate - b.rate || a.hsn.localeCompare(b.hsn));

  return {
    lines,
    qty,
    gross,
    taxable,
    autoGst,
    gst,
    gstOverridden,
    cgst,
    sgst,
    igst,
    breakup,
    beforeRound,
    autoRoundOff,
    roundOff,
    net: beforeRound + roundOff,
  };
}
export type SaleCalc = ReturnType<typeof calcSale>;

/** Below-cost check for the amber warning: compares the taxable unit value with the purchase rate (excl. GST). */
export function isBelowCost(unitPaise: number, purchaseRate: string, dept: DeptTax, mode: SaleGstMode): boolean {
  const rate = saleRateFor(dept, unitPaise, mode);
  const unitTaxable = mode === "INCLUDES" ? taxableFromInclusive(unitPaise, rate) : unitPaise;
  return unitTaxable < toPaise(purchaseRate);
}
