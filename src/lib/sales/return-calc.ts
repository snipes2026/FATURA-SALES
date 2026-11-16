/**
 * Sales Return — pure calculations shared by the return screen (live) and the
 * server (authoritative). All amounts are integer paise.
 *
 *  allocateReturn()  how the return value R settles the customer's account
 *  checkReturnQty()  returned qty vs qty sold to the customer (Off / Warn / Block)
 *  linkedLineTax()   GST of a line returned against a specific bill
 *
 * Rules for R (Net Return Value), O = pending dues (opening balance + unpaid
 * bills), A = the customer's existing unused credit:
 *  1. R is a Cr in the customer ledger; the balance moves by −R.
 *  2. R first reduces O — the linked bill first (when the return is against a
 *     bill), then oldest first. The split is editable: no row above its pending
 *     amount, total ≤ R.
 *  3. What is left of R is either kept as an Advance (credit on the account) or
 *     refunded now (Cash / Bank 1 / Bank 2). Walk-in Customer: refund only.
 *  4. Invariant — never Dr and Cr at once: an advance may be kept only when no
 *     pending dues remain unapplied.
 */
import type { Due } from "./allocate";

export type RemainderChoice = "ADVANCE" | "REFUND";
export type RefundMode = "CASH" | "BANK1" | "BANK2";

export type ReturnAllocateInput = {
  returnValue: number;
  dues: Due[]; // any order
  advanceAvailable: number;
  /** The bill this return is against — its pending amount is applied first. */
  linkedSalesId?: number | null;
  /** Manual split: Due.key → amount. Omit for the default (linked bill, then oldest first). */
  manual?: Record<string, number> | null;
  /** Omit for the default: Advance (Walk-in → Refund). */
  remainder?: RemainderChoice | null;
  /** Omit for the default: Cash. */
  refundMode?: RefundMode | null;
  isWalkin?: boolean;
};

export type ReturnAllocationError = {
  code:
    | "NOTHING_TO_RETURN"
    | "NEGATIVE_AMOUNT"
    | "ALLOC_UNKNOWN_ROW"
    | "ALLOC_EXCEEDS_PENDING"
    | "ALLOC_EXCEEDS_RETURN"
    | "ADVANCE_WITH_PENDING"
    | "ADVANCE_NOT_ALLOWED_WALKIN";
  message: string;
  key?: string;
};

export type ReturnAllocationRow = Due & { amount: number; linked: boolean };

export type ReturnAllocateResult = {
  ok: boolean;
  errors: ReturnAllocationError[];
  /** One row per pending due, oldest first (the linked bill is flagged). */
  rows: ReturnAllocationRow[];
  applied: number;
  /** R not applied to any due. */
  remaining: number;
  remainder: RemainderChoice | null;
  advanceCreated: number;
  refund: number;
  refundMode: RefundMode | null;
  /** Dues still pending after this return. */
  duesRemaining: number;
  advanceAllowed: boolean;
  advanceBlockedReason: string | null;
  /** Signed, + Dr (to receive) / − Cr (advance). */
  balanceBefore: number;
  balanceAfter: number;
};

const byOldest = (a: Due, b: Due) =>
  a.date < b.date ? -1 : a.date > b.date ? 1 : a.kind === "OPENING" ? -1 : b.kind === "OPENING" ? 1 : (a.salesId ?? 0) - (b.salesId ?? 0);

export const ADVANCE_WITH_PENDING_MSG = "Customer still has pending bills — apply the return to them before keeping an advance.";

export function allocateReturn(inp: ReturnAllocateInput): ReturnAllocateResult {
  const errors: ReturnAllocationError[] = [];
  const R = Math.max(0, inp.returnValue);
  const A = Math.max(0, inp.advanceAvailable);
  if (inp.returnValue < 0 || inp.advanceAvailable < 0 || Object.values(inp.manual ?? {}).some((v) => v < 0))
    errors.push({ code: "NEGATIVE_AMOUNT", message: "Amounts can't be negative" });
  if (R === 0) errors.push({ code: "NOTHING_TO_RETURN", message: "The return value must be more than zero" });

  const dues = inp.dues.filter((d) => d.pending > 0).sort(byOldest);
  const O = dues.reduce((a, d) => a + d.pending, 0);
  const rows: ReturnAllocationRow[] = dues.map((d) => ({ ...d, amount: 0, linked: inp.linkedSalesId != null && d.salesId === inp.linkedSalesId }));

  if (inp.manual) {
    const known = new Set(rows.map((r) => r.key));
    for (const k of Object.keys(inp.manual))
      if (!known.has(k) && (inp.manual[k] ?? 0) > 0) errors.push({ code: "ALLOC_UNKNOWN_ROW", message: "A bill in the table is no longer pending", key: k });
    for (const r of rows) {
      r.amount = Math.max(0, inp.manual[r.key] ?? 0);
      if (r.amount > r.pending) errors.push({ code: "ALLOC_EXCEEDS_PENDING", message: `${r.ref}: ₹${fmt(r.amount)} is more than the pending ₹${fmt(r.pending)}`, key: r.key });
    }
    const total = rows.reduce((a, r) => a + r.amount, 0);
    if (total > R) errors.push({ code: "ALLOC_EXCEEDS_RETURN", message: `Allocated ₹${fmt(total)} is more than the return value ₹${fmt(R)}` });
  } else {
    let left = R;
    const order = [...rows.filter((r) => r.linked), ...rows.filter((r) => !r.linked)];
    for (const r of order) {
      r.amount = Math.min(left, r.pending);
      left -= r.amount;
    }
  }

  const applied = rows.reduce((a, r) => a + r.amount, 0);
  const remaining = Math.max(0, R - applied);
  const duesRemaining = O - applied;

  let advanceBlockedReason: string | null = null;
  if (inp.isWalkin) advanceBlockedReason = "Walk-in Customer can't keep an advance — refund it";
  else if (duesRemaining > 0) advanceBlockedReason = ADVANCE_WITH_PENDING_MSG;
  const advanceAllowed = advanceBlockedReason === null;

  let remainder: RemainderChoice | null = null;
  let advanceCreated = 0;
  let refund = 0;
  let refundMode: RefundMode | null = null;
  if (remaining > 0) {
    remainder = inp.isWalkin ? "REFUND" : (inp.remainder ?? "ADVANCE");
    if (remainder === "ADVANCE") {
      if (!advanceAllowed) errors.push({ code: inp.isWalkin ? "ADVANCE_NOT_ALLOWED_WALKIN" : "ADVANCE_WITH_PENDING", message: advanceBlockedReason! });
      advanceCreated = remaining;
    } else {
      refund = remaining;
      refundMode = inp.refundMode ?? "CASH";
    }
  }

  const balanceBefore = O - A;
  const balanceAfter = balanceBefore - R + refund;

  return {
    ok: errors.length === 0,
    errors,
    rows,
    applied,
    remaining,
    remainder,
    advanceCreated,
    refund,
    refundMode,
    duesRemaining,
    advanceAllowed,
    advanceBlockedReason,
    balanceBefore,
    balanceAfter,
  };
}

// ---------------------------------------------------------------- return quantity check
export type QtyCheckMode = "OFF" | "WARN" | "BLOCK";

export type QtyCheckLine = {
  /** Product id, or the original sales line id when the return is against a bill. */
  key: string;
  ref: string; // barcode / item name, for the message
  qty: number;
  /** Qty sold to this customer (or on the linked bill line), non-cancelled bills. */
  sold: number;
  /** Qty already returned against that, non-cancelled returns. */
  returned: number;
};

export type QtyIssue = { key: string; ref: string; qty: number; returnable: number; message: string };

export type QtyCheckResult = {
  /** OK — nothing to say; WARN — amber, needs confirmation; BLOCK — can't save. */
  status: "OK" | "WARN" | "BLOCK";
  issues: QtyIssue[];
};

export function checkReturnQty(mode: QtyCheckMode, lines: QtyCheckLine[]): QtyCheckResult {
  if (mode === "OFF") return { status: "OK", issues: [] };
  const byKey = new Map<string, QtyCheckLine>();
  for (const l of lines) {
    const prev = byKey.get(l.key);
    byKey.set(l.key, prev ? { ...prev, qty: prev.qty + l.qty } : { ...l });
  }
  const issues: QtyIssue[] = [];
  for (const l of byKey.values()) {
    const returnable = Math.max(0, l.sold - l.returned);
    if (l.qty > returnable)
      issues.push({
        key: l.key,
        ref: l.ref,
        qty: l.qty,
        returnable,
        message:
          l.sold === 0
            ? `${l.ref}: never sold to this customer`
            : `${l.ref}: returning ${l.qty}, but only ${returnable} can be returned (sold ${l.sold}, already returned ${l.returned})`,
      });
  }
  return { status: issues.length === 0 ? "OK" : mode, issues };
}

// ---------------------------------------------------------------- GST of a line returned against a bill
export type OriginalLine = { amount: number; gstRate: number; gst: number };

/**
 * The return copies the bill: same GST rate (no slab lookup). When the bill's
 * GST was overridden, the return takes the same share of that line's GST as its
 * share of the line's amount.
 */
export function linkedLineTax(orig: OriginalLine, billGstOverridden: boolean, returnAmount: number): { fixedRate: number; fixedGst?: number } {
  if (!billGstOverridden) return { fixedRate: orig.gstRate };
  const share = orig.amount > 0 ? Math.round((orig.gst * Math.min(returnAmount, orig.amount)) / orig.amount) : 0;
  return { fixedRate: orig.gstRate, fixedGst: share };
}

function fmt(p: number) {
  return (p / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
