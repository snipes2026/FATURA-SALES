/**
 * Unit tests for the GRN summary calculation (src/lib/grn-calc.ts).
 * Run: npm test
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { calcGrn, distribute, type GrnCalcInput } from "../src/lib/grn-calc";
import { emptySummary, grnSummarySchema, summaryCalcOptions } from "../src/lib/validation/grn";

/** Builds a calc input: lines are [qty, rate in rupees]. */
function input(lines: [number, number][], patch: Partial<GrnCalcInput> = {}): GrnCalcInput {
  return {
    lines: lines.map(([qty, rate]) => ({ qty, ratePaise: Math.round(rate * 100) })),
    taxType: "INTRA",
    discountType: "PERCENT",
    discountValue: "0",
    gstMode: "PERCENT",
    gstValue: "0",
    transport: 0,
    others: [],
    roundOffManual: false,
    roundOffPaise: 0,
    ...patch,
  };
}

describe("calcGrn — order: gross → discount → taxable → GST → transport → others → round off", () => {
  it("no GST: net = taxable (+ round off)", () => {
    const r = calcGrn(input([[10, 99.5]])); // 995.00
    assert.equal(r.gross, 99500);
    assert.equal(r.taxable, 99500);
    assert.equal(r.gst, 0);
    assert.equal(r.cgst + r.sgst + r.igst, 0);
    assert.equal(r.net, 99500);
  });

  it("GST as % of taxable value (after discount)", () => {
    const r = calcGrn(input([[4, 2500]], { discountType: "PERCENT", discountValue: "10", gstValue: "5" })); // 10000 − 1000 = 9000
    assert.equal(r.discount, 100000);
    assert.equal(r.taxable, 900000);
    assert.equal(r.gst, 45000); // 5% of 9000
    assert.equal(r.net, 945000);
  });

  it("GST as a ₹ amount", () => {
    const r = calcGrn(input([[1, 1000]], { gstMode: "AMOUNT", gstValue: "123.45" }));
    assert.equal(r.gst, 12345);
    assert.equal(r.beforeRound, 112345);
  });

  it("intra-state splits GST 50/50 into CGST + SGST (odd paisa to CGST)", () => {
    const r = calcGrn(input([[1, 1000]], { gstMode: "AMOUNT", gstValue: "180.01", taxType: "INTRA" }));
    assert.deepEqual([r.cgst, r.sgst, r.igst], [9001, 9000, 0]);
    assert.equal(r.cgst + r.sgst, r.gst);
  });

  it("inter-state puts 100% into IGST", () => {
    const r = calcGrn(input([[1, 1000]], { gstValue: "18", taxType: "INTER" }));
    assert.deepEqual([r.cgst, r.sgst, r.igst], [0, 0, 18000]);
  });

  it("transport adds a plain amount (no GST)", () => {
    const r = calcGrn(input([[1, 1000]], { gstValue: "5", transport: 25000 }));
    assert.equal(r.gst, 5000); // GST only on taxable, not on transport
    assert.equal(r.net, 100000 + 5000 + 25000);
  });

  it("other charges: multiple rows, negative allowed", () => {
    const r = calcGrn(
      input([[2, 500]], {
        others: [
          { description: "Packing", amount: 4000 },
          { description: "Vendor final discount", amount: -15050 },
          { description: "Loading", amount: 1000 },
        ],
      }),
    );
    assert.equal(r.othersTotal, 4000 - 15050 + 1000);
    assert.equal(r.chargesTotal, r.othersTotal);
    assert.equal(r.beforeRound, 100000 - 10050);
  });

  it("round off: automatic to the nearest rupee (half up)", () => {
    assert.equal(calcGrn(input([[1, 100.5]])).roundOff, 50); // 100.50 → 101
    assert.equal(calcGrn(input([[1, 100.49]])).roundOff, -49); // 100.49 → 100
    assert.equal(calcGrn(input([[1, 100.49]])).net % 100, 0);
  });

  it("round off: manual value is used as typed", () => {
    const r = calcGrn(input([[1, 100.49]], { roundOffManual: true, roundOffPaise: 51 }));
    assert.equal(r.net, 10100);
  });

  it("negative charges can make net negative (Save GRN blocks net ≤ 0)", () => {
    const r = calcGrn(input([[1, 100]], { others: [{ description: "Credit", amount: -20000 }] }));
    assert.ok(r.net < 0);
  });

  it("discount is split across lines and adds up exactly", () => {
    const r = calcGrn(input([[1, 100], [1, 100], [1, 100]], { discountType: "AMOUNT", discountValue: "1" }));
    assert.equal(r.lines.reduce((a, l) => a + l.discount, 0), 100);
    assert.deepEqual(distribute(100, [1, 1, 1]), [34, 33, 33]);
  });

  it("full example in the documented order", () => {
    const r = calcGrn(
      input([[10, 450], [5, 1200.5]], {
        // gross 4500 + 6002.50 = 10502.50
        discountType: "AMOUNT",
        discountValue: "502.50", // taxable 10000
        gstMode: "PERCENT",
        gstValue: "12", // 1200
        transport: 35000, // 350
        others: [{ description: "Scheme", amount: -25025 }], // −250.25
        taxType: "INTRA",
      }),
    );
    assert.equal(r.gross, 1050250);
    assert.equal(r.taxable, 1000000);
    assert.equal(r.gst, 120000);
    assert.equal(r.beforeRound, 1000000 + 120000 + 35000 - 25025); // 11299.75
    assert.equal(r.roundOff, 25);
    assert.equal(r.net, 1130000);
  });
});

describe("summary form → calculation options", () => {
  it("blank GST and charges count as 0; empty other-charge rows are ignored", () => {
    const s = { ...emptySummary(), otherCharges: [{ uid: "a", description: "", amount: "" }] };
    const o = summaryCalcOptions(s);
    assert.equal(o.gstValue, "0");
    assert.equal(o.transport, 0);
    assert.deepEqual(o.others, []);
    assert.ok(grnSummarySchema.safeParse(s).success);
  });

  it("validates GST % ≤ 100, other-charge description/amount, signed amounts", () => {
    const bad = grnSummarySchema.safeParse({
      ...emptySummary(),
      gstValue: "120",
      otherCharges: [
        { uid: "a", description: "", amount: "50" },
        { uid: "b", description: "Credit", amount: "-12.345" },
      ],
    });
    assert.ok(!bad.success);
    const paths = bad.error!.issues.map((i) => i.path.join("."));
    assert.ok(paths.includes("gstValue"));
    assert.ok(paths.includes("otherCharges.0.description"));
    assert.ok(paths.includes("otherCharges.1.amount"));
    const ok = grnSummarySchema.safeParse({ ...emptySummary(), otherCharges: [{ uid: "b", description: "Credit", amount: "-12.34" }] });
    assert.ok(ok.success);
    assert.deepEqual(summaryCalcOptions(ok.data!).others, [{ description: "Credit", amount: -1234 }]);
  });
});
