"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, ScanBarcode, Trash2 } from "lucide-react";
import { formatAmount } from "@/lib/india";
import { fromPaise, MONEY_RE, toPaise } from "@/lib/money";
import type { QtyIssue } from "@/lib/sales/return-calc";
import { cn } from "@/lib/utils";
import { qtyBasis, type ReturnItem } from "../_lib/return-types";

const cellInput =
  "h-8 w-full rounded border border-border bg-surface px-2 text-right text-sm tabular-nums focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20";

/** Items being returned: #, Barcode, Product (with sold / returned hint), Qty, Rate, Amount, delete. */
export function ReturnItemsTable({
  items,
  issues,
  issueTone,
  linkedBillNo,
  onQty,
  onRate,
  onRemove,
  onDone,
}: {
  items: ReturnItem[];
  /** Qty-check issues by qtyBasis key. */
  issues: Map<string, QtyIssue>;
  issueTone: "warning" | "danger";
  linkedBillNo: string | null;
  onQty: (key: string, qty: number) => void;
  onRate: (key: string, rate: string) => void;
  onRemove: (key: string) => void;
  onDone: () => void;
}) {
  if (items.length === 0)
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted">
        <ScanBarcode className="size-10 text-slate-300" />
        Scan the barcode of each item being returned
      </div>
    );

  return (
    <table className="w-full border-separate border-spacing-0 text-sm">
      <thead className="sticky top-0 z-10 bg-slate-50 text-xs uppercase tracking-wide text-muted">
        <tr>
          <th className="w-10 border-b border-border px-2 py-2 text-left">#</th>
          <th className="w-32 border-b border-border px-2 py-2 text-left">Barcode</th>
          <th className="border-b border-border px-2 py-2 text-left">Product Name</th>
          <th className="w-24 border-b border-border px-2 py-2 text-right">Qty</th>
          <th className="w-32 border-b border-border px-2 py-2 text-right">Rate</th>
          <th className="w-32 border-b border-border px-2 py-2 text-right">Amount</th>
          <th className="w-10 border-b border-border px-2 py-2" />
        </tr>
      </thead>
      <tbody>
        {items.map((it, i) => (
          <Row
            key={it.key}
            n={i + 1}
            item={it}
            issue={issues.get(qtyBasis(it).key) ?? null}
            issueTone={issueTone}
            linkedBillNo={linkedBillNo}
            onQty={onQty}
            onRate={onRate}
            onRemove={onRemove}
            onDone={onDone}
          />
        ))}
      </tbody>
    </table>
  );
}

function Row({
  n,
  item,
  issue,
  issueTone,
  linkedBillNo,
  onQty,
  onRate,
  onRemove,
  onDone,
}: {
  n: number;
  item: ReturnItem;
  issue: QtyIssue | null;
  issueTone: "warning" | "danger";
  linkedBillNo: string | null;
  onQty: (key: string, qty: number) => void;
  onRate: (key: string, rate: string) => void;
  onRemove: (key: string) => void;
  onDone: () => void;
}) {
  const [qtyText, setQtyText] = useState(String(item.qty));
  const [rateText, setRateText] = useState(item.rate);
  useEffect(() => setQtyText(String(item.qty)), [item.qty, item.rev]);
  useEffect(() => setRateText(item.rate), [item.rate, item.rev]);

  const commitQty = () => {
    const q = Number(qtyText);
    if (!/^\d+$/.test(qtyText) || q < 1) return setQtyText(String(item.qty));
    if (q !== item.qty) onQty(item.key, q);
  };
  const commitRate = () => {
    const v = rateText.trim().replace(/,/g, "");
    if (v === item.rate) return;
    if (!MONEY_RE.test(v)) return setRateText(item.rate);
    onRate(item.key, fromPaise(toPaise(v)));
  };
  const skipCommit = useRef(false);
  const blurCommit = (commit: () => void) => () => {
    if (skipCommit.current) {
      skipCommit.current = false;
      return;
    }
    commit();
  };
  const keys = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      onDone();
    } else if (e.key === "Escape") {
      e.preventDefault();
      skipCommit.current = true;
      setQtyText(String(item.qty));
      setRateText(item.rate);
      onDone();
    }
  };

  const noRate = item.rate === "" || toPaise(item.rate) === 0;
  const amount = toPaise(item.rate) * item.qty;
  const hint = item.origin
    ? `On ${linkedBillNo ?? "the bill"}: ${item.origin.qty} @ ₹${formatAmount(item.origin.rate)} · Already returned: ${item.origin.returned} · GST ${item.origin.gstRate}%`
    : `Sold to this customer: ${item.sold} · Already returned: ${item.returned}${item.lastRate ? ` · Last rate ₹${formatAmount(item.lastRate)}` : ""}`;

  return (
    <tr className={cn("align-top hover:bg-slate-50", noRate && "bg-danger-soft/60", issue && (issueTone === "danger" ? "bg-danger-soft/60" : "bg-warning-soft/60"))}>
      <td className="border-b border-border px-2 py-1.5 text-muted">{n}</td>
      <td className="border-b border-border px-2 py-1.5 font-mono text-xs leading-8">{item.barcode}</td>
      <td className="border-b border-border px-2 py-1.5">
        <div className="font-medium leading-tight">{item.itemName}</div>
        <div className="text-xs text-muted">{hint}</div>
        {issue && (
          <div className={cn("flex items-center gap-1 text-xs", issueTone === "danger" ? "text-danger" : "text-warning")}>
            <AlertTriangle className="size-3" /> {issue.message}
          </div>
        )}
        {noRate && <div className="text-xs text-danger">Enter the rate</div>}
      </td>
      <td className="border-b border-border px-2 py-1.5">
        <input
          aria-label={`Qty for ${item.itemName}`}
          inputMode="numeric"
          className={cellInput}
          value={qtyText}
          onChange={(e) => setQtyText(e.target.value.replace(/\D/g, ""))}
          onFocus={(e) => e.currentTarget.select()}
          onBlur={blurCommit(commitQty)}
          onKeyDown={keys}
        />
      </td>
      <td className="border-b border-border px-2 py-1.5">
        <input
          aria-label={`Rate for ${item.itemName}`}
          inputMode="decimal"
          placeholder="0.00"
          className={cn(cellInput, noRate && "border-danger")}
          value={rateText}
          onChange={(e) => setRateText(e.target.value)}
          onFocus={(e) => e.currentTarget.select()}
          onBlur={blurCommit(commitRate)}
          onKeyDown={keys}
        />
      </td>
      <td className="border-b border-border px-2 py-1.5 text-right font-medium leading-8 tabular-nums">{formatAmount(fromPaise(amount))}</td>
      <td className="border-b border-border px-1 py-1.5 text-right">
        <button
          type="button"
          tabIndex={-1}
          aria-label={`Remove ${item.itemName}`}
          className="rounded p-1.5 text-slate-400 hover:bg-danger-soft hover:text-danger"
          onClick={() => {
            onRemove(item.key);
            onDone();
          }}
        >
          <Trash2 className="size-4" />
        </button>
      </td>
    </tr>
  );
}
