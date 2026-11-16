/**
 * Payment allocation for a sales bill or a standalone customer receipt.
 * Pure function — used live by the payment panel and, authoritatively, by the
 * server when saving. All amounts are integer paise.
 *
 * Definitions
 *   P = Cash + Bank 1 + Bank 2 received now (cash as tendered)
 *   B = this bill's Net Payable (0 for a standalone receipt)
 *   O = previous outstanding: opening balance + unpaid older bills, oldest first
 *   A = the customer's unused advance
 *
 * Rules
 *  1. Advance first: up to min(A, B) of the customer's credit (advance + return
 *     credit) pays this bill — the "Adjust" checkbox, on by default. It may be
 *     left unused only when the bill is fully paid now: a customer is never in
 *     Debit (credit bill) and in Credit (unused advance) at the same time.
 *  2. Previous balance first: P goes to O oldest-first (FIFO), then to the
 *     current bill, the rest is excess. The split can be edited (settlement
 *     table) as long as no row exceeds its pending amount and the total ≤ P.
 *  3. Credit = the part of B not paid by advance or P. Never negative, never
 *     creates an advance.
 *  4. Excess is either returned as change (only out of cash) or kept as a new
 *     advance — the latter only when no previous balance remains.
 *  5. Walk-in Customer: no credit and no advance (unless the settings allow it).
 */

export type DueKind = "OPENING" | "BILL";

export type Due = {
  /** Stable key: "OPENING" or "BILL:<salesId>" */
  key: string;
  kind: DueKind;
  salesId?: number;
  ref: string; // bill no. or "Opening balance"
  date: string; // YYYY-MM-DD
  pending: number;
};

export const CURRENT_BILL = "CURRENT";

export type ExcessChoice = "ADVANCE" | "CHANGE";

export type AllocateInput = {
  billAmount: number;
  dues: Due[]; // any order — sorted oldest first here
  advanceAvailable: number;
  received: { cash: number; bank1: number; bank2: number };
  /** Advance to use against this bill. Omit for the default (as much as possible). */
  advanceUsed?: number;
  /**
   * Manual split of P (settlement table): key → amount, keys are Due.key or
   * CURRENT_BILL. Omit for the default previous-first FIFO split.
   */
  manual?: Record<string, number>;
  /** What to do with any excess. Omit for the default (Walk-in → change, others → advance when allowed). */
  excess?: ExcessChoice;
  isWalkin?: boolean;
  walkinAllowCredit?: boolean;
  walkinAllowAdvance?: boolean;
};

export type AllocationError = {
  code:
    | "NEGATIVE_AMOUNT"
    | "ADVANCE_USE_INVALID"
    | "ALLOC_EXCEEDS_PENDING"
    | "ALLOC_EXCEEDS_RECEIVED"
    | "ALLOC_UNKNOWN_ROW"
    | "ADVANCE_WITH_PREVIOUS_BALANCE"
    | "ADVANCE_NOT_ALLOWED_WALKIN"
    | "CREDIT_NOT_ALLOWED_WALKIN"
    | "CREDIT_WITH_ADVANCE"
    | "CHANGE_EXCEEDS_CASH"
    | "NOTHING_TO_ALLOCATE";
  message: string;
  key?: string;
};

export type AllocationRow = { key: string; kind: DueKind | "CURRENT"; salesId?: number; ref: string; date: string; pending: number; amount: number };

export type AllocateResult = {
  ok: boolean;
  errors: AllocationError[];
  /** Total received now (cash as tendered + banks). */
  received: number;
  /** Received less change returned — what is actually kept. */
  kept: number;
  advanceUsed: number;
  maxAdvanceUse: number;
  /** One row per previous due (oldest first) + the current bill last (when B > 0). */
  rows: AllocationRow[];
  appliedToPrevious: number;
  appliedToBill: number;
  credit: number;
  excess: number;
  excessChoice: ExcessChoice | null;
  advanceCreated: number;
  change: number;
  previousRemaining: number;
  /** Can the excess be kept as advance? (false → the reason, for the tooltip) */
  advanceAllowed: boolean;
  advanceBlockedReason: string | null;
  /** Signed balance, + Dr (to receive) / − Cr (advance). */
  balanceBefore: number;
  balanceAfter: number;
};

export const PREVIOUS_BALANCE_MSG = "Customer has a previous balance. Settle it first.";

const byOldest = (a: Due, b: Due) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.kind === "OPENING" ? -1 : b.kind === "OPENING" ? 1 : (a.salesId ?? 0) - (b.salesId ?? 0));

export function allocatePayment(inp: AllocateInput): AllocateResult {
  const errors: AllocationError[] = [];
  const B = Math.max(0, inp.billAmount);
  const dues = [...inp.dues].filter((d) => d.pending > 0).sort(byOldest);
  const O = dues.reduce((a, d) => a + d.pending, 0);
  const A = Math.max(0, inp.advanceAvailable);
  const { cash, bank1, bank2 } = inp.received;
  if ([inp.billAmount, A, cash, bank1, bank2, inp.advanceUsed ?? 0, ...Object.values(inp.manual ?? {})].some((v) => v < 0))
    errors.push({ code: "NEGATIVE_AMOUNT", message: "Amounts can't be negative" });
  const P = Math.max(0, cash) + Math.max(0, bank1) + Math.max(0, bank2);

  // 1. Advance against this bill
  const maxAdvanceUse = Math.min(A, B);
  let advanceUsed = inp.advanceUsed ?? maxAdvanceUse;
  if (advanceUsed < 0 || advanceUsed > maxAdvanceUse) {
    errors.push({ code: "ADVANCE_USE_INVALID", message: `Advance used can be at most ₹${fmt(maxAdvanceUse)}` });
    advanceUsed = Math.min(Math.max(0, advanceUsed), maxAdvanceUse);
  }
  const billOpen = B - advanceUsed;

  // 2. Split of P
  const rows: AllocationRow[] = dues.map((d) => ({ key: d.key, kind: d.kind, salesId: d.salesId, ref: d.ref, date: d.date, pending: d.pending, amount: 0 }));
  if (B > 0) rows.push({ key: CURRENT_BILL, kind: "CURRENT", ref: "This bill", date: "", pending: billOpen, amount: 0 });

  if (inp.manual) {
    const known = new Set(rows.map((r) => r.key));
    for (const k of Object.keys(inp.manual))
      if (!known.has(k) && (inp.manual[k] ?? 0) > 0) errors.push({ code: "ALLOC_UNKNOWN_ROW", message: "A bill in the settlement table is no longer pending", key: k });
    for (const r of rows) {
      r.amount = Math.max(0, inp.manual[r.key] ?? 0);
      if (r.amount > r.pending)
        errors.push({ code: "ALLOC_EXCEEDS_PENDING", message: `${r.ref}: allocated ₹${fmt(r.amount)} is more than the pending ₹${fmt(r.pending)}`, key: r.key });
    }
    const total = rows.reduce((a, r) => a + r.amount, 0);
    if (total > P) errors.push({ code: "ALLOC_EXCEEDS_RECEIVED", message: `Allocated ₹${fmt(total)} is more than the ₹${fmt(P)} received` });
  } else {
    let left = P;
    for (const r of rows) {
      r.amount = Math.min(left, r.pending);
      left -= r.amount;
    }
  }

  const appliedToPrevious = rows.filter((r) => r.kind !== "CURRENT").reduce((a, r) => a + r.amount, 0);
  const appliedToBill = rows.find((r) => r.kind === "CURRENT")?.amount ?? 0;
  const credit = Math.max(0, billOpen - appliedToBill);
  const excess = Math.max(0, P - appliedToPrevious - appliedToBill);
  const previousRemaining = O - appliedToPrevious;

  // 3. Never Dr and Cr at once: no credit bill while credit is left unused
  if (credit > 0 && advanceUsed < maxAdvanceUse)
    errors.push({
      code: "CREDIT_WITH_ADVANCE",
      message: `Customer has ₹${fmt(A - advanceUsed)} advance / credit — adjust it against this bill before leaving ₹${fmt(credit)} on credit`,
    });

  // Walk-in credit
  if (inp.isWalkin && !inp.walkinAllowCredit && credit > 0)
    errors.push({ code: "CREDIT_NOT_ALLOWED_WALKIN", message: `Walk-in Customer can't buy on credit — ₹${fmt(credit)} is still unpaid` });

  // 4. Excess
  let advanceBlockedReason: string | null = null;
  if (inp.isWalkin && !inp.walkinAllowAdvance) advanceBlockedReason = "Walk-in Customer can't keep an advance";
  else if (previousRemaining > 0) advanceBlockedReason = PREVIOUS_BALANCE_MSG;
  const advanceAllowed = advanceBlockedReason === null;

  let excessChoice: ExcessChoice | null = null;
  let advanceCreated = 0;
  let change = 0;
  if (excess > 0) {
    excessChoice = inp.excess ?? (advanceAllowed && !inp.isWalkin ? "ADVANCE" : "CHANGE");
    if (excessChoice === "ADVANCE") {
      if (!advanceAllowed)
        errors.push({
          code: inp.isWalkin && !inp.walkinAllowAdvance ? "ADVANCE_NOT_ALLOWED_WALKIN" : "ADVANCE_WITH_PREVIOUS_BALANCE",
          message: advanceBlockedReason!,
        });
      advanceCreated = excess;
    } else {
      if (excess > Math.max(0, cash))
        errors.push({ code: "CHANGE_EXCEEDS_CASH", message: `Change ₹${fmt(excess)} can't be more than the cash received ₹${fmt(Math.max(0, cash))}` });
      change = excess;
    }
  }

  if (B === 0 && P === 0) errors.push({ code: "NOTHING_TO_ALLOCATE", message: "Enter the amount received" });

  const balanceBefore = O - A;
  const kept = P - change;
  const balanceAfter = balanceBefore + B - kept;

  return {
    ok: errors.length === 0,
    errors,
    received: P,
    kept,
    advanceUsed,
    maxAdvanceUse,
    rows,
    appliedToPrevious,
    appliedToBill,
    credit,
    excess,
    excessChoice,
    advanceCreated,
    change,
    previousRemaining,
    advanceAllowed,
    advanceBlockedReason,
    balanceBefore,
    balanceAfter,
  };
}

function fmt(p: number) {
  const r = p / 100;
  return r.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
