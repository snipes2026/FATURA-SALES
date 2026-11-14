"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Barcode, ImageIcon, Pencil, Printer, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import type { GrnCalc } from "@/lib/grn-calc";
import { formatAmount } from "@/lib/india";
import { fromPaise } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { GrnLineForm } from "@/lib/validation/grn";
import type { CatSlot, DeptOption } from "../_lib/load";
import { imageUrl } from "./image-box";

/** CARD 3 — lines populated into the GRN. HSN is shown for reference; GST is entered once on the Summary. */
export function ItemsGrid({
  lines,
  departments,
  categories,
  calc: grnCalc,
  editingUid,
  readOnly,
  onEdit,
  onRemove,
  onGenerate,
  onPrintLabels,
  generating,
  canGenerate,
}: {
  lines: GrnLineForm[];
  departments: DeptOption[];
  categories: CatSlot[];
  calc: GrnCalc; // whole-GRN calculation, lines in the same order
  editingUid?: string;
  readOnly: boolean;
  onEdit: (uid: string) => void;
  onRemove: (uid: string) => void;
  onGenerate: () => void;
  onPrintLabels: () => void;
  generating: boolean;
  canGenerate: boolean;
}) {
  const withBarcode = lines.filter((l) => l.barcode).length;
  const withoutBarcode = lines.length - withBarcode;
  const [q, setQ] = useState("");
  const visibleCats = categories.filter((c) => c.mode !== "HIDDEN");
  const deptMap = useMemo(() => new Map(departments.map((d) => [String(d.id), d])), [departments]);
  const catName = (slot: number, id: string) => categories[slot - 1]?.values.find((v) => String(v.id) === id)?.value ?? "";

  const rows = useMemo(
    () =>
      lines.map((l, i) => {
        const dept = deptMap.get(l.departmentId);
        const calc = grnCalc.lines[i] ?? null;
        return { l, n: i + 1, dept, calc };
      }),
    [lines, deptMap, grnCalc],
  );
  const totals = { qty: grnCalc.qty, amount: grnCalc.gross };

  const term = q.trim().toLowerCase();
  const shown = term
    ? rows.filter(({ l, dept }) =>
        [l.itemName, dept?.name, dept?.hsnCode, l.barcode, ...visibleCats.map((c) => catName(c.slot, l[`cat${c.slot}` as "cat1"]))]
          .join(" ")
          .toLowerCase()
          .includes(term),
      )
    : rows;

  const th = "whitespace-nowrap border-b border-border px-2.5 py-2 font-medium";
  const td = "whitespace-nowrap px-2.5 py-1.5";

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            GRN Items <Chip>{lines.length}</Chip>
          </span>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <label className="relative">
              <span className="sr-only">Search items</span>
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search items"
                className="h-8 w-44 rounded-md border border-border pl-8 pr-2 text-sm focus:border-primary focus:outline-none"
              />
            </label>
            {!readOnly && (
              <Button
                size="sm"
                variant="secondary"
                disabled={!canGenerate || generating || withoutBarcode === 0}
                onClick={onGenerate}
                title={!canGenerate ? "You don't have permission to generate barcodes" : withoutBarcode === 0 ? "All lines have barcodes" : "Alt+B — saves the draft and numbers the lines without a barcode"}
              >
                <Barcode /> {generating ? "Generating…" : `Generate Barcode${withoutBarcode ? ` (${withoutBarcode})` : ""}`}
              </Button>
            )}
            <Button size="sm" variant="secondary" disabled={withBarcode === 0} onClick={onPrintLabels} title={withBarcode === 0 ? "Generate barcodes first" : "Preview and print labels"}>
              <Printer /> Print Labels
            </Button>
          </div>
        }
      />
      <div className="max-h-[60vh] overflow-auto">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-slate-50 text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className={cn(th, "text-right")}>#</th>
              <th className={th}>Image</th>
              <th className={cn(th, "text-left")}>Department</th>
              <th className={cn(th, "text-left")}>HSN</th>
              <th className={cn(th, "text-left")}>Item Name</th>
              {visibleCats.map((c) => (
                <th key={c.slot} className={cn(th, "text-left")}>
                  {c.label}
                </th>
              ))}
              <th className={cn(th, "text-right")}>Qty</th>
              <th className={cn(th, "text-right")}>Pur. Rate</th>
              <th className={cn(th, "text-right")}>Amount</th>
              <th className={cn(th, "text-right")}>WSP</th>
              <th className={cn(th, "text-right")}>RSP</th>
              <th className={cn(th, "text-right")}>MRP</th>
              <th className={cn(th, "text-left")}>Barcode</th>
              {!readOnly && <th className={th} aria-label="Actions" />}
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 && (
              <tr>
                <td colSpan={12 + visibleCats.length} className="px-3 py-10 text-center text-muted">
                  No items yet. Add items above, then press <strong>Populate to GRN</strong> (Alt+P).
                </td>
              </tr>
            )}
            {lines.length > 0 && shown.length === 0 && (
              <tr>
                <td colSpan={12 + visibleCats.length} className="px-3 py-6 text-center text-muted">
                  No matches.
                </td>
              </tr>
            )}
            {shown.map(({ l, n, dept, calc }) => {
              const img = imageUrl(l.imagePath);
              return (
                <tr key={l.uid} className={cn("border-b border-border hover:bg-slate-50", editingUid === l.uid && "bg-primary-soft")}>
                  <td className={cn(td, "num text-muted")}>{n}</td>
                  <td className="px-2.5 py-1">
                    {img ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={img} alt="" className="size-9 rounded border border-border object-cover" />
                    ) : (
                      <span className="flex size-9 items-center justify-center rounded border border-dashed border-border text-slate-300">
                        <ImageIcon className="size-4" />
                      </span>
                    )}
                  </td>
                  <td className={td}>{dept?.name ?? "?"}</td>
                  <td className={cn(td, "font-mono text-xs")}>{dept?.hsnCode}</td>
                  <td className={cn(td, "max-w-[240px] truncate font-medium")} title={l.itemName}>
                    {l.itemName}
                    {l.priceWarningOverridden && <AlertTriangle className="ml-1 inline size-3.5 text-warning" aria-label="Price order overridden" />}
                  </td>
                  {visibleCats.map((c) => (
                    <td key={c.slot} className={td}>
                      {catName(c.slot, l[`cat${c.slot}` as "cat1"]) || <span className="text-muted">—</span>}
                    </td>
                  ))}
                  <td className={cn(td, "num")}>{l.qty}</td>
                  <td className={cn(td, "num")}>{formatAmount(l.purchaseRate)}</td>
                  <td className={cn(td, "num")} title={calc && calc.discount ? `Discount ₹${formatAmount(fromPaise(calc.discount))} · Taxable ₹${formatAmount(fromPaise(calc.taxable))}` : undefined}>{calc ? formatAmount(fromPaise(calc.amount)) : "—"}</td>
                  <td className={cn(td, "num")}>{l.wsp ? formatAmount(l.wsp) : "—"}</td>
                  <td className={cn(td, "num")}>{l.rsp ? formatAmount(l.rsp) : "—"}</td>
                  <td className={cn(td, "num")}>{formatAmount(l.mrp)}</td>
                  <td className={cn(td, "font-mono text-xs")}>{l.barcode ?? <span className="text-muted">—</span>}</td>
                  {!readOnly && (
                    <td className="whitespace-nowrap px-1 py-1 text-right">
                      <Button type="button" variant="ghost" size="sm" aria-label={`Edit line ${n}`} onClick={() => onEdit(l.uid)}>
                        <Pencil />
                      </Button>
                      <Button type="button" variant="ghost" size="sm" aria-label={`Remove line ${n}`} onClick={() => onRemove(l.uid)}>
                        <Trash2 className="text-danger" />
                      </Button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
          {lines.length > 0 && (
            <tfoot className="sticky bottom-0 bg-slate-50 font-semibold">
              <tr>
                <td colSpan={5 + visibleCats.length} className="px-2.5 py-2 text-right text-xs uppercase tracking-wide text-muted">
                  Total
                </td>
                <td className="num px-2.5 py-2">{totals.qty.toLocaleString("en-IN")}</td>
                <td />
                <td className="num px-2.5 py-2">{formatAmount(fromPaise(totals.amount))}</td>
                <td colSpan={readOnly ? 4 : 5} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </Card>
  );
}
