"use client";

import { Info, Pencil, RotateCcw } from "lucide-react";
import { BalanceText } from "@/components/customers/balance-text";
import { formatDate } from "@/lib/dates";
import { formatAmount } from "@/lib/india";
import { fromPaise, MONEY_RE, toPaise } from "@/lib/money";
import type { Due } from "@/lib/sales/allocate";
import { allocateReturn, type RefundMode, type RemainderChoice, type ReturnAllocateResult } from "@/lib/sales/return-calc";
import { cn } from "@/lib/utils";

const amt = (p: number) => formatAmount(fromPaise(p));

/** What the user chose in the adjustment panel (amounts as typed). */
export type AdjustState = {
  /** null = default: linked bill first, then oldest first */
  manual: Record<string, string> | null;
  remainder: RemainderChoice | null;
  refundMode: RefundMode | null;
};
export const EMPTY_ADJUST: AdjustState = { manual: null, remainder: null, refundMode: null };

export const validMoney = (v: string) => v.trim() === "" || MONEY_RE.test(v.trim().replace(/,/g, ""));
const p = (v: string) => (validMoney(v) ? toPaise(v.trim().replace(/,/g, "") || "0") : 0);

export function adjustInvalid(s: AdjustState) {
  return Object.values(s.manual ?? {}).some((v) => !validMoney(v));
}

export function computeAdjust(
  s: AdjustState,
  ctx: { returnValue: number; dues: Due[]; advanceAvailable: number; linkedSalesId: number | null; isWalkin: boolean },
): ReturnAllocateResult {
  return allocateReturn({
    returnValue: ctx.returnValue,
    dues: ctx.dues,
    advanceAvailable: ctx.advanceAvailable,
    linkedSalesId: ctx.linkedSalesId,
    manual: s.manual ? Object.fromEntries(Object.entries(s.manual).map(([k, v]) => [k, p(v)])) : null,
    remainder: s.remainder,
    refundMode: s.refundMode,
    isWalkin: ctx.isWalkin,
  });
}

/**
 * Right pane of the Sales Return screen: Net Return Value, balance before, the
 * pending-bill table (pre-filled, editable), Advance / Refund for the rest, and
 * balance after.
 */
export function AdjustmentPanel({
  state,
  onChange,
  result,
  returnValue,
  balanceBefore,
  isWalkin,
  bank1Name,
  bank2Name,
  bank2Enabled,
  showErrors,
  notice,
  footer,
}: {
  state: AdjustState;
  onChange: (s: AdjustState) => void;
  result: ReturnAllocateResult;
  returnValue: number;
  balanceBefore: number | null;
  isWalkin: boolean;
  bank1Name: string;
  bank2Name: string;
  bank2Enabled: boolean;
  showErrors: boolean;
  notice?: React.ReactNode;
  footer: React.ReactNode;
}) {
  const set = (patch: Partial<AdjustState>) => onChange({ ...state, ...patch });
  const startManual = () => set({ manual: Object.fromEntries(result.rows.map((r) => [r.key, r.amount ? fromPaise(r.amount) : ""])) });
  const modes: { key: RefundMode; label: string }[] = [
    { key: "CASH", label: "Cash" },
    { key: "BANK1", label: bank1Name },
    ...(bank2Enabled ? [{ key: "BANK2" as const, label: bank2Name }] : []),
  ];
  const remainderChoice = result.remainder ?? (isWalkin ? "REFUND" : (state.remainder ?? "ADVANCE"));
  const refundMode = state.refundMode ?? "CASH";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="rounded-md bg-primary-soft px-4 py-3">
        <p className="text-xs font-medium uppercase tracking-wide text-primary">Net Return Value</p>
        <p className="text-3xl font-semibold tabular-nums">₹{amt(Math.max(0, returnValue))}</p>
      </div>

      <div className="mt-3 min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
        <div className="flex items-center justify-between rounded-md bg-slate-50 px-3 py-2 text-sm">
          <span className="text-muted">Customer balance before</span>
          {balanceBefore === null ? <span className="text-muted">—</span> : <BalanceText paise={balanceBefore} short />}
        </div>

        {notice}

        {/* Adjust against pending bills */}
        <div className="rounded-md border border-border">
          <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted">Adjust against pending bills</span>
            {result.rows.length > 0 &&
              (state.manual ? (
                <button type="button" tabIndex={-1} className="flex items-center gap-1 text-xs text-primary" onClick={() => set({ manual: null })}>
                  <RotateCcw className="size-3" /> Auto
                </button>
              ) : (
                <button type="button" tabIndex={-1} className="flex items-center gap-1 text-xs text-primary" onClick={startManual}>
                  <Pencil className="size-3" /> Edit
                </button>
              ))}
          </div>
          {result.rows.length === 0 ? (
            <p className="px-3 py-2 text-xs text-muted">No pending bills — nothing to adjust.</p>
          ) : (
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
                  <tr key={r.key} className={cn("border-t border-border", r.linked && "bg-primary-soft/50")}>
                    <td className="px-3 py-1">
                      <div className={cn(r.linked && "font-medium")}>
                        {r.ref}
                        {r.linked && <span className="ml-1 text-[10px] uppercase text-primary">this bill</span>}
                      </div>
                      <div className="text-[11px] text-muted">{formatDate(r.date)}</div>
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
          )}
          {result.rows.length > 0 && !state.manual && (
            <p className="border-t border-border px-3 py-1 text-[11px] text-muted">
              {result.rows.some((r) => r.linked) ? "This bill first, then oldest first." : "Oldest first."} Click Edit to change.
            </p>
          )}
        </div>

        {/* Remaining amount */}
        {result.remaining > 0 && (
          <fieldset className="rounded-md border border-border px-3 py-2">
            <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-muted">Remaining ₹{amt(result.remaining)}</legend>
            <label className={cn("flex items-center gap-2 py-0.5 text-sm", !result.advanceAllowed && "text-muted")} title={result.advanceBlockedReason ?? undefined}>
              <input type="radio" name="remainder" disabled={!result.advanceAllowed} checked={remainderChoice === "ADVANCE"} onChange={() => set({ remainder: "ADVANCE" })} />
              Advance — kept as credit on the account
              {!result.advanceAllowed && <Info className="size-3.5" aria-label={result.advanceBlockedReason ?? ""} />}
            </label>
            <label className="flex items-center gap-2 py-0.5 text-sm">
              <input type="radio" name="remainder" checked={remainderChoice === "REFUND"} onChange={() => set({ remainder: "REFUND" })} />
              Refund now
            </label>
            {remainderChoice === "REFUND" && (
              <div className="ml-6 mt-1 flex flex-wrap gap-1" role="radiogroup" aria-label="Refund by">
                {modes.map((m) => (
                  <button
                    key={m.key}
                    type="button"
                    role="radio"
                    aria-checked={refundMode === m.key}
                    onClick={() => set({ refundMode: m.key })}
                    className={cn("rounded border px-2.5 py-1 text-xs font-medium", refundMode === m.key ? "border-primary bg-primary text-white" : "border-border text-muted hover:text-ink")}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            )}
            {!result.advanceAllowed && <p className="mt-1 text-[11px] text-muted">{result.advanceBlockedReason}</p>}
          </fieldset>
        )}

        {/* Summary */}
        <dl className="space-y-1 rounded-md bg-slate-50 px-3 py-2 text-sm tabular-nums">
          <Line label="Applied to pending bills" value={amt(result.applied)} />
          {result.advanceCreated > 0 && <Line label="Kept as advance" value={amt(result.advanceCreated)} tone="success" />}
          {result.refund > 0 && <Line label={`Refund (${modes.find((m) => m.key === result.refundMode)?.label ?? "Cash"})`} value={amt(result.refund)} tone="warning" strong />}
          <div className="flex items-center justify-between border-t border-border pt-1">
            <dt className="font-medium">Customer balance after</dt>
            <dd>{balanceBefore === null ? "—" : <BalanceText paise={result.balanceAfter} short />}</dd>
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

      <div className="mt-3 space-y-2">{footer}</div>
    </div>
  );
}

function Line({ label, value, tone, strong }: { label: string; value: string; tone?: "success" | "warning"; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-muted">{label}</dt>
      <dd className={cn(strong && "font-semibold", tone === "success" && "text-success", tone === "warning" && "text-warning")}>{value}</dd>
    </div>
  );
}
