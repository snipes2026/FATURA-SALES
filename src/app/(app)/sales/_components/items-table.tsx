"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, ScanBarcode, Trash2 } from "lucide-react";
import { formatAmount } from "@/lib/india";
import { fromPaise, MONEY_RE, toPaise } from "@/lib/money";
import { cn } from "@/lib/utils";
import { qtyByProduct, type BillItem } from "../_lib/bill-types";

const cellInput =
  "h-8 w-full rounded border border-border bg-surface px-2 text-right text-sm tabular-nums focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20";

export function ItemsTable({
  items,
  allowPriceEdit,
  allowNegativeStock,
  belowCost,
  onQty,
  onRate,
  onRemove,
  onDone,
}: {
  items: BillItem[];
  allowPriceEdit: boolean;
  allowNegativeStock: boolean;
  belowCost: (item: BillItem) => boolean;
  /** Returns false when the qty was refused (e.g. over stock) so the cell can revert. */
  onQty: (key: string, qty: number) => boolean;
  onRate: (key: string, rate: string) => void;
  onRemove: (key: string) => void;
  /** Called after a cell is committed with Enter — the screen refocuses the barcode box. */
  onDone: () => void;
}) {
  const totals = qtyByProduct(items);

  if (items.length === 0)
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted">
        <ScanBarcode className="size-10 text-slate-300" />
        Scan a barcode to add items
      </div>
    );

  return (
    <table className="w-full border-separate border-spacing-0 text-sm">
      <thead className="sticky top-0 z-10 bg-slate-50 text-xs uppercase tracking-wide text-muted">
        <tr>
          <th className="w-10 border-b border-border px-2 py-2 text-left">#</th>
          <th className="w-32 border-b border-border px-2 py-2 text-left">Barcode</th>
          <th className="border-b border-border px-2 py-2 text-left">Product</th>
          <th className="w-24 border-b border-border px-2 py-2 text-right">Qty</th>
          <th className="w-32 border-b border-border px-2 py-2 text-right">Price (WSP)</th>
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
            totalQty={totals.get(it.productId) ?? it.qty}
            allowPriceEdit={allowPriceEdit}
            allowNegativeStock={allowNegativeStock}
            belowCost={belowCost(it)}
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
  totalQty,
  allowPriceEdit,
  allowNegativeStock,
  belowCost,
  onQty,
  onRate,
  onRemove,
  onDone,
}: {
  n: number;
  item: BillItem;
  totalQty: number;
  allowPriceEdit: boolean;
  allowNegativeStock: boolean;
  belowCost: boolean;
  onQty: (key: string, qty: number) => boolean;
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
    if (q !== item.qty && !onQty(item.key, q)) setQtyText(String(item.qty));
  };
  const commitRate = () => {
    const v = rateText.trim().replace(/,/g, "");
    if (v === item.rate) return;
    if (!MONEY_RE.test(v)) return setRateText(item.rate);
    onRate(item.key, fromPaise(toPaise(v)));
  };
  // Enter: leave the cell (blur commits) and go back to the barcode box. Esc: discard the edit.
  const skipCommit = useRef(false);
  const blurCommit = (commit: () => void) => () => {
    if (skipCommit.current) {
      skipCommit.current = false;
      return;
    }
    commit();
  };
  const enter = () => (e: React.KeyboardEvent<HTMLInputElement>) => {
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

  const overStock = totalQty > item.stock;
  const noPrice = item.rate === "" || toPaise(item.rate) === 0;
  const amount = toPaise(item.rate) * item.qty;

  return (
    <tr className={cn("align-top hover:bg-slate-50", (noPrice || (overStock && !allowNegativeStock)) && "bg-danger-soft/60")}>
      <td className="border-b border-border px-2 py-1.5 text-muted">{n}</td>
      <td className="border-b border-border px-2 py-1.5 font-mono text-xs leading-8">{item.barcode}</td>
      <td className="border-b border-border px-2 py-1.5">
        <div className="font-medium leading-tight">{item.itemName}</div>
        <div className={cn("text-xs", overStock ? (allowNegativeStock ? "text-warning" : "text-danger") : "text-muted")}>
          Stock {item.stock} · HSN {item.hsn} · MRP ₹{formatAmount(item.mrp)}
          {overStock && ` · ${allowNegativeStock ? "billing more than stock" : "more than stock"}`}
        </div>
        {noPrice && <div className="text-xs text-danger">No WSP for this item{allowPriceEdit ? " — enter a price" : " — set the WSP (or allow price edit) to bill it"}</div>}
        {belowCost && !noPrice && (
          <div className="flex items-center gap-1 text-xs text-warning">
            <AlertTriangle className="size-3" /> Below purchase rate (₹{formatAmount(item.purchaseRate)}){item.belowCostConfirmed ? " — confirmed" : ""}
          </div>
        )}
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
          onKeyDown={enter()}
        />
      </td>
      <td className="border-b border-border px-2 py-1.5">
        {allowPriceEdit ? (
          <input
            aria-label={`Price for ${item.itemName}`}
            inputMode="decimal"
            className={cn(cellInput, belowCost && "border-warning")}
            value={rateText}
            placeholder="0.00"
            onChange={(e) => setRateText(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
            onBlur={blurCommit(commitRate)}
            onKeyDown={enter()}
          />
        ) : (
          <div className="h-8 px-2 text-right leading-8 tabular-nums" title="Price edit is off (Settings → Sales & Payments)">
            {noPrice ? "—" : formatAmount(item.rate)}
          </div>
        )}
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
