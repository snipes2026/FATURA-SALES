"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { formatAmount } from "@/lib/india";
import { cn } from "@/lib/utils";
import type { GrnLineForm } from "@/lib/validation/grn";
import type { CatSlot, DeptOption } from "../_lib/load";

export const MAX_LABELS = 5000;
type Layout = "a4" | "thermal";
const LAYOUT_KEY = "fd.labelLayout";

/**
 * Print Labels preview: one row per barcoded line, label count defaults to
 * the line quantity (editable). Opens the print view in a new tab.
 */
export function LabelsModal({
  open,
  onClose,
  grnId,
  lines,
  departments,
  categories,
  unsaved,
}: {
  open: boolean;
  onClose: () => void;
  grnId: number;
  lines: GrnLineForm[];
  departments: DeptOption[];
  categories: CatSlot[];
  unsaved: boolean;
}) {
  const [counts, setCounts] = useState<Record<number, string>>({});
  const [layout, setLayout] = useState<Layout>("thermal");

  useEffect(() => {
    if (!open) return;
    setCounts(Object.fromEntries(lines.map((l) => [l.id!, l.qty])));
    try {
      const saved = localStorage.getItem(LAYOUT_KEY);
      if (saved === "a4" || saved === "thermal") setLayout(saved);
    } catch {}
    // reset only when the modal opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const total = useMemo(() => Object.values(counts).reduce((a, c) => a + (Number(c) || 0), 0), [counts]);
  const visibleCats = categories.filter((c) => c.mode !== "HIDDEN");
  const catText = (l: GrnLineForm) =>
    visibleCats
      .map((c) => c.values.find((v) => String(v.id) === l[`cat${c.slot}` as "cat1"])?.value)
      .filter(Boolean)
      .join(" · ");

  const print = () => {
    const c = lines
      .map((l) => [l.id, Number(counts[l.id!]) || 0] as const)
      .filter(([, n]) => n > 0)
      .map(([id, n]) => `${id}:${n}`)
      .join(",");
    if (!c) return;
    try {
      localStorage.setItem(LAYOUT_KEY, layout);
    } catch {}
    window.open(`/print/grn/${grnId}/labels?layout=${layout}&c=${c}&auto=1`, "_blank", "noopener");
  };

  return (
    <Modal
      open={open}
      title="Print Labels"
      onClose={onClose}
      width={760}
      footer={
        <>
          <span className="mr-auto self-center text-sm text-muted">
            Total labels: <strong className={cn("tabular-nums", total > MAX_LABELS && "text-danger")}>{total.toLocaleString("en-IN")}</strong>
            {total > MAX_LABELS && ` (max ${MAX_LABELS.toLocaleString("en-IN")} per print)`}
          </span>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Button onClick={print} disabled={total === 0 || total > MAX_LABELS} data-autofocus>
            <Printer /> Print preview
          </Button>
        </>
      }
    >
      {unsaved && (
        <p className="mb-3 flex items-start gap-2 rounded-md bg-warning-soft px-3 py-2 text-sm text-warning">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" /> This GRN has unsaved changes. Labels print from the last saved version.
        </p>
      )}
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-slate-600">Layout</span>
        <div className="inline-flex overflow-hidden rounded-md border border-border" role="group" aria-label="Label layout">
          {(
            [
              ["thermal", "Thermal roll"],
              ["a4", "A4 sheet"],
            ] as const
          ).map(([v, label]) => (
            <button
              key={v}
              type="button"
              aria-pressed={layout === v}
              onClick={() => setLayout(v)}
              className={cn("px-3 py-1.5", layout === v ? "bg-primary text-white" : "bg-surface hover:bg-slate-50")}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="ml-auto flex gap-1">
          <Button size="sm" variant="ghost" onClick={() => setCounts(Object.fromEntries(lines.map((l) => [l.id!, l.qty])))}>
            All = Qty
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setCounts(Object.fromEntries(lines.map((l) => [l.id!, "1"])))}>
            All = 1
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setCounts(Object.fromEntries(lines.map((l) => [l.id!, "0"])))}>
            All = 0
          </Button>
        </span>
      </div>
      <div className="max-h-[50vh] overflow-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-slate-50 text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Item</th>
              <th className="px-3 py-2 text-left font-medium">Barcode</th>
              <th className="px-3 py-2 text-right font-medium">MRP</th>
              <th className="px-3 py-2 text-right font-medium">Qty</th>
              <th className="w-28 px-3 py-2 text-right font-medium">Labels</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.uid} className="border-t border-border">
                <td className="px-3 py-1.5">
                  <span className="font-medium">{l.itemName}</span>
                  <span className="block text-xs text-muted">
                    {departments.find((d) => String(d.id) === l.departmentId)?.name}
                    {catText(l) && ` · ${catText(l)}`}
                  </span>
                </td>
                <td className="px-3 py-1.5 font-mono text-xs">{l.barcode}</td>
                <td className="num px-3 py-1.5">{formatAmount(l.mrp)}</td>
                <td className="num px-3 py-1.5">{l.qty}</td>
                <td className="px-3 py-1">
                  <input
                    aria-label={`Labels for ${l.itemName}`}
                    inputMode="numeric"
                    className="h-8 w-full rounded-md border border-border px-2 text-right text-sm tabular-nums focus:border-primary focus:outline-none"
                    value={counts[l.id!] ?? ""}
                    onChange={(e) => setCounts((c) => ({ ...c, [l.id!]: e.target.value.replace(/\D/g, "").slice(0, 5) }))}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-muted">Size, fields and labels per row come from Settings → Barcode. The print view opens in a new tab.</p>
    </Modal>
  );
}
