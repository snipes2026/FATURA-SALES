/**
 * Sales Return pure calculations (src/lib/sales/return-calc.ts + calcSale for
 * the return's GST): the worked examples of the spec, linked-bill-first,
 * editing the split, Walk-in refund, the never-Dr-and-Cr invariant, the return
 * quantity check and GST.
 * Run: npm test
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DeptTax } from "../src/lib/grn-calc";
import type { Due } from "../src/lib/sales/allocate";
import { calcSale } from "../src/lib/sales/gst";
import { allocateReturn, checkReturnQty, linkedLineTax, type ReturnAllocateInput } from "../src/lib/sales/return-calc";

const r = (rupees: number) => Math.round(rupees * 100);
const bill = (id: number, date: string, pending: number): Due => ({ key: `BILL:${id}`, kind: "BILL", salesId: id, ref: `INV/26-27/${String(id).padStart(4, "0")}`, date, pending: r(pending) });
const opening = (pending: number): Due => ({ key: "OPENING", kind: "OPENING", ref: "Opening balance", date: "2026-04-01", pending: r(pending) });
const ret = (returnValue: number, dues: Due[] = [], patch: Partial<ReturnAllocateInput> = {}) => allocateReturn({ returnValue: r(returnValue), dues, advanceAvailable: 0, ...patch });
const split = (res: ReturnType<typeof allocateReturn>) => res.rows.map((x) => [x.ref, x.amount / 100]);

describe("allocateReturn — the worked examples", () => {
  it("pending bill 10,000, return 4,000 → bill pending 6,000, balance 6,000 Dr", () => {
    const x = ret(4000, [bill(9, "2026-05-01", 10000)]);
    assert.ok(x.ok);
    assert.deepEqual(split(x), [["INV/26-27/0009", 4000]]);
    assert.equal(x.duesRemaining, r(6000));
    assert.deepEqual([x.advanceCreated, x.refund], [0, 0]);
    assert.deepEqual([x.balanceBefore, x.balanceAfter], [r(10000), r(6000)]);
  });

  it("pending bill 10,000, return 10,000 → bill cleared, balance Nil", () => {
    const x = ret(10000, [bill(9, "2026-05-01", 10000)]);
    assert.deepEqual([x.duesRemaining, x.remaining, x.balanceAfter], [0, 0, 0]);
  });

  it("pending bill 3,000, return 5,000 → bill cleared, 2,000 advance, balance 2,000 Cr", () => {
    const x = ret(5000, [bill(9, "2026-05-01", 3000)]);
    assert.ok(x.ok);
    assert.equal(x.applied, r(3000));
    assert.deepEqual([x.remainder, x.advanceCreated], ["ADVANCE", r(2000)]);
    assert.equal(x.balanceAfter, -r(2000));
  });

  it("no dues, return 5,000 → 5,000 advance, balance 5,000 Cr", () => {
    const x = ret(5000);
    assert.ok(x.ok);
    assert.deepEqual([x.rows.length, x.advanceCreated, x.balanceAfter], [0, r(5000), -r(5000)]);
  });

  it("opening balance 20,000 Dr (no bills), return 5,000 → opening reduced, 15,000 Dr", () => {
    const x = ret(5000, [opening(20000)]);
    assert.deepEqual(split(x), [["Opening balance", 5000]]);
    assert.deepEqual([x.duesRemaining, x.balanceAfter], [r(15000), r(15000)]);
  });

  it("return 3,000 against INV-12 (pending 2,000) with an older bill at 9,000 → INV-12 first, then 1,000 to the older bill", () => {
    const x = ret(3000, [bill(12, "2026-07-01", 2000), bill(9, "2026-05-01", 9000)], { linkedSalesId: 12 });
    // shown oldest first, filled linked first
    assert.deepEqual(split(x), [
      ["INV/26-27/0009", 1000],
      ["INV/26-27/0012", 2000],
    ]);
    assert.deepEqual(
      x.rows.map((row) => row.linked),
      [false, true],
    );
    assert.equal(x.balanceAfter, r(8000));
  });

  it("return 5,000 with Refund now (Cash) → no advance, 5,000 refunded, balance unchanged", () => {
    const x = ret(5000, [], { remainder: "REFUND", refundMode: "CASH" });
    assert.ok(x.ok);
    assert.deepEqual([x.advanceCreated, x.refund, x.refundMode], [0, r(5000), "CASH"]);
    assert.equal(x.balanceAfter, x.balanceBefore);
  });

  it("Walk-in Customer returns 800 → refund forced (even if Advance was asked for)", () => {
    const x = ret(800, [], { isWalkin: true, remainder: "ADVANCE", refundMode: "BANK1" });
    assert.ok(x.ok);
    assert.deepEqual([x.remainder, x.refund, x.refundMode, x.advanceCreated], ["REFUND", r(800), "BANK1", 0]);
    assert.equal(x.advanceAllowed, false);
    assert.equal(ret(800, [], { isWalkin: true }).refundMode, "CASH");
  });

  it("customer already has an advance → the return simply increases it", () => {
    const x = ret(500, [], { advanceAvailable: r(1000) });
    assert.deepEqual([x.balanceBefore, x.advanceCreated, x.balanceAfter], [-r(1000), r(500), -r(1500)]);
  });
});

describe("allocateReturn — editing the split", () => {
  const dues = [bill(9, "2026-05-01", 9000), bill(12, "2026-07-01", 2000)];

  it("accepts a valid manual split; the rest can be refunded", () => {
    const x = ret(3000, dues, { manual: { "BILL:12": r(2000) }, remainder: "REFUND" });
    assert.ok(x.ok, JSON.stringify(x.errors));
    assert.deepEqual(split(x), [
      ["INV/26-27/0009", 0],
      ["INV/26-27/0012", 2000],
    ]);
    assert.deepEqual([x.refund, x.duesRemaining], [r(1000), r(9000)]);
  });

  it("refuses an advance while bills are left pending (never Dr and Cr)", () => {
    const x = ret(3000, dues, { manual: { "BILL:12": r(2000) } });
    assert.equal(x.ok, false);
    assert.equal(x.errors[0].code, "ADVANCE_WITH_PENDING");
  });

  it("refuses more than a row's pending, more than the return, and unknown rows", () => {
    assert.equal(ret(3000, dues, { manual: { "BILL:12": r(2500) } }).errors[0].code, "ALLOC_EXCEEDS_PENDING");
    assert.ok(ret(3000, dues, { manual: { "BILL:9": r(3000), "BILL:12": r(1000) } }).errors.some((e) => e.code === "ALLOC_EXCEEDS_RETURN"));
    assert.equal(ret(3000, dues, { manual: { "BILL:77": r(100) } }).errors[0].code, "ALLOC_UNKNOWN_ROW");
  });

  it("refuses a zero / negative return value", () => {
    assert.equal(ret(0).errors[0].code, "NOTHING_TO_RETURN");
    assert.equal(ret(-5).ok, false);
  });
});

describe("allocateReturn — invariant (random cases)", () => {
  it("default allocation: an advance only when nothing is pending; balance = dues left − credit", () => {
    let seed = 42;
    const rnd = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed % n;
    };
    for (let i = 0; i < 500; i++) {
      const dues = Array.from({ length: rnd(4) }, (_, k) => bill(k + 1, `2026-0${5 + k}-01`, 1 + rnd(5000)));
      if (rnd(3) === 0) dues.push(opening(1 + rnd(5000)));
      const A = dues.length ? 0 : rnd(3000) * 100; // a customer with credit has no dues
      const x = allocateReturn({
        returnValue: r(1 + rnd(12000)),
        dues,
        advanceAvailable: A,
        linkedSalesId: dues.length && rnd(2) ? 1 : null,
        remainder: rnd(2) ? "ADVANCE" : "REFUND",
        isWalkin: rnd(10) === 0,
      });
      assert.ok(x.ok, JSON.stringify(x.errors));
      if (x.advanceCreated > 0) assert.equal(x.duesRemaining, 0);
      assert.equal(x.applied + x.advanceCreated + x.refund, x.applied + x.remaining);
      assert.equal(x.balanceAfter, x.duesRemaining - (A + x.advanceCreated));
      assert.ok(!(x.duesRemaining > 0 && A + x.advanceCreated > 0), "never both Dr and Cr");
    }
  });
});

describe("checkReturnQty", () => {
  const lines = [
    { key: "1", ref: "T000001", qty: 3, sold: 24, returned: 4 },
    { key: "2", ref: "T000002", qty: 2, sold: 1, returned: 0 },
    { key: "3", ref: "T000003", qty: 1, sold: 0, returned: 0 },
  ];
  it("Off → no check", () => assert.deepEqual(checkReturnQty("OFF", lines), { status: "OK", issues: [] }));
  it("Warn → amber issues, Block → can't save", () => {
    const w = checkReturnQty("WARN", lines);
    assert.equal(w.status, "WARN");
    assert.deepEqual(
      w.issues.map((i) => [i.key, i.returnable]),
      [
        ["2", 1],
        ["3", 0],
      ],
    );
    assert.match(w.issues[1].message, /never sold to this customer/);
    assert.equal(checkReturnQty("BLOCK", lines).status, "BLOCK");
  });
  it("within the limit → OK; the same product on two lines is added up", () => {
    assert.equal(checkReturnQty("BLOCK", [lines[0]]).status, "OK");
    const twice = checkReturnQty("BLOCK", [
      { key: "1", ref: "T000001", qty: 15, sold: 24, returned: 4 },
      { key: "1", ref: "T000001", qty: 6, sold: 24, returned: 4 },
    ]);
    assert.deepEqual([twice.status, twice.issues[0].qty, twice.issues[0].returnable], ["BLOCK", 21, 20]);
  });
});

describe("return GST", () => {
  const flat = (rate: number): DeptTax => ({ gstRate: String(rate), slabEnabled: false, slabThreshold: null, slabRateAbove: null });
  const APPAREL: DeptTax = { gstRate: "5", slabEnabled: true, slabThreshold: "2500", slabRateAbove: "18" };

  it("free-form: Includes GST reverse-calculates, Add GST adds and can be overridden", () => {
    const inc = calcSale({ lines: [{ qty: 2, ratePaise: r(525), dept: flat(5), hsn: "6205" }], gstMode: "INCLUDES", taxType: "INTRA" });
    assert.deepEqual([inc.taxable, inc.gst, inc.net], [r(1000), r(50), r(1050)]);
    const add = calcSale({ lines: [{ qty: 2, ratePaise: r(500), dept: flat(5), hsn: "6205" }], gstMode: "ADD", taxType: "INTRA", gstOverride: 0 });
    assert.deepEqual([add.gstOverridden, add.gst, add.net], [true, 0, r(1000)]);
  });

  it("intra-state → CGST + SGST, inter-state → IGST", () => {
    const intra = calcSale({ lines: [{ qty: 1, ratePaise: r(1050), dept: flat(5), hsn: "6205" }], gstMode: "INCLUDES", taxType: "INTRA" });
    assert.deepEqual([intra.cgst, intra.sgst, intra.igst], [r(25), r(25), 0]);
    const inter = calcSale({ lines: [{ qty: 1, ratePaise: r(1050), dept: flat(5), hsn: "6205" }], gstMode: "INCLUDES", taxType: "INTER" });
    assert.deepEqual([inter.cgst, inter.igst], [0, r(50)]);
  });

  it("against a bill: the bill's GST rate is copied (no slab lookup)", () => {
    // The department now says 18% above ₹2,500, but the bill charged 5% — the return keeps 5%
    const t = linkedLineTax({ amount: r(3000), gstRate: 5, gst: r(142.86) }, false, r(3000));
    assert.deepEqual(t, { fixedRate: 5 });
    const c = calcSale({ lines: [{ qty: 1, ratePaise: r(3000), dept: APPAREL, hsn: "6205", ...t }], gstMode: "INCLUDES", taxType: "INTRA" });
    assert.equal(c.lines[0].gstRate, 5);
    assert.equal(c.gst, r(142.86));
    assert.deepEqual(c.breakup.map((b) => b.rate), [5]);
  });

  it("against a bill whose GST was overridden: the same share of that line's GST", () => {
    // Bill line: 4 × 500 = 2,000, GST overridden to 30 (auto would be 100). Return 1 piece → 7.50
    const t = linkedLineTax({ amount: r(2000), gstRate: 5, gst: r(30) }, true, r(500));
    assert.deepEqual(t, { fixedRate: 5, fixedGst: r(7.5) });
    const c = calcSale({ lines: [{ qty: 1, ratePaise: r(500), dept: flat(5), hsn: "6205", ...t }], gstMode: "ADD", taxType: "INTRA" });
    assert.deepEqual([c.taxable, c.gst, c.cgst, c.sgst], [r(500), r(7.5), r(3.75), r(3.75)]);
    // Includes mode: taxable = amount − copied GST
    const inc = calcSale({ lines: [{ qty: 1, ratePaise: r(500), dept: flat(5), hsn: "6205", fixedRate: 5, fixedGst: r(7.5) }], gstMode: "INCLUDES", taxType: "INTRA" });
    assert.deepEqual([inc.taxable, inc.gst, inc.net], [r(492.5), r(7.5), r(500)]);
  });
});
