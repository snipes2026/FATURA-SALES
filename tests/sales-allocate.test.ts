/**
 * Unit tests for allocatePayment() (src/lib/sales/allocate.ts).
 * Run: npm test
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { allocatePayment, CURRENT_BILL, PREVIOUS_BALANCE_MSG, type AllocateInput, type Due } from "../src/lib/sales/allocate";

const r = (rupees: number) => Math.round(rupees * 100);

function inp(p: Partial<AllocateInput> & { cash?: number; bank1?: number; bank2?: number }): AllocateInput {
  const { cash = 0, bank1 = 0, bank2 = 0, ...rest } = p;
  return { billAmount: 0, dues: [], advanceAvailable: 0, received: { cash: r(cash), bank1: r(bank1), bank2: r(bank2) }, ...rest };
}

const bill = (salesId: number, date: string, pending: number): Due => ({ key: `BILL:${salesId}`, kind: "BILL", salesId, ref: `INV/${salesId}`, date, pending: r(pending) });
const opening = (pending: number, date = "2026-04-01"): Due => ({ key: "OPENING", kind: "OPENING", ref: "Opening balance", date, pending: r(pending) });

/** Previous ₹20,000 made of the opening balance + two older bills. */
const PREV_20K = [bill(7, "2026-06-10", 5000), opening(10000), bill(3, "2026-05-01", 5000)];

describe("allocatePayment — the worked examples", () => {
  it("1. no previous balance, bill 10,000, cash 15,000 → settled, 5,000 advance, 5,000 Cr", () => {
    const a = allocatePayment(inp({ billAmount: r(10000), cash: 15000 }));
    assert.equal(a.ok, true);
    assert.equal(a.appliedToBill, r(10000));
    assert.equal(a.credit, 0);
    assert.equal(a.excessChoice, "ADVANCE");
    assert.equal(a.advanceCreated, r(5000));
    assert.equal(a.balanceAfter, -r(5000));
  });

  it("2. previous 20,000, bill 15,000, cash 20,000 → all to previous, credit 15,000, 15,000 Dr", () => {
    const a = allocatePayment(inp({ billAmount: r(15000), dues: PREV_20K, cash: 20000 }));
    assert.equal(a.ok, true);
    assert.equal(a.appliedToPrevious, r(20000));
    assert.equal(a.appliedToBill, 0);
    assert.equal(a.credit, r(15000));
    assert.equal(a.advanceCreated, 0);
    assert.equal(a.balanceAfter, r(15000));
  });

  it("3. previous 20,000, bill 15,000, cash 40,000 → 20,000 previous, 15,000 bill, 5,000 advance, 5,000 Cr", () => {
    const a = allocatePayment(inp({ billAmount: r(15000), dues: PREV_20K, cash: 40000 }));
    assert.equal(a.ok, true);
    assert.equal(a.appliedToPrevious, r(20000));
    assert.equal(a.appliedToBill, r(15000));
    assert.equal(a.previousRemaining, 0);
    assert.equal(a.advanceCreated, r(5000));
    assert.equal(a.balanceAfter, -r(5000));
  });

  it("4. previous 20,000, bill 15,000, credit only → nothing received, 35,000 Dr", () => {
    const a = allocatePayment(inp({ billAmount: r(15000), dues: PREV_20K }));
    assert.equal(a.ok, true);
    assert.equal(a.received, 0);
    assert.equal(a.credit, r(15000));
    assert.equal(a.balanceAfter, r(35000));
  });

  it("5. bill 10,000, cash 4,000 + bank 1 3,000 → credit 3,000, 3,000 Dr", () => {
    const a = allocatePayment(inp({ billAmount: r(10000), cash: 4000, bank1: 3000 }));
    assert.equal(a.ok, true);
    assert.equal(a.appliedToBill, r(7000));
    assert.equal(a.credit, r(3000));
    assert.equal(a.balanceAfter, r(3000));
  });

  it("5b. same, with a previous 2,000 → previous settled first, credit 5,000, balance includes it", () => {
    const a = allocatePayment(inp({ billAmount: r(10000), dues: [opening(2000)], cash: 4000, bank1: 3000 }));
    assert.equal(a.appliedToPrevious, r(2000));
    assert.equal(a.appliedToBill, r(5000));
    assert.equal(a.credit, r(5000));
    assert.equal(a.balanceAfter, r(5000));
  });
});

describe("allocatePayment — FIFO and the settlement table", () => {
  it("settles the oldest due first, whatever order they come in", () => {
    const a = allocatePayment(inp({ billAmount: r(15000), dues: PREV_20K, cash: 12000 }));
    assert.deepEqual(
      a.rows.map((x) => [x.key, x.amount / 100]),
      [
        ["OPENING", 10000],
        ["BILL:3", 2000],
        ["BILL:7", 0],
        [CURRENT_BILL, 0],
      ],
    );
    assert.equal(a.credit, r(15000));
  });

  it("orders same-date dues: opening first, then by bill id", () => {
    const a = allocatePayment(inp({ dues: [bill(9, "2026-04-01", 100), bill(4, "2026-04-01", 100), opening(100)], cash: 300 }));
    assert.deepEqual(
      a.rows.map((x) => x.key),
      ["OPENING", "BILL:4", "BILL:9"],
    );
  });

  it("accepts an edited split (pay this bill first, leave an old bill pending)", () => {
    const a = allocatePayment(inp({ billAmount: r(15000), dues: PREV_20K, cash: 20000, manual: { OPENING: r(5000), [CURRENT_BILL]: r(15000) } }));
    assert.equal(a.ok, true);
    assert.equal(a.appliedToPrevious, r(5000));
    assert.equal(a.appliedToBill, r(15000));
    assert.equal(a.credit, 0);
    assert.equal(a.previousRemaining, r(15000));
    assert.equal(a.balanceAfter, r(15000));
  });

  it("rejects a row above its pending amount", () => {
    const a = allocatePayment(inp({ billAmount: r(15000), dues: PREV_20K, cash: 20000, manual: { "BILL:3": r(6000) } }));
    assert.equal(a.ok, false);
    assert.equal(a.errors[0].code, "ALLOC_EXCEEDS_PENDING");
    assert.equal(a.errors[0].key, "BILL:3");
  });

  it("rejects a total above the amount received", () => {
    const a = allocatePayment(inp({ billAmount: r(15000), dues: PREV_20K, cash: 10000, manual: { OPENING: r(10000), [CURRENT_BILL]: r(5000) } }));
    assert.ok(a.errors.some((e) => e.code === "ALLOC_EXCEEDS_RECEIVED"));
  });

  it("an unallocated remainder while dues remain can't be advance", () => {
    const a = allocatePayment(inp({ billAmount: r(15000), dues: PREV_20K, cash: 20000, manual: { [CURRENT_BILL]: r(15000) }, excess: "ADVANCE" }));
    assert.equal(a.ok, false);
    assert.equal(a.errors[0].code, "ADVANCE_WITH_PREVIOUS_BALANCE");
    assert.equal(a.errors[0].message, PREVIOUS_BALANCE_MSG);
    assert.equal(a.advanceAllowed, false);
  });

  it("a remainder after every bill is cleared becomes advance", () => {
    const a = allocatePayment(inp({ billAmount: r(15000), dues: PREV_20K, cash: 36000, manual: { OPENING: r(10000), "BILL:3": r(5000), "BILL:7": r(5000), [CURRENT_BILL]: r(15000) } }));
    assert.equal(a.ok, true);
    assert.equal(a.advanceCreated, r(1000));
    assert.equal(a.balanceAfter, -r(1000));
  });
});

describe("allocatePayment — credit, change and advance", () => {
  it("credit never exceeds the unpaid part and never creates an advance", () => {
    const a = allocatePayment(inp({ billAmount: r(1000), cash: 400 }));
    assert.equal(a.credit, r(600));
    assert.equal(a.advanceCreated, 0);
    const b = allocatePayment(inp({ billAmount: r(1000), cash: 1000 }));
    assert.equal(b.credit, 0);
  });

  it("excess can be returned as change — only the bill amount is kept", () => {
    const a = allocatePayment(inp({ billAmount: r(950), cash: 1000, excess: "CHANGE" }));
    assert.equal(a.ok, true);
    assert.equal(a.change, r(50));
    assert.equal(a.kept, r(950));
    assert.equal(a.advanceCreated, 0);
    assert.equal(a.balanceAfter, 0);
  });

  it("change can only come out of cash", () => {
    const a = allocatePayment(inp({ billAmount: r(950), cash: 20, bank1: 1000, excess: "CHANGE" }));
    assert.equal(a.errors[0].code, "CHANGE_EXCEEDS_CASH");
  });

  it("uses the customer's advance for this bill first (default: as much as possible)", () => {
    const a = allocatePayment(inp({ billAmount: r(10000), advanceAvailable: r(5000), cash: 5000 }));
    assert.equal(a.ok, true);
    assert.equal(a.advanceUsed, r(5000));
    assert.equal(a.appliedToBill, r(5000));
    assert.equal(a.credit, 0);
    assert.equal(a.balanceBefore, -r(5000));
    assert.equal(a.balanceAfter, 0);
  });

  it("advance used is capped at the bill and can be reduced", () => {
    const a = allocatePayment(inp({ billAmount: r(3000), advanceAvailable: r(5000) }));
    assert.equal(a.advanceUsed, r(3000));
    assert.equal(a.balanceAfter, -r(2000));
    const b = allocatePayment(inp({ billAmount: r(3000), advanceAvailable: r(5000), advanceUsed: r(1000), cash: 2000 }));
    assert.equal(b.ok, true);
    assert.equal(b.appliedToBill, r(2000));
    const c = allocatePayment(inp({ billAmount: r(3000), advanceAvailable: r(5000), advanceUsed: r(4000) }));
    assert.equal(c.errors[0].code, "ADVANCE_USE_INVALID");
  });

  it("Section 6 example: advance 5,000, bill 12,000, cash 7,000 → no credit, balance Nil", () => {
    const a = allocatePayment(inp({ billAmount: r(12000), advanceAvailable: r(5000), cash: 7000 }));
    assert.ok(a.ok);
    assert.deepEqual([a.advanceUsed, a.appliedToBill, a.credit, a.balanceAfter], [r(5000), r(7000), 0, 0]);
  });

  it("Adjust off: allowed only when the bill is fully paid now (never Dr and Cr at once)", () => {
    const off = allocatePayment(inp({ billAmount: r(12000), advanceAvailable: r(5000), advanceUsed: 0, cash: 7000 }));
    assert.equal(off.ok, false);
    assert.equal(off.errors[0].code, "CREDIT_WITH_ADVANCE");
    const paid = allocatePayment(inp({ billAmount: r(12000), advanceAvailable: r(5000), advanceUsed: 0, cash: 12000 }));
    assert.ok(paid.ok);
    assert.deepEqual([paid.credit, paid.balanceAfter], [0, -r(5000)]);
  });
});

describe("allocatePayment — Walk-in Customer", () => {
  const walkin = { isWalkin: true, walkinAllowCredit: false, walkinAllowAdvance: false };

  it("can't buy on credit", () => {
    const a = allocatePayment(inp({ ...walkin, billAmount: r(1000), cash: 800 }));
    assert.equal(a.ok, false);
    assert.equal(a.errors[0].code, "CREDIT_NOT_ALLOWED_WALKIN");
  });

  it("overpaying defaults to change to return", () => {
    const a = allocatePayment(inp({ ...walkin, billAmount: r(950), cash: 1000 }));
    assert.equal(a.ok, true);
    assert.equal(a.excessChoice, "CHANGE");
    assert.equal(a.change, r(50));
    assert.equal(a.advanceAllowed, false);
  });

  it("can't keep an advance", () => {
    const a = allocatePayment(inp({ ...walkin, billAmount: r(950), cash: 1000, excess: "ADVANCE" }));
    assert.equal(a.errors[0].code, "ADVANCE_NOT_ALLOWED_WALKIN");
  });

  it("settings can allow credit / advance", () => {
    const a = allocatePayment(inp({ isWalkin: true, walkinAllowCredit: true, walkinAllowAdvance: true, billAmount: r(1000), cash: 800 }));
    assert.equal(a.ok, true);
    const b = allocatePayment(inp({ isWalkin: true, walkinAllowCredit: true, walkinAllowAdvance: true, billAmount: r(950), cash: 1000, excess: "ADVANCE" }));
    assert.equal(b.ok, true);
    assert.equal(b.advanceCreated, r(50));
  });
});

describe("allocatePayment — standalone receipt (no bill)", () => {
  it("settles pending bills FIFO", () => {
    const a = allocatePayment(inp({ dues: PREV_20K, cash: 12000 }));
    assert.equal(a.ok, true);
    assert.equal(a.appliedToPrevious, r(12000));
    assert.equal(a.rows.find((x) => x.key === CURRENT_BILL), undefined);
    assert.equal(a.balanceAfter, r(8000));
  });

  it("advance only when nothing is pending", () => {
    assert.equal(allocatePayment(inp({ cash: 500 })).advanceCreated, r(500));
    const a = allocatePayment(inp({ dues: PREV_20K, cash: 25000 }));
    assert.equal(a.advanceCreated, r(5000)); // all 20,000 cleared first
    assert.equal(a.ok, true);
  });

  it("needs an amount", () => {
    assert.equal(allocatePayment(inp({})).errors[0].code, "NOTHING_TO_ALLOCATE");
  });

  it("rejects negative amounts", () => {
    const a = allocatePayment({ ...inp({ billAmount: r(100) }), received: { cash: -100, bank1: 0, bank2: 0 } });
    assert.equal(a.errors[0].code, "NEGATIVE_AMOUNT");
  });
});
