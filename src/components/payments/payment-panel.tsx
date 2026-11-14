"use client";

import { Info, Pencil, RotateCcw } from "lucide-react";
import { BalanceText } from "@/components/customers/balance-text";
import { formatDate } from "@/lib/dates";
import { formatAmount } from "@/lib/india";
import { fromPaise, toPaise } from "@/lib/money";
import type { AllocateResult } from "@/lib/sales/allocate";
import { cn } from "@/lib/utils";
import { validMoney, type PaymentContext, type PaymentState } from "./payment-state";

const amt = (p: number) => formatAmount(fromPaise(p));
const inputCls =
  "h-9 w-full rounded-md border bg-surface px-2 text-right text-base tabular-nums focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20";

/**
 * Payment panel shared by the Sales screen and the Customer Receipt screen.
 * Controlled: the parent holds PaymentState and the computed AllocateResult.
 */
export function PaymentPanel({
  state,
  onChange,
  result,
  ctx,
  bank1Name,
  bank2Name,
  title = "Net Payable",
  footer,
  showErrors = true,
}: {
  /** false while there is nothing to pay yet (empty bill) */
  showErrors?: boolean;
  state: PaymentState;
  onChange: (s: PaymentState) => void;
  result: AllocateResult;
  ctx: PaymentContext;
  bank1Name: string;
  bank2Name: string;
  title?: string;
  footer?: React.ReactNode;
}) {
  const set = (patch: Partial<PaymentState>) => onChange({ ...state, ...patch });
  const isBill = ctx.billAmount > 0;
  // "Fill remaining": the amount that clears this bill (and, with the default split, the previous balance before it).
  const remaining = state.manual ? result.credit : result.previousRemaining + result.credit;

  const modes = [
    { key: "cash" as const, label: "Cash", id: "pay-cash" },
    { key: "bank1" as const, label: bank1Name, id: "pay-bank1" },
    ...(ctx.bank2Enabled ? [{ key: "bank2" as const, label: bank2Name, id: "pay-bank2" }] : []),
  ];

  const startManual = () => set({ manual: Object.fromEntries(result.rows.map((r) => [r.key, r.amount ? fromPaise(r.amount) : ""])) });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="rounded-md bg-primary-soft px-4 py-3">
        <p className="text-xs font-medium uppercase tracking-wide text-primary">{title}</p>
        <p className="text-3xl font-semibold tabular-nums">₹{amt(isBill ? ctx.billAmount : result.previousRemaining + result.appliedToPrevious)}</p>
      </div>

      <div className="mt-3 min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
        {/* Advance from earlier */}
        {isBill && ctx.advanceAvailable > 0 && (
          <Row label="Advance" hint={`₹${amt(ctx.advanceAvailable)} available`}>
            <input
              id="pay-advance"
              aria-label="Advance used"
              inputMode="decimal"
              className={cn(inputCls, state.advanceUsed !== null && !validMoney(state.advanceUsed) ? "border-danger" : "border-border")}
              value={state.advanceUsed ?? fromPaise(result.advanceUsed)}
              onChange={(e) => set({ advanceUsed: e.target.value })}
              onFocus={(e) => e.currentTarget.select()}
            />
          </Row>
        )}

        {modes.map((m) => (
          <Row
            key={m.key}
            label={m.label}
            action={
              remaining > 0 ? (
                <button
                  type="button"
                  tabIndex={-1}
                  className="text-xs text-primary hover:underline"
                  onClick={() => set({ [m.key]: fromPaise((validMoney(state[m.key]) ? toPaise(state[m.key].replace(/,/g, "")) : 0) + remaining) })}
                >
                  Fill remaining
                </button>
              ) : null
            }
          >
            <input
              id={m.id}
              aria-label={m.label}
              inputMode="decimal"
              placeholder="0.00"
              className={cn(inputCls, validMoney(state[m.key]) ? "border-border" : "border-danger")}
              value={state[m.key]}
              onChange={(e) => set({ [m.key]: e.target.value })}
              onFocus={(e) => e.currentTarget.select()}
            />
          </Row>
        ))}

        {isBill && (
          <Row label="Credit" hint="Unpaid part of this bill">
            <div className={cn(inputCls, "flex items-center justify-end border-dashed border-border bg-slate-50", result.credit > 0 && "text-danger")}>{amt(result.credit)}</div>
          </Row>
        )}

        {/* Settlement against previous bills */}
        {ctx.dues.length > 0 && result.received > 0 && (
          <div className="rounded-md border border-border">
            <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted">Settlement against bills</span>
              {state.manual ? (
                <button type="button" tabIndex={-1} className="flex items-center gap-1 text-xs text-primary" onClick={() => set({ manual: null })}>
                  <RotateCcw className="size-3" /> Oldest first
                </button>
              ) : (
                <button type="button" tabIndex={-1} className="flex items-center gap-1 text-xs text-primary" onClick={startManual}>
                  <Pencil className="size-3" /> Edit
                </button>
              )}
            </div>
            <table className="w-full text-xs tabular-nums">
              <thead className="text-muted">
                <tr>
                  <th className="px-3 py-1 text-left font-medium">Bill</th>
                  <th className="px-1 py-1 text-right font-medium">Pending</th>
                  <th className="px-3 py-1 text-right font-medium">Allocate</th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map((r) => (
                  <tr key={r.key} className={cn("border-t border-border", r.kind === "CURRENT" && "bg-slate-50 font-medium")}>
                    <td className="px-3 py-1">
                      <div>{r.ref}</div>
                      {r.date && <div className="text-[11px] text-muted">{formatDate(r.date)}</div>}
                    </td>
                    <td className="px-1 py-1 text-right">{amt(r.pending)}</td>
                    <td className="px-3 py-1 text-right">
                      {state.manual ? (
                        <input
                          aria-label={`Allocate to ${r.ref}`}
                          inputMode="decimal"
                          className={cn(
                            "h-7 w-24 rounded border px-1.5 text-right focus:border-primary focus:outline-none",
                            validMoney(state.manual[r.key] ?? "") && !result.errors.some((e) => e.key === r.key) ? "border-border" : "border-danger",
                          )}
                          value={state.manual[r.key] ?? ""}
                          onChange={(e) => set({ manual: { ...state.manual, [r.key]: e.target.value } })}
                          onFocus={(e) => e.currentTarget.select()}
                        />
                      ) : (
                        amt(r.amount)
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!state.manual && (
              <p className="border-t border-border px-3 py-1 text-[11px] text-muted">
                Previous balance first, oldest bill first{isBill ? "; this bill gets the rest" : ""}. Click Edit to change.
              </p>
            )}
          </div>
        )}

        {/* Excess */}
        {result.excess > 0 && (
          <fieldset className="rounded-md border border-border px-3 py-2">
            <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-muted">Excess ₹{amt(result.excess)}</legend>
            <label className="flex items-center gap-2 py-0.5 text-sm">
              <input type="radio" name="excess" checked={result.excessChoice === "CHANGE"} onChange={() => set({ excess: "CHANGE" })} />
              Change to return
            </label>
            <label className={cn("flex items-center gap-2 py-0.5 text-sm", !result.advanceAllowed && "text-muted")} title={result.advanceBlockedReason ?? undefined}>
              <input type="radio" name="excess" disabled={!result.advanceAllowed} checked={result.excessChoice === "ADVANCE"} onChange={() => set({ excess: "ADVANCE" })} />
              Keep as advance
              {!result.advanceAllowed && <Info className="size-3.5" aria-label={result.advanceBlockedReason ?? ""} />}
            </label>
            {!result.advanceAllowed && <p className="text-[11px] text-muted">{result.advanceBlockedReason}</p>}
          </fieldset>
        )}

        {/* Summary */}
        <dl className="space-y-1 rounded-md bg-slate-50 px-3 py-2 text-sm tabular-nums">
          <Line label="Total Received" value={amt(result.received)} />
          {result.advanceUsed > 0 && <Line label="Advance Used" value={amt(result.advanceUsed)} />}
          {(ctx.dues.length > 0 || result.appliedToPrevious > 0) && <Line label="Applied to Previous Balance" value={amt(result.appliedToPrevious)} />}
          {isBill && <Line label="Applied to This Bill" value={amt(result.appliedToBill)} />}
          {isBill && <Line label="Credit" value={amt(result.credit)} tone={result.credit > 0 ? "danger" : undefined} />}
          {result.change > 0 && <Line label="Change to Return" value={amt(result.change)} tone="warning" strong />}
          {result.advanceCreated > 0 && <Line label="Advance" value={amt(result.advanceCreated)} tone="success" />}
          <div className="flex items-center justify-between border-t border-border pt-1">
            <dt className="font-medium">Balance After This {isBill ? "Bill" : "Receipt"}</dt>
            <dd>
              <BalanceText paise={result.balanceAfter} short />
            </dd>
          </div>
        </dl>

        {showErrors && result.errors.length > 0 && (
          <ul className="space-y-1 rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-xs text-danger" role="alert">
            {result.errors.map((e, i) => (
              <li key={i}>{e.message}</li>
            ))}
          </ul>
        )}
      </div>

      {footer && <div className="mt-3 space-y-2">{footer}</div>}
    </div>
  );
}

function Row({ label, hint, action, children }: { label: string; hint?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[1fr_9rem] items-center gap-2">
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">{label}</div>
        {(hint || action) && (
          <div className="flex items-center gap-2 text-xs text-muted">
            {hint && <span>{hint}</span>}
            {action}
          </div>
        )}
      </div>
      {children}
    </div>
  );
}

function Line({ label, value, tone, strong }: { label: string; value: string; tone?: "danger" | "success" | "warning"; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-muted">{label}</dt>
      <dd className={cn(strong && "font-semibold", tone === "danger" && "text-danger", tone === "success" && "text-success", tone === "warning" && "text-warning")}>{value}</dd>
    </div>
  );
}
