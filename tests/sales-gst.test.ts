/**
 * Unit tests for the sales bill / GST calculation (src/lib/sales/gst.ts).
 * Run: npm test
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DeptTax } from "../src/lib/grn-calc";
import { calcSale, isBelowCost, saleRateFor, type SaleCalcInput } from "../src/lib/sales/gst";

const r = (rupees: number) => Math.round(rupees * 100);
const flat = (rate: number): DeptTax => ({ gstRate: String(rate), slabEnabled: false, slabThreshold: null, slabRateAbove: null });
const APPAREL: DeptTax = { gstRate: "5", slabEnabled: true, slabThreshold: "2500", slabRateAbove: "18" };

function input(lines: [qty: number, rate: number, dept: DeptTax, hsn?: string][], patch: Partial<SaleCalcInput> = {}): SaleCalcInput {
  return {
    lines: lines.map(([qty, rate, dept, hsn = "6205"]) => ({ qty, ratePaise: r(rate), dept, hsn })),
    gstMode: "INCLUDES",
    taxType: "INTRA",
    ...patch,
  };
}

describe("calcSale — Includes GST", () => {
  it("reverse-calculates taxable and GST per line", () => {
    const c = calcSale(input([[2, 525, flat(5)]]));
    assert.equal(c.gross, r(1050));
    assert.equal(c.taxable, r(1000)); // 1050 × 100 ÷ 105
    assert.equal(c.gst, r(50));
    assert.equal(c.cgst, r(25));
    assert.equal(c.sgst, r(25));
    assert.equal(c.net, r(1050));
    assert.equal(c.roundOff, 0);
  });

  it("GST + taxable always equals the amount (no paise lost)", () => {
    const c = calcSale(input([[3, 999.99, flat(12)]]));
    assert.equal(c.taxable + c.gst, c.gross);
    assert.equal(c.lines[0].taxable, r(2678.54)); // 2999.97 × 100 ÷ 112 = 2678.544…
    assert.equal(c.lines[0].gst, r(321.43));
  });

  it("ignores a GST override (field is read-only)", () => {
    const c = calcSale(input([[1, 1050, flat(5)]], { gstOverride: 0 }));
    assert.equal(c.gstOverridden, false);
    assert.equal(c.gst, r(50));
  });
});

describe("calcSale — Add GST", () => {
  it("adds GST on top of the amount", () => {
    const c = calcSale(input([[2, 500, flat(5)]], { gstMode: "ADD" }));
    assert.equal(c.taxable, r(1000));
    assert.equal(c.gst, r(50));
    assert.equal(c.net, r(1050));
  });

  it("rounds off to the nearest rupee, or takes a typed round off", () => {
    const c = calcSale(input([[1, 99.9, flat(18)]], { gstMode: "ADD" })); // 99.90 + 17.98 = 117.88
    assert.equal(c.beforeRound, r(117.88));
    assert.equal(c.autoRoundOff, r(0.12));
    assert.equal(c.net, r(118));
    const m = calcSale(input([[1, 99.9, flat(18)]], { gstMode: "ADD", roundOff: -r(0.88) }));
    assert.equal(m.net, r(117));
  });

  it("manual override: GST 0 → no GST, breakup hidden flag set", () => {
    const c = calcSale(input([[2, 500, flat(5)], [1, 1000, flat(18)]], { gstMode: "ADD", gstOverride: 0 }));
    assert.equal(c.gstOverridden, true);
    assert.equal(c.gst, 0);
    assert.equal(c.cgst + c.sgst + c.igst, 0);
    assert.equal(c.net, r(2000));
  });

  it("manual override: a typed total is spread across lines and adds up exactly", () => {
    const c = calcSale(input([[2, 500, flat(5)], [1, 1000, flat(18)]], { gstMode: "ADD", gstOverride: r(100.01) }));
    assert.equal(c.autoGst, r(230));
    assert.equal(c.gst, r(100.01));
    assert.equal(c.lines.reduce((a, l) => a + l.gst, 0), r(100.01));
    assert.equal(c.cgst + c.sgst, r(100.01));
  });

  it("an override equal to the auto GST is not an override", () => {
    const c = calcSale(input([[2, 500, flat(5)]], { gstMode: "ADD", gstOverride: r(50) }));
    assert.equal(c.gstOverridden, false);
  });
});

describe("calcSale — intra/inter-state split", () => {
  it("same state → CGST + SGST 50/50 (odd paisa to CGST)", () => {
    const c = calcSale(input([[1, 100.1, flat(5)]], { gstMode: "ADD" })); // GST 5.01 (5.005 rounded half up)
    assert.equal(c.gst, r(5.01));
    assert.equal(c.cgst, r(2.51));
    assert.equal(c.sgst, r(2.5));
    assert.equal(c.igst, 0);
  });

  it("other state → IGST only", () => {
    const c = calcSale(input([[2, 525, flat(5)]], { taxType: "INTER" }));
    assert.equal(c.igst, r(50));
    assert.equal(c.cgst + c.sgst, 0);
  });
});

describe("calcSale — mixed rates and the HSN breakup", () => {
  it("groups by HSN + rate and totals match the header", () => {
    const c = calcSale(
      input([
        [2, 525, flat(5), "6205"],
        [1, 1180, flat(18), "4202"],
        [1, 1050, flat(5), "6205"],
      ]),
    );
    assert.deepEqual(
      c.breakup.map((b) => [b.hsn, b.rate, b.taxable / 100, b.gst / 100]),
      [
        ["6205", 5, 2000, 100],
        ["4202", 18, 1000, 180],
      ],
    );
    assert.equal(c.taxable, r(3000));
    assert.equal(c.gst, r(280));
    assert.equal(c.qty, 4);
  });

  it("department price slab: 5% up to ₹2,500 taxable, 18% above", () => {
    assert.equal(saleRateFor(APPAREL, r(2500), "ADD"), 5);
    assert.equal(saleRateFor(APPAREL, r(2500.01), "ADD"), 18);
    assert.equal(saleRateFor(APPAREL, r(2625), "INCLUDES"), 5); // 2625 ÷ 1.05 = 2500
    assert.equal(saleRateFor(APPAREL, r(2626), "INCLUDES"), 18);
    const c = calcSale(input([[1, 2000, APPAREL], [1, 3540, APPAREL]]));
    assert.deepEqual(
      c.lines.map((l) => l.gstRate),
      [5, 18],
    );
    assert.equal(c.lines[1].taxable, r(3000));
  });
});

describe("isBelowCost", () => {
  it("compares the taxable unit value with the purchase rate", () => {
    assert.equal(isBelowCost(r(1050), "1000", flat(5), "INCLUDES"), false); // taxable 1000
    assert.equal(isBelowCost(r(1049), "1000", flat(5), "INCLUDES"), true);
    assert.equal(isBelowCost(r(999), "1000", flat(5), "ADD"), true);
  });
});
