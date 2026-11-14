/**
 * GRN calculations — shared by the entry screen (live display) and the server
 * (authoritative values written to the database). All amounts in paise.
 */
import { percentOf, toPaise } from "./money";

export type TaxType = "INTRA" | "INTER";

export type DeptTax = {
  gstRate: string;
  slabEnabled: boolean;
  slabThreshold: string | null;
  slabRateAbove: string | null;
};

/**
 * GST rate for a department, applying the price-based slab on the per-unit value.
 * Not used by GRN any more (GRN GST is entered on the summary); kept for Sales billing.
 */
export function gstRateFor(dept: DeptTax, unitTaxablePaise: number): number {
  if (dept.slabEnabled && dept.slabThreshold && dept.slabRateAbove && unitTaxablePaise > toPaise(dept.slabThreshold))
    return Number(dept.slabRateAbove);
  return Number(dept.gstRate);
}

/**
 * Splits `total` paise across `weights` proportionally (largest-remainder
 * method), so the shares always add up to exactly `total`. BigInt keeps the
 * intermediate products exact for large amounts.
 */
export function distribute(total: number, weights: number[]): number[] {
  const sumW = weights.reduce((a, b) => a + b, 0);
  if (total === 0 || sumW === 0) return weights.map(() => 0);
  const T = BigInt(total);
  const S = BigInt(sumW);
  const parts = weights.map((w, i) => {
    const prod = T * BigInt(w);
    return { i, floor: Number(prod / S), rem: prod % S };
  });
  let left = total - parts.reduce((a, p) => a + p.floor, 0);
  const order = [...parts].sort((a, b) => (b.rem > a.rem ? 1 : b.rem < a.rem ? -1 : a.i - b.i));
  const out = parts.map((p) => p.floor);
  for (const p of order) {
    if (left <= 0) break;
    out[p.i] += 1;
    left -= 1;
  }
  return out;
}

export type LineAmounts = {
  amount: number; // qty × rate
  discount: number; // share of the header discount
  taxable: number; // amount − discount
};

export type OtherCharge = { description: string; amount: number }; // amount may be negative

export type GrnCalcInput = {
  lines: { qty: number; ratePaise: number }[];
  taxType: TaxType;
  discountType: "PERCENT" | "AMOUNT";
  discountValue: string; // percent or rupees, as typed
  gstMode: "PERCENT" | "AMOUNT";
  gstValue: string; // percent of taxable value, or rupees, as typed
  transport: number; // paise, no GST
  others: OtherCharge[]; // paise, no GST, may be negative
  roundOffManual: boolean;
  roundOffPaise: number;
};

/**
 * Whole-GRN calculation, in this order:
 *  1. Gross = Σ qty × purchase rate
 *  2. − Discount (% or ₹; split across lines by amount)
 *  3. = Taxable value
 *  4. + GST (% of taxable value, or ₹) — same state: CGST + SGST 50/50, else IGST
 *  5. + Transport / freight
 *  6. + Other charges (each row may be negative)
 *  7. ± Round off (auto to the nearest rupee, or typed)
 *  8. = Net payable
 */
export function calcGrn(inp: GrnCalcInput) {
  const amounts = inp.lines.map((l) => l.qty * l.ratePaise);
  const qty = inp.lines.reduce((a, l) => a + l.qty, 0);
  const gross = amounts.reduce((a, b) => a + b, 0);

  const rawDiscount = inp.discountType === "PERCENT" ? percentOf(gross, Number(inp.discountValue || 0)) : toPaise(inp.discountValue);
  const discount = Math.max(0, Math.min(rawDiscount, gross));
  const shares = distribute(discount, amounts);
  const lines: LineAmounts[] = amounts.map((amount, i) => ({ amount, discount: shares[i], taxable: amount - shares[i] }));
  const taxable = gross - discount;

  const gst = Math.max(0, inp.gstMode === "PERCENT" ? percentOf(taxable, Number(inp.gstValue || 0)) : toPaise(inp.gstValue));
  // 50/50 split; an odd paisa goes to CGST so CGST + SGST is always exactly the GST amount.
  const cgst = inp.taxType === "INTRA" ? Math.ceil(gst / 2) : 0;
  const sgst = inp.taxType === "INTRA" ? gst - cgst : 0;
  const igst = inp.taxType === "INTER" ? gst : 0;

  const transport = inp.transport;
  const othersTotal = inp.others.reduce((a, o) => a + o.amount, 0);

  const beforeRound = taxable + gst + transport + othersTotal;
  const autoRoundOff = Math.round(beforeRound / 100) * 100 - beforeRound;
  const roundOff = inp.roundOffManual ? inp.roundOffPaise : autoRoundOff;

  return {
    lines,
    qty,
    gross,
    discount,
    discountExceedsGross: rawDiscount > gross,
    taxable,
    gst,
    cgst,
    sgst,
    igst,
    transport,
    others: inp.others,
    othersTotal,
    chargesTotal: transport + othersTotal,
    beforeRound,
    autoRoundOff,
    roundOff,
    net: beforeRound + roundOff,
  };
}
export type GrnCalc = ReturnType<typeof calcGrn>;

/** Message shown (and enforced on the server) when the GRN total doesn't match the supplier's bill. */
export function invoiceMismatchMessage(netPaise: number, invoicePaise: number, fmt: (paise: number) => string) {
  return `GRN total ₹${fmt(netPaise)} does not match Invoice Value ₹${fmt(invoicePaise)} (difference ₹${fmt(Math.abs(netPaise - invoicePaise))}). Please check items, discount, GST, charges, or round-off.`;
}

/**
 * Expected order: Purchase Rate ≤ WSP ≤ RSP ≤ MRP (only the prices that are
 * filled in are compared). Returns human-readable problems.
 */
export function priceOrderIssues(p: { purchaseRate: string; wsp: string; rsp: string; mrp: string }): string[] {
  const chain = [
    { label: "Purchase rate", v: p.purchaseRate },
    { label: "WSP", v: p.wsp },
    { label: "RSP", v: p.rsp },
    { label: "MRP", v: p.mrp },
  ].filter((x) => x.v.trim() !== "" && !Number.isNaN(Number(x.v)));
  const issues: string[] = [];
  for (let i = 0; i < chain.length - 1; i++) {
    for (let j = i + 1; j < chain.length; j++) {
      if (toPaise(chain[i].v) > toPaise(chain[j].v)) issues.push(`${chain[i].label} (₹${chain[i].v}) is more than ${chain[j].label} (₹${chain[j].v})`);
    }
  }
  return issues;
}
