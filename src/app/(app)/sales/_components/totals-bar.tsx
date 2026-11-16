"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, RotateCcw } from "lucide-react";
import { formatAmount } from "@/lib/india";
import { fromPaise, toPaise } from "@/lib/money";
import type { SaleCalc, SaleGstMode } from "@/lib/sales/gst";
import { cn } from "@/lib/utils";

const amt = (p: number) => formatAmount(fromPaise(p));
const SIGNED_RE = /^-?\d{0,8}(\.\d{0,2})?$/;

/** Bottom bar: GST mode toggle, Gross, GST (editable in Add GST), Round Off (editable), Net Payable, HSN breakup. */
export function TotalsBar({
  calc,
  gstMode,
  onGstMode,
  gstOverride,
  onGstOverride,
  roundOff,
  onRoundOff,
  interState,
  itemCount,
  totalQty,
  netLabel = "Net Payable",
  gstModeLocked,
}: {
  calc: SaleCalc;
  gstMode: SaleGstMode;
  onGstMode: (m: SaleGstMode) => void;
  gstOverride: number | null;
  onGstOverride: (p: number | null) => void;
  roundOff: number | null;
  onRoundOff: (p: number | null) => void;
  interState: boolean;
  itemCount: number;
  totalQty: number;
  netLabel?: string;
  /** Sales Return against a bill: GST mode (and any override) come from the bill. */
  gstModeLocked?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-[var(--radius-card)] border border-border bg-surface">
      {open && (
        <div className="max-h-48 overflow-auto border-b border-border px-4 py-2">
          {calc.gstOverridden ? (
            <p className="text-xs text-muted">GST was entered by hand (₹{amt(calc.gst)}), so the rate-wise breakup isn&apos;t shown or printed.</p>
          ) : (
            <table className="w-full text-xs tabular-nums">
              <thead className="text-muted">
                <tr>
                  <th className="py-1 text-left font-medium">HSN</th>
                  <th className="py-1 text-right font-medium">Rate</th>
                  <th className="py-1 text-right font-medium">Taxable</th>
                  {interState ? (
                    <th className="py-1 text-right font-medium">IGST</th>
                  ) : (
                    <>
                      <th className="py-1 text-right font-medium">CGST</th>
                      <th className="py-1 text-right font-medium">SGST</th>
                    </>
                  )}
                  <th className="py-1 text-right font-medium">Total GST</th>
                </tr>
              </thead>
              <tbody>
                {calc.breakup.map((b) => (
                  <tr key={`${b.hsn}-${b.rate}`} className="border-t border-border">
                    <td className="py-1">{b.hsn}</td>
                    <td className="py-1 text-right">{b.rate}%</td>
                    <td className="py-1 text-right">{amt(b.taxable)}</td>
                    {interState ? (
                      <td className="py-1 text-right">{amt(b.igst)}</td>
                    ) : (
                      <>
                        <td className="py-1 text-right">{amt(b.cgst)}</td>
                        <td className="py-1 text-right">{amt(b.sgst)}</td>
                      </>
                    )}
                    <td className="py-1 text-right">{amt(b.gst)}</td>
                  </tr>
                ))}
                {calc.breakup.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-1 text-muted">
                      No items
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-3 py-2 text-sm">
        <div className="inline-flex rounded-md border border-border p-0.5" role="radiogroup" aria-label="GST mode">
          {(["ADD", "INCLUDES"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={gstMode === m}
              tabIndex={-1}
              disabled={!!gstModeLocked}
              title={gstModeLocked}
              onClick={() => onGstMode(m)}
              className={cn(
                "rounded px-3 py-1 text-xs font-medium",
                gstMode === m ? "bg-primary text-white" : "text-muted hover:text-ink",
                gstModeLocked && gstMode !== m && "cursor-not-allowed opacity-50",
              )}
            >
              {m === "ADD" ? "Add GST" : "Includes GST"}
            </button>
          ))}
        </div>

        <button type="button" tabIndex={-1} onClick={() => setOpen((o) => !o)} className="flex items-center gap-1 text-xs text-primary hover:underline">
          {open ? <ChevronDown className="size-3.5" /> : <ChevronUp className="size-3.5" />} GST breakup
        </button>

        <span className="text-xs text-muted">
          {itemCount} {itemCount === 1 ? "item" : "items"} · Qty {totalQty}
        </span>

        <div className="ml-auto flex flex-wrap items-center gap-x-5 gap-y-2">
          <Figure label="Gross Amount" value={amt(calc.gross)} />
          {gstMode === "INCLUDES" && <Figure label="Taxable" value={amt(calc.taxable)} />}
          <MoneyCell
            label={gstMode === "INCLUDES" ? "GST (included)" : "GST"}
            paise={calc.gst}
            editable={gstMode === "ADD" && !gstModeLocked}
            manual={gstMode === "ADD" && gstOverride !== null}
            allowNegative={false}
            onChange={onGstOverride}
            title={gstMode === "INCLUDES" ? "Worked out from the prices (they include GST)" : "Auto from each item's rate — type to override (e.g. 0)"}
          />
          <MoneyCell label="Round Off" paise={calc.roundOff} editable manual={roundOff !== null} allowNegative onChange={onRoundOff} title="Auto to the nearest rupee — type to change" />
          <div className="text-right">
            <div className="text-xs text-muted">{netLabel}</div>
            <div className="text-2xl font-semibold tabular-nums">₹{amt(calc.net)}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-right">
      <div className="text-xs text-muted">{label}</div>
      <div className="font-medium tabular-nums">{value}</div>
    </div>
  );
}

/** Amount that shows the auto value, can be typed over, and has a reset-to-auto button. */
function MoneyCell({
  label,
  paise,
  editable,
  manual,
  allowNegative,
  onChange,
  title,
}: {
  label: string;
  paise: number;
  editable: boolean;
  manual: boolean;
  allowNegative: boolean;
  onChange: (p: number | null) => void;
  title: string;
}) {
  const [text, setText] = useState(fromPaise(paise));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(fromPaise(paise));
  }, [paise, focused]);

  if (!editable) return <Figure label={label} value={amt(paise)} />;

  const commit = () => {
    setFocused(false);
    const v = text.trim().replace(/,/g, "");
    if (v === "" || v === "-") return onChange(null);
    if (!SIGNED_RE.test(v) || (!allowNegative && v.startsWith("-"))) return setText(fromPaise(paise));
    const p = toPaise(v);
    if (p !== paise || manual) onChange(p);
  };

  return (
    <div className="text-right" title={title}>
      <div className="flex items-center justify-end gap-1 text-xs text-muted">
        {label}
        {manual && (
          <button type="button" tabIndex={-1} aria-label={`Reset ${label} to auto`} className="text-primary" onClick={() => onChange(null)}>
            <RotateCcw className="size-3" />
          </button>
        )}
      </div>
      <input
        aria-label={label}
        inputMode="decimal"
        value={text}
        onFocus={(e) => {
          setFocused(true);
          e.currentTarget.select();
        }}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        className={cn(
          "h-7 w-24 rounded border px-1.5 text-right text-sm font-medium tabular-nums focus:border-primary focus:outline-none",
          manual ? "border-warning bg-warning-soft" : "border-border bg-surface",
        )}
      />
    </div>
  );
}
