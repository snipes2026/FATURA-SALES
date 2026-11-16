import { allocatePayment, type AllocateResult, type Due, type ExcessChoice } from "@/lib/sales/allocate";
import { MONEY_RE, toPaise } from "@/lib/money";

/** What the cashier typed in the payment panel (strings, as typed). */
export type PaymentState = {
  cash: string;
  bank1: string;
  bank2: string;
  /** null = "Adjust" on: use as much advance / credit as possible; "0" = Adjust off */
  advanceUsed: string | null;
  /** null = default previous-first (FIFO) split; otherwise the edited settlement table */
  manual: Record<string, string> | null;
  /** null = default (Walk-in → change, others → advance when allowed) */
  excess: ExcessChoice | null;
};

export const EMPTY_PAYMENT: PaymentState = { cash: "", bank1: "", bank2: "", advanceUsed: null, manual: null, excess: null };

export type PaymentContext = {
  billAmount: number; // paise; 0 for a standalone receipt
  dues: Due[];
  advanceAvailable: number;
  /** Of the advance available, how much came from sales returns (shown as a breakdown). */
  advanceFromReturns?: number;
  isWalkin: boolean;
  walkinAllowCredit: boolean;
  walkinAllowAdvance: boolean;
  bank2Enabled: boolean;
};

export const validMoney = (v: string) => v.trim() === "" || MONEY_RE.test(v.trim().replace(/,/g, ""));
const p = (v: string) => (validMoney(v) ? toPaise(v.trim().replace(/,/g, "")) : 0);

export function paymentInvalidFields(s: PaymentState): string[] {
  const bad: string[] = [];
  for (const k of ["cash", "bank1", "bank2"] as const) if (!validMoney(s[k])) bad.push(k);
  if (s.advanceUsed !== null && !validMoney(s.advanceUsed)) bad.push("advanceUsed");
  for (const [k, v] of Object.entries(s.manual ?? {})) if (!validMoney(v)) bad.push(`manual:${k}`);
  return bad;
}

/** Runs allocatePayment() on the panel state. Used by the panel (live) and to build the save payload. */
export function computePayment(s: PaymentState, ctx: PaymentContext): AllocateResult {
  return allocatePayment({
    billAmount: ctx.billAmount,
    dues: ctx.dues,
    advanceAvailable: ctx.advanceAvailable,
    received: { cash: p(s.cash), bank1: p(s.bank1), bank2: ctx.bank2Enabled ? p(s.bank2) : 0 },
    advanceUsed: s.advanceUsed === null ? undefined : p(s.advanceUsed),
    manual: s.manual ? Object.fromEntries(Object.entries(s.manual).map(([k, v]) => [k, p(v)])) : undefined,
    excess: s.excess ?? undefined,
    isWalkin: ctx.isWalkin,
    walkinAllowCredit: ctx.walkinAllowCredit,
    walkinAllowAdvance: ctx.walkinAllowAdvance,
  });
}
